export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'AADHAAR'
  | 'PAN'
  | 'IFSC'
  | 'GSTIN'
  | 'UPI'
  | 'CARD'
  | 'DOB'
  | 'PERSON_NAME'
  | 'STREET_ADDRESS'
  | 'POSTAL_CODE'
  | 'IP'
  | 'SECRET'
  | 'MRN'
  | 'NONE';

export type Tier = 1 | 2 | 3;

export interface GlassWallAttrs {
  'data-glasswall-pii': PiiType;
  'data-glasswall-tier': Tier;
  'data-glasswall-value-id': string;
  'data-glasswall-decoy'?: 'true';
  'data-glasswall-regions'?: string;
}

export function piiAttrs(
  pii: PiiType,
  tier: Tier,
  valueId: string,
  opts?: { decoy?: boolean }
): GlassWallAttrs {
  const attrs: GlassWallAttrs = {
    'data-glasswall-pii': pii,
    'data-glasswall-tier': tier,
    'data-glasswall-value-id': valueId,
  };
  if (opts?.decoy) attrs['data-glasswall-decoy'] = 'true';
  return attrs;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  pii: PiiType;
  value_id: string;
}

export function regionsAttr(regions: Region[]): { 'data-glasswall-regions': string } {
  return { 'data-glasswall-regions': JSON.stringify(regions) };
}

export function applyAttrs(el: HTMLElement, attrs: Record<string, string>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
}

export function piiAttrsInput(
  pii: PiiType,
  tier: Tier,
  valueId: string,
  opts?: { decoy?: boolean }
): Record<string, string> {
  return piiAttrs(pii, tier, valueId, opts) as unknown as Record<string, string>;
}

export function piiAttrsSpan(
  pii: PiiType,
  tier: Tier,
  valueId: string,
  opts?: { decoy?: boolean }
): Record<string, string> {
  return piiAttrs(pii, tier, valueId, opts) as unknown as Record<string, string>;
}

export function piiAttrsCanvas(regions: Region[]): Record<string, string> {
  return regionsAttr(regions);
}

export function piiAttrsImage(regions: Region[]): Record<string, string> {
  return regionsAttr(regions);
}

export function piiAttrsTextBlock(): Record<string, string> {
  return { 'data-glasswall-pii': 'NONE', 'data-glasswall-tier': '3', 'data-glasswall-value-id': 'v_0' };
}