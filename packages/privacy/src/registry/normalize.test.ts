import { describe, it, expect } from 'vitest';
import { normalize, normalizeNumeric } from './normalize';

describe('normalize', () => {
  it('normalizes NFKC', () => {
    expect(normalize('ﬃ')).toBe('ffi');
    expect(normalize('ﬁ')).toBe('fi');
  });

  it('lowercases', () => {
    expect(normalize('HELLO')).toBe('hello');
    expect(normalize('Hello')).toBe('hello');
  });

  it('collapses whitespace', () => {
    expect(normalize('hello   world')).toBe('hello world');
    expect(normalize('hello\t\nworld')).toBe('hello world');
  });

  it('preserves @ for emails', () => {
    expect(normalize('rahul @ x.com')).toBe('rahul @ x.com');
    expect(normalize('rahul@x.com')).toBe('rahul@x.com');
  });

  it('trims', () => {
    expect(normalize('  hello  ')).toBe('hello');
  });
});

describe('normalizeNumeric', () => {
  it('strips separators for numeric IDs', () => {
    expect(normalizeNumeric('123-456-789')).toBe('123456789');
    expect(normalizeNumeric('12 34 56')).toBe('123456');
    expect(normalizeNumeric('12.34.56')).toBe('123456');
  });
});

describe('normalize for emails', () => {
  it('handles rahul @ x.com case', () => {
    expect(normalize('rahul @ x.com')).toBe('rahul @ x.com');
    expect(normalize('rahul@x.com')).toBe('rahul@x.com');
  });
});