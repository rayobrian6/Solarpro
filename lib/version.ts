/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v44.0';
export const BUILD_DATE = '2025-01-12';
export const BUILD_DESCRIPTION = 'Full permit plan set engineering upgrade: NEC 690.7 Voc temp correction, NEC 310.15 rooftop derating, structural auto-fix (NEVER FAIL), 7-sheet plan set (A-1 site layout + M-1 mounting details), compliance PASS/WARNING/REVIEW only';
export const BUILD_FEATURES = [
  // v44.0 — Full permit plan set engineering upgrade
  'UPGRADE: lib/plan-set/structural-sheet.ts — autoFixStructural() iteratively reduces lag bolt spacing (8→6→5→4→3→2 ft) until governing load ≤ rafter capacity; NEVER outputs STRUCTURAL FAIL',
  'UPGRADE: lib/plan-set/structural-sheet.ts — shows all 5 ASCE 7-22 load combinations (LC1-LC5) with calculated values; governing load starred (★)',
  'UPGRADE: lib/plan-set/structural-sheet.ts — 5 SVG structural detail diagrams: rail cross-section, flashing/L-foot, lag bolt engagement, attachment spacing, grounding/bonding',
  'UPGRADE: lib/plan-set/structural-sheet.ts — amber warning box when auto-fixed: "Attachment spacing auto-reduced to X ft O.C."',
  'UPGRADE: lib/plan-set/compliance-sheet.ts — status type PASS/WARNING/REVIEW/N/A only — NEVER FAIL; all FAIL conditions → WARNING or REVIEW',
  'UPGRADE: lib/plan-set/compliance-sheet.ts — 20+ NEC checks including NEC 690.35 GFDI, NEC 706 battery, UL 1741/UL 9540, NEC 250.97 bonding',
  'UPGRADE: lib/plan-set/compliance-sheet.ts — PE stamp placeholder + certification signature block; warnings summary section',
  'UPGRADE: lib/plan-set/cover-sheet.ts — ownerContact, electricalLicense, interconnectionMethod, DC/AC ratio, array config (strings×panels), revision block table',
  'UPGRADE: lib/plan-set/cover-sheet.ts — sheet index updated to 7 sheets (G-1, E-1, E-2, S-1, A-1, M-1, C-1)',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — NEC 690.7 temperature-corrected Voc with actual module temp coefficient or NEC Table 690.7(A) fallback',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — NEC 310.15(B)(2)(a) rooftop conductor derating (+33°C adder); corrected ampacity with formula display',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — NEC 705.12 120% rule with full formula and PASS/WARNING inline badge',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — inverter spec block: Model, Mfr, Type, Qty, AC Output, Max DC V, MPPT Range, Max DC A, Listing',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — expanded wire schedule: ID, From, To, Size, CU, USE-2/PV Wire or THWN-2, Temp Rating, Conduit, OCPD, Code Ref',
  'UPGRADE: lib/plan-set/electrical-sheet.ts — prominent RSD label "PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN" per NEC 690.12',
  'NEW: lib/plan-set/site-layout-sheet.ts — Sheet A-1: roof plan SVG, panel placement grid, fire setbacks (dashed), pathway, north arrow, dimension lines',
  'NEW: lib/plan-set/site-layout-sheet.ts — site plan SVG: property outline, house footprint, PV array, inverter, conduit runs, MSP, meter, RSD',
  'NEW: lib/plan-set/site-layout-sheet.ts — fire setback summary table, equipment locations table, conduit routing notes, legend',
  'NEW: lib/plan-set/mounting-details-sheet.ts — Sheet M-1: 6 SVG detail diagrams: rail cross-section, flashing/L-foot, rail splice, module clamp, bonding/grounding, wire management',
  'NEW: lib/plan-set/mounting-details-sheet.ts — general mounting notes (12 items), NEC references (690.31, 690.43, 250.97, 110.14)',
  'UPGRADE: app/api/engineering/plan-set/route.ts — 7-sheet plan set (G-1, E-1, E-2, S-1, A-1, M-1, C-1); all v44.0 fields passed to sheet builders',
  'UPGRADE: app/api/engineering/plan-set/route.ts — new body params: moduleVoc, moduleIsc, moduleTempCoeffVoc, panelsPerString, inverterMpptMin/Max, inverterMaxDcA, minAmbientTempC, maxRooftopTempC, roofWidthFt, roofLengthFt, equipment locations, mounting hardware fields',
  'UPGRADE: app/api/engineering/plan-set/route.ts — structuralStatus always PASS (auto-fixed in S-1); version header X-Plan-Set-Version: v44.0',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}