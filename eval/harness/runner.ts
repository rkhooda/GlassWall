// Runs task definitions through the real extension and collects everything the
// metrics need: audit entries per step, gateway traffic, ground truth sampled from
// the page, and predicate results.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { launch, openPage, drive, type Harness, type DriveResult, type WireRequest, type AuditEntry } from './driver';
import { checkPredicate, personaFields, type Predicate, type PredicateResult } from './predicates';

export interface TaskDefinition {
  id: string;
  site: string;
  entry: string;
  instruction: string;
  max_steps: number;
  policies?: ('STRICT' | 'BALANCED')[];
  success: Predicate[];
}

export interface GroundTruthSnapshot {
  step: number;
  /** Visible interactive controls on the page, by tag and viewport rect. */
  controls: { tag: string; rect: [number, number, number, number] }[];
  /** PII values on screen with their type and rect. */
  pii: { type: string; value: string; rect: [number, number, number, number]; decoy: boolean }[];
  /** Pixel regions inside canvases/images that hold PII, in viewport px. */
  regions: { type: string; rect: [number, number, number, number] }[];
  /** Inputs that will hold PII (autocomplete / password): redacting them is anticipatory shielding, not a false positive. */
  fields: { rect: [number, number, number, number] }[];
}

export interface RunRecord {
  taskId: string;
  seed: number;
  policy: 'STRICT' | 'BALANCED';
  success: boolean;
  predicates: PredicateResult[];
  result: DriveResult;
  wire: WireRequest[];
  truth: GroundTruthSnapshot[];
  persona: Record<string, string>;
  errors: string[];
}

export interface SuiteOptions {
  extensionPath: string;
  baseUrl: string;
  tasks: TaskDefinition[];
  seeds: number[];
  policies: ('STRICT' | 'BALANCED')[];
  headless?: boolean;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export function loadTasks(dir: string, only?: string[]): TaskDefinition[] {
  return fs
    .readdirSync(dir)
    .filter(f => /\.ya?ml$/.test(f))
    .map(f => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as TaskDefinition)
    .filter(t => !only || only.includes(t.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ground truth is read from the bench-site instrumentation; the extension never sees
 * these attributes. Plain JS in a string: tsx would otherwise inject a `__name`
 * helper into the serialized callback that does not exist in the page.
 */
const SNAPSHOT_JS = `(step) => {
  const rectOf = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const visible = Array.from(document.querySelectorAll('input:not([type=hidden]), button, a[href], select, textarea, [data-glasswall-pii], [data-glasswall-regions]')).filter(el => {
    const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none';
  });
  const controls = visible.filter(el => /^(input|button|a|select|textarea)$/i.test(el.tagName)).map(el => ({ tag: el.tagName.toLowerCase(), rect: rectOf(el) }));
  const pii = visible.filter(el => el.hasAttribute('data-glasswall-pii') && el.getAttribute('data-glasswall-pii') !== 'NONE' && (el.textContent || '').trim().length > 0)
    .map(el => ({ type: el.getAttribute('data-glasswall-pii'), value: (el.textContent || '').trim(), rect: rectOf(el), decoy: el.getAttribute('data-glasswall-decoy') === 'true' }));
  const regions = [];
  for (const el of visible.filter(el => el.hasAttribute('data-glasswall-regions'))) {
    const base = el.getBoundingClientRect();
    try { for (const reg of JSON.parse(el.getAttribute('data-glasswall-regions'))) regions.push({ type: reg.pii, rect: [Math.round(base.left + reg.x), Math.round(base.top + reg.y), Math.round(reg.w), Math.round(reg.h)] }); } catch (e) {}
  }
  const fields = visible.filter(el => /^(input|textarea)$/i.test(el.tagName) && (el.getAttribute('autocomplete') || el.getAttribute('type') === 'password' || /email|tel/.test(el.getAttribute('type') || ''))).map(el => ({ rect: rectOf(el) }));
  return { step, controls, pii, regions, fields };
}`;

export async function snapshotTruth(h: Harness, step: number): Promise<GroundTruthSnapshot> {
  return h.page.evaluate(`(${SNAPSHOT_JS})(${step})`);
}

export async function runTask(task: TaskDefinition, seed: number, policy: 'STRICT' | 'BALANCED', opts: SuiteOptions): Promise<RunRecord> {
  const h = await launch({ extensionPath: opts.extensionPath, headless: opts.headless });
  const truth: GroundTruthSnapshot[] = [];
  try {
    await openPage(h, `${opts.baseUrl}${task.entry}${task.entry.includes('?') ? '&' : '?'}seed=${seed}`);
    truth.push(await snapshotTruth(h, 0));
    const result = await drive(h, {
      task: task.instruction,
      policy,
      timeoutMs: opts.timeoutMs ?? Math.max(60_000, task.max_steps * 12_000),
      onStep: async entry => {
        try {
          truth.push(await snapshotTruth(h, entry.step + 1));
        } catch {
          /* page navigating */
        }
      },
    });
    const predicates: PredicateResult[] = [];
    for (const p of task.success) predicates.push(await checkPredicate(p, h.page, result, seed));
    return { taskId: task.id, seed, policy, success: predicates.every(p => p.passed), predicates, result, wire: [...h.wire], truth, persona: personaFields(seed), errors: [...h.errors] };
  } finally {
    await h.close();
  }
}

export async function runSuite(opts: SuiteOptions): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for (const task of opts.tasks) {
    for (const policy of (task.policies ?? opts.policies)) {
      if (!opts.policies.includes(policy)) continue;
      for (const seed of opts.seeds) {
        opts.log?.(`▶ ${task.id} · ${policy} · seed ${seed}`);
        const rec = await runTask(task, seed, policy, opts);
        out.push(rec);
        opts.log?.(`  ${rec.success ? 'PASS' : 'FAIL'} · ${rec.result.audit.length} steps · ${(rec.result.totalMs / 1000).toFixed(1)}s · ${rec.result.state.status}${rec.result.state.outcome ? '/' + rec.result.state.outcome : ''}${rec.result.state.message ? ` · ${rec.result.state.message}` : ''}${rec.errors.length ? ` · ${rec.errors.length} console errors` : ''}`);
        for (const p of rec.predicates) if (!p.passed) opts.log?.(`    ✗ ${p.kind}: ${p.message}`);
        if (!rec.success) for (const a of rec.result.audit) opts.log?.(`      step ${a.step}: ${a.action} · ${a.validation} · ${a.latency_ms}ms${a.degraded.length ? ` · ${a.degraded.join(',')}` : ''}`);
      }
    }
  }
  return out;
}

export type { AuditEntry };
