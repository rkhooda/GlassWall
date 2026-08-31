/**
 * Privacy metrics (PLAN-B §6 P11/P12-B).
 *
 * Two numbers, and they answer different questions:
 *
 *   piiRecall — of the PII actually on the page, what fraction did the system
 *               identify as needing protection? This is what an ablation moves.
 *   leaked    — of that same PII, what fraction survives verbatim in the payload
 *               that would go over the wire? This is the number that must be 0.
 *
 * Recall can fall without leakage rising: a value the DOM never carried cannot
 * leak even when nothing detected it. Reporting only leakage would therefore
 * flatter every configuration, which is exactly why both are here.
 */
export type Rect4 = [number, number, number, number];

export interface GroundTruthValue {
  value: string;
  type: string;
  value_id: string;
  rect: Rect4;
  /** Optional grouping, so a source's blind spot can be reported separately. */
  channel?: string;
}

export interface PrivacyScore {
  total: number;
  recalled: number;
  piiRecall: number;
  leaked: number;
  leakedValueIds: string[];
  missedValueIds: string[];
  /** Recall restricted to each channel — where a single source's blindness shows. */
  recallByChannel: Record<string, number>;
}

export function scorePrivacy(input: {
  groundTruth: GroundTruthValue[];
  redactedRects: Rect4[];
  payload: unknown;
}): PrivacyScore {
  const { groundTruth, redactedRects } = input;
  const serialized = JSON.stringify(input.payload);

  const missedValueIds: string[] = [];
  const leakedValueIds: string[] = [];

  for (const item of groundTruth) {
    if (!redactedRects.some(r => overlaps(r, item.rect))) missedValueIds.push(item.value_id);
    if (serialized.includes(item.value)) leakedValueIds.push(item.value_id);
  }

  const recalled = groundTruth.length - missedValueIds.length;
  const missed = new Set(missedValueIds);
  const recallByChannel: Record<string, number> = {};
  for (const channel of new Set(groundTruth.map(g => g.channel ?? 'all'))) {
    const inChannel = groundTruth.filter(g => (g.channel ?? 'all') === channel);
    recallByChannel[channel] = inChannel.filter(g => !missed.has(g.value_id)).length / inChannel.length;
  }

  return {
    total: groundTruth.length,
    recalled,
    piiRecall: groundTruth.length === 0 ? 1 : recalled / groundTruth.length,
    leaked: leakedValueIds.length,
    leakedValueIds,
    missedValueIds,
    recallByChannel,
  };
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation — the harness reports variance across seeds. */
export function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

function overlaps(a: Rect4, b: Rect4): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}
