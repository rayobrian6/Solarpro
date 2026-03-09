/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Optional server-only packages — skip webpack bundling, resolved at runtime
    serverComponentsExternalPackages: ['pdf2pic', 'openai', 'pdf-parse', 'pdfjs-dist'],
  },
  images: {
    remotePatterns: [
      { hostname: 'api.mapbox.com' },
      { hostname: 'maps.googleapis.com' },
    ],
  },
  webpack: (config) => {
    config.externals = [
      ...(config.externals || []),
      { canvas: 'canvas' },
      // Optional runtime deps — not bundled by webpack
      'pdf2pic',
      'openai',
      'pdf-parse',
      'pdfjs-dist',
    ];
    return config;
  },
  // Add empty turbopack config to allow webpack config to work with Next.js 16
  turbopack: {},
  // Force unique build ID on every deploy to bust CDN/browser cache
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
  // Add no-cache headers to all pages
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;