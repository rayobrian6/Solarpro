// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v46.0';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'Deterministic bill parser — parseBill() replaces parseBillTextWithLLM(), evidence-based extraction';
export const BUILD_FEATURES    = [
  // v46.0 — Deterministic bill parser wiring
  'route: parseBill() from billParser.ts is now the single authoritative final parser',
  'route: parseBillTextWithLLM() removed — no LLM rewrites of numeric fields ever',
  'route: parseBillText() used only for non-usage fields (address, account, charges)',
  'route: usage fields (kWh, annual, monthly history) sourced exclusively from parseBill()',
  'route: extractionEvidence returned in API response — source tags, debug log, confidence',
  'billParser: strict source priority P1 printed table > P2 handwritten > P3 bar graph',
  'billParser: annual A1 explicit total > A2 monthly sum > A3 extrapolated — cross-checked',
  'billParser: rate returns null if not found — never guesses',
  'billParser: utility name from bill header (CMP → Central Maine Power)',
  'billParser: BillParseResult with ExtractedValue<T> evidence on every field',
  'billParser: debugLog[] — deterministic, same input = same log',
  // v45.9 — SaaS Tesseract OCR
  'app/api/ocr/route.ts — dedicated OCR endpoint, webpack-isolated, tesseract.js loaded at runtime',
  'billOcrEngine: calls internal /api/ocr for Tesseract — no worker_threads in main route bundle',
  'OCR pipeline: Tesseract.js WASM (primary) → Tesseract CLI (secondary) → OpenAI Vision (fallback)',
  'OpenAI Vision only called if Tesseract confidence < 60 OR no monthly usage detected',
  // v45.8 — JSON error fix
  'route: billOcrEngine/billParser moved to dynamic import() — fixes HTML 500',
  // v45.4 — Plan set HTML viewer
  'wrapDocument() floating toolbar + auto-print on file:// open',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}