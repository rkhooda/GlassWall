import { describe, it, expect } from 'vitest';
import { dobRecognizer } from './dob';

describe('dobRecognizer', () => {
  const positiveCases = [
    '1990-01-15',
    '2000/12/25',
    '1985.06.30',
    '1950-12-31',
  ];

  const negativeCases = [
    '90-01-15',
    '2030-01-15',
    '1990-13-01',
    '1990-01-32',
    '1990-02-30',
  ];

  const nearMissCases = [
    '2015-01-01',
    '1899-12-31',
    '1990-01-1',
    '1990-1-15',
  ];

  for (const tc of positiveCases) {
    it(`detects valid DOB with context: ${tc}`, () => {
      const text = `Date of birth: ${tc}`;
      const spans = dobRecognizer.detect(text);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('DOB');
      expect(spans[0].tier).toBe(3);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid DOB: ${tc}`, () => {
      const text = `DOB: ${tc}`;
      const spans = dobRecognizer.detect(text);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss DOB: ${tc}`, () => {
      const text = `DOB: ${tc}`;
      const spans = dobRecognizer.detect(text);
      expect(spans.length).toBe(0);
    });
  }

  it('requires context keywords', () => {
    const spans = dobRecognizer.detect('1990-01-15');
    expect(spans.length).toBe(0);
  });

  it('finds DOB in text with context', () => {
    const text = 'Patient born on 1990-01-15 in hospital';
    const spans = dobRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('1990-01-15');
  });

  it('does not match embedded', () => {
    const text = 'Date of birth: 1990-01-15suffix';
    const spans = dobRecognizer.detect(text);
    expect(spans.length).toBe(0);
  });

  it('detects US format with context', () => {
    const text = 'Birthday: 01/15/1990';
    const spans = dobRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('01/15/1990');
  });
});