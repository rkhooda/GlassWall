import type { CapturedFrame } from '@glasswall/schema/observation';
import type { Evidence, PerceptionContext, PerceptionSource, SourceOutput } from '@glasswall/privacy';
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

let workerFailed = false;
const stats = { runs: 0, skipped: 0, lastSkipReason: null as string | null };

/** Skip rate for the D6 headline claim: OCR does nothing on most steps. */
export function getOcrStats(): { runs: number; skipped: number; skipRate: number; lastSkipReason: string | null } {
  return { ...stats, skipRate: stats.runs === 0 ? 0 : stats.skipped / stats.runs };
}

export function resetOcrState(): void {
  workerFailed = false;
  stats.runs = 0;
  stats.skipped = 0;
  stats.lastSkipReason = null;
}

export const ocrSource: PerceptionSource = {
  id: 'ocr',
  timeout_ms: TIMEOUT_MS,

  async run(ctx: PerceptionContext): Promise<SourceOutput> {
    stats.runs++;

    const regions = findUnexplainedRegions(ctx.raw);
    if (regions.length === 0) return skip(NO_UNEXPLAINED_CROPS);
    if (!ctx.frame) return unreadable(regions, 'no_frame');

    const { crops, deferred } = selectCrops(regions, MAX_CROPS_PER_STEP);
    // Over-budget regions are masked, not passed — the budget costs utility, never privacy.
    const unexplained = deferred.map(r => ({ rect: r.rect, reason: 'crop_budget_exceeded' }));

    if (workerFailed) return unreadable([...crops, ...deferred], OCR_UNAVAILABLE);

    try {
      await initOcrWorker();
    } catch {
      workerFailed = true;
      return unreadable([...crops, ...deferred], OCR_UNAVAILABLE);
    }

    let prepared: Array<{ image: ImageData; geometry: CropGeometry }>;
    try {
      prepared = await renderCrops(crops, ctx.frame);
    } catch {
      return unreadable([...crops, ...deferred], OCR_UNAVAILABLE);
    }

    try {
      const { regions: read, timedOut } = await runOcrOnCrops(prepared, RECOGNITION_BUDGET_MS);

      const evidence: Evidence[] = [];
      for (const region of read) {
        if (!region.text.trim()) continue;
        evidence.push({
          sourceId: 'ocr',
          type: 'ocr',
          piiType: 'PERSONAL',
          confidence: region.confidence,
          rect: region.rect,
          textSpan: region.text,
        });
      }

      for (const geometry of timedOut) {
        unexplained.push({ rect: geometry.rect, reason: OCR_TIMEOUT });
      }

      return {
        evidence,
        degraded: timedOut.length > 0 ? [OCR_TIMEOUT] : undefined,
        unexplained,
      };
    } catch {
      return unreadable([...crops, ...deferred], OCR_UNAVAILABLE);
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
): Promise<Array<{ image: ImageData; geometry: CropGeometry }>> {
  const page = new OffscreenCanvas(frame.viewport_w, frame.viewport_h);
  // CapturedFrame.bitmap is `unknown` in the frozen schema; at runtime it is an ImageBitmap.
  const bitmap = frame.bitmap as CanvasImageSource;
  page.getContext('2d')!.drawImage(bitmap, 0, 0, frame.viewport_w, frame.viewport_h);

  return regions.map(region => {
    const geometry = cropGeometry(region.rect, frame.viewport_w, frame.viewport_h);
    const [x, y, w, h] = geometry.rect;

    const crop = new OffscreenCanvas(geometry.width, geometry.height);
    const cropCtx = crop.getContext('2d')!;
    // Source rect stays in viewport units; only the destination is scaled, so
    // boxToViewport can undo it exactly.
    cropCtx.drawImage(page, x, y, w, h, 0, 0, geometry.width, geometry.height);

    return { image: cropCtx.getImageData(0, 0, geometry.width, geometry.height), geometry };
  });
}
