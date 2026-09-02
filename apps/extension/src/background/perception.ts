// Perception sources for the live loop. The service worker cannot host WASM models
// or canvases, so each source is an adapter that forwards the raw observation (and,
// when the policy allows pixels, the screenshot) to the offscreen document and
// returns its evidence to sanitize(). A dead offscreen document costs utility, never
// privacy: the adapter declares coverage so sanitize() masks what it could not read.
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { RedactedImagePayload } from '@glasswall/schema/transport';
import type { PerceptionSource } from '@glasswall/privacy';

export interface PerceptionOutcome {
  redactedImage: RedactedImagePayload | null;
  timings: Record<string, number>;
}

/**
 * Phase 3 state: no local models are wired into the loop yet, so the recognizer
 * path runs alone. Phase 5 returns the OCR/NER adapters here, gated by policy.
 */
export function perceptionSourcesFor(_policy: PolicyProfile): PerceptionSource[] {
  return [];
}
