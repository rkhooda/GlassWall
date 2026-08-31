/**
 * P11 explain-or-redact.
 *
 * The extractor emits what the DOM can account for. Union those rects; anything a
 * content-bearing region has outside that union is *unexplained*, and unexplained
 * takes `S = policy.unexplained_prior` — 0.8 under STRICT, 0.4 under BALANCED.
 *
 * That is the whole mechanism that turns "we might have missed something" into
 * "we withheld what we could not account for". It needs no model to work, which is
 * why leakage stays at 0 with the vision detector switched off: a region nobody can
 * explain is redacted on the strength of nobody being able to explain it.
 */
import type { RawObservation } from '@glasswall/schema/observation';
import { area, intersect, areaUnion, type Rect } from '@glasswall/perception/geometry';
import { buildSpatialIndex } from '@glasswall/perception/spatial-index';
import type { Rect4, UnexplainedInput } from './fusion';

/** Tags whose contents the DOM text channel cannot read. These always need an owner. */
const OPAQUE_TAGS = new Set(['canvas', 'img', 'svg', 'video', 'object', 'embed', 'iframe']);

/**
 * `areaUnion` is O(k² · k) in the number of rects clipped into one region. A region
 * overlapped by hundreds of elements would blow the 20ms budget, so only the largest
 * few contributors are counted.
 *
 * ponytail: fixed cap, not exact coverage. Under-counting coverage makes a region
 * look *less* explained, so the error is toward redaction. Raise it or switch to a
 * sweep-line if a real page ever shows a region with more than this many owners.
 */
const MAX_OWNERS_PER_REGION = 24;

export interface CoverageResult extends UnexplainedInput {
  /** Fraction of the region owned by extractor-emitted, known-low-sensitivity content. */
  coverage: number;
}

/** Fraction of `region` covered by the union of `explained`, in [0, 1]. */
export function coverageFraction(region: Rect4, explained: Rect4[]): number {
  const regionArea = area(toRect(region));
  if (regionArea <= 0) return 1;

  const clipped = explained
    .map(e => intersect(toRect(region), toRect(e)))
    .filter((r): r is Rect => r !== null)
    .sort((a, b) => area(b) - area(a))
    .slice(0, MAX_OWNERS_PER_REGION);

  if (clipped.length === 0) return 0;
  return Math.min(1, areaUnion(clipped) / regionArea);
}

/**
 * Which candidate regions the DOM fails to account for.
 *
 * A candidate whose coverage falls below `minCoverage` is returned; `fuse()` then
 * feeds it into the noisy-OR as a `deterministic` term worth `unexplained_prior`.
 */
export function explainOrRedact(input: {
  candidates: UnexplainedInput[];
  explained: Rect4[];
  minCoverage: number;
}): CoverageResult[] {
  const { candidates, explained, minCoverage } = input;
  if (candidates.length === 0) return [];

  const index = buildSpatialIndex(
    explained.map((rect, i) => ({ id: `e${i}`, rect: toRect(rect), source: 'dom', data: rect })),
    { x: 0, y: 0, width: 0, height: 0 }
  );

  const out: CoverageResult[] = [];
  for (const candidate of candidates) {
    const owners = index.query(toRect(candidate.rect)).map(item => item.data as Rect4);
    const coverage = coverageFraction(candidate.rect, owners);
    if (coverage < minCoverage) {
      out.push({
        rect: candidate.rect,
        coverage,
        reason:
          coverage === 0
            ? `${candidate.reason}, no DOM owner`
            : `${candidate.reason}, only ${(coverage * 100).toFixed(0)}% owned by the DOM`,
      });
    }
  }
  return out;
}

/**
 * Split an observation into regions that need an owner and rects that can be one.
 *
 * `sensitiveIds` are elements a detector already flagged: they are accounted for,
 * but they may not vouch for their neighbours, so they are kept out of the union.
 */
export function partitionByExplanation(
  raw: RawObservation,
  sensitiveIds: ReadonlySet<string>
): { candidates: UnexplainedInput[]; explained: Rect4[] } {
  const candidates: UnexplainedInput[] = [];
  const explained: Rect4[] = [];

  for (const el of raw.elements) {
    if (!el.visible) continue;
    const opaque = OPAQUE_TAGS.has(el.tag.toLowerCase());

    if (el.unexplained) {
      candidates.push({ rect: el.rect, reason: `unexplained <${el.tag}> region` });
    } else if (opaque) {
      candidates.push({ rect: el.rect, reason: `opaque <${el.tag}>, contents unreadable from the DOM` });
    } else if (!sensitiveIds.has(el.id)) {
      explained.push(el.rect);
    }
  }

  // Text the extractor read is text we can account for.
  for (const tn of raw.text_nodes) explained.push(tn.rect);

  for (const frame of raw.frames) {
    if (frame.origin === 'cross') {
      candidates.push({ rect: frame.rect, reason: 'cross-origin iframe' });
    }
  }

  return { candidates, explained };
}

function toRect(r: Rect4): Rect {
  return { x: r[0], y: r[1], width: r[2], height: r[3] };
}
