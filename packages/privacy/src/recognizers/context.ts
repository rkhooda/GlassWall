// Label-context recognizer: values that have no checksum or shape of their own
// (a name, a street, a city, a PIN) but sit next to a label that says what they are.
//
//   <dt>Name</dt><dd>Vivek Gupta</dd>      "Phone: +91 …"      <th>City</th><td>Nagpur</td>
//
// Pages print personal data this way far more often than in free prose, so this
// closes most of the tier-3 gap without a model, and it is exact where NER is
// statistical. NER (offscreen) still covers prose.
import type { RawObservation } from '@glasswall/schema/observation';
import { getTier, type PiiType } from './types';

interface LabelRule {
  re: RegExp;
  type: PiiType;
  /** The value must look like this to be taken. */
  value?: RegExp;
}

const LABELS: LabelRule[] = [
  { re: /^(full |customer |patient |account |your |contact )?name$/i, type: 'PERSON_NAME', value: /^[A-Za-z][A-Za-z.'\- ]{1,60}$/ },
  { re: /^(mobile|phone|telephone|contact number|mobile number|phone number)$/i, type: 'PHONE', value: /(?:\d[\s-]?){6,}/ },
  { re: /^(street|street address|address|address line ?1|residential address|shipping address|billing address|house|flat)$/i, type: 'STREET_ADDRESS', value: /^.{3,80}$/ },
  { re: /^(city|town|district|village)$/i, type: 'CITY', value: /^[A-Za-z][A-Za-z.\- ]{1,40}$/ },
  { re: /^(state|province|region)$/i, type: 'STATE', value: /^[A-Za-z][A-Za-z.\- ]{1,40}$/ },
  { re: /^(pin|pin ?code|pincode|postal ?code|postcode|zip|zip ?code)$/i, type: 'POSTAL_CODE', value: /^[1-9]\d{5}$|^\d{5}(-\d{4})?$/ },
  { re: /^(dob|date of birth|birth ?date|born)$/i, type: 'DOB', value: /\d/ },
  { re: /^(aadhaar|aadhar|uid|uidai)( number| no\.?)?$/i, type: 'AADHAAR', value: /^\d{4}\s?\d{4}\s?\d{4}$/ },
  { re: /^(pan|pan number|pan card)$/i, type: 'PAN', value: /^[A-Z]{5}\d{4}[A-Z]$/i },
  { re: /^(mrn|medical record|patient id|record number)$/i, type: 'MRN', value: /^[A-Z0-9-]{4,}$/i },
  { re: /^(e-?mail|e-?mail address)$/i, type: 'EMAIL', value: /@/ },
];

export interface ContextHit {
  value: string;
  type: PiiType;
  tier: number;
  confidence: number;
  rect: [number, number, number, number];
  textNodeId: string;
}

function cleanLabel(text: string): string {
  return text.replace(/[:：*]+\s*$/, '').trim();
}

/** True when the text is a field label ("City", "Name:"), not a value. */
export function isLabelWord(text: string): boolean {
  return ruleFor(text) !== undefined;
}

function ruleFor(label: string): LabelRule | undefined {
  const clean = cleanLabel(label);
  return LABELS.find(r => r.re.test(clean));
}

/** Words that follow labels like "State" or "Name" but are statuses, not people or places. */
const NOT_A_VALUE = /^(delivered|shipped|processing|pending|cancelled|canceled|active|inactive|none|n\/a|unknown|yes|no|true|false|required|optional|verified|unverified|paid|unpaid|confirmed)$/i;

function accept(rule: LabelRule, value: string): boolean {
  const v = value.trim();
  if (v.length < 2 || v.length > 80) return false;
  if (/⟦[^⟧]+⟧/.test(v)) return false;
  if (ruleFor(v) || NOT_A_VALUE.test(v)) return false; // the "value" is itself another label or a status
  return rule.value ? rule.value.test(v) : true;
}

export function recognizeByContext(raw: RawObservation): ContextHit[] {
  const hits: ContextHit[] = [];
  const nodes = raw.text_nodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const text = node.text.trim();

    // "Label: value" inside one node.
    const inline = text.match(/^([A-Za-z][A-Za-z .-]{1,30}?)\s*[:：]\s*(.+)$/);
    if (inline) {
      const rule = ruleFor(inline[1]!);
      if (rule && accept(rule, inline[2]!)) {
        hits.push({ value: inline[2]!.trim(), type: rule.type, tier: getTier(rule.type), confidence: 0.85, rect: node.rect, textNodeId: node.id });
        continue;
      }
    }

    // Label node followed by a value node (dt/dd, th/td, label/span).
    const rule = ruleFor(text);
    const next = nodes[i + 1];
    if (rule && next && accept(rule, next.text)) {
      // The value must be on the same line or the next one, not far down the page.
      const dy = Math.abs(next.rect[1] - node.rect[1]);
      if (dy <= Math.max(node.rect[3], next.rect[3]) * 2 + 8) {
        hits.push({ value: next.text.trim(), type: rule.type, tier: getTier(rule.type), confidence: 0.85, rect: next.rect, textNodeId: next.id });
        i++;
      }
    }
  }
  return hits;
}
