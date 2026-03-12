// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.6';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'Bill upload: 3-priority kWh extractor — handwritten months, bar graph table, yearly total';
export const BUILD_FEATURES    = [
  // v45.6 — Bill parser: bar graph table extraction
  'billOcr: 3-priority extractKwh() — handwritten months (P1) → bar graph table (P2) → yearly total (P3)',
  'billOcr: Monthly Usage Summary table parsed — month-name rows (Jan 20 24 20), col1 = current year daily avg',
  'billOcr: Daily avg × days-in-month converts bar graph values to real monthly kWh totals',
  'billOcr: Debug logs — OCR text length, handwritten months, bar graph rows, parsed object, yearly total',
  'billOcr: OpenAI Vision prompt updated to explicitly request bar graph table and handwritten month data',
  'billOcr: NWH/KWH OCR alias normalisation to kWh before all parsing',
  'billOcr: Multi-line address fallback (STREET\\nCITY STATE ZIP without label)',
  'billOcr: Bare ALL-CAPS customer name detection',
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