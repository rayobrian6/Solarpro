/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v28.6';
export const BUILD_DATE = '2026-03-08';
export const BUILD_DESCRIPTION = 'FULL SYSTEM ARCHITECTURE UPGRADE';
export const BUILD_FEATURES = [
  // Phase 1: Foundation & APIs
  'NEW: /api/utility-rates — NREL URDB proxy with state-level fallback rates',
  'NEW: lib/financialEngine.ts — PVWatts + URDB + pricing → NPV, ROI, payback, 25yr projection',
  'NEW: lib/equipment-extras.ts — rapid shutdown, combiner boxes, AC/DC disconnects, service panels',
  // Phase 2: Design Studio Automation
  'NEW: DesignStudio — Auto Layout button (fills all zones with current settings)',
  'NEW: DesignStudio — Fill Roof button (max density, 0.3m setback)',
  'NEW: DesignStudio — Optimize Layout button (inter-row shading avoidance)',
  'NEW: DesignStudio — Quick production estimate preview (before PVWatts calculation)',
  // Phase 3: Dashboard & Analytics
  'NEW: Dashboard — Avg System Size + Conversion Rate stat cards (6-card grid)',
  'NEW: Dashboard — Before/After monthly bill comparison chart',
  'NEW: Dashboard — 25-year cumulative savings projection chart',
  // Phase 4: Proposal Engine
  'NEW: Proposals — Utility bill comparison section (before/after monthly bills)',
  'NEW: Proposals — 25-year savings projection chart with cumulative view',
  'NEW: Proposals — Shareable client link with copy-to-clipboard',
  'NEW: /api/proposals/[id]/share — generate/retrieve shareable proposal tokens',
  // Phase 5: Engineering Automation
  'NEW: Engineering — Enhanced IssueRow with expandable NEC explanations + suggested fixes',
  'NEW: Engineering — AHJ Auto-Detection status banner with special requirements',
  'NEW: Engineering — Compliance Action Center with grouped issues + quick-fix actions',
  'NEW: Engineering — All Clear banner when compliance passes',
  // Phase 6: Subscription Gating
  'NEW: Engineering — SLD tab gated to Professional+ (lock icon + upgrade prompt)',
  'NEW: Engineering — Permit Package tab gated to Professional+ (lock icon + upgrade prompt)',
  'NEW: Engineering — BOM tab gated to Professional+ (lock icon + upgrade prompt)',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}