import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { getAssetUrl } from '../registry';
import { boxToViewport, type CropGeometry, type Rect } from './crop-policy';

/**
 * Tesseract.js resolves its worker script, wasm core and language data from a CDN
 * unless all three are given explicitly. These three paths are the whole reason
 * this file exists — every one of them points at a bundled asset.
 *
 * `workerBlobURL: false` keeps the worker on the extension origin (MV3 CSP blocks
 * blob: workers), and `cacheMethod: 'none'` stops it re-fetching language data it
 * thinks it is missing from its cache.
 */
export const TESSERACT_BASE_URL = getAssetUrl('tesseract/');

export function tesseractPaths() {
  return {
    workerPath: `${TESSERACT_BASE_URL}worker.min.js`,
    corePath: TESSERACT_BASE_URL,
    langPath: TESSERACT_BASE_URL,
    workerBlobURL: false,
    cacheMethod: 'none' as const,
  };
}

export interface OcrWord {
  text: string;
  confidence: number;
  /** Viewport (CSS) coordinates, already un-scaled from the crop. */
  rect: Rect;
}

export interface OcrRegion {
  rect: Rect;
  /** Raw recognised text. Stays local: it feeds recognizers and NER, never text_blocks. */
  text: string;
  confidence: number;
  words: OcrWord[];
}

let worker: Worker | null = null;

export async function initOcrWorker(lang = 'eng'): Promise<void> {
  if (worker) return;

  worker = await createWorker(lang, OEM.LSTM_ONLY, tesseractPaths());
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
}

export function isOcrReady(): boolean {
  return worker !== null;
}

export async function terminateOcrWorker(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}

/**
 * Recognise a batch of crops under a wall-clock deadline. Crops not reached before
 * the deadline are reported in `timedOut` so the caller can leave them masked —
 * a timeout must never make a region look clean.
 */
export type CropImage = ImageData | Blob | OffscreenCanvas;

/** tesseract.js reads Blobs and canvases in the worker; raw ImageData must be encoded first. */
async function toRecognizable(image: CropImage): Promise<Blob | OffscreenCanvas> {
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return image as Blob | OffscreenCanvas;
}

export async function runOcrOnCrops(
  crops: { image: CropImage; geometry: CropGeometry }[],
  deadlineMs: number
): Promise<{ regions: OcrRegion[]; timedOut: CropGeometry[]; ms: number }> {
  if (!worker) throw new Error('ocr worker not initialised');

  const start = Date.now();
  const regions: OcrRegion[] = [];
  const timedOut: CropGeometry[] = [];

  for (const { image, geometry } of crops) {
    const remaining = deadlineMs - (Date.now() - start);
    if (remaining <= 0) {
      timedOut.push(geometry);
      continue;
    }

    const result = await withDeadline(toRecognizable(image).then(input => worker!.recognize(input as never)), remaining);
    if (!result) {
      timedOut.push(geometry);
      continue;
    }

    const { text, confidence, words } = result.data;
    regions.push({
      rect: geometry.rect,
      text: text.trim(),
      confidence: confidence / 100,
      words: (words ?? []).map(w => ({
        text: w.text,
        confidence: w.confidence / 100,
        rect: boxToViewport(w.bbox, geometry),
      })),
    });
  }

  return { regions, timedOut, ms: Date.now() - start };
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer!);
  }
}
