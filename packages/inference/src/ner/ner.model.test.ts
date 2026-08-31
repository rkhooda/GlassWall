import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { recallByType, spanF1, type LabelledSpan } from '../../../../eval/metrics/detection';
import { chunkText } from './chunk';
import { nerTypeToPii } from './types';

/**
 * P8 acceptance against the real weights: F1 >= 0.85, recall >= 0.90 for
 * PERSON_NAME and STREET_ADDRESS, p50 <= 700ms (WASM) for <= 2000 tokens, and
 * WebGPU/WASM parity.
 *
 * The weights are not in the repo (see MODEL_MANIFEST.json for what to vendor
 * and where). Until they are placed, this suite skips loudly rather than
 * reporting a number nobody measured.
 */
const MODEL_DIR = resolve(__dirname, '../../../../apps/extension/public/models/ner-base');
const HAVE_WEIGHTS = existsSync(resolve(MODEL_DIR, 'config.json'));

// A held-out sample. The full set comes from the seeded generator
// (apps/bench-site/src/data/generator.ts) via exportGroundTruth().
const CASES: Array<{ text: string; gold: LabelledSpan[] }> = [
  {
    text: 'Priya Raghunathan was seen at the clinic on 14 March and lives at 42 Residency Road, Bengaluru.',
    gold: [
      { start: 0, end: 17, type: 'PERSON_NAME' },
      { start: 65, end: 84, type: 'STREET_ADDRESS' },
    ],
  },
  {
    text: 'Contact Arjun Menon regarding the transfer to 7 Nehru Street, Kochi.',
    gold: [
      { start: 8, end: 19, type: 'PERSON_NAME' },
      { start: 45, end: 61, type: 'STREET_ADDRESS' },
    ],
  },
];

const PII_TO_LABEL: Record<string, string> = { NAME: 'PERSON_NAME', ADDRESS: 'STREET_ADDRESS' };

describe.skipIf(!HAVE_WEIGHTS)('NER against the real model', () => {
  let predict: (text: string) => Promise<LabelledSpan[]>;

  beforeAll(async () => {
    const { lockdownTransformersEnv, loadNerModel, runNer } = await import('./wrapper');
    lockdownTransformersEnv(resolve(MODEL_DIR, '..') + '/');
    await loadNerModel('wasm');

    predict = async text => {
      const { spans } = await runNer(text, 0.5);
      return spans
        .map(s => ({ start: s.start, end: s.end, type: PII_TO_LABEL[nerTypeToPii(s.type)] ?? 'OTHER' }))
        .filter(s => s.type !== 'OTHER');
    };
  });

  it('reaches F1 >= 0.85 on the held-out set', async () => {
    const predicted: LabelledSpan[] = [];
    const gold: LabelledSpan[] = [];
    let offset = 0;

    for (const testCase of CASES) {
      for (const span of await predict(testCase.text)) {
        predicted.push({ ...span, start: span.start + offset, end: span.end + offset });
      }
      for (const span of testCase.gold) {
        gold.push({ ...span, start: span.start + offset, end: span.end + offset });
      }
      offset += testCase.text.length;
    }

    const score = spanF1(predicted, gold);
    const recall = recallByType(predicted, gold);

    expect(score.f1).toBeGreaterThanOrEqual(0.85);
    expect(recall.PERSON_NAME).toBeGreaterThanOrEqual(0.9);
    expect(recall.STREET_ADDRESS).toBeGreaterThanOrEqual(0.9);
  });

  it('stays under 700ms p50 on WASM for 2000 tokens', async () => {
    const text = CASES.map(c => c.text).join(' ').repeat(30);
    expect(chunkText(text).length).toBeGreaterThan(1);

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await predict(text);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThanOrEqual(700);
  });

  it('gives the same spans on WebGPU and WASM', async () => {
    const { loadNerModel, runNer } = await import('./wrapper');
    const text = CASES[0]!.text;

    await loadNerModel('wasm');
    const wasm = (await runNer(text, 0.5)).spans;

    await loadNerModel('webgpu');
    const webgpu = (await runNer(text, 0.5)).spans;

    // Boundaries and labels must agree exactly; confidences may differ slightly
    // between execution providers.
    expect(webgpu.map(s => [s.start, s.end, s.type])).toEqual(wasm.map(s => [s.start, s.end, s.type]));
    for (const [i, span] of webgpu.entries()) {
      expect(span.confidence).toBeCloseTo(wasm[i]!.confidence, 2);
    }
  });
});

describe.skipIf(HAVE_WEIGHTS)('NER weights', () => {
  it('are not vendored, so the accuracy suite did not run', () => {
    expect(HAVE_WEIGHTS).toBe(false);
    // Intentional: MODEL_MANIFEST.json records what to place at
    // apps/extension/public/models/ner-base/ to turn the suite above on.
  });
});
