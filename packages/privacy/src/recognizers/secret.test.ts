import { describe, it, expect } from 'vitest';
import { secretRecognizer } from './secret';
import { calculateShannonEntropy } from './utils';

describe('secretRecognizer', () => {
  it('calculates Shannon entropy correctly', () => {
    expect(calculateShannonEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1);
    expect(calculateShannonEntropy('abcdefghijklmnop')).toBeGreaterThan(3.5);
    expect(calculateShannonEntropy('sk_live_abcdefghijklmnopqrstuvwxyz')).toBeGreaterThan(3.5);
  });

  const positiveCases = [
    'sk_live_abcdefghijklmnopqrstuvwxyz',
    'pk_test_abcdefghijklmnopqrstuvwxyz',
    'api_key_abcdefghijklmnopqrstuvwxyz',
    'token_abcdefghijklmnopqrstuvwxyz',
    'secret_abcdefghijklmnopqrstuvwxyz',
    'key_abcdefghijklmnopqrstuvwxyz',
    'ghp_abcdefghijklmnopqrstuvwxyz',
    'xoxb-abcdefghijklmnopqrstuvwxyz',
    'sk-live-abcdefghijklmnopqrstuvwxyz',
    'AKIAabcdefghijklmnopqrstuvwxyz',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  ];

  const negativeCases = [
    'short',
    'sk_live_short',
    'aaaaaaaaaaaaaaaa',
    '1234567890123456',
    'test_key_abcdefghijklmnopqrstuvwxyz',
    'example_secret_abcdefghijklmnopqrstuvwxyz',
    'placeholder_abcdefghijklmnopqrstuvwxyz',
    'dummy_abcdefghijklmnopqrstuvwxyz',
    'fake_abcdefghijklmnopqrstuvwxyz',
    'sample_abcdefghijklmnopqrstuvwxyz',
  ];

  for (const tc of positiveCases) {
    it(`detects valid secret: ${tc}`, () => {
      const spans = secretRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('SECRET');
      expect(spans[0].tier).toBe(1);
      expect(spans[0].confidence).toBeGreaterThanOrEqual(0.8);
    });
  }

  for (const tc of negativeCases) {
    it(`rejects invalid secret: ${tc}`, () => {
      const spans = secretRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds secret in text', () => {
    const text = 'API key: sk_live_abcdefghijklmnopqrstuvwxyz for auth';
    const spans = secretRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('sk_live_abcdefghijklmnopqrstuvwxyz');
  });

  it('does not match embedded', () => {
    const spans = secretRecognizer.detect('prefixsk_live_abcdefghijklmnopqrstuvwxyzsuffix');
    expect(spans.length).toBe(0);
  });

  it('detects high entropy string without known prefix', () => {
    const highEntropy = 'X7k9mN2pQ5rT8vW1yZ4aB6cD9eF2gH5';
    const spans = secretRecognizer.detect(highEntropy);
    expect(spans.length).toBe(1);
    expect(spans[0].confidence).toBe(0.8);
  });
});