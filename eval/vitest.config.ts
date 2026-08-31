import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // leakage/ is driven by Playwright, which owns its own runner.
    exclude: ['node_modules/**', 'dist/**', 'leakage/**'],
  },
});
