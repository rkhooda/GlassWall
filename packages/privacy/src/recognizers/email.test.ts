import { describe, it, expect } from 'vitest';
import { emailRecognizer } from './email';

describe('emailRecognizer', () => {
  const positiveCases = [
    'user@zmail.in',
    'test.email@domain.org',
    'user+tag@example.co.uk',
    'user.name@sub.domain.com',
    'user123@test-domain.io',
    'a@b.co',
  ];

  const negativeCases = [
    'notanemail',
    '@nodomain.com',
    'noat@',
    'spaces @domain.com',
    'user@.com',
    'user@domain.',
    'user@@domain.com',
  ];

  const nearMissCases = [
    'user@domain',
    'user@domain.c',
    'user@-domain.com',
    'user@domain-.com',
  ];

  for (const tc of positiveCases) {
    it(`detects valid email: ${tc}`, () => {
      const spans = emailRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('EMAIL');
      expect(spans[0].tier).toBe(2);
      expect(spans[0].confidence).toBe(0.95);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid email: ${tc}`, () => {
      const spans = emailRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of nearMissCases) {
    it(`rejects near-miss email: ${tc}`, () => {
      const spans = emailRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds multiple emails in text', () => {
    const text = 'Contact user@zmail.in or admin@test.org for help';
    const spans = emailRecognizer.detect(text);
    expect(spans.length).toBe(2);
    expect(spans[0].value).toBe('user@zmail.in');
    expect(spans[1].value).toBe('admin@test.org');
  });

  it('does not match email embedded in longer word', () => {
    const spans = emailRecognizer.detect('prefixuser@zmail.insuffix');
    expect(spans.length).toBe(0);
  });
});

describe('emailRecognizer reserved domains', () => {
  it('skips RFC 2606 documentation addresses', () => {
    expect(emailRecognizer.detect('write to you@example.com or admin@localhost')).toHaveLength(0);
  });
});
