/**
 * P13-B — session warm-up.
 *
 * The measured baseline (`eval/reports/perf-baseline.md`) says a step that finds the
 * NER model cold pays 477ms on this machine: 171ms to import transformers.js and the
 * ORT glue, 287ms to open the 109MB int8 graph, 19ms for the first inference. Every
 * one of those is paid once. Paying them at install instead of inside the user's
 * first step is the whole optimization, and it is worth more than everything else in
 * this file combined.
 *
 * Two rules it must not break:
 *
 *   1. **Warm-up may never fail a step.** Every error is swallowed and reported in
 *      the result. The perception sources already degrade fail-closed when a model
 *      is missing; warm-up failing just means they degrade on step 1 instead of not
 *      at all.
 *   2. **Policy decides what loads, not convenience.** STRICT disables the
 *      screenshot path, so there are no pixels: loading a 43MB OCR engine to read
 *      them would be 43MB of nothing. `planWarmup()` is the only place that decides.
 */
import { initOcrWorker } from './ocr';
import { loadNerModel, runNer, type NerDevice } from './ner';

/** Just enough text to force the graph to execute once. Contains no PII. */
const DUMMY_TEXT = 'The quick brown fox jumps over the lazy dog in Springfield.';

export interface WarmupPolicy {
  screenshot: { enabled: boolean };
}

export interface WarmupPlan {
  /** NER reads DOM text, which exists under every profile. */
  ner: boolean;
  /** OCR reads pixels. No screenshot, no pixels, no reason to load 43MB. */
  ocr: boolean;
}

export function planWarmup(policy: WarmupPolicy): WarmupPlan {
  return { ner: true, ocr: policy.screenshot.enabled };
}

export interface WarmupOutcome {
  ran: boolean;
  ms: number;
  /** Present when the model was skipped or failed; names which. */
  reason?: string;
}

export interface WarmupReport {
  ner: WarmupOutcome;
  ocr: WarmupOutcome;
  totalMs: number;
}

export async function warmUpInference(
  policy: WarmupPolicy,
  device: NerDevice = 'wasm'
): Promise<WarmupReport> {
  const plan = planWarmup(policy);
  const start = performance.now();

  const ner = await time(plan.ner, 'screenshot_only_profile', async () => {
    await loadNerModel(device);
    // The dummy inference is the point: loading the graph does not build the
    // execution plan, and the first run is where that cost lands.
    await runNer(DUMMY_TEXT, 0.99);
  });

  const ocr = await time(plan.ocr, 'screenshot_disabled', async () => {
    await initOcrWorker();
  });

  return { ner, ocr, totalMs: round(performance.now() - start) };
}

async function time(
  should: boolean,
  skipReason: string,
  work: () => Promise<void>
): Promise<WarmupOutcome> {
  if (!should) return { ran: false, ms: 0, reason: skipReason };

  const start = performance.now();
  try {
    await work();
    return { ran: true, ms: round(performance.now() - start) };
  } catch (error) {
    // Never rethrow. A cold model is a slow step; a thrown warm-up is a dead install.
    return { ran: false, ms: round(performance.now() - start), reason: describe(error) };
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);
