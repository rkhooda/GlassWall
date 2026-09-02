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
import { recognizeByContext } from './context';
export { recognizeByContext, isLabelWord } from './context';

let _allRecognizers: { recognizer: any; recognizeFn: (text: string) => Span[] }[] | null = null;

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

/** Text recognizers only (no element rules): what the egress gate re-runs over released strings. */
export function recognizeText(text: string): Span[] {
  const out: Span[] = [];
  for (const { recognizer, recognizeFn } of getAllRecognizers()) {
    if (recognizer === elementRulesRecognizer) continue;
    out.push(...recognizeFn(text));
  }
  return out;
}

export async function detectAll(text: string) {
  const recognizers = getAllRecognizers();
  const results: { type: string; tier: number; spans: Span[] }[] = [];
  for (const { recognizer, recognizeFn } of recognizers) {
    const spans = recognizeFn(text);
    if (spans.length > 0) {
      results.push({ type: recognizer.type, tier: recognizer.tier, spans });
    }
  }
  return results;
}

export interface RecognizerResult {
  /** The matched text for a value detection; '' for an element classification. */
  value: string;
  piiType: string;
  tier: number;
  rect?: [number, number, number, number];
  confidence: number;
  /** 'value' = a secret to tokenize; 'element' = a control that will hold one (autocomplete, type=password). */
  kind: 'value' | 'element';
  elementId?: string;
  textNodeId?: string;
}

export function recognizeAll(raw: RawObservation, _frame: CapturedFrame | null = null): RecognizerResult[] {
  const results: RecognizerResult[] = [];
  const recognizers = getAllRecognizers();

  for (const element of raw.elements) {
    for (const { recognizer, recognizeFn } of recognizers) {
      if (recognizer.detectElement) {
        const spans = recognizer.detectElement(element as any);
        for (const span of spans) {
          results.push({
            value: '',
            piiType: span.type,
            tier: span.tier,
            rect: element.rect,
            confidence: span.confidence,
            kind: 'element',
            elementId: element.id,
          });
        }
      }
      // A value printed as a label is a value. Placeholders are examples and are scrubbed by sanitize().
      for (const text of [element.label_raw]) {
        if (!text) continue;
        for (const span of recognizeFn(text)) {
          results.push({ value: span.value, piiType: span.type, tier: span.tier, rect: element.rect, confidence: span.confidence, kind: 'value', elementId: element.id });
        }
      }
    }
  }

  for (const textNode of raw.text_nodes) {
    for (const { recognizeFn } of recognizers) {
      const spans = recognizeFn(textNode.text);
      for (const span of spans) {
        results.push({
          value: span.value,
          piiType: span.type,
          tier: span.tier,
          rect: textNode.rect,
          confidence: span.confidence,
          kind: 'value',
          textNodeId: textNode.id,
        });
      }
    }
  }

  for (const hit of recognizeByContext(raw)) {
    results.push({ value: hit.value, piiType: hit.type, tier: hit.tier, rect: hit.rect, confidence: hit.confidence, kind: 'value', textNodeId: hit.textNodeId });
  }

  return results;
}