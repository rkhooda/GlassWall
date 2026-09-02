export function normalize(value: string): string {
  let result = value.normalize('NFKC');
  result = result.toLowerCase();
  result = result.replace(/\s+/g, ' ');
  result = result.trim();
  return result;
}

export function normalizeForComparison(value: string): string {
  return normalize(value);
}

export function normalizeNumeric(value: string): string {
  return normalize(value).replace(/[\s.-]/g, '');
}