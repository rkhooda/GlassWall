/**
 * Detection metrics for the local perception sources.
 *
 * Span F1 scores NER against a labelled set; character accuracy scores OCR
 * against known crop text. Both are pure functions so the harness, the unit
 * tests and CI all compute the same number.
 */

export interface LabelledSpan {
  start: number;
  end: number;
  type: string;
}

export interface PrfScore {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

/**
 * Span-level P/R/F1. A prediction matches a gold span when the type agrees and
 * the character overlap reaches `minOverlap` of the union (IoU) — exact-boundary
 * the benchmark penalizes a tokenizer for including a trailing period, which tells us
 * nothing about whether the name was found.
 */
export function spanF1(
  predicted: LabelledSpan[],
  gold: LabelledSpan[],
  minOverlap = 0.5
): PrfScore {
  const unmatched = [...gold];
  let truePositives = 0;

  for (const p of predicted) {
    const i = unmatched.findIndex(g => g.type === p.type && spanIou(p, g) >= minOverlap);
    if (i >= 0) {
      truePositives++;
      unmatched.splice(i, 1);
    }
  }

  const falsePositives = predicted.length - truePositives;
  const falseNegatives = unmatched.length;
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, truePositives, falsePositives, falseNegatives };
}

/**
 * Per-type precision, recall and F1. Types are taken from the union of gold and
 * predicted, so a type the model hallucinates and gold never contains still shows
 * up — at precision 0, which is the point.
 */
export function prfByType(
  predicted: LabelledSpan[],
  gold: LabelledSpan[],
  minOverlap = 0.5
): Record<string, PrfScore> {
  const types = new Set([...gold, ...predicted].map(s => s.type));
  const out: Record<string, PrfScore> = {};
  for (const type of types) {
    out[type] = spanF1(
      predicted.filter(p => p.type === type),
      gold.filter(g => g.type === type),
      minOverlap
    );
  }
  return out;
}

/** Per-type recall — the P8 criterion names PERSON_NAME and STREET_ADDRESS. */
export function recallByType(predicted: LabelledSpan[], gold: LabelledSpan[]): Record<string, number> {
  return Object.fromEntries(Object.entries(prfByType(predicted, gold)).map(([t, s]) => [t, s.recall]));
}

export interface NearMiss {
  value: string;
  type: string;
}

export interface NearMissScore {
  total: number;
  falsePositives: number;
  /** Fraction of decoys the detector wrongly flagged. Lower is better; 0 is the goal. */
  rate: number;
  byType: Record<string, { total: number; falsePositives: number; rate: number }>;
  flaggedValueTypes: string[];
}

/**
 * False-positive rate against the seeded decoys — values shaped exactly like the
 * real thing but failing their checksum (an Aadhaar that fails Verhoeff, a card
 * that fails Luhn, a PAN with a bad final letter).
 *
 * A regex that matches these has learned the shape and not the identifier, and a
 * detector that redacts every order number is one nobody will leave switched on.
 * This is the number that keeps precision honest when recall is being pushed up.
 */
export function nearMissFalsePositiveRate(
  decoys: NearMiss[],
  flagged: (decoy: NearMiss) => boolean
): NearMissScore {
  const byType: NearMissScore['byType'] = {};
  const flaggedValueTypes: string[] = [];

  for (const decoy of decoys) {
    const bucket = (byType[decoy.type] ??= { total: 0, falsePositives: 0, rate: 0 });
    bucket.total++;
    if (flagged(decoy)) {
      bucket.falsePositives++;
      flaggedValueTypes.push(decoy.type);
    }
  }
  for (const bucket of Object.values(byType)) bucket.rate = ratio(bucket.falsePositives, bucket.total);

  const falsePositives = flaggedValueTypes.length;
  return {
    total: decoys.length,
    falsePositives,
    rate: ratio(falsePositives, decoys.length),
    byType,
    flaggedValueTypes: [...new Set(flaggedValueTypes)].sort(),
  };
}

function spanIou(a: LabelledSpan, b: LabelledSpan): number {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (overlap <= 0) return 0;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union === 0 ? 0 : overlap / union;
}

/** Levenshtein distance / reference length. 0 is perfect. */
export function characterErrorRate(predicted: string, reference: string): number {
  if (reference.length === 0) return predicted.length === 0 ? 0 : 1;
  return levenshtein(predicted, reference) / reference.length;
}

/** 1 - CER, clamped to [0, 1]. The P9 criterion is stated as accuracy ≥0.90. */
export function characterAccuracy(predicted: string, reference: string): number {
  return Math.max(0, 1 - characterErrorRate(predicted, reference));
}

function levenshtein(a: string, b: string): number {
  // Two rows instead of a full matrix: the crops are short but there are many.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
