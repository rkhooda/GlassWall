import { Recognizer, Span, getTier } from './types';
import { verifyVerhoeff } from './utils';
import { incrementConstructionCount } from './types';

const AADHAAR_REGEX = /\b\d{12}\b/g;

incrementConstructionCount();

export const aadhaarRecognizer: Recognizer = {
  type: 'AADHAAR',
  tier: getTier('AADHAAR'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = AADHAAR_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/\d/.test(beforeChar) || /\d/.test(afterChar)) {
        continue;
      }

      if (!verifyVerhoeff(value)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'AADHAAR',
        tier: getTier('AADHAAR'),
        confidence: 0.99,
        rule_id: 'aadhaar-verhoeff-v1',
      });
    }

    return spans;
  },
};