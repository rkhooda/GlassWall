// Contract between the service worker and the offscreen document.
//
// Per step: `gw:perceive` (raw observation + optional PNG frame → evidence from the
// local models), then, after sanitize() has fused the regions, `gw:redact` (rects →
// pixel-redacted PNG). The offscreen document keeps the frame between the two calls
// and drops it afterwards. Nothing here touches the network.
import type { RawObservation } from '@glasswall/schema/observation';
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { RedactedImagePayload } from '@glasswall/schema/transport';

export type SourceId = 'ocr' | 'ner';

export interface PerceiveRequest {
  type: 'gw:perceive';
  target: 'offscreen';
  observationId: string;
  raw: RawObservation;
  /** PNG data URL from captureVisibleTab, or null when the policy disables pixels. */
  frameDataUrl: string | null;
  viewport: { w: number; h: number; dpr: number };
  policyProfile: PolicyProfile;
  screenshotEnabled: boolean;
  sources: SourceId[];
}

export interface PerceiveEvidence {
  sourceId: string;
  type: 'ner' | 'ocr' | 'vision';
  piiType: string;
  confidence: number;
  rect?: [number, number, number, number];
  /** Raw matched text. Local: it travels offscreen → worker only, and the worker tokenizes it. */
  textSpan?: string;
  elementId?: string;
}

export interface PerceiveSourceOutput {
  id: SourceId;
  evidence: PerceiveEvidence[];
  degraded: string[];
  unexplained: { rect: [number, number, number, number]; reason: string }[];
  ms: number;
  /** The source threw or hung; the worker applies its declared coverage. */
  failed?: boolean;
}

export type PerceiveResponse =
  | { ok: true; sources: PerceiveSourceOutput[]; timings: Record<string, number>; frameHeld: boolean }
  | { ok: false; error: string };

export interface RedactRequest {
  type: 'gw:redact';
  target: 'offscreen';
  observationId: string;
  /** Regions to black out, in viewport CSS pixels. */
  rects: { rect: [number, number, number, number]; reason: string; source: string }[];
}

export type RedactResponse = { ok: true; image: RedactedImagePayload; ms: number } | { ok: false; error: string };

export interface WarmupRequest {
  type: 'gw:warmup';
  target: 'offscreen';
  screenshotEnabled: boolean;
}

export interface WarmupResponse {
  ok: boolean;
  report?: { ner: { ran: boolean; ms: number; reason?: string }; ocr: { ran: boolean; ms: number; reason?: string }; totalMs: number };
  capability?: { webgpu: boolean; wasm: boolean; wasmSimd: boolean; deviceMemory?: number };
  error?: string;
}

export interface StatsRequest {
  type: 'gw:stats';
  target: 'offscreen';
}

export interface StatsResponse {
  capability: { webgpu: boolean; wasm: boolean; wasmSimd: boolean; deviceMemory?: number } | null;
  warm: { ner: boolean; ocr: boolean };
  heapMb?: number;
}

export type OffscreenRequest = PerceiveRequest | RedactRequest | WarmupRequest | StatsRequest;
