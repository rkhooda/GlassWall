import { describe, it, expect } from 'vitest';
// We need to dynamically import the flag to avoid compile-time issues
// when the stub is deleted (the flag might be moved or removed)

describe('sanitize.stub.ts safety check', () => {
  it('should fail if USE_REAL_SANITIZER is true while stub exists', async () => {
    // Dynamically import to avoid issues when stub is deleted
    const { USE_REAL_SANITIZER } = await import('../shared/flags');

    // This test should pass when USE_REAL_SANITIZER is false (stub is valid)
    // And fail when USE_REAL_SANITIZER is true (indicating stub should be deleted)
    expect(USE_REAL_SANITIZER).toBe(false);
  });
});