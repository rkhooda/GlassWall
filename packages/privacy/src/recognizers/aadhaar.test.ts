import { describe, it, expect } from 'vitest';
import { aadhaarRecognizer } from './aadhaar';
import { verifyVerhoeff, verhoeffCheckDigit } from './utils';

describe('aadhaarRecognizer', () => {
  it('verifies Verhoeff algorithm directly', () => {
    const validAadhaar = '234567890124';
    const digits = validAadhaar.split('').map(Number);
    const check = verhoeffCheckDigit(digits.slice(0, 11));
    expect(check).toBe(digits[11]);
    expect(verifyVerhoeff(validAadhaar)).toBe(true);
  });

  const validAadhaars = [
    '234567890124',
    '999999999999',
    '123456789010',
    '111111111115',
  ];

  const invalidAadhaars = [
    '123456789012',
    '234567890123',
    '111111111111',
  ];

  const nearMissCases = [
    '12345678901',
    '1234567890123',
    'abcd56789012',
  ];

  for (const tc of validAadhaars) {
    it(`detects valid Aadhaar with Verhoeff: ${tc}`, () => {
      const spans = aadhaarRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('AADHAAR');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.99);
    });
  }

  for (const tc of invalidAadhaars) {
    it(`rejects Aadhaar with invalid Verhoeff: ${tc}`, () => {
      expect(verifyVerhoeff(tc)).toBe(false);
      const spans = aadhaarRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss Aadhaar: ${tc}`, () => {
      const spans = aadhaarRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds Aadhaar in text', () => {
    const text = 'Aadhaar: 234567890124 for verification';
    const spans = aadhaarRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('234567890124');
  });

  it('does not match embedded in longer number', () => {
    const spans = aadhaarRecognizer.detect('prefix234567890124suffix');
    expect(spans.length).toBe(0);
  });

  it('rejects 12-digit SKU without valid Verhoeff', () => {
    const spans = aadhaarRecognizer.detect('SKU12345678901');
    expect(spans.length).toBe(0);
  });
});