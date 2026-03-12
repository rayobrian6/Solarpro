// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v46.8';
export const BUILD_DATE        = '2026-03-17';
export const BUILD_DESCRIPTION = 'Fix fence/roof/ground/row/plane panel clearing: lastRenderedPanelsRef sync before onPanelsChange';
export const BUILD_FEATURES    = [
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
