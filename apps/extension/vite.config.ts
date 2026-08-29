import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@glasswall/privacy': path.resolve(__dirname, '../../packages/privacy/dist/index.js'),
      '@glasswall/schema': path.resolve(__dirname, '../../packages/schema/dist/index.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
