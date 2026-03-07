/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v25.6';
export const BUILD_DATE = '2026-03-07';
export const BUILD_DESCRIPTION = 'FULL STRUCTURAL OVERHAUL + MOUNTING DETAILS UI';
export const BUILD_FEATURES = [
  'Structural Engine V4 — residential, commercial, ground mount, tracker',
  'Global Mounting Hardware DB — 20+ systems, 16 manufacturers, ICC-ES rated',
  'Mounting Details UI — Residential/Commercial/Ground toggle',
  'Real-time mount spacing, ballast, and ground mount diagrams',
  'Manufacturer spec panel with full engineering data',
  'BOM preview panel derived from array geometry',
  'Status aggregation debug inspector in compliance tab',
  'Deterministic overallStatus — error-based, not raw status strings',
  'Commercial ballasted: ballast block count, weight, roof load analysis',
  'Ground mount: pile count, spacing, embedment, safety factors',
  'Tracker: row spacing, GCR, stow angle, wind speed limits',
  'ASCE 7-22 wind loads, NDS 2018 rafter analysis, BCSI truss tables',
  'All 3 validation test cases PASS',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}