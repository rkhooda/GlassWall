import { defineConfig } from 'vitest/config';
import path from 'path';

const packages = path.resolve(__dirname, '../../packages');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    // Same rules as vite.config.ts: workspace packages resolve to source.
    alias: [
      { find: /^@glasswall\/([^/]+)\/(.*)$/, replacement: `${packages}/$1/src/$2` },
      { find: /^@glasswall\/([^/]+)$/, replacement: `${packages}/$1/src/index.ts` },
    ],
  },
});
