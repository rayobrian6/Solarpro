/** @type {import('next').NextConfig} */

// Read build version directly — lib/version.ts is TypeScript so we parse it manually
const fs = require('fs');
const versionFile = fs.readFileSync('./lib/version.ts', 'utf8');
const versionMatch = versionFile.match(/BUILD_VERSION\s*=\s*'([^']+)'/);
const BUILD_VERSION = versionMatch ? versionMatch[1] : 'unknown';

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION,
  },
  experimental: {
    // Optional server-only packages — skip webpack bundling, resolved at runtime
    serverComponentsExternalPackages: [
      'pdf2pic', 'openai', 'pdf-parse', 'pdfjs-dist',
      'tesseract.js', 'tesseract.js-core',
    ],
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
      'tesseract.js',
      'tesseract.js-core',
    ];
    return config;
  },
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