/** @type {import('next').NextConfig} */
const nextConfig = {
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
