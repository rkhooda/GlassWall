import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

// Workspace packages resolve to TypeScript source so the bundle never depends on a
// stale dist and zod schemas exist at runtime.
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
    rollupOptions: {
      // Pages that the manifest does not reference directly.
      input: { offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.html') },
    },
  },
});
