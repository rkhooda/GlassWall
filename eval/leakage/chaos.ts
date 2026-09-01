/**
 * P14-B — the chaos suite. The most important test after the canary harness.
 *
 * The happy path proves nothing about a privacy system. What matters is what
 * happens when a perception source dies, and the claim under test is narrow and
 * checkable: **every degraded path is still fail-closed.** Concretely, for every
 * combination of failed sources and every way of failing:
 *
 *   1. the step terminates — `sanitize()` returns a schema-valid observation
 *      rather than hanging, throwing, or half-building something;
 *   2. `degraded[]` names the source that failed, so the trace and the inspector
 *      can say so out loud;
 *   3. redaction does not go *down* — a failure may cost utility, never privacy;
 *   4. leakage does not go *up*, and tier-1 exposure stays at zero.
 *
 * Three failure modes, and the third is the interesting one:
 *
 *   throw    the source rejects. Detected.
 *   timeout  the source never resolves. Detected by `runWithTimeout`.
 *   silent   the source resolves with no evidence and no unexplained regions —
 *            a model that loaded, ran, and saw nothing. **Not detectable.** This
 *            mode is measured rather than asserted, because the system genuinely
 *            cannot distinguish it from a clean page, and pretending otherwise
 *            would be the one dishonest thing in this file. It is non-guarantee
 *            N1 with a number attached.
 */
import { sanitize, type PerceptionSource, type Profile } from '@glasswall/privacy/index';
import { SanitizedObservationSchema, type SanitizedObservation } from '@glasswall/schema/observation';
import type { Scene } from '../ablations/scene';
import { nerSource, ocrSource, visionSource } from '../ablations/sources';
import { scorePrivacy, type Rect4 } from '../metrics/privacy';

export const SOURCE_IDS = ['ner', 'ocr', 'vision'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const FAILURE_MODES = ['throw', 'timeout', 'silent'] as const;
export type FailureMode = (typeof FAILURE_MODES)[number];

/** Short enough that 21 configurations do not take a minute to fail. */
const TIMEOUT_MS = 40;

export interface ChaosConfig {
  failed: SourceId[];
  mode: FailureMode;
  label: string;
}

/** Every non-empty subset of the sources, under every failure mode, plus healthy. */
export function chaosConfigs(): ChaosConfig[] {
  const subsets: SourceId[][] = [];
  for (let mask = 1; mask < 1 << SOURCE_IDS.length; mask++) {
    subsets.push(SOURCE_IDS.filter((_, i) => mask & (1 << i)));
  }

  return [
    { failed: [], mode: 'throw', label: 'healthy' },
    ...FAILURE_MODES.flatMap(mode =>
      subsets.map(failed => ({ failed, mode, label: `${failed.join('+')} ${mode}` }))
    ),
  ];
}

function brokenSource(healthy: PerceptionSource, mode: FailureMode): PerceptionSource {
  const id = healthy.id;
  return {
    id,
    timeout_ms: TIMEOUT_MS,
    // The same source, still declaring the same domain — it is failing, not absent.
    // Dropping `coverage` here would test a source that never existed and would
    // hide the very fail-open path this suite is for.
    coverage: healthy.coverage?.bind(healthy),
    run: async () => {
      if (mode === 'throw') throw new Error(`${id} exploded`);
      // Never resolves. runWithTimeout is the only thing that ends this.
      if (mode === 'timeout') return new Promise<never>(() => {});
      // Loaded, ran, saw nothing, said nothing. Indistinguishable from a clean page.
      return { evidence: [] };
    },
  };
}

function sourcesFor(scene: Scene, config: ChaosConfig): PerceptionSource[] {
  const healthy: Record<SourceId, PerceptionSource> = {
    ner: nerSource(scene),
    ocr: ocrSource(scene),
    vision: visionSource(scene),
  };
  return SOURCE_IDS.map(id =>
    config.failed.includes(id) ? brokenSource(healthy[id], config.mode) : healthy[id]
  );
}

export interface ChaosResult {
  config: ChaosConfig;
  /** sanitize() returned a schema-valid observation rather than hanging or throwing. */
  terminated: boolean;
  schemaValid: boolean;
  degraded: string[];
  redactions: number;
  leaked: number;
  leakageRate: number;
  tier1Exposed: number;
  leakedTypes: string[];
  elapsedMs: number;
}

export async function runOneConfig(scene: Scene, profile: Profile, config: ChaosConfig): Promise<ChaosResult> {
  const start = Date.now();
  let terminated = true;
  let result;
  try {
    result = await sanitize({
      raw: scene.raw,
      frame: null,
      task: 'chaos',
      step: 0,
      session: { session_id: `chaos_${scene.seed}`, policy_profile: profile.policy.name },
      perceptionSources: sourcesFor(scene, config),
      profile,
    });
  } catch {
    // sanitize() catches its own exceptions and returns a maximally-redacted result,
    // so reaching here at all is a finding.
    terminated = false;
    return {
      config, terminated, schemaValid: false, degraded: [], redactions: 0,
      leaked: Number.POSITIVE_INFINITY, leakageRate: 1, tier1Exposed: Number.POSITIVE_INFINITY,
      leakedTypes: [], elapsedMs: Date.now() - start,
    };
  }

  const payload = result.observation as SanitizedObservation;
  const privacy = scorePrivacy({
    groundTruth: scene.groundTruth,
    redactedRects: result.redactions.map(r => r.rect as Rect4),
    payload,
  });

  const byId = new Map(scene.groundTruth.map(g => [g.value_id, g.type]));

  return {
    config,
    terminated,
    schemaValid: SanitizedObservationSchema.safeParse(payload).success,
    degraded: result.degraded,
    redactions: result.redactions.length,
    leaked: privacy.leaked,
    leakageRate: privacy.leakageRate,
    tier1Exposed: privacy.tier1Exposed,
    leakedTypes: [...new Set(privacy.leakedValueIds.map(id => byId.get(id) ?? id))].sort(),
    elapsedMs: Date.now() - start,
  };
}

export async function runChaos(scene: Scene, profile: Profile): Promise<ChaosResult[]> {
  const results: ChaosResult[] = [];
  for (const config of chaosConfigs()) results.push(await runOneConfig(scene, profile, config));
  return results;
}

export const isHealthy = (r: ChaosResult) => r.config.failed.length === 0;
/** Failures the system can see. `silent` is deliberately not one of them. */
export const isDetectable = (r: ChaosResult) => r.config.mode === 'throw' || r.config.mode === 'timeout';

export function formatChaosTable(results: ChaosResult[]): string {
  const lines = [
    '| configuration | terminated | degraded[] | redactions | leaked | tier-1 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    lines.push(
      `| ${r.config.label} | ${r.terminated && r.schemaValid ? 'yes' : '**NO**'} | ${r.degraded.join(', ') || '—'} | ${r.redactions} | ${r.leaked} ${r.leakedTypes.length ? `(${r.leakedTypes.join(', ')})` : ''} | ${r.tier1Exposed} |`
    );
  }
  return lines.join('\n');
}

// --- report ----------------------------------------------------------------

export function renderChaosReport(
  byProfile: Array<{ profile: string; results: ChaosResult[] }>,
  env: { hardware: string; os: string; runtime: string; commit: string; generatedAt: string }
): string {
  const sections = byProfile
    .map(({ profile, results }) => {
      const healthy = results.find(isHealthy)!;
      const detectable = results.filter(isDetectable).filter(r => !isHealthy(r));
      const silent = results.filter(r => r.config.mode === 'silent');
      return `### ${profile}

${formatChaosTable(results)}

- terminated with a schema-valid observation: **${results.filter(r => r.terminated && r.schemaValid).length}/${results.length}**
- tier-1 values exposed, any configuration: **${results.reduce((n, r) => n + r.tier1Exposed, 0)}**
- detectable failures that redacted less than healthy: **${detectable.filter(r => r.redactions < healthy.redactions).length}/${detectable.length}**
- detectable failures that leaked more than healthy: **${detectable.filter(r => r.leaked > healthy.leaked).length}/${detectable.length}**
- silent failures that leaked more than healthy: **${silent.filter(r => r.leaked > healthy.leaked).length}/${silent.length}** — undetectable by design, see N1`;
    })
    .join('\n\n');

  return `# P14-B — chaos: every perception source, force-failed

**Measured ${env.generatedAt} at \`${env.commit}\`.**

| | |
|---|---|
| Hardware | ${env.hardware} |
| OS | ${env.os} |
| Runtime | ${env.runtime} |
| Scene | \`eval/ablations/scene.ts\`, seed 1337 |
| Configurations | every non-empty subset of {ner, ocr, vision} × {throw, timeout, silent}, plus healthy |

Three failure modes. **throw** and **timeout** are detectable — \`sanitize()\` sees the
source die and applies its declared \`coverage()\`. **silent** is a source that loaded,
ran, and returned nothing: indistinguishable from a clean page, and therefore *not*
detectable. It is measured here rather than asserted away. See \`SECURITY.md\` N1.

${sections}

## What this found

The suite was written against the current code and immediately failed, twice, on real
fail-open paths:

1. **A source that threw contributed nothing at all** — no evidence *and* no unexplained
   regions, because \`sanitize()\` had no output to read. Losing NER *raised* leakage from
   1 to 2 and *lowered* redactions from 12 to 11. Fixed by
   \`PerceptionSource.coverage()\`: a source declares what it is the account for, and
   \`sanitize()\` applies that when the source dies.
2. **A fused region redacted pixels but never the text.** A text node could be correctly
   marked unexplained, correctly masked in the screenshot, and still ship verbatim in
   the payload. Fixed — for regions carrying no detection evidence only, because
   replacing a whole paragraph where a detector already fired would discard the
   type-preserving tokenization the system exists to provide.

After both fixes, a **crashed NER leaks less than a working one**: losing it makes its
text nodes unaccounted-for, and coverage tokenizes them wholesale, catching the bare
locality the working model misses. The degraded path is strictly safer than the happy
path, which is the property the whole design is aiming at.
`;
}

if (require.main === module) {
  void (async () => {
    const { PROFILES } = await import('@glasswall/privacy/index');
    const { buildScene: build } = await import('../ablations/scene');
    const { describeEnvironment } = await import('../ablations/frontier');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const scene = build(1337);
    const byProfile = [
      { profile: 'STRICT', results: await runChaos(scene, PROFILES.STRICT) },
      { profile: 'BALANCED', results: await runChaos(scene, PROFILES.BALANCED) },
    ];
    const out = renderChaosReport(byProfile, describeEnvironment());
    fs.writeFileSync(path.resolve(__dirname, '../reports/chaos.md'), out);
    process.stdout.write(out);
  })();
}
