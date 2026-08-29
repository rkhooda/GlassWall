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