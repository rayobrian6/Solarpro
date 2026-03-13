// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.25';
export const BUILD_DATE        = '2026-03-13';
export const BUILD_DESCRIPTION = 'v47.25: Fix bill parsing in production — skip WASM on Vercel, direct OpenAI Vision, maxDuration 60s';
export const BUILD_FEATURES    = [
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