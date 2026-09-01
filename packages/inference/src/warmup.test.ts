import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadNerModel = vi.fn().mockResolvedValue({ ms: 1, ep: 'wasm' });
const runNer = vi.fn().mockResolvedValue({ spans: [], modelId: 'ner-base', inferenceMs: 1 });
const initOcrWorker = vi.fn().mockResolvedValue(undefined);

vi.mock('./ner', async () => ({ ...(await vi.importActual<object>('./ner')), loadNerModel, runNer }));
vi.mock('./ocr', async () => ({ ...(await vi.importActual<object>('./ocr')), initOcrWorker }));

const { planWarmup, warmUpInference } = await import('./warmup');

const STRICT = { screenshot: { enabled: false } };
const BALANCED = { screenshot: { enabled: true } };

beforeEach(() => {
  loadNerModel.mockClear();
  runNer.mockClear();
  initOcrWorker.mockClear();
});

describe('planWarmup', () => {
  it('loads OCR only where a screenshot exists to read', () => {
    expect(planWarmup(STRICT)).toEqual({ ner: true, ocr: false });
    expect(planWarmup(BALANCED)).toEqual({ ner: true, ocr: true });
  });
});

describe('warmUpInference', () => {
  it('runs a dummy inference, not just a load — the first run is where the cost is', async () => {
    await warmUpInference(BALANCED);
    expect(loadNerModel).toHaveBeenCalledOnce();
    expect(runNer).toHaveBeenCalledOnce();
    expect(initOcrWorker).toHaveBeenCalledOnce();
  });

  it('never touches the 43MB OCR engine under STRICT', async () => {
    const report = await warmUpInference(STRICT);
    expect(initOcrWorker).not.toHaveBeenCalled();
    expect(report.ocr).toMatchObject({ ran: false, reason: 'screenshot_disabled' });
  });

  it('swallows a load failure and reports it — a dead warm-up must not be a dead install', async () => {
    loadNerModel.mockRejectedValueOnce(new Error('weights missing'));

    const report = await warmUpInference(BALANCED);
    expect(report.ner.ran).toBe(false);
    expect(report.ner.reason).toContain('weights missing');
    // The other model still warms: one failure does not cancel the rest.
    expect(initOcrWorker).toHaveBeenCalledOnce();
  });
});
