import type { Recognizer, Span} from './types';
import { getTier } from './types';
import { incrementConstructionCount } from './types';

const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;

const IPV6_REGEX = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g;
const IPV6_COMPRESSED_REGEX = /(?<=^|[\s()[\]{}<>,.;:!?])(?:(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}|::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}::|::1)(?![:\da-fA-F])/g;

incrementConstructionCount();
incrementConstructionCount();
incrementConstructionCount();

export const ipRecognizer: Recognizer = {
  type: 'IP',
  tier: getTier('IP'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = IPV4_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d.]/.test(beforeChar) || /[\d.]/.test(afterChar)) {
        continue;
      }


      spans.push({
        start,
        end,
        value,
        type: 'IP',
        tier: getTier('IP'),
        confidence: 0.9,
        rule_id: 'ip-v4-v1',
      });
    }

    IPV4_REGEX.lastIndex = 0;

    while ((match = IPV6_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[:\da-fA-F]/.test(beforeChar) || /[:\da-fA-F]/.test(afterChar)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'IP',
        tier: getTier('IP'),
        confidence: 0.85,
        rule_id: 'ip-v6-v1',
      });
    }

    IPV6_REGEX.lastIndex = 0;

    while ((match = IPV6_COMPRESSED_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      if (IPV6_REGEX.test(value)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'IP',
        tier: getTier('IP'),
        confidence: 0.8,
        rule_id: 'ip-v6-compressed-v1',
      });
    }

    IPV6_COMPRESSED_REGEX.lastIndex = 0;

    return spans;
  },
};

export function recognizeIp(text: string): Span[] {
  return ipRecognizer.detect(text);
}