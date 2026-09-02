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

type TextNode = RawObservation['text_nodes'][number];

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

/**
 * Table columns: a header row of label cells ("Name", "MRN", "Phone") classifies the
 * cells below it in the same column. A header row is a run of consecutive text nodes
 * on one line holding two or more labels; a row below counts only when it fills the
 * header's columns (a form's side-by-side labels have buttons and headings below
 * them, not rows), and a column only when two or more of its rows hold a value.
 */
function tableHits(raw: RawObservation): ContextHit[] {
  const nodes = raw.text_nodes;
  const sameLine = (a: TextNode, b: TextNode) => Math.abs(a.rect[1] - b.rect[1]) <= 8;
  const underColumn = (header: TextNode, cell: TextNode) => {
    const overlap = Math.min(header.rect[0] + header.rect[2], cell.rect[0] + cell.rect[2]) - Math.max(header.rect[0], cell.rect[0]);
    return overlap >= Math.min(header.rect[2], cell.rect[2]) * 0.6;
  };
  const hits: ContextHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; ) {
    let j = i;
    while (j + 1 < nodes.length && sameLine(nodes[j]!, nodes[j + 1]!)) j++;
    const line = nodes.slice(i, j + 1);
    i = j + 1;
    const headers = line.map(n => ({ n, rule: ruleFor(n.text) })).filter(h => h.rule);
    if (headers.length < 2) continue;

    const top = line[0]!.rect[1] + line[0]!.rect[3] / 2;
    const below = nodes.filter(c => c.rect[1] > top).sort((a, b) => a.rect[1] - b.rect[1]);
    const rows: TextNode[][] = [];
    for (const cell of below) {
      const row = rows[rows.length - 1];
      if (row && sameLine(row[0]!, cell)) row.push(cell);
      else rows.push([cell]);
    }
    // Empty cells are allowed, but a row must fill at least two columns (and both of a two-column table).
    const needed = Math.max(2, Math.ceil(line.length / 2));
    const complete = rows.filter(row => line.filter(h => row.some(c => underColumn(h, c))).length >= needed);
    for (const { n: header, rule } of headers) {
      const cells = complete.flatMap(row => row.filter(c => underColumn(header, c)).slice(0, 1)).filter(c => !seen.has(c.id) && accept(rule!, c.text));
      if (cells.length < 2) continue;
      for (const cell of cells) {
        seen.add(cell.id);
        hits.push({ value: cell.text.trim(), type: rule!.type, tier: getTier(rule!.type), confidence: 0.8, rect: cell.rect, textNodeId: cell.id });
      }
    }
  }
  return hits;
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
  const claimed = new Set(hits.map(h => h.textNodeId));
  for (const hit of tableHits(raw)) if (!claimed.has(hit.textNodeId)) hits.push(hit);
  return hits;
}
