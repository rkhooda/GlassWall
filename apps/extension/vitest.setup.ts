// Vitest setup file for extension tests
import { vi } from 'vitest';

// Mock OffscreenCanvas and related APIs
global.OffscreenCanvas = class OffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(contextId: string) {
    if (contextId === '2d') {
      return {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(this.width * this.height * 4),
          width: this.width,
          height: this.height,
        })),
        createRadialGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textBaseline: 'alphabetic' as CanvasTextBaseline,
      } as unknown as OffscreenCanvasRenderingContext2D;
    }
    return null;
  }
  convertToBlob() {
    return Promise.resolve(new Blob());
  }
} as any;

global.ImageBitmap = class ImageBitmap {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  close() {}
} as any;

global.ImageData = class ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number);
  constructor(data: Uint8ClampedArray, width: number, height: number);
  constructor(dataOrWidth: number | Uint8ClampedArray, width?: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = width!;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = width!;
      this.height = height!;
    }
  }
} as any;

global.HTMLCanvasElement = class HTMLCanvasElement {
  width: number;
  height: number;
  getContext() {
    return null;
  }
  toDataURL() {
    return '';
  }
} as any;

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16));
global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));