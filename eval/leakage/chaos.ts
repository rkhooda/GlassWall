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
