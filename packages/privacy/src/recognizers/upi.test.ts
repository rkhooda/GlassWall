import { describe, it, expect } from 'vitest';
import { upiRecognizer } from './upi';

describe('upiRecognizer', () => {
  const positiveCases = [
    'rahul.123@okhdfcbank',
    'priya.456@paytm',
    'user@phonepe',
    'test@gpay',
    'user.name@okaxis',
  ];

  const negativeCases = [
    'rahul@unknownbank',
    'user@',
    '@paytm',
    'user@paytm.com',
    'ab@paytm',
  ];

  const nearMissCases = [
    'us@paytm',
    'user@okhdfc',
  ];

  for (const tc of positiveCases) {
    it(`detects valid UPI: ${tc}`, () => {
      const spans = upiRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('UPI');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.9);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid UPI: ${tc}`, () => {
      const spans = upiRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss UPI: ${tc}`, () => {
      const spans = upiRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds UPI in text', () => {
    const text = 'Pay to rahul.123@okhdfcbank for order';
    const spans = upiRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('rahul.123@okhdfcbank');
  });

  it('does not match embedded', () => {
    const spans = upiRecognizer.detect('prefixrahul.123@okhdfcbanksuffix');
    expect(spans.length).toBe(0);
  });
});