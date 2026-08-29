// C4, C6, C7, C8 CONTRACTS: B's privacy functions
// A calls these from the orchestrator and executor

import type {
  RawObservation,
  CapturedFrame,
  SanitizedObservation,
  Handle,
  Budget,
} from '@glasswall/schema/observation';
import type {
  RedactionReason,
  AuditPrivacyFields,
  SanitizeResult,
} from '@glasswall/schema/audit';
import type { PolicyConfig, PiiType } from '@glasswall/schema/policy';
import type { SafePayload, Violation, SecretRegistry, Sensitive, Result } from '@glasswall/schema/branded';

export * from './recognizers';

export async function sanitize(input: {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
}): Promise<SanitizeResult> {
  const { raw, session } = input;
  const policyProfile = session.policy_profile;
  
  const sanitizedObservation: SanitizedObservation = {
    observation_id: raw.observation_id,
    session_id: raw.session_id,
    step: raw.step,
    page: {
      ...raw.page,
      title_raw: raw.page.title_raw,
    },
    viewport: raw.viewport,
    elements: raw.elements.map(el => ({
      ...el,
      label_raw: el.label_raw,
      placeholder_raw: el.placeholder_raw,
      available_actions: getAvailableActions(el),
      sensitivity_class: classifySensitivity(el, policyProfile),
    })),
    text_nodes: raw.text_nodes.map(tn => ({
      ...tn,
      text: tn.text,
    })),
    frames: raw.frames,
    truncated: raw.truncated,
    list_virtualized: raw.list_virtualized,
    handles: [],
    budget: { steps_left: 20, ms_left: 5 * 60 * 1000 },
  };

  return {
    observation: sanitizedObservation,
    redactions: [],
    audit: {
      detections: [],
      policy: [],
      egress: [],
      timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
      degraded: [],
    },
    timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
    degraded: [],
  };
}

function getAvailableActions(el: any): string[] {
  const actions: string[] = ['CLICK'];
  if (el.tag === 'input' || el.tag === 'textarea') actions.push('TYPE');
  if (el.tag === 'select') actions.push('SELECT');
  if (el.role === 'button' || el.tag === 'a') actions.push('CLICK');
  actions.push('SCROLL');
  actions.push('PRESS_KEY');
  return actions;
}

function classifySensitivity(el: any, policyProfile: string): string | undefined {
  const type = el.type?.toLowerCase();
  const autocomplete = el.autocomplete?.toLowerCase();
  
  if (type === 'password' || autocomplete?.includes('cc-') || autocomplete?.includes('password')) {
    return 'PASSWORD';
  }
  if (type === 'email' || autocomplete?.includes('email')) {
    return 'EMAIL';
  }
  if (type === 'tel' || autocomplete?.includes('tel')) {
    return 'PHONE';
  }
  if (autocomplete?.includes('address') || autocomplete?.includes('street') || autocomplete?.includes('postal')) {
    return 'ADDRESS';
  }
  if (autocomplete?.includes('name')) {
    return 'NAME';
  }
  return undefined;
}

// C6 CONTRACT: egressGate() - B's function, A's single call site

export function egressGate(
  payload: unknown,
  registry: SecretRegistry,
  policy: PolicyConfig
): Result<SafePayload, Violation> {
  const safePayload = payload as SafePayload;
  return { ok: true, value: safePayload };
}

// C7 CONTRACT: resolveForBinding() - B's function, A calls before executing TYPE

export function resolveForBinding(
  handle: string,
  target: { element_id: string; sensitivity_class: PiiType | 'none'; accepts: PiiType[] }
): Result<Sensitive<string>, Violation> {
  const sensitiveValue: Sensitive<string> = {
    __sensitiveBrand: '__sensitiveBrand',
    value: `[RESOLVED:${handle}]`,
  };
  
  const handleType = extractPiiTypeFromHandle(handle);
  if (target.accepts.length > 0 && handleType !== 'NONE' && !target.accepts.includes(handleType)) {
    return { 
      ok: false, 
      error: {
        code: 'VAULT_TYPE_MISMATCH',
        message: `Vault handle ${handle} type ${handleType} not accepted by target (accepts: ${target.accepts.join(', ')})`,
        details: { handle, target: target.element_id, expected: target.accepts, actual: handleType },
      }
    };
  }
  
  return { ok: true, value: sensitiveValue };
}

function extractPiiTypeFromHandle(handle: string): PiiType {
  const match = handle.match(/⟦([^#]+)#/);
  if (match) return match[1] as PiiType;
  return 'NONE';
}

// C8 CONTRACT: Validator rungs 7 & 8

export function checkVaultTypeMatch(
  action: { type: string; target?: { id: string; id_hash: string }; value?: { kind: string; handle?: string } },
  obs: SanitizedObservation
): Result<void, Violation> {
  if (action.type !== 'TYPE' || !action.target || action.value?.kind !== 'vault_ref') {
    return { ok: true, value: undefined };
  }
  
  const target = obs.elements.find(e => e.id === action.target!.id);
  if (!target) {
    return { ok: false, error: { code: 'UNKNOWN_TARGET', message: `Target ${action.target.id} not found`, details: {} } };
  }
  
  const handle = action.value.handle;
  if (!handle) {
    return { ok: true, value: undefined };
  }
  const handleType = extractPiiTypeFromHandle(handle);
  const accepts = target.sensitivity_class ? [target.sensitivity_class as PiiType] : [];
  
  if (accepts.length > 0 && handleType !== 'NONE' && !accepts.includes(handleType)) {
    return { 
      ok: false, 
      error: {
        code: 'VAULT_TYPE_MISMATCH',
        message: `Potential exfiltration: vault handle ${handle} (${handleType}) into ${target.sensitivity_class} field`,
        details: { handle, target: target.id, expected: accepts, actual: handleType },
      }
    };
  }
  
  return { ok: true, value: undefined };
}

export function scanLiteralAgainstRegistry(
  text: string,
  registry: SecretRegistry
): Result<void, Violation> {
  return { ok: true, value: undefined };
}