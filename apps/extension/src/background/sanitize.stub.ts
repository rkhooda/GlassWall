// DELETE ON PROMPT 22 - B INTEGRATION

import { type RawObservation, type CapturedFrame, type SanitizedObservation } from '@glasswall/schema/observation';
import { type AuditPrivacyFields } from '@glasswall/schema/audit';

interface SanitizeResult {
  observation: SanitizedObservation;
  redactions: Array<{ rect: [number, number, number, number]; reason: string; source: string; score: number }>;
  audit: AuditPrivacyFields;
  timings: { rules: number; ner: number; ocr: number; vision: number; fuse: number; build: number };
  degraded: string[];
}

/**
 * STUB: Identity passthrough sanitize function
 * Maps RawObservation straight to SanitizedObservation with no redaction
 * Returns degraded: ['stub']
 * Logs "UNSAFE MODE - sanitization not yet enabled" once at startup
 */
export async function sanitize(input: {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
}): Promise<SanitizeResult> {
  // Log warning only once per session
  // @ts-ignore - globalThis is available in service worker context
  if (!self.__GLASSWALL_UNSAFE_MODE_LOGGED) {
    console.warn('UNSAFE MODE - sanitization not yet enabled');
    // @ts-ignore - globalThis is available in service worker context
    self.__GLASSWALL_UNSAFE_MODE_LOGGED = true;
  }

  // Identity projection: raw observation becomes sanitized observation
  // This is safe for stub because we're not actually sending data anywhere yet
  const observation = input.raw as unknown as SanitizedObservation;

  return {
    observation,
    redactions: [],
    audit: {
      detections: [],
      policy: [],
      egress: [],
      timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
      degraded: ['stub']
    },
    timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
    degraded: ['stub']
  };
}