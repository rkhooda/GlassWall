import { describe, expect, it } from 'vitest';
import { characterAccuracy, characterErrorRate, recallByType, spanF1 } from './detection';

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
