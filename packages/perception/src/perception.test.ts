import { describe, expect, it } from 'vitest';
import { createRect, intersect, iou, quantizeRect } from './geometry';
import { UniformGridIndex } from './spatial-index';

describe('perception geometry', () => {
  it('computes overlap and quantizes observation rectangles', () => {
    const a = createRect(3, 5, 20, 10);
    const b = createRect(13, 10, 20, 10);

    expect(intersect(a, b)).toEqual(createRect(13, 10, 10, 5));
    expect(iou(a, b)).toBeCloseTo(50 / 350);
    expect(quantizeRect(a)).toEqual(createRect(4, 4, 20, 12));
  });
});

describe('perception spatial index', () => {
  it('returns intersecting regions once', () => {
    const index = new UniformGridIndex(createRect(0, 0, 256, 256), 64);
    index.insert({ id: 'field', rect: createRect(60, 60, 80, 40), source: 'dom', data: null });

    expect(index.query(createRect(64, 64, 4, 4)).map(item => item.id)).toEqual(['field']);
    expect(index.query(createRect(200, 200, 10, 10))).toEqual([]);
  });
});
