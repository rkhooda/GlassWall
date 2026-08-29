import { describe, it, expect } from 'vitest';
import {
  generatePersona,
  generateDecoys,
  exportGroundTruth,
  verifyVerhoeff,
  verifyLuhn,
  verifyGstin,
} from './generator';

describe('generator — seeded determinism', () => {
  it('same seed produces byte-identical persona', () => {
    const p1 = generatePersona(42);
    const p2 = generatePersona(42);
    expect(p1).toEqual(p2);
  });

  it('different seeds produce different personas', () => {
    const p1 = generatePersona(42);
    const p2 = generatePersona(43);
    expect(p1).not.toEqual(p2);
  });

  it('same seed produces byte-identical decoys', () => {
    const d1 = generateDecoys(42);
    const d2 = generateDecoys(42);
    expect(d1).toEqual(d2);
  });

  it('exportGroundTruth writes valid JSON', () => {
    const fs = require('fs');
    const path = require('path');
    const tmpDir = path.join(__dirname, '../../tmp-test-fixtures');
    exportGroundTruth(999, tmpDir);
    const file = path.join(tmpDir, 'ground-truth-999.json');
    expect(fs.existsSync(file)).toBe(true);
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.seed).toBe(999);
    expect(content.values).toBeInstanceOf(Array);
    expect(content.values.length).toBeGreaterThan(0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('generator — checksum validity', () => {
  it('every generated Aadhaar passes Verhoeff', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generatePersona(seed);
      const aadhaar = p.values.find(v => v.type === 'AADHAAR');
      expect(aadhaar).toBeDefined();
      expect(verifyVerhoeff(aadhaar!.value)).toBe(true);
    }
  });

  it('every generated card passes Luhn', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generatePersona(seed);
      const card = p.values.find(v => v.type === 'CARD');
      expect(card).toBeDefined();
      expect(verifyLuhn(card!.value)).toBe(true);
    }
  });

  it('every generated GSTIN passes check character', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generatePersona(seed);
      const gstin = p.values.find(v => v.type === 'GSTIN');
      expect(gstin).toBeDefined();
      expect(verifyGstin(gstin!.value)).toBe(true);
    }
  });

  it('every Aadhaar decoy FAILS Verhoeff', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = generatePersona(seed);
      const decoy = p.decoys.find(v => v.type === 'AADHAAR' && v.decoy);
      expect(decoy).toBeDefined();
      expect(verifyVerhoeff(decoy!.value)).toBe(false);
    }
  });

  it('every card decoy FAILS Luhn', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = generatePersona(seed);
      const decoy = p.decoys.find(v => v.type === 'CARD' && v.decoy);
      expect(decoy).toBeDefined();
      expect(verifyLuhn(decoy!.value)).toBe(false);
    }
  });

  it('every PAN decoy is PAN-shaped but not a valid PAN', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = generatePersona(seed);
      const decoy = p.decoys.find(v => v.type === 'PAN' && v.decoy);
      expect(decoy).toBeDefined();
      expect(decoy!.value).toMatch(/^[A-Z]{5}[0-9]{4}[A-Z]$/);
      expect(decoy!.value).toMatch(/^PROD/);
    }
  });

  it('every postal code decoy is 6-digit but not a real PIN', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = generatePersona(seed);
      const decoy = p.decoys.find(v => v.type === 'POSTAL_CODE' && v.decoy);
      if (decoy) {
        expect(decoy.value).toMatch(/^\d{6}$/);
        expect(['560001', '400001', '110001', '500001', '600001', '700001', '411001', '380001', '302001', '226001', '208001', '440001', '452001', '462001', '530001', '800001']).not.toContain(decoy.value);
      }
    }
  });
});

describe('generator — referential consistency', () => {
  it('same logical value gets same value_id within a seed', () => {
    const p = generatePersona(123);
    const emailValues = p.values.filter(v => v.type === 'EMAIL' || (v.type === 'PHONE' && v.value.includes('@')));
    const uniqueByValue = new Map(emailValues.map(v => [v.value, v.value_id]));
    for (const v of emailValues) {
      expect(v.value_id).toBe(uniqueByValue.get(v.value));
    }
  });

  it('value_ids are sequential v_1, v_2, ...', () => {
    const p = generatePersona(456);
    const ids = p.values.map(v => v.value_id).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(`v_${i + 1}`);
    }
  });
});

describe('generator — schema compliance', () => {
  it('every value has type, tier, value_id', () => {
    const p = generatePersona(789);
    for (const v of [...p.values, ...p.decoys]) {
      expect(v.type).toBeDefined();
      expect([1, 2, 3]).toContain(v.tier);
      expect(v.value_id).toMatch(/^v_\d+$/);
    }
  });

  it('decoys have decoy: true flag', () => {
    const p = generatePersona(789);
    for (const v of p.decoys) {
      expect(v.decoy).toBe(true);
    }
  });

  it('non-decoys have decoy: false or undefined', () => {
    const p = generatePersona(789);
    for (const v of p.values) {
      expect(v.decoy).not.toBe(true);
    }
  });

  it('clinical paragraph contains name and address', () => {
    const p = generatePersona(999);
    const nameVal = p.values.find(v => v.type === 'PERSON_NAME');
    const addrVal = p.values.find(v => v.type === 'STREET_ADDRESS');
    expect(p.clinicalParagraph).toContain(nameVal!.value);
    expect(p.clinicalParagraph).toContain(addrVal!.value);
  });
});