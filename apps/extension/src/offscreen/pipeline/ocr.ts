import type { CapturedFrame } from '@glasswall/schema/observation';
import type { Evidence, PerceptionContext, PerceptionSource, SourceOutput } from '@glasswall/privacy';
import { recognizeText, recognizeByContext } from '@glasswall/privacy';
import { isNerAvailable, runNer, nerTypeToPii } from '@glasswall/inference/ner';
import {
  MAX_CROPS_PER_STEP,
  NO_UNEXPLAINED_CROPS,
  cropGeometry,
  findUnexplainedRegions,
  initOcrWorker,
  runOcrOnCrops,
  selectCrops,
  type CropGeometry,
  type UnexplainedRegion,
} from '@glasswall/inference/ocr';

/**
 * P9 — targeted OCR as a perception source.
 *
 * Never full-page: it runs only on regions the DOM cannot explain, at most
 * MAX_CROPS_PER_STEP of them. Everything it does not read — over budget,
 * timed out, or unreadable because the worker would not start — is reported
 * as unexplained so it gets masked.
 *
 * Raw OCR text stays local. It is carried on Evidence.textSpan, which sanitize()
 * tokenizes into the session registry; only the handle reaches the observation.
 */

const TIMEOUT_MS = 8000;
/** Leaves headroom inside the source timeout so we can report what we missed. */
const RECOGNITION_BUDGET_MS = 6000;

export const OCR_UNAVAILABLE = 'ocr_unavailable';
export const OCR_TIMEOUT = 'ocr_timeout';
export const SCREENSHOT_DISABLED = 'screenshot_disabled';

let workerFailed = false;
/** Why the worker refused to start, for the trace. Names a class of failure, never page content. */
let workerError: string | null = null;
const stats = { runs: 0, skipped: 0, lastSkipReason: null as string | null };
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, '_').slice(0, 100);

/** Skip rate for the D6 headline claim: OCR does nothing on most steps. */
export function getOcrStats(): { runs: number; skipped: number; skipRate: number; lastSkipReason: string | null } {
  return { ...stats, skipRate: stats.runs === 0 ? 0 : stats.skipped / stats.runs };
}

export function resetOcrState(): void {
  workerFailed = false;
  workerError = null;
  stats.runs = 0;
  stats.skipped = 0;
  stats.lastSkipReason = null;
}

export const ocrSource: PerceptionSource = {
  id: 'ocr',
  timeout_ms: TIMEOUT_MS,

  /**
   * Pixels the DOM cannot explain are what OCR is the account for. Reported to
   * sanitize() for the failures this source cannot report itself — it threw, or it
   * hung past its timeout and never returned a SourceOutput at all.
   */
  coverage: (ctx: PerceptionContext) =>
    findUnexplainedRegions(ctx.raw).map(r => ({ rect: r.rect, reason: OCR_UNAVAILABLE })),

  async run(ctx: PerceptionContext): Promise<SourceOutput> {
    stats.runs++;

    const regions = findUnexplainedRegions(ctx.raw);
    if (regions.length === 0) return skip(NO_UNEXPLAINED_CROPS);

    // Gate on the policy, not on whether a frame happened to arrive. STRICT turns
    // the screenshot path off, so there are no pixels and the 43MB engine is never
    // loaded — measured in eval/reports/perf.md. The regions still go back as
    // unexplained, so not loading the model costs utility and never privacy.
    if (!ctx.screenshotEnabled) return unreadable(regions, SCREENSHOT_DISABLED);
    if (!ctx.frame) return unreadable(regions, 'no_frame');

    const { crops, deferred } = selectCrops(regions, MAX_CROPS_PER_STEP);
    // Over-budget regions are masked, not passed — the budget costs utility, never privacy.
    const unexplained = deferred.map(r => ({ rect: r.rect, reason: 'crop_budget_exceeded' }));

    if (workerFailed) return unreadable([...crops, ...deferred], `${OCR_UNAVAILABLE}:${workerError ?? 'worker'}`);

    try {
      await initOcrWorker();
    } catch (e) {
      workerFailed = true;
      workerError = describe(e);
      return unreadable([...crops, ...deferred], `${OCR_UNAVAILABLE}:${workerError}`);
    }

    let prepared: { image: Blob; geometry: CropGeometry }[];
    try {
      prepared = await renderCrops(crops, ctx.frame);
    } catch (e) {
      return unreadable([...crops, ...deferred], `${OCR_UNAVAILABLE}:render_${describe(e)}`);
    }

    try {
      const { regions: read, timedOut } = await runOcrOnCrops(prepared, RECOGNITION_BUDGET_MS);

      // Recovered text stays local. It is fed to the same detectors the DOM text gets:
      // checksum recognizers, label context, and NER when it is loaded. Only their
      // hits become evidence; the region itself stays unexplained (masked in pixels)
      // unless a detector explained it.
      const evidence: Evidence[] = [];
      for (const region of read) {
        const text = region.text.trim();
        if (!text) continue;
        const seen = new Set<string>();
        const push = (value: string, piiType: string, confidence: number) => {
          const key = `${piiType}:${value}`;
          if (seen.has(key)) return;
          seen.add(key);
          evidence.push({ sourceId: 'ocr', type: 'ocr', piiType: piiType as Evidence['piiType'], confidence: Math.min(confidence, region.confidence || 0.8), rect: region.rect, textSpan: value });
        };
        for (const span of recognizeText(text)) push(span.value, span.type, span.confidence);
        const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
        const pseudoRaw = { ...ctx.raw, text_nodes: lines.map((l, i) => ({ id: `ocr${i}`, rect: region.rect, text: l, owner_element_id: null, source: 'dom' as const })) };
        for (const hit of recognizeByContext(pseudoRaw)) push(hit.value, hit.type, hit.confidence);
        if (isNerAvailable()) {
          try {
            const { spans } = await runNer(text, 0.5);
            for (const span of spans) push(text.slice(span.start, span.end), nerTypeToPii(span.type), span.confidence);
          } catch {
            /* NER over OCR text is best effort; the region stays masked regardless */
          }
        }
      }

      for (const geometry of timedOut) {
        unexplained.push({ rect: geometry.rect, reason: OCR_TIMEOUT });
      }

      return {
        evidence,
        degraded: timedOut.length > 0 ? [OCR_TIMEOUT] : undefined,
        unexplained,
      };
    } catch (e) {
      return unreadable([...crops, ...deferred], `${OCR_UNAVAILABLE}:run_${describe(e)}`);
    }
  },
};

function skip(reason: string): SourceOutput {
  stats.skipped++;
  stats.lastSkipReason = reason;
  return { evidence: [], degraded: [`ocr_skipped_reason:${reason}`] };
}

/** Could not read these regions, so none of them may be treated as clean. */
function unreadable(regions: UnexplainedRegion[], reason: string): SourceOutput {
  return {
    evidence: [],
    degraded: [reason],
    unexplained: regions.map(r => ({ rect: r.rect, reason })),
  };
}

async function renderCrops(
  regions: UnexplainedRegion[],
  frame: CapturedFrame
): Promise<{ image: Blob; geometry: CropGeometry }[]> {
  const page = new OffscreenCanvas(frame.viewport_w, frame.viewport_h);
  // CapturedFrame.bitmap is `unknown` in the frozen schema; at runtime it is an ImageBitmap.
  const bitmap = frame.bitmap as CanvasImageSource;
  page.getContext('2d')!.drawImage(bitmap, 0, 0, frame.viewport_w, frame.viewport_h);

  return Promise.all(regions.map(async region => {
    const geometry = cropGeometry(region.rect, frame.viewport_w, frame.viewport_h);
    const [x, y, w, h] = geometry.rect;

    const crop = new OffscreenCanvas(geometry.width, geometry.height);
    const cropCtx = crop.getContext('2d')!;
    // Source rect stays in viewport units; only the destination is scaled, so
    // boxToViewport can undo it exactly.
    cropCtx.drawImage(page, x, y, w, h, 0, 0, geometry.width, geometry.height);

    // A PNG blob is what the tesseract worker reads; it also crosses the worker boundary cheaply.
    return { image: await crop.convertToBlob({ type: 'image/png' }), geometry };
  }));
}
