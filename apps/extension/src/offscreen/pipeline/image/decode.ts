/**
 * Decode an ImageBitmap to an OffscreenCanvas.
 * The ImageBitmap is transferred (not copied) and MUST be closed after use.
 * This is the entry point for all image processing in the offscreen document.
 */

export interface DecodedFrame {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * Decode an ImageBitmap to an OffscreenCanvas.
 * The bitmap is drawn to the canvas and then CLOSED immediately.
 * The caller owns the returned OffscreenCanvas and must manage its lifecycle.
 *
 * @param bitmap - The ImageBitmap to decode (transferred, not copied)
 * @returns DecodedFrame with canvas, context, and dimensions
 * @throws If bitmap is null/undefined or context creation fails
 */
export function decodeBitmap(bitmap: ImageBitmap): DecodedFrame {
  if (!bitmap) {
    throw new Error('decodeBitmap: bitmap is null or undefined');
  }

  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    bitmap.close();
    throw new Error('decodeBitmap: failed to get 2d context from OffscreenCanvas');
  }

  // Draw the bitmap to the canvas
  ctx.drawImage(bitmap, 0, 0);

  // CRITICAL: Close the bitmap immediately after drawing.
  // Retaining ImageBitmaps across steps is a classic leak.
  bitmap.close();

  return { canvas, ctx, width, height };
}

/**
 * Create a new OffscreenCanvas with the same dimensions as the source.
 * Useful for creating intermediate buffers.
 */
export function createCanvasLike(source: OffscreenCanvas): OffscreenCanvas {
  return new OffscreenCanvas(source.width, source.height);
}

/**
 * Create a new OffscreenCanvas with specific dimensions.
 */
export function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}