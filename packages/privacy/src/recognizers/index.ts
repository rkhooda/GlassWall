export * from './types';
export * from './utils';
export { emailRecognizer } from './email';
export { phoneRecognizer } from './phone';
export { aadhaarRecognizer } from './aadhaar';
export { panRecognizer } from './pan';
export { ifscRecognizer } from './ifsc';
export { gstinRecognizer } from './gstin';
export { upiRecognizer } from './upi';
export { cardRecognizer } from './card';
export { ipRecognizer } from './ip';
export { dobRecognizer } from './dob';
export { secretRecognizer } from './secret';
export { elementRulesRecognizer } from './element-rules';

let _allRecognizers: any[] | null = null;
export function getAllRecognizers() {
  if (!_allRecognizers) {
    const { emailRecognizer } = require('./email');
    const { phoneRecognizer } = require('./phone');
    const { aadhaarRecognizer } = require('./aadhaar');
    const { panRecognizer } = require('./pan');
    const { ifscRecognizer } = require('./ifsc');
    const { gstinRecognizer } = require('./gstin');
    const { upiRecognizer } = require('./upi');
    const { cardRecognizer } = require('./card');
    const { ipRecognizer } = require('./ip');
    const { dobRecognizer } = require('./dob');
    const { secretRecognizer } = require('./secret');
    _allRecognizers = [
      emailRecognizer,
      phoneRecognizer,
      aadhaarRecognizer,
      panRecognizer,
      ifscRecognizer,
      gstinRecognizer,
      upiRecognizer,
      cardRecognizer,
      ipRecognizer,
      dobRecognizer,
      secretRecognizer,
    ];
  }
  return _allRecognizers;
}

export async function detectAll(text: string) {
  const recognizers = await getAllRecognizers();
  const results: Array<{ type: string; tier: number; spans: import('./types').Span[] }> = [];
  for (const recognizer of recognizers) {
    const spans = recognizer.detect(text);
    if (spans.length > 0) {
      results.push({ type: recognizer.type, tier: recognizer.tier, spans });
    }
  }
  return results;
}