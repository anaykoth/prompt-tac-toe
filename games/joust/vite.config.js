import { defineConfig } from 'vite';

// Built into the Next app's public/ so it ships with the same deploy.
// Shares puppet/crowd/render/audio/rng source with ../darts, so the dev
// server must be allowed to read outside this package root.
export default defineConfig({
  base: '/joust/',
  server: { host: true, port: 5174, fs: { allow: ['../..'] } },
  build: {
    target: 'es2022',
    outDir: '../../public/joust',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
