// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.2';
export const BUILD_DATE        = '2026-03-18';
export const BUILD_DESCRIPTION = 'Production stability v2: defense-in-depth DB error classification, all cold-start paths return DB_STARTING';
export const BUILD_FEATURES    = [
  // v47.2 -- Production stability: defense-in-depth DB error handling
  'ROOT CAUSE: isTransientDbError() used blacklist approach -- any Neon cold-start error with unusual message fell through to non-transient, causing DB_CONFIG_ERROR mis-classification',
  'ROOT CAUSE: login/route.ts catch used msg.includes(DATABASE_URL) -- matched Neon connection string errors during cold start, showed Database not configured to users',
  'ROOT CAUSE: me/route.ts generic 500 fallthrough -- UserContext does not retry on 500, so unrecognized errors appeared as logout',
  'ROOT CAUSE: UserContext treated any non-200 non-503 as definitive logout (if (!res.ok) return null)',
  'FIX: lib/db-ready.ts -- isTransientDbError() rewritten with WHITELIST-FATAL approach: only explicit pg auth/permission/missing errors are fatal; all unknown errors default to transient',
  'FIX: lib/db-ready.ts -- AUTH_DB_STARTING / AUTH_DB_CONFIG_ERROR log codes on every error path for Vercel log searchability',
  'FIX: app/api/auth/me/route.ts -- handleDbError() centralizes all DB error responses; defaults to DB_STARTING for ALL non-DbConfigError errors (never 500)',
  'FIX: app/api/auth/me/route.ts -- inner fallback query wrapped in own try/catch; connection errors in fallback correctly return DB_STARTING not 500',
  'FIX: app/api/auth/me/route.ts -- AUTH_DB_STARTING/AUTH_DB_CONFIG_ERROR/AUTH_DB_QUERY_ERROR log tags on every code path with stage= context',
  'FIX: app/api/auth/login/route.ts -- removed msg.includes(DATABASE_URL) from config error check; only DbConfigError is fatal',
  'FIX: app/api/auth/login/route.ts -- all non-DbConfigError errors return DB_STARTING (not 500/Login failed); same safe-default pattern',
  'FIX: contexts/UserContext.tsx -- HTTP 500 from /api/auth/me now retries (not logout); only HTTP 401 = definitive logout',
  // v47.1 -- Production stability: deployment cold-start session fix
  'ROOT CAUSE: /api/auth/me used getDb() (no retry) -- UserContext called on mount/focus/30s -- cold start = null user = apparent logout',
  'FIX: app/api/auth/me/route.ts -- switched getDb() to getDbReady() (3x retry, 1s/2s/4s backoff); returns DB_STARTING 503 on transient failure (not 500)',
  'FIX: app/api/auth/me/route.ts -- DB_CONFIG_ERROR vs DB_STARTING error codes prevent UserContext from misclassifying cold starts as logouts',
  'FIX: contexts/UserContext.tsx -- fetchUserWithRetry() wraps fetchUserFromDb(); retries up to 5x (3s each) on DB_STARTING 503 before clearing user state',
  'FIX: contexts/UserContext.tsx -- 503/DB_STARTING never clears user state; only 401 is treated as definitive logout',
  'FIX: app/api/auth/register/route.ts -- switched getDb() to getDbReady(); proper DB_STARTING/DB_CONFIG_ERROR error codes',
  'FIX: lib/adminAuth.ts -- requireAdmin() and requireAdminApi() switched to getDbReady() with retry',
  'FIX: lib/auth.ts -- makeSessionCookie() adds Secure flag in production (NODE_ENV=production) for HTTPS-only cookie delivery',
  'FIX: lib/auth.ts -- clearSessionCookie() adds matching Secure flag',
  'FIX: lib/auth.ts -- exports DbConfigError re-export from db-ready for convenience',
  'FIX: lib/db-neon.ts -- getDb() now throws DbConfigError (non-retryable) instead of plain Error; routes can distinguish config vs transient',
  'FIX: lib/db-neon.ts -- exports getDbReady() async wrapper and DbConfigError for routes importing from db-neon',
  // v47.0 -- Utility bill parsing pipeline audit
  'FIX: lib/billOcr.ts -- validateBillData() accepts optional BillValidationContext; suppresses stale utility/rate warnings when values resolved post-match',
  'FIX: lib/billOcr.ts -- rate warning range updated to $0.06-$0.50/kWh; unusual rate warning replaces hard rejection',
  'FIX: lib/utility-rules.ts -- MIN_VALID_RETAIL_RATE lowered 0.07->0.06; MAX_VALID_RETAIL_RATE=0.50 added; rates above max corrected to DB rate',
  'FIX: app/api/bill-upload/route.ts -- validateBillData() moved from pre-geocoding (line 242) to post-rate-correction; context passes resolvedMatchedUtility + finalRate',
  'FIX: app/api/bill-upload/route.ts -- UI warnings now reflect fully resolved state (utility matched, rate corrected) not raw parse output',
  // v46.9 -- DB readiness guard
  'NEW: lib/db-ready.ts -- getDbWithRetry() 3x retry with 1s/2s/4s exponential backoff for Neon cold starts',
  'NEW: lib/db-ready.ts -- probeDbReady() SELECT 1 wake probe before auth queries',
  'NEW: lib/db-ready.ts -- isTransientDbError() classifies transient vs fatal DB errors',
  'NEW: lib/db-ready.ts -- DbConfigError non-retryable class for missing DATABASE_URL',
  'FIX: lib/auth.ts -- getDbReady() async wrapper uses getDbWithRetry; getDb() kept for non-auth routes',
  'FIX: app/api/auth/login/route.ts -- uses getDbReady() with retry; returns code=DB_STARTING on 503; Retry-After header',
  'FIX: app/auth/login/page.tsx -- detects DB_STARTING 503; shows "Starting server..." banner; auto-retries up to 5x with countdown',
  // v46.8 -- Panel clearing fix
  'FIX: SolarEngine3D.tsx -- finalizeFence: set lastRenderedPanelsRef.current before onPanelsChange to prevent orphaned entities',
  'FIX: SolarEngine3D.tsx -- handleRoofClick: same lastRenderedPanelsRef sync fix',
  'FIX: SolarEngine3D.tsx -- handleGroundClick: same lastRenderedPanelsRef sync fix',
  'FIX: SolarEngine3D.tsx -- finalizePlane: same lastRenderedPanelsRef sync fix',
  'FIX: SolarEngine3D.tsx -- Row finalization: same lastRenderedPanelsRef sync fix',
  // v46.7 -- TS build fixes (was v46.6 remote)
  'NEW: lib/utilityMatcher.ts -- normalizeUtilityName() strips noise words; matchUtility() P1 exact / P2 pg_trgm fuzzy / P3 state fallback / P4 auto-discover',
  'FIX: app/api/bill-upload/route.ts -- calls matchUtility() after parseBill(); applies DB rate (default_residential_rate) to billData.electricityRate',
  'FIX: app/api/bill-upload/route.ts -- geo detectUtility() is now fallback-only; parsed name match wins',
  'FIX: app/api/bill-upload/route.ts -- bill persisted to bills table when projectId in form data',
  'NEW: app/api/migrate/route.ts -- Migration 009: default_residential_rate + source on utility_policies; pg_trgm extension; GIN index',
  'NEW: app/api/migrate/route.ts -- Migration 010: bills table (project_id, utility_name, monthly_kwh, annual_kwh, electric_rate, parsed_json)',
  'NEW: lib/db-neon.ts -- saveBill() and getBillsByProject() functions',
  'NEW: app/api/bills/route.ts -- GET ?projectId= and POST endpoints',
  'FIX: components/onboarding/BillUploadModal.tsx -- step 6 persists bill to /api/bills after project creation',
  'FIX: lib/utility-rules.ts -- getProductionFactor() accepts stateCode param; state-aware factors (ME/VT/NH=1050, CA/AZ/NV=1600, FL/TX=1500, NY/NJ/CT=1100)',
  'FIX: app/api/bill-upload/route.ts -- passes locationData.stateCode to getProductionFactor()',
  // v46.5 -- Bill parser P3 fix
  'billParser: parseBarGraphTable -- Monthly Usage Summary values are monthly kWh totals (not daily averages x days)',
  // v46.4 -- Bill parser comma-kWh fix
  'billParser: parseHandwrittenList -- fix comma-kWh (1,234 kWh) regex {1,3} -> {0,2}',
  'billParser: parsePrintedTable -- fix comma-kWh regex {2,4} -> {0,3} + val>=100 guard',
  // v46.3 -- Build fix
  'version.ts: rewritten with ASCII-only strings to prevent TypeScript merge-conflict false positives',
  // v46.2 -- Bill parser fixes
  'billParser: parseHandwrittenList -- skip year-number false matches (Jan 2025 362 => 362 not 2025)',
  'billParser: parseHandwrittenList -- date context guard (Jan 15, 2025 / Jan 15 2025 => skip 15)',
  'billParser: parseHandwrittenList -- comma-number support (1,234 kWh)',
  'billParser: extractCurrentMonth -- added Energy Charge pattern + kWh@ pattern',
  'billParser: annual cross-check now correctly computes 0.0% diff when explicit == computed',
  // v46.1 -- OCR extraction repair
  'billImagePreprocess.ts: EXIF auto-rotate, grayscale, normalize, sharpen, threshold, upscale to 2400px',
  'ocr/route.ts: multi-pass Tesseract -- PSM 3 (auto) + PSM 6 (document block), best result wins',
  'ocr/route.ts: raw OCR text logged before any parsing -- full debug visibility',
  'ocr/route.ts: preprocessing pipeline applied before every OCR run',
  'billOcr.ts: extractBillDataWithAI() -- structured JSON fallback when 0 fields extracted',
  'route.ts: AI fallback triggered when extractedFields === 0 or < 2',
  'route.ts: raw OCR text logged to console before parsing',
  'vercel.json: dev=preview, master=manual-only -- no accidental production deploys',
  'main.yml: manual-trigger-only production deploy with DEPLOY confirmation guard',
  'next.config.js: sharp + exif-reader added to webpack externals',
  // v46.0 -- Deterministic bill parser
  'route: parseBill() from billParser.ts is now the single authoritative final parser',
  'route: parseBillTextWithLLM() removed -- no LLM rewrites of numeric fields ever',
  'billParser: strict source priority P1 printed table > P2 handwritten > P3 bar graph',
  'billParser: rate returns null if not found -- never guesses',
  // v45.9 -- SaaS Tesseract OCR
  'app/api/ocr/route.ts -- dedicated OCR endpoint, webpack-isolated',
  'OCR pipeline: Tesseract.js WASM (primary) => Tesseract CLI (secondary) => OpenAI Vision (fallback)',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}
