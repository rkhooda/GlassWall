import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spanF1, recallByType, type LabelledSpan } from '../../../../eval/metrics/detection';
import { generatePersona } from '../../../../apps/bench-site/src/data/generator';
import type { NerDtype } from './wrapper';

/**
 * P13-B — the quantization sweep, run rather than assumed.
 *
 * MODEL_MANIFEST.json records that bert-base-NER fails the 30MB size budget at
 * every published weight format. That is a claim about *file sizes*. This suite
 * asks the question those sizes cannot answer: does the one format smaller than
 * what we ship cost us accuracy, and would taking it help?
 *
 * Three points, same held-out set, same thresholds:
 *   q8     108.9MB — what ships
 *   q4f16   93.7MB — the only published format smaller than q8
 *   fp16   215.8MB — a higher-precision reference, to see whether q8 is already
 *                    losing accuracy or the model is simply this good and no better
 *
 * The extra formats are not vendored by default. Fetch them with
 * `bash ml/fetch-models.sh --sweep`; without them this suite skips loudly.
 */
const ONNX_DIR = resolve(__dirname, '../../../../apps/extension/public/models/ner-base/onnx');
const MODEL_DIR = resolve(ONNX_DIR, '..');

const FILES: Record<NerDtype, string> = {
  q8: 'model_quantized.onnx',
  q4f16: 'model_q4f16.onnx',
  fp16: 'model_fp16.onnx',
  fp32: 'model.onnx',
};

const SWEEP: NerDtype[] = ['q8', 'q4f16', 'fp16'];
const HAVE_ALL = SWEEP.every(d => existsSync(resolve(ONNX_DIR, FILES[d])));

/** The 30MB acceptance budget from PLAN-B §6 P8. */
const SIZE_BUDGET_BYTES = 30 * 1024 * 1024;

const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i);

function heldOutSet(): { text: string; gold: LabelledSpan[] }[] {
  return SEEDS.map(seed => {
    const persona = generatePersona(seed);
    const text = persona.clinicalParagraph;
    const gold: LabelledSpan[] = [];
    for (const type of ['PERSON_NAME', 'STREET_ADDRESS'] as const) {
      for (const entry of persona.values.filter(v => v.type === type)) {
        const start = text.indexOf(entry.value);
        if (start >= 0) gold.push({ start, end: start + entry.value.length, type });
      }
    }
    return { text, gold };
  });
}

const PII_TO_LABEL: Record<string, string> = { NAME: 'PERSON_NAME', ADDRESS: 'STREET_ADDRESS' };

interface SweepRow {
  dtype: NerDtype;
  sizeMB: number;
  loadMs: number;
  p50Ms: number;
  f1: number;
  precision: number;
  recall: number;
  recallPersonName: number;
  recallStreetAddress: number;
  error?: string;
}

const rows: SweepRow[] = [];

describe.skipIf(!HAVE_ALL)('NER quantization sweep', () => {
  beforeAll(async () => {
    const cases = heldOutSet();
    const { lockdownTransformersEnv, loadNerModel, runNer, disposeNer, nerTypeToPii } =
      await import('./index');
    lockdownTransformersEnv(resolve(MODEL_DIR, '..') + '/');

    for (const dtype of SWEEP) {
      const sizeMB = statSync(resolve(ONNX_DIR, FILES[dtype])).size / 1048576;
      try {
        disposeNer();
        // Node's transformers.js backend exposes 'cpu' only. Accuracy is
        // device-independent; the latency column is CPU-EP and is labelled as such.
        const load = await loadNerModel('cpu', dtype);

        const predicted: LabelledSpan[] = [];
        const gold: LabelledSpan[] = [];
        const latencies: number[] = [];
        let offset = 0;

        for (const c of cases) {
          const start = performance.now();
          const { spans } = await runNer(c.text, 0.5);
          latencies.push(performance.now() - start);

          for (const s of spans) {
            const label = PII_TO_LABEL[nerTypeToPii(s.type)];
            if (label) predicted.push({ start: s.start + offset, end: s.end + offset, type: label });
          }
          for (const g of c.gold) gold.push({ start: g.start + offset, end: g.end + offset, type: g.type });
          offset += c.text.length + 1;
        }

        const score = spanF1(predicted, gold);
        const byType = recallByType(predicted, gold);
        latencies.sort((a, b) => a - b);

        rows.push({
          dtype,
          sizeMB: round(sizeMB),
          loadMs: round(load.ms),
          p50Ms: round(latencies[Math.floor(latencies.length / 2)] ?? 0),
          f1: round3(score.f1),
          precision: round3(score.precision),
          recall: round3(score.recall),
          recallPersonName: round3(byType.PERSON_NAME ?? 0),
          recallStreetAddress: round3(byType.STREET_ADDRESS ?? 0),
        });
      } catch (error) {
        rows.push({
          dtype, sizeMB: round(sizeMB), loadMs: 0, p50Ms: 0,
          f1: 0, precision: 0, recall: 0, recallPersonName: 0, recallStreetAddress: 0,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 160),
        });
      }
    }

    // Printed rather than snapshotted: this is a measurement whose job is to end up
    // in MODEL_CARD.md, and a snapshot would only pin today's hardware.
    console.log('\nNER quantization sweep (25 held-out paragraphs, CPU EP)\n');
    console.log('| dtype | size | load | p50 | F1 | precision | recall | PERSON_NAME | STREET_ADDRESS |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      console.log(
        r.error
          ? `| ${r.dtype} | ${r.sizeMB}MB | — | — | **did not run** | | | | ${r.error} |`
          : `| ${r.dtype} | ${r.sizeMB}MB | ${r.loadMs}ms | ${r.p50Ms}ms | ${r.f1} | ${r.precision} | ${r.recall} | ${r.recallPersonName} | ${r.recallStreetAddress} |`
      );
    }
    console.log('');
  }, 600_000);

  it('every published format still fails the 30MB budget', () => {
    // The decision the sweep exists to settle: quantization is not the lever.
    // Getting under 30MB needs a smaller encoder, not a smaller number format.
    for (const row of rows) {
      expect(row.sizeMB * 1048576, `${row.dtype} is ${row.sizeMB}MB`).toBeGreaterThan(SIZE_BUDGET_BYTES);
    }
  });

  it('the shipped format is not the one costing us accuracy', () => {
    const q8 = rows.find(r => r.dtype === 'q8');
    const fp16 = rows.find(r => r.dtype === 'fp16');
    expect(q8?.error, q8?.error).toBeUndefined();

    // If fp16 ran, q8 must not be materially worse than it. A gap here would mean
    // int8 quantization — not the encoder — is what caps recall, and the fix would
    // be different. As measured, it is not.
    if (fp16 && !fp16.error) {
      expect(q8!.f1).toBeGreaterThanOrEqual(fp16.f1 - 0.02);
    }
  });
});

describe.skipIf(HAVE_ALL)('NER quantization sweep', () => {
  it('did NOT run: the extra weight formats are not vendored', () => {
    expect(HAVE_ALL).toBe(false);
  });
});

const round = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
