import { describe, expect, it, vi, afterEach } from 'vitest';
import type { RawElement, RawObservation } from '@glasswall/schema/observation';
import {
  MAX_CROPS_PER_STEP,
  MAX_CROP_LONGEST_SIDE,
  NO_UNEXPLAINED_CROPS,
  boxToViewport,
  cropGeometry,
  findUnexplainedRegions,
  ocrSkipReason,
  selectCrops,
  type Rect,
} from './crop-policy';

const element = (id: string, tag: string, rect: Rect, extra: Partial<RawElement> = {}): RawElement => ({
  id,
  id_hash: `h_${id}`,
  tag,
  role: 'img',
  label_raw: '',
  rect,
  visible: true,
  enabled: true,
  focusable: false,
  value_state: 'n/a',
  group: 'g',
  frame: 0,
  ...extra,
});

const observation = (over: Partial<RawObservation> = {}): RawObservation => ({
  observation_id: 'obs',
  session_id: 'sess',
  step: 1,
  page: { origin_class: 'internal', url_template: '/t', title_raw: 'T', type_hint: 'other', modal_active: false, stability: 'stable' },
  viewport: { w: 1280, h: 800, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
  elements: [],
  text_nodes: [],
  frames: [],
  truncated: false,
  list_virtualized: false,
  ...over,
});

describe('unexplained region detection', () => {
  it('picks up opaque media the DOM cannot read', () => {
    const raw = observation({
      elements: [
        element('c', 'canvas', [0, 0, 200, 100]),
        element('i', 'img', [0, 100, 200, 100]),
        element('p', 'p', [0, 200, 200, 20], { role: 'text', label_raw: 'plain text' }),
      ],
    });
    expect(findUnexplainedRegions(raw).map(r => r.reason)).toEqual(['opaque_canvas', 'opaque_img']);
  });

  it('picks up cross-origin iframes', () => {
    const raw = observation({ frames: [{ id: 1, origin: 'cross', rect: [10, 10, 300, 300] }] });
    expect(findUnexplainedRegions(raw)[0]!.reason).toBe('cross_origin_iframe');
  });

  it('ignores invisible and zero-area regions', () => {
    const raw = observation({
      elements: [
        element('a', 'canvas', [0, 0, 200, 100], { visible: false }),
        element('b', 'canvas', [0, 0, 0, 0]),
      ],
    });
    expect(findUnexplainedRegions(raw)).toEqual([]);
  });
});

describe('crop budget', () => {
  it('issues at most 6 crops on a 20-region page and defers the rest', () => {
    const raw = observation({
      elements: Array.from({ length: 20 }, (_, i) =>
        element(`c${i}`, 'canvas', [0, i * 30, 100 + i, 20])
      ),
    });
    const regions = findUnexplainedRegions(raw);
    expect(regions).toHaveLength(20);

    const { crops, deferred } = selectCrops(regions);
    expect(crops).toHaveLength(MAX_CROPS_PER_STEP);
    expect(deferred).toHaveLength(14);
    expect(crops.length + deferred.length).toBe(regions.length);
  });

  it('ranks by area, breaking ties on suspicion', () => {
    const regions = [
      { rect: [0, 0, 10, 10] as Rect, reason: 'small', area: 100, suspicion: 0.9 },
      { rect: [0, 0, 50, 50] as Rect, reason: 'big', area: 2500, suspicion: 0.1 },
      { rect: [0, 0, 10, 10] as Rect, reason: 'tie-low', area: 100, suspicion: 0.2 },
    ];
    expect(selectCrops(regions, 3).crops.map(r => r.reason)).toEqual(['big', 'small', 'tie-low']);
  });

  it('never exceeds the budget however many regions arrive', () => {
    const regions = Array.from({ length: 500 }, (_, i) => ({
      rect: [0, i, 10, 10] as Rect,
      reason: 'r',
      area: 100,
      suspicion: 0.5,
    }));
    expect(selectCrops(regions).crops.length).toBeLessThanOrEqual(MAX_CROPS_PER_STEP);
  });
});

describe('crop geometry', () => {
  it('clamps a region to the viewport', () => {
    const geom = cropGeometry([-50, -50, 5000, 5000], 1280, 800);
    expect(geom.rect).toEqual([0, 0, 1280, 800]);
  });

  it('downscales so the longest side fits the cap', () => {
    const geom = cropGeometry([0, 0, 1024, 300], 1280, 800);
    expect(Math.max(geom.width, geom.height)).toBeLessThanOrEqual(MAX_CROP_LONGEST_SIDE);
    expect(geom.scale).toBeCloseTo(0.5);
    expect(geom.width).toBe(512);
    expect(geom.height).toBe(150);
  });

  it('leaves small regions untouched', () => {
    const geom = cropGeometry([10, 20, 200, 100], 1280, 800);
    expect(geom.scale).toBe(1);
    expect(geom.width).toBe(200);
  });
});

describe('coordinate round trip', () => {
  const within3px = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) <= 3);

  it('maps a box back to viewport coordinates within 3px', () => {
    const geom = cropGeometry([100, 50, 1024, 300], 1280, 800);
    const word: Rect = [200, 80, 40, 20];

    // Forward: viewport -> crop pixels, rounded the way a raster box would be.
    const box = {
      x0: Math.round((word[0] - geom.rect[0]) * geom.scale),
      y0: Math.round((word[1] - geom.rect[1]) * geom.scale),
      x1: Math.round((word[0] + word[2] - geom.rect[0]) * geom.scale),
      y1: Math.round((word[1] + word[3] - geom.rect[1]) * geom.scale),
    };

    expect(within3px(boxToViewport(box, geom), word)).toBe(true);
  });

  it('is exact for an unscaled crop', () => {
    const geom = cropGeometry([40, 60, 200, 100], 1280, 800);
    expect(boxToViewport({ x0: 5, y0: 10, x1: 45, y1: 30 }, geom)).toEqual([45, 70, 40, 20]);
  });
});

describe('skip instrumentation', () => {
  it('reports the skip reason when the DOM explains everything', () => {
    const raw = observation({ elements: [element('p', 'p', [0, 0, 100, 20], { role: 'text' })] });
    expect(ocrSkipReason(raw)).toBe(NO_UNEXPLAINED_CROPS);
  });

  it('does not skip when something is unexplained', () => {
    const raw = observation({ elements: [element('c', 'canvas', [0, 0, 100, 100])] });
    expect(ocrSkipReason(raw)).toBeNull();
  });
});

describe('offline guarantee', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('points worker, core and language data at bundled assets', async () => {
    const { tesseractPaths, TESSERACT_BASE_URL } = await import('./wrapper');
    const paths = tesseractPaths();

    for (const path of [paths.workerPath, paths.corePath, paths.langPath]) {
      expect(path.startsWith(TESSERACT_BASE_URL)).toBe(true);
      expect(/^https?:/i.test(path)).toBe(false);
    }
    expect(paths.workerBlobURL).toBe(false);
    expect(paths.cacheMethod).toBe('none');
  });

  it('reaches no remote host when the vendored worker is missing', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      seen.push(String(input));
      return Promise.reject(new Error('network disconnected'));
    }));

    const { initOcrWorker, terminateOcrWorker } = await import('./wrapper');
    await expect(initOcrWorker()).rejects.toThrow();
    await terminateOcrWorker();

    expect(seen.filter(url => /^https?:/i.test(url))).toEqual([]);
  });
});
