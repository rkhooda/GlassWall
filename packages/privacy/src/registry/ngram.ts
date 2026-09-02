export function generateNgrams(text: string, n = 8): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.push(text.slice(i, i + n));
  }
  return ngrams;
}

export function hasNgramOverlap(text: string, patterns: string[], n = 8): boolean {
  const textNgrams = new Set(generateNgrams(text, n));
  for (const pattern of patterns) {
    if (pattern.length < n) continue;
    const patternNgrams = generateNgrams(pattern, n);
    for (const ngram of patternNgrams) {
      if (textNgrams.has(ngram)) {
        return true;
      }
    }
  }
  return false;
}

export function findNgramMatches(text: string, patterns: string[], n = 8): { pattern: string; ngram: string; position: number }[] {
  const matches: { pattern: string; ngram: string; position: number }[] = [];
  const textNgrams = new Map<string, number[]>();

  for (let i = 0; i <= text.length - n; i++) {
    const ngram = text.slice(i, i + n);
    if (!textNgrams.has(ngram)) {
      textNgrams.set(ngram, []);
    }
    textNgrams.get(ngram)!.push(i);
  }

  for (const pattern of patterns) {
    if (pattern.length < n) continue;
    const patternNgrams = generateNgrams(pattern, n);
    for (const ngram of patternNgrams) {
      const positions = textNgrams.get(ngram);
      if (positions) {
        for (const pos of positions) {
          matches.push({ pattern, ngram, position: pos });
        }
      }
    }
  }

  return matches;
}