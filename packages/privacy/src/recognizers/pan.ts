import type { Recognizer, Span} from './types';
import { getTier } from './types';
import { incrementConstructionCount } from './types';

const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;

incrementConstructionCount();

export const panRecognizer: Recognizer = {
  type: 'PAN',
  tier: getTier('PAN'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = PAN_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[A-Z0-9]/.test(beforeChar) || /[A-Z0-9]/.test(afterChar)) {
        continue;
      }

      if (value.startsWith('PRODU') || value.match(/^[A-Z]{5}0{4}[A-Z]$/)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'PAN',
        tier: getTier('PAN'),
        confidence: 0.95,
        rule_id: 'pan-regex-v1',
      });
    }

    return spans;
  },
};

export function recognizePan(text: string): Span[] {
  return panRecognizer.detect(text);
}