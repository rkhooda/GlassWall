import { Rect } from '@glasswall/perception';
import { RedactedImage } from '@glasswall/schema';

export interface RedactionRect extends Rect {
  // Additional metadata for audit trail
  reason: string;
  source: 'ocr' | 'vision' | 'ner' | 'deterministic' | 'unexplained' | 'manual';
  score?: number;
}

export interface RedactionOptions {
  fillColor?: string; // Default: 'rgba(0, 0, 0, 1)' - opaque black
  feather?: number;   // Default: 0 - no feathering
}

/**
 * Apply redaction rectangles to a canvas (synchronous, modifies in place).
 * This is the internal implementation used by both async and sync variants.
 */
function applyRedactions(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: OffscreenCanvas,
  rects: RedactionRect[],
  options: RedactionOptions
): void {
  const { fillColor = 'rgba(0, 0, 0, 1)', feather = 0 } = options;

  for (const rect of rects) {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(Math.ceil(rect.width), canvas.width - x);
    const h = Math.min(Math.ceil(rect.height), canvas.height - y);

    if (w <= 0 || h <= 0) continue;

    if (feather > 0) {
      const gradient = ctx.createRadialGradient(
        x + w / 2, y + h / 2, 0,
        x + w / 2, y + h / 2, Math.max(w, h) / 2 + feather
      );
      gradient.addColorStop(0, fillColor);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - feather, y - feather, w + 2 * feather, h + 2 * feather);
    } else {
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, w, h);
    }
  }
}

/**
 * Redact regions of an image by drawing filled rectangles over them.
 * CRITICAL ORDERING RULE (PLAN.md §7.3):
 * - Redaction is applied to the pixel buffer INSIDE the offscreen document
 * - The original bitmap is dropped before the redacted version is handed out
 * - This is the ONLY module in the repo that returns image bytes to the orchestrator
 * - Its return type is the branded `RedactedImage` type
 *
 * @param canvas - The OffscreenCanvas to redact (will be modified in place)
 * @param rects - Array of redaction rectangles in the canvas's coordinate space
 * @param options - Optional fill color and feathering
 * @returns Promise resolving to branded RedactedImage containing the redacted pixel data (PNG format)
 *
 * The source canvas is consumed and should not be used after this call.
 */
export async function redact(
  canvas: OffscreenCanvas,
  rects: RedactionRect[],
  options: RedactionOptions = {}
): Promise<RedactedImage> {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('redact: failed to get 2d context from canvas');
  }

  applyRedactions(ctx, canvas, rects, options);

  // Convert to blob and then to Uint8Array
  // This is the ONLY place image bytes leave the offscreen document
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await blob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  return {
    __redactedImageBrand: '__redactedImageBrand',
    data,
    width: canvas.width,
    height: canvas.height,
    format: 'png',
  };
}

/**
 * Synchronous version of redact using OffscreenCanvas.getImageData.
 * Use when you need synchronous operation (e.g., in tests).
 * Note: getImageData returns uncompressed RGBA; the async version gives compressed PNG.
 */
export function redactSync(
  canvas: OffscreenCanvas,
  rects: RedactionRect[],
  options: RedactionOptions = {}
): RedactedImage {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('redactSync: failed to get 2d context from canvas');
  }

  applyRedactions(ctx, canvas, rects, options);

  // Get raw RGBA pixel data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8Array(imageData.data.buffer);

  return {
    __redactedImageBrand: '__redactedImageBrand',
    data,
    width: canvas.width,
    height: canvas.height,
    format: 'rgba',
  };
}

/**
 * Create a RedactedImage from raw pixel data (for testing/fixtures).
 * This bypasses the canvas entirely - use only in tests.
 */
export function createRedactedImageFromData(
  data: Uint8Array,
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'rgba' = 'rgba'
): RedactedImage {
  return {
    __redactedImageBrand: '__redactedImageBrand',
    data: new Uint8Array(data), // Copy to ensure ownership
    width,
    height,
    format,
  };
}

/**
 * Verify that a value is a valid RedactedImage (brand check).
 * Use at API boundaries to ensure type safety.
 */
export function isRedactedImage(value: unknown): value is RedactedImage {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__redactedImageBrand' in value &&
    (value as Record<string, unknown>).__redactedImageBrand === '__redactedImageBrand'
  );
}