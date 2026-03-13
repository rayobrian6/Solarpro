// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.27';
export const BUILD_DATE        = '2026-03-13';
export const BUILD_DESCRIPTION = 'v47.27: ToS server-side enforcement (TOS_REQUIRED 400), tos_ip audit field, auth fix';
export const BUILD_FEATURES    = [
  // v47.27 -- ToS enforcement + auth fixes
  'TOS: register route — 400 TOS_REQUIRED enforced server-side if tosAccepted not true',
  'TOS: register route — captures x-forwarded-for IP as tos_ip at signup',
  'TOS: tos-accept POST — captures IP at /terms page acceptance too',
  'TOS: migration 010 — tos_ip TEXT column added',
  'AUTH: login SELECT reverted to base columns — no tos_* fields (removed information_schema overhead)',
  'AUTH: tos-accept GET — simple try/catch on column error instead of catalog scan',
  // v47.26 -- ToS/NDA integration
  'TOS: Migration 010 — users.tos_accepted_at (TIMESTAMPTZ) + users.tos_version (TEXT) columns',
  'TOS: /api/tos-accept POST — records acceptance with timestamp and version (JWT auth required)',
  'TOS: /api/tos-accept GET  — returns acceptance status, version, needs_reaccept flag',
  'TOS: /app/terms/page.tsx — full ToS/NDA text, accept button, already-accepted badge',
  'TOS: /terms?required=1 — mandatory acceptance gate with warning banner',
  'TOS: Register page — ToS checkbox now links to /terms, passes tosAccepted to API',
  'TOS: Register API — records tos_accepted_at=NOW() and tos_version=v1.0 on INSERT',
  'TOS: Login API — returns tos_redirect hint if user has not yet accepted',
  'TOS: Login page — follows tos_redirect from login response before going to dashboard',
  'TOS: middleware.ts — /terms and /api/tos-accept added to PUBLIC_PATHS',
  'TOS: lib/migrations/010_tos_acceptance.sql — standalone SQL migration file',
  'TOS: /api/migrate — Migration 010 blocks (ALTER TABLE + index) added',
  // v47.25 -- Production bill parsing fix
  'OCR: extractImageTextSmart() — Stage 1b (Tesseract.js WASM HTTP) now SKIPPED on Vercel',
  'OCR: Vercel detection via process.env.VERCEL || VERCEL_ENV || VERCEL_URL',
  'OCR: On Vercel: CLI attempt (fails) -> direct OpenAI Vision (~5s) — saves 20s WASM timeout',
  'OCR: On local dev: CLI attempt -> WASM HTTP fallback -> OpenAI Vision (unchanged behavior)',
  'OCR: [OCR_SKIPPED] log marker when stage=1b is bypassed for observability',
  'PDF: extractPdfText() — pdftotext CLI now SKIPPED on Vercel (binary not available)',
  'PDF: On Vercel: pdf-parse npm -> extractPdfTextPure -> pdfjs-dist -> OpenAI Files API -> Google Vision',
  'PDF: On local dev: pdftotext CLI -> pdf-parse -> pure extract -> ... (unchanged)',
  'PDF: [PDF_PARSE_STARTED] method=pdftotext now logs isVercel=true/false for observability',
  'PERF: maxDuration increased 30s -> 60s on bill-upload route for OpenAI Vision headroom',
  'PERF: Production bill parsing now completes in ~8-12s (was timing out at 30s)',
  'ROOT_CAUSE: Tesseract CLI binary not available on Vercel serverless Lambda',
  'ROOT_CAUSE: WASM cold start downloads ~400MB, easily exceeds budget before Vision could run',
  'ROOT_CAUSE: dangling fetch in Stage 1b was blocking Stage 2 Vision even after timeout',
  'TEST: TypeScript clean (tsc --noEmit: 0 errors)',
  'TEST: 67/67 vitest tests passing',
  // v47.24 -- Full runtime declaration fix
  'RUNTIME: export const runtime = "nodejs" added to all 102 API routes (96 were missing)',
  'RUNTIME: app/api/bill-upload/route.ts — critical fix: was missing runtime, may have run as Edge',
  'RUNTIME: app/api/system-size/route.ts — critical fix: was missing runtime, may have run as Edge',
  // v47.23 -- Production stabilization
  'AUTH: All 13 log markers added across login/me/middleware routes',
  'BILL: POST /api/debug/bill pipeline trace endpoint',
  'RATE: [RATE_PRIORITY_DECISION] log in system-size route',
  'TEST: tests/auth-health.test.ts — 33 new vitest tests',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}