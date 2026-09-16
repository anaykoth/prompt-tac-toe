import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// Dev-only wire harness for the jousting live layer: `npx vite -c games/shared/harness/vite.config.js`
// with `next dev -p 3111` running alongside. Never part of the production build.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:3111' } },
});
