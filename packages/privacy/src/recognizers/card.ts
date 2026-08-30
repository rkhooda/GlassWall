import { Recognizer, Span, getTier } from './types';
import { verifyLuhn } from './utils';
import { incrementConstructionCount } from './types';

const CARD_REGEX = /\b\d{13,19}\b/g;

const TEST_CARD_PATTERNS = [
  /^4000000000000002$/, // Visa test
  /^4242424242424242$/, // Stripe test
  /^5555555555555555$/, // Mastercard test
  /^4111111111111111$/, // Generic test
];

incrementConstructionCount();

function looksLikeCardNumber(value: string): boolean {
  if (value.length < 13 || value.length > 19) return false;
  if (!/^\d+$/.test(value)) return false;
  if (!verifyLuhn(value)) return false;
  if (TEST_CARD_PATTERNS.some(p => p.test(value))) return false;
  return true;
}

export const cardRecognizer: Recognizer = {
  type: 'CARD',
  tier: getTier('CARD'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = CARD_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/\d/.test(beforeChar) || /\d/.test(afterChar)) {
        continue;
      }

      if (!looksLikeCardNumber(value)) {
        continue;
      }

      const beforeContext = text.slice(Math.max(0, start - 30), start).toLowerCase();
      const afterContext = text.slice(end, end + 30).toLowerCase();
      const context = beforeContext + afterContext;
      if (/order|invoice|transaction|reference|ref\s*#|id\s*#|sku|serial|account\s*#/.test(context)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'CARD',
        tier: getTier('CARD'),
        confidence: 0.98,
        rule_id: 'card-luhn-v1',
      });
    }

    return spans;
  },
};

export function recognizeCard(text: string): Span[] {
  return cardRecognizer.detect(text);
}