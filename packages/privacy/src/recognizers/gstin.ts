import { Recognizer, Span, getTier } from './types';
import { verifyGstin } from './utils';
import { incrementConstructionCount } from './types';

const GSTIN_REGEX = /\b\d{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

incrementConstructionCount();

export const gstinRecognizer: Recognizer = {
  type: 'GSTIN',
  tier: getTier('GSTIN'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = GSTIN_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[A-Z0-9]/.test(beforeChar) || /[A-Z0-9]/.test(afterChar)) {
        continue;
      }

      if (!verifyGstin(value)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'GSTIN',
        tier: getTier('GSTIN'),
        confidence: 0.99,
        rule_id: 'gstin-checkchar-v1',
      });
    }

    return spans;
  },
};