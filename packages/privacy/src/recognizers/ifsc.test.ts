import { describe, it, expect } from 'vitest';
import { ifscRecognizer } from './ifsc';

describe('ifscRecognizer', () => {
  const positiveCases = [
    'SBIN0001234',
    'HDFC0005678',
    'ICIC0009012',
    'UTIB0003456',
  ];

  const negativeCases = [
    'SBIN001234',
    'SBIN00012345',
    'sbin0001234',
    'XXXX0001234',
  ];

  const nearMissCases = [
    'SBIN1234567',
    'SBINX000123',
  ];

  for (const tc of positiveCases) {
    it(`detects valid IFSC: ${tc}`, () => {
      const spans = ifscRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('IFSC');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.95);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid IFSC: ${tc}`, () => {
      const spans = ifscRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss IFSC: ${tc}`, () => {
      const spans = ifscRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds IFSC in text', () => {
    const text = 'IFSC code: SBIN0001234 for transfer';
    const spans = ifscRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('SBIN0001234');
  });

  it('does not match embedded', () => {
    const spans = ifscRecognizer.detect('prefixSBIN0001234suffix');
    expect(spans.length).toBe(0);
  });
});