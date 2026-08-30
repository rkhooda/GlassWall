import { Recognizer, Span, getTier } from './types';
import { calculateShannonEntropy } from './utils';
import { incrementConstructionCount } from './types';

const SECRET_PREFIXES = [
  'sk_', 'pk_', 'api_', 'token_', 'secret_', 'key_',
  'Bearer ', 'bearer ', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_',
  'xoxb-', 'xoxp-', 'xoxa-',
  'sk-live-', 'sk-test-', 'rk_live_', 'rk_test_',
  'AKIA', 'ASIA', 'AROA', 'AIDA',
  'eyJ',
];

const MIN_SECRET_LENGTH = 16;
const MIN_ENTROPY = 3.5;

incrementConstructionCount();

function hasKnownPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return SECRET_PREFIXES.some(prefix => lower.startsWith(prefix.toLowerCase()));
}

function looksLikeSecret(value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH) return false;
  if (!/[A-Za-z0-9\-_=]/.test(value)) return false;
  const entropy = calculateShannonEntropy(value);
  if (entropy < MIN_ENTROPY) return false;
  if (/^[\d\s\-\.]+$/.test(value)) return false;
  if (/^(test|example|demo|sample|placeholder|dummy|fake)/i.test(value)) return false;
  return true;
}

export const secretRecognizer: Recognizer = {
  type: 'SECRET',
  tier: getTier('SECRET'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    const prefixRegex = /(?<![\w\-_=])(?:sk[_\-]|pk[_\-]|api[_\-]|token[_\-]|secret[_\-]|key[_\-]|Bearer\s|bearer\s|ghp_|gho_|ghu_|ghs_|ghr_|xoxb-|xoxp-|xoxa-|sk-live-|sk-test-|rk_live_|rk_test_|AKIA|ASIA|AROA|AIDA|eyJ)[\w\-_=]{16,}(?![\w\-_=])/g;
    let match: RegExpExecArray | null;

    while ((match = prefixRegex.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      if (!hasKnownPrefix(value) && !looksLikeSecret(value)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'SECRET',
        tier: getTier('SECRET'),
        confidence: hasKnownPrefix(value) ? 0.95 : 0.8,
        rule_id: hasKnownPrefix(value) ? 'secret-prefix-v1' : 'secret-entropy-v1',
      });
    }

    const entropyRegex = /(?<![\w\-_=])[\w\-_=]{24,}(?![\w\-_=])/g;
    while ((match = entropyRegex.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      if (hasKnownPrefix(value) || !looksLikeSecret(value)) {
        continue;
      }

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\w\-_=]/.test(beforeChar) || /[\w\-_=]/.test(afterChar)) {
        continue;
      }

      if (SECRET_PREFIXES.some(p => value.includes(p))) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'SECRET',
        tier: getTier('SECRET'),
        confidence: 0.8,
        rule_id: 'secret-entropy-v1',
      });
    }

    return spans;
  },
};

export function recognizeSecret(text: string): Span[] {
  return secretRecognizer.detect(text);
}