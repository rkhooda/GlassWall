import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawObservation, RawTextNode } from '@glasswall/schema/observation';
import type { PerceptionContext } from '@glasswall/privacy';

const loadNerModel = vi.fn();
const runNer = vi.fn();

vi.mock('@glasswall/inference/ner', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@glasswall/inference/ner');
  return { ...actual, loadNerModel, runNer };
});

const { NER_UNAVAILABLE, nerSource, resetNerState } = await import('./ner');

const textNodes: RawTextNode[] = [
  { id: 'tn1', rect: [0, 0, 200, 20], text: 'Priya Raghunathan', owner_element_id: 'e1', source: 'dom' },
  { id: 'tn2', rect: [0, 25, 200, 20], text: 'lives in Bengaluru', owner_element_id: 'e2', source: 'dom' },
];

const context = (nodes: RawTextNode[] = textNodes): PerceptionContext => ({
  raw: {
    observation_id: 'obs',
    session_id: 'sess',
    step: 1,
    page: { origin_class: 'internal', url_template: '/t', title_raw: 'T', type_hint: 'other', modal_active: false, stability: 'stable' },
    viewport: { w: 800, h: 600, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [],
    text_nodes: nodes,
    frames: [],
    truncated: false,
    list_virtualized: false,
  } as RawObservation,
  frame: null,
  registry: new Map(),
  tokenizer: { tokenize: (v: string, t: string) => `⟦${t}⟧` } as never,
  policyProfile: 'BALANCED',
  screenshotEnabled: true,
});

beforeEach(() => {
  resetNerState();
  loadNerModel.mockReset().mockResolvedValue({ ms: 1, ep: 'wasm' });
  runNer.mockReset().mockResolvedValue({ spans: [], modelId: 'ner-base', inferenceMs: 1 });
});

describe('load failure', () => {
  it('degrades to ner_unavailable and masks every text block', async () => {
    loadNerModel.mockRejectedValue(new Error('model file missing'));

    const out = await nerSource.run(context());

    expect(out.evidence).toEqual([]);
    expect(out.degraded).toEqual([NER_UNAVAILABLE]);
    expect(out.unexplained).toEqual([
      { rect: [0, 0, 200, 20], reason: NER_UNAVAILABLE },
      { rect: [0, 25, 200, 20], reason: NER_UNAVAILABLE },
    ]);
  });

  it('redacts strictly more than a successful run', async () => {
    loadNerModel.mockRejectedValue(new Error('model file missing'));
    const failed = await nerSource.run(context());

    resetNerState();
    loadNerModel.mockResolvedValue({ ms: 1, ep: 'wasm' });
    const succeeded = await nerSource.run(context());

    expect(failed.unexplained!.length).toBeGreaterThan((succeeded.unexplained ?? []).length);
  });

  it('does not retry a model that already failed to load', async () => {
    loadNerModel.mockRejectedValue(new Error('model file missing'));
    await nerSource.run(context());
    await nerSource.run(context());
    expect(loadNerModel).toHaveBeenCalledTimes(1);
  });

  it('degrades the same way when the run itself throws', async () => {
    runNer.mockRejectedValue(new Error('backend crashed'));
    const out = await nerSource.run(context());
    expect(out.degraded).toEqual([NER_UNAVAILABLE]);
    expect(out.unexplained).toHaveLength(2);
  });
});

describe('evidence', () => {
  it('carries the matched text, its node rect and a coarse PII type', async () => {
    // Source-coordinate spans over "Priya Raghunathan lives in Bengaluru".
    runNer.mockResolvedValue({
      spans: [
        { start: 0, end: 17, type: 'PER', confidence: 0.97 },
        { start: 27, end: 36, type: 'LOC', confidence: 0.81 },
      ],
      modelId: 'ner-base',
      inferenceMs: 5,
    });

    const out = await nerSource.run(context());

    expect(out.degraded).toBeUndefined();
    expect(out.evidence).toEqual([
      { sourceId: 'ner', type: 'ner', piiType: 'NAME', confidence: 0.97, rect: [0, 0, 200, 20], textSpan: 'Priya Raghunathan', elementId: 'tn1' },
      { sourceId: 'ner', type: 'ner', piiType: 'ADDRESS', confidence: 0.81, rect: [0, 25, 200, 20], textSpan: 'Bengaluru', elementId: 'tn2' },
    ]);
  });

  it('runs on text blocks only, never on a value', async () => {
    await nerSource.run(context());
    expect(runNer).toHaveBeenCalledWith('Priya Raghunathan lives in Bengaluru', expect.any(Number));
  });

  it('thresholds confidence by policy profile', async () => {
    await nerSource.run({ ...context(), policyProfile: 'STRICT' });
    await nerSource.run({ ...context(), policyProfile: 'PERMISSIVE' });

    const [, strict] = runNer.mock.calls[0]!;
    const [, permissive] = runNer.mock.calls[1]!;
    expect(strict).toBeLessThan(permissive as number);
  });

  it('does nothing when there is no text', async () => {
    const out = await nerSource.run(context([]));
    expect(out).toEqual({ evidence: [] });
    expect(loadNerModel).not.toHaveBeenCalled();
  });
});
