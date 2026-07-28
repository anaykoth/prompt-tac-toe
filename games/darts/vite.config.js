import { defineConfig } from 'vite';

// Built into the Next app's public/ so it ships with the same deploy.
// `base` must match the served path or the emitted asset URLs 404.
export default defineConfig({
  base: '/darts/',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    outDir: '../../public/darts',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
