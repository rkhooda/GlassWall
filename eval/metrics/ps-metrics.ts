// The five benchmark dimensions computed from real browser runs:
//   1. accuracy of visual context from the screen        (25%)
//   2. recall and precision for detection of sensitive data (20%)
//   3. precision of redaction                             (20%)
//   4. client-side resource utilization                   (20%)
//   5. end-to-end latency of the task                     (15%)
// Every number here is derived from the harness's ground truth (bench-site
// instrumentation the extension never sees) and the extension's own audit log.
import type { RunRecord, GroundTruthSnapshot } from '../harness/runner';
import { normalize, generateEncodings } from '@glasswall/privacy';

type Rect = [number, number, number, number];

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}
const contains = (outer: Rect, inner: Rect) => overlap(outer, inner) > 0 && inner[0] >= outer[0] - 4 && inner[1] >= outer[1] - 4 && inner[0] + inner[2] <= outer[0] + outer[2] + 4 && inner[1] + inner[3] <= outer[1] + outer[3] + 4;

export interface RunMetrics {
  taskId: string;
  seed: number;
  policy: string;
  success: boolean;
  steps: number;
  /** 1 — visual context: interactive controls the payload described vs those actually on screen. */
  visual: { recall: number; precision: number; matched: number; truth: number; observed: number };
  /** 2 — PII detection over the values shown on screen (canaries) and the decoys. */
  detection: { recall: number; precision: number; tp: number; fn: number; fp: number; leakedValues: string[] };
  /** 3 — redaction precision: redacted regions that covered ground-truth PII or an opaque region. */
  redaction: { precision: number; total: number; justified: number };
  /** 4 — client-side resource use per step. */
  resources: { localMsPerStep: number; payloadBytesP50: number; screenshotBytesP50: number; steps: number };
  /** 5 — latency. */
  latency: { totalMs: number; stepP50: number; stepP95: number; reasonerMsPerStep: number };
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
}

function truthAt(truth: GroundTruthSnapshot[], step: number): GroundTruthSnapshot | undefined {
  return truth.find(t => t.step === step) ?? truth[truth.length - 1];
}

export function scoreRun(rec: RunRecord): RunMetrics {
  const audit = rec.result.audit;
  const steps = audit.length;

  // 1. Visual context: per step, match observed interactive elements to truth controls by tag + IoU.
  let matched = 0, truthTotal = 0, observedTotal = 0;
  for (const a of audit) {
    const t = truthAt(rec.truth, a.step);
    if (!t) continue;
    const observed = a.observed.filter(o => o.visible && ['input', 'button', 'a', 'select', 'textarea'].includes(o.tag));
    truthTotal += t.controls.length;
    observedTotal += observed.length;
    const used = new Set<number>();
    for (const c of t.controls) {
      const i = observed.findIndex((o, idx) => !used.has(idx) && o.tag === c.tag && overlap(o.rect, c.rect) >= 0.5);
      if (i >= 0) { used.add(i); matched++; }
    }
  }
  const visual = { recall: truthTotal ? matched / truthTotal : 1, precision: observedTotal ? matched / observedTotal : 1, matched, truth: truthTotal, observed: observedTotal };

  // 2. Detection: a value shown on screen counts as detected if it never appears on the wire in any encoding.
  const wireText = normalize(rec.wire.map(w => w.url + ' ' + w.body).join('\n'));
  const wireRaw = rec.wire.map(w => w.body).join('\n');
  const onWire = (value: string) => {
    const n = normalize(value);
    if (n.length < 4) return false;
    if (wireText.includes(n) || wireRaw.includes(value)) return true;
    return generateEncodings(n).some(f => f.length >= 8 && wireText.includes(f));
  };
  const seenValues = new Map<string, { decoy: boolean }>();
  for (const t of rec.truth) for (const p of t.pii) seenValues.set(p.value, { decoy: p.decoy });
  let tp = 0, fn = 0, fp = 0;
  const leakedValues: string[] = [];
  for (const [value, { decoy }] of seenValues) {
    const leaked = onWire(value);
    if (decoy) { if (!leaked) fp++; continue; } // a decoy that vanished from the wire was over-redacted
    if (leaked) { fn++; leakedValues.push(value); } else tp++;
  }
  const detection = { recall: tp + fn ? tp / (tp + fn) : 1, precision: tp + fp ? tp / (tp + fp) : 1, tp, fn, fp, leakedValues };

  // 3. Redaction precision: a redacted rect is justified if it covers a PII value, a PII pixel region, or an opaque element region.
  let total = 0, justified = 0;
  for (const a of audit) {
    const t = truthAt(rec.truth, a.step);
    if (!t) continue;
    for (const r of a.redactions) {
      total++;
      const coversPii = t.pii.some(p => overlap(r.rect, p.rect) >= 0.3 || contains(r.rect, p.rect));
      const coversRegion = t.regions.some(g => overlap(r.rect, g.rect) >= 0.3 || contains(r.rect, g.rect));
      const coversField = t.fields.some(f => overlap(r.rect, f.rect) >= 0.3 || contains(r.rect, f.rect) || contains(f.rect, r.rect));
      const opaque = /canvas|img|iframe|svg|video|unexplained|no DOM owner/i.test(r.reason);
      if (coversPii || coversRegion || coversField || opaque) justified++;
    }
  }
  const redaction = { precision: total ? justified / total : 1, total, justified };

  // 4. Resources
  const localMs = audit.map(a => (a.timings.observe ?? 0) + (a.timings.capture ?? 0) + (a.timings.perceive ?? 0) + (a.timings.sanitize ?? 0) + (a.timings.redact ?? 0) + (a.timings.gate ?? 0) + (a.timings.validate ?? 0) + (a.timings.execute ?? 0));
  const payloadBytes = audit.map(a => a.payload_bytes).filter(b => b > 0);
  const shots = rec.wire.map(w => { const m = /"data_base64":"([^"]+)"/.exec(w.body); return m ? m[1]!.length : 0; }).filter(n => n > 0);
  const resources = { localMsPerStep: steps ? Math.round(localMs.reduce((s, x) => s + x, 0) / steps) : 0, payloadBytesP50: percentile(payloadBytes, 0.5), screenshotBytesP50: percentile(shots, 0.5), steps };

  // 5. Latency
  const stepMs = audit.map(a => a.latency_ms);
  const reasoner = audit.map(a => a.timings.reason ?? 0);
  const latency = { totalMs: rec.result.totalMs, stepP50: percentile(stepMs, 0.5), stepP95: percentile(stepMs, 0.95), reasonerMsPerStep: steps ? Math.round(reasoner.reduce((s, x) => s + x, 0) / steps) : 0 };

  return { taskId: rec.taskId, seed: rec.seed, policy: rec.policy, success: rec.success, steps, visual, detection, redaction, resources, latency };
}

export interface SuiteMetrics {
  runs: RunMetrics[];
  completion: number;
  visualRecall: number;
  visualPrecision: number;
  detectionRecall: number;
  detectionPrecision: number;
  redactionPrecision: number;
  localMsPerStep: number;
  payloadBytesP50: number;
  stepP50: number;
  stepP95: number;
  leaks: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function scoreSuite(records: RunRecord[]): SuiteMetrics {
  const runs = records.map(scoreRun);
  return {
    runs,
    completion: mean(runs.map(r => (r.success ? 1 : 0))),
    visualRecall: mean(runs.map(r => r.visual.recall)),
    visualPrecision: mean(runs.map(r => r.visual.precision)),
    detectionRecall: mean(runs.map(r => r.detection.recall)),
    detectionPrecision: mean(runs.map(r => r.detection.precision)),
    redactionPrecision: mean(runs.map(r => r.redaction.precision)),
    localMsPerStep: Math.round(mean(runs.map(r => r.resources.localMsPerStep))),
    payloadBytesP50: Math.round(mean(runs.map(r => r.resources.payloadBytesP50))),
    stepP50: Math.round(mean(runs.map(r => r.latency.stepP50))),
    stepP95: Math.round(mean(runs.map(r => r.latency.stepP95))),
    leaks: runs.reduce((s, r) => s + r.detection.leakedValues.length, 0),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatSummary(m: SuiteMetrics, env: Record<string, string>): string {
  const lines: string[] = [];
  lines.push('# GLASSWALL evaluation summary');
  lines.push('');
  lines.push('Measured against the real extension in Chromium, on the instrumented bench sites. The extension never reads the instrumentation; the harness does.');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(env)) lines.push(`| ${k} | ${v} |`);
  lines.push('');
  lines.push('## The five PS metrics');
  lines.push('');
  lines.push('| # | Metric (weight) | Result |');
  lines.push('|---|---|---|');
  lines.push(`| 1 | Visual context accuracy (25%) — interactive controls described vs on screen | recall **${pct(m.visualRecall)}**, precision **${pct(m.visualPrecision)}** |`);
  lines.push(`| 2 | PII detection (20%) — values on screen kept off the wire; decoys left alone | recall **${pct(m.detectionRecall)}**, precision **${pct(m.detectionPrecision)}**, leaks **${m.leaks}** |`);
  lines.push(`| 3 | Redaction precision (20%) — redacted regions that covered PII or opaque pixels | **${pct(m.redactionPrecision)}** |`);
  lines.push(`| 4 | Client resource use (20%) — local compute per step, payload size | **${m.localMsPerStep} ms**/step local, payload p50 **${(m.payloadBytesP50 / 1024).toFixed(1)} KB** |`);
  lines.push(`| 5 | End-to-end latency (15%) — per step | p50 **${m.stepP50} ms**, p95 **${m.stepP95} ms** |`);
  lines.push(`|   | Task completion | **${pct(m.completion)}** (${m.runs.filter(r => r.success).length}/${m.runs.length} runs) |`);
  lines.push('');
  lines.push('## Per run');
  lines.push('');
  lines.push('| task | policy | seed | done | steps | total s | step p50 | visual R/P | PII R/P | redaction P | local ms/step | payload KB | leaks |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of m.runs) {
    lines.push(`| ${r.taskId} | ${r.policy} | ${r.seed} | ${r.success ? '✅' : '❌'} | ${r.steps} | ${(r.latency.totalMs / 1000).toFixed(1)} | ${r.latency.stepP50} | ${pct(r.visual.recall)} / ${pct(r.visual.precision)} | ${pct(r.detection.recall)} / ${pct(r.detection.precision)} | ${pct(r.redaction.precision)} | ${r.resources.localMsPerStep} | ${(r.resources.payloadBytesP50 / 1024).toFixed(1)} | ${r.detection.leakedValues.length} |`);
  }
  lines.push('');
  lines.push('Definitions: visual recall = truth controls matched by a described element of the same tag with IoU ≥ 0.5; PII recall = on-screen instrumented values that never appear on the wire in any of the gate\'s encodings; PII precision counts a vanished decoy as a false positive; redaction precision = redacted rects that cover instrumented PII, a declared pixel region, a sensitive input (anticipatory shielding), or an opaque element.');
  return lines.join('\n');
}
