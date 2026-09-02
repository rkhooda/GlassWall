// Contract between the service worker and the offscreen document.
import type { RawObservation } from '@glasswall/schema/observation';
import type { PolicyProfile } from '@glasswall/schema/policy';

export interface PerceiveRequest {
  type: 'gw:perceive';
  target: 'offscreen';
  raw: RawObservation;
  /** PNG data URL from captureVisibleTab, or null when the policy disables pixels. */
  frameDataUrl: string | null;
  policyProfile: PolicyProfile;
  screenshotEnabled: boolean;
  sources: Array<'ocr' | 'ner'>;
}

export interface PerceiveEvidence {
  sourceId: string;
  type: 'ner' | 'ocr' | 'vision';
  piiType: string;
  confidence: number;
  rect?: [number, number, number, number];
  textSpan?: string;
  elementId?: string;
}

export interface PerceiveSourceOutput {
  id: 'ocr' | 'ner';
  evidence: PerceiveEvidence[];
  degraded: string[];
  unexplained: Array<{ rect: [number, number, number, number]; reason: string }>;
  ms: number;
}

export type PerceiveResponse =
  | {
      ok: true;
      sources: PerceiveSourceOutput[];
      /** Pixel-redacted PNG (base64, no data: prefix) when a frame was given and redaction ran. */
      redactedImage: { base64: string; width: number; height: number } | null;
      timings: Record<string, number>;
    }
  | { ok: false; error: string };
