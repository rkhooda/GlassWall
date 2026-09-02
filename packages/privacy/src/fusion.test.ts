import { describe, it, expect } from 'vitest';
import type { Detection } from '@glasswall/schema/audit';
import { fuse, noisyOr } from './fusion';
import { BALANCED, STRICT, PROFILES } from './policy';

function det(over: Partial<Detection> = {}): Detection {
  return {
    type: 'vision',
    pii_type: 'NAME',
    confidence: 0.4,
    rect: [100, 100, 80, 20],
    source_id: 'test',
    ...over,
  };
}

describe('noisyOr', () => {
  it('is 0 with no evidence', () => {
    expect(noisyOr([])).toBe(0);
  });

  it('saturates at 1 when any term is certain', () => {
    expect(noisyOr([0.1, 1, 0.2])).toBe(1);
  });

  it('is monotone under any added term', () => {
    // Property test. A deterministic LCG keeps a failure reproducible from the seed.
    let seed = 0x5eed;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let trial = 0; trial < 500; trial++) {
      const terms = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => rand());
      const before = noisyOr(terms);
      const after = noisyOr([...terms, rand()]);
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });

  it('never decreases when a term grows', () => {
    expect(noisyOr([0.3, 0.9])).toBeGreaterThan(noisyOr([0.3, 0.2]));
  });
});

describe('fuse — synthetic evidence', () => {
  it('one weak source stays below every redaction threshold', () => {
    // vision w=0.5 × c=0.4 = 0.20, under BALANCED's tokenize floor of 0.35.
    const [region] = fuse({ detections: [det()], unexplained: [], profile: BALANCED });
    expect(region!.sensitivity).toBeCloseTo(0.2, 6);
    expect(region!.threshold_matched).toBe('below_tokenize');
  });

  it('three weak sources cross a threshold that none of them reaches alone', () => {
    // 0.5×0.4 = 0.20, 0.8×0.4 = 0.32, 0.9×0.4 = 0.36 → S = 1 − 0.80·0.68·0.64 = 0.652
    const detections = [
      det({ type: 'vision' }),
      det({ type: 'ocr' }),
      det({ type: 'ner' }),
    ];
    const [region] = fuse({ detections, unexplained: [], profile: BALANCED });

    expect(region!.sensitivity).toBeCloseTo(0.6518, 3);
    expect(region!.threshold_matched).toBe('mask');
    expect(region!.action).toBe('MASK');
    expect(region!.evidence).toHaveLength(3);
  });

  it('adding evidence to a region never lowers its score', () => {
    const one = fuse({ detections: [det()], unexplained: [], profile: BALANCED })[0]!;
    const two = fuse({ detections: [det(), det({ type: 'ocr' })], unexplained: [], profile: BALANCED })[0]!;
    const three = fuse({
      detections: [det(), det({ type: 'ocr' }), det({ type: 'ner' })],
      unexplained: [],
      profile: BALANCED,
    })[0]!;

    expect(two.sensitivity).toBeGreaterThanOrEqual(one.sensitivity);
    expect(three.sensitivity).toBeGreaterThanOrEqual(two.sensitivity);
  });

  it('a compromised vision source can only over-redact', () => {
    // Vision reports maximum confidence everywhere. There is no channel through
    // which it could argue a region is clean, so the only reachable damage is
    // more redaction than necessary.
    const honest = fuse({ detections: [det({ type: 'ner', confidence: 0.9 })], unexplained: [], profile: BALANCED })[0]!;
    const attacked = fuse({
      detections: [det({ type: 'ner', confidence: 0.9 }), det({ type: 'vision', confidence: 1 })],
      unexplained: [],
      profile: BALANCED,
    })[0]!;

    expect(attacked.sensitivity).toBeGreaterThanOrEqual(honest.sensitivity);
  });

  it('carries a human-readable reason, and no value', () => {
    const [region] = fuse({
      detections: [det({ type: 'regex', pii_type: 'EMAIL', confidence: 0.95, text_span: 'h_abc' })],
      unexplained: [],
      profile: BALANCED,
    });
    expect(region!.reason).toMatch(/^(TOKENIZE|MASK|DROP): EMAIL from regex \(S=0\.\d\d\)$/);
  });

  it('gives an unexplained region the profile prior, and STRICT more than BALANCED', () => {
    const unexplained = [{ rect: [400, 400, 60, 60] as [number, number, number, number], reason: 'unexplained <canvas> region, no DOM owner' }];

    const strict = fuse({ detections: [], unexplained, profile: STRICT })[0]!;
    const balanced = fuse({ detections: [], unexplained, profile: PROFILES.BALANCED })[0]!;

    expect(strict.sensitivity).toBeCloseTo(0.8, 6);
    expect(balanced.sensitivity).toBeCloseTo(0.4, 6);
    expect(strict.action).toBe('DROP');
    expect(balanced.action).toBe('TOKENIZE');
    expect(strict.reason).toContain('no DOM owner');
  });

  it('tier-1 evidence goes to the vault whatever the score says', () => {
    const [region] = fuse({
      detections: [det({ type: 'regex', pii_type: 'PASSWORD', confidence: 0.05 })],
      unexplained: [],
      profile: PROFILES.PERMISSIVE,
    });
    expect(region!.action).toBe('VAULT_ONLY');
  });

  it('drops evidence with no rect rather than guessing a location', () => {
    const regions = fuse({
      detections: [det({ rect: undefined })],
      unexplained: [],
      profile: BALANCED,
    });
    expect(regions).toHaveLength(0);
  });
});

describe('fuse — performance', () => {
  it('fuses 100 regions against 400 elements in under 60ms', () => {
    const detections: Detection[] = Array.from({ length: 400 }, (_, i) =>
      det({
        type: (['regex', 'ner', 'ocr', 'vision'] as const)[i % 4],
        confidence: 0.5 + (i % 5) / 10,
        rect: [(i % 20) * 64, Math.floor(i / 20) * 32, 60, 28],
      })
    );
    const unexplained = Array.from({ length: 100 }, (_, i) => ({
      rect: [(i % 10) * 128, Math.floor(i / 10) * 96, 120, 90] as [number, number, number, number],
      reason: 'opaque <canvas>, contents not readable from the DOM',
    }));

    // 10 warm-up iterations, then p95 over 100. p95 over a handful of samples is
    // the maximum in disguise, and the maximum here measures the GC, not the code.
    for (let i = 0; i < 10; i++) fuse({ detections, unexplained, profile: BALANCED });

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      fuse({ detections, unexplained, profile: BALANCED });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);

    expect(samples[Math.floor(samples.length * 0.95)]!).toBeLessThan(60);
  });
});
