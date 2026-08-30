import { Rect } from '@glasswall/perception';

export interface DprNormalized {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/**
 * Normalize device pixel ratio to CSS pixels IMMEDIATELY on entry.
 * This is the trap - a misaligned box does not look slightly wrong,
 * it blacks out the wrong region and leaves the sensitive one visible.
 *
 * Call this as the very first operation when receiving a CapturedFrame.
 * Never defer DPR normalization.
 */
export function normalizeDpr(
  bitmapWidth: number,
  bitmapHeight: number,
  dpr: number
): DprNormalized {
  if (dpr <= 0 || !Number.isFinite(dpr)) {
    throw new Error(`Invalid DPR: ${dpr}`);
  }

  return {
    cssWidth: Math.round(bitmapWidth / dpr),
    cssHeight: Math.round(bitmapHeight / dpr),
    dpr,
  };
}

/**
 * Convert a rectangle from viewport CSS pixels to bitmap (device) pixels.
 * Use when you have CSS-coordinate rects and need to apply them to a bitmap.
 */
export function cssToBitmapRect(rect: Rect, dpr: number): Rect {
  return {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };
}

/**
 * Convert a rectangle from bitmap (device) pixels to viewport CSS pixels.
 * Use when you have bitmap-coordinate rects and need to report in CSS pixels.
 */
export function bitmapToCssRect(rect: Rect, dpr: number): Rect {
  return {
    x: Math.round(rect.x / dpr),
    y: Math.round(rect.y / dpr),
    width: Math.round(rect.width / dpr),
    height: Math.round(rect.height / dpr),
  };
}

/**
 * Convert a rectangle from viewport CSS pixels to downscaled screenshot space.
 * Combines CSS→bitmap (via DPR) then bitmap→downscaled (via scale factor).
 */
export function cssToDownscaledRect(rect: Rect, dpr: number, scaleFactor: number): Rect {
  const bitmapRect = cssToBitmapRect(rect, dpr);
  return {
    x: Math.round(bitmapRect.x * scaleFactor),
    y: Math.round(bitmapRect.y * scaleFactor),
    width: Math.round(bitmapRect.width * scaleFactor),
    height: Math.round(bitmapRect.height * scaleFactor),
  };
}

/**
 * Convert a rectangle from downscaled screenshot space to viewport CSS pixels.
 * Inverse of cssToDownscaledRect.
 */
export function downscaledToCssRect(rect: Rect, dpr: number, scaleFactor: number): Rect {
  return {
    x: Math.round(rect.x / scaleFactor / dpr),
    y: Math.round(rect.y / scaleFactor / dpr),
    width: Math.round(rect.width / scaleFactor / dpr),
    height: Math.round(rect.height / scaleFactor / dpr),
  };
}