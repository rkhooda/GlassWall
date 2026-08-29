import { describe, it, expect } from 'vitest';
import { generateNgrams, hasNgramOverlap, findNgramMatches } from './ngram';

describe('generateNgrams', () => {
  it('generates n-grams', () => {
    const ngrams = generateNgrams('abcdefgh', 3);
    expect(ngrams).toEqual(['abc', 'bcd', 'cde', 'def', 'efg', 'fgh']);
  });

  it('returns empty for short text', () => {
    expect(generateNgrams('ab', 3)).toEqual([]);
  });

  it('handles exact length', () => {
    expect(generateNgrams('abc', 3)).toEqual(['abc']);
  });
});

describe('hasNgramOverlap', () => {
  it('detects overlap', () => {
    expect(hasNgramOverlap('abcdefghijkl', ['cdefghij'], 8)).toBe(true);
  });

  it('detects partial secret', () => {
    const secret = 'sk_live_abcdefghijklmnopqrstuvwxyz';
    const truncated = secret.slice(0, 24);
    expect(hasNgramOverlap(truncated, [secret], 8)).toBe(true);
  });

  it('no overlap for unrelated', () => {
    expect(hasNgramOverlap('hello world', ['sk_live_abcdefghijklmnopqrstuvwxyz'], 8)).toBe(false);
  });

  it('handles short patterns', () => {
    expect(hasNgramOverlap('abcdefgh', ['abc'], 8)).toBe(false);
  });
});

describe('findNgramMatches', () => {
  it('finds matches with positions', () => {
    const matches = findNgramMatches('abcdefghijklmnop', ['cdefghij'], 8);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].pattern).toBe('cdefghij');
    expect(matches[0].position).toBe(2);
  });

  it('finds multiple matches', () => {
    const matches = findNgramMatches('abcdefghijklmnopqrstuvwxyz', ['cdefghij', 'mnopqrst'], 8);
    expect(matches.length).toBe(2);
  });
});