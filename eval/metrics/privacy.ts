/**
 * Privacy metrics (PLAN-B §6 P11/P12-B).
 *
 * The numbers answer different questions and are reported separately on purpose:
 *
 *   piiRecall / redactionRecall — of the PII actually on the page, what fraction did
 *               the system identify as needing protection? This is what an ablation moves.
 *   redactionPrecision — of what it redacted, what fraction was actually PII? This is
 *               the over-redaction cost, and it is the axis STRICT trades away.
 *   leakageRate — of that same PII, what fraction survives verbatim in the payload
 *               that would go over the wire? This is the number that must be 0.
 *   tier1Exposed — tier-1 values (credentials, API keys) present in the payload.
 *               Not a rate. A count, and the only acceptable value is 0.
 *
 * Recall can fall without leakage rising: a value the DOM never carried cannot
 * leak even when nothing detected it. Reporting only leakage would therefore
 * flatter every configuration, which is exactly why both are here.
 *
 * Every rate is reported as measured. A leakage number is never rounded toward zero.
 */
export type Rect4 = [number, number, number, number];

export interface GroundTruthValue {
  value: string;
  type: string;
  value_id: string;
  rect: Rect4;
  /** 1 = credential-grade. Tier-1 exposure is counted separately and must be 0. */
  tier?: number;
  /** Optional grouping, so a source's blind spot can be reported separately. */
  channel?: string;
}

export interface PrivacyScore {
  total: number;
  recalled: number;
  piiRecall: number;
  /** Alias of piiRecall, named for the report's precision/recall pair. */
  redactionRecall: number;
  /** Redacted rects that actually covered PII, over all redacted rects. */
  redactionPrecision: number;
  redactionsTotal: number;
  redactionsOnPii: number;
  leaked: number;
  leakageRate: number;
  leakedValueIds: string[];
  missedValueIds: string[];
  tier1Exposed: number;
  tier1ExposedValueIds: string[];
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
  const tier1ExposedValueIds: string[] = [];

  for (const item of groundTruth) {
    if (!redactedRects.some(r => overlaps(r, item.rect))) missedValueIds.push(item.value_id);
    if (serialized.includes(item.value)) {
      leakedValueIds.push(item.value_id);
      if (item.tier === 1) tier1ExposedValueIds.push(item.value_id);
    }
  }

  const recalled = groundTruth.length - missedValueIds.length;
  const missed = new Set(missedValueIds);
  const recallByChannel: Record<string, number> = {};
  for (const channel of new Set(groundTruth.map(g => g.channel ?? 'all'))) {
    const inChannel = groundTruth.filter(g => (g.channel ?? 'all') === channel);
    recallByChannel[channel] = inChannel.filter(g => !missed.has(g.value_id)).length / inChannel.length;
  }

  // A redaction is "on PII" when it covers at least one ground-truth value. Coverage
  // redactions over a region that held nothing sensitive are the false positives —
  // they are the price of explain-or-redact and the report states it rather than
  // excusing it.
  const redactionsOnPii = redactedRects.filter(r => groundTruth.some(g => overlaps(r, g.rect))).length;

  const piiRecall = groundTruth.length === 0 ? 1 : recalled / groundTruth.length;

  return {
    total: groundTruth.length,
    recalled,
    piiRecall,
    redactionRecall: piiRecall,
    redactionPrecision: redactedRects.length === 0 ? 1 : redactionsOnPii / redactedRects.length,
    redactionsTotal: redactedRects.length,
    redactionsOnPii,
    leaked: leakedValueIds.length,
    leakageRate: groundTruth.length === 0 ? 0 : leakedValueIds.length / groundTruth.length,
    leakedValueIds,
    missedValueIds,
    tier1Exposed: tier1ExposedValueIds.length,
    tier1ExposedValueIds,
    recallByChannel,
  };
}

/** Every handle the payload uses, in order of first appearance. */
const HANDLE_RE = /⟦[A-Z_]+(?:#\d+)?⟧/g;

export interface HandleConsistencyScore {
  declared: number;
  referenced: number;
  /** Used in the payload text but absent from `handles[]` — the agent sees a symbol
   *  it cannot resolve, which is a broken reference, not a privacy win. */
  dangling: string[];
  /** Declared but never used. Harmless, but it inflates the handle inventory. */
  unreferenced: string[];
  /** One handle carrying two different types across the payloads: a collision. */
  collisions: string[];
  /** Identical input, identical session → identical handle assignment. */
  stableAcrossRuns: boolean;
  consistent: boolean;
}

/**
 * Referential consistency of the handle namespace. Two properties, both checkable
 * from payloads alone, so this never needs — and never gets — a raw value:
 *
 *   1. every handle referenced in the payload is declared in `handles[]`, and each
 *      handle carries exactly one type;
 *   2. re-running the same input in the same session reproduces the same assignment,
 *      so an agent that says "the value in ⟦PHONE#3⟧" means the same thing twice.
 *
 * Pass one payload to check (1) alone; pass repeated runs of the same input to
 * check both.
 */
export function scoreHandleConsistency(payloads: unknown[]): HandleConsistencyScore {
  const typesByHandle = new Map<string, Set<string>>();
  const declaredAll = new Set<string>();
  const referencedAll = new Set<string>();
  const signatures: string[] = [];

  for (const payload of payloads) {
    const p = payload as { handles?: Array<{ handle: string; type: string }> };
    const declared = new Set((p.handles ?? []).map(h => h.handle));
    const referenced = new Set(JSON.stringify(payload).match(HANDLE_RE) ?? []);

    for (const h of declared) declaredAll.add(h);
    for (const h of referenced) referencedAll.add(h);
    for (const h of p.handles ?? []) {
      if (!typesByHandle.has(h.handle)) typesByHandle.set(h.handle, new Set());
      typesByHandle.get(h.handle)!.add(h.type);
    }

    signatures.push([...declared].sort().join(',') + '|' + [...referenced].sort().join(','));
  }

  const dangling = [...referencedAll].filter(h => !declaredAll.has(h)).sort();
  const unreferenced = [...declaredAll].filter(h => !referencedAll.has(h)).sort();
  const collisions = [...typesByHandle].filter(([, types]) => types.size > 1).map(([h]) => h).sort();
  const stableAcrossRuns = new Set(signatures).size <= 1;

  return {
    declared: declaredAll.size,
    referenced: referencedAll.size,
    dangling,
    unreferenced,
    collisions,
    stableAcrossRuns,
    consistent: dangling.length === 0 && collisions.length === 0 && stableAcrossRuns,
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
