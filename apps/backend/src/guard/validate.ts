// Response guard: the model's output is untrusted. It must parse as an
// ActionEnvelope and refer only to the observation it was given.
import { ActionEnvelopeSchema, type ActionEnvelope } from '@glasswall/schema/action';
import type { SanitizedObservation } from '@glasswall/schema/observation';

export type GuardResult = { ok: true; value: ActionEnvelope } | { ok: false; error: string };

export function validateActionEnvelope(raw: unknown, observation: SanitizedObservation, expected: { sessionId: string; stepIndex: number }): GuardResult {
  // Models sometimes wrap the envelope or omit bookkeeping fields; normalize before parsing.
  const candidate = normalize(raw, observation, expected);
  const parsed = ActionEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const env = parsed.data;
  if (env.observation_id !== observation.observation_id) return { ok: false, error: `STALE_OBSERVATION: observation_id must be ${observation.observation_id}` };
  const action = env.action;
  if ('target' in action && action.target) {
    const el = observation.elements.find(e => e.id === action.target!.id);
    if (!el) return { ok: false, error: `UNKNOWN_TARGET: ${action.target.id} is not in the observation` };
    if (el.id_hash && action.target.id_hash !== el.id_hash) return { ok: false, error: `IDENTITY_MISMATCH: id_hash for ${action.target.id} must be ${el.id_hash}` };
    if (!el.visible) return { ok: false, error: `ELEMENT_NOT_VISIBLE: ${action.target.id} is not visible; scroll first` };
    if (el.available_actions?.length && !el.available_actions.includes(action.type) && action.type !== 'PRESS_KEY' && action.type !== 'SCROLL') {
      return { ok: false, error: `UNSUPPORTED_ACTION: ${action.target.id} supports ${el.available_actions.join('/')}, not ${action.type}` };
    }
  }
  if (action.type === 'TYPE' && action.value.kind === 'vault_ref') {
    const handle = action.value.handle;
    const known = observation.handles?.some(h => h.handle === handle);
    if (!known) return { ok: false, error: `UNKNOWN_HANDLE: ${handle} is not in the handle inventory` };
  }
  if (action.type === 'DONE' && action.evidence_element && !observation.elements.some(e => e.id === action.evidence_element)) {
    return { ok: false, error: `UNKNOWN_TARGET: evidence_element ${action.evidence_element} is not in the observation` };
  }
  return { ok: true, value: { ...env, session_id: expected.sessionId, step_index: expected.stepIndex } };
}

function normalize(raw: unknown, observation: SanitizedObservation, expected: { sessionId: string; stepIndex: number }): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let obj = raw as Record<string, unknown>;
  if ('action_envelope' in obj && typeof obj.action_envelope === 'object') obj = obj.action_envelope as Record<string, unknown>;
  if (!('action' in obj) && 'type' in obj) obj = { action: obj };
  const action = obj.action as Record<string, unknown> | undefined;
  if (action && typeof action.target === 'string') {
    const el = observation.elements.find(e => e.id === action.target);
    action.target = el ? { id: el.id, id_hash: el.id_hash } : { id: action.target, id_hash: '' };
  }
  if (action?.target && typeof action.target === 'object' && !(action.target as Record<string, unknown>).id_hash) {
    const t = action.target as Record<string, unknown>;
    const el = observation.elements.find(e => e.id === t.id);
    if (el) t.id_hash = el.id_hash;
  }
  return {
    ...obj,
    observation_id: obj.observation_id ?? observation.observation_id,
    session_id: expected.sessionId,
    step_index: expected.stepIndex,
    risk: obj.risk ?? 'low',
    requires_confirmation: obj.requires_confirmation ?? false,
  };
}
