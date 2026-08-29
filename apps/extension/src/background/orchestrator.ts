// Orchestrator - owns the step loop per PLAN.md §13.1
// initialize(task) → observe() → sanitize() → gate() → reason() → validate() → confirm?() → execute() → verify() → record()

import type { RawObservation, SanitizedObservation, CapturedFrame } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope, ActionResult, Target } from '@glasswall/schema/action';
import type { PolicyConfig } from '@glasswall/schema/policy';
import type { SanitizeResult, RedactionReason, AuditPrivacyFields } from '@glasswall/schema/audit';
import type { SafePayload } from '@glasswall/schema/branded';
import { send } from './net';
import { sanitize as stubSanitize } from './sanitize.stub';

// Session state (persisted to chrome.storage.session for SW restart recovery)
interface SessionState {
  sessionId: string;
  task: string;
  policy: PolicyConfig;
  siteAllowlist: string[];
  budget: { stepsLeft: number; msLeft: number };
  stepIndex: number;
  consecutiveFailures: number;
  aborted: boolean;
  // Working memory (local, never sent)
  workingMemory: {
    observationHistory: RawObservation[];
    domSnapshots: Map<number, string>;
  };
  // Sanitized memory (sent to model - last 5 steps)
  sanitizedMemory: {
    actionHistory: ActionEnvelope[];
    progress: {
      fieldsFilled: number;
      fieldsRemaining: number;
      pageTypeSequence: string[];
    };
  };
}

let currentSession: SessionState | null = null;

interface StepTimings {
  perceptionStart: number;
  perceptionEnd: number;
  sanitizeStart: number;
  sanitizeEnd: number;
  gateStart: number;
  gateEnd: number;
  networkStart: number;
  networkEnd: number;
  executeStart: number;
  executeEnd: number;
  verifyStart: number;
  verifyEnd: number;
  totalMs: number;
}

type ConfirmCallback = (approved: boolean) => void;
let pendingConfirmation: ConfirmCallback | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'extension:confirmation-response') {
    if (pendingConfirmation) {
      pendingConfirmation(message.payload.approved);
      pendingConfirmation = null;
    }
    sendResponse({ status: 'ok' });
    return true;
  }
  if (message.type === 'extension:abort') {
    if (currentSession) {
      currentSession.aborted = true;
    }
    sendResponse({ status: 'ok' });
    return true;
  }
  if (message.type === 'extension:get-session') {
    sendResponse({ session: currentSession ? sanitizeSessionForUI(currentSession) : null });
    return true;
  }
  return false;
});

function sanitizeSessionForUI(session: SessionState) {
  return {
    sessionId: session.sessionId,
    task: session.task,
    stepIndex: session.stepIndex,
    budget: session.budget,
    consecutiveFailures: session.consecutiveFailures,
    aborted: session.aborted,
    progress: session.sanitizedMemory.progress,
  };
}

export async function initialize(task: string, policyProfile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' = 'STRICT', siteAllowlist: string[] = []): Promise<void> {
  const policy = getPolicyPreset(policyProfile);
  
  currentSession = {
    sessionId: crypto.randomUUID(),
    task,
    policy,
    siteAllowlist,
    budget: { stepsLeft: policy.max_elements, msLeft: 5 * 60 * 1000 },
    stepIndex: 0,
    consecutiveFailures: 0,
    aborted: false,
    workingMemory: {
      observationHistory: [],
      domSnapshots: new Map(),
    },
    sanitizedMemory: {
      actionHistory: [],
      progress: { fieldsFilled: 0, fieldsRemaining: 0, pageTypeSequence: [] },
    },
  };

  await persistSession();
  await runLoop();
}

function getPolicyPreset(profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE'): PolicyConfig {
  const base = {
    name: profile as 'STRICT' | 'BALANCED' | 'PERMISSIVE',
    unexplained_prior: profile === 'STRICT' ? 0.8 : profile === 'BALANCED' ? 0.4 : 0.1,
    screenshot: { enabled: profile !== 'STRICT' },
    thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
    tiers: {
      T1: 'VAULT_ONLY' as const,
      T2: 'TOKENIZE' as const,
      T3: profile === 'PERMISSIVE' ? 'PASS' as const : 'TOKENIZE' as const,
      T4: 'ANNOTATE' as const,
      T5: 'TOKENIZE' as const,
    },
    url: { query: 'DROP' as const, fragment: 'DROP' as const, path: 'TEMPLATE' as const },
    text_block_max_chars: 400,
    fail_mode: 'CLOSED' as const,
    high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
    require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
    max_elements: 400,
  };
  
  return base;
}

async function runLoop(): Promise<void> {
  if (!currentSession) return;

  while (!shouldTerminate()) {
    const stepTimings: Partial<StepTimings> = {};
    stepTimings.perceptionStart = Date.now();

    try {
      const observation = await observe();
      if (!observation) break;
      
      stepTimings.perceptionEnd = Date.now();

      currentSession.workingMemory.observationHistory.push(observation);
      if (currentSession.workingMemory.observationHistory.length > 10) {
        currentSession.workingMemory.observationHistory.shift();
      }

      stepTimings.sanitizeStart = Date.now();
      const sanitizeResult = await sanitize({
        raw: observation,
        frame: null,
        task: currentSession.task,
        step: currentSession.stepIndex,
        session: { session_id: currentSession.sessionId, policy_profile: currentSession.policy.name as any },
      });
      stepTimings.sanitizeEnd = Date.now();

      const sanitizedObs = sanitizeResult.observation as SanitizedObservation;
      updateProgress(sanitizedObs);

      stepTimings.gateStart = Date.now();
      const safePayload = await egressGate(sanitizedObs);
      stepTimings.gateEnd = Date.now();

      stepTimings.networkStart = Date.now();
      const actionEnvelope = await reason(safePayload, sanitizedObs);
      stepTimings.networkEnd = Date.now();

      const validationResult = validateAction(actionEnvelope, sanitizedObs);
      if (!validationResult.ok) {
        await handleValidationFailure(validationResult, stepTimings);
        continue;
      }

      if (actionEnvelope.requires_confirmation) {
        const approved = await requestConfirmation(actionEnvelope, sanitizedObs);
        if (!approved) {
          await recordStepResult({
            ok: false,
            effect_observed: false,
            error_code: 'ABORTED',
            error_message: 'User denied confirmation',
          }, stepTimings);
          currentSession.consecutiveFailures++;
          continue;
        }
      }

      stepTimings.executeStart = Date.now();
      const executeResult = await execute(actionEnvelope);
      stepTimings.executeEnd = Date.now();

      stepTimings.verifyStart = Date.now();
      const verifyResult = await verify(actionEnvelope, executeResult);
      stepTimings.verifyEnd = Date.now();

      await recordStepResult(executeResult, stepTimings, verifyResult, sanitizeResult);

      if (actionEnvelope.action.type === 'DONE') {
        break;
      }

      currentSession.stepIndex++;
      currentSession.consecutiveFailures = 0;

    } catch (error) {
      console.error('Step failed:', error);
      currentSession.consecutiveFailures++;
      await recordStepResult({
        ok: false,
        effect_observed: false,
        error_code: 'AGENT_ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      }, stepTimings);
    }

    await persistSession();
    await new Promise(r => setTimeout(r, 50));
  }

  notifyTraceComplete();
}

function shouldTerminate(): boolean {
  if (!currentSession) return true;
  if (currentSession.aborted) return true;
  if (currentSession.budget.stepsLeft <= 0) return true;
  if (currentSession.budget.msLeft <= 0) return true;
  if (currentSession.consecutiveFailures >= 3) return true;
  return false;
}

async function observe(): Promise<RawObservation | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  return new Promise((resolve) => {
    const listener = (message: any, _sender: any, sendResponse: any) => {
      if (message.type === 'extension:observation-ready') {
        chrome.runtime.onMessage.removeListener(listener);
        sendResponse({ status: 'ok' });
        resolve(message.payload.observation);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.tabs.sendMessage(tab.id!, { type: 'extension:capture-request' }).catch(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    });

    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    }, 10000);
  });
}

async function reason(payload: SafePayload, _observation: SanitizedObservation): Promise<ActionEnvelope> {
  const response = await send(payload);
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Backend error: ${data.error}`);
  }
  
  return data.action_envelope;
}

function validateAction(envelope: ActionEnvelope, observation: SanitizedObservation): { ok: boolean; error_code?: ActionResult['error_code']; error_message?: string } {
  const action = envelope.action;
  
  if (envelope.observation_id !== observation.observation_id) {
    return { ok: false, error_code: 'STALE_OBSERVATION' };
  }

  // Check if action has a target
  const hasTarget = 'target' in action && action.target != null;
  
  if (hasTarget) {
    const target = observation.elements.find(e => e.id === action.target!.id);
    if (!target) {
      return { ok: false, error_code: 'UNKNOWN_TARGET' };
    }
    if (!target.visible || !target.enabled) {
      return { ok: false, error_code: 'ELEMENT_NOT_ACTIONABLE' };
    }
    const available = target.available_actions ?? [];
    if (!available.includes(action.type)) {
      return { ok: false, error_code: 'UNSUPPORTED_ACTION' };
    }
  }

  if (action.type === 'NAVIGATE') {
    const url = new URL(action.url_template, 'http://localhost');
    if (!currentSession!.siteAllowlist.some(allowed => url.hostname.endsWith(allowed.replace('*.', '')))) {
      return { ok: false, error_code: 'ORIGIN_NOT_ALLOWED' };
    }
  }

  return { ok: true };
}

async function handleValidationFailure(validationResult: { ok: boolean; error_code?: ActionResult['error_code']; error_message?: string }, timings: Partial<StepTimings>): Promise<void> {
  currentSession!.consecutiveFailures++;
  await recordStepResult({
    ok: false,
    effect_observed: false,
    error_code: validationResult.error_code ?? 'AGENT_ERROR',
    error_message: validationResult.error_message,
  }, timings);
}

async function requestConfirmation(envelope: ActionEnvelope, observation: SanitizedObservation): Promise<boolean> {
  let targetLabel = 'Unknown';
  let targetRole = 'unknown';
  let destination: string | undefined;
  let vaultRef: string | undefined;

  const action = envelope.action;
  const hasTarget = 'target' in action && action.target != null;
  
  if (hasTarget) {
    const target = observation.elements.find(e => e.id === action.target!.id);
    if (target) {
      targetLabel = target.label_raw || target.role;
      targetRole = target.role;
    }
  }

  if (action.type === 'NAVIGATE') {
    destination = action.url_template;
  }

  if (action.type === 'TYPE' && action.value.kind === 'vault_ref') {
    vaultRef = action.value.handle;
  }

  return new Promise((resolve) => {
    pendingConfirmation = resolve;
    
    chrome.runtime.sendMessage({
      type: 'extension:confirmation-request',
      payload: {
        actionType: action.type,
        targetLabel,
        targetRole,
        destination,
        risk: { level: envelope.risk, category: envelope.risk === 'high' ? 'SUBMIT_LIKE' : 'OTHER', reason: envelope.reasoning || '' },
        vaultRef,
      },
    }).catch(() => resolve(false));
  });
}

async function execute(envelope: ActionEnvelope): Promise<ActionResult> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const tabId = tab?.id;
  if (!tabId) {
    return { ok: false, effect_observed: false, error_code: 'ELEMENT_NOT_FOUND', error_message: 'No active tab' };
  }

  return new Promise((resolve) => {
    const listener = (message: any, _sender: any, sendResponse: any) => {
      if (message.type === 'extension:action-result') {
        chrome.runtime.onMessage.removeListener(listener);
        sendResponse({ status: 'ok' });
        resolve(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // chrome.tabs.sendMessage returns void, not a Promise
    try {
      chrome.tabs.sendMessage(tabId, { type: 'extension:execute-action', payload: { action: envelope.action, observationId: envelope.observation_id } });
    } catch {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ ok: false, effect_observed: false, error_code: 'AGENT_ERROR', error_message: 'Failed to send to content script' });
      return;
    }

    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ ok: false, effect_observed: false, error_code: 'AGENT_ERROR', error_message: 'Execution timeout' });
    }, 15000);
  });
}

async function verify(envelope: ActionEnvelope, executeResult: ActionResult): Promise<{ verified: boolean; effect: string }> {
  const expected = envelope.action.type;
  let verified = executeResult.ok && executeResult.effect_observed;
  let effect = 'none';

  if (executeResult.ok) {
    switch (expected) {
      case 'CLICK':
      case 'TYPE':
      case 'SELECT':
      case 'PRESS_KEY':
        effect = executeResult.effect_observed ? 'dom_mutation' : 'none';
        break;
      case 'NAVIGATE':
        effect = executeResult.effect_observed ? 'navigation' : 'none';
        break;
      case 'SCROLL':
        effect = executeResult.effect_observed ? 'scroll' : 'none';
        break;
      case 'WAIT':
        effect = 'none';
        verified = true;
        break;
      case 'DONE':
        effect = 'success';
        verified = true;
        break;
    }
  }

  return { verified, effect };
}

function updateProgress(observation: SanitizedObservation): void {
  if (!currentSession) return;
  
  const fillable = observation.elements.filter(e => 
    e.tag === 'input' && e.value_state !== 'filled' && e.value_state !== 'n/a'
  ).length;
  
  const filled = observation.elements.filter(e => 
    e.tag === 'input' && e.value_state === 'filled'
  ).length;

  currentSession.sanitizedMemory.progress.fieldsFilled = filled;
  currentSession.sanitizedMemory.progress.fieldsRemaining = fillable;
  currentSession.sanitizedMemory.progress.pageTypeSequence.push(observation.page.type_hint);
  if (currentSession.sanitizedMemory.progress.pageTypeSequence.length > 10) {
    currentSession.sanitizedMemory.progress.pageTypeSequence.shift();
  }
}

async function recordStepResult(
  executeResult: ActionResult,
  timings: Partial<StepTimings>,
  verifyResult?: { verified: boolean; effect: string },
  _sanitizeResult?: SanitizeResult
): Promise<void> {
  if (!currentSession) return;

  const totalMs = (timings.verifyEnd || Date.now()) - (timings.perceptionStart || Date.now());
  
  const traceEntry = {
    step: currentSession.stepIndex,
    action: currentSession.sanitizedMemory.actionHistory[currentSession.sanitizedMemory.actionHistory.length - 1]?.action,
    result: executeResult,
    verification: verifyResult,
    timings: {
      perception: (timings.perceptionEnd || 0) - (timings.perceptionStart || 0),
      sanitize: (timings.sanitizeEnd || 0) - (timings.sanitizeStart || 0),
      gate: (timings.gateEnd || 0) - (timings.gateStart || 0),
      network: (timings.networkEnd || 0) - (timings.networkStart || 0),
      execute: (timings.executeEnd || 0) - (timings.executeStart || 0),
      verify: (timings.verifyEnd || 0) - (timings.verifyStart || 0),
      total: totalMs,
    },
    degraded: _sanitizeResult?.degraded ?? [],
    redactions: _sanitizeResult?.redactions?.length ?? 0,
    timestamp: Date.now(),
  };

  chrome.runtime.sendMessage({
    type: 'extension:trace-entry',
    payload: traceEntry,
  }).catch(() => {});
}

function notifyTraceComplete(): void {
  chrome.runtime.sendMessage({
    type: 'extension:trace-complete',
    payload: { sessionId: currentSession?.sessionId },
  }).catch(() => {});
}

async function persistSession(): Promise<void> {
  if (!currentSession) return;
  
  const toPersist = {
    sessionId: currentSession.sessionId,
    task: currentSession.task,
    policy: currentSession.policy,
    siteAllowlist: currentSession.siteAllowlist,
    budget: currentSession.budget,
    stepIndex: currentSession.stepIndex,
    consecutiveFailures: currentSession.consecutiveFailures,
    aborted: currentSession.aborted,
    sanitizedMemory: currentSession.sanitizedMemory,
  };

  await chrome.storage.session.set({ 'glasswall:session': toPersist });
}

export async function restoreSession(): Promise<SessionState | null> {
  const data = await chrome.storage.session.get('glasswall:session');
  if (data['glasswall:session']) {
    currentSession = {
      ...data['glasswall:session'],
      workingMemory: { observationHistory: [], domSnapshots: new Map() },
    };
    return currentSession;
  }
  return null;
}

// C4 CONTRACT STUB - sanitize()
async function sanitize(input: {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
}): Promise<SanitizeResult> {
  return stubSanitize(input);
}

// C6 CONTRACT STUB - egressGate()
// PENDING_GATE: Brand cast to be removed when real gate is wired
async function egressGate(payload: unknown): Promise<SafePayload> {
  // PENDING_GATE: This brand cast will be deleted in one commit when B's egressGate is wired
  return payload as SafePayload;
}