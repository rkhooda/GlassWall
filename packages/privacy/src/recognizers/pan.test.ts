import { describe, it, expect } from 'vitest';
import { panRecognizer } from './pan';

describe('panRecognizer', () => {
  const positiveCases = [
    'ABCDE1234F',
    'XYZAB5678C',
    'PQRST9012Z',
  ];

  const negativeCases = [
    'ABCD1234F',
    'ABCDEF1234F',
    'abcde1234f',
    '1234567890',
  ];

  const nearMissCases = [
    'PRODU1234X',
    'ABCDE0000F',
    'ABCDE1234',
    'ABCDE1234FG',
  ];

  for (const tc of positiveCases) {
    it(`detects valid PAN: ${tc}`, () => {
      const spans = panRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('PAN');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.95);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid PAN: ${tc}`, () => {
      const spans = panRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss PAN: ${tc}`, () => {
      const spans = panRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds PAN in text', () => {
    const text = 'PAN number is ABCDE1234F for tax';
    const spans = panRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('ABCDE1234F');
  });

  it('does not match embedded', () => {
    const spans = panRecognizer.detect('prefixABCDE1234Fsuffix');
    expect(spans.length).toBe(0);
  });
});