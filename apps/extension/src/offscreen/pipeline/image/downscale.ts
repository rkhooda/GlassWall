import { DecodedFrame } from './decode';

export const MAX_LONG_SIDE = 640;

export interface DownscaledFrame {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  scaleFactor: number; // s = downscaled / original (same in both directions)
}

/**
 * Downscale a frame to have its longest side at most MAX_LONG_SIDE (640px).
 * The scale factor `s` is carried in BOTH directions (uniform scaling).
 * This preserves aspect ratio exactly.
 *
 * @param frame - The decoded frame to downscale
 * @returns DownscaledFrame with the scaled canvas, context, dimensions, and scale factor
 */
export function downscaleFrame(frame: DecodedFrame): DownscaledFrame {
  const { width, height } = frame;
  const longSide = Math.max(width, height);

  // If already small enough, return with scaleFactor = 1
  if (longSide <= MAX_LONG_SIDE) {
    return {
      canvas: frame.canvas,
      ctx: frame.ctx,
      width: frame.width,
      height: frame.height,
      scaleFactor: 1,
    };
  }

  // Uniform scale factor
  const scaleFactor = MAX_LONG_SIDE / longSide;
  const newWidth = Math.round(width * scaleFactor);
  const newHeight = Math.round(height * scaleFactor);

  // Create new downscaled canvas
  const canvas = new OffscreenCanvas(newWidth, newHeight);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('downscaleFrame: failed to get 2d context from downscaled OffscreenCanvas');
  }

  // Draw with high-quality scaling
  ctx.drawImage(frame.canvas, 0, 0, newWidth, newHeight);

  return { canvas, ctx, width: newWidth, height: newHeight, scaleFactor };
}

/**
 * Calculate the scale factor for downscaling without performing the operation.
 * Useful for pre-computing coordinate transforms.
 */
export function calculateScaleFactor(width: number, height: number): number {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_LONG_SIDE) {
    return 1;
  }
  return MAX_LONG_SIDE / longSide;
}

/**
 * Compute the downscaled dimensions for a given original size.
 */
export function computeDownscaledSize(width: number, height: number): { width: number; height: number; scaleFactor: number } {
  const scaleFactor = calculateScaleFactor(width, height);
  return {
    width: Math.round(width * scaleFactor),
    height: Math.round(height * scaleFactor),
    scaleFactor,
  };
}