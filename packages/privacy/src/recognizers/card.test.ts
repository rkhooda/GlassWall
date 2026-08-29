import { describe, it, expect } from 'vitest';
import { cardRecognizer } from './card';
import { verifyLuhn, luhnCheckDigit } from './utils';

describe('cardRecognizer', () => {
  it('verifies Luhn algorithm directly', () => {
    const validCard = '4532015112830366';
    expect(verifyLuhn(validCard)).toBe(true);
    const digits = validCard.split('').map(Number);
    const check = luhnCheckDigit(digits.slice(0, 15));
    expect(check).toBe(digits[15]);
  });

  const validCards = [
    '4532015112830366',
    '5555555555554444',
    '378282246310005',
    '6011111111111117',
  ];

  const invalidCards = [
    '1234567890123456',
    '4532015112830367',
    '453201511283036',
    '45320151128303666',
  ];

  const nearMissCases = [
    '4000000000000002',
    '4242424242424242',
    '4111111111111111',
  ];

  for (const tc of validCards) {
    it(`detects valid card with Luhn: ${tc}`, () => {
      const spans = cardRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('CARD');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.98);
    });
  }

  for (const tc of invalidCards) {
    it(`rejects invalid card: ${tc}`, () => {
      const spans = cardRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss/test card: ${tc}`, () => {
      expect(verifyLuhn(tc)).toBe(true);
      const spans = cardRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('rejects 16-digit order number without Luhn', () => {
    const spans = cardRecognizer.detect('Order ID: 1234567890123456');
    expect(spans.length).toBe(0);
  });

  it('finds card in text', () => {
    const text = 'Card number: 4532015112830366 for payment';
    const spans = cardRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('4532015112830366');
  });

  it('does not match embedded', () => {
    const spans = cardRecognizer.detect('prefix4532015112830366suffix');
    expect(spans.length).toBe(0);
  });
});