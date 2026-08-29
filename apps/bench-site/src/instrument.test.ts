import { describe, it, expect, vi } from 'vitest';
import {
  piiAttrs,
  regionsAttr,
  applyAttrs,
  piiAttrsInput,
  piiAttrsSpan,
  piiAttrsCanvas,
  piiAttrsImage,
  piiAttrsTextBlock,
} from './instrument';

describe('instrument — attribute helpers', () => {
  it('piiAttrs returns correct attributes', () => {
    const attrs = piiAttrs('EMAIL', 2, 'v_17');
    expect(attrs['data-glasswall-pii']).toBe('EMAIL');
    expect(attrs['data-glasswall-tier']).toBe(2);
    expect(attrs['data-glasswall-value-id']).toBe('v_17');
    expect(attrs['data-glasswall-decoy']).toBeUndefined();
  });

  it('piiAttrs with decoy adds decoy attribute', () => {
    const attrs = piiAttrs('AADHAAR', 2, 'v_999', { decoy: true });
    expect(attrs['data-glasswall-decoy']).toBe('true');
  });

  it('regionsAttr serializes regions to JSON', () => {
    const regions = [
      { x: 10, y: 20, w: 100, h: 30, pii: 'AADHAAR' as const, value_id: 'v_42' },
      { x: 50, y: 80, w: 180, h: 40, pii: 'PAN' as const, value_id: 'v_99' },
    ];
    const attrs = regionsAttr(regions);
    const parsed = JSON.parse(attrs['data-glasswall-regions']);
    expect(parsed).toEqual(regions);
  });

  it('applyAttrs sets attributes on element', () => {
    const el = { attributes: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attributes[k] = v; }, getAttribute(k: string) { return this.attributes[k]; } };
    applyAttrs(el as any, { 'data-test': 'value', 'data-other': '123' });
    expect(el.getAttribute('data-test')).toBe('value');
    expect(el.getAttribute('data-other')).toBe('123');
  });

  it('piiAttrsInput returns same as piiAttrs', () => {
    const a1 = piiAttrsInput('PHONE', 2, 'v_12');
    const a2 = piiAttrs('PHONE', 2, 'v_12');
    expect(a1).toEqual(a2);
  });

  it('piiAttrsSpan returns same as piiAttrs', () => {
    const a1 = piiAttrsSpan('PERSON_NAME', 3, 'v_3');
    const a2 = piiAttrs('PERSON_NAME', 3, 'v_3');
    expect(a1).toEqual(a2);
  });

  it('piiAttrsCanvas returns regions attribute', () => {
    const regions = [{ x: 0, y: 0, w: 100, h: 50, pii: 'PERSON_NAME' as const, value_id: 'v_1' }];
    const attrs = piiAttrsCanvas(regions);
    expect(attrs['data-glasswall-regions']).toBeDefined();
    expect(attrs['data-glasswall-pii']).toBeUndefined();
  });

  it('piiAttrsImage returns regions attribute', () => {
    const regions = [{ x: 10, y: 10, w: 200, h: 30, pii: 'GSTIN' as const, value_id: 'v_55' }];
    const attrs = piiAttrsImage(regions);
    expect(attrs['data-glasswall-regions']).toBeDefined();
  });

  it('piiAttrsTextBlock returns NONE tier 3', () => {
    const attrs = piiAttrsTextBlock();
    expect(attrs['data-glasswall-pii']).toBe('NONE');
    expect(attrs['data-glasswall-tier']).toBe('3');
    expect(attrs['data-glasswall-value-id']).toBe('v_0');
  });
});