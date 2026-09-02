// What every reasoner looks like to the gateway. The gateway never sees a value:
// its input is a sanitized observation and its output is one action.
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { ActionEnvelope } from '@glasswall/schema/action';
import type { PolicyConfig } from '@glasswall/schema/policy';
import type { RedactedImagePayload } from '@glasswall/schema/transport';

export interface PlanInput {
  sessionId: string;
  stepIndex: number;
  task: string;
  observation: SanitizedObservation;
  history: ActionEnvelope[];
  lastResult?: { ok: boolean; error_code?: string; effect_observed: boolean };
  screenshot?: RedactedImagePayload;
  policy: PolicyConfig;
  /** Set on the retry after a validation failure: the model is told what was wrong. */
  repairError?: string;
}

export interface Provider {
  readonly name: string;
  /** Whether the provider can ingest the redacted screenshot. */
  readonly vision: boolean;
  /** Cheap and cached: is this provider configured and reachable right now? */
  available(): Promise<{ ok: boolean; detail?: string }>;
  /** Returns the raw envelope; the guard validates it. Throws on transport or parse failure. */
  plan(input: PlanInput): Promise<unknown>;
}
