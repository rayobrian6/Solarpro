/** @type {import('next').NextConfig} */

// Read build version directly — lib/version.ts is TypeScript so we parse it manually
const fs = require('fs');
const versionFile = fs.readFileSync('./lib/version.ts', 'utf8');
const versionMatch = versionFile.match(/BUILD_VERSION\s*=\s*'([^']+)'/);
const BUILD_VERSION = versionMatch ? versionMatch[1] : 'unknown';

// ── Build-time environment variable validation ────────────────────────────────
// Runs during `next build` on Vercel and in CI.
// POLICY (v47.41): Build NEVER aborts due to missing env vars — warnings only.
// Enforcement is runtime-only via getDatabaseUrl()/getJwtSecret() in lib/env.ts.
//
// REQUIRED at runtime (warn at build, throw at first use if missing):
//   DATABASE_URL  — used by DB queries in all API routes
//   JWT_SECRET    — used by auth middleware and session handling
//
// RECOMMENDED (warning only — build still succeeds):
//   OPENAI_API_KEY, GOOGLE_MAPS_API_KEY, RESEND_API_KEY, NEXT_PUBLIC_BASE_URL
//
// Check /api/system/env after deployment to inspect env var status.
// ─────────────────────────────────────────────────────────────────────────────
(function validateBuildEnv() {
  // ── Build-time env validation ──────────────────────────────────────────────
  // POLICY (v47.41):
  //   - NEVER call process.exit() here. A failed build prevents deployment
  //     even when env vars are configured correctly on Vercel (e.g. the var
  //     is set in Vercel's UI but not in the local .env.local used for CI).
  //   - Log WARNINGS for missing required vars so they appear in build output.
  //   - Actual enforcement happens at RUNTIME inside lib/auth.ts, lib/db.ts,
  //     and route handlers via getDatabaseUrl() / getJwtSecret() which throw
  //     with clear messages on first use if vars are absent.
  // ──────────────────────────────────────────────────────────────────────────

  // Skip in test environment — stubs are provided by the test runner
  if (process.env.NODE_ENV === 'test') return;

  const REQUIRED    = ['DATABASE_URL', 'JWT_SECRET'];
  const RECOMMENDED = ['OPENAI_API_KEY', 'GOOGLE_MAPS_API_KEY', 'RESEND_API_KEY', 'NEXT_PUBLIC_BASE_URL'];

  const VAR_DESCRIPTIONS = {
    DATABASE_URL:          'Neon PostgreSQL connection string (postgresql://...)',
    JWT_SECRET:            'Random 32+ character secret for JWT session signing',
    OPENAI_API_KEY:        'OpenAI key for AI bill extraction (sk-...)',
    GOOGLE_MAPS_API_KEY:   'Google Maps key for geocoding + utility rate detection',
    RESEND_API_KEY:        'Resend key for transactional email (re_...)',
    NEXT_PUBLIC_BASE_URL:  'Production base URL, e.g. https://solarpro-v31.vercel.app',
  };

  // Check required vars (warn only — do NOT exit)
  const missingRequired = REQUIRED.filter(v =>
    !process.env[v] || process.env[v] === 'YOUR_NEON_DATABASE_URL_HERE'
  );

  if (missingRequired.length > 0) {
    console.warn('');
    console.warn('[BUILD] ⚠️  ─────────────────────────────────────────────────────────');
    console.warn('[BUILD] ⚠️  MISSING REQUIRED ENVIRONMENT VARIABLES (build continues)');
    console.warn('[BUILD] ⚠️  ─────────────────────────────────────────────────────────');
    console.warn(`[BUILD] ⚠️  Missing: ${missingRequired.join(', ')}`);
    console.warn('[BUILD] ⚠️  These vars are required at RUNTIME. The app will boot');
    console.warn('[BUILD] ⚠️  but DB/auth operations will throw descriptive errors.');
    console.warn('[BUILD] ⚠️  Fix: Vercel → Project → Settings → Environment Variables');
    missingRequired.forEach(v => {
      console.warn(`[BUILD] ⚠️    ${v.padEnd(26)} — ${VAR_DESCRIPTIONS[v] || 'Required'}`);
    });
    console.warn('[BUILD] ⚠️  ─────────────────────────────────────────────────────────');
    console.warn('');
  }

  // Check recommended vars (warn only)
  const missingRecommended = RECOMMENDED.filter(v => {
    const val = process.env[v];
    return !val || val === 're_YOUR_RESEND_API_KEY_HERE' || val === 'YOUR_GOOGLE_MAPS_KEY_HERE';
  });

  if (missingRecommended.length > 0) {
    console.warn(
      `[BUILD] ⚠️  Recommended vars not set: ${missingRecommended.join(', ')} — some features degraded`
    );
  }

  if (missingRequired.length === 0 && missingRecommended.length === 0) {
    console.log(`[BUILD] ✅ All environment variables present (BUILD_VERSION=${BUILD_VERSION})`);
  } else if (missingRequired.length === 0) {
    console.log(`[BUILD] ✅ Required env vars present. Warnings above for recommended vars (BUILD_VERSION=${BUILD_VERSION})`);
  } else {
    console.log(`[BUILD] ⚠️  Build continuing despite missing env vars — see warnings above (BUILD_VERSION=${BUILD_VERSION})`);
  }
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