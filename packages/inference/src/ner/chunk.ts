/**
 * Pure span logic for NER: chunking, cross-chunk merging, span -> text-node mapping.
 * No model, no browser, no I/O — so every acceptance test here runs offline.
 */

export interface Span {
  start: number;
  end: number;
  type: string;
  confidence: number;
}

export interface TextChunk {
  /** Chunk text, sliced from the source. */
  text: string;
  /** Character offset of `text` inside the source. */
  offset: number;
}

export const MAX_TOKENS = 512;
export const OVERLAP_TOKENS = 64;

// ponytail: whitespace words stand in for model tokens. Wordpiece splits some words
// into several tokens, so a chunk can exceed maxTokens and the model truncates it —
// the 64-word overlap is wide enough to re-cover anything a truncation drops.
// Swap in the tokenizer's own count if a truncation ever loses an entity.
export function chunkText(
  text: string,
  maxTokens: number = MAX_TOKENS,
  overlapTokens: number = OVERLAP_TOKENS
): TextChunk[] {
  const words: [number, number][] = [];
  for (const m of text.matchAll(/\S+/g)) {
    words.push([m.index, m.index + m[0].length]);
  }
  if (words.length === 0) return [];
  if (words.length <= maxTokens) return [{ text, offset: 0 }];

  const step = Math.max(1, maxTokens - overlapTokens);
  const chunks: TextChunk[] = [];
  for (let i = 0; i < words.length; i += step) {
    const start = words[i]![0];
    const end = words[Math.min(i + maxTokens, words.length) - 1]![1];
    chunks.push({ text: text.slice(start, end), offset: start });
    if (i + maxTokens >= words.length) break;
  }
  return chunks;
}

/**
 * Merge spans that overlap, touch, or sit one character apart and share a type.
 * This is what makes an entity straddling a chunk boundary come back as one span:
 * the two chunks each see a fragment, and the fragments join here.
 */
export function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [{ ...sorted[0]! }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (current.type === last.type && current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
      last.confidence = Math.max(last.confidence, current.confidence);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Chunk, run the model per chunk, lift each chunk's spans back into source
 * coordinates, then merge. `run` is injected so the orchestration is testable
 * without model weights.
 */
export async function chunkedNer(
  text: string,
  run: (chunk: string) => Promise<Span[]>,
  opts: { maxTokens?: number; overlapTokens?: number; threshold?: number } = {}
): Promise<Span[]> {
  const threshold = opts.threshold ?? 0;
  const chunks = chunkText(text, opts.maxTokens ?? MAX_TOKENS, opts.overlapTokens ?? OVERLAP_TOKENS);

  const lifted: Span[] = [];
  for (const chunk of chunks) {
    for (const span of await run(chunk.text)) {
      if (span.confidence < threshold) continue;
      lifted.push({ ...span, start: span.start + chunk.offset, end: span.end + chunk.offset });
    }
  }
  return mergeSpans(lifted);
}

export interface TextRange {
  id: string;
  rect: [number, number, number, number];
  start: number;
  end: number;
}

/**
 * Concatenate text nodes and record where each one landed. Producing the text and
 * the offsets together is deliberate — a separate offset calculation is the classic
 * way span->node mapping silently drifts.
 */
export function joinTextNodes(
  nodes: { id: string; text: string; rect: [number, number, number, number] }[],
  separator = ' '
): { text: string; ranges: TextRange[] } {
  const ranges: TextRange[] = [];
  let text = '';

  for (const node of nodes) {
    if (text.length > 0) text += separator;
    const start = text.length;
    text += node.text;
    ranges.push({ id: node.id, rect: node.rect, start, end: text.length });
  }
  return { text, ranges };
}

/** Map source-coordinate spans back to per-node local offsets, clipped at node edges. */
export function mapSpansToRanges(
  spans: Span[],
  ranges: TextRange[]
): { id: string; rect: [number, number, number, number]; spans: Span[] }[] {
  const out: { id: string; rect: [number, number, number, number]; spans: Span[] }[] = [];

  for (const range of ranges) {
    const local: Span[] = [];
    for (const span of spans) {
      if (span.start >= range.end || span.end <= range.start) continue;
      const start = Math.max(0, span.start - range.start);
      const end = Math.min(range.end - range.start, span.end - range.start);
      if (start < end) local.push({ ...span, start, end });
    }
    if (local.length > 0) out.push({ id: range.id, rect: range.rect, spans: local });
  }
  return out;
}

/** One wordpiece prediction, the shape transformers.js actually returns. */
export interface TokenPrediction {
  entity: string;
  score: number;
  word: string;
}

/**
 * Turn per-wordpiece predictions into character spans.
 *
 * Transformers.js does not implement `aggregation_strategy` and returns no
 * character offsets, so both the grouping and the offsets are done here:
 * BIO tags plus `##` continuations give the entity boundaries, and the
 * reconstructed surface form is located in the source text.
 */
export function spansFromTokens(text: string, tokens: TokenPrediction[]): Span[] {
  const groups: Array<{ type: string; pieces: string[]; scores: number[] }> = [];

  for (const token of tokens) {
    const type = token.entity.replace(/^[BI]-/, '');
    const current = groups[groups.length - 1];
    const continues =
      current !== undefined &&
      current.type === type &&
      (token.word.startsWith('##') || token.entity.startsWith('I-'));

    if (continues) {
      current.pieces.push(token.word);
      current.scores.push(token.score);
    } else {
      groups.push({ type, pieces: [token.word], scores: [token.score] });
    }
  }

  const spans: Span[] = [];
  let cursor = 0;

  for (const group of groups) {
    const found = locate(text, group.pieces, cursor);
    if (!found) continue;
    spans.push({
      start: found.start,
      end: found.end,
      type: group.type,
      confidence: group.scores.reduce((a, b) => a + b, 0) / group.scores.length,
    });
    cursor = found.end;
  }

  return spans;
}

/**
 * Find the wordpieces in the source text from `from` onward. Pieces are matched
 * with flexible whitespace rather than by rebuilding a string, because the
 * detokenized form does not always reproduce the original spacing.
 */
function locate(text: string, pieces: string[], from: number): { start: number; end: number } | null {
  const pattern = pieces
    .map((piece, i) => {
      const literal = escapeRegExp(piece.replace(/^##/, ''));
      const gap = i === 0 || piece.startsWith('##') ? '' : '\\s*';
      return gap + literal;
    })
    .join('');

  const match = new RegExp(pattern, 'i').exec(text.slice(from));
  return match ? { start: from + match.index, end: from + match.index + match[0].length } : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
