import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the tracing root to this repo: in a worktree under ~ Next otherwise picks
  // ~/package-lock.json as the workspace root and rebuilds on unrelated home writes.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The darts game is a static Vite build living in public/darts. Next serves
  // public/ files by exact path, so /darts on its own would 404 without this.
  async rewrites() {
    return [
      { source: '/darts', destination: '/darts/index.html' },
      { source: '/joust', destination: '/joust/index.html' },
    ];
  },
};

export default nextConfig;
