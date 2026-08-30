export * from './types';
export * from './utils';
export { emailRecognizer, recognizeEmail } from './email';
export { phoneRecognizer, recognizePhone } from './phone';
export { aadhaarRecognizer, recognizeAadhaar } from './aadhaar';
export { panRecognizer, recognizePan } from './pan';
export { ifscRecognizer, recognizeIfsc } from './ifsc';
export { gstinRecognizer, recognizeGstin } from './gstin';
export { upiRecognizer, recognizeUpi } from './upi';
export { cardRecognizer, recognizeCard } from './card';
export { ipRecognizer, recognizeIp } from './ip';
export { dobRecognizer, recognizeDob } from './dob';
export { secretRecognizer, recognizeSecret } from './secret';
export { elementRulesRecognizer, recognizeElementRules } from './element-rules';

import { emailRecognizer, recognizeEmail } from './email';
import { phoneRecognizer, recognizePhone } from './phone';
import { aadhaarRecognizer, recognizeAadhaar } from './aadhaar';
import { panRecognizer, recognizePan } from './pan';
import { ifscRecognizer, recognizeIfsc } from './ifsc';
import { gstinRecognizer, recognizeGstin } from './gstin';
import { upiRecognizer, recognizeUpi } from './upi';
import { cardRecognizer, recognizeCard } from './card';
import { ipRecognizer, recognizeIp } from './ip';
import { dobRecognizer, recognizeDob } from './dob';
import { secretRecognizer, recognizeSecret } from './secret';
import { elementRulesRecognizer, recognizeElementRules } from './element-rules';
import type { RawObservation, CapturedFrame } from '@glasswall/schema/observation';
import type { Span } from './types';

let _allRecognizers: Array<{ recognizer: any; recognizeFn: (text: string) => Span[] }> | null = null;

function getAllRecognizers() {
  if (!_allRecognizers) {
    _allRecognizers = [
      { recognizer: emailRecognizer, recognizeFn: recognizeEmail },
      { recognizer: phoneRecognizer, recognizeFn: recognizePhone },
      { recognizer: aadhaarRecognizer, recognizeFn: recognizeAadhaar },
      { recognizer: panRecognizer, recognizeFn: recognizePan },
      { recognizer: ifscRecognizer, recognizeFn: recognizeIfsc },
      { recognizer: gstinRecognizer, recognizeFn: recognizeGstin },
      { recognizer: upiRecognizer, recognizeFn: recognizeUpi },
      { recognizer: cardRecognizer, recognizeFn: recognizeCard },
      { recognizer: ipRecognizer, recognizeFn: recognizeIp },
      { recognizer: dobRecognizer, recognizeFn: recognizeDob },
      { recognizer: secretRecognizer, recognizeFn: recognizeSecret },
      { recognizer: elementRulesRecognizer, recognizeFn: recognizeElementRules },
    ];
  }
  return _allRecognizers;
}

export async function detectAll(text: string) {
  const recognizers = getAllRecognizers();
  const results: Array<{ type: string; tier: number; spans: Span[] }> = [];
  for (const { recognizer, recognizeFn } of recognizers) {
    const spans = recognizeFn(text);
    if (spans.length > 0) {
      results.push({ type: recognizer.type, tier: recognizer.tier, spans });
    }
  }
  return results;
}

export interface RecognizerResult {
  value: string;
  piiType: string;
  tier: number;
  rect?: [number, number, number, number];
  confidence: number;
}

export function recognizeAll(raw: RawObservation, frame: CapturedFrame | null): RecognizerResult[] {
  const results: RecognizerResult[] = [];
  const recognizers = getAllRecognizers();

  for (const element of raw.elements) {
    for (const { recognizer, recognizeFn } of recognizers) {
      if (recognizer.detectElement) {
        const spans = recognizer.detectElement(element as any);
        for (const span of spans) {
          results.push({
            value: span.value,
            piiType: span.type,
            tier: span.tier,
            rect: element.rect,
            confidence: span.confidence,
          });
        }
      }
    }
  }

  for (const textNode of raw.text_nodes) {
    for (const { recognizer, recognizeFn } of recognizers) {
      const spans = recognizeFn(textNode.text);
      for (const span of spans) {
        results.push({
          value: span.value,
          piiType: span.type,
          tier: span.tier,
          rect: textNode.rect,
          confidence: span.confidence,
        });
      }
    }
  }

  return results;
}