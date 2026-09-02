import { describe, it, expect } from 'vitest';
import { createTokenizer, tokenizeAndRegister } from './tokenizer';
import type { SecretRegistry } from '@glasswall/schema/branded';

describe('tokenizeAndRegister', () => {
  it('issues one handle per value, whatever it is later classified as', () => {
    const tokenizer = createTokenizer('s');
    const registry: SecretRegistry = new Map();
    const first = tokenizeAndRegister(tokenizer, registry, 'Nagpur', 'CITY', 3);
    expect(tokenizeAndRegister(tokenizer, registry, 'nagpur', 'STREET_ADDRESS', 3)).toBe(first);
    expect(registry.size).toBe(1);
    expect(tokenizeAndRegister(tokenizer, registry, 'Mumbai', 'CITY', 3)).not.toBe(first);
  });
});
