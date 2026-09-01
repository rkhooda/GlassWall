/**
 * The registry scan behind the inspector's search box (PLAN-B §6 P12-B).
 *
 * A judge names a secret and we answer one question: is that value present in the
 * payload we would put on the wire — in *any* encoding the egress gate protects
 * against? Answering only for the literal form would be a rubber stamp, so every
 * encoding `generateEncodings()` produces is probed here, and each probe is
 * reported by name so the answer is inspectable rather than asserted.
 *
 * `encodings.test.ts` pins the two lists together: this table must be a superset
 * of what the gate generates, or the inspector could claim NOT PRESENT for a form
 * it never looked for.
 *
 * Nothing here touches the vault or the registry's stored values. The only secret
 * involved is the one the judge typed, and it stays in component state.
 */
import { normalize } from '@glasswall/privacy';

/** Mirrors `generateEncodings()`; identity for every character it does not map. */
const NAMED_ENTITIES: Record<string, string> = {
  '&': '&',
  '<': '<',
  '>': '>',
  '"': '"',
  "'": '&apos;',
  '/': '&#x2F;',
};

/** Per code unit, matching the gate's index loop rather than code-point iteration. */
function perCodeUnit(value: string, map: (code: number, ch: string) => string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) out += map(value.charCodeAt(i), value[i]!);
  return out;
}

export const ENCODERS: readonly { label: string; encode: (v: string) => string }[] = [
  { label: 'literal', encode: v => v },
  { label: 'URL-encoded', encode: v => encodeURIComponent(v) },
  { label: 'double URL-encoded', encode: v => encodeURIComponent(encodeURIComponent(v)) },
  { label: 'base64', encode: v => btoa(v) },
  {
    label: 'base64url',
    encode: v => btoa(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
  },
  { label: 'hex', encode: v => perCodeUnit(v, c => c.toString(16).padStart(2, '0')) },
  { label: 'HTML numeric entities', encode: v => perCodeUnit(v, c => `&#${c};`) },
  { label: 'HTML named entities', encode: v => perCodeUnit(v, (_c, ch) => NAMED_ENTITIES[ch] ?? ch) },
  { label: 'JSON \\u escapes', encode: v => perCodeUnit(v, c => `\\\\u${c.toString(16).padStart(4, '0')}`) },
];

export interface EncodingProbe {
  encoding: string;
  found: boolean;
  /** Why this encoding was not checked, when it could not be computed. */
  skippedReason?: string;
}

export interface ScanResult {
  /** What the judge typed, verbatim. Echoed back so the answer names its question. */
  query: string;
  found: boolean;
  matchedEncodings: string[];
  probes: EncodingProbe[];
}

/**
 * Derived encodings of a very short string collide by accident — the hex of "12"
 * is four characters and appears in half of all payloads. Below this length only
 * the literal form is trustworthy, so only the literal form is probed. Short
 * queries are exactly the ones a human can verify by eye anyway.
 */
const MIN_DERIVED_LENGTH = 4;

export function scanPayload(payload: unknown, query: string): ScanResult {
  const needle = normalize(query);
  if (needle === '') {
    return { query, found: false, matchedEncodings: [], probes: [] };
  }

  const serialized = JSON.stringify(payload) ?? '';
  // Two haystacks: the payload as it would be sent, and its normalized form, so a
  // value broken across whitespace in the payload still matches.
  const haystacks = [serialized.toLowerCase(), normalize(serialized)];

  const probes: EncodingProbe[] = ENCODERS.map(({ label, encode }) => {
    if (label !== 'literal' && needle.length < MIN_DERIVED_LENGTH) {
      return { encoding: label, found: false, skippedReason: `query shorter than ${MIN_DERIVED_LENGTH} characters` };
    }
    let encoded: string;
    try {
      encoded = encode(needle).toLowerCase();
    } catch {
      // btoa() throws outside Latin-1. The gate has the same blind spot; saying so
      // is the honest answer, and it is better than a silent NOT PRESENT.
      return { encoding: label, found: false, skippedReason: 'not representable in this encoding' };
    }
    return { encoding: label, found: haystacks.some(h => h.includes(encoded)) };
  });

  const matchedEncodings = probes.filter(p => p.found).map(p => p.encoding);
  return { query, found: matchedEncodings.length > 0, matchedEncodings, probes };
}
