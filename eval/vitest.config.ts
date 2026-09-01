import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Only the Playwright-driven suites are excluded — they need a browser and a
    // running bench site, and Playwright owns its own runner. leakage/chaos.test.ts
    // is pure sanitize() and belongs here, where it runs on every commit.
    exclude: ['node_modules/**', 'dist/**', 'leakage/negative-control.test.ts'],
  },
  resolve: {
    alias: {
      '@glasswall/schema': path.resolve(__dirname, '../packages/schema/src'),
      '@glasswall/perception': path.resolve(__dirname, '../packages/perception/src'),
      '@glasswall/privacy': path.resolve(__dirname, '../packages/privacy/src'),
    },
  },
});
