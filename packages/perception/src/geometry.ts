// Rectangle type definition
export interface Rect {
  x: number; // left
  y: number; // top
  width: number;
  height: number;
}

// Helper function to create a Rect
export function createRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

// Calculate area of a rectangle
export function area(rect: Rect): number {
  return rect.width * rect.height;
}

// Check if one rect contains another
export function contains(container: Rect, target: Rect): boolean {
  return (
    container.x <= target.x &&
    container.y <= target.y &&
    container.x + container.width >= target.x + target.width &&
    container.y + container.height >= target.y + target.height
  );
}

// Check if two rects intersect
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Calculate intersection of two rects
export function intersect(a: Rect, b: Rect): Rect | null {
  if (!intersects(a, b)) {
    return null;
  }

  return createRect(
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
}

// Calculate union of two rects
export function union(a: Rect, b: Rect): Rect {
  return createRect(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
    Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
  );
}

// Calculate IoU (Intersection over Union)
export function iou(a: Rect, b: Rect): number {
  const intersection = intersect(a, b);
  if (intersection === null) {
    return 0;
  }

  const intersectionArea = intersection.width * intersection.height;
  const areaA = area(a);
  const areaB = area(b);
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea === 0 ? 0 : intersectionArea / unionArea;
}

// Calculate area union over a list of rects
export function areaUnion(rects: Rect[]): number {
  if (rects.length === 0) {
    return 0;
  }

  // For small number of rects, we can compute the exact union area
  // by creating a grid from all x and y coordinates and checking coverage

  // Collect all unique x and y coordinates from rectangle edges
  const xCoords = new Set<number>();
  const yCoords = new Set<number>();

  for (const rect of rects) {
    xCoords.add(rect.x);
    xCoords.add(rect.x + rect.width);
    yCoords.add(rect.y);
    yCoords.add(rect.y + rect.height);
  }

  // Convert to sorted arrays
  const sortedX = Array.from(xCoords).sort((a, b) => a - b);
  const sortedY = Array.from(yCoords).sort((a, b) => a - b);

  // Handle edge case where we don't have enough coordinates to form a grid
  if (sortedX.length < 2 || sortedY.length < 2) {
    // Fallback to simple bounding box approach for degenerate cases
    const firstRect = rects[0];
    if (firstRect === undefined) {
      return 0; // Should not happen due to length check above
    }
    let unionRect: Rect = firstRect;
    for (let i = 1; i < rects.length; i++) {
      const rect = rects[i];
      if (rect !== undefined) {
        unionRect = union(unionRect, rect);
      }
    }
    return area(unionRect);
  }

  // Check each cell in the grid
  let totalArea = 0;
  for (let i = 0; i < sortedX.length - 1; i++) {
    const cellX = sortedX[i];
    const cellX2 = sortedX[i + 1];
    // TypeScript needs help seeing these are defined
    if (cellX === undefined || cellX2 === undefined) {
      continue;
    }
    const cellWidth = cellX2 - cellX;
    for (let j = 0; j < sortedY.length - 1; j++) {
      const cellY = sortedY[j];
      const cellY2 = sortedY[j + 1];
      // TypeScript needs help seeing these are defined
      if (cellY === undefined || cellY2 === undefined) {
        continue;
      }
      const cellHeight = cellY2 - cellY;

      // Check if this cell is covered by any rectangle
      let covered = false;
      for (let k = 0; k < rects.length; k++) {
        // Safety check for TypeScript
        if (k >= rects.length) {
          break;
        }
        const rect = rects[k];
        if (rect !== undefined) {
          if (
            cellX >= rect.x &&
            cellX + cellWidth <= rect.x + rect.width &&
            cellY >= rect.y &&
            cellY + cellHeight <= rect.y + rect.height
          ) {
            covered = true;
            break;
          }
        }
      }

      if (covered) {
        totalArea += cellWidth * cellHeight;
      }
    }
  }

  return totalArea;
}

// Quantize a value to the nearest grid step
export function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Quantize a rectangle to a 4px grid
export function quantizeRect(rect: Rect, gridSize: number = 4): Rect {
  return createRect(
    quantize(rect.x, gridSize),
    quantize(rect.y, gridSize),
    quantize(rect.width, gridSize),
    quantize(rect.height, gridSize)
  );
}

// Transform from viewport CSS pixels to downscaled screenshot space
export function viewportToScreenshot(
  viewportRect: Rect,
  scaleFactor: number
): Rect {
  return createRect(
    viewportRect.x * scaleFactor,
    viewportRect.y * scaleFactor,
    viewportRect.width * scaleFactor,
    viewportRect.height * scaleFactor
  );
}

// Transform from downscaled screenshot space to viewport CSS pixels
export function screenshotToViewport(
  screenshotRect: Rect,
  scaleFactor: number
): Rect {
  return createRect(
    screenshotRect.x / scaleFactor,
    screenshotRect.y / scaleFactor,
    screenshotRect.width / scaleFactor,
    screenshotRect.height / scaleFactor
  );
}

// Check if a point is inside a rectangle
export function pointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// Calculate the center point of a rectangle
export function rectCenter(rect: Rect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

// Expand a rectangle by a given amount (can be negative to shrink)
export function expandRect(rect: Rect, dx: number, dy: number): Rect {
  return createRect(
    rect.x - dx,
    rect.y - dy,
    rect.width + 2 * dx,
    rect.height + 2 * dy
  );
}

// Clamp a rectangle within bounds
export function clampRect(rect: Rect, bounds: Rect): Rect {
  return createRect(
    Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - rect.width)),
    Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - rect.height)),
    Math.min(rect.width, bounds.width),
    Math.min(rect.height, bounds.height)
  );
}

// Self-check/demonstration functions
// These tests will only run when vitest is available
if (typeof import.meta !== 'undefined' && (import.meta as any).vitest) {
  const { describe, it, expect } = (import.meta as any).vitest;

  describe('geometry.ts', () => {
    it('calculates area correctly', () => {
      const rect: Rect = createRect(0, 0, 10, 5);
      expect(area(rect)).toBe(50);
    });

    it('checks containment correctly', () => {
      const container: Rect = createRect(0, 0, 20, 20);
      const targetInside: Rect = createRect(5, 5, 10, 10);
      const targetOutside: Rect = createRect(25, 5, 10, 10);

      expect(contains(container, targetInside)).toBe(true);
      expect(contains(container, targetOutside)).toBe(false);
    });

    it('checks intersection correctly', () => {
      const a: Rect = createRect(0, 0, 10, 10);
      const b: Rect = createRect(5, 5, 10, 10);
      const c: Rect = createRect(20, 20, 10, 10);

      expect(intersects(a, b)).toBe(true);
      expect(intersects(a, c)).toBe(false);
    });

    it('calculates intersection correctly', () => {
      const a: Rect = createRect(0, 0, 10, 10);
      const b: Rect = createRect(5, 5, 10, 10);
      const intersection = intersect(a, b);

      expect(intersection).not.toBeNull();
      if (intersection) {
        expect(intersection.x).toBe(5);
        expect(intersection.y).toBe(5);
        expect(intersection.width).toBe(5);
        expect(intersection.height).toBe(5);
      }
    });

    it('calculates union correctly', () => {
      const a: Rect = createRect(0, 0, 10, 10);
      const b: Rect = createRect(5, 5, 10, 10);
      const unionRect = union(a, b);

      expect(unionRect.x).toBe(0);
      expect(unionRect.y).toBe(0);
      expect(unionRect.width).toBe(15);
      expect(unionRect.height).toBe(15);
    });

    it('calculates IoU correctly', () => {
      const a: Rect = createRect(0, 0, 10, 10);
      const b: Rect = createRect(5, 5, 10, 10);
      const overlap = iou(a, b);

      // Intersection: 5x5 = 25
      // Union: 100 + 100 - 25 = 175
      // IoU: 25/175 = 1/7 ≈ 0.142857
      expect(overlap).toBeCloseTo(0.142857);
    });

    it('quantizes to grid correctly', () => {
      expect(quantize(10, 4)).toBe(12); // 10/4=2.5 -> round to 3 -> 3*4=12
      expect(quantize(11, 4)).toBe(12); // 11/4=2.75 -> round to 3 -> 3*4=12
      expect(quantize(12, 4)).toBe(12); // 12/4=3 -> round to 3 -> 3*4=12
      expect(quantize(13, 4)).toBe(12); // 13/4=3.25 -> round to 3 -> 3*4=12
      expect(quantize(14, 4)).toBe(16); // 14/4=3.5 -> round to 4 -> 4*4=16
    });

    it('quantizes rect to 4px grid correctly', () => {
      const rect: Rect = createRect(10, 11, 15, 17);
      const quantized = quantizeRect(rect, 4);

      expect(quantized.x).toBe(12); // 10 -> 12
      expect(quantized.y).toBe(12); // 11 -> 12
      expect(quantized.width).toBe(16); // 15 -> 16
      expect(quantized.height).toBe(16); // 17 -> 16
    });

    it('transforms viewport to screenshot and back correctly', () => {
      const viewportRect: Rect = createRect(10, 20, 100, 50);
      const scaleFactor = 2;

      const screenshotRect = viewportToScreenshot(viewportRect, scaleFactor);
      expect(screenshotRect.x).toBe(20);
      expect(screenshotRect.y).toBe(40);
      expect(screenshotRect.width).toBe(200);
      expect(screenshotRect.height).toBe(100);

      const backToViewport = screenshotToViewport(screenshotRect, scaleFactor);
      expect(backToViewport.x).toBe(10);
      expect(backToViewport.y).toBe(20);
      expect(backToViewport.width).toBe(100);
      expect(backToViewport.height).toBe(50);
    });

    it('calculates area union over multiple rects', () => {
      const rects: Rect[] = [
        createRect(0, 0, 10, 10),
        createRect(5, 5, 10, 10),
        createRect(20, 20, 5, 5)
      ];

      const unionArea = areaUnion(rects);
      // First two rects overlap: area = 10*10 + 10*10 - 5*5 = 100 + 100 - 25 = 175
      // Third rect is separate: area = 5*5 = 25
      // Total: 175 + 25 = 200
      expect(unionArea).toBe(200);
    });
  });
}