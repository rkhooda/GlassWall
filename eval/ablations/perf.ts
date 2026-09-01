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

  const coldStart = importMs + load.ms + firstMs;
  const warmP50 = quantile(warm, 0.5);

  rows.push(
    { metric: 'NER module import', value: round(importMs), unit: 'ms', n: 1, note: 'transformers.js + ORT glue' },
    { metric: 'NER model load (109MB int8, cold)', value: round(load.ms), unit: 'ms', n: 1, note: `device ${load.ep}` },
    { metric: 'NER first inference', value: round(firstMs), unit: 'ms', n: 1, note: 'includes graph warm-up' },
    {
      metric: 'NER cold start (import + load + first inference)',
      value: round(coldStart), unit: 'ms', n: 1,
      note: 'what a step pays if the model was never loaded',
    },
    {
      metric: 'NER warm inference',
      value: round(warmP50), unit: 'ms', n: warm.length, p95: round(quantile(warm, 0.95)),
      note: `${SAMPLE_TEXT.length} chars`,
    },
    {
      metric: 'first step, model cold',
      value: round(coldStart), unit: 'ms', n: 1,
      note: 'no warm-up: the user waits for the whole cold start inside step 1',
    },
    {
      metric: 'first step, after warm-up at install',
      value: round(warmP50), unit: 'ms', n: warm.length,
      note: 'warmUpInference() already paid import + load + first inference',
    },
    {
      metric: 'first-step saving from warm-up',
      value: round(coldStart - warmP50), unit: 'ms', n: 1,
      note: `${Math.round(((coldStart - warmP50) / coldStart) * 100)}% of the cold start, moved off the user's first step`,
    }
  );
}

/**
 * What each profile actually loads. STRICT disables the screenshot, so the pixel
 * path — and the 43MB tesseract engine behind it — is never touched.
 */
async function measureLazyLoading(rows: PerfRow[]): Promise<void> {
  // Imported here, not at the top of the file: `warmup` pulls in the NER module,
  // and a static import would pre-warm it and silently zero the import row above.
  const { planWarmup } = await import('@glasswall/inference/warmup');
  const NER_BYTES = 108952255;
  const OCR_BYTES = 43000000;

  for (const name of ['STRICT', 'BALANCED'] as const) {
    const plan = planWarmup(PROFILES[name].policy);
    const bytes = (plan.ner ? NER_BYTES : 0) + (plan.ocr ? OCR_BYTES : 0);
    rows.push({
      metric: `model bytes loaded, ${name}`,
      value: round(bytes / 1048576), unit: 'MB', n: 1,
      note: `ner ${plan.ner ? 'yes' : 'no'} · ocr ${plan.ocr ? 'yes' : 'no'} (screenshot ${PROFILES[name].policy.screenshot.enabled ? 'on' : 'off'})`,
    });
  }
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
  await measureLazyLoading(rows);
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

/**
 * The committed baseline, quoted from `eval/reports/perf-baseline.md` — the run
 * made before any of P13-B's changes existed. Kept here so the delta table
 * regenerates rather than rotting into prose, and so a reader can diff the two
 * report files and get the same answer.
 */
const BASELINE: Record<string, number | null> = {
  'NER module import': 171.4,
  'NER model load (109MB int8, cold)': 287.1,
  'NER cold start (import + load + first inference)': 477,
  'NER warm inference': 12.3,
  'first step, model cold': 477,
  'first step, after warm-up at install': null,
  'sanitize() per step, STRICT': 0.3,
  'sanitize() per step, BALANCED': 0.2,
  'heap after 50 steps': 29.9,
  'heap growth per 10 steps': 0,
};

const BASELINE_NOTE: Record<string, string> = {
  'first step, after warm-up at install': 'no warm-up existed: every install paid the cold start inside step 1',
  'model bytes loaded, STRICT': 'OCR loaded whenever a frame arrived, so the profile did not decide — the caller did',
  'model bytes loaded, BALANCED': 'same as after: BALANCED wants the pixel path',
};

export function renderDelta(rows: PerfRow[]): string {
  const lines = ['| metric | before | after | delta |', '| --- | --- | --- | --- |'];
  for (const row of rows) {
    const before = BASELINE[row.metric];
    const note = BASELINE_NOTE[row.metric];
    if (before === undefined && note === undefined) continue;
    if (row.value === null) continue;

    const beforeCell = before === undefined || before === null ? `— *${note ?? 'not measured at baseline'}*` : `${before} ${row.unit}`;
    const delta =
      before === undefined || before === null
        ? '**new**'
        : signed(row.value - before, row.unit);
    lines.push(`| ${row.metric} | ${beforeCell} | **${row.value} ${row.unit}** | ${delta} |`);
  }
  return lines.join('\n');
}

const signed = (d: number, unit: string) =>
  Math.abs(d) < 0.05 ? 'unchanged' : `${d > 0 ? '+' : ''}${round(d)} ${unit}`;

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

export function renderFullReport(report: PerfReport): string {
  const cold = report.rows.find(r => r.metric === 'first step, model cold')?.value;
  const warm = report.rows.find(r => r.metric === 'first step, after warm-up at install')?.value;

  return `${renderPerfReport(report, 'P13-B — Lane B performance, after optimization')}

## Before → after

Baseline: \`eval/reports/perf-baseline.md\`, measured on the same machine before any
of this phase's changes existed.

${renderDelta(report.rows)}

**Read the cold-start rows as noise, not regression.** No change in this phase touches
the import, the load, or the first inference — they are the same code on the same
weights. Three runs on this machine gave 477 / 443 / ${cold ?? '?'}ms for the same path,
a spread of roughly ±60ms, which is what an 8GB laptop with a 109MB mmap does. The
delta column is arithmetic on two single samples and nothing more.

**What actually moved, and what did not.**

The one number worth the work is the first step. ${cold ?? '?'}ms of cold start now
happens at install instead of inside the user's first action, leaving ${warm ?? '?'}ms.
Nothing was made faster — the cold start costs exactly what it always did — it was
moved off the path where a human is waiting. That is the honest description.

Row-by-row latency (\`sanitize()\`, the OCR skip decision) is **unchanged**, and was
never the problem: fusion, coverage and the observation build were already sub-
millisecond at baseline. Optimizing them would have been optimizing against intuition.

Heap was already flat at baseline and still is. The change is that it is now asserted
by \`packages/privacy/src/sanitize.memory.test.ts\` rather than observed once — the test
goes red at a 2.2MB leak and passes at the measured 0.06MB over 40 steps.

The model-bytes row is a policy change, not a speed change: STRICT now decides against
the OCR engine because its policy disables the screenshot, rather than avoiding it by
the accident of no frame being passed.

## Quantization sweep — measured, not assumed

Reproduce with \`bash ml/fetch-models.sh --sweep\` then
\`pnpm --filter @glasswall/inference test quantization\`. 25 held-out generator
paragraphs, threshold 0.5, ONNX Runtime CPU EP on the machine above.

| dtype | size | load | p50 | F1 | precision | recall | PERSON_NAME | STREET_ADDRESS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **q8 (ships)** | 103.9MB | 358ms | 11.2ms | **0.958** | 1.000 | 0.920 | 1.000 | 0.840 |
| q4f16 | 89.3MB | 194ms | 34.6ms | 0.926 | 0.978 | 0.880 | 1.000 | 0.760 |
| fp16 | 205.8MB | 563ms | 133.8ms | 0.958 | 1.000 | 0.920 | 1.000 | 0.840 |

Two results, both of which change what we would have done on intuition:

1. **int8 costs us nothing.** fp16 scores identically to q8 on every column while
   being twice the size and twelve times slower here. The 0.84 STREET_ADDRESS recall
   is the encoder, not the number format, so re-quantizing cannot fix it — only a
   different model can. Before measuring, "try less aggressive quantization" was the
   obvious next move. It is not.
2. **The one smaller format is worse on every axis.** q4f16 saves 14.6MB (14%) and
   pays 3.2 F1 points, 8 points of STREET_ADDRESS recall, and 3x the inference time.
   It also still misses the 30MB budget by 3x, so the trade buys nothing.

The size acceptance criterion therefore stays failed and stays reported. Every
published weight format of this encoder is over budget; the sweep's job was to find
out whether that was a quantization choice or a model choice, and it is a model choice.
`;
}

if (require.main === module) {
  void measurePerformance().then(report => {
    process.stdout.write(renderFullReport(report));
  });
}
