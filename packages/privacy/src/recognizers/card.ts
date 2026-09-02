import type { Recognizer, Span} from './types';
import { getTier } from './types';
import { verifyLuhn } from './utils';
import { incrementConstructionCount } from './types';

// Digits in groups separated by spaces or dashes, as cards are printed on pages.
const CARD_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;

incrementConstructionCount();

/** Canonical documentation numbers; they never belong to a person. */
const DOC_TEST_CARDS = new Set(['4000000000000002', '4242424242424242', '5555555555555555', '4111111111111111']);

function looksLikeCardNumber(surface: string): boolean {
  const digits = surface.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  // Mixed separators ("4111-1111 1111") are not how a card is printed.
  if (surface.includes(' ') && surface.includes('-')) return false;
  if (DOC_TEST_CARDS.has(digits)) return false;
  return verifyLuhn(digits);
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