import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@glasswall/schema': path.resolve(__dirname, '../schema/src'),
      '@glasswall/perception': path.resolve(__dirname, '../perception/src'),
      '@glasswall/privacy': path.resolve(__dirname, './src'),
    },
  },
});