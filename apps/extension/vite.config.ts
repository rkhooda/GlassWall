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

// GLASSWALL_EVAL_BUILD=1 produces dist-eval: the same code with <all_urls>, so the
// Playwright harness can capture screenshots without a toolbar click. The shipped
// manifest keeps activeTab + an optional per-site permission requested on Start.
const unsafeBuild = process.env.GLASSWALL_UNSAFE_PASSTHROUGH === '1';
const evalBuild = process.env.GLASSWALL_EVAL_BUILD === '1' || unsafeBuild;
const effectiveManifest = evalBuild
  ? { ...manifest, name: `${manifest.name} (${unsafeBuild ? 'UNSAFE negative control' : 'eval build'})`, host_permissions: [...manifest.host_permissions, '<all_urls>'] }
  : manifest;

export default defineConfig({
  plugins: [react(), crx({ manifest: effectiveManifest })],
  resolve: { alias: workspaceAliases },
  // The negative control compiles the unsafe path in; every other build compiles it out.
  define: { __GW_UNSAFE_PASSTHROUGH__: JSON.stringify(unsafeBuild) },
  build: {
    outDir: unsafeBuild ? 'dist-unsafe' : evalBuild ? 'dist-eval' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Pages that the manifest does not reference directly.
      input: { offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.html') },
    },
  },
});
