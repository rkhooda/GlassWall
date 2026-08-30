import { Recognizer, Span, getTier } from './types';
import { incrementConstructionCount } from './types';

const DOB_REGEX = /\b(?:19|20)\d{2}[-/.](?:0[1-9]|1[0-2])[-/.](?:0[1-9]|[12]\d|3[01])\b/g;
const DOB_US_REGEX = /\b(?:0[1-9]|1[0-2])[-/.](?:0[1-9]|[12]\d|3[01])[-/.](?:19|20)\d{2}\b/g;

incrementConstructionCount();
incrementConstructionCount();

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= (isLeap ? 29 : 28);
  }
  if ([4, 6, 9, 11].includes(month)) return day <= 30;
  return true;
}

function looksLikeValidDob(value: string): boolean {
  const parts = value.split(/[-/.]/);
  if (parts.length !== 3) return false;
  const p1 = Number(parts[0]!);
  const p2 = Number(parts[1]!);
  const p3 = Number(parts[2]!);
  const currentYear = new Date().getFullYear();
  if (p1 > 12 && p2 <= 12) {
    return isValidDate(p1, p2, p3) && p1 >= 1900 && p1 <= currentYear - 13;
  }
  if (p1 <= 12 && p2 > 12) {
    return isValidDate(p3, p1, p2) && p3 >= 1900 && p3 <= currentYear - 13;
  }
  return false;
}

export const dobRecognizer: Recognizer = {
  type: 'DOB',
  tier: getTier('DOB'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;

    while ((match = DOB_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d\-./]/.test(beforeChar) || /[\d\-./]/.test(afterChar)) {
        continue;
      }

      if (!looksLikeValidDob(value)) {
        continue;
      }

      const beforeContext = text.slice(Math.max(0, start - 30), start).toLowerCase();
      const afterContext = text.slice(end, end + 30).toLowerCase();
      const context = beforeContext + afterContext;
      if (!/(dob|date.of.birth|birth.date|born|age|birthday)/.test(context)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'DOB',
        tier: getTier('DOB'),
        confidence: 0.9,
        rule_id: 'dob-iso-v1',
      });
    }

    DOB_REGEX.lastIndex = 0;

    while ((match = DOB_US_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;

      const beforeChar = start > 0 ? text[start - 1]! : '';
      const afterChar = end < text.length ? text[end]! : '';
      if (/[\d\-./]/.test(beforeChar) || /[\d\-./]/.test(afterChar)) {
        continue;
      }

      if (!looksLikeValidDob(value)) {
        continue;
      }

      const beforeContext = text.slice(Math.max(0, start - 30), start).toLowerCase();
      const afterContext = text.slice(end, end + 30).toLowerCase();
      const context = beforeContext + afterContext;
      if (!/(dob|date.of.birth|birth.date|born|age|birthday)/.test(context)) {
        continue;
      }

      spans.push({
        start,
        end,
        value,
        type: 'DOB',
        tier: getTier('DOB'),
        confidence: 0.85,
        rule_id: 'dob-us-v1',
      });
    }

    DOB_US_REGEX.lastIndex = 0;

    return spans;
  },
};

export function recognizeDob(text: string): Span[] {
  return dobRecognizer.detect(text);
}