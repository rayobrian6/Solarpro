// ============================================================
// SolarPro — Canonical Structural Type Definitions
// Single source of truth for all structural engine types.
// All four engine files (V1–V4) import from here.
//
// HISTORY:
//   v60.4 Phase A — consolidated from:
//     lib/structural-calc.ts        (V1 — WindExposureCategory, RafterSpecies)
//     lib/structural-engine-v2.ts   (V2 — added FramingType, RoofZone, PanelOrientation)
//     lib/structural-engine-v3.ts   (V3 — renamed to WindExposure, WoodSpecies)
//     lib/structural-engine-v4.ts   (V4 — added InstallationType)
// ============================================================

// ── Wind Exposure Category (ASCE 7-22 Section 26.7) ─────────────────────────
// Canonical name: WindExposure (V3/V4 naming wins — shorter, clearer)
// V1 and V2 used WindExposureCategory — kept as alias for backward compat.
export type WindExposure         = 'B' | 'C' | 'D';
export type WindExposureCategory = WindExposure;   // @deprecated — use WindExposure

// ── Roof Surface Type ────────────────────────────────────────────────────────
export type RoofType =
  | 'shingle'
  | 'tile'
  | 'metal_standing_seam'
  | 'metal_corrugated'
  | 'flat_tpo'
  | 'flat_epdm'
  | 'flat_gravel';

// ── Framing Type ─────────────────────────────────────────────────────────────
export type FramingType = 'truss' | 'rafter' | 'unknown';

// ── Wood Species (NDS 2018 Table 4A reference species) ───────────────────────
// Canonical name: WoodSpecies (V3/V4 naming wins)
// V1 and V2 used RafterSpecies — kept as alias for backward compat.
export type WoodSpecies   = 'Douglas Fir-Larch' | 'Southern Pine' | 'Hem-Fir' | 'Spruce-Pine-Fir';
export type RafterSpecies = WoodSpecies;   // @deprecated — use WoodSpecies

// ── Roof Zone (ASCE 7-22 C&C pressure zones) ────────────────────────────────
export type RoofZone = 'interior' | 'edge' | 'corner';

// ── Panel Orientation ────────────────────────────────────────────────────────
export type PanelOrientation = 'portrait' | 'landscape';

// ── Installation Type (V4 — supports commercial + ground mount) ──────────────
export type InstallationType =
  | 'roof_residential'
  | 'roof_commercial'
  | 'commercial_ballasted'
  | 'ground_mount'
  | 'tracker'
  | 'carport'
  | 'fence';            // SolFence vertical bifacial solar fence (analyzeFence)

// ── Mount-type mapping (UNIFIED-ENGINE-DESIGN-SPEC.md, Step 2) ────────────────
// Single source of truth: systemType ('roof' | 'ground' | 'fence' — the UI/config
// vocabulary) → InstallationType (the structural-engine vocabulary). Before this,
// the structural payload never carried installationType, so every ground/fence job
// defaulted to 'roof_residential' in /calculate and silently ran the roof path.
//
// PE-GATED scope (do NOT mistake this for the ground/fence structural build):
//   • 'ground' → 'ground_mount' here only flips OFF the meaningless roof
//     mount-capacity check in V4 (skipMountCheck). It does NOT activate the
//     ground-pile branch — that keys on the *mounting system's* type, and no
//     ground mounting system is passed yet. The real exposed-wind + IBC 1807.3
//     embedment math is Step 6; output stays "ESTIMATE — not engineered" behind
//     the structural-tab guardrail banner.
//   • 'fence' → 'fence' routes to the dedicated analyzeFence path in V4
//     (freestanding-wall wind + SolFence post embedment). Output stays
//     "ESTIMATE — not engineered" (engineered:false) until PE sign-off.
export function systemTypeToInstallationType(systemType?: string): InstallationType {
  switch (systemType) {
    case 'ground': return 'ground_mount';
    case 'fence':  return 'fence';
    case 'roof':
    default:       return 'roof_residential';
  }
}

// ── Structural Issue (superset of all 4 engine definitions) ─────────────────
// V1 had:   code, severity, message, value?, limit?, reference?, suggestion?
// V2/V3 had: code, message, severity, suggestion?
// V4 had:   code, message, severity, suggestion (required), reference?
// Canonical: all fields optional except code + severity + message
export interface StructuralIssue {
  code:        string;
  severity:    'error' | 'warning' | 'info';
  message:     string;
  suggestion?: string;
  reference?:  string;
  value?:      number | string;
  limit?:      number | string;
}