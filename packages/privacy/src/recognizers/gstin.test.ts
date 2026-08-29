import { describe, it, expect } from 'vitest';
import { gstinRecognizer } from './gstin';
import { verifyGstin, gstinCheckChar } from './utils';

describe('gstinRecognizer', () => {
  it('verifies GSTIN check character directly', () => {
    const base14 = '29ABCDE1234F1Z';
    const check = gstinCheckChar(base14);
    const validGstin = base14 + check;
    expect(verifyGstin(validGstin)).toBe(true);
    expect(verifyGstin(validGstin.slice(0, 14) + 'X')).toBe(false);
  });

  const validGstins = [
    '29ABCDE1234F1Z3',
    '27PQRST5678G2ZV',
  ];

  const negativeCases = [
    '29ABCDE1234F1Z',
    '29ABCDE1234F1Z56',
    '29abcde1234f1z5',
    '00ABCDE1234F1Z5',
  ];

  const nearMissCases = [
    '29ABCDE1234F1ZX',
    '29ABCDE1234F1ZZ',
  ];

  for (const tc of validGstins) {
    it(`detects valid GSTIN: ${tc}`, () => {
      const spans = gstinRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('GSTIN');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.99);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid GSTIN: ${tc}`, () => {
      const spans = gstinRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss GSTIN: ${tc}`, () => {
      expect(verifyGstin(tc)).toBe(false);
      const spans = gstinRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds GSTIN in text', () => {
    const text = 'GSTIN: 29ABCDE1234F1Z3 for invoice';
    const spans = gstinRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('29ABCDE1234F1Z3');
  });

  it('finds second GSTIN in text', () => {
    const text = 'GSTIN: 27PQRST5678G2ZV for invoice';
    const spans = gstinRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('27PQRST5678G2ZV');
  });

  it('does not match embedded', () => {
    const spans = gstinRecognizer.detect('prefix29ABCDE1234F1Z3suffix');
    expect(spans.length).toBe(0);
  });
});