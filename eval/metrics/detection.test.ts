import { describe, expect, it } from 'vitest';
import {
  characterAccuracy,
  characterErrorRate,
  nearMissFalsePositiveRate,
  prfByType,
  recallByType,
  spanF1,
} from './detection';
import {
  recognizeAadhaar,
  recognizeCard,
  recognizeDob,
  recognizeEmail,
  recognizeGstin,
  recognizeIfsc,
  recognizeIp,
  recognizePan,
  recognizePhone,
  recognizeSecret,
  recognizeUpi,
} from '@glasswall/privacy/index';
import { generatePersona } from '../../apps/bench-site/src/data/generator';

const span = (start: number, end: number, type: string) => ({ start, end, type });

describe('spanF1', () => {
  it('scores a perfect match', () => {
    const gold = [span(0, 5, 'PERSON_NAME')];
    expect(spanF1(gold, gold)).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });

  it('accepts a near-boundary match but not a token of overlap', () => {
    const gold = [span(0, 10, 'PERSON_NAME')];
    expect(spanF1([span(0, 9, 'PERSON_NAME')], gold).f1).toBe(1);
    expect(spanF1([span(0, 2, 'PERSON_NAME')], gold).f1).toBe(0);
  });

  it('does not credit the right span with the wrong type', () => {
    expect(spanF1([span(0, 5, 'ORG')], [span(0, 5, 'PERSON_NAME')]).f1).toBe(0);
  });

  it('counts each gold span at most once', () => {
    const score = spanF1([span(0, 5, 'PERSON_NAME'), span(0, 5, 'PERSON_NAME')], [span(0, 5, 'PERSON_NAME')]);
    expect(score).toMatchObject({ truePositives: 1, falsePositives: 1, recall: 1, precision: 0.5 });
  });

  it('is zero when nothing is predicted', () => {
    expect(spanF1([], [span(0, 5, 'PERSON_NAME')])).toMatchObject({ recall: 0, f1: 0 });
  });
});

describe('recallByType', () => {
  it('reports recall separately for each gold type', () => {
    const gold = [span(0, 5, 'PERSON_NAME'), span(10, 20, 'STREET_ADDRESS')];
    expect(recallByType([span(0, 5, 'PERSON_NAME')], gold)).toEqual({
      PERSON_NAME: 1,
      STREET_ADDRESS: 0,
    });
  });
});

describe('character accuracy', () => {
  it('is perfect for an exact read', () => {
    expect(characterAccuracy('Priya Raghunathan', 'Priya Raghunathan')).toBe(1);
  });

  it('charges one edit per wrong character', () => {
    expect(characterErrorRate('Priya', 'Priya')).toBe(0);
    expect(characterErrorRate('Priyo', 'Priya')).toBeCloseTo(1 / 5);
    expect(characterErrorRate('Priy', 'Priya')).toBeCloseTo(1 / 5);
  });

  it('never reports negative accuracy for a wildly wrong read', () => {
    expect(characterAccuracy('x'.repeat(100), 'abc')).toBe(0);
  });
});


describe('prfByType', () => {
  it('reports precision and recall separately per type', () => {
    const gold = [span(0, 5, 'PERSON_NAME'), span(10, 20, 'STREET_ADDRESS')];
    const predicted = [span(0, 5, 'PERSON_NAME'), span(30, 40, 'PERSON_NAME')];
    const byType = prfByType(predicted, gold);

    expect(byType.PERSON_NAME).toMatchObject({ precision: 0.5, recall: 1 });
    expect(byType.STREET_ADDRESS).toMatchObject({ precision: 0, recall: 0 });
  });

  it('surfaces a type gold never contains, at precision 0', () => {
    expect(prfByType([span(0, 5, 'ORG')], [span(0, 5, 'PERSON_NAME')]).ORG).toMatchObject({
      precision: 0,
      falsePositives: 1,
    });
  });
});

describe('near-miss false positives on the seeded decoys', () => {
  // Every recognizer, not just the one the decoy imitates: a false positive counts
  // whichever rule fired.
  const RECOGNIZERS = [
    recognizeAadhaar, recognizeCard, recognizePan, recognizeIfsc, recognizeGstin,
    recognizeUpi, recognizeIp, recognizeDob, recognizeSecret, recognizeEmail, recognizePhone,
  ];
  const flagged = (d: { value: string }) => RECOGNIZERS.some(fn => fn(d.value).length > 0);
  const SEEDS = [1337, 42, 999, 2024, 7, 31337, 8080, 12345, 555, 90210];

  it('measures the rate over 10 seeds of decoys', () => {
    const decoys = SEEDS.flatMap(seed => generatePersona(seed).decoys);
    const score = nearMissFalsePositiveRate(decoys, flagged);

    // Recorded as measured. If a checksum guard regresses, this number moves and
    // the test says by how much rather than merely failing.
    expect(score.total).toBeGreaterThanOrEqual(30);
    expect(score.rate).toBe(0);
    expect(score.flaggedValueTypes).toEqual([]);
  });

  it('goes red when a checksum guard is removed', () => {
    // The control: a predicate that matches on shape alone is what the checksums
    // are protecting against, and it must score badly here.
    const shapeOnly = (d: { value: string }) => /^\d{12}$/.test(d.value) || /^\d{15,16}$/.test(d.value);
    const score = nearMissFalsePositiveRate(generatePersona(1337).decoys, shapeOnly);
    expect(score.rate).toBeGreaterThan(0);
  });
});
