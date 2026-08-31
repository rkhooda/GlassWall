import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILES, parseProfile, decide, tierForType, type Profile } from './policy';
import { fuse } from './fusion';
import type { Detection } from '@glasswall/schema/audit';

const CONFIG_DIR = resolve(__dirname, '../../../config/policies');

function fromDisk(name: string): Profile {
  return parseProfile(JSON.parse(readFileSync(resolve(CONFIG_DIR, `${name}.json`), 'utf8')));
}

describe('policy profiles on disk', () => {
  it.each(['strict', 'balanced', 'permissive'])('config/policies/%s.json validates', name => {
    expect(() => fromDisk(name)).not.toThrow();
  });

  it('the JSON the harness reads matches the profiles the bundle embeds', () => {
    // The extension cannot read the filesystem, so it carries the profiles as
    // constants. This is the only thing stopping the two from drifting apart.
    for (const name of ['strict', 'balanced', 'permissive'] as const) {
      expect(fromDisk(name)).toEqual(PROFILES[name.toUpperCase() as keyof typeof PROFILES]);
    }
  });

  it('rejects a profile with an out-of-range weight rather than running it', () => {
    const broken = JSON.parse(JSON.stringify(PROFILES.BALANCED));
    broken.fusion.source_weights.vision = 1.7;
    expect(() => parseProfile(broken)).toThrow();
  });

  it('rejects an unknown key rather than silently ignoring it', () => {
    const broken = JSON.parse(JSON.stringify(PROFILES.BALANCED));
    broken.fusion.unexplained_prior = 0.9; // right idea, wrong object
    expect(() => parseProfile(broken)).toThrow();
  });

  it('an ablation can zero a source weight without touching code', () => {
    const noVision = parseProfile({
      ...PROFILES.BALANCED,
      fusion: {
        ...PROFILES.BALANCED.fusion,
        source_weights: { ...PROFILES.BALANCED.fusion.source_weights, vision: 0 },
      },
    });
    const detection: Detection = {
      type: 'vision', pii_type: 'NAME', confidence: 1, rect: [0, 0, 10, 10], source_id: 'v',
    };
    const [region] = fuse({ detections: [detection], unexplained: [], profile: noVision });
    expect(region!.sensitivity).toBe(0);
  });
});

describe('decide — same input, three profiles', () => {
  // One mid-confidence NAME detection, scored under each profile in turn.
  const input = { sensitivity: 0.55, piiType: 'NAME' as const, tier: tierForType('NAME'), cause: 'NAME from ner' };

  it('produces three different outputs from one input', () => {
    expect({
      STRICT: decide(PROFILES.STRICT, input),
      BALANCED: decide(PROFILES.BALANCED, input),
      PERMISSIVE: decide(PROFILES.PERMISSIVE, input),
    }).toEqual({
      STRICT: { action: 'MASK', reason: 'MASK: NAME from ner', threshold_matched: 'mask' },
      BALANCED: { action: 'MASK', reason: 'MASK: NAME from ner', threshold_matched: 'mask' },
      PERMISSIVE: { action: 'TOKENIZE', reason: 'TOKENIZE: NAME from ner', threshold_matched: 'below_tokenize' },
    });
  });

  it('separates the profiles on an unexplained region', () => {
    const unexplained = [{ rect: [0, 0, 100, 100] as [number, number, number, number], reason: 'opaque <canvas>, no DOM owner' }];
    const actions = (['STRICT', 'BALANCED', 'PERMISSIVE'] as const).map(
      name => fuse({ detections: [], unexplained, profile: PROFILES[name] })[0]!.action
    );
    expect(actions).toEqual(['DROP', 'TOKENIZE', 'PASS']);
  });

  it('breaks a tie toward redaction', () => {
    const onTheLine = { sensitivity: PROFILES.BALANCED.policy.thresholds.mask, cause: 'exactly on the mask threshold', tier: 3 };
    expect(decide(PROFILES.BALANCED, onTheLine).action).toBe('MASK');
  });

  it('sends a tier-1 secret to the vault under every profile', () => {
    for (const profile of Object.values(PROFILES)) {
      const d = decide(profile, { sensitivity: 0, piiType: 'PASSWORD', tier: 1, cause: 'password field' });
      expect(d.action).toBe('VAULT_ONLY');
      expect(d.reason).toBe('VAULT_ONLY: tier-1 secret, password field');
    }
  });
});
