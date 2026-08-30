import { Recognizer, Span, PiiType, PiiTier, getTier, RawElement } from './types';
import { incrementConstructionCount } from './types';

incrementConstructionCount();

function normalizeAutocomplete(autocomplete: string): string[] {
  return autocomplete
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function checkAutocompleteTokens(autocomplete: string | undefined): Array<{ type: PiiType; confidence: number; rule_id: string }> {
  if (!autocomplete) return [];
  const tokens = normalizeAutocomplete(autocomplete);

  const tokenMap: Array<{ tokens: string[]; type: PiiType; confidence: number; rule_id: string }> = [
    { tokens: ['cc-number', 'credit-card', 'card-number'], type: 'CREDIT_CARD', confidence: 0.99, rule_id: 'element-autocomplete-cc-number-v1' },
    { tokens: ['cc-csc', 'cc-cvc', 'cvc', 'cvv', 'security-code'], type: 'CVC', confidence: 0.99, rule_id: 'element-autocomplete-cvc-v1' },
    { tokens: ['one-time-code', 'otp', 'verification-code', 'auth-code'], type: 'OTP', confidence: 0.99, rule_id: 'element-autocomplete-otp-v1' },
    { tokens: ['street-address', 'address-line1', 'address-line2', 'address-line3'], type: 'STREET_ADDRESS', confidence: 0.95, rule_id: 'element-autocomplete-street-v1' },
    { tokens: ['postal-code', 'postcode', 'zip', 'zip-code'], type: 'POSTAL_CODE', confidence: 0.95, rule_id: 'element-autocomplete-postal-v1' },
    { tokens: ['bday', 'bday-day', 'bday-month', 'bday-year', 'dob', 'date-of-birth'], type: 'BDAY', confidence: 0.95, rule_id: 'element-autocomplete-bday-v1' },
    { tokens: ['email'], type: 'EMAIL', confidence: 0.95, rule_id: 'element-autocomplete-email-v1' },
    { tokens: ['tel', 'tel-national', 'tel-country-code', 'tel-area-code', 'tel-local', 'tel-extension'], type: 'PHONE', confidence: 0.9, rule_id: 'element-autocomplete-tel-v1' },
    { tokens: ['name', 'given-name', 'additional-name', 'family-name', 'username', 'nickname'], type: 'PERSON_NAME', confidence: 0.8, rule_id: 'element-autocomplete-name-v1' },
    { tokens: ['organization', 'company'], type: 'ORGANIZATION', confidence: 0.8, rule_id: 'element-autocomplete-org-v1' },
    { tokens: ['address', 'shipping', 'billing'], type: 'STREET_ADDRESS', confidence: 0.7, rule_id: 'element-autocomplete-address-v1' },
  ];

  const results: Array<{ type: PiiType; confidence: number; rule_id: string }> = [];
  for (const token of tokens) {
    for (const mapping of tokenMap) {
      if (mapping.tokens.includes(token)) {
        results.push({ type: mapping.type, confidence: mapping.confidence, rule_id: mapping.rule_id });
      }
    }
  }
  return results;
}

function checkInputType(inputType: string | undefined): { type: PiiType; confidence: number; rule_id: string } | null {
  if (!inputType) return null;
  const lower = inputType.toLowerCase();
  if (lower === 'password') {
    return { type: 'PASSWORD', confidence: 1.0, rule_id: 'element-input-type-password-v1' };
  }
  return null;
}

function checkOtpHeuristics(element: RawElement): { type: PiiType; confidence: number; rule_id: string } | null {
  const label = (element.label_raw || '').toLowerCase();
  const placeholder = (element.placeholder_raw || '').toLowerCase();
  const combined = label + ' ' + placeholder;

  const otpPatterns = [
    /otp|one.time|verification.code|auth.code|pin.code|security.code/,
    /enter.*code|code.*sent|verify.*code/,
    /^\d{4,6}$/,
  ];

  for (const pattern of otpPatterns) {
    if (pattern.test(combined)) {
      return { type: 'OTP', confidence: 0.85, rule_id: 'element-otp-heuristic-v1' };
    }
  }

  if (element.input_type === 'text' && element.maxlength === 6 && /^\d*$/.test(element.placeholder_raw || '')) {
    return { type: 'OTP', confidence: 0.75, rule_id: 'element-otp-length-v1' };
  }

  return null;
}

function checkCreditCardHeuristics(element: RawElement): { type: PiiType; confidence: number; rule_id: string } | null {
  const label = (element.label_raw || '').toLowerCase();
  const placeholder = (element.placeholder_raw || '').toLowerCase();
  const combined = label + ' ' + placeholder;

  if (/card.number|credit.card|card\b|cc\b/.test(combined)) {
    return { type: 'CREDIT_CARD', confidence: 0.9, rule_id: 'element-cc-heuristic-v1' };
  }
  return null;
}

function checkCvcHeuristics(element: RawElement): { type: PiiType; confidence: number; rule_id: string } | null {
  const label = (element.label_raw || '').toLowerCase();
  const placeholder = (element.placeholder_raw || '').toLowerCase();
  const combined = label + ' ' + placeholder;

  if (/cvc|cvv|security.code|card.security/.test(combined)) {
    return { type: 'CVC', confidence: 0.9, rule_id: 'element-cvc-heuristic-v1' };
  }
  return null;
}

export const elementRulesRecognizer: Recognizer = {
  type: 'PASSWORD',
  tier: getTier('PASSWORD'),
  detect(_text: string): Span[] {
    return [];
  },
  detectElement(element: RawElement): Span[] {
    const spans: Span[] = [];

    const inputTypeResult = checkInputType(element.input_type);
    if (inputTypeResult) {
      spans.push({
        start: 0,
        end: 0,
        value: '[element-value]',
        type: inputTypeResult.type,
        tier: getTier(inputTypeResult.type),
        confidence: inputTypeResult.confidence,
        rule_id: inputTypeResult.rule_id,
      });
    }

    const autocompleteResults = checkAutocompleteTokens(element.autocomplete);
    for (const autocompleteResult of autocompleteResults) {
      spans.push({
        start: 0,
        end: 0,
        value: '[element-value]',
        type: autocompleteResult.type,
        tier: getTier(autocompleteResult.type),
        confidence: autocompleteResult.confidence,
        rule_id: autocompleteResult.rule_id,
      });
    }

    const otpResult = checkOtpHeuristics(element);
    if (otpResult) {
      spans.push({
        start: 0,
        end: 0,
        value: '[element-value]',
        type: otpResult.type,
        tier: getTier(otpResult.type),
        confidence: otpResult.confidence,
        rule_id: otpResult.rule_id,
      });
    }

    const ccResult = checkCreditCardHeuristics(element);
    if (ccResult) {
      spans.push({
        start: 0,
        end: 0,
        value: '[element-value]',
        type: ccResult.type,
        tier: getTier(ccResult.type),
        confidence: ccResult.confidence,
        rule_id: ccResult.rule_id,
      });
    }

    const cvcResult = checkCvcHeuristics(element);
    if (cvcResult) {
      spans.push({
        start: 0,
        end: 0,
        value: '[element-value]',
        type: cvcResult.type,
        tier: getTier(cvcResult.type),
        confidence: cvcResult.confidence,
        rule_id: cvcResult.rule_id,
      });
    }

    return spans;
  },
};

export function recognizeElementRules(text: string): Span[] {
  return elementRulesRecognizer.detect(text);
}