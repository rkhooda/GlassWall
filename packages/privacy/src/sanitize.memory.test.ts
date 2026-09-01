import { describe, expect, it } from 'vitest';
import type { RawObservation } from '@glasswall/schema/observation';
import { PROFILES } from './policy';
import { sanitize } from './sanitize';

/**
 * P13-B — 50 steps, and the heap must not climb.
 *
 * A leak here would be invisible in a unit test and fatal in a demo: the vault, the
 * secret registry and the tokenizer are all per-session, and it is easy to write one
 * that accumulates across steps instead of being rebuilt.
 *
 * Without a forced collection this measures the allocator's mood, not a leak, so it
 * skips loudly rather than reporting a number nobody can trust. Run it for real with:
 *
 *   cd packages/privacy && NODE_OPTIONS=--expose-gc pnpm exec vitest run sanitize.memory
 */
const gc = (globalThis as { gc?: () => void }).gc;

const STEPS = 50;
/** Baseline on an M1/8GB was 0.0 MB per 10 steps (eval/reports/perf-baseline.md).
 *  Measured clean delta is 0.06MB over 40 steps; 0.5MB is 8x that and still
 *  catches a real leak - retaining the 40 SanitizeResults costs 2.2MB and fails. */
const MAX_GROWTH_MB = 0.5;

function observation(step: number): RawObservation {
  return {
    observation_id: `obs_${step}`,
    session_id: 'sess_mem',
    step,
    page: {
      origin_class: 'benchmark', url_template: '/checkout', title_raw: 'Checkout',
      type_hint: 'checkout', modal_active: false, stability: 'stable',
    },
    viewport: { w: 1280, h: 900, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 2 },
    elements: Array.from({ length: 60 }, (_, i) => ({
      id: `el_${i}`, id_hash: `h_${i}`, tag: 'input', role: 'textbox',
      label_raw: `Field ${i}`, rect: [16, 16 + i * 24, 300, 20] as [number, number, number, number],
      visible: true, enabled: true, focusable: true, value_state: 'empty' as const,
      group: 'form', frame: 0,
    })),
    // New values every step, so a registry that never resets would grow visibly.
    text_nodes: Array.from({ length: 20 }, (_, i) => ({
      id: `t_${i}`,
      rect: [16, 600 + i * 20, 400, 18] as [number, number, number, number],
      text: `order ${step}-${i}: user${step}${i}@example.in on +91 99194 1${String(1000 + step + i).slice(-4)}`,
      owner_element_id: null,
      source: 'dom' as const,
    })),
    frames: [],
    truncated: false,
    list_virtualized: false,
  };
}

function heapMB(): number {
  gc!();
  return process.memoryUsage().heapUsed / 1048576;
}

describe.skipIf(!gc)('heap over 50 steps', () => {
  it(`grows less than ${MAX_GROWTH_MB}MB`, async () => {
    // Warm the allocator first: the first few steps grow every heap and measuring
    // from step 0 would report JIT and lazy-init as a leak.
    for (let step = 0; step < 10; step++) {
      await sanitize({
        raw: observation(step), frame: null, task: 'memory', step,
        session: { session_id: 'sess_mem', policy_profile: 'BALANCED' },
        profile: PROFILES.BALANCED,
      });
    }

    const before = heapMB();
    for (let step = 10; step < STEPS; step++) {
      await sanitize({
        raw: observation(step), frame: null, task: 'memory', step,
        session: { session_id: 'sess_mem', policy_profile: 'BALANCED' },
        profile: PROFILES.BALANCED,
      });
    }
    const after = heapMB();

    expect(after - before, `heap grew ${(after - before).toFixed(2)}MB over ${STEPS - 10} steps`)
      .toBeLessThan(MAX_GROWTH_MB);
  }, 60_000);
});

describe.skipIf(!!gc)('heap over 50 steps', () => {
  it('did NOT run: node was started without --expose-gc', () => {
    expect(gc).toBeUndefined();
  });
});
