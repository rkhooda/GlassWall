/**
 * Detection metrics for the perception sources (PLAN-B §6 P8/P9 acceptance).
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
 * scoring punishes a tokenizer for including a trailing period, which tells us
 * nothing about whether the name was found.
 */
export function spanF1(
  predicted: LabelledSpan[],
  gold: LabelledSpan[],
  minOverlap: number = 0.5
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

/** Per-type recall — the P8 criterion names PERSON_NAME and STREET_ADDRESS. */
export function recallByType(predicted: LabelledSpan[], gold: LabelledSpan[]): Record<string, number> {
  const types = new Set(gold.map(g => g.type));
  const out: Record<string, number> = {};
  for (const type of types) {
    out[type] = spanF1(
      predicted.filter(p => p.type === type),
      gold.filter(g => g.type === type)
    ).recall;
  }
  return out;
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
