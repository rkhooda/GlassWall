import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedFrame, RawElement, RawObservation } from '@glasswall/schema/observation';
import type { PerceptionContext } from '@glasswall/privacy';

const initOcrWorker = vi.fn();
const runOcrOnCrops = vi.fn();

vi.mock('@glasswall/inference/ocr', async () => {
  const actual = await vi.importActual<typeof import('@glasswall/inference/ocr')>('@glasswall/inference/ocr');
  return { ...actual, initOcrWorker, runOcrOnCrops };
});
// NER over OCR text is best effort; keep the model out of this unit test.
vi.mock('@glasswall/inference/ner', () => ({ isNerAvailable: () => false, runNer: vi.fn(), nerTypeToPii: (t: string) => t }));

const { OCR_TIMEOUT, OCR_UNAVAILABLE, SCREENSHOT_DISABLED, getOcrStats, ocrSource, resetOcrState } = await import('./ocr');

type Rect = [number, number, number, number];

const canvas = (id: string, rect: Rect): RawElement => ({
  id,
  id_hash: `h_${id}`,
  tag: 'canvas',
  role: 'img',
  label_raw: '',
  rect,
  visible: true,
  enabled: true,
  focusable: false,
  value_state: 'n/a',
  group: 'g',
  frame: 0,
});

const frame: CapturedFrame = {
  bitmap: {} as ImageBitmap,
  dpr: 1,
  viewport_w: 1280,
  viewport_h: 800,
  captured_at: 0,
  stale: false,
};

const context = (elements: RawElement[], withFrame = true): PerceptionContext => ({
  raw: {
    observation_id: 'obs',
    session_id: 'sess',
    step: 1,
    page: { origin_class: 'internal', url_template: '/t', title_raw: 'T', type_hint: 'other', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 800, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements,
    text_nodes: [],
    frames: [],
    truncated: false,
    list_virtualized: false,
  } as RawObservation,
  frame: withFrame ? frame : null,
  registry: new Map(),
  tokenizer: { tokenize: (v: string, t: string) => `⟦${t}⟧` } as never,
  policyProfile: 'BALANCED',
  screenshotEnabled: true,
});

beforeEach(() => {
  resetOcrState();
  initOcrWorker.mockReset().mockResolvedValue(undefined);
  runOcrOnCrops.mockReset().mockResolvedValue({ regions: [], timedOut: [], ms: 1 });
});

describe('skip instrumentation', () => {
  it('skips and records the reason when the DOM explains everything', async () => {
    const out = await ocrSource.run(context([]));

    expect(out.evidence).toEqual([]);
    expect(out.degraded).toEqual(['ocr_skipped_reason:no_unexplained_crops']);
    expect(initOcrWorker).not.toHaveBeenCalled();
  });

  it('reports a skip rate across steps', async () => {
    await ocrSource.run(context([]));
    await ocrSource.run(context([]));
    await ocrSource.run(context([canvas('c', [0, 0, 100, 100])]));

    const stats = getOcrStats();
    expect(stats).toMatchObject({ runs: 3, skipped: 2, lastSkipReason: 'no_unexplained_crops' });
    expect(stats.skipRate).toBeCloseTo(2 / 3);
  });
});

describe('crop budget', () => {
  it('issues only 6 crops on a 20-region page and masks the other 14', async () => {
    const elements = Array.from({ length: 20 }, (_, i) => canvas(`c${i}`, [0, i * 30, 100 + i, 20]));

    const out = await ocrSource.run(context(elements));

    expect(runOcrOnCrops).toHaveBeenCalledTimes(1);
    expect(runOcrOnCrops.mock.calls[0]![0]).toHaveLength(6);

    const deferred = out.unexplained!.filter(u => u.reason === 'crop_budget_exceeded');
    expect(deferred).toHaveLength(14);
  });

  it('renders each crop no larger than 512px on its longest side', async () => {
    await ocrSource.run(context([canvas('big', [0, 0, 1024, 300])]));

    const [crops] = runOcrOnCrops.mock.calls[0]!;
    const { geometry } = crops[0];
    expect(Math.max(geometry.width, geometry.height)).toBeLessThanOrEqual(512);
  });
});

describe('fail closed', () => {
  it('masks every region when the worker will not start', async () => {
    initOcrWorker.mockRejectedValue(new Error('vendored worker missing'));
    const elements = Array.from({ length: 3 }, (_, i) => canvas(`c${i}`, [0, i * 30, 100, 20]));

    const out = await ocrSource.run(context(elements));

    expect(out.evidence).toEqual([]);
    expect(out.degraded).toHaveLength(1);
    expect(out.degraded![0]).toMatch(new RegExp(`^${OCR_UNAVAILABLE}`));
    expect(out.unexplained).toHaveLength(3);
  });

  it('leaves a timed-out region unexplained rather than unmasked', async () => {
    const geometry = { rect: [10, 20, 100, 50] as Rect, scale: 1, width: 100, height: 50 };
    runOcrOnCrops.mockResolvedValue({ regions: [], timedOut: [geometry], ms: 6000 });

    const out = await ocrSource.run(context([canvas('c', [10, 20, 100, 50])]));

    expect(out.degraded).toEqual([OCR_TIMEOUT]);
    expect(out.unexplained).toContainEqual({ rect: [10, 20, 100, 50], reason: OCR_TIMEOUT });
  });

  it('masks the regions when there is no captured frame to crop from', async () => {
    const out = await ocrSource.run(context([canvas('c', [0, 0, 100, 100])], false));

    expect(out.degraded).toEqual(['no_frame']);
    expect(out.unexplained).toEqual([{ rect: [0, 0, 100, 100], reason: 'no_frame' }]);
  });
});

describe('evidence', () => {
  it('runs the detectors over recognised text and carries only their hits, in viewport coordinates', async () => {
    runOcrOnCrops.mockResolvedValue({
      regions: [{ rect: [10, 20, 100, 50], text: 'LAB REPORT\nAadhaar 2345 6789 0124\nName: Priya Raghunathan', confidence: 0.94, words: [] }],
      timedOut: [],
      ms: 40,
    });

    const out = await ocrSource.run(context([canvas('c', [10, 20, 100, 50])]));

    expect(out.evidence.map(e => `${e.piiType}:${e.textSpan}`).sort()).toEqual(['AADHAAR:2345 6789 0124', 'PERSON_NAME:Priya Raghunathan']);
    expect(out.evidence.every(e => e.sourceId === 'ocr' && e.type === 'ocr' && e.rect?.join() === '10,20,100,50')).toBe(true);
    // The heading is not evidence: it is neither a recognizer hit nor labelled.
    expect(out.evidence.some(e => /LAB REPORT/i.test(e.textSpan ?? ''))).toBe(false);
  });

  it('drops empty recognitions', async () => {
    runOcrOnCrops.mockResolvedValue({
      regions: [{ rect: [0, 0, 10, 10], text: '   ', confidence: 0.1, words: [] }],
      timedOut: [],
      ms: 5,
    });

    const out = await ocrSource.run(context([canvas('c', [0, 0, 10, 10])]));
    expect(out.evidence).toEqual([]);
  });
});

describe('lazy loading by policy (P13-B)', () => {
  it('never loads the OCR engine when the policy disables the screenshot', async () => {
    const out = await ocrSource.run({
      ...context([canvas('c', [0, 0, 300, 200])]),
      screenshotEnabled: false,
    });

    expect(initOcrWorker).not.toHaveBeenCalled();
    // Fail-closed: not loading the model costs utility, never privacy.
    expect(out.evidence).toEqual([]);
    expect(out.degraded).toContain(SCREENSHOT_DISABLED);
    expect(out.unexplained).toEqual([{ rect: [0, 0, 300, 200], reason: SCREENSHOT_DISABLED }]);
  });

  it('gates on the policy, not on a frame that happened to arrive', async () => {
    // A frame is present but the profile says no screenshot: the model still must
    // not load. Gating on `frame !== null` would have loaded it here.
    const out = await ocrSource.run({
      ...context([canvas('c', [0, 0, 300, 200])], true),
      screenshotEnabled: false,
    });

    expect(initOcrWorker).not.toHaveBeenCalled();
    expect(out.degraded).toContain(SCREENSHOT_DISABLED);
  });
});
