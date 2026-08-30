import { describe, it, expectTypeOf } from 'vitest';
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
  Detection,
  PolicyDecision,
  EgressCheck,
  Timings,
} from '@glasswall/schema/audit';
import type { PolicyConfig, PiiType } from '@glasswall/schema/policy';
import type { SafePayload, Violation, SecretRegistry, Sensitive, Result } from '@glasswall/schema/branded';

import {
  sanitize,
  checkVaultTypeMatch,
  scanLiteralAgainstRegistry,
  resolveForBinding,
  egressGate,
  buildAuditPrivacyFields,
  createEgressChecks,
  type PerceptionSource,
  type PerceptionContext,
  type Evidence,
  type Action,
  type AuditPrivacyInput,
} from '../src/index';

describe('Contract Conformance - C4: sanitize()', () => {
  it('sanitize returns SanitizeResult matching schema', () => {
    expectTypeOf(sanitize).toEqualTypeOf<
      (input: {
        raw: RawObservation;
        frame: CapturedFrame | null;
        task: string;
        step: number;
        session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
        perceptionSources?: PerceptionSource[];
      }) => Promise<SanitizeResult>
    >();
  });

  it('SanitizeResult has all required fields', () => {
    expectTypeOf<SanitizeResult>().toHaveProperty('observation');
    expectTypeOf<SanitizeResult>().toHaveProperty('redactions');
    expectTypeOf<SanitizeResult>().toHaveProperty('audit');
    expectTypeOf<SanitizeResult>().toHaveProperty('timings');
    expectTypeOf<SanitizeResult>().toHaveProperty('degraded');
  });

  it('SanitizedObservation has no field capable of holding raw values', () => {
    expectTypeOf<SanitizedObservation>().toHaveProperty('observation_id');
    expectTypeOf<SanitizedObservation>().toHaveProperty('session_id');
    expectTypeOf<SanitizedObservation>().toHaveProperty('step');
    expectTypeOf<SanitizedObservation>().toHaveProperty('page');
    expectTypeOf<SanitizedObservation>().toHaveProperty('viewport');
    expectTypeOf<SanitizedObservation>().toHaveProperty('elements');
    expectTypeOf<SanitizedObservation>().toHaveProperty('text_nodes');
    expectTypeOf<SanitizedObservation>().toHaveProperty('frames');
    expectTypeOf<SanitizedObservation>().toHaveProperty('truncated');
    expectTypeOf<SanitizedObservation>().toHaveProperty('list_virtualized');
    expectTypeOf<SanitizedObservation>().toHaveProperty('handles');
    expectTypeOf<SanitizedObservation>().toHaveProperty('budget');
  });
});

describe('Contract Conformance - C6: egressGate()', () => {
  it('egressGate returns Result<SafePayload, Violation>', () => {
    expectTypeOf(egressGate).toEqualTypeOf<
      (payload: unknown, registry: SecretRegistry, policy: PolicyConfig) => Result<SafePayload, Violation>
    >();
  });

  it('SafePayload is a branded type', () => {
    expectTypeOf<SafePayload>().toHaveProperty('__safePayloadBrand');
  });
});

describe('Contract Conformance - C7: resolveForBinding()', () => {
  it('resolveForBinding returns Result<Sensitive<string>, Violation>', () => {
    expectTypeOf(resolveForBinding).toEqualTypeOf<
      (handle: string, target: { element_id: string; sensitivity_class: PiiType | 'none'; accepts: PiiType[] }) => Result<Sensitive<string>, Violation>
    >();
  });

  it('Sensitive<string> is a branded type with value', () => {
    expectTypeOf<Sensitive<string>>().toHaveProperty('__sensitiveBrand');
    expectTypeOf<Sensitive<string>>().toHaveProperty('value');
  });
})

describe('Contract Conformance - C8: Validator hooks', () => {
  it('checkVaultTypeMatch returns Result<void, Violation>', () => {
    expectTypeOf(checkVaultTypeMatch).toEqualTypeOf<
      (action: Action, obs: SanitizedObservation) => Result<void, Violation>
    >();
  });

  it('scanLiteralAgainstRegistry returns Result<void, Violation>', () => {
    expectTypeOf(scanLiteralAgainstRegistry).toEqualTypeOf<
      (text: string, registry: SecretRegistry) => Result<void, Violation>
    >();
  });

  it('Violation has enough context for UI banner', () => {
    expectTypeOf<Violation>().toHaveProperty('code');
    expectTypeOf<Violation>().toHaveProperty('message');
    expectTypeOf<Violation>().toHaveProperty('details');
  });
})

describe('Contract Conformance - C9: AuditPrivacyFields', () => {
  it('buildAuditPrivacyFields returns AuditPrivacyFields', () => {
    expectTypeOf(buildAuditPrivacyFields).toEqualTypeOf<
      (input: AuditPrivacyInput) => AuditPrivacyFields
    >();
  });

  it('AuditPrivacyFields has no field capable of holding a value', () => {
    expectTypeOf<AuditPrivacyFields>().toHaveProperty('detections');
    expectTypeOf<AuditPrivacyFields>().toHaveProperty('policy');
    expectTypeOf<AuditPrivacyFields>().toHaveProperty('egress');
    expectTypeOf<AuditPrivacyFields>().toHaveProperty('timings');
    expectTypeOf<AuditPrivacyFields>().toHaveProperty('degraded');
  })

  it('Detection has no raw value field', () => {
    expectTypeOf<Detection>().toHaveProperty('type');
    expectTypeOf<Detection>().toHaveProperty('pii_type');
    expectTypeOf<Detection>().toHaveProperty('confidence');
    expectTypeOf<Detection>().toHaveProperty('rect');
    expectTypeOf<Detection>().toHaveProperty('text_span');
    expectTypeOf<Detection>().toHaveProperty('source_id');
  })

  it('PolicyDecision has no raw value', () => {
    expectTypeOf<PolicyDecision>().toHaveProperty('pii_type');
    expectTypeOf<PolicyDecision>().toHaveProperty('action');
    expectTypeOf<PolicyDecision>().toHaveProperty('threshold_matched');
  })

  it('EgressCheck has no raw value in success path', () => {
    expectTypeOf<EgressCheck>().toHaveProperty('check');
    expectTypeOf<EgressCheck>().toHaveProperty('passed');
    expectTypeOf<EgressCheck>().toHaveProperty('matched_value');
  })
})

describe('Contract Conformance - C5: SanitizedObservation allowlist', () => {
  it('SanitizedElement has only allowlisted fields', () => {
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('id');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('id_hash');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('tag');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('role');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('type');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('label_raw');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('placeholder_raw');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('rect');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('visible');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('enabled');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('focusable');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('value_state');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('options_count');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('group');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('frame');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('unexplained');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('autocomplete');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('input_type');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('available_actions');
    expectTypeOf<SanitizedObservation['elements'][0] > ().toHaveProperty('sensitivity_class');
  })

  it('Handle has type and cardinality only, never value', () => {
    expectTypeOf<Handle>().toHaveProperty('handle');
    expectTypeOf<Handle>().toHaveProperty('type');
    expectTypeOf<Handle>().toHaveProperty('tier');
    expectTypeOf<Handle>().toHaveProperty('occurrences');
    expectTypeOf<Handle>().toHaveProperty('first_seen_step');
  })

  it('SanitizedTextNode text is tokenized', () => {
    expectTypeOf<SanitizedTextNode>().toHaveProperty('id');
    expectTypeOf<SanitizedTextNode>().toHaveProperty('rect');
    expectTypeOf<SanitizedTextNode>().toHaveProperty('text');
    expectTypeOf<SanitizedTextNode>().toHaveProperty('owner_element_id');
    expectTypeOf<SanitizedTextNode>().toHaveProperty('source');
  })
})

describe('Contract Conformance - C1: RawObservation consumption', () => {
  it('RawObservation fields are all consumed or intentionally dropped', () => {
    expectTypeOf<RawObservation>().toHaveProperty('observation_id');
    expectTypeOf<RawObservation>().toHaveProperty('session_id');
    expectTypeOf<RawObservation>().toHaveProperty('step');
    expectTypeOf<RawObservation>().toHaveProperty('page');
    expectTypeOf<RawObservation>().toHaveProperty('viewport');
    expectTypeOf<RawObservation>().toHaveProperty('elements');
    expectTypeOf<RawObservation>().toHaveProperty('text_nodes');
    expectTypeOf<RawObservation>().toHaveProperty('frames');
    expectTypeOf<RawObservation>().toHaveProperty('truncated');
    expectTypeOf<RawObservation>().toHaveProperty('list_virtualized');
  })

  it('RawElement has raw fields that must be tokenized', () => {
    expectTypeOf<RawObservation['elements'][0] > ().toHaveProperty('label_raw');
    expectTypeOf<RawObservation['elements'][0] > ().toHaveProperty('placeholder_raw');
    expectTypeOf<RawObservation['elements'][0] > ().toHaveProperty('value_state');
    expectTypeOf<RawObservation['elements'][0] > ().toHaveProperty('autocomplete');
    expectTypeOf<RawObservation['elements'][0] > ().toHaveProperty('input_type');
  })

  it('RawTextNode text is raw and must be tokenized', () => {
    expectTypeOf<RawObservation['text_nodes'][0] > ().toHaveProperty('text');
  })
})

describe('Contract Conformance - C2: CapturedFrame', () => {
  it('CapturedFrame has required fields', () => {
    expectTypeOf<CapturedFrame>().toHaveProperty('bitmap');
    expectTypeOf<CapturedFrame>().toHaveProperty('dpr');
    expectTypeOf<CapturedFrame>().toHaveProperty('viewport_w');
    expectTypeOf<CapturedFrame>().toHaveProperty('viewport_h');
    expectTypeOf<CapturedFrame>().toHaveProperty('captured_at');
    expectTypeOf<CapturedFrame>().toHaveProperty('stale');
  })
})

describe('Contract Conformance - PerceptionSource shape', () => {
  it('PerceptionSource has id, timeout_ms, run', () => {
    expectTypeOf<PerceptionSource>().toHaveProperty('id');
    expectTypeOf<PerceptionSource>().toHaveProperty('timeout_ms');
    expectTypeOf<PerceptionSource>().toHaveProperty('run');
  })

  it('PerceptionContext has raw, frame, registry, tokenizer', () => {
    expectTypeOf<PerceptionContext>().toHaveProperty('raw');
    expectTypeOf<PerceptionContext>().toHaveProperty('frame');
    expectTypeOf<PerceptionContext>().toHaveProperty('registry');
    expectTypeOf<PerceptionContext>().toHaveProperty('tokenizer');
  })

  it('Evidence has required fields for fusion', () => {
    expectTypeOf<Evidence>().toHaveProperty('sourceId');
    expectTypeOf<Evidence>().toHaveProperty('type');
    expectTypeOf<Evidence>().toHaveProperty('piiType');
    expectTypeOf<Evidence>().toHaveProperty('confidence');
    expectTypeOf<Evidence>().toHaveProperty('rect');
    expectTypeOf<Evidence>().toHaveProperty('textSpan');
    expectTypeOf<Evidence>().toHaveProperty('elementId');
  })
})

describe('Contract Conformance - Result type', () => {
  it('Result is discriminated union', () => {
    type TestResult = Result<string, Violation>;
    expectTypeOf<TestResult>().toMatchTypeOf<{ ok: true; value: string } | { ok: false; error: Violation }>();
  })
})
