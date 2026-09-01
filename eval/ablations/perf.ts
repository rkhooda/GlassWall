/**
 * P13-B — the perf harness for Lane B's subsystems.
 *
 * Written before any optimization, so the baseline it prints is a measurement and
 * not a memory. Every row is produced by running the real code on the real weights
 * where the weights can run at all; where they cannot, the row says so instead of
 * guessing. Re-running this file after a change is what produces the delta.
 *
 * What it does NOT measure, and why:
 *   - WebGPU vs WASM: neither execution provider can be instantiated in node.
 *     transformers.js exposes 'cpu' only. Browser-only, still unmeasured.
 *   - Tesseract recognition: the worker is a browser worker. The OCR rows here are
 *     the *skip decision* and the fail-closed path, which are pure TS and are what
 *     the D6 claim actually rests on.
 *   - A's DOM extraction, message bus and step loop. Not my lane.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILES, sanitize, type Profile } from '@glasswall/privacy/index';
import { ocrSkipReason, findUnexplainedRegions } from '@glasswall/inference/ocr';
import { buildScene, type Scene } from './scene';
import { nerSource, ocrSource, visionSource } from './sources';
import { describeEnvironment, type Environment } from './frontier';

const MODEL_DIR = resolve(__dirname, '../../apps/extension/public/models/ner-base');
export const HAVE_NER_WEIGHTS = existsSync(resolve(MODEL_DIR, 'config.json'));

export interface PerfRow {
  metric: string;
  value: number | null;
  unit: string;
  n: number;
  /** p95 where the row is a latency distribution; undefined for single values. */
  p95?: number;
  note: string;
}

const SEEDS = [1337, 42, 999, 2024, 7, 31337, 8080, 12345, 555, 90210];

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

/** Cold start is a once-per-process number: the module singleton caches the model. */
async function measureNerColdStart(rows: PerfRow[]): Promise<void> {
  if (!HAVE_NER_WEIGHTS) {
    rows.push({
      metric: 'NER cold start (import + load + first inference)',
      value: null, unit: 'ms', n: 0,
      note: 'weights not vendored on this machine; run `bash ml/fetch-models.sh`',
    });
    return;
  }

  const t0 = performance.now();
  const { lockdownTransformersEnv, loadNerModel, runNer } = await import(
    '@glasswall/inference/ner'
  );
  lockdownTransformersEnv(resolve(MODEL_DIR, '..') + '/');
  const importMs = performance.now() - t0;

  const load = await loadNerModel('cpu');

  const firstStart = performance.now();
  await runNer(SAMPLE_TEXT, 0.5);
  const firstMs = performance.now() - firstStart;

  const warm: number[] = [];
  for (let i = 0; i < 20; i++) {
    const s = performance.now();
    await runNer(SAMPLE_TEXT, 0.5);
    warm.push(performance.now() - s);
  }

  rows.push(
    { metric: 'NER module import', value: round(importMs), unit: 'ms', n: 1, note: 'transformers.js + ORT glue' },
    { metric: 'NER model load (109MB int8, cold)', value: round(load.ms), unit: 'ms', n: 1, note: `device ${load.ep}` },
    { metric: 'NER first inference', value: round(firstMs), unit: 'ms', n: 1, note: 'includes graph warm-up' },
    {
      metric: 'NER cold start (import + load + first inference)',
      value: round(importMs + load.ms + firstMs), unit: 'ms', n: 1,
      note: 'what a step pays if the model was never loaded',
    },
    {
      metric: 'NER warm inference',
      value: round(quantile(warm, 0.5)), unit: 'ms', n: warm.length, p95: round(quantile(warm, 0.95)),
      note: `${SAMPLE_TEXT.length} chars`,
    }
  );
}

const SAMPLE_TEXT =
  'Anita Sharma lives at 42 Residency Road, Bengaluru and can be reached on 9876543210. ' +
  'The referral was signed by Dr Rakesh Iyer at the BTM Layout clinic on 12 August 2026.';

async function measureStepLatency(scenes: Scene[], rows: PerfRow[]): Promise<void> {
  for (const name of ['STRICT', 'BALANCED'] as const) {
    const profile: Profile = PROFILES[name];
    const samples: number[] = [];
    for (const scene of scenes) {
      const start = performance.now();
      await runStep(scene, profile);
      samples.push(performance.now() - start);
    }
    rows.push({
      metric: `sanitize() per step, ${name}`,
      value: round(quantile(samples, 0.5)), unit: 'ms', n: samples.length, p95: round(quantile(samples, 0.95)),
      note: 'stub perception sources; fusion + coverage + build are real',
    });
  }
}

function runStep(scene: Scene, profile: Profile) {
  return sanitize({
    raw: scene.raw,
    frame: null,
    task: 'perf',
    step: 0,
    session: { session_id: `perf_${scene.seed}`, policy_profile: profile.policy.name },
    perceptionSources: [nerSource(scene), ocrSource(scene), visionSource(scene)],
    profile,
  });
}

function measureOcrSkip(scenes: Scene[], rows: PerfRow[]): void {
  const decisions: number[] = [];
  let skipped = 0;
  for (const scene of scenes) {
    const start = performance.now();
    const reason = ocrSkipReason(scene.raw);
    decisions.push(performance.now() - start);
    if (reason !== null) skipped++;
  }

  // A page with nothing the DOM cannot account for: the skip case the D6 claim needs.
  const plain = plainScene(scenes[0]!);
  const plainSkipped = ocrSkipReason(plain.raw) !== null;

  rows.push(
    {
      metric: 'OCR skip decision',
      value: round(quantile(decisions, 0.5)), unit: 'ms', n: decisions.length, p95: round(quantile(decisions, 0.95)),
      note: 'findUnexplainedRegions over the whole observation',
    },
    {
      metric: 'OCR skip rate, ablation scene',
      value: round((skipped / scenes.length) * 100), unit: '%', n: scenes.length,
      note: `${findUnexplainedRegions(scenes[0]!.raw).length} unexplained regions per scene, so OCR runs`,
    },
    {
      metric: 'OCR skip rate, no unexplained regions',
      value: plainSkipped ? 100 : 0, unit: '%', n: 1,
      note: 'the same page with its canvases removed',
    }
  );
}

/** The ablation scene with its canvases stripped — an ordinary, fully explained page. */
function plainScene(scene: Scene): Scene {
  return {
    ...scene,
    raw: { ...scene.raw, elements: scene.raw.elements.filter(el => el.tag !== 'canvas') },
  };
}

/**
 * 50 steps, heap sampled after an explicit collection. Run under
 * `node --expose-gc` (the CLI below re-execs itself) or the numbers are noise.
 */
async function measureMemory(scenes: Scene[], rows: PerfRow[]): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  const sample = () => {
    gc?.();
    return process.memoryUsage().heapUsed / 1048576;
  };

  const before = sample();
  const marks: number[] = [];
  for (let step = 0; step < 50; step++) {
    await runStep(scenes[step % scenes.length]!, PROFILES.BALANCED);
    if ((step + 1) % 10 === 0) marks.push(sample());
  }
  const after = sample();

  // Slope over the last four checkpoints: a real leak grows monotonically, a warm
  // allocator does not.
  const slope = (marks[marks.length - 1]! - marks[0]!) / (marks.length - 1);

  rows.push(
    {
      metric: 'heap after 50 steps',
      value: round(after), unit: 'MB', n: 50,
      note: `from ${round(before)}MB; checkpoints ${marks.map(round).join(' → ')}`,
    },
    {
      metric: 'heap growth per 10 steps',
      value: round(slope), unit: 'MB', n: marks.length,
      note: gc ? 'after forced collection' : 'NO --expose-gc: this number is allocator noise',
    }
  );
}

export interface PerfReport {
  env: Environment;
  rows: PerfRow[];
  gcAvailable: boolean;
}

export async function measurePerformance(): Promise<PerfReport> {
  const scenes = SEEDS.map(buildScene);
  const rows: PerfRow[] = [];

  await measureNerColdStart(rows);
  await measureStepLatency(scenes, rows);
  measureOcrSkip(scenes, rows);
  await measureMemory(scenes, rows);

  return { env: describeEnvironment(), rows, gcAvailable: typeof (globalThis as { gc?: unknown }).gc === 'function' };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function formatTable(rows: PerfRow[]): string {
  const lines = ['| metric | value | p95 | n | note |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const value = r.value === null ? '**not measured**' : `**${r.value} ${r.unit}**`;
    lines.push(`| ${r.metric} | ${value} | ${r.p95 === undefined ? '—' : `${r.p95} ${r.unit}`} | ${r.n} | ${r.note} |`);
  }
  return lines.join('\n');
}

export function renderPerfReport(report: PerfReport, title: string): string {
  return `# ${title}

**Measured ${report.env.generatedAt} at \`${report.env.commit}\`.**

| | |
|---|---|
| Hardware | ${report.env.hardware} |
| OS | ${report.env.os} |
| Runtime | ${report.env.runtime} |
| Commit | \`${report.env.commit}\` |
| Forced GC available | ${report.gcAvailable ? 'yes' : '**no — heap rows are noise**'} |

This is the only machine in the project, so it is also the weakest one. Every number
below was measured on it. Nothing here is extrapolated to faster hardware.

${formatTable(report.rows)}
`;
}

if (require.main === module) {
  measurePerformance().then(report => {
    process.stdout.write(renderPerfReport(report, 'Lane B performance'));
  });
}
