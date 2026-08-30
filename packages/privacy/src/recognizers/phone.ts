import { Recognizer, Span, getTier } from './types';
import { incrementConstructionCount } from './types';

const INDIAN_PHONE_REGEX = /\b[6-9]\d{9}\b/g;
const E164_INDIAN_REGEX = /\+91\s?[6-9]\d{9}\b/g;
const E164_GENERIC_REGEX = /\+\d{1,3}\s?\d{6,14}\b/g;

incrementConstructionCount();
incrementConstructionCount();
incrementConstructionCount();

function isIndianPhoneContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 20), index).toLowerCase();
  const after = text.slice(index, index + 20).toLowerCase();
  const context = before + after;
  return /india|indian|\+91|phone|mobile|contact|tel/.test(context);
}

export const phoneRecognizer: Recognizer = {
  type: 'PHONE',
  tier: getTier('PHONE'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = E164_INDIAN_REGEX.exec(text)) !== null) {
      const value = match[0].replace(/\s+/g, '');
      const start = match.index;
      const end = start + match[0].length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d+]/.test(beforeChar) || /[\d]/.test(afterChar)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'PHONE',
        tier: getTier('PHONE'),
        confidence: 0.98,
        rule_id: 'phone-e164-indian-v1',
      });
    }

    E164_INDIAN_REGEX.lastIndex = 0;

    while ((match = INDIAN_PHONE_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d+]/.test(beforeChar) || /[\d]/.test(afterChar)) {
        continue;
      }

      const hasContext = isIndianPhoneContext(text, start);
      spans.push({
        start,
        end,
        value,
        type: 'PHONE',
        tier: getTier('PHONE'),
        confidence: hasContext ? 0.9 : 0.7,
        rule_id: hasContext ? 'phone-indian-v1' : 'phone-indian-bare-v1',
      });
    }

    INDIAN_PHONE_REGEX.lastIndex = 0;

    while ((match = E164_GENERIC_REGEX.exec(text)) !== null) {
      const fullMatch = match[0];
      if (fullMatch.startsWith('+91')) {
        E164_GENERIC_REGEX.lastIndex = match.index + fullMatch.length;
        continue;
      }

      const value = fullMatch.replace(/\s+/g, '');
      const start = match.index;
      const end = start + fullMatch.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d+]/.test(beforeChar) || /[\d]/.test(afterChar)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'PHONE',
        tier: getTier('PHONE'),
        confidence: 0.85,
        rule_id: 'phone-e164-generic-v1',
      });
    }

    E164_GENERIC_REGEX.lastIndex = 0;

    return spans;
  },
};

export function recognizePhone(text: string): Span[] {
  return phoneRecognizer.detect(text);
}