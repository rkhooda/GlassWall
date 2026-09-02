// The run: observe → perceive → sanitize → gate → reason → validate → confirm →
// execute → verify → record, until DONE, abort, budget, or three failures in a row.
//
// Values never leave this file except vault → executor (as a literal inside the
// tab message) and never reach net.ts: every outbound request is a SafePayload
// built by egressGate().
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { RawObservation, SanitizedObservation } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope, ActionResult } from '@glasswall/schema/action';
import { StepResponseSchema, SessionResponseSchema, HealthResponseSchema, GATEWAY_PATHS, type StepRequest } from '@glasswall/schema/transport';
import {
  sanitize,
  PROFILES,
  egressGate,
  lastGateTimings,
  createSessionSecrets,
  createChromeSessionVaultStore,
  resolveForBinding,
  checkVaultTypeMatch,
  scanLiteralAgainstRegistry,
  type SessionSecrets,
} from '@glasswall/privacy';
import { send } from './net';
import { sendToPanel, sendToTab, type RunState, type TraceEntry, type AuditEntry, type HealthInfo, type ConfirmContext } from '../shared/messages';
import { GATEWAY_ORIGIN, DEFAULT_STEP_BUDGET } from '../shared/config';
import { createStepPerception } from './perception';
import { captureVisibleTabDataUrl, warmUpInOffscreen, statsFromOffscreen } from './capture';

declare const __GW_UNSAFE_PASSTHROUGH__: boolean;
/**
 * Negative control for the leakage harness (eval/leakage). True only in the
 * `build:unsafe` output: the raw observation is sent and the gate is skipped, so
 * the canary harness must go red. Dead code in every other build; verify:boundary
 * asserts the marker is absent from dist/.
 */
const UNSAFE_PASSTHROUGH = typeof __GW_UNSAFE_PASSTHROUGH__ !== 'undefined' && __GW_UNSAFE_PASSTHROUGH__;

const MAX_CONSECUTIVE_FAILURES = 3;
const CONFIRM_TIMEOUT_MS = 90_000;
const STEP_PAUSE_MS = 150;

let state: RunState = { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: DEFAULT_STEP_BUDGET, provider: null };
let aborted = false;
let pendingConfirm: ((approved: boolean) => void) | null = null;
let audit: AuditEntry[] = [];

function setState(patch: Partial<RunState>): void {
  state = { ...state, ...patch };
  sendToPanel({ type: 'gw:state', state });
}

export function getState(): RunState {
  return state;
}

export async function getAudit(): Promise<AuditEntry[]> {
  return audit;
}

export function abortRun(): void {
  aborted = true;
  pendingConfirm?.(false);
  pendingConfirm = null;
  if (state.status === 'running' || state.status === 'waiting_confirmation') setState({ status: 'aborted', message: 'Aborted by user' });
}

export function respondConfirmation(approved: boolean): void {
  pendingConfirm?.(approved);
  pendingConfirm = null;
}

class RunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** One gated request to the gateway. Throws RunError on gate violation or transport failure. */
async function gateway<T>(request: Parameters<typeof egressGate>[0], secrets: SessionSecrets | null, policy: PolicyProfile, parse: (body: unknown) => T): Promise<T> {
  const gate = UNSAFE_PASSTHROUGH
    ? ({ ok: true, value: { __safePayloadBrand: '__safePayloadBrand', destination: GATEWAY_ORIGIN, path: request.path, method: request.body === undefined ? 'GET' : 'POST', body: request.body } } as const)
    : egressGate(request, secrets?.registry ?? new Map(), PROFILES[policy].policy, GATEWAY_ORIGIN);
  if (!gate.ok) throw new RunError('EGRESS_GATE_VIOLATION', `${gate.error.code}: ${gate.error.message}`);
  let reply: Awaited<ReturnType<typeof send>>;
  try {
    reply = await send(gate.value);
  } catch (e) {
    throw new RunError('GATEWAY_UNREACHABLE', `Gateway unreachable at ${GATEWAY_ORIGIN}. Start it with \`pnpm dev\` (${e instanceof Error ? e.message : String(e)})`);
  }
  if (reply.status >= 400) {
    const body = reply.body as { error?: string; message?: string; type?: string } | null;
    throw new RunError(body?.error ?? `HTTP_${reply.status}`, body?.message ?? body?.type ?? `Gateway returned ${reply.status}`);
  }
  return parse(reply.body);
}

export async function getHealth(): Promise<HealthInfo> {
  const local = await statsFromOffscreen().catch(() => null);
  const capability = local?.capability ? { webgpu: local.capability.webgpu, wasm: local.capability.wasm } : undefined;
  try {
    const health = await gateway({ path: GATEWAY_PATHS.health }, null, 'STRICT', b => HealthResponseSchema.parse(b));
    return { gateway: 'ok', providers: health.providers.filter(p => p.available).map(p => p.name), active: health.active, capability, warm: local?.warm };
  } catch {
    return { gateway: 'unreachable', providers: [], active: null, capability, warm: local?.warm };
  }
}

/** Load the local models before the user's first step. Never throws; failures show up as degraded sources. */
export function warmUp(policy: PolicyProfile): void {
  void warmUpInOffscreen({ screenshotEnabled: PROFILES[policy].policy.screenshot.enabled }).catch(() => undefined);
}

const isWebUrl = (url?: string) => /^https?:/.test(url ?? '');

/** The page the run acts on: the active web tab, else the most recently used one. */
async function targetTabId(explicit?: number): Promise<number> {
  if (explicit !== undefined) return explicit;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id && isWebUrl(active.url)) return active.id;
  const candidates = (await chrome.tabs.query({}))
    .filter(t => t.id !== undefined && isWebUrl(t.url))
    .sort((a, b) => ((b as { lastAccessed?: number }).lastAccessed ?? 0) - ((a as { lastAccessed?: number }).lastAccessed ?? 0));
  const pick = candidates[0];
  if (!pick?.id) throw new RunError('NO_WEB_TAB', 'GLASSWALL works on http(s) pages only; open a web page first');
  return pick.id;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: 'gw:ping' }, 1500);
  } catch {
    // The page was open before the extension loaded, or just navigated: inject now.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/index.ts'] });
    await sendToTab(tabId, { type: 'gw:ping' }, 3000);
  }
}

async function observe(tabId: number, observationId: string, sessionId: string, step: number): Promise<RawObservation> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureContentScript(tabId);
      const reply = await sendToTab(tabId, { type: 'gw:observe', observationId, sessionId, step });
      if (reply.type !== 'gw:observation') throw new Error('unexpected reply to observe');
      return reply.observation;
    } catch (e) {
      if (attempt === 1) throw new RunError('OBSERVE_FAILED', e instanceof Error ? e.message : String(e));
      await new Promise(r => setTimeout(r, 700));
    }
  }
  throw new RunError('OBSERVE_FAILED', 'unreachable');
}

function labelOf(obs: SanitizedObservation, action: Action): string | undefined {
  if (!('target' in action) || !action.target) return undefined;
  const el = obs.elements.find(e => e.id === action.target!.id);
  return el ? el.label_raw || el.placeholder_raw || `${el.tag}#${el.id}` : action.target.id;
}

/** The validator ladder, in order. Returns an error code or null. */
function validate(envelope: ActionEnvelope, obs: SanitizedObservation, secrets: SessionSecrets): { code: ActionResult['error_code']; message: string } | null {
  if (envelope.observation_id !== obs.observation_id) return { code: 'STALE_OBSERVATION', message: 'action refers to an older observation' };
  const action = envelope.action;
  if ('target' in action && action.target) {
    const el = obs.elements.find(e => e.id === action.target!.id);
    if (!el) return { code: 'UNKNOWN_TARGET', message: `${action.target.id} is not in the observation` };
    if (el.id_hash !== action.target.id_hash) return { code: 'IDENTITY_MISMATCH', message: `${action.target.id} identity does not match` };
    if (!el.visible) return { code: 'ELEMENT_OBSCURED', message: `${action.target.id} is not visible` };
    if (!el.enabled) return { code: 'ELEMENT_DISABLED', message: `${action.target.id} is disabled` };
    if (el.available_actions?.length && !el.available_actions.includes(action.type) && action.type !== 'PRESS_KEY' && action.type !== 'SCROLL') {
      return { code: 'UNSUPPORTED_ACTION', message: `${action.type} is not available on ${action.target.id}` };
    }
  }
  if (action.type === 'NAVIGATE') {
    try {
      const url = new URL(action.url_template, 'http://placeholder.invalid');
      if (url.hostname !== 'placeholder.invalid') return { code: 'ORIGIN_NOT_ALLOWED', message: 'cross-origin navigation is not allowed' };
    } catch {
      return { code: 'ORIGIN_NOT_ALLOWED', message: 'invalid navigation target' };
    }
  }
  if (action.type === 'TYPE' && action.value.kind === 'vault_ref') {
    const rung7 = checkVaultTypeMatch(action, obs);
    if (!rung7.ok) return { code: 'VAULT_TYPE_MISMATCH', message: rung7.error.message };
  }
  if (action.type === 'TYPE' && action.value.kind === 'literal') {
    const rung8 = scanLiteralAgainstRegistry(action.value.text, secrets.registry);
    if (!rung8.ok) return { code: 'LITERAL_CONTAINS_SECRET', message: rung8.error.message };
  }
  if (action.type === 'TYPE' && action.value.kind === 'user_input') return { code: 'UNSUPPORTED_ACTION', message: 'user_input values are not supported' };
  return null;
}

function riskOf(envelope: ActionEnvelope, obs: SanitizedObservation): { needsConfirm: boolean; reason: string; level: ConfirmContext['risk'] } {
  const a = envelope.action;
  const label = labelOf(obs, a) ?? '';
  const policy = PROFILES[state.policy].policy;
  if (a.type === 'NAVIGATE') return { needsConfirm: policy.require_confirmation.includes('NAVIGATE_EXTERNAL'), reason: 'navigation', level: 'high' };
  if (a.type === 'CLICK' && /pay|purchase|buy now|place order|checkout|confirm order/i.test(label)) return { needsConfirm: policy.require_confirmation.includes('PAYMENT') || envelope.requires_confirmation, reason: 'payment or order placement', level: 'high' };
  if (a.type === 'CLICK' && /delete|remove account|unsubscribe/i.test(label)) return { needsConfirm: policy.require_confirmation.includes('DELETE'), reason: 'destructive action', level: 'high' };
  if (envelope.requires_confirmation || envelope.risk === 'high') return { needsConfirm: true, reason: envelope.reasoning ?? 'flagged high risk by the planner', level: 'high' };
  return { needsConfirm: false, reason: '', level: envelope.risk };
}

async function confirm(context: ConfirmContext): Promise<boolean> {
  setState({ status: 'waiting_confirmation' });
  sendToPanel({ type: 'gw:confirm-request', context });
  const approved = await new Promise<boolean>(resolve => {
    pendingConfirm = resolve;
    setTimeout(() => { if (pendingConfirm === resolve) { pendingConfirm = null; resolve(false); } }, CONFIRM_TIMEOUT_MS);
  });
  if (!aborted) setState({ status: 'running' });
  return approved;
}

/** Resolve a vault reference locally. The literal goes to the content script and nowhere else. */
async function bind(action: Action, obs: SanitizedObservation, secrets: SessionSecrets): Promise<{ action: Action } | { error: ActionResult['error_code']; message: string }> {
  if (action.type !== 'TYPE' || action.value.kind !== 'vault_ref') return { action };
  const el = obs.elements.find(e => e.id === action.target.id);
  const cls = el?.sensitivity_class;
  const resolved = await resolveForBinding(action.value.handle, { element_id: action.target.id, sensitivity_class: cls, accepts: cls && cls !== 'NONE' ? [cls] : [] }, secrets.vault);
  if (!resolved.ok) return { error: resolved.error.code === 'VAULT_TYPE_MISMATCH' ? 'VAULT_TYPE_MISMATCH' : 'AGENT_ERROR', message: resolved.error.message };
  return { action: { ...action, value: { kind: 'literal', text: resolved.value.value } } };
}

function auditShape(obs: SanitizedObservation, redactions: import('@glasswall/schema/audit').RedactionReason[], timings: TraceEntry['timings']) {
  return {
    redactions: redactions.map(r => ({ rect: r.rect, source: r.source, reason: r.reason })),
    observed: obs.elements.map(e => ({ tag: e.tag, rect: e.rect, visible: e.visible })),
    timings: Object.fromEntries(Object.entries(timings).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
  };
}

async function recordAudit(entry: AuditEntry): Promise<void> {
  audit.push(entry);
  try {
    await chrome.storage.session.set({ 'gw:audit': audit });
  } catch {
    /* storage unavailable: the in-memory log still serves the panel */
  }
}

export async function startRun(task: string, policy: PolicyProfile, tabIdHint?: number): Promise<void> {
  if (state.status === 'running' || state.status === 'waiting_confirmation') throw new Error('A run is already in progress');
  aborted = false;
  audit = [];
  const localSessionId = crypto.randomUUID();
  setState({ status: 'running', sessionId: localSessionId, task, policy, step: 0, stepsLeft: DEFAULT_STEP_BUDGET, provider: null, outcome: undefined, message: undefined });

  const vault = createChromeSessionVaultStore();
  const secrets = createSessionSecrets(localSessionId, vault);
  const history: ActionEnvelope[] = [];
  let lastResult: StepRequest['last_result'];
  let consecutiveFailures = 0;
  let tabId = -1;

  const finish = (status: RunState['status'], patch: Partial<RunState> = {}) => {
    if (tabId > 0) void sendToTab(tabId, { type: 'gw:overlay-clear' }, 1000).catch(() => undefined);
    void sendToTab(tabId, { type: 'gw:eval-hook', key: 'done', value: status }, 1000).catch(() => undefined);
    setState({ status, ...patch });
  };

  try {
    try {
      await vault.init();
    } catch {
      /* first use */
    }
    tabId = await targetTabId(tabIdHint);
    await ensureContentScript(tabId);

    warmUp(policy);
    const session = await gateway({ path: GATEWAY_PATHS.session, body: { task, policy_profile: policy, site_allowlist: [] } }, secrets, policy, b => SessionResponseSchema.parse(b));
    const sessionId = session.session_id;
    setState({ sessionId, provider: session.provider, stepsLeft: session.budget.steps_left });
    const pixels = PROFILES[policy].policy.screenshot.enabled;

    for (let step = 0; step < session.budget.steps_left && !aborted; step++) {
      const t0 = performance.now();
      const timings: TraceEntry['timings'] = { total: 0 };
      const observationId = `obs_${sessionId.slice(0, 8)}_${step}`;
      setState({ step, stepsLeft: session.budget.steps_left - step });

      // Observe, and under a policy that allows pixels, capture the frame right after.
      const raw = await observe(tabId, observationId, sessionId, step);
      timings.observe = Math.round(performance.now() - t0);
      const tCap = performance.now();
      const capture = pixels ? await captureVisibleTabDataUrl(tabId) : { dataUrl: null };
      const frameDataUrl = capture.dataUrl;
      if (pixels) timings.capture = Math.round(performance.now() - tCap);

      // Perceive (local models, offscreen) + sanitize. The frame never leaves the offscreen document.
      const t1 = performance.now();
      const perception = createStepPerception({ observationId, raw, frameDataUrl, policy });
      const result = await sanitize({
        raw,
        frame: null,
        task,
        step,
        session: { session_id: sessionId, policy_profile: policy, secrets },
        perceptionSources: perception.sources,
        budget: { steps_left: session.budget.steps_left - step, ms_left: session.budget.ms_left },
      });
      await secrets.flush();
      // UNSAFE build only: ship the raw observation so the leakage harness can prove it detects a leak.
      const obs = (UNSAFE_PASSTHROUGH ? { ...raw, handles: [], budget: { steps_left: 1, ms_left: 1 } } : result.observation) as SanitizedObservation;
      if (pixels && !frameDataUrl) result.degraded.push(`capture_unavailable${capture.error ? ':' + capture.error.replace(/\s+/g, '_').slice(0, 80) : ''}`);
      const local = perception.timings();
      timings.perceive = Math.round((local.ner ?? 0) + (local.ocr ?? 0) + (local.decode ?? 0));
      timings.sanitize = Math.round(performance.now() - t1) - timings.perceive;
      if (aborted) break;

      void sendToTab(tabId, { type: 'gw:overlay', observation: obs, redactions: result.redactions }, 2000).catch(() => undefined);
      const tRed = performance.now();
      const screenshot = (await perception.redact(result.redactions)) ?? undefined;
      if (perception.frameCaptured) timings.redact = Math.round(performance.now() - tRed);
      sendToPanel({ type: 'gw:inspect', inspect: { step, raw, payload: obs, redactions: result.redactions, degraded: result.degraded, handlesCount: obs.handles?.length ?? 0, screenshotAttached: !!screenshot } });

      // Gate + reason
      const t2 = performance.now();
      const body: StepRequest = { session_id: sessionId, observation: obs, history: history.slice(-5), last_result: lastResult, screenshot };
      let planned: { action_envelope: ActionEnvelope; provider: string; latency_ms: number };
      try {
        planned = await gateway({ path: GATEWAY_PATHS.step, body }, secrets, policy, b => StepResponseSchema.parse(b));
      } catch (e) {
        const code = e instanceof RunError ? e.code : 'AGENT_ERROR';
        const message = e instanceof Error ? e.message : String(e);
        timings.gate = lastGateTimings().schema !== undefined ? Math.round(Object.values(lastGateTimings()).reduce((a, b) => a + b, 0)) : undefined;
        sendToPanel({ type: 'gw:trace', entry: { step, phase: 'error', timings: { ...timings, total: Math.round(performance.now() - t0) }, redactions: result.redactions.length, degraded: result.degraded, observedElements: raw.elements.length, errorCode: code, errorMessage: message, at: Date.now() } });
        await recordAudit({ session_id: sessionId, step, ts: Date.now(), action: 'none', provider: null, latency_ms: Math.round(performance.now() - t0), element_count: raw.elements.length, text_block_count: raw.text_nodes.length, handle_count: obs.handles?.length ?? 0, redaction_count: result.redactions.length, degraded: result.degraded, has_redacted_screenshot: !!screenshot, gate: code === 'EGRESS_GATE_VIOLATION' ? 'rejected' : 'accepted', validation: code, payload_bytes: 0, ...auditShape(obs, result.redactions, { ...timings, total: Math.round(performance.now() - t0) }) });
        if (code === 'EGRESS_GATE_VIOLATION' && ++consecutiveFailures < MAX_CONSECUTIVE_FAILURES) continue; // re-observe; the gate is fail-closed
        throw e;
      }
      timings.gate = Math.round(Object.values(lastGateTimings()).reduce((a, b) => a + b, 0));
      timings.reason = Math.round(performance.now() - t2) - (timings.gate ?? 0);
      setState({ provider: planned.provider });
      const envelope = planned.action_envelope;
      const action = envelope.action;
      const targetLabel = labelOf(obs, action);

      // Validate
      const t3 = performance.now();
      const invalid = validate(envelope, obs, secrets);
      timings.validate = Math.round(performance.now() - t3);
      const base = { step, action, targetLabel, provider: planned.provider, redactions: result.redactions.length, degraded: result.degraded, observedElements: raw.elements.length, at: Date.now() };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(body)).length;
      if (invalid) {
        lastResult = { ok: false, error_code: invalid.code, effect_observed: false };
        sendToPanel({ type: 'gw:trace', entry: { ...base, phase: 'blocked', timings: { ...timings, total: Math.round(performance.now() - t0) }, errorCode: invalid.code, errorMessage: invalid.message } });
        if (invalid.code === 'VAULT_TYPE_MISMATCH' || invalid.code === 'LITERAL_CONTAINS_SECRET') sendToPanel({ type: 'gw:error', code: invalid.code, message: `Blocked: ${invalid.message}`, step });
        await recordAudit({ session_id: sessionId, step, ts: Date.now(), action: action.type, provider: planned.provider, latency_ms: Math.round(performance.now() - t0), element_count: raw.elements.length, text_block_count: raw.text_nodes.length, handle_count: obs.handles?.length ?? 0, redaction_count: result.redactions.length, degraded: result.degraded, has_redacted_screenshot: !!screenshot, gate: 'accepted', validation: invalid.code, payload_bytes: payloadBytes, ...auditShape(obs, result.redactions, { ...timings, total: Math.round(performance.now() - t0) }) });
        // The planner learns it was blocked from last_result; a blocked literal must not travel back in the history.
        history.push(action.type === 'TYPE' && action.value.kind === 'literal' ? { ...envelope, action: { ...action, value: { kind: 'literal', text: '[blocked]' } } } : envelope);
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { finish('error', { message: `Stopped after ${MAX_CONSECUTIVE_FAILURES} blocked actions (last: ${invalid.code})` }); return; }
        await new Promise(r => setTimeout(r, STEP_PAUSE_MS));
        continue;
      }

      // Confirm
      const risk = riskOf(envelope, obs);
      if (risk.needsConfirm) {
        const t4 = performance.now();
        const approved = await confirm({ actionType: action.type, targetLabel: targetLabel ?? '', risk: risk.level, reason: risk.reason, vaultRef: action.type === 'TYPE' && action.value.kind === 'vault_ref' ? action.value.handle : undefined, destination: action.type === 'NAVIGATE' ? action.url_template : undefined });
        timings.confirm = Math.round(performance.now() - t4);
        if (aborted) break;
        if (!approved) {
          lastResult = { ok: false, error_code: 'ABORTED', effect_observed: false };
          sendToPanel({ type: 'gw:trace', entry: { ...base, phase: 'blocked', timings: { ...timings, total: Math.round(performance.now() - t0) }, errorCode: 'ABORTED', errorMessage: 'User denied confirmation' } });
          history.push(envelope);
          finish('aborted', { message: 'User denied the action' });
          return;
        }
      }

      // DONE ends the run without an executor round-trip.
      if (action.type === 'DONE') {
        sendToPanel({ type: 'gw:trace', entry: { ...base, phase: 'done', timings: { ...timings, total: Math.round(performance.now() - t0) } } });
        await recordAudit({ session_id: sessionId, step, ts: Date.now(), action: 'DONE', provider: planned.provider, latency_ms: Math.round(performance.now() - t0), element_count: raw.elements.length, text_block_count: raw.text_nodes.length, handle_count: obs.handles?.length ?? 0, redaction_count: result.redactions.length, degraded: result.degraded, has_redacted_screenshot: !!screenshot, gate: 'accepted', validation: 'ok', payload_bytes: payloadBytes, ...auditShape(obs, result.redactions, { ...timings, total: Math.round(performance.now() - t0) }) });
        void sendToTab(tabId, { type: 'gw:eval-hook', key: 'step', value: JSON.stringify({ step, action: 'DONE', outcome: action.outcome }) }, 1000).catch(() => undefined);
        finish('done', { outcome: action.outcome, message: action.outcome === 'success' ? 'Task completed' : `Planner stopped: ${action.outcome}${envelope.reasoning ? ` — ${envelope.reasoning}` : ''}` });
        return;
      }

      // Execute (vault handles resolved here, locally)
      const t5 = performance.now();
      const bound = await bind(action, obs, secrets);
      let execResult: ActionResult;
      if ('error' in bound) {
        execResult = { ok: false, effect_observed: false, error_code: bound.error, error_message: bound.message } as ActionResult;
        if (bound.error === 'VAULT_TYPE_MISMATCH') sendToPanel({ type: 'gw:error', code: bound.error, message: `Blocked: ${bound.message}`, step });
      } else {
        try {
          const reply = await sendToTab(tabId, { type: 'gw:execute', action: bound.action, observation: obs }, 20_000);
          execResult = reply.type === 'gw:action-result' ? reply.result : ({ ok: false, effect_observed: false, error_code: 'AGENT_ERROR', error_message: 'unexpected reply' } as ActionResult);
        } catch (e) {
          // A navigation tears the content script down mid-reply: treat as an observed navigation effect.
          execResult = { ok: true, effect_observed: true, error_code: 'NONE', error_message: `content script reloaded (${e instanceof Error ? e.message : String(e)})` } as ActionResult;
        }
      }
      timings.execute = Math.round(performance.now() - t5);
      lastResult = { ok: execResult.ok, error_code: execResult.error_code === 'NONE' ? undefined : execResult.error_code, effect_observed: execResult.effect_observed };
      history.push(envelope);
      consecutiveFailures = execResult.ok ? 0 : consecutiveFailures + 1;

      const total = Math.round(performance.now() - t0);
      sendToPanel({ type: 'gw:trace', entry: { ...base, phase: execResult.ok ? 'ok' : 'error', result: execResult, timings: { ...timings, total }, errorCode: execResult.ok ? undefined : execResult.error_code, errorMessage: execResult.ok ? undefined : execResult.error_message } });
      await recordAudit({ session_id: sessionId, step, ts: Date.now(), action: action.type, provider: planned.provider, latency_ms: total, element_count: raw.elements.length, text_block_count: raw.text_nodes.length, handle_count: obs.handles?.length ?? 0, redaction_count: result.redactions.length, degraded: result.degraded, has_redacted_screenshot: !!screenshot, gate: 'accepted', validation: execResult.ok ? 'ok' : (execResult.error_code ?? 'error'), payload_bytes: payloadBytes, ...auditShape(obs, result.redactions, { ...timings, total: Math.round(performance.now() - t0) }) });
      void sendToTab(tabId, { type: 'gw:eval-hook', key: 'step', value: JSON.stringify({ step, action: action.type, ok: execResult.ok, total }) }, 1000).catch(() => undefined);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { finish('error', { message: `Stopped after ${MAX_CONSECUTIVE_FAILURES} failed actions (last: ${execResult.error_code})` }); return; }
      await new Promise(r => setTimeout(r, STEP_PAUSE_MS));
    }

    if (aborted) finish('aborted', { message: 'Aborted by user' });
    else finish('done', { outcome: 'blocked', message: 'Step budget exhausted' });
  } catch (error) {
    const code = error instanceof RunError ? error.code : 'AGENT_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    sendToPanel({ type: 'gw:error', code, message, step: state.step });
    finish('error', { message });
  }
}
