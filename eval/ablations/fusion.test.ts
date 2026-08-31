import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILES, sanitize } from '@glasswall/privacy/index';
import { runAblation, formatTable, profileFor, CONFIGS, type AblationRow } from './run';
import { buildScene } from './scene';
import { nerSource, ocrSource, visionSource } from './sources';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SINGLE_SOURCE = ['A1', 'A2', 'A3', 'A4', 'A5'];

let balanced: AblationRow[];
let strict: AblationRow[];

beforeAll(async () => {
  [balanced, strict] = await Promise.all([
    runAblation(SEEDS, PROFILES.BALANCED),
    runAblation(SEEDS, PROFILES.STRICT),
  ]);
}, 60_000);

const by = (rows: AblationRow[], id: string) => rows.find(r => r.id === id)!;

describe('P11 ablation', () => {
  it('fusion beats every single source on PII recall', () => {
    for (const rows of [balanced, strict]) {
      const fusion = by(rows, 'A7');
      for (const id of SINGLE_SOURCE) {
        const single = by(rows, id);
        expect(
          fusion.piiRecall,
          `fusion ${fusion.piiRecall.toFixed(3)} must beat ${single.label} ${single.piiRecall.toFixed(3)}`
        ).toBeGreaterThan(single.piiRecall);
      }
    }
  });

  it('explain-or-redact is what closes the gap, with or without a vision model', () => {
    for (const rows of [balanced, strict]) {
      // A7 vs A6, and A8 vs A9: the same pair with vision removed.
      expect(by(rows, 'A7').piiRecall).toBeGreaterThan(by(rows, 'A6').piiRecall);
      expect(by(rows, 'A8').piiRecall).toBeGreaterThan(by(rows, 'A9').piiRecall);

      // The channel nothing in the detection stack can read.
      expect(by(rows, 'A6').recallByChannel['canvas_opaque']).toBe(0);
      expect(by(rows, 'A8').recallByChannel['canvas_opaque']).toBe(1);
    }
  });

  it('disabling the vision model costs nothing', () => {
    expect(by(balanced, 'A8').piiRecall).toBe(by(balanced, 'A7').piiRecall);
  });

  it('leaks nothing beyond the measured NER address gap', async () => {
    // The residual is not a fusion defect: it is the P8 STREET_ADDRESS recall gap
    // (bare Bengaluru localities with no road token), in DOM free text that the
    // extractor legitimately accounted for. Pinned by type, so any *new* kind of
    // leak fails here rather than hiding inside a tolerance.
    const leakedTypes = new Set<string>();

    for (const seed of SEEDS) {
      const scene = buildScene(seed);
      const profile = profileFor(PROFILES.BALANCED, CONFIGS.find(c => c.id === 'A8')!);
      const result = await sanitize({
        raw: scene.raw,
        frame: null,
        task: 'ablation',
        step: 0,
        session: { session_id: `abl_${seed}`, policy_profile: 'BALANCED' },
        perceptionSources: [nerSource(scene), ocrSource(scene), visionSource(scene)],
        profile,
      });
      const payload = JSON.stringify(result.observation);
      for (const item of scene.groundTruth) {
        if (payload.includes(item.value)) leakedTypes.add(item.type);
      }
    }

    expect([...leakedTypes]).toEqual(['STREET_ADDRESS']);
  }, 30_000);

  it('writes the numbers to eval/reports', () => {
    writeFileSync(
      resolve(__dirname, '../reports/p11-ablation.md'),
      [
        '# P11 ablation — fusion vs. every single source',
        '',
        `${SEEDS.length} generator seeds (${SEEDS[0]}–${SEEDS.at(-1)}) · node ${process.version} · ${new Date().toISOString().slice(0, 10)}`,
        '',
        'Every row is the same build with a different `source_weights` object from',
        '`config/policies/*.json`. Nothing is recompiled and no branch is taken on the',
        'configuration name — an ablation here is literally setting `w_i` to 0.',
        '',
        '## BALANCED',
        '',
        formatTable(balanced),
        '',
        '## STRICT',
        '',
        formatTable(strict),
        '',
        '## Reading it',
        '',
        '- `canvas_opaque` holds an MRN and a postal code rendered to pixels. No recognizer',
        '  matches either and no model is trained on them, so every detection-based row',
        '  scores 0 there. Only explain-or-redact reaches it — which is the difference',
        '  between A6 and A7, and between A9 and A8.',
        '- A8 equals A7: removing the vision model costs nothing, because coverage, not a',
        '  detector, is what accounts for the pixel channel.',
        '- `leaked` is identical across every row. It is the measured P8 STREET_ADDRESS',
        '  gap in DOM free text (bare localities with no road token), which is orthogonal',
        '  to fusion — no configuration here moves it.',
        '- STRICT and BALANCED score the same recall. They differ in *transformation*',
        '  (DROP vs TOKENIZE on an unexplained region), which a binary recall metric',
        '  cannot see. The privacy–utility frontier in P12-B is where that shows up.',
        '',
      ].join('\n')
    );
  });
});
