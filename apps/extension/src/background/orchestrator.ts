// Orchestrator - owns the step loop per PLAN.md §13.1
// initialize(task) → observe() → sanitize() → gate() → reason() → validate() → confirm?() → execute() → verify() → record()

import type { RawObservation, SanitizedObservation, CapturedFrame } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope, ActionResult, Target } from '@glasswall/schema/action';
import type { PolicyConfig } from '@glasswall/schema/policy';
import type { SanitizeResult, RedactionReason, AuditPrivacyFields } from '@glasswall/schema/audit';
import type { SafePayload, Violation, SecretRegistry, Result, Sensitive } from '@glasswall/schema/branded';
import { send } from './net';
import { sanitize, egressGate, checkVaultTypeMatch, scanLiteralAgainstRegistry, resolveForBinding, createChromeSessionVaultStore, type VaultStore } from '@glasswall/privacy';
import { recordRecoveryAttempt, shouldAttemptRecovery, clearRecoveryHistory } from './recovery';
import { recordFailure, recordSuccess, isAvailable, getDegradedSubsystems } from './circuit-breaker';
import { autoPersist, checkAndRecover } from './persist';

// Session state (persisted to chrome.storage.session for SW restart recovery)

export interface SessionState {
  sessionId: string;
  task: string;
  policy: PolicyConfig;
  siteAllowlist: string[];
  budget: { stepsLeft: number; msLeft: number };
  stepIndex: number;
  consecutiveFailures: number;
  aborted: boolean;
  // Secret registry for vault handles (C6, C7, C8)
  secretRegistry: SecretRegistry;
  // Vault store for resolving handles
  vaultStore: VaultStore;
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
  
  const vaultStore = createChromeSessionVaultStore();
  await vaultStore.init();
  
  currentSession = {
    sessionId: crypto.randomUUID(),
    task,
    policy,
    siteAllowlist,
    budget: { stepsLeft: policy.max_elements, msLeft: 5 * 60 * 1000 },
    stepIndex: 0,
    consecutiveFailures: 0,
    aborted: false,
    secretRegistry: new Map(),
    vaultStore,
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

  // Check for session recovery on startup
  const recovery = await checkAndRecover();
  if (recovery.recovered && recovery.session) {
    currentSession = recovery.session;
    console.log('[Orchestrator] Session recovered:', recovery.message);
    // Notify UI of recovery
    chrome.runtime.sendMessage({
      type: 'extension:session-recovered',
      payload: { message: recovery.message, stepIndex: currentSession.stepIndex },
    }).catch(() => {});
  }

  while (!shouldTerminate()) {
    const stepTimings: Partial<StepTimings> = {};
    stepTimings.perceptionStart = Date.now();

    try {
      // Check circuit breakers for perception subsystem
      if (!isAvailable('vision') || !isAvailable('ocr') || !isAvailable('ner')) {
        const degraded = getDegradedSubsystems();
        console.warn('[Orchestrator] Degraded subsystems:', degraded);
        // Continue with degraded perception (explain-or-redact handles this)
      }

      const observation = await observe();
      if (!observation) break;
      
      stepTimings.perceptionEnd = Date.now();

      currentSession.workingMemory.observationHistory.push(observation);
      if (currentSession.workingMemory.observationHistory.length > 10) {
        currentSession.workingMemory.observationHistory.shift();
      }

      // Persist observation for recovery
      await autoPersist(currentSession);

      stepTimings.sanitizeStart = Date.now();
      const sanitizeResult = await sanitize({
        raw: observation,
        frame: null,
        task: currentSession.task,
        step: currentSession.stepIndex,
        session: { session_id: currentSession.sessionId, policy_profile: currentSession.policy.name as any },
      });
      stepTimings.sanitizeEnd = Date.now();

      // Track sanitization subsystem health
      if (sanitizeResult.degraded?.length) {
        for (const d of sanitizeResult.degraded) {
          if (d.includes('vision')) recordFailure('vision');
          else if (d.includes('ocr')) recordFailure('ocr');
          else if (d.includes('ner')) recordFailure('ner');
          else if (d.includes('deterministic')) recordFailure('deterministic');
          else if (d.includes('fusion')) recordFailure('fusion');
          else if (d.includes('policy')) recordFailure('policy');
        }
      } else {
        recordSuccess('vision');
        recordSuccess('ocr');
        recordSuccess('ner');
        recordSuccess('deterministic');
        recordSuccess('fusion');
        recordSuccess('policy');
      }

      const sanitizedObs = sanitizeResult.observation as SanitizedObservation;
      updateProgress(sanitizedObs);

      stepTimings.gateStart = Date.now();
      const gateResult = egressGate(sanitizedObs, currentSession.secretRegistry, currentSession.policy);
      if (!gateResult.ok) {
        // Gate violation - fail closed per C6
        console.error('Egress gate violation:', gateResult.error);
        recordFailure('egress');
        currentSession.consecutiveFailures++;
        await recordStepResult({
          ok: false,
          effect_observed: false,
          error_code: 'EGRESS_GATE_VIOLATION',
          error_message: `Egress gate violation: ${gateResult.error.code} - ${gateResult.error.message}`,
        }, stepTimings);
        await autoPersist(currentSession);
        continue;
      }
      recordSuccess('egress');
      const safePayload = gateResult.value;
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

      // Handle execution failures with recovery ladder
      if (!executeResult.ok) {
        const recoveryDecision = shouldAttemptRecovery(
          currentSession.stepIndex,
          actionEnvelope.action.type,
          executeResult.error_code
        );

        if (recoveryDecision.shouldRecover && recoveryDecision.recoveryAction) {
          console.log('[Orchestrator] Attempting recovery:', recoveryDecision.reason);
          recordRecoveryAttempt(currentSession.stepIndex, actionEnvelope.action.type, executeResult.error_code);
          
          // Execute recovery action
          const recoveryEnvelope: ActionEnvelope = {
            ...actionEnvelope,
            action: recoveryDecision.recoveryAction,
          };
          
          const recoveryExecuteResult = await execute(recoveryEnvelope);
          const recoveryVerifyResult = await verify(recoveryEnvelope, recoveryExecuteResult);
          
          if (recoveryExecuteResult.ok && recoveryVerifyResult.verified) {
            console.log('[Orchestrator] Recovery succeeded');
            recordSuccess('executor');
            // Re-try original action
            const retryExecuteResult = await execute(actionEnvelope);
            const retryVerifyResult = await verify(actionEnvelope, retryExecuteResult);
            
            await recordStepResult(retryExecuteResult, stepTimings, retryVerifyResult, sanitizeResult);
            
            if (retryExecuteResult.ok) {
              currentSession.consecutiveFailures = 0;
              currentSession.stepIndex++;
              await autoPersist(currentSession);
              continue;
            }
          }
        }

        // Recovery failed or not attempted
        recordFailure('executor');
        if (executeResult.error_code) {
          chrome.runtime.sendMessage({
            type: 'extension:error',
            payload: { code: executeResult.error_code, stepIndex: currentSession.stepIndex },
          }).catch(() => {});
        }
      } else {
        recordSuccess('executor');
      }

      await recordStepResult(executeResult, stepTimings, verifyResult, sanitizeResult);

      if (actionEnvelope.action.type === 'DONE') {
        break;
      }

      currentSession.stepIndex++;
      currentSession.consecutiveFailures = 0;

    } catch (error) {
      console.error('Step failed:', error);
      recordFailure('executor');
      currentSession.consecutiveFailures++;
      await recordStepResult({
        ok: false,
        effect_observed: false,
        error_code: 'AGENT_ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      }, stepTimings);

      chrome.runtime.sendMessage({
        type: 'extension:error',
        payload: { code: 'AGENT_ERROR', stepIndex: currentSession.stepIndex },
      }).catch(() => {});
    }

    await autoPersist(currentSession);
    await new Promise(r => setTimeout(r, 50));
  }

  notifyTraceComplete();
  clearRecoveryHistory();
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

  // Rung 7: Vault type match (C8) - check VAULT_TYPE_MISMATCH (potential exfiltration)
  if (action.type === 'TYPE' && hasTarget && action.value.kind === 'vault_ref') {
    const vaultCheck = checkVaultTypeMatch(action, observation);
    if (!vaultCheck.ok) {
      // Log as potential exfiltration attempt - demo beat
      console.warn('VAULT_TYPE_MISMATCH (potential exfiltration):', vaultCheck.error);
      return { ok: false, error_code: 'VAULT_TYPE_MISMATCH', error_message: vaultCheck.error.message };
    }
  }

  // Rung 8: Scan literal against registry (C8)
  if (action.type === 'TYPE' && action.value.kind === 'literal') {
    const literalCheck = scanLiteralAgainstRegistry(action.value.text, currentSession!.secretRegistry);
    if (!literalCheck.ok) {
      console.warn('LITERAL_CONTAINS_SECRET:', literalCheck.error);
      return { ok: false, error_code: 'LITERAL_CONTAINS_SECRET', error_message: literalCheck.error.message };
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

  // Notify side panel of error
  if (validationResult.error_code) {
    chrome.runtime.sendMessage({
      type: 'extension:error',
      payload: { code: validationResult.error_code, stepIndex: currentSession!.stepIndex },
    }).catch(() => {});
  }
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

  // Resolve vault references before sending to content script (C7)
  let actionToSend = envelope.action;
  if (actionToSend.type === 'TYPE' && actionToSend.value.kind === 'vault_ref') {
    const handle = actionToSend.value.handle;
    const targetId = actionToSend.target!.id; // TYPE action always has target
    // Find target element from the latest sanitized observation (has sensitivity_class)
    const latestObs = currentSession!.workingMemory.observationHistory[currentSession!.workingMemory.observationHistory.length - 1];
    const targetElement = latestObs?.elements.find(e => e.id === targetId);
    if (targetElement && currentSession!.vaultStore) {
      const bindingResult = await resolveForBinding(handle, {
        element_id: targetElement.id,
        sensitivity_class: (targetElement as any).sensitivity_class || 'none',
        accepts: (targetElement as any).sensitivity_class ? [(targetElement as any).sensitivity_class] : [],
      }, currentSession!.vaultStore);
      
      if (!bindingResult.ok) {
        return { ok: false, effect_observed: false, error_code: 'VAULT_TYPE_MISMATCH', error_message: bindingResult.error.message };
      }
      
      // Replace vault_ref with literal value for content script
      const sensitiveValue: Sensitive<string> = bindingResult.value;
      actionToSend = {
        ...actionToSend,
        value: { kind: 'literal' as const, text: sensitiveValue.value },
      };
    }
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
      chrome.tabs.sendMessage(tabId, { type: 'extension:execute-action', payload: { action: actionToSend, observationId: envelope.observation_id } });
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
      secretRegistry: new Map(), // Re-initialize secret registry on restore
      workingMemory: { observationHistory: [], domSnapshots: new Map() },
    };
    return currentSession;
  }
  return null;
}