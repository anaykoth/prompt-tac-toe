import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Dev-only proxy for the wanted-list wall.
 *
 * Two things force this: the agencies' APIs do not reliably send CORS headers,
 * and a photo drawn into a canvas from another origin taints it, which makes
 * the canvas unusable as a WebGL texture. Proxying both through the dev server
 * makes everything same-origin. A real deployment wants the same three routes
 * as serverless functions.
 */
function wantedProxy() {
  return {
    name: 'wanted-proxy',
    configureServer(server) {
      const pass = async (res, url, type) => {
        try {
          const upstream = await fetch(url, {
            headers: { 'user-agent': 'fuzz-and-feather/0.1 (local dev)' },
          });
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.end(JSON.stringify({ error: `upstream ${upstream.status}` }));
            return;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('content-type', type || upstream.headers.get('content-type') || 'application/json');
          res.setHeader('cache-control', 'public, max-age=900');
          res.end(buf);
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(err) }));
        }
      };

      server.middlewares.use('/api/fbi', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        pass(res, `https://api.fbi.gov/wanted/v1/list${qs}`, 'application/json');
      });

      server.middlewares.use('/api/interpol', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        pass(res, `https://ws-public.interpol.int/notices/v1/red${qs}`, 'application/json');
      });

      // photos, so the canvas stays clean enough to upload as a texture
      server.middlewares.use('/api/img', (req, res) => {
        const u = new URL(req.url, 'http://localhost').searchParams.get('u');
        if (!u) { res.statusCode = 400; res.end('missing u'); return; }
        let target;
        try { target = new URL(u); } catch { res.statusCode = 400; res.end('bad url'); return; }
        // only ever fetch from the agencies themselves, never an arbitrary host
        const allowed = ['fbi.gov', 'interpol.int'];
        if (!allowed.some((h) => target.hostname === h || target.hostname.endsWith('.' + h))) {
          res.statusCode = 403;
          res.end('host not allowed');
          return;
        }
        pass(res, target.href);
      });
    },
  };
}

// index.html -> darts, pool.html -> the stable pool game,
// pool-lab.html -> the lab build where the new rooms are being tried out.
export default defineConfig({
  // js-aruco2 exports via top-level `this`, which modern bundlers treat as ESM
  // unless adapted. Leave the installed package intact for Node-based pose tests.
  plugins: [wantedProxy(), {
    name: 'aruco-esm', enforce: 'pre',
    transform(code, id) {
      if (!/\/js-aruco2\/src\/(aruco|posit1|cv|svd)\.js$/.test(id)) return;
      return code.replace(/var (CV|SVD) = this\.\1 \|\| require\('\.\/(cv|svd)'\)\.\1;/g, (_, name, file) => `import { ${name} } from './${file}.js';`)
        .replace(/this\.(AR|POS|CV|SVD) = \1;/g, (_, name) => `export { ${name} }; export default { ${name} };`);
    },
  }],
  optimizeDeps: { exclude: ['js-aruco2'] },
  server: {
    host: '127.0.0.1', port: 5173,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/health': { target: 'http://127.0.0.1:8787' },
      '/phone-ws': { target: 'ws://127.0.0.1:8790', ws: true },
      '/phone-config': { target: 'http://127.0.0.1:8790' },
      '/phone-takes': { target: 'http://127.0.0.1:8790' },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        darts: resolve(process.cwd(), 'index.html'),
        pool: resolve(process.cwd(), 'pool.html'),
        lab: resolve(process.cwd(), 'pool-lab.html'),
        pub: resolve(process.cwd(), 'pub.html'),
        hockey: resolve(process.cwd(), 'air-hockey.html'),
        baseball: resolve(process.cwd(), 'baseball.html'),
        mouseLab: resolve(process.cwd(), 'mouse-lab.html'),
        golf: resolve(process.cwd(), 'golf.html'),
        controller: resolve(process.cwd(), 'controller.html'),
      },
    },
  },
});
