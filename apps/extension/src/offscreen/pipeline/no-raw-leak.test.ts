import { describe, expect, it, vi } from 'vitest';
import { assertNoValuesInAudit, sanitize, type AuditPrivacyFields } from '@glasswall/privacy';
import type { CapturedFrame, RawObservation } from '@glasswall/schema/observation';

const initOcrWorker = vi.fn().mockResolvedValue(undefined);
const runOcrOnCrops = vi.fn();
const loadNerModel = vi.fn().mockResolvedValue({ ms: 1, ep: 'wasm' });
const runNer = vi.fn();

vi.mock('@glasswall/inference/ocr', async () => {
  const actual = await vi.importActual<typeof import('@glasswall/inference/ocr')>('@glasswall/inference/ocr');
  return { ...actual, initOcrWorker, runOcrOnCrops };
});
vi.mock('@glasswall/inference/ner', async () => {
  const actual = await vi.importActual<typeof import('@glasswall/inference/ner')>('@glasswall/inference/ner');
  return { ...actual, loadNerModel, runNer };
});

const { ocrSource } = await import('./ocr');
const { nerSource } = await import('./ner');

const OCR_SECRET = 'Aadhaar 4321 8765 2109 on the scanned card';
const NER_SECRET = 'Priya Raghunathan';

const raw: RawObservation = {
  observation_id: 'obs',
  session_id: 'sess',
  step: 1,
  page: { origin_class: 'internal', url_template: '/t', title_raw: 'T', type_hint: 'other', modal_active: false, stability: 'stable' },
  viewport: { w: 1280, h: 800, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
  elements: [
    {
      id: 'c1', id_hash: 'h1', tag: 'canvas', role: 'img', label_raw: '',
      rect: [0, 0, 300, 200], visible: true, enabled: true, focusable: false,
      value_state: 'n/a', group: 'g', frame: 0,
    },
  ],
  text_nodes: [
    { id: 'tn1', rect: [0, 220, 300, 20], text: `${NER_SECRET} signed the form`, owner_element_id: 'c1', source: 'dom' },
  ],
  frames: [],
  truncated: false,
  list_virtualized: false,
};

const frame: CapturedFrame = {
  bitmap: {} as ImageBitmap,
  dpr: 1,
  viewport_w: 1280,
  viewport_h: 800,
  captured_at: 0,
  stale: false,
};

/**
 * The security acceptance for P8/P9: what the model reads never reaches the payload.
 * Raw OCR text and NER-matched text are tokenized on the way through sanitize();
 * only handles survive into the SanitizedObservation.
 */
describe('raw perception output never reaches the payload', () => {
  it('keeps OCR and NER text out of the sanitized observation', async () => {
    runOcrOnCrops.mockResolvedValue({
      regions: [{ rect: [0, 0, 300, 200], text: OCR_SECRET, confidence: 0.93, words: [] }],
      timedOut: [],
      ms: 30,
    });
    runNer.mockResolvedValue({
      spans: [{ start: 0, end: NER_SECRET.length, type: 'PER', confidence: 0.96 }],
      modelId: 'ner-base',
      inferenceMs: 4,
    });

    const result = await sanitize({
      raw,
      frame,
      task: 'test',
      step: 1,
      session: { session_id: 'sess', policy_profile: 'BALANCED' },
      perceptionSources: [ocrSource, nerSource],
    });

    const payload = JSON.stringify(result.observation);
    expect(payload).not.toContain(OCR_SECRET);
    expect(payload).not.toContain('4321 8765 2109');
    expect(payload).not.toContain(NER_SECRET);

    expect(() => assertNoValuesInAudit(result.audit as AuditPrivacyFields)).not.toThrow();
    expect(JSON.stringify(result.audit)).not.toContain(OCR_SECRET);
    expect(JSON.stringify(result.audit)).not.toContain(NER_SECRET);
  });

  it('masks the canvas region when OCR cannot read it', async () => {
    initOcrWorker.mockRejectedValueOnce(new Error('worker missing'));
    runNer.mockResolvedValue({ spans: [], modelId: 'ner-base', inferenceMs: 1 });

    const result = await sanitize({
      raw,
      frame,
      task: 'test',
      step: 1,
      session: { session_id: 'sess', policy_profile: 'STRICT' },
      perceptionSources: [ocrSource],
    });

    expect(result.degraded).toContain('ocr_unavailable');

    // The canvas is withheld either way. Since P11 the region goes through fusion,
    // so the reason is the human-readable sentence the audit record carries and the
    // attribution is whichever evidence claimed it — asserting on an exact source id
    // would pin an implementation detail rather than the property that matters.
    const covering = result.redactions.find(r => r.rect[0] <= 0 && r.rect[1] <= 0 && r.rect[2] >= 300);
    expect(covering, 'the unreadable canvas was not redacted').toBeDefined();
    expect(covering!.reason).toMatch(/^(DROP|MASK):/);
    expect(covering!.reason).toContain('canvas');
  });
});
