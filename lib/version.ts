// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.9';
export const BUILD_DATE        = '2026-03-12';
export const BUILD_DESCRIPTION = 'Bill upload: dedicated /api/ocr route — Tesseract.js SaaS-ready, no local install needed';
export const BUILD_FEATURES    = [
  // v45.9 — SaaS Tesseract OCR
  'app/api/ocr/route.ts — dedicated OCR endpoint, webpack-isolated, tesseract.js loaded at runtime',
  'billOcrEngine: calls internal /api/ocr for Tesseract — no worker_threads in main route bundle',
  'OCR pipeline: Tesseract.js WASM (primary) → Tesseract CLI (secondary) → OpenAI Vision (fallback)',
  'OpenAI Vision only called if Tesseract confidence < 60 OR no monthly usage detected',
  'No local install required — Tesseract.js WASM works on any server/cloud',
  'traineddata cached in /tmp — fast warm restarts on serverless',
  'OCR normalisation: NWH→kWh, KWH→kWh, kivh→kWh, kiwh→kWh font artefacts',
  // v45.8 — JSON error fix
  'route: billOcrEngine/billParser moved to dynamic import() — fixes HTML 500',
  'billOcrEngine: Tesseract CLI via child_process execFile as primary',
  // v45.7 — Tesseract architecture
  'billOcrEngine: Tesseract.js v7 primary OCR — free, no API cost',
  'billParser: standalone parseMonthlyUsage() — P1 handwritten, P2 bar-graph, P3 annual line',
  // v45.6 — Bill parser
  'billOcr: 3-priority extractKwh() — handwritten → bar graph → yearly total',
  'billOcr: NWH/KWH OCR alias normalisation',
  // v45.4 — Plan set HTML viewer
  'wrapDocument() floating toolbar + auto-print on file:// open',
  'PLAN_SET_CSS: page-break rules outside @media print',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}