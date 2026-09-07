import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken. Vite otherwise slides to the next free port while
    // the harness, DEMO.md and the extension's allowlist all still point at 5173 —
    // which means driving the agent against whatever else answers there.
    strictPort: true,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
