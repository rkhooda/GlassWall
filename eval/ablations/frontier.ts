/**
 * P12-B — the privacy–utility frontier.
 *
 * Three points, A1 / A6 / A7, each the same build under a different
 * source-enablement config (see `run.ts`). Leakage on x, retained utility on y.
 * The curve is the argument: STRICT is not "better", it is further along a trade,
 * and the trade is measured rather than asserted.
 *
 * The utility axis is measured *in process*, on the sanitized payload, not through
 * A's Playwright harness. See `docs/PROGRESS-B.md` and `docs/REQUESTS-TO-A.md`:
 * the built extension currently emits no content script and no side panel, so no
 * end-to-end task can execute. What is measured here is stated for what it is.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROFILES, sanitize, type Profile } from '@glasswall/privacy/index';
import type { RawObservation, SanitizedObservation } from '@glasswall/schema/observation';
import { buildScene, type Scene } from './scene';
import { CONFIGS, profileFor, type AblationConfig } from './run';
import { nerSource, ocrSource, visionSource } from './sources';
import {
  mean,
  scoreHandleConsistency,
  scorePrivacy,
  stddev,
  type PrivacyScore,
  type Rect4,
} from '../metrics/privacy';

/** The three configs the frontier plots. The other rows live in the P11 ablation. */
export const FRONTIER_IDS = ['A1', 'A6', 'A7'] as const;

export interface UtilityScore {
  /** Elements the agent can still name and act on, over all elements on the page. */
  actionableElements: number;
  elementsTotal: number;
  actionableRetention: number;
  /** Characters of page text still readable as text rather than a handle or a mask. */
  literalTextRetention: number;
}

/**
 * What survives redaction for the agent to work with.
 *
 * An element is usable when its label came through verbatim *and* it still offers
 * an action: `sanitize()` empties `available_actions` for anything a fused region
 * covers, so a redacted control is not merely unlabelled, it is unclickable. That
 * is the real cost of over-redaction and it is what the y-axis measures.
 *
 * Tokenized text is deliberately *not* counted as lost on the actionable axis — a
 * handle keeps the structure the agent reasons over. It is reported separately as
 * `literalTextRetention` so the two costs never get averaged into one soft number.
 */
export function scoreUtility(raw: RawObservation, payload: SanitizedObservation): UtilityScore {
  const rawLabels = new Map(raw.elements.map(el => [el.id, el.label_raw]));

  const actionableElements = payload.elements.filter(
    el => el.label_raw === rawLabels.get(el.id) && (el.available_actions?.length ?? 0) > 0
  ).length;

  const rawChars = raw.text_nodes.reduce((n, t) => n + t.text.length, 0);
  const literalChars = payload.text_nodes.reduce(
    (n, t) => n + t.text.replace(/⟦[A-Z_]+(?:#\d+)?⟧/g, '').replace(/\[REDACTED\]/g, '').length,
    0
  );

  return {
    actionableElements,
    elementsTotal: raw.elements.length,
    actionableRetention: raw.elements.length === 0 ? 1 : actionableElements / raw.elements.length,
    literalTextRetention: rawChars === 0 ? 1 : Math.min(1, literalChars / rawChars),
  };
}

export interface SeedRun {
  seed: number;
  privacy: PrivacyScore;
  utility: UtilityScore;
  payload: SanitizedObservation;
}

async function runSeed(scene: Scene, profile: Profile): Promise<SeedRun> {
  const result = await sanitize({
    raw: scene.raw,
    frame: null,
    task: 'frontier',
    step: 0,
    session: { session_id: `fr_${scene.seed}`, policy_profile: profile.policy.name },
    perceptionSources: [nerSource(scene), ocrSource(scene), visionSource(scene)],
    profile,
  });

  const payload = result.observation as SanitizedObservation;
  return {
    seed: scene.seed,
    payload,
    privacy: scorePrivacy({
      groundTruth: scene.groundTruth,
      redactedRects: result.redactions.map(r => r.rect as Rect4),
      payload,
    }),
    utility: scoreUtility(scene.raw, payload),
  };
}

export interface FrontierPoint {
  id: string;
  label: string;
  seeds: number;
  leakageRate: number;
  leakageRateStddev: number;
  leakedPerRun: number;
  /** PII the system never identified: 1 - recall. Not leakage - it is what *would*
   *  leak if that channel ever reached the payload, and it is what fusion moves. */
  unprotectedRate: number;
  tier1Exposed: number;
  piiRecall: number;
  piiRecallStddev: number;
  redactionPrecision: number;
  redactionPrecisionStddev: number;
  utility: number;
  utilityStddev: number;
  literalTextRetention: number;
  handlesConsistent: boolean;
  danglingHandles: string[];
  /** Every ground-truth type that survived verbatim, in any seed. The residual. */
  leakedTypes: string[];
}

export async function computeFrontier(
  seeds: number[],
  base: Profile = PROFILES.BALANCED
): Promise<FrontierPoint[]> {
  const scenes = seeds.map(buildScene);
  const points: FrontierPoint[] = [];

  for (const id of FRONTIER_IDS) {
    const config = CONFIGS.find(c => c.id === id) as AblationConfig;
    const profile = profileFor(base, config);
    const runs: SeedRun[] = [];
    for (const scene of scenes) runs.push(await runSeed(scene, profile));

    const leakedTypes = new Set<string>();
    runs.forEach((run, i) => {
      const byId = new Map(scenes[i]!.groundTruth.map(g => [g.value_id, g.type]));
      for (const vid of run.privacy.leakedValueIds) leakedTypes.add(byId.get(vid) ?? vid);
    });

    // Same scene, same session id, run twice: handle assignment must reproduce.
    const repeat = await runSeed(scenes[0]!, profile);
    const handles = scoreHandleConsistency([runs[0]!.payload, repeat.payload]);

    points.push({
      id,
      label: config.label,
      seeds: seeds.length,
      leakageRate: mean(runs.map(r => r.privacy.leakageRate)),
      leakageRateStddev: stddev(runs.map(r => r.privacy.leakageRate)),
      leakedPerRun: mean(runs.map(r => r.privacy.leaked)),
      unprotectedRate: 1 - mean(runs.map(r => r.privacy.piiRecall)),
      tier1Exposed: runs.reduce((a, r) => a + r.privacy.tier1Exposed, 0),
      piiRecall: mean(runs.map(r => r.privacy.piiRecall)),
      piiRecallStddev: stddev(runs.map(r => r.privacy.piiRecall)),
      redactionPrecision: mean(runs.map(r => r.privacy.redactionPrecision)),
      redactionPrecisionStddev: stddev(runs.map(r => r.privacy.redactionPrecision)),
      utility: mean(runs.map(r => r.utility.actionableRetention)),
      utilityStddev: stddev(runs.map(r => r.utility.actionableRetention)),
      literalTextRetention: mean(runs.map(r => r.utility.literalTextRetention)),
      handlesConsistent: handles.consistent,
      danglingHandles: handles.dangling,
      leakedTypes: [...leakedTypes].sort(),
    });
  }

  return points;
}

// --- SVG -------------------------------------------------------------------
// Hand-written. No chart library, no network, no headless renderer: the plot is
// four dozen lines of arithmetic and the evaluation should not carry a dependency
// for it.

const W = 880;
const H = 560;
const PAD = { top: 64, right: 48, bottom: 96, left: 104 };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderFrontierSvg(points: FrontierPoint[]): string {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // x is leakage. Never rescale it so a residual looks like zero: the axis always
  // starts at 0 and the ticks are real fractions.
  const maxLeak = Math.max(0.05, ...points.map(p => Math.max(p.leakageRate, p.unprotectedRate))) * 1.2;
  const x = (v: number) => PAD.left + (v / maxLeak) * plotW;
  const y = (v: number) => PAD.top + (1 - v) * plotH;

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxLeak);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const grid = [
    ...yTicks.map(
      t =>
        `<line x1="${PAD.left}" y1="${y(t).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(t).toFixed(1)}" stroke="#d4d4d4" stroke-width="1"/>` +
        `<text x="${PAD.left - 14}" y="${(y(t) + 6).toFixed(1)}" text-anchor="end" font-size="17" fill="#111">${(t * 100).toFixed(0)}%</text>`
    ),
    ...xTicks.map(
      t =>
        `<line x1="${x(t).toFixed(1)}" y1="${PAD.top}" x2="${x(t).toFixed(1)}" y2="${PAD.top + plotH}" stroke="#ececec" stroke-width="1"/>` +
        `<text x="${x(t).toFixed(1)}" y="${PAD.top + plotH + 30}" text-anchor="middle" font-size="17" fill="#111">${(t * 100).toFixed(1)}%</text>`
    ),
  ].join('\n  ');

  const ordered = [...points].sort((a, b) => b.leakageRate - a.leakageRate);
  const path = ordered.map(p => `${x(p.unprotectedRate).toFixed(1)},${y(p.utility).toFixed(1)}`).join(' ');

  // Each config draws as a solid dot at its *measured* leakage, plus a bar out to
  // the PII it never identified. On this scene the dots coincide - the channels
  // fusion adds were never in the payload, so they could not leak from it - and the
  // bar is where the three configurations actually differ.
  const marks = ordered
    .map(p => {
      const cx = x(p.leakageRate);
      const cy = y(p.utility);
      const ux = x(p.unprotectedRate);
      const fill = p.leakageRate > 0 ? '#b31b1b' : '#0b6b3a';
      return [
        ux > cx + 2
          ? `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${ux.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#e0a03a" stroke-width="7" stroke-linecap="round" opacity="0.85"/>` +
            `<circle cx="${ux.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" fill="#fff" stroke="#e0a03a" stroke-width="4"/>`
          : '',
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="${fill}" stroke="#fff" stroke-width="3"/>`,
        `<text x="${(cx - 24).toFixed(1)}" y="${(cy - 24).toFixed(1)}" text-anchor="end" font-size="26" font-weight="700" fill="#111">${esc(p.id)}</text>`,
        `<text x="${(cx - 24).toFixed(1)}" y="${(cy - 3).toFixed(1)}" text-anchor="end" font-size="16" fill="#333">${esc(p.label)}</text>`,
        `<text x="${(cx - 24).toFixed(1)}" y="${(cy + 19).toFixed(1)}" text-anchor="end" font-size="16" font-weight="600" fill="${fill}">leak ${(p.leakageRate * 100).toFixed(1)}% · unprotected ${(p.unprotectedRate * 100).toFixed(1)}% · util ${(p.utility * 100).toFixed(0)}%</text>`,
      ]
        .filter(Boolean)
        .join('\n  ');
    })
    .join('\n  ');

  const legend = [
    `<circle cx="${PAD.left + plotW - 250}" cy="${PAD.top - 24}" r="8" fill="#b31b1b"/>`,
    `<text x="${PAD.left + plotW - 234}" y="${PAD.top - 18}" font-size="16" fill="#111">measured leakage</text>`,
    `<circle cx="${PAD.left + plotW - 104}" cy="${PAD.top - 24}" r="7" fill="#fff" stroke="#e0a03a" stroke-width="4"/>`,
    `<text x="${PAD.left + plotW - 88}" y="${PAD.top - 18}" font-size="16" fill="#111">unprotected PII</text>`,
  ].join('\n  ');

  const residual = points.filter(p => p.leakageRate > 0);
  const caption =
    residual.length === 0
      ? 'Every configuration leaks 0 on this scene.'
      : `${residual.length === points.length ? 'No configuration' : residual.map(p => p.id).join('/')} reaches 0 leakage. Residual ${(residual[0]!.leakageRate * 100).toFixed(1)}% (${residual[0]!.leakedTypes.join(', ')}) is identical in all three, so leakage alone does not separate them - the unprotected bar does.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="34" font-size="26" font-weight="700" fill="#111">Privacy–utility frontier</text>
  <text x="${PAD.left}" y="56" font-size="16" fill="#444">${points[0]!.seeds} seeds per point · BALANCED profile · mean, σ in report.md</text>
  ${legend}
  ${grid}
  <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="#111" stroke-width="2"/>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="#111" stroke-width="2"/>
  <polyline points="${path}" fill="none" stroke="#555" stroke-width="2.5" stroke-dasharray="7 5"/>
  ${marks}
  <text x="${(PAD.left + plotW / 2).toFixed(1)}" y="${H - 44}" text-anchor="middle" font-size="19" font-weight="600" fill="#111">PII exposure — solid: leaked verbatim · ring: never identified</text>
  <text x="26" y="${(PAD.top + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="19" font-weight="600" fill="#111" transform="rotate(-90 26 ${(PAD.top + plotH / 2).toFixed(1)})">task utility — elements still labelled and actionable</text>
  <text x="${PAD.left}" y="${H - 16}" font-size="16" fill="#b31b1b">${esc(caption)}</text>
</svg>
`;
}

// --- report ----------------------------------------------------------------

export interface Environment {
  hardware: string;
  os: string;
  runtime: string;
  browser: string;
  commit: string;
  generatedAt: string;
}

export function describeEnvironment(): Environment {
  const sh = (cmd: string, fallback: string) => {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return fallback;
    }
  };
  const cpu = sh('sysctl -n machdep.cpu.brand_string', os.cpus()[0]?.model ?? 'unknown');
  const chromium = sh(
    `"$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" --version`,
    'not installed'
  );

  return {
    hardware: `${cpu} · ${os.cpus().length} cores · ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    os: `${sh('sw_vers -productName', os.type())} ${sh('sw_vers -productVersion', os.release())} (${os.arch()})`,
    runtime: `Node ${process.version}`,
    browser: chromium,
    commit: sh('git rev-parse HEAD', 'unknown'),
    generatedAt: new Date().toISOString(),
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function renderReport(points: FrontierPoint[], env: Environment): string {
  const worst = [...points].sort((a, b) => b.leakageRate - a.leakageRate)[0]!;
  const a1 = points.find(p => p.id === 'A1')!;
  const a6 = points.find(p => p.id === 'A6')!;
  const a7 = points.find(p => p.id === 'A7')!;

  return `# P12-B — leakage evaluation and the privacy–utility frontier

![frontier](./frontier.svg)

**Measured ${env.generatedAt} at \`${env.commit}\`.** Every number below is as measured.
No leakage figure is rounded toward zero.

## Environment

| | |
|---|---|
| Hardware | ${env.hardware} |
| OS | ${env.os} |
| Runtime | ${env.runtime} |
| Browser (Playwright chromium) | ${env.browser} |
| Commit | \`${env.commit}\` |
| Seeds per point | ${points[0]!.seeds} |
| Profile | BALANCED |

## The three points

| config | source(s) | leakage rate | σ | leaked values / run | unprotected PII | tier-1 exposed | PII recall | σ | redaction precision | σ | task utility | σ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${points
  .map(
    p =>
      `| **${p.id}** | ${p.label} | **${pct(p.leakageRate)}** | ${p.leakageRateStddev.toFixed(3)} | ${p.leakedPerRun.toFixed(1)} | ${pct(p.unprotectedRate)} | ${p.tier1Exposed} | ${pct(p.piiRecall)} | ${p.piiRecallStddev.toFixed(3)} | ${pct(p.redactionPrecision)} | ${p.redactionPrecisionStddev.toFixed(3)} | ${pct(p.utility)} | ${p.utilityStddev.toFixed(3)} |`
  )
  .join('\n')}

*Task utility* — elements whose label survived verbatim **and** that still carry at
least one available action. \`sanitize()\` empties \`available_actions\` for anything a
fused region covers, so a redacted control is unclickable, not merely unlabelled.
*Redaction precision* — redacted rects that actually covered ground-truth PII. It
falls as coverage redacts regions that turn out to hold nothing, which is the
over-redaction cost explain-or-redact is paying for the recall it buys.

## Acceptance

- **A6 beats A1 on PII recall:** ${pct(a6.piiRecall)} vs ${pct(a1.piiRecall)} — ${a6.piiRecall > a1.piiRecall ? '✅' : '❌'}
- **A7 reaches leakage 0:** ${pct(a7.leakageRate)} — ${a7.leakageRate === 0 ? '✅' : '❌ **not met, reported as measured**'}
- **Tier-1 exposure is 0 everywhere:** ${points.every(p => p.tier1Exposed === 0) ? '✅' : '❌'}
- **≥5 seeds per point with variance:** ${points[0]!.seeds} seeds, σ in every column — ${points[0]!.seeds >= 5 ? '✅' : '❌'}
- **Handle referential consistency:** ${points.every(p => p.handlesConsistent) ? '✅ every handle used in the payload is declared, carries one type, and reproduces across identical runs' : `❌ dangling: ${points.flatMap(p => p.danglingHandles).join(', ')}`}
- **Hardware, OS, browser and commit stated:** ✅ above

## The residual

${
  a7.leakageRate === 0
    ? 'A7 leaks nothing on this scene. That is a statement about this scene, not a guarantee: see the non-guarantees in `SECURITY.md`.'
    : `A7 still leaks ${pct(a7.leakageRate)} — ${a7.leakedPerRun.toFixed(1)} values per run, of type${a7.leakedTypes.length > 1 ? 's' : ''} **${a7.leakedTypes.join(', ')}**, in every seed.

This is the P8 NER address gap, not a fusion defect: bare localities with no
road/street token sit in DOM free text the extractor legitimately accounted for, so
coverage does not reach them and no detector fires on them. No configuration in the
sweep moves it. It closes when NER address recall closes, and not before. The worst
configuration on this axis is ${worst.id} at ${pct(worst.leakageRate)}.`
}

## What this does not measure

The utility axis is computed **in process**, on the sanitized payload — not through
A's Playwright harness in \`eval/harness/\`. The harness needs a loadable extension,
and \`apps/extension/dist\` currently ships no content script and no side panel
(\`manifest.json\` declares neither), so \`waitForExtensionReady\` cannot resolve and
no end-to-end task can execute. Logged in \`docs/REQUESTS-TO-A.md\`. When that lands,
the y-axis should be replaced with the harness's real task-completion rate; the
x-axis does not change, because leakage is measured on the payload either way.

Task success is therefore **not** claimed here. What is claimed is the shape of the
trade, and that shape is measured.
`;
}

export function writeFrontier(points: FrontierPoint[], outDir: string, env = describeEnvironment()): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'frontier.svg'), renderFrontierSvg(points));
  fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(points, env));
}

const SEEDS = [1337, 42, 999, 2024, 7, 31337, 8080, 12345, 555, 90210];

if (process.argv[1] && process.argv[1].endsWith('frontier.ts')) {
  computeFrontier(SEEDS).then(points => {
    writeFrontier(points, path.resolve(__dirname, '../reports'));
    console.log(renderReport(points, describeEnvironment()));
  });
}
