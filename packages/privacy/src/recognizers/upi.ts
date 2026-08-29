import { Recognizer, Span, getTier } from './types';
import { incrementConstructionCount } from './types';

const UPI_REGEX = /\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/g;

const KNOWN_UPI_HANDLES = new Set([
  'okhdfcbank', 'oksbi', 'okicici', 'okaxis', 'okkotak', 'okyesbank',
  'paytm', 'phonepe', 'gpay', 'amazonpay', 'mobikwik', 'freecharge',
  'icici', 'hdfc', 'sbi', 'axis', 'kotak', 'yesbank', 'indusind',
  'upi', 'bhim', 'barodapay', 'pnb', 'canara', 'unionbank',
]);

incrementConstructionCount();

function isKnownUpiHandle(handle: string): boolean {
  const lower = handle.toLowerCase();
  return KNOWN_UPI_HANDLES.has(lower);
}

export const upiRecognizer: Recognizer = {
  type: 'UPI',
  tier: getTier('UPI'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = UPI_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[a-zA-Z0-9.\-_@]/.test(beforeChar) || /[a-zA-Z0-9.\-_@]/.test(afterChar)) {
        continue;
      }

      const atIndex = value.lastIndexOf('@');
      if (atIndex <= 0 || atIndex >= value.length - 1) {
        continue;
      }

      const userPart = value.slice(0, atIndex);
      const handle = value.slice(atIndex + 1);
      if (userPart.length < 3) {
        continue;
      }
      if (!isKnownUpiHandle(handle)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'UPI',
        tier: getTier('UPI'),
        confidence: 0.9,
        rule_id: 'upi-vpa-v1',
      });
    }

    return spans;
  },
};