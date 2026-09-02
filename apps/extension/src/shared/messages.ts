// Every message that crosses an extension boundary, in one place.
//
// Channels:
//   panel  → worker : chrome.runtime.sendMessage   (PanelToWorker)
//   worker → panel  : chrome.runtime.sendMessage   (WorkerToPanel)
//   worker → tab    : chrome.tabs.sendMessage      (WorkerToContent → ContentReply)
//   worker → offscreen: chrome.runtime.sendMessage with target 'offscreen'
//
// Raw observations travel worker ↔ content and worker ↔ panel only. They never
// reach net.ts, which accepts a SafePayload and nothing else.
import type { Action, ActionResult } from '@glasswall/schema/action';
import type { RawObservation, SanitizedObservation } from '@glasswall/schema/observation';
import type { RedactionReason } from '@glasswall/schema/audit';
import type { PolicyProfile } from '@glasswall/schema/policy';

export type StepPhase = 'observe' | 'perceive' | 'sanitize' | 'gate' | 'reason' | 'validate' | 'confirm' | 'execute' | 'verify';

export interface TraceEntry {
  step: number;
  phase: 'done' | 'error' | 'blocked' | 'ok';
  action?: Action;
  targetLabel?: string;
  result?: ActionResult;
  provider?: string;
  timings: Partial<Record<StepPhase, number>> & { total: number };
  redactions: number;
  degraded: string[];
  observedElements: number;
  errorCode?: string;
  errorMessage?: string;
  at: number;
}

export interface ConfirmContext {
  actionType: string;
  targetLabel: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  vaultRef?: string;
  destination?: string;
}

export interface RunState {
  status: 'idle' | 'running' | 'waiting_confirmation' | 'done' | 'error' | 'aborted';
  sessionId: string | null;
  task: string;
  policy: PolicyProfile;
  step: number;
  stepsLeft: number;
  provider: string | null;
  outcome?: 'success' | 'blocked' | 'impossible';
  message?: string;
}

export interface InspectPayload {
  step: number;
  raw: RawObservation;
  payload: SanitizedObservation;
  redactions: RedactionReason[];
  degraded: string[];
  handlesCount: number;
  screenshotAttached: boolean;
}

export interface AuditEntry {
  session_id: string;
  step: number;
  ts: number;
  action: string;
  provider: string | null;
  latency_ms: number;
  element_count: number;
  text_block_count: number;
  handle_count: number;
  redaction_count: number;
  degraded: string[];
  has_redacted_screenshot: boolean;
  gate: 'accepted' | 'rejected';
  validation: string;
  payload_bytes: number;
}

export type PanelToWorker =
  | { type: 'gw:start'; task: string; policy: PolicyProfile }
  | { type: 'gw:abort' }
  | { type: 'gw:confirm-response'; approved: boolean }
  | { type: 'gw:get-state' }
  | { type: 'gw:get-audit' }
  | { type: 'gw:get-health' };

export type WorkerToPanel =
  | { type: 'gw:state'; state: RunState }
  | { type: 'gw:trace'; entry: TraceEntry }
  | { type: 'gw:confirm-request'; context: ConfirmContext }
  | { type: 'gw:inspect'; inspect: InspectPayload }
  | { type: 'gw:error'; code: string; message: string; step: number };

export type WorkerToContent =
  | { type: 'gw:ping' }
  | { type: 'gw:observe'; observationId: string; sessionId: string; step: number }
  | { type: 'gw:execute'; action: Action; observation: SanitizedObservation }
  | { type: 'gw:overlay'; observation: SanitizedObservation; redactions: RedactionReason[] }
  | { type: 'gw:overlay-clear' }
  | { type: 'gw:eval-hook'; key: 'ready' | 'step' | 'done'; value: string };

export type ContentReply =
  | { type: 'gw:pong' }
  | { type: 'gw:observation'; observation: RawObservation }
  | { type: 'gw:action-result'; result: ActionResult }
  | { type: 'gw:ok' }
  | { type: 'gw:content-error'; message: string };

export interface HealthInfo {
  gateway: 'ok' | 'unreachable';
  providers: string[];
  active: string | null;
  capability?: { webgpu: boolean; wasm: boolean };
  modelsLoadedBytes?: number;
}

export type AnyMessage = PanelToWorker | WorkerToPanel | WorkerToContent | ContentReply;

export function isMessage<T extends { type: string }>(value: unknown, ...types: T['type'][]): value is T {
  return typeof value === 'object' && value !== null && 'type' in value && types.includes((value as { type: string }).type as T['type']);
}

/** Fire-and-forget to extension pages (panel). A closed panel is not an error. */
export function sendToPanel(message: WorkerToPanel): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/** Request/response to the content script of a tab. Throws if no content script answers. */
export async function sendToTab(tabId: number, message: WorkerToContent, timeoutMs = 30_000): Promise<ContentReply> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`content script timeout (${message.type})`)), timeoutMs));
  const reply = (await Promise.race([chrome.tabs.sendMessage(tabId, message), timeout])) as ContentReply | undefined;
  if (!reply) throw new Error(`no reply from content script (${message.type})`);
  if (reply.type === 'gw:content-error') throw new Error(reply.message);
  return reply;
}
