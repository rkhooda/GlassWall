import { Rect } from '@glasswall/perception';
import { DecodedFrame } from './decode';

export interface DebugRect extends Rect {
  color?: string;           // Default: 'rgba(255, 0, 0, 0.5)'
  label?: string;           // Optional label to draw
  lineWidth?: number;       // Default: 2
  fillColor?: string;       // Default: transparent
}

/**
 * Paint debug rectangles over a canvas for visual verification.
 * This does NOT modify the original canvas - it draws on a copy or overlay.
 * Use for development/debugging only. NOT for production redaction.
 *
 * @param frame - The decoded frame to draw on
 * @param rects - Array of debug rectangles in the canvas's coordinate space
 * @returns A new OffscreenCanvas with the debug overlay drawn
 */
export function paintDebugRects(frame: DecodedFrame, rects: DebugRect[]): OffscreenCanvas {
  const debugCanvas = new OffscreenCanvas(frame.width, frame.height);
  const debugCtx = debugCanvas.getContext('2d');

  if (!debugCtx) {
    throw new Error('paintDebugRects: failed to get 2d context');
  }

  // Draw the original frame
  debugCtx.drawImage(frame.canvas, 0, 0);

  // Draw each debug rect
  for (const rect of rects) {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(Math.ceil(rect.width), frame.width - x);
    const h = Math.min(Math.ceil(rect.height), frame.height - y);

    if (w <= 0 || h <= 0) continue;

    const color = rect.color || 'rgba(255, 0, 0, 0.5)';
    const lineWidth = rect.lineWidth ?? 2;
    const fillColor = rect.fillColor || 'transparent';

    // Draw fill if specified
    if (fillColor !== 'transparent') {
      debugCtx.fillStyle = fillColor;
      debugCtx.fillRect(x, y, w, h);
    }

    // Draw stroke
    debugCtx.strokeStyle = color;
    debugCtx.lineWidth = lineWidth;
    debugCtx.strokeRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth);

    // Draw label if provided
    if (rect.label) {
      debugCtx.fillStyle = color;
      debugCtx.font = '12px system-ui, sans-serif';
      debugCtx.textBaseline = 'bottom';
      debugCtx.fillText(rect.label, x, y > 14 ? y - 2 : y + h + 14);
    }
  }

  return debugCanvas;
}

/**
 * Paint debug rectangles directly on a canvas (mutates the canvas).
 * Use when you want to add debug overlay to an existing canvas.
 */
export function paintDebugRectsOnCanvas(canvas: OffscreenCanvas, rects: DebugRect[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('paintDebugRectsOnCanvas: failed to get 2d context');
  }

  for (const rect of rects) {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const w = Math.min(Math.ceil(rect.width), canvas.width - x);
    const h = Math.min(Math.ceil(rect.height), canvas.height - y);

    if (w <= 0 || h <= 0) continue;

    const color = rect.color || 'rgba(255, 0, 0, 0.5)';
    const lineWidth = rect.lineWidth ?? 2;
    const fillColor = rect.fillColor || 'transparent';

    if (fillColor !== 'transparent') {
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, w, h);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth);

    if (rect.label) {
      ctx.fillStyle = color;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(rect.label, x, y > 14 ? y - 2 : y + h + 14);
    }
  }
}

/**
 * Create a debug canvas that shows both the original and redacted versions side by side.
 * Useful for visual verification of redaction alignment.
 */
export function createComparisonCanvas(
  original: DecodedFrame,
  redacted: OffscreenCanvas,
  rects: DebugRect[]
): OffscreenCanvas {
  const padding = 20;
  const labelHeight = 30;
  const totalWidth = original.width * 2 + padding * 3;
  const totalHeight = Math.max(original.height, redacted.height) + padding * 2 + labelHeight;

  const comparisonCanvas = new OffscreenCanvas(totalWidth, totalHeight);
  const ctx = comparisonCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('createComparisonCanvas: failed to get 2d context');
  }

  // Background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Original label
  ctx.fillStyle = '#333';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('ORIGINAL', padding, padding);

  // Draw original
  ctx.drawImage(original.canvas, padding, padding + labelHeight);

  // Draw debug rects on original
  for (const rect of rects) {
    const x = Math.max(0, Math.floor(rect.x)) + padding;
    const y = Math.max(0, Math.floor(rect.y)) + padding + labelHeight;
    const w = Math.min(Math.ceil(rect.width), original.width - Math.floor(rect.x));
    const h = Math.min(Math.ceil(rect.height), original.height - Math.floor(rect.y));

    if (w <= 0 || h <= 0) continue;

    const color = rect.color || 'rgba(255, 0, 0, 0.5)';
    const lineWidth = rect.lineWidth ?? 2;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth);

    if (rect.label) {
      ctx.fillStyle = color;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(rect.label, x, y > 14 ? y - 2 : y + h + 14);
    }
  }

  // Redacted label
  const redactedX = padding * 2 + original.width;
  ctx.fillText('REDACTED', redactedX, padding);

  // Draw redacted
  ctx.drawImage(redacted, redactedX, padding + labelHeight);

  return comparisonCanvas;
}

/**
 * Convert a canvas to a data URL for debugging display.
 */
export async function canvasToDataUrl(canvas: OffscreenCanvas, type = 'image/png'): Promise<string> {
  const blob = await canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}