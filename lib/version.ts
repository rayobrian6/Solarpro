// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v46.1';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'OCR pipeline: image preprocessing + multi-pass Tesseract + AI fallback + dev branch workflow';
export const BUILD_FEATURES    = [
  // v46.1 — OCR extraction repair
  'billImagePreprocess.ts: EXIF auto-rotate, grayscale, normalize, sharpen, threshold, upscale to 2400px',
  'ocr/route.ts: multi-pass Tesseract — PSM 3 (auto) + PSM 6 (document block), best result wins',
  'ocr/route.ts: raw OCR text logged before any parsing — full debug visibility',
  'ocr/route.ts: preprocessing pipeline applied before every OCR run',
  'billOcr.ts: extractBillDataWithAI() — structured JSON fallback when 0 fields extracted',
  'route.ts: AI fallback triggered when extractedFields === 0 or < 2',
  'route.ts: raw OCR text logged to console before parsing',
  'vercel.json: dev=preview, master=manual-only — no accidental production deploys',
  'main.yml: manual-trigger-only production deploy with DEPLOY confirmation guard',
  'next.config.js: sharp + exif-reader added to webpack externals',
  // v46.0 — Deterministic bill parser
  'route: parseBill() from billParser.ts is now the single authoritative final parser',
  'route: parseBillTextWithLLM() removed — no LLM rewrites of numeric fields ever',
  'billParser: strict source priority P1 printed table > P2 handwritten > P3 bar graph',
  'billParser: rate returns null if not found — never guesses',
  // v45.9 — SaaS Tesseract OCR
  'app/api/ocr/route.ts — dedicated OCR endpoint, webpack-isolated',
  'OCR pipeline: Tesseract.js WASM (primary) → Tesseract CLI (secondary) → OpenAI Vision (fallback)',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}