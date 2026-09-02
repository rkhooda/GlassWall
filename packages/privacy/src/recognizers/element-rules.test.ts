import { describe, it, expect } from 'vitest';
import type { RawElement } from './element-rules';
import { elementRulesRecognizer } from './element-rules';

describe('elementRulesRecognizer', () => {
  const baseElement: RawElement = {
    id: 'e1',
    id_hash: 'hash1',
    tag: 'input',
    role: 'textbox',
    label_raw: '',
    placeholder_raw: '',
    rect: [0, 0, 100, 30],
    visible: true,
    enabled: true,
    focusable: true,
    value_state: 'empty',
    group: 'form#1',
    frame: 0,
  };

  it('detects password input type', () => {
    const element = { ...baseElement, input_type: 'password' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('PASSWORD');
    expect(spans[0].tier).toBe(1);
    expect(spans[0].confidence).toBe(1.0);
    expect(spans[0].rule_id).toBe('element-input-type-password-v1');
  });

  it('detects credit card autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'cc-number' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('CREDIT_CARD');
    expect(spans[0].tier).toBe(1);
    expect(spans[0].confidence).toBe(0.99);
  });

  it('detects CVC autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'cc-csc' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('CVC');
    expect(spans[0].tier).toBe(1);
  });

  it('detects OTP autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'one-time-code' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('OTP');
    expect(spans[0].tier).toBe(1);
  });

  it('detects street address autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'street-address' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('STREET_ADDRESS');
    expect(spans[0].tier).toBe(3);
  });

  it('detects postal code autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'postal-code' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('POSTAL_CODE');
    expect(spans[0].tier).toBe(3);
  });

  it('detects bday autocomplete', () => {
    const element = { ...baseElement, autocomplete: 'bday' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('BDAY');
    expect(spans[0].tier).toBe(3);
  });

  it('detects multiple autocomplete tokens', () => {
    const element = { ...baseElement, autocomplete: 'cc-number cc-csc' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(2);
    const types = spans.map(s => s.type).sort();
    expect(types).toEqual(['CREDIT_CARD', 'CVC']);
  });

  it('detects OTP heuristic from label', () => {
    const element = { ...baseElement, label_raw: 'Enter OTP code', input_type: 'text' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('OTP');
    expect(spans[0].tier).toBe(1);
  });

  it('detects OTP heuristic from placeholder', () => {
    const element = { ...baseElement, placeholder_raw: 'Enter verification code', input_type: 'text' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('OTP');
  });

  it('detects credit card heuristic from label', () => {
    const element = { ...baseElement, label_raw: 'Card Number' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('CREDIT_CARD');
  });

  it('detects CVC heuristic from label', () => {
    const element = { ...baseElement, label_raw: 'CVV' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(1);
    expect(spans[0].type).toBe('CVC');
  });

  it('returns empty for non-sensitive element', () => {
    const element = { ...baseElement, label_raw: 'Username', input_type: 'text' };
    const spans = elementRulesRecognizer.detectElement(element);
    expect(spans.length).toBe(0);
  });

  it('password input type short-circuits - Tier 1', () => {
    const element = { ...baseElement, input_type: 'password', autocomplete: 'username' };
    const spans = elementRulesRecognizer.detectElement(element);
    const tier1Spans = spans.filter(s => s.tier === 1);
    expect(tier1Spans.length).toBeGreaterThanOrEqual(1);
    expect(tier1Spans.some(s => s.type === 'PASSWORD')).toBe(true);
  });
});