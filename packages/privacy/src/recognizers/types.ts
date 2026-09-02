export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'AADHAAR'
  | 'PAN'
  | 'IFSC'
  | 'GSTIN'
  | 'UPI'
  | 'CARD'
  | 'IP'
  | 'DOB'
  | 'SECRET'
  | 'PASSWORD'
  | 'CREDIT_CARD'
  | 'CVC'
  | 'OTP'
  | 'STREET_ADDRESS'
  | 'CITY'
  | 'STATE'
  | 'POSTAL_CODE'
  | 'BDAY'
  | 'MRN'
  | 'PERSON_NAME'
  | 'ORGANIZATION';

export type PiiTier = 1 | 2 | 3;

export interface Span {
  start: number;
  end: number;
  value: string;
  type: PiiType;
  tier: PiiTier;
  confidence: number;
  rule_id: string;
}

export interface Recognizer {
  type: PiiType;
  tier: PiiTier;
  detect(text: string): Span[];
  detectElement?(element: RawElement): Span[];
}

export interface RawElement {
  id: string;
  id_hash: string;
  tag: string;
  role: string;
  type?: string;
  label_raw: string;
  placeholder_raw?: string;
  rect: [number, number, number, number];
  visible: boolean;
  enabled: boolean;
  focusable: boolean;
  value_state: 'empty' | 'partial' | 'filled' | 'n/a';
  options_count?: number;
  group: string;
  frame: number;
  unexplained?: boolean;
  autocomplete?: string;
  input_type?: string;
  maxlength?: number;
}

const tierMap: Record<PiiType, PiiTier> = {
  EMAIL: 2,
  PHONE: 2,
  AADHAAR: 2,
  PAN: 2,
  IFSC: 2,
  GSTIN: 2,
  UPI: 2,
  CARD: 2,
  IP: 3,
  DOB: 3,
  SECRET: 1,
  PASSWORD: 1,
  CREDIT_CARD: 1,
  CVC: 1,
  OTP: 1,
  STREET_ADDRESS: 3,
  CITY: 3,
  STATE: 3,
  POSTAL_CODE: 3,
  BDAY: 3,
  MRN: 2,
  PERSON_NAME: 3,
  ORGANIZATION: 3,
};

export function getTier(type: PiiType): PiiTier {
  return tierMap[type];
}

let constructionCounter = 0;
export function getConstructionCount(): number {
  return constructionCounter;
}
export function incrementConstructionCount(): void {
  constructionCounter++;
}
export function resetConstructionCount(): void {
  constructionCounter = 0;
}