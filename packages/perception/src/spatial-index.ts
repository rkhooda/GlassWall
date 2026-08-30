import { Rect, createRect, intersects } from './geometry';

export interface IndexedRect {
  rect: Rect;
  id: string;
  source: string;
  data: unknown;
}

interface GridCell {
  rects: IndexedRect[];
}

export class UniformGridIndex {
  private readonly cellSize: number;
  private readonly grid: Map<string, GridCell> = new Map();
  private readonly bounds: Rect;

  constructor(bounds: Rect, cellSize: number = 64) {
    this.bounds = bounds;
    this.cellSize = cellSize;
  }

  private getCellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  private getCellsForRect(rect: Rect): string[] {
    const minX = Math.floor(rect.x / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);

    const keys: string[] = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        keys.push(`${cx},${cy}`);
      }
    }
    return keys;
  }

  insert(item: IndexedRect): void {
    const keys = this.getCellsForRect(item.rect);
    for (const key of keys) {
      let cell = this.grid.get(key);
      if (!cell) {
        cell = { rects: [] };
        this.grid.set(key, cell);
      }
      cell.rects.push(item);
    }
  }

  query(rect: Rect): IndexedRect[] {
    const keys = this.getCellsForRect(rect);
    const results: IndexedRect[] = [];
    const seen = new Set<string>();

    for (const key of keys) {
      const cell = this.grid.get(key);
      if (!cell) continue;

      for (const item of cell.rects) {
        if (seen.has(item.id)) continue;
        if (intersects(rect, item.rect)) {
          results.push(item);
          seen.add(item.id);
        }
      }
    }

    return results;
  }

  queryPoint(x: number, y: number): IndexedRect[] {
    const key = this.getCellKey(x, y);
    const cell = this.grid.get(key);
    if (!cell) return [];

    const results: IndexedRect[] = [];
    for (const item of cell.rects) {
      if (x >= item.rect.x && x <= item.rect.x + item.rect.width &&
          y >= item.rect.y && y <= item.rect.y + item.rect.height) {
        results.push(item);
      }
    }
    return results;
  }

  clear(): void {
    this.grid.clear();
  }

  getStats(): { cells: number; totalRects: number } {
    let totalRects = 0;
    for (const cell of this.grid.values()) {
      totalRects += cell.rects.length;
    }
    return { cells: this.grid.size, totalRects };
  }
}

export function buildSpatialIndex(
  items: Array<{ id: string; rect: Rect; source: string; data: unknown }>,
  bounds: Rect,
  cellSize: number = 64
): UniformGridIndex {
  const index = new UniformGridIndex(bounds, cellSize);
  for (const item of items) {
    index.insert(item);
  }
  return index;
}