import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // leakage/ is driven by Playwright, which owns its own runner.
    exclude: ['node_modules/**', 'dist/**', 'leakage/**'],
  },
  resolve: {
    alias: {
      '@glasswall/schema': path.resolve(__dirname, '../packages/schema/src'),
      '@glasswall/perception': path.resolve(__dirname, '../packages/perception/src'),
      '@glasswall/privacy': path.resolve(__dirname, '../packages/privacy/src'),
    },
  },
});
