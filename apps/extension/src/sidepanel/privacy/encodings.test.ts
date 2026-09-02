import { describe, expect, it } from 'vitest';
import { generateEncodings, normalize } from '@glasswall/privacy';
import { ENCODERS, scanPayload } from './scan';

/**
 * The inspector may not claim NOT PRESENT for an encoding it never looked for.
 * If the egress gate learns a new encoding, this test fails until the inspector
 * learns it too.
 */
describe('the inspector checks every encoding the gate generates', () => {
  const SAMPLES = ['4242424242424242', 'anita.sharma@example.in', '846 HSR Layout', 'sk_live_9fA2bQ'];

  for (const sample of SAMPLES) {
    it(`covers the gate's encodings of ${JSON.stringify(sample)}`, () => {
      const normalized = normalize(sample);
      const inspector = new Set(ENCODERS.map(e => e.encode(normalized).toLowerCase()));
      for (const form of generateEncodings(normalized)) {
        expect(inspector.has(form.toLowerCase())).toBe(true);
      }
    });
  }
});

describe('scanPayload', () => {
  it('finds a value hidden in an encoding, not just the literal', () => {
    const secret = 'anita.sharma@example.in';
    const payload = { note: btoa(normalize(secret)) };

    const result = scanPayload(payload, secret);
    expect(result.found).toBe(true);
    expect(result.matchedEncodings).toContain('base64');
    expect(result.matchedEncodings).not.toContain('literal');
  });

  it('encodes non-Latin-1 text as UTF-8 base64, the same way the gate does', () => {
    const value = 'अनिता शर्मा';
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    const result = scanPayload({ note: `blob ${encoded}` }, value);
    const base64 = result.probes.find(p => p.encoding === 'base64');
    expect(base64?.skippedReason).toBeUndefined();
    expect(base64?.found).toBe(true);
    expect(scanPayload({ note: 'nothing here' }, value).found).toBe(false);
  });

  it('probes only the literal form for a query too short to encode safely', () => {
    const result = scanPayload({ n: 42 }, '42');
    expect(result.found).toBe(true);
    expect(result.probes.filter(p => p.skippedReason).length).toBe(ENCODERS.length - 1);
  });

  it('says nothing at all for an empty query', () => {
    expect(scanPayload({ a: 1 }, '   ')).toMatchObject({ found: false, probes: [] });
  });
});
