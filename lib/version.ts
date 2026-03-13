// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.24';
export const BUILD_DATE        = '2026-03-13';
export const BUILD_DESCRIPTION = 'v47.24: Full runtime fix -- export const runtime = "nodejs" added to all 102 API routes';
export const BUILD_FEATURES    = [
  // v47.24 -- Full runtime declaration fix
  'RUNTIME: export const runtime = "nodejs" added to all 102 API routes (96 were missing)',
  'RUNTIME: app/api/bill-upload/route.ts -- critical fix: was missing runtime, may have run as Edge',
  'RUNTIME: app/api/system-size/route.ts -- critical fix: was missing runtime, may have run as Edge',
  'RUNTIME: app/api/auth/logout/route.ts + app/api/auth/register/route.ts + app/api/auth/debug-login/route.ts fixed',
  'RUNTIME: app/api/health/database/route.ts + app/api/health/route.ts fixed',
  'RUNTIME: All 21 admin routes fixed (activity-log, companies, users, stats, impersonate, etc.)',
  'RUNTIME: All 20 engineering routes fixed (structural, bom, calculate, generate, pvwatts, etc.)',
  'RUNTIME: All project/proposal/client/bill routes fixed',
  'RUNTIME: stripe/webhook, stripe/checkout, stripe/portal fixed',
  'RUNTIME: scripts/add_runtime_nodejs.py -- script to maintain runtime declarations',
  'RUNTIME: Without runtime = "nodejs", Vercel may select Edge runtime which cannot use child_process, bcrypt, Neon serverless, Tesseract, pdftotext',
  'RUNTIME: TypeScript clean (tsc --noEmit: 0 errors)',
  'TEST: 67/67 tests passing (auth-health + bill-upload suites unaffected)',
  // v47.23 -- Production stabilization: auth + bill pipeline + testing
  'AUTH: [AUTH_LOGIN_SUCCESS] log added to login route -- confirms successful login with userId+email',
  'AUTH: [AUTH_LOGIN_FAILURE] log added to all failure paths in login route -- no-cookie, bad password, DB error',
  'AUTH: [AUTH_COOKIE_PRESENT] / [AUTH_COOKIE_MISSING] logs added to login and me routes -- tracks session cookie presence',
  'AUTH: [DATABASE_URL_PRESENT] log added to login and me routes at request entry -- cold-start env visibility',
  'AUTH: [JWT_SECRET_PRESENT] log added to login and me routes at request entry -- cold-start env visibility',
  'AUTH: [AUTH_MIDDLEWARE_BYPASS] log added to middleware.ts -- logs path + reason (public_path or valid_session+userId)',
  'AUTH: [AUTH_MIDDLEWARE_BLOCKED] log added to middleware.ts -- logs path + reason + hasCookie on 401/redirect',
  'BILL: POST /api/debug/bill created -- auth-protected pipeline trace endpoint',
  'RATE: [RATE_PRIORITY_DECISION] log added to system-size route -- logs priority_source + all candidate rates',
  'TEST: tests/auth-health.test.ts -- 33 new vitest tests covering auth system health',
  'TEST: All 67 tests in tests/bill-upload.test.ts + tests/auth-health.test.ts passing',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}