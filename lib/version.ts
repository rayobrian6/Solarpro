// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.7';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'Bill upload: Tesseract.js primary OCR — Vision API fallback only';
export const BUILD_FEATURES    = [
  // v45.7 — Tesseract OCR pipeline
  'billOcrEngine: Tesseract.js v7 primary OCR — free, no API cost',
  'billOcrEngine: 3-stage pipeline — Tesseract → parse check → Vision fallback only if needed',
  'billOcrEngine: OpenAI Vision only called if Tesseract confidence < 60 OR no monthly usage found',
  'billOcrEngine: Google Vision as last-resort fallback after OpenAI Vision',
  'billOcrEngine: ~95% reduction in Vision API calls for clear printed bills',
  'billParser: standalone parseMonthlyUsage() — handwritten lines, bar graph table, annual line',
  'billParser: P1 handwritten months (Jan 555 kWh/NWH), P2 bar graph daily-avg × days, P3 annual line',
  'billParser: validateAndEstimate() — 0–5000 kWh range, extrapolate from partial year',
  'billParser: estimateSystemSize() — 1200 kWh/kW/yr production factor',
  'route: extractImageTextSmart() replaces old extractImageText()',
  'route: logs OCR confidence, method, months found at every stage',
  // v45.6 — Bill parser: bar graph table extraction
  'billOcr: 3-priority extractKwh() — handwritten months (P1) → bar graph table (P2) → yearly total (P3)',
  'billOcr: Monthly Usage Summary table parsed — month-name rows (Jan 20 24 20), col1 = current year daily avg',
  'billOcr: Daily avg × days-in-month converts bar graph values to real monthly kWh totals',
  'billOcr: NWH/KWH OCR alias normalisation to kWh before all parsing',
  // v45.5 — Bill parser: NWH alias + address/name fixes
  'billOcr: extractServiceAddress multi-line fallback, tightened anti-PO-Box regex',
  // v45.4 — Plan set HTML viewer
  'wrapDocument() floating Save-as-PDF toolbar + auto-print on file:// open',
  'PLAN_SET_CSS: page-break rules outside @media print for wkhtmltopdf screen-mode',
  // v45.3 — SLD / plan set
  'E-1 plan-set uses pre-rendered SLD SVG from Design Studio',
  '7-sheet permit plan set: G-1, E-1, E-2, S-1, A-1, M-1, C-1',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}