import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

// Workspace packages resolve to TypeScript source, not dist. Vite compiles them with
// everything else, so the bundle never depends on build order or a stale dist — and
// packages/schema emits declarations only, so its zod schemas exist nowhere else.
const packages = path.resolve(__dirname, '../../packages');
export const workspaceAliases = [
  { find: /^@glasswall\/([^/]+)\/(.*)$/, replacement: `${packages}/$1/src/$2` },
  { find: /^@glasswall\/([^/]+)$/, replacement: `${packages}/$1/src/index.ts` },
];

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: { alias: workspaceAliases },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
