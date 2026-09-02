import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeDpr, cssToBitmapRect, bitmapToCssRect, cssToDownscaledRect, downscaledToCssRect } from './dpr';
import { downscaleFrame, calculateScaleFactor, computeDownscaledSize } from './downscale';
import type { RedactionRect} from './redact';
import { redactSync, isRedactedImage, createRedactedImageFromData } from './redact';
import type { DecodedFrame } from './decode';
import { decodeBitmap } from './decode';
import type { Rect } from '@glasswall/perception';

const mockDrawImage = vi.fn();
const mockFillRect = vi.fn();
const mockGetImageData = vi.fn();
const mockStrokeRect = vi.fn();
const mockFillText = vi.fn();
const mockCreateRadialGradient = vi.fn(() => ({
  addColorStop: vi.fn(),
}));

const createMockContext = () => ({
  drawImage: mockDrawImage,
  fillRect: mockFillRect,
  getImageData: mockGetImageData,
  strokeRect: mockStrokeRect,
  fillText: mockFillText,
  createRadialGradient: mockCreateRadialGradient,
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: 'alphabetic' as CanvasTextBaseline,
});

const createMockCanvas = (width: number, height: number) => ({
  width,
  height,
  getContext: vi.fn(() => createMockContext()),
  convertToBlob: vi.fn().mockResolvedValue(new Blob()),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  oncontextlost: null,
  oncontextrestored: null,
  transferToImageBitmap: vi.fn(),
});

const createMockBitmap = (width: number, height: number) => ({
  width,
  height,
  close: vi.fn(),
});

describe('dpr.ts - DPR Normalization', () => {
  it('normalizes DPR correctly at dpr=1', () => {
    const result = normalizeDpr(800, 600, 1);
    expect(result.cssWidth).toBe(800);
    expect(result.cssHeight).toBe(600);
    expect(result.dpr).toBe(1);
  });

  it('normalizes DPR correctly at dpr=2', () => {
    const result = normalizeDpr(1600, 1200, 2);
    expect(result.cssWidth).toBe(800);
    expect(result.cssHeight).toBe(600);
    expect(result.dpr).toBe(2);
  });

  it('normalizes DPR correctly at dpr=1.5', () => {
    const result = normalizeDpr(1200, 900, 1.5);
    expect(result.cssWidth).toBe(800);
    expect(result.cssHeight).toBe(600);
    expect(result.dpr).toBe(1.5);
  });

  it('throws on invalid DPR', () => {
    expect(() => normalizeDpr(800, 600, 0)).toThrow('Invalid DPR');
    expect(() => normalizeDpr(800, 600, -1)).toThrow('Invalid DPR');
    expect(() => normalizeDpr(800, 600, NaN)).toThrow('Invalid DPR');
  });

  it('converts CSS rect to bitmap rect at dpr=2', () => {
    const rect: Rect = { x: 100, y: 50, width: 200, height: 100 };
    const bitmapRect = cssToBitmapRect(rect, 2);
    expect(bitmapRect).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it('converts bitmap rect to CSS rect at dpr=2', () => {
    const rect: Rect = { x: 200, y: 100, width: 400, height: 200 };
    const cssRect = bitmapToCssRect(rect, 2);
    expect(cssRect).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it('round-trips CSS -> bitmap -> CSS at dpr=2', () => {
    const original: Rect = { x: 100, y: 50, width: 200, height: 100 };
    const bitmap = cssToBitmapRect(original, 2);
    const back = bitmapToCssRect(bitmap, 2);
    expect(back).toEqual(original);
  });

  it('converts CSS to downscaled rect', () => {
    const rect: Rect = { x: 100, y: 50, width: 200, height: 100 };
    const downscaled = cssToDownscaledRect(rect, 2, 0.5);
    expect(downscaled).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it('round-trips CSS -> downscaled -> CSS', () => {
    const original: Rect = { x: 100, y: 50, width: 200, height: 100 };
    const dpr = 2;
    const scale = 0.5;
    const downscaled = cssToDownscaledRect(original, dpr, scale);
    const back = downscaledToCssRect(downscaled, dpr, scale);
    expect(back.x).toBeCloseTo(original.x, 0);
    expect(back.y).toBeCloseTo(original.y, 0);
    expect(back.width).toBeCloseTo(original.width, 0);
    expect(back.height).toBeCloseTo(original.height, 0);
  });
});

describe('downscale.ts - Downscaling', () => {
  it('returns scaleFactor=1 when already small enough', () => {
    const frame = {
      canvas: createMockCanvas(400, 300),
      ctx: createMockContext(),
      width: 400,
      height: 300,
    } as unknown as DecodedFrame;
    const result = downscaleFrame(frame);
    expect(result.scaleFactor).toBe(1);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('downscales width-bound image', () => {
    const frame = {
      canvas: createMockCanvas(1280, 720),
      ctx: createMockContext(),
      width: 1280,
      height: 720,
    } as unknown as DecodedFrame;
    const result = downscaleFrame(frame);
    expect(result.scaleFactor).toBeCloseTo(640 / 1280);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
  });

  it('downscales height-bound image', () => {
    const frame = {
      canvas: createMockCanvas(720, 1280),
      ctx: createMockContext(),
      width: 720,
      height: 1280,
    } as unknown as DecodedFrame;
    const result = downscaleFrame(frame);
    expect(result.scaleFactor).toBeCloseTo(640 / 1280);
    expect(result.width).toBe(360);
    expect(result.height).toBe(640);
  });

  it('calculateScaleFactor returns correct values', () => {
    expect(calculateScaleFactor(640, 480)).toBe(1);
    expect(calculateScaleFactor(1280, 720)).toBeCloseTo(0.5);
    expect(calculateScaleFactor(800, 1200)).toBeCloseTo(640 / 1200);
  });

  it('computeDownscaledSize returns correct dimensions', () => {
    const result = computeDownscaledSize(1280, 720);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.scaleFactor).toBeCloseTo(0.5);
  });
});

describe('redact.ts - Redaction', () => {
  let mockCanvas: ReturnType<typeof createMockCanvas>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvas = createMockCanvas(640, 480);
    mockGetImageData.mockReturnValue({
      data: new Uint8ClampedArray(640 * 480 * 4),
      width: 640,
      height: 480,
    });
  });

  it('applies redaction rectangles', () => {
    const rects: RedactionRect[] = [
      { x: 100, y: 100, width: 200, height: 50, reason: 'test', source: 'ocr' },
      { x: 300, y: 200, width: 100, height: 100, reason: 'test', source: 'vision' },
    ];

    redactSync(mockCanvas as any, rects);

    expect(mockFillRect).toHaveBeenCalledTimes(2);
    expect(mockFillRect).toHaveBeenCalledWith(100, 100, 200, 50);
    expect(mockFillRect).toHaveBeenCalledWith(300, 200, 100, 100);
  });

  it('returns branded RedactedImage', () => {
    const rects: RedactionRect[] = [
      { x: 0, y: 0, width: 100, height: 100, reason: 'test', source: 'ocr' },
    ];

    const result = redactSync(mockCanvas as any, rects);

    expect(isRedactedImage(result)).toBe(true);
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(result.format).toBe('rgba');
    expect(result.data).toBeInstanceOf(Uint8Array);
  });

  it('clamps rects to canvas bounds', () => {
    const rects: RedactionRect[] = [
      { x: -50, y: -50, width: 200, height: 200, reason: 'test', source: 'ocr' },
      { x: 600, y: 400, width: 200, height: 200, reason: 'test', source: 'vision' },
    ];

    redactSync(mockCanvas as any, rects);

    // First rect clamped to (0, 0, 200, 200), second rect clamped to (600, 400, 40, 80)
    expect(mockFillRect).toHaveBeenCalledTimes(2);
    expect(mockFillRect).toHaveBeenNthCalledWith(1, 0, 0, 200, 200);
    expect(mockFillRect).toHaveBeenNthCalledWith(2, 600, 400, 40, 80);
  });

  it('skips zero-size rects', () => {
    const rects: RedactionRect[] = [
      { x: 100, y: 100, width: 0, height: 100, reason: 'test', source: 'ocr' },
      { x: 100, y: 100, width: 100, height: 0, reason: 'test', source: 'vision' },
    ];

    redactSync(mockCanvas as any, rects);
    expect(mockFillRect).not.toHaveBeenCalled();
  });

  it('createRedactedImageFromData creates valid branded image', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = createRedactedImageFromData(data, 10, 10, 'rgba');

    expect(isRedactedImage(result)).toBe(true);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.data).toEqual(data);
  });
});

describe('Coordinate Round-trip Tests (DPR=1 and DPR=2)', () => {
  const viewportRect: Rect = { x: 150, y: 200, width: 300, height: 150 };
  const scaleFactor = 0.5;

  it('viewport -> downscaled -> viewport round-trips within 1px at dpr=1', () => {
    const dpr = 1;
    const downscaled = cssToDownscaledRect(viewportRect, dpr, scaleFactor);
    const back = downscaledToCssRect(downscaled, dpr, scaleFactor);

    expect(Math.abs(back.x - viewportRect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.y - viewportRect.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.width - viewportRect.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.height - viewportRect.height)).toBeLessThanOrEqual(1);
  });

  it('viewport -> downscaled -> viewport round-trips within 1px at dpr=2', () => {
    const dpr = 2;
    const downscaled = cssToDownscaledRect(viewportRect, dpr, scaleFactor);
    const back = downscaledToCssRect(downscaled, dpr, scaleFactor);

    expect(Math.abs(back.x - viewportRect.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.y - viewportRect.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.width - viewportRect.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.height - viewportRect.height)).toBeLessThanOrEqual(1);
  });

  it('alignment error ≤2px at dpr=1 and dpr=2 for typical redaction rect', () => {
    const cssRedactionRect: Rect = { x: 100.3, y: 200.7, width: 150.2, height: 40.8 };

    for (const dpr of [1, 2]) {
      const downscaled = cssToDownscaledRect(cssRedactionRect, dpr, scaleFactor);
      const back = downscaledToCssRect(downscaled, dpr, scaleFactor);

      const errorX = Math.abs(back.x - cssRedactionRect.x);
      const errorY = Math.abs(back.y - cssRedactionRect.y);
      const errorW = Math.abs(back.width - cssRedactionRect.width);
      const errorH = Math.abs(back.height - cssRedactionRect.height);

      expect(errorX).toBeLessThanOrEqual(2);
      expect(errorY).toBeLessThanOrEqual(2);
      expect(errorW).toBeLessThanOrEqual(2);
      expect(errorH).toBeLessThanOrEqual(2);
    }
  });
});

describe('Source bitmap closed after redact()', () => {
  it('verifies bitmap.close() is called after decode', () => {
    const bitmap = createMockBitmap(800, 600);
    decodeBitmap(bitmap);
    expect(bitmap.close).toHaveBeenCalled();
  });
});