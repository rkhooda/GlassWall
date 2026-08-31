import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { characterAccuracy } from '../../../../eval/metrics/detection';
import { cropGeometry } from './crop-policy';

/**
 * P9 acceptance against the real engine: character accuracy >= 0.90 on the
 * ClinicDesk canvas and image text, and p50 <= 1200ms for three crops on WASM.
 *
 * Needs the vendored tesseract assets and the fixture crops. Both are absent
 * from a fresh clone, so this suite skips loudly rather than reporting a number
 * nobody measured. MODEL_MANIFEST.json records what to place where.
 */
const TESSERACT_DIR = resolve(__dirname, '../../../../apps/extension/public/tesseract');
const FIXTURE_DIR = resolve(__dirname, '../../../../eval/fixtures/ocr');
const MANIFEST = resolve(FIXTURE_DIR, 'fixtures.json');

const READY = existsSync(resolve(TESSERACT_DIR, 'worker.min.js')) && existsSync(MANIFEST);

interface Fixture {
  file: string;
  text: string;
}

describe.skipIf(!READY)('OCR against the real engine', () => {
  let fixtures: Fixture[];
  let read: (file: string) => Promise<string>;

  beforeAll(async () => {
    fixtures = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Fixture[];

    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: resolve(TESSERACT_DIR, 'worker.min.js'),
      corePath: TESSERACT_DIR,
      langPath: TESSERACT_DIR,
      cacheMethod: 'none',
    });

    read = async file => (await worker.recognize(resolve(FIXTURE_DIR, file))).data.text.trim();
    afterAll(() => worker.terminate());
  });

  it('reaches character accuracy >= 0.90 on every fixture', async () => {
    for (const fixture of fixtures) {
      expect(characterAccuracy(await read(fixture.file), fixture.text)).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('stays under 1200ms p50 for three crops on WASM', async () => {
    const three = fixtures.slice(0, 3);
    const times: number[] = [];

    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      for (const fixture of three) await read(fixture.file);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThanOrEqual(1200);
  });
});

describe('crop geometry holds regardless of the engine', () => {
  it('keeps a 3px round trip on the largest crop the budget allows', () => {
    const geometry = cropGeometry([0, 0, 2000, 1200], 2000, 1200);
    const word: [number, number, number, number] = [1500, 900, 120, 30];

    const box = {
      x0: Math.round(word[0] * geometry.scale),
      y0: Math.round(word[1] * geometry.scale),
      x1: Math.round((word[0] + word[2]) * geometry.scale),
      y1: Math.round((word[1] + word[3]) * geometry.scale),
    };
    const back = [
      box.x0 / geometry.scale,
      box.y0 / geometry.scale,
      (box.x1 - box.x0) / geometry.scale,
      (box.y1 - box.y0) / geometry.scale,
    ];

    back.forEach((v, i) => expect(Math.abs(v - word[i]!)).toBeLessThanOrEqual(3));
  });
});

describe.skipIf(READY)('OCR fixtures', () => {
  it('are not vendored, so the accuracy suite did not run', () => {
    expect(READY).toBe(false);
  });
});
