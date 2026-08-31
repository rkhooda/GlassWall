import { describe, it, expect } from 'vitest';
import { generateEncodings } from './encodings';

describe('generateEncodings', () => {
  it('includes original value', () => {
    const encodings = generateEncodings('test@example.com');
    expect(encodings).toContain('test@example.com');
  });

  it('generates URL encoding (single)', () => {
    const encodings = generateEncodings('test@example.com');
    expect(encodings).toContain('test%40example.com');
  });

  it('generates URL encoding (double)', () => {
    const encodings = generateEncodings('test@example.com');
    expect(encodings).toContain('test%2540example.com');
  });

  it('generates base64 standard', () => {
    const encodings = generateEncodings('test@example.com');
    expect(encodings).toContain(btoa('test@example.com').toLowerCase());
  });

  it('generates base64 URL-safe', () => {
    const encodings = generateEncodings('test@example.com');
    const urlSafe = btoa('test@example.com').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').toLowerCase();
    expect(encodings).toContain(urlSafe);
  });

  it('generates hex', () => {
    const encodings = generateEncodings('AB');
    expect(encodings).toContain('4142');
  });

  it('generates HTML numeric entities', () => {
    const encodings = generateEncodings('A');
    expect(encodings).toContain('&#65;');
  });

  it('generates HTML named entities', () => {
    const encodings = generateEncodings('<>&');
    expect(encodings.some(e => e.includes('<'))).toBe(true);
    expect(encodings.some(e => e.includes('>'))).toBe(true);
    expect(encodings.some(e => e.includes('&'))).toBe(true);
  });

  it('generates JSON unicode escapes', () => {
    const encodings = generateEncodings('A');
    expect(encodings).toContain('\\\\u0041');
  });

  it('handles unicode', () => {
    const encodings = generateEncodings('café');
    expect(encodings.some(e => e.includes('caf'))).toBe(true);
  });

  it('no duplicates', () => {
    const encodings = generateEncodings('test');
    const unique = new Set(encodings);
    expect(encodings.length).toBe(unique.size);
  });
});