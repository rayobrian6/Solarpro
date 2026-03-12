// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v46.3';
export const BUILD_DATE        = '2026-03-13';
export const BUILD_DESCRIPTION = 'Fix build: clean version.ts, remove all conflict markers, ASCII-safe strings';
export const BUILD_FEATURES    = [
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
