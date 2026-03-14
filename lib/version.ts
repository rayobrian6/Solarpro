// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.54';
export const APP_VERSION       = BUILD_VERSION; // alias used by health route
export const BUILD_DATE        = '2026-06-09';
export const BUILD_DESCRIPTION = 'v47.54: Full system architecture audit — workflow tracker fix, permit ENGINEERING_MODEL_STALE guard, remove silent 9.6kW/24-panel defaults, UI error handling for stale model';
export const BUILD_FEATURES    = [
  // v47.54 -- Full system architecture audit & pipeline fixes
  'AUDIT: 10-phase full system audit (SYSTEM_AUDIT_v47.54.md) — traced all critical fields panelCount/systemSize/moduleModel/inverterModel/projectAddress from design to permit',
  'WORKFLOW: Fix design step check — now verifies layout.panels.length > 0 (not just truthy layout object)',
  'WORKFLOW: Fix engineering step check — now checks layout.panels.length > 0 (was p.status === "proposal" which was never auto-set)',
  'PERMIT: ENGINEERING_MODEL_STALE guard in POST handler — blocks permit if totalPanels === 0, returns HTTP 422 with code + message',
  'PERMIT: Remove 9.6 kW / 24-panel silent defaults from buildSLD() — now defaults to 0 so pipeline gaps are visible',
  'PERMIT: Engineering page PDF fetch — handles 422 ENGINEERING_MODEL_STALE with user-facing alert',
  'PERMIT: Engineering page HTML preview fetch — handles 422 ENGINEERING_MODEL_STALE with user-facing alert',
  'PERMIT: Engineering page handles all non-ok fetch responses with descriptive error alerts (not silent failure)',
  'PIPELINE: Confirmed layout-save webhook auto-triggers engineering report generation (buildDesignSnapshot → generateEngineeringReport → upsertEngineeringReport)',
  'PIPELINE: Confirmed handleGeneratePermitPackage calls runCalc() → saveEngineeringOutputs() — client files populated correctly',
  'SHEETS: Confirmed permit generates exactly 13 pages (TOTAL=13): PV-0 PV-1 PV-2A PV-2B PV-3 PV-4A PV-4B PV-4C PV-5 SCHED APP-A CERT E-1',
  'DEBUG: Debug page /debug/project confirmed correct — shows layout.panels.length vs engineering.panelCount mismatch',
  // v47.53 -- Auth fix
  'AUTH: response.cookies.set() replaces raw Set-Cookie header (Vercel edge proxy strips raw header)',
  'AUTH: removed vercel.json /api cache header override (was poisoning auth routes)',
  'AUTH: removed router.refresh() race condition after login',
  // v47.51 -- Layout → Engineering pipeline fix
  'ENGINEERING: Layout panel count OVERRIDES seed.panel_count — layout is ground truth',
  'ENGINEERING: Direct layout fetch useEffect — runs when currentProjectId is set (safety net)',
  'ENGINEERING: Safety net layout fetch in project fetch — if p.layout is null, fetch /layout directly',
  'ENGINEERING: handleGeneratePermitPackage GUARD — blocks if no layout, logs PERMIT PREFLIGHT',
  'ENGINEERING: system.totalPanels in permit payload now prefers projectLayout.panels.length',
  'ENGINEERING: system.totalDcKw in permit payload computed from layout panel count',
  // v47.50 -- TypeScript fix
  'ENGINEERING: Fix preflight panel — computedSystem.bomQuantities.panelModel/inverterModel (not config.moduleModel)',
  'ENGINEERING: Fix preflight panel — totalKw for system size (not config.systemKw)',
  'BUILD: tsc --noEmit = 0 errors, npm run build = clean',
  // v47.49 -- Pipeline verification
  'DEBUG: /debug/project page — visual DB layout inspector',
  'DEBUG: /api/debug/layout route — authenticated DB schema + layout audit',
  'ENGINEERING: Preflight panel — panel count, roof planes, system size, module, inverter, BUILD_VERSION',
  'ENGINEERING: New primary button — Generate & Download Permit Package (13 Sheets)',
  'FOOTER: Global BUILD_VERSION badge fixed bottom-left on all pages',
  // v47.46 -- Full 13-page permit planset pipeline
  'PERMIT: 13-page planset (was 11) — PV-0 through E-1 (sheets 1 of 13 .. 13 of 13)',
  'PERMIT: pageArrayGeometry() — PV-2B: SVG panel grid, string color-coding, IFC §605.11 fire setback diagram, array parameters table',
  'PERMIT: pageSpecSheetReference() — APP-A: NEC 690.8 safety factor calcs (×1.25), module/inverter/racking specs, manufacturer data sheet links',
  'PERMIT: pageSiteInformation() — PV-1: replaced placeholder with full SVG schematic site plan (house, garage, array, meter, inverter, disco, MSP, conduit, north arrow)',
  'PERMIT: Cover sheet index updated to list all 13 sheets: PV-0 PV-1 PV-2A PV-2B PV-3 PV-4A PV-4B PV-4C PV-5 SCHED APP-A CERT E-1',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}