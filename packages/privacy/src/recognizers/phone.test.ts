import { describe, it, expect } from 'vitest';
import { phoneRecognizer } from './phone';

describe('phoneRecognizer', () => {
  const positiveCases = [
    '+91 9876543210',
    '+919876543210',
    '9876543210',
    '+1 5551234567',
    '+44 2071234567',
  ];

  const negativeCases = [
    '1234567890',
    '5876543210',
    '987654321',
    '98765432101',
    '+91 5876543210',
  ];

  for (const tc of positiveCases) {
    it(`detects valid phone: ${tc}`, () => {
      const spans = phoneRecognizer.detect(tc);
      expect(spans.length).toBeGreaterThan(0);
      const span = spans.find(s => s.value.replace(/\s+/g, '') === tc.replace(/\s+/g, ''));
      expect(span).toBeDefined();
      expect(span!.type).toBe('PHONE');
      expect(span!.tier).toBe(2);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid phone: ${tc}`, () => {
      const spans = phoneRecognizer.detect(tc);
      const indianSpans = spans.filter(s => s.rule_id.includes('indian'));
      expect(indianSpans.length).toBe(0);
    });
  }

  it('detects Indian phone with context', () => {
    const text = 'My mobile number is 9876543210 for contact';
    const spans = phoneRecognizer.detect(text);
    const indianSpans = spans.filter(s => s.rule_id.includes('indian'));
    expect(indianSpans.length).toBe(1);
    expect(indianSpans[0].value).toBe('9876543210');
  });

  it('does not match embedded in longer number', () => {
    const spans = phoneRecognizer.detect('prefix9876543210suffix');
    expect(spans.length).toBe(0);
  });
});
describe('phoneRecognizer — separators inside the number', () => {
  // Found by the P11 ablation: the bench-site generator's own E.164 format leaked.
  const grouped = ['+91 99194 14773', '+91-99194-14773', '+91 991 941 4773'];

  for (const tc of grouped) {
    it(`detects grouped E.164: ${tc}`, () => {
      const spans = phoneRecognizer.detect(`contact: ${tc}`);
      expect(spans.some(s => s.rule_id === 'phone-e164-indian-v1')).toBe(true);
    });
  }

  it('keeps the surface form so the text substitution can find it', () => {
    const text = 'contact: +91 99194 14773';
    const span = phoneRecognizer.detect(text).find(s => s.rule_id === 'phone-e164-indian-v1')!;
    expect(text).toContain(span.value);
    expect(span.value).toBe('+91 99194 14773');
  });
});
