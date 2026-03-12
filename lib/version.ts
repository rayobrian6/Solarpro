// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.8';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'Bill upload: fix HTML 500 error — Tesseract dynamic import, JSON error boundary';
export const BUILD_FEATURES    = [
  // v45.8 — Fix "Unexpected token '<'" HTML error
  'route: billOcrEngine/billParser moved to dynamic import() inside extractImageTextSmart()',
  'route: prevents webpack from bundling tesseract.js worker_threads at module load time',
  'route: static import of tesseract.js caused HTML 500 before route handler could run',
  'billOcrEngine: Tesseract CLI (child_process execFile) as primary — zero bundling issues',
  'billOcrEngine: Tesseract.js npm as secondary CLI fallback (dynamic import)',
  'billOcrEngine: OpenAI Vision only if confidence<60 or no monthly usage found',
  'billOcrEngine: Google Vision as last-resort fallback',
  // v45.7 — Tesseract OCR pipeline
  'billOcrEngine: Tesseract.js v7 primary OCR — free, no API cost',
  'billOcrEngine: 3-stage pipeline — Tesseract → parse check → Vision fallback only if needed',
  'billParser: standalone parseMonthlyUsage() — handwritten lines, bar graph table, annual line',
  // v45.6 — Bill parser: bar graph table extraction
  'billOcr: 3-priority extractKwh() — handwritten months (P1) → bar graph table (P2) → yearly total (P3)',
  'billOcr: NWH/KWH OCR alias normalisation to kWh before all parsing',
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