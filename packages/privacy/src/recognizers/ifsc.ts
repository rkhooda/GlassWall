import type { Recognizer, Span} from './types';
import { getTier } from './types';
import { incrementConstructionCount } from './types';

const IFSC_REGEX = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

const BANK_CODES = new Set([
  'SBIN', 'HDFC', 'ICIC', 'UTIB', 'KKBK', 'YESB', 'INDB', 'RATN',
  'BKID', 'CNRB', 'PUNB', 'UBIN', 'IOBA', 'ABHY', 'ANDH', 'SYNB',
  'CORP', 'VIJB', 'MAHB', 'BKDN', 'SBHY', 'SBTR', 'SBMJ', 'STBP',
  'KARB', 'FDRL', 'SBPD', 'SBTR', 'SBMJ', 'STBP', 'KARB', 'FDRL',
]);

incrementConstructionCount();

export const ifscRecognizer: Recognizer = {
  type: 'IFSC',
  tier: getTier('IFSC'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = IFSC_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[A-Z0-9]/.test(beforeChar) || /[A-Z0-9]/.test(afterChar)) {
        continue;
      }

      const bankCode = value.slice(0, 4);
      if (!BANK_CODES.has(bankCode)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'IFSC',
        tier: getTier('IFSC'),
        confidence: 0.95,
        rule_id: 'ifsc-regex-v1',
      });
    }

    return spans;
  },
};

export function recognizeIfsc(text: string): Span[] {
  return ifscRecognizer.detect(text);
}