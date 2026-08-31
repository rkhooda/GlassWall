/**
 * P11 ablation — does fusion actually beat every single source on PII recall?
 *
 * Every configuration is the same code path with a different profile. Nothing is
 * recompiled and no branch is taken on the config name: an ablation is literally
 * "set `w_i` to 0 in the JSON", which is the property the policy engine exists for.
 */
import { sanitize, parseProfile, PROFILES, type Profile } from '@glasswall/privacy/index';
import { buildScene, type Scene } from './scene';
import { nerSource, ocrSource, visionSource } from './sources';
import { scorePrivacy, mean, stddev, type PrivacyScore, type Rect4 } from '../metrics/privacy';

export interface AblationConfig {
  id: string;
  label: string;
  weights: Partial<Record<'regex' | 'ner' | 'ocr' | 'vision' | 'deterministic', number>>;
}

/** A1/A6/A7 follow the naming in PLAN-B §6 P12-B; the single-source rows are A2–A5. */
export const CONFIGS: AblationConfig[] = [
  { id: 'A1', label: 'DOM only (regex)', weights: { ner: 0, ocr: 0, vision: 0, deterministic: 0 } },
  { id: 'A2', label: 'NER only', weights: { regex: 0, ocr: 0, vision: 0, deterministic: 0 } },
  { id: 'A3', label: 'OCR only', weights: { regex: 0, ner: 0, vision: 0, deterministic: 0 } },
  { id: 'A4', label: 'vision only', weights: { regex: 0, ner: 0, ocr: 0, deterministic: 0 } },
  { id: 'A5', label: 'explain-or-redact only', weights: { regex: 0, ner: 0, ocr: 0, vision: 0 } },
  { id: 'A6', label: 'fusion, no coverage', weights: { deterministic: 0 } },
  { id: 'A7', label: 'fusion + explain-or-redact', weights: {} },
  { id: 'A8', label: 'fusion + explain-or-redact, vision disabled', weights: { vision: 0 } },
  { id: 'A9', label: 'fusion, no coverage, vision disabled', weights: { vision: 0, deterministic: 0 } },
];

export function profileFor(base: Profile, config: AblationConfig): Profile {
  return parseProfile({
    ...base,
    fusion: { ...base.fusion, source_weights: { ...base.fusion.source_weights, ...config.weights } },
  });
}

export async function runOne(scene: Scene, profile: Profile): Promise<PrivacyScore> {
  const result = await sanitize({
    raw: scene.raw,
    frame: null,
    task: 'ablation',
    step: 0,
    session: { session_id: `abl_${scene.seed}`, policy_profile: profile.policy.name },
    perceptionSources: [nerSource(scene), ocrSource(scene), visionSource(scene)],
    profile,
  });

  return scorePrivacy({
    groundTruth: scene.groundTruth,
    redactedRects: result.redactions.map(r => r.rect as Rect4),
    payload: result.observation,
  });
}

export interface AblationRow {
  id: string;
  label: string;
  piiRecall: number;
  piiRecallStddev: number;
  leaked: number;
  missedTypes: string[];
  recallByChannel: Record<string, number>;
}

export async function runAblation(seeds: number[], base: Profile = PROFILES.BALANCED): Promise<AblationRow[]> {
  const scenes = seeds.map(buildScene);
  const rows: AblationRow[] = [];

  for (const config of CONFIGS) {
    const profile = profileFor(base, config);
    const scores = await Promise.all(scenes.map(scene => runOne(scene, profile)));

    const missed = new Set<string>();
    scores.forEach((score, i) => {
      const byId = new Map(scenes[i]!.groundTruth.map(g => [g.value_id, g.type]));
      for (const id of score.missedValueIds) missed.add(byId.get(id) ?? id);
    });

    const channels = [...new Set(scores.flatMap(s => Object.keys(s.recallByChannel)))];
    const recallByChannel = Object.fromEntries(
      channels.map(c => [c, mean(scores.map(s => s.recallByChannel[c] ?? 0))])
    );

    rows.push({
      id: config.id,
      label: config.label,
      piiRecall: mean(scores.map(s => s.piiRecall)),
      piiRecallStddev: stddev(scores.map(s => s.piiRecall)),
      leaked: scores.reduce((a, s) => a + s.leaked, 0),
      missedTypes: [...missed].sort(),
      recallByChannel,
    });
  }

  return rows;
}

const CHANNELS = ['dom_structured', 'dom_free_text', 'canvas_readable', 'canvas_opaque'] as const;

export function formatTable(rows: AblationRow[]): string {
  const lines = [
    `| config | source(s) | PII recall | σ | ${CHANNELS.join(' | ')} | leaked |`,
    `| --- | --- | --- | --- |${' --- |'.repeat(CHANNELS.length + 1)}`,
  ];
  for (const r of rows) {
    const channels = CHANNELS.map(c => (r.recallByChannel[c] ?? 0).toFixed(2)).join(' | ');
    lines.push(
      `| ${r.id} | ${r.label} | **${r.piiRecall.toFixed(3)}** | ${r.piiRecallStddev.toFixed(3)} | ${channels} | ${r.leaked} |`
    );
  }
  return lines.join('\n');
}
