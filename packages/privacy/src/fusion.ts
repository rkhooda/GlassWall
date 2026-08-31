/**
 * P11 fusion — spatial join in viewport coordinates, then noisy-OR.
 *
 *     S(region) = 1 − Π_i (1 − w_i · c_i)
 *
 * Noisy-OR is not a stylistic choice. Two properties fall out of the formula and
 * the whole privacy argument rests on them:
 *
 *   MONOTONE.        Every factor `(1 − w_i·c_i)` lies in [0, 1]. Multiplying the
 *                    running product by another such factor can only shrink it,
 *                    so S can only rise. Adding evidence never lowers suspicion.
 *
 *   FAILS TO PRIVACY. One term with `w_i·c_i = 1` drives the product to 0 and S to 1
 *                    regardless of every other source. A single strong signal suffices.
 *
 * Together: a source that is wrong, noisy, or actively compromised can only ever
 * push a region toward redaction. It has no expressible way to argue a region is
 * clean — there is no negative evidence channel, by construction. A compromised
 * vision model causes over-redaction and cannot cause a leak.
 */
import type { Detection } from '@glasswall/schema/audit';
import { buildSpatialIndex } from '@glasswall/perception/spatial-index';
import type { Rect } from '@glasswall/perception/geometry';
import { decide, tierForType, type Profile, type Transformation, type EvidenceKind } from './policy';

export type Rect4 = [number, number, number, number];

export interface UnexplainedInput {
  rect: Rect4;
  reason: string;
}

export interface FusedRegion {
  rect: Rect4;
  /** S(region) ∈ [0, 1]. */
  sensitivity: number;
  evidence: Detection[];
  action: Transformation;
  /** e.g. "MASK: unexplained region, no DOM owner". Goes straight to the audit record. */
  reason: string;
  threshold_matched: string;
  /** Attribution for the audit `source` enum — the strongest contributing source. */
  source: EvidenceKind;
}

/**
 * `1 − Π (1 − t)` over the contribution terms `t = w_i · c_i`.
 *
 * Exported so the monotonicity property test can hit the formula directly rather
 * than inferring it from `fuse()` output.
 */
export function noisyOr(terms: number[]): number {
  let complement = 1;
  for (const t of terms) {
    complement *= 1 - clamp01(t);
  }
  return 1 - complement;
}

/** Anchors are snapped to this grid so co-located evidence lands in one region. */
const ANCHOR_GRID = 8;

/**
 * Fuse rect-bearing evidence into regions and decide each region's transformation.
 *
 * Evidence with no rect cannot be spatially joined; `sanitize()` has already
 * tokenized it by value, so it is handled on the value channel, not here.
 */
export function fuse(input: {
  detections: Detection[];
  unexplained: UnexplainedInput[];
  profile: Profile;
}): FusedRegion[] {
  const { detections, unexplained, profile } = input;
  const weights = profile.fusion.source_weights;

  const placed = detections.filter((d): d is Detection & { rect: Rect4 } => d.rect !== undefined);

  // Spatial join: one uniform grid over every piece of placed evidence, then one
  // query per anchor. O(anchors × evidence-per-cell), not O(anchors × evidence).
  const index = buildSpatialIndex(
    placed.map((d, i) => ({ id: `d${i}`, rect: toRect(d.rect), source: d.type, data: d })),
    { x: 0, y: 0, width: 0, height: 0 }
  );

  const anchors = new Map<string, { rect: Rect4; unexplained: UnexplainedInput | null }>();
  for (const d of placed) {
    const rect = snap(d.rect);
    const key = keyOf(rect);
    if (!anchors.has(key)) anchors.set(key, { rect, unexplained: null });
  }
  for (const u of unexplained) {
    const rect = snap(u.rect);
    const key = keyOf(rect);
    const existing = anchors.get(key);
    if (existing) existing.unexplained ??= u;
    else anchors.set(key, { rect, unexplained: u });
  }

  const regions: FusedRegion[] = [];
  for (const anchor of anchors.values()) {
    const evidence = index.query(toRect(anchor.rect)).map(item => item.data as Detection);

    const terms: Array<{ term: number; kind: EvidenceKind }> = evidence.map(d => ({
      term: weights[d.type] * d.confidence,
      kind: d.type,
    }));

    // The coverage pass is just another source. Its w is 1.0, so the term entering
    // the product is exactly the profile's `unexplained_prior` — 0.8 STRICT, 0.4 BALANCED.
    if (anchor.unexplained) {
      terms.push({
        term: weights.deterministic * profile.policy.unexplained_prior,
        kind: 'deterministic',
      });
    }
    if (terms.length === 0) continue;

    const sensitivity = noisyOr(terms.map(t => t.term));
    const strongest = terms.reduce((a, b) => (b.term > a.term ? b : a));
    const tier = evidence.length > 0 ? Math.min(...evidence.map(d => tierForType(d.pii_type))) : undefined;

    const decision = decide(profile, {
      sensitivity,
      tier,
      cause: describe(evidence, anchor.unexplained, sensitivity),
    });

    regions.push({
      rect: anchor.rect,
      sensitivity,
      evidence,
      action: decision.action,
      reason: decision.reason,
      threshold_matched: decision.threshold_matched,
      source: strongest.kind,
    });
  }

  return regions;
}

/** The half of the audit reason a person actually reads. Types and counts, never values. */
function describe(evidence: Detection[], unexplained: UnexplainedInput | null, sensitivity: number): string {
  const parts: string[] = [];
  if (unexplained) parts.push(unexplained.reason);
  if (evidence.length > 0) {
    const types = [...new Set(evidence.map(d => d.pii_type))].sort().join('+');
    const sources = [...new Set(evidence.map(d => d.type))].sort().join('+');
    parts.push(`${types} from ${sources}`);
  }
  return `${parts.join('; ')} (S=${sensitivity.toFixed(2)})`;
}

function snap(rect: Rect4): Rect4 {
  return [
    Math.floor(rect[0] / ANCHOR_GRID) * ANCHOR_GRID,
    Math.floor(rect[1] / ANCHOR_GRID) * ANCHOR_GRID,
    Math.ceil(rect[2] / ANCHOR_GRID) * ANCHOR_GRID,
    Math.ceil(rect[3] / ANCHOR_GRID) * ANCHOR_GRID,
  ];
}

function keyOf(rect: Rect4): string {
  return rect.join(',');
}

function toRect(r: Rect4): Rect {
  return { x: r[0], y: r[1], width: r[2], height: r[3] };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
