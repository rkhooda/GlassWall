import { beforeAll, describe, expect, it } from 'vitest';
import { PROFILES } from '@glasswall/privacy/index';
import { buildScene } from '../ablations/scene';
import {
  formatChaosTable,
  isDetectable,
  isHealthy,
  runChaos,
  type ChaosResult,
} from './chaos';

/**
 * Every perception source, force-failed individually and in every combination,
 * under three failure modes. 22 configurations per profile, two profiles.
 *
 * The assertions are deliberately about *properties*, not about a snapshot: a
 * degraded step must terminate, must say what broke, must not redact less, and
 * must not leak more. A number that only holds today would be a worse test.
 */
const SCENE = buildScene(1337);

const runs: Record<'STRICT' | 'BALANCED', ChaosResult[]> = { STRICT: [], BALANCED: [] };

beforeAll(async () => {
  runs.STRICT = await runChaos(SCENE, PROFILES.STRICT);
  runs.BALANCED = await runChaos(SCENE, PROFILES.BALANCED);
  console.log('\nP14-B chaos — BALANCED\n');
  console.log(formatChaosTable(runs.BALANCED));
  console.log('');
}, 120_000);

for (const profile of ['STRICT', 'BALANCED'] as const) {
  describe(`chaos under ${profile}`, () => {
    const all = () => runs[profile];
    const healthy = () => all().find(isHealthy)!;

    it('every configuration terminates with a schema-valid observation', () => {
      for (const r of all()) {
        expect(r.terminated, `${r.config.label} did not terminate`).toBe(true);
        expect(r.schemaValid, `${r.config.label} produced an invalid observation`).toBe(true);
      }
    });

    it('a detectable failure names its source in degraded[]', () => {
      for (const r of all().filter(isDetectable).filter(x => !isHealthy(x))) {
        for (const id of r.config.failed) {
          expect(
            r.degraded.some(d => d.startsWith(id)),
            `${r.config.label}: degraded[] is [${r.degraded.join(', ')}], which does not name ${id}`
          ).toBe(true);
        }
      }
    });

    it('a timeout is reported as a timeout, not as a generic error', () => {
      for (const r of all().filter(x => x.config.mode === 'timeout' && !isHealthy(x))) {
        for (const id of r.config.failed) {
          expect(r.degraded, r.config.label).toContain(`${id}_timeout`);
        }
      }
    });

    it('a detectable failure never redacts less than the healthy step', () => {
      for (const r of all().filter(isDetectable).filter(x => !isHealthy(x))) {
        expect(
          r.redactions,
          `${r.config.label} redacted ${r.redactions}, healthy redacted ${healthy().redactions}`
        ).toBeGreaterThanOrEqual(healthy().redactions);
      }
    });

    it('a detectable failure never leaks more than the healthy step', () => {
      for (const r of all().filter(isDetectable).filter(x => !isHealthy(x))) {
        expect(
          r.leaked,
          `${r.config.label} leaked ${r.leaked} (${r.leakedTypes.join(', ')}), healthy leaked ${healthy().leaked}`
        ).toBeLessThanOrEqual(healthy().leaked);
      }
    });

    it('tier-1 exposure is 0 in every configuration, degraded or not', () => {
      for (const r of all()) {
        expect(r.tier1Exposed, `${r.config.label} exposed a tier-1 value`).toBe(0);
      }
    });

    it('losing every source at once is the safest configuration, not the worst', () => {
      const total = all().filter(r => r.config.failed.length === 3 && isDetectable(r));
      expect(total.length).toBeGreaterThan(0);
      for (const r of total) {
        expect(r.redactions, r.config.label).toBeGreaterThanOrEqual(healthy().redactions);
        expect(r.leaked, r.config.label).toBeLessThanOrEqual(healthy().leaked);
      }
    });
  });
}

describe('the failure mode the system cannot see', () => {
  it('a silently-empty source redacts LESS, and that is the measured residual', () => {
    // Not a bug to be fixed here and not a test to be loosened: a source that loads,
    // runs and returns nothing is indistinguishable from a page with nothing on it.
    // Throw and timeout are caught; this is not. It is non-guarantee N1 with a
    // number, and it is why fusion uses several independent sources rather than one.
    const silent = runs.BALANCED.filter(r => r.config.mode === 'silent' && !isHealthy(r));
    const healthy = runs.BALANCED.find(isHealthy)!;

    expect(silent.length).toBe(7);
    for (const r of silent) {
      expect(r.terminated, r.config.label).toBe(true);
      // Nothing is claimed about redaction counts here beyond tier-1 safety, which
      // is asserted above for every configuration including these.
      expect(r.tier1Exposed).toBe(0);
    }

    const allSilent = silent.find(r => r.config.failed.length === 3)!;
    expect(
      allSilent.redactions,
      'every source silently blind still redacts at least what coverage alone accounts for'
    ).toBeGreaterThan(0);
    expect(allSilent.redactions).toBeLessThanOrEqual(healthy.redactions);
  });
});
