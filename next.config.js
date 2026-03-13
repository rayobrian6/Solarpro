/** @type {import('next').NextConfig} */

// Read build version directly — lib/version.ts is TypeScript so we parse it manually
const fs = require('fs');
const versionFile = fs.readFileSync('./lib/version.ts', 'utf8');
const versionMatch = versionFile.match(/BUILD_VERSION\s*=\s*'([^']+)'/);
const BUILD_VERSION = versionMatch ? versionMatch[1] : 'unknown';

// ── Build-time environment variable validation ────────────────────────────────
// Runs during `next build` on Vercel and in CI.
// If any REQUIRED var is missing the build FAILS IMMEDIATELY with a clear message
// instead of deploying broken code that fails at runtime.
//
// REQUIRED at build time:
//   DATABASE_URL  — used by server components + API routes
//   JWT_SECRET    — used by auth middleware and session handling
//
// RECOMMENDED (warning only — build still succeeds):
//   OPENAI_API_KEY, GOOGLE_MAPS_API_KEY, RESEND_API_KEY, NEXT_PUBLIC_BASE_URL
//
// CI note: Provide stub values (see .github/workflows/ci.yml) to allow
// the build job to complete. Vercel must have real values set.
// ─────────────────────────────────────────────────────────────────────────────
(function validateBuildEnv() {
  // Skip validation in test environment — stubs are provided by the test runner
  if (process.env.NODE_ENV === 'test') return;

  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];
  const RECOMMENDED = ['OPENAI_API_KEY', 'GOOGLE_MAPS_API_KEY', 'RESEND_API_KEY', 'NEXT_PUBLIC_BASE_URL'];

  const missing = REQUIRED.filter(v => !process.env[v] || process.env[v] === 'YOUR_NEON_DATABASE_URL_HERE');

  if (missing.length > 0) {
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║         ENV VALIDATION FAILED — BUILD ABORTED               ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `Missing required environment variables: ${missing.join(', ')}`,
      '',
      'This build cannot proceed because critical environment variables are absent.',
      'A broken deployment would be worse than a failed build.',
      '',
      'To fix:',
      '  Vercel: Project → Settings → Environment Variables → add the missing vars',
      '  Local:  Add them to .env.local',
      '',
      ...missing.map(v => {
        const descriptions = {
          DATABASE_URL: '  DATABASE_URL  — Neon PostgreSQL connection string (postgresql://...)',
          JWT_SECRET:   '  JWT_SECRET    — Random 32+ character secret for JWT session signing',
        };
        return descriptions[v] || `  ${v}  — Required`;
      }),
      '',
    ];
    console.error(lines.join('\n'));
    // process.exit(1) terminates the build with a non-zero exit code,
    // which causes Vercel and GitHub Actions to mark the build as FAILED.
    process.exit(1);
  }

  // Warn about recommended vars (does NOT fail the build)
  const warned = RECOMMENDED.filter(v => {
    const val = process.env[v];
    return !val || val === 're_YOUR_RESEND_API_KEY_HERE';
  });
  if (warned.length > 0) {
    console.warn(
      `\n[BUILD] WARNING: Recommended env vars not set: ${warned.join(', ')}\n` +
      `  Some features will be degraded (email, geocoding, AI bill extraction).\n` +
      `  Add them to Vercel → Project → Settings → Environment Variables.\n`
    );
  }

  console.log(`[BUILD] ✅ Environment validation passed (BUILD_VERSION=${BUILD_VERSION})`);
})();

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
      'sharp',          // native bindings — must not be bundled by webpack
      'exif-reader',    // native EXIF parsing
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
      'sharp',
      'exif-reader',
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