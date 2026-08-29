const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffCheckDigit(digits: number[]): number {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i] as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    c = D[c]![P[(i + 1) % 8]![digit]!]!;
  }
  return INV[c]!;
}

export function verifyVerhoeff(num: string): boolean {
  const digits = num.split('').map(Number);
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i] as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    c = D[c]![P[i % 8]![digit]!]!;
  }
  return c === 0;
}

export function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i]!;
    let nd = d;
    if (double) {
      nd *= 2;
      if (nd > 9) nd -= 9;
    }
    sum += nd;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function verifyLuhn(num: string): boolean {
  const digits = num.split('').map(Number);
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i]!;
    let nd = d;
    if (double) {
      nd *= 2;
      if (nd > 9) nd -= 9;
    }
    sum += nd;
    double = !double;
  }
  return sum % 10 === 0;
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_CHAR_TO_VAL: Record<string, number> = {};
for (let i = 0; i < GSTIN_CHARS.length; i++) {
  const ch = GSTIN_CHARS[i]!;
  GSTIN_CHAR_TO_VAL[ch] = i;
}
const GSTIN_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function gstinCheckChar(gstin14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const ch = gstin14[i]!;
    const val = GSTIN_CHAR_TO_VAL[ch]!;
    sum += val * GSTIN_WEIGHTS[i]!;
  }
  const checkVal = (36 - (sum % 36)) % 36;
  return GSTIN_CHARS[checkVal]!;
}

export function verifyGstin(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  return gstin[14]! === gstinCheckChar(gstin.slice(0, 14));
}

export function calculateShannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}