// The canary harness. Seeds a persona onto the bench sites, runs the real extension
// against them, captures every byte sent to the gateway and looks for every persona
// value in raw, normalized and encoded forms (plus 8-gram fragments). The same run
// against the UNSAFE negative-control build must report leaks — a test that cannot
// fail proves nothing.
import { normalize, generateEncodings, generateNgrams } from '@glasswall/privacy';
import { generatePersona } from '../../apps/bench-site/src/data/generator';
import type { RunRecord } from '../harness/runner';

export interface LeakFinding {
  taskId: string;
  seed: number;
  policy: string;
  type: string;
  encoding: string;
  url: string;
}

export function canariesFor(seed: number): { type: string; value: string }[] {
  return generatePersona(seed).values.filter(v => normalize(v.value).length >= 6).map(v => ({ type: v.type, value: v.value }));
}

export function scanRecord(rec: RunRecord): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const canaries = canariesFor(rec.seed);
  for (const w of rec.wire) {
    const text = normalize(`${w.url} ${w.body}`);
    const grams = new Set(generateNgrams(text, 8));
    for (const c of canaries) {
      const n = normalize(c.value);
      const forms: [string, string][] = [['raw', n], ...generateEncodings(n).map((f, i) => [`enc${i}`, f] as [string, string])];
      const hit = forms.find(([, f]) => f.length >= 6 && text.includes(f));
      if (hit) {
        findings.push({ taskId: rec.taskId, seed: rec.seed, policy: rec.policy, type: c.type, encoding: hit[0], url: w.url });
        continue;
      }
      if (n.length >= 10 && generateNgrams(n, 8).filter(g => grams.has(g)).length >= 3) {
        findings.push({ taskId: rec.taskId, seed: rec.seed, policy: rec.policy, type: c.type, encoding: '8-gram', url: w.url });
      }
    }
  }
  return findings;
}

export function formatLeakageReport(records: RunRecord[], findings: LeakFinding[], label: string): string {
  const lines = [`# Leakage — ${label}`, '', `Runs: ${records.length} · requests scanned: ${records.reduce((s, r) => s + r.wire.length, 0)} · canary values per seed: ${canariesFor(records[0]?.seed ?? 1337).length}`, ''];
  lines.push('| task | policy | seed | requests | leaks | types |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) {
    const f = findings.filter(x => x.taskId === r.taskId && x.seed === r.seed && x.policy === r.policy);
    lines.push(`| ${r.taskId} | ${r.policy} | ${r.seed} | ${r.wire.length} | ${f.length} | ${[...new Set(f.map(x => `${x.type}(${x.encoding})`))].join(', ') || '—'} |`);
  }
  lines.push('');
  lines.push(findings.length === 0 ? '**0 leaks.**' : `**${findings.length} leak finding(s).**`);
  return lines.join('\n');
}
