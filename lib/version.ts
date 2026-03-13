// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.23';
export const BUILD_DATE        = '2026-06-14';
export const BUILD_DESCRIPTION = 'v47.23: Production stabilization -- auth log markers, bill debug endpoint, rate priority logging, auth health tests';
export const BUILD_FEATURES    = [
  // v47.23 -- Production stabilization: auth + bill pipeline + testing
  'AUTH: [AUTH_LOGIN_SUCCESS] log added to login route -- confirms successful login with userId+email',
  'AUTH: [AUTH_LOGIN_FAILURE] log added to all failure paths in login route -- no-cookie, bad password, DB error',
  'AUTH: [AUTH_COOKIE_PRESENT] / [AUTH_COOKIE_MISSING] logs added to login and me routes -- tracks session cookie presence',
  'AUTH: [DATABASE_URL_PRESENT] log added to login and me routes at request entry -- cold-start env visibility',
  'AUTH: [JWT_SECRET_PRESENT] log added to login and me routes at request entry -- cold-start env visibility',
  'AUTH: export const runtime = "nodejs" added to login/route.ts -- ensures Node.js runtime for bcrypt and JWT',
  'AUTH: [AUTH_MIDDLEWARE_BYPASS] log added to middleware.ts -- logs path + reason (public_path or valid_session+userId)',
  'AUTH: [AUTH_MIDDLEWARE_BLOCKED] log added to middleware.ts -- logs path + reason + hasCookie on 401/redirect',
  'BILL: POST /api/debug/bill created -- auth-protected pipeline trace endpoint',
  'BILL: /api/debug/bill traces all 6 stages: reception, OCR, deterministic parse, AI fallback, rate validation, sizing',
  'BILL: /api/debug/bill returns full trace JSON with per-stage ok/error/elapsed_ms/data for Vercel log debugging',
  'BILL: /api/debug/bill does NOT save to DB -- safe for production diagnostics',
  'RATE: [RATE_PRIORITY_DECISION] log added to system-size route -- logs priority_source + all candidate rates',
  'RATE: Priority chain visible in logs: bill_extracted > db_retail > db_legacy > state_geo_avg > national_default',
  'RATE: validateAndCorrectUtilityRate priority verified: extracted(valid) > db_retail > national_default',
  'TEST: tests/auth-health.test.ts -- 33 new vitest tests covering auth system health',
  'TEST: isTransientDbError whitelist-fatal classification (11 cases: DbConfigError, pg auth, SCRAM, ECONNRESET, etc.)',
  'TEST: DbConfigError class (4 cases: instanceof Error, name, message, instanceof check)',
  'TEST: signToken/verifyToken JWT round-trip (6 cases: format, identity, tamper detection, role exclusion)',
  'TEST: Auth error code contract (3 cases: DB_STARTING, DB_CONFIG_ERROR, 401-only logout)',
  'TEST: Middleware PUBLIC_PATHS bypass logic (13 cases: all auth routes public, debug routes require auth)',
  'TEST: Startup env guard (3 cases: DATABASE_URL check, JWT_SECRET length check, log format)',
  'TEST: All 67 tests in tests/bill-upload.test.ts + tests/auth-health.test.ts passing',
  // v47.22 -- Full pipeline diagnostic audit
  'LOG: [UPLOAD_RECEIVED] added to bill-upload route with timestamp -- first log on every request',
  'LOG: [FILE_SIZE_BYTES] added after buffer creation with bytes/kb/mime/name',
  'GUARD: buffer.length===0 check added -- returns 422 immediately if arrayBuffer() returned empty',
  'LOG: [OCR_TEXT_FIRST_500] added before deterministic parsing -- shows first 500 chars of OCR text',
  'LOG: [AI_FIELDS_EXTRACTED] added after parseBill() -- dumps utility/monthlyKwh/annualKwh/rate/address/customer',
  'LOG: [PARSED_DATA_OBJECT] added -- JSON.stringify of all extracted fields for Vercel log inspection',
  'LOG: [API_RESPONSE_SENT] added before return -- shows success/fields/hasKwh/hasLocation/usedAI/elapsedMs',
  'LOG: [DB_SAVE_STARTED] and [DB_SAVE_COMPLETE] added as notes (bill-upload does not save to DB -- frontend does)',
  'LOG: [UPLOAD_RECEIVED] added to system-size route -- logs all input fields on entry',
  'WARN: system-size warns if no kWh data or no address received',
  'LOG: [PIPELINE_STAGE_9] handleBillComplete entry diagnostic in page.tsx -- logs full result shape',
  'LOG: [DB_SAVE_STARTED] before PUT /api/projects/[id] in handleBillComplete',
  'LOG: [DB_SAVE_COMPLETE] after successful PUT in handleBillComplete',
  'LOG: [API_RESPONSE_SENT] in BillUploadFlow before onComplete fires -- logs full shape passed to page.tsx',
  'AUDIT: Every stage now has a unique searchable log marker for Vercel log triage',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}