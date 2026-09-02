// pnpm bench:smoke | bench:all | bench:leakage | bench:report
//
// Prerequisites: bench sites on :5173 and the gateway on :3000 (`pnpm dev`), and an
// eval build of the extension (`pnpm --filter @glasswall/extension build:eval`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { runSuite, loadTasks, type RunRecord } from './runner';
import { scoreSuite, formatSummary } from '../metrics/ps-metrics';
import { scanRecord, formatLeakageReport } from '../leakage/run';

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith('--') && !a.includes('='))?.slice(2) ?? 'smoke';
const opt = (name: string, fallback: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? process.env[`GW_${name.toUpperCase()}`] ?? fallback;

const baseUrl = opt('base-url', 'http://localhost:5173');
const extensionPath = opt('extension', path.join(ROOT, 'apps/extension/dist-eval'));
const unsafePath = opt('unsafe-extension', path.join(ROOT, 'apps/extension/dist-unsafe'));
const reportsDir = opt('reports', path.join(ROOT, 'eval/reports'));
const headless = opt('headed', '0') !== '1';
const seeds = opt('seeds', mode === 'all' ? '1337,42,7' : '1337').split(',').map(Number);
const policies = opt('policies', mode === 'all' ? 'STRICT,BALANCED' : 'STRICT').split(',') as Array<'STRICT' | 'BALANCED'>;
const only = opt('tasks', mode === 'smoke' ? 'T1,T3' : '').split(',').filter(Boolean);

function env(): Record<string, string> {
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }
  return {
    Hardware: `${os.cpus()[0]?.model ?? 'unknown'} · ${os.cpus().length} cores · ${Math.round(os.totalmem() / 1073741824)} GB`,
    OS: `${os.type()} ${os.release()} (${os.arch()})`,
    Node: process.version,
    Commit: commit,
    Measured: new Date().toISOString(),
    Seeds: seeds.join(', '),
    Policies: policies.join(', '),
  };
}

async function main() {
  fs.mkdirSync(reportsDir, { recursive: true });
  const log = (l: string) => console.log(l);
  const tasks = loadTasks(path.join(ROOT, 'eval/tasks'), only.length ? only : undefined);
  if (tasks.length === 0) throw new Error('no tasks selected');

  if (mode === 'smoke' || mode === 'all' || mode === 'report') {
    const records = await runSuite({ extensionPath, baseUrl, tasks, seeds, policies, headless, log });
    const metrics = scoreSuite(records);
    const summary = formatSummary(metrics, env());
    fs.writeFileSync(path.join(reportsDir, 'summary.md'), summary + '\n');
    fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify({ env: env(), metrics: { ...metrics, runs: metrics.runs } }, null, 2));
    console.log('\n' + summary);
    for (const r of metrics.runs) if (r.detection.leakedValues.length) console.log(`leaked in ${r.taskId}/${r.policy}/${r.seed}: ${r.detection.leakedValues.join(' | ')}`);
    const failed = records.filter(r => !r.success);
    const errors = records.flatMap(r => r.errors);
    if (errors.length) console.log(`\nconsole errors:\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
    if (mode === 'smoke' && (failed.length || metrics.leaks)) process.exit(1);
    return;
  }

  if (mode === 'leakage') {
    const safe = await runSuite({ extensionPath, baseUrl, tasks, seeds, policies, headless, log });
    const safeFindings = safe.flatMap(scanRecord);
    console.log('\n' + formatLeakageReport(safe, safeFindings, 'safe build'));

    let control = '';
    if (fs.existsSync(path.join(unsafePath, 'manifest.json'))) {
      log('\n▶ negative control: UNSAFE build (sanitizer and gate compiled out) — this MUST leak');
      const unsafe = await runSuite({ extensionPath: unsafePath, baseUrl, tasks: tasks.slice(0, 1), seeds: seeds.slice(0, 1), policies: ['STRICT'], headless, log });
      const unsafeFindings = unsafe.flatMap(scanRecord);
      control = formatLeakageReport(unsafe, unsafeFindings, 'UNSAFE negative control (must leak)');
      console.log('\n' + control);
      if (unsafeFindings.length === 0) {
        console.log('\n❌ negative control did not leak: the harness cannot be trusted');
        process.exit(1);
      }
    } else {
      control = '_Negative control skipped: build it with `pnpm --filter @glasswall/extension build:unsafe`._';
      console.log('\n' + control);
    }
    const md = ['# Leakage report', '', ...Object.entries(env()).map(([k, v]) => `- ${k}: ${v}`), '', formatLeakageReport(safe, safeFindings, 'safe build'), '', control, ''].join('\n');
    fs.writeFileSync(path.join(reportsDir, 'leakage.md'), md);
    if (safeFindings.length) process.exit(1);
    return;
  }

  console.log('usage: tsx harness/cli.ts --smoke | --all | --leakage | --report [--tasks=T1,T3] [--seeds=1337,42] [--policies=STRICT,BALANCED] [--headed=1]');
  process.exit(2);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

export type { RunRecord };
