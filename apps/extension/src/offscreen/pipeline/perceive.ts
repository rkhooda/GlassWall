// Local vision in the offscreen document.
//
// perceive(): decode the frame once, run the requested local sources (OCR on
// unexplained regions, NER on free text) and return their evidence. A source that
// throws or hangs is reported as failed; the worker then applies its declared
// coverage so the regions are masked (fail-closed).
//
// redactFrame(): after the worker has fused regions, black them out on the held
// frame and return the only image bytes that may leave the device.
import type { CapturedFrame } from '@glasswall/schema/observation';
import type { RedactedImagePayload } from '@glasswall/schema/transport';
import type { PerceptionContext, PerceptionSource, SourceOutput } from '@glasswall/privacy';
import { createTokenizer } from '@glasswall/privacy';
import { probeCapabilities, warmUpInference } from '@glasswall/inference';
import type { PerceiveRequest, PerceiveResponse, PerceiveSourceOutput, RedactRequest, RedactResponse, WarmupRequest, WarmupResponse, StatsResponse, SourceId } from '../../shared/perceive';
import { ocrSource } from './ocr';
import { nerSource } from './ner';
import { decodeBitmap } from './image/decode';
import { downscaleFrame } from './image/downscale';
import { redact, type RedactionRect } from './image/redact';

const SOURCES: Record<SourceId, PerceptionSource> = { ocr: ocrSource, ner: nerSource };

/** The frame for the current step, dropped after redaction or replaced by the next step. */
let held: { observationId: string; frame: CapturedFrame } | null = null;
let capability: StatsResponse['capability'] = null;
const warm = { ner: false, ocr: false };

async function decodeFrame(dataUrl: string, viewport: PerceiveRequest['viewport']): Promise<CapturedFrame> {
  const blob = await (await fetchDataUrl(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, dpr: viewport.dpr, viewport_w: viewport.w, viewport_h: viewport.h, captured_at: Date.now(), stale: false };
}

/** Decode a data: URL without the network: the bytes are already in the string. */
async function fetchDataUrl(dataUrl: string): Promise<{ blob: () => Promise<Blob> }> {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: async () => new Blob([bytes], { type: mime }) };
}

function dropHeldFrame(): void {
  if (held) {
    try {
      (held.frame.bitmap as ImageBitmap).close();
    } catch {
      /* already closed */
    }
    held = null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function perceive(request: PerceiveRequest): Promise<PerceiveResponse> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  dropHeldFrame();

  let frame: CapturedFrame | null = null;
  if (request.frameDataUrl && request.screenshotEnabled) {
    const t = performance.now();
    try {
      frame = await decodeFrame(request.frameDataUrl, request.viewport);
      held = { observationId: request.observationId, frame };
    } catch {
      frame = null;
    }
    timings.decode = performance.now() - t;
  }

  const ctx: PerceptionContext = {
    raw: request.raw,
    frame,
    registry: new Map(),
    tokenizer: createTokenizer(request.observationId),
    policyProfile: request.policyProfile,
    screenshotEnabled: request.screenshotEnabled,
  };

  const sources: PerceiveSourceOutput[] = [];
  for (const id of request.sources) {
    const source = SOURCES[id];
    const t = performance.now();
    try {
      const out: SourceOutput = await withTimeout(source.run(ctx), source.timeout_ms, id);
      sources.push({ id, evidence: out.evidence.map(e => ({ ...e, type: e.type as 'ner' | 'ocr' | 'vision' })), degraded: out.degraded ?? [], unexplained: out.unexplained ?? [], ms: performance.now() - t });
      if (id === 'ner' && !(out.degraded ?? []).some(d => d.includes('unavailable'))) warm.ner = true;
      if (id === 'ocr' && !(out.degraded ?? []).some(d => d.includes('unavailable'))) warm.ocr = true;
    } catch (e) {
      sources.push({ id, evidence: [], degraded: [`${id}_${e instanceof Error && /timeout/.test(e.message) ? 'timeout' : 'error'}`], unexplained: [], ms: performance.now() - t, failed: true });
    }
    timings[id] = performance.now() - t;
  }
  timings.total = performance.now() - started;
  return { ok: true, sources, timings, frameHeld: held !== null };
}

export async function redactFrame(request: RedactRequest): Promise<RedactResponse> {
  const started = performance.now();
  if (!held || held.observationId !== request.observationId) return { ok: false, error: 'no frame held for this observation' };
  const { frame } = held;
  held = null; // decodeBitmap() closes the bitmap; nothing else may touch it afterwards
  try {
    const decoded = decodeBitmap(frame.bitmap as ImageBitmap);
    const downscaled = downscaleFrame(decoded);
    // Viewport CSS px → physical px (× dpr) → downscaled canvas px (× s).
    const k = frame.dpr * downscaled.scaleFactor;
    const rects: RedactionRect[] = request.rects.map(r => ({
      x: r.rect[0] * k,
      y: r.rect[1] * k,
      width: r.rect[2] * k,
      height: r.rect[3] * k,
      reason: r.reason,
      source: (['ocr', 'vision', 'ner', 'deterministic', 'unexplained', 'manual'].includes(r.source) ? r.source : 'unexplained') as RedactionRect['source'],
    }));
    const image = await redact(downscaled.canvas, rects);
    const payload: RedactedImagePayload = {
      __redactedImageBrand: '__redactedImageBrand',
      mime: 'image/png',
      data_base64: bytesToBase64(image.data),
      width: image.width,
      height: image.height,
      redaction_count: rects.length,
    };
    return { ok: true, image: payload, ms: performance.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export async function warmup(request: WarmupRequest): Promise<WarmupResponse> {
  try {
    if (!capability) {
      const snap = await probeCapabilities();
      capability = { webgpu: snap.webgpu, wasm: snap.wasmSimd || snap.wasmThreads || typeof WebAssembly !== 'undefined', wasmSimd: snap.wasmSimd, deviceMemory: snap.deviceMemory };
    }
    const report = await warmUpInference({ screenshot: { enabled: request.screenshotEnabled } }, 'wasm');
    warm.ner = warm.ner || report.ner.ran;
    warm.ocr = warm.ocr || report.ocr.ran;
    return { ok: true, report, capability };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), capability: capability ?? undefined };
  }
}

export async function stats(): Promise<StatsResponse> {
  if (!capability) {
    try {
      const snap = await probeCapabilities();
      capability = { webgpu: snap.webgpu, wasm: snap.wasmSimd || snap.wasmThreads || typeof WebAssembly !== 'undefined', wasmSimd: snap.wasmSimd, deviceMemory: snap.deviceMemory };
    } catch {
      capability = null;
    }
  }
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return { capability, warm: { ...warm }, heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined };
}
