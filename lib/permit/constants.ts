// ═══════════════════════════════════════════════════════════════
// Permit Engine Constants — Extracted from route.ts
// ═══════════════════════════════════════════════════════════════

// ═══ Planset Engine Constants ═══════════════════════════════════════════════
// Single source of truth for PDF dimensions and engine version.
// Bump PLANSET_ENGINE_VERSION on every release that changes planset output.

/** PDF page dimensions — ANSI B landscape (17×11 in). Used by ALL wkhtmltopdf calls. */
const PDF_PAGE_CONFIG = {
  width:  '17in',
  height: '11in',
} as const;

/** Engine version for staleness detection. Bump with every planset-affecting release. */
// 47346 (2026-06-30): aerial centering now pin-authoritative (no neighbor-segment
// override), battery gated on the permit payload, PV-2B branch-colored real-roof plan,
// PV-1 panels removed. Bumped so cached plansets generated before these fixes are treated
// as stale and force a fresh regenerate instead of serving the old (wrong-aerial) HTML.
// 47350 (2026-06-30): PV-2/PV-2B roof plan — fire setback now drawn as a REAL
// inward inset (was zero-inset = no visible setback band); plane-label pitch
// rounded to one decimal so it matches the SYSTEM-DATA table (was "5:12" vs
// "4.8:12" on the same sheet).
const PLANSET_ENGINE_VERSION = 47350;



export { PDF_PAGE_CONFIG, PLANSET_ENGINE_VERSION };
