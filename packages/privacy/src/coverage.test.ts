import { describe, it, expect } from 'vitest';
import type { RawObservation } from '@glasswall/schema/observation';
import { coverageFraction, explainOrRedact, partitionByExplanation } from './coverage';
import { fuse } from './fusion';
import { BALANCED, STRICT } from './policy';

type R = [number, number, number, number];

function observation(over: Partial<RawObservation> = {}): RawObservation {
  return {
    observation_id: 'o1',
    session_id: 's1',
    step: 0,
    page: {
      origin_class: 'benchmark',
      url_template: '/clinic/:id',
      title_raw: 'ClinicDesk',
      type_hint: 'detail',
      modal_active: false,
      stability: 'stable',
    },
    viewport: { w: 1280, h: 800, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 2 },
    elements: [],
    text_nodes: [],
    frames: [],
    truncated: false,
    list_virtualized: false,
    ...over,
  };
}

function element(id: string, tag: string, rect: R, over: Record<string, unknown> = {}) {
  return {
    id,
    id_hash: `h_${id}`,
    tag,
    role: 'generic',
    label_raw: '',
    rect,
    visible: true,
    enabled: true,
    focusable: false,
    value_state: 'n/a' as const,
    group: 'g',
    frame: 0,
    ...over,
  };
}

describe('coverageFraction', () => {
  it('is 0 when nothing overlaps', () => {
    expect(coverageFraction([0, 0, 100, 100], [[200, 200, 50, 50]])).toBe(0);
  });

  it('is 1 when a single rect swallows the region', () => {
    expect(coverageFraction([10, 10, 20, 20], [[0, 0, 100, 100]])).toBe(1);
  });

  it('sums disjoint owners without double-counting an overlap', () => {
    // Two 100×50 halves overlapping by 50×50 over a 100×100 region → 75% covered.
    expect(coverageFraction([0, 0, 100, 100], [[0, 0, 100, 50], [0, 25, 100, 50]])).toBeCloseTo(0.75, 6);
  });
});

describe('explain-or-redact', () => {
  it('flags a canvas nothing in the DOM accounts for', () => {
    const raw = observation({
      elements: [
        element('canvas1', 'canvas', [400, 200, 300, 200]),
        element('para1', 'p', [0, 0, 380, 100]),
      ],
    });

    const { candidates, explained } = partitionByExplanation(raw, new Set());
    expect(candidates.map(c => c.rect)).toContainEqual([400, 200, 300, 200]);
    expect(explained).toContainEqual([0, 0, 380, 100]);

    const unexplained = explainOrRedact({ candidates, explained, minCoverage: BALANCED.fusion.min_coverage });
    expect(unexplained).toHaveLength(1);
    expect(unexplained[0]!.coverage).toBe(0);
    expect(unexplained[0]!.reason).toBe('opaque <canvas>, contents unreadable from the DOM, no DOM owner');
  });

  it('drives a known-unexplained canvas to a redacting action with no model at all', () => {
    const raw = observation({ elements: [element('canvas1', 'canvas', [400, 200, 300, 200])] });
    const { candidates, explained } = partitionByExplanation(raw, new Set());

    for (const profile of [STRICT, BALANCED]) {
      const unexplained = explainOrRedact({ candidates, explained, minCoverage: profile.fusion.min_coverage });
      // No detections: the vision model is not merely disabled, it does not exist here.
      const [region] = fuse({ detections: [], unexplained, profile });

      expect(region!.sensitivity).toBeCloseTo(profile.policy.unexplained_prior, 6);
      expect(region!.action).not.toBe('PASS');
      expect(region!.reason).toContain('no DOM owner');
    }
  });

  it('accounts for a canvas fully owned by a DOM element behind it', () => {
    const raw = observation({
      elements: [element('canvas1', 'canvas', [100, 100, 50, 50])],
      text_nodes: [
        { id: 't1', rect: [0, 0, 400, 400], text: 'alt text describing the chart', owner_element_id: null, source: 'dom' as const },
      ],
    });
    const { candidates, explained } = partitionByExplanation(raw, new Set());
    expect(explainOrRedact({ candidates, explained, minCoverage: BALANCED.fusion.min_coverage })).toHaveLength(0);
  });

  it('does not let a sensitive element vouch for its neighbours', () => {
    const raw = observation({
      elements: [
        element('canvas1', 'canvas', [0, 0, 100, 100]),
        element('ssn', 'input', [0, 0, 200, 200], { type: 'password' }),
      ],
    });

    const withoutFlag = partitionByExplanation(raw, new Set());
    const withFlag = partitionByExplanation(raw, new Set(['ssn']));

    expect(withoutFlag.explained).toContainEqual([0, 0, 200, 200]);
    expect(withFlag.explained).not.toContainEqual([0, 0, 200, 200]);
  });

  it('treats a cross-origin iframe as unexplained', () => {
    const raw = observation({ frames: [{ id: 1, origin: 'cross', rect: [0, 0, 300, 300] }] });
    const { candidates, explained } = partitionByExplanation(raw, new Set());
    const unexplained = explainOrRedact({ candidates, explained, minCoverage: BALANCED.fusion.min_coverage });
    expect(unexplained[0]!.reason).toContain('cross-origin iframe');
  });

  it('STRICT demands more coverage than PERMISSIVE for the same region', () => {
    const raw = observation({
      elements: [element('canvas1', 'canvas', [0, 0, 100, 100])],
      text_nodes: [{ id: 't1', rect: [0, 0, 100, 85], text: 'caption', owner_element_id: null, source: 'dom' as const }],
    });
    const { candidates, explained } = partitionByExplanation(raw, new Set());

    // 85% owned: unexplained under STRICT (0.98) and BALANCED (0.90), explained under PERMISSIVE (0.75).
    expect(explainOrRedact({ candidates, explained, minCoverage: 0.98 })).toHaveLength(1);
    expect(explainOrRedact({ candidates, explained, minCoverage: 0.9 })).toHaveLength(1);
    expect(explainOrRedact({ candidates, explained, minCoverage: 0.75 })).toHaveLength(0);
  });
});
