// Image Pipeline - Offscreen Document Image Processing
// Image pipeline owns: decode, downscale, DPR normalization, redaction, debug alignment

export * from './dpr';
export * from './decode';
export * from './downscale';
export * from './redact';
export * from './debug-align';

// Pipeline types
export interface ImagePipelineInput {
  bitmap: ImageBitmap;
  dpr: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ImagePipelineOutput {
  redactedImage: RedactedImage;
  scaleFactor: number;
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  debugCanvas?: OffscreenCanvas;
}

import type { RedactedImage } from '@glasswall/schema';
import { normalizeDpr } from './dpr';
import { decodeBitmap } from './decode';
import { downscaleFrame } from './downscale';
import { redact, type RedactionRect } from './redact';
import { paintDebugRects } from './debug-align';

/**
 * Full image processing pipeline:
 * 1. Normalize DPR to CSS pixels (immediately on entry)
 * 2. Decode ImageBitmap to OffscreenCanvas
 * 3. Downscale to 640px long side (uniform scale factor)
 * 4. Apply redactions (inside offscreen document)
 * 5. Return branded RedactedImage (only module returning image bytes)
 */
export async function processImagePipeline(
  input: ImagePipelineInput,
  redactionRects: RedactionRect[],
  debug = false
): Promise<ImagePipelineOutput> {
  const { bitmap, dpr } = input;

  // Step 1: DPR normalization (MUST be first)
  const { cssWidth, cssHeight } = normalizeDpr(bitmap.width, bitmap.height, dpr);

  // Step 2: Decode bitmap to canvas
  const decoded = decodeBitmap(bitmap);

  // Step 3: Downscale
  const downscaled = downscaleFrame(decoded);

  // Step 4: Apply redactions
  const redactedImage = await redact(downscaled.canvas, redactionRects);

  let debugCanvas: OffscreenCanvas | undefined;
  if (debug) {
    debugCanvas = paintDebugRects(downscaled, redactionRects.map(r => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color: 'rgba(255, 0, 0, 0.7)',
      label: `${r.reason} (${r.source})`,
      lineWidth: 2,
    })));
  }

  return {
    redactedImage,
    scaleFactor: downscaled.scaleFactor,
    dpr,
    cssWidth,
    cssHeight,
    debugCanvas,
  };
}
