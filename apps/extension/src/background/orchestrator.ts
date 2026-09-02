// The run: observe → sanitize → gate → reason → validate → confirm → execute → verify.
//
// Phase 1 state: observe and sanitize locally and report to the panel. The gateway
// round-trip, vault binding and execution are wired in Phases 2–3.
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { RawObservation } from '@glasswall/schema/observation';
import { sanitize, PROFILES } from '@glasswall/privacy';
import { sendToPanel, sendToTab, type RunState, type TraceEntry, type AuditEntry, type HealthInfo } from '../shared/messages';
import { GATEWAY_ORIGIN, DEFAULT_STEP_BUDGET } from '../shared/config';

let state: RunState = { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: DEFAULT_STEP_BUDGET, provider: null };
let aborted = false;
let pendingConfirm: ((approved: boolean) => void) | null = null;
const audit: AuditEntry[] = [];

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

export async function getHealth(): Promise<HealthInfo> {
  // Phase 3 replaces this with a gated /v1/health call through net.ts.
  return { gateway: 'unreachable', providers: [], active: null };
}

export function abortRun(): void {
  aborted = true;
  pendingConfirm?.(false);
  if (state.status === 'running' || state.status === 'waiting_confirmation') setState({ status: 'aborted', message: 'Aborted by user' });
}

export function respondConfirmation(approved: boolean): void {
  pendingConfirm?.(approved);
  pendingConfirm = null;
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
  if (!pick?.id) throw new Error('GLASSWALL works on http(s) pages only; open a web page first');
  return pick.id;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: 'gw:ping' }, 1500);
  } catch {
    // The page was open before the extension loaded: inject the content script now.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/index.ts'] });
    await sendToTab(tabId, { type: 'gw:ping' }, 3000);
  }
}

export async function startRun(task: string, policy: PolicyProfile, tabIdHint?: number): Promise<void> {
  if (state.status === 'running') throw new Error('A run is already in progress');
  aborted = false;
  const sessionId = crypto.randomUUID();
  setState({ status: 'running', sessionId, task, policy, step: 0, stepsLeft: DEFAULT_STEP_BUDGET, provider: null, outcome: undefined, message: undefined });

  try {
    const tabId = await targetTabId(tabIdHint);
    await ensureContentScript(tabId);
    const t0 = performance.now();
    const reply = await sendToTab(tabId, { type: 'gw:observe', observationId: `obs_${sessionId.slice(0, 8)}_0`, sessionId, step: 0 });
    if (reply.type !== 'gw:observation') throw new Error('unexpected reply to observe');
    const raw: RawObservation = reply.observation;
    const tObserve = performance.now() - t0;

    const t1 = performance.now();
    const result = await sanitize({ raw, frame: null, task, step: 0, session: { session_id: sessionId, policy_profile: policy }, profile: PROFILES[policy] });
    const tSanitize = performance.now() - t1;
    if (aborted) return;

    await sendToTab(tabId, { type: 'gw:overlay', observation: result.observation as never, redactions: result.redactions });
    sendToPanel({
      type: 'gw:inspect',
      inspect: { step: 0, raw, payload: result.observation as never, redactions: result.redactions, degraded: result.degraded, handlesCount: (result.observation as { handles?: unknown[] }).handles?.length ?? 0, screenshotAttached: false },
    });
    const entry: TraceEntry = {
      step: 0,
      phase: 'ok',
      timings: { observe: Math.round(tObserve), sanitize: Math.round(tSanitize), total: Math.round(performance.now() - t0) },
      redactions: result.redactions.length,
      degraded: result.degraded,
      observedElements: raw.elements.length,
      at: Date.now(),
    };
    sendToPanel({ type: 'gw:trace', entry });
    setState({ status: 'done', outcome: 'blocked', message: `Observed ${raw.elements.length} elements, ${result.redactions.length} redactions. Reasoning loop lands in Phase 3.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendToPanel({ type: 'gw:error', code: 'AGENT_ERROR', message, step: state.step });
    setState({ status: 'error', message });
  }
}

export const gatewayOrigin = GATEWAY_ORIGIN;
