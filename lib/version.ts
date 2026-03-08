/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v31.2';
export const BUILD_DATE = '2026-03-08';
export const BUILD_DESCRIPTION = 'INTERACTION AUDIT & REPAIR — drillPick panel selection, orientation-aware hit detection, keyboard shortcuts (V/R/G/F/M/Del/Esc), active tool indicator, multiRowMode/Select conflict fix, per-panel systemType color';
export const BUILD_FEATURES = [
  // Phase 1: National Location Engine
  'NEW: lib/locationEngine.ts — Census Bureau + Google Maps + Nominatim geocoding (all 50 states)',
  'NEW: app/api/geocode/route.ts — national geocoding endpoint with full location metadata',
  // Phase 2: Utility Detection System
  'NEW: lib/utilityDetector.ts — URDB API + state-level fallback rates for all 50 states',
  'NEW: app/api/utility-detect/route.ts — auto-detect utility from address or lat/lng',
  // Phase 3: National Engineering Jurisdiction System
  'NEW: lib/jurisdictions/necVersions.ts — NEC version by state/county/city (all 50 states)',
  'NEW: lib/jurisdictions/ahj.ts — AHJ lookup with permit fees, setbacks, rapid shutdown rules',
  'NEW: Engineering — City/County fields with live AHJ auto-detection panel',
  'NEW: Engineering — lookupAhj() wired into config panel (NEC version, permit days, setbacks)',
  // Phase 4: Utility Bill Upload + OCR System
  'NEW: lib/billOcr.ts — OCR parser for 35+ major utility bill formats (PDF + image)',
  'NEW: app/api/bill-upload/route.ts — PDF/JPG/PNG upload with pdftotext + Tesseract OCR',
  'NEW: components/onboarding/BillUploadFlow.tsx — 4-step bill upload → sizing → proposal flow',
  // Phase 5: Auto System Sizing
  'NEW: lib/autoSizing.ts — PVWatts API v8 + state sun hours → optimal system size',
  'NEW: app/api/auto-size/route.ts — auto-sizing endpoint from kWh consumption',
  // Phase 6: Auto Design Generation
  'NEW: lib/autoDesign.ts — roof plane detection + panel placement for 5 roof types',
  'NEW: app/api/auto-design/route.ts — generate initial layout from system size + location',
  // Phase 7: State Incentive Database
  'NEW: lib/incentives/stateIncentives.ts — all 50 states: ITC, credits, rebates, SRECs, TRECs',
  'NEW: lib/incentives/incentiveEngine.ts — full financial model with incentives (NPV, IRR, payback)',
  'NEW: app/api/incentives/route.ts — incentives by state/utility with system-specific calculation',
  // Phase 8: Enhanced Financial Modeling
  'NEW: Proposals — State-specific incentives section (auto-detected by project location)',
  'NEW: Proposals — Dynamic incentive breakdown: tax credits, rebates, SRECs, exemptions',
  // Phase 9: Auto Proposal Generation
  'NEW: Proposals — calculateIncentives() wired into proposal preview (all 50 states)',
  // Phase 10: UI — National Workflow
  'NEW: Projects/New — Upload Electric Bill button with BillUploadFlow integration',
  'NEW: Projects/New — Address field with auto-geocoding on blur + location tags',
  'NEW: Projects/New — Utility auto-detection display (name, rate, net metering status)',
  // Phase 11: National Scalability
  'UPGRADE: types/index.ts — Project type extended with stateCode, city, county, zip, utilityName, utilityRatePerKwh',
  // Phase 12: Co-op Expansion + Address Auto-Detection
  'UPGRADE: lib/utilityDetector.ts — All 50 states now include electric co-ops, REMCs, EMCs, REAs, PUDs, municipal utilities',
  'NEW: Engineering — Address onBlur auto-detects state + city + auto-selects first utility',
  'NEW: Engineering — State dropdown auto-selects first utility when state changes',
  'NEW: Engineering — Auto-detected badge shown when state matches address',
  'DATA: IL — 25 utilities including all major co-ops (Adams, Coles-Moultrie, Corn Belt, Eastern Illini, Egyptian, etc.)',
  'DATA: TX — 55+ utilities including all major co-ops (Pedernales, Bluebonnet, CoServ, Guadalupe Valley, etc.)',
  'DATA: IA — 30+ utilities including all major co-ops (Allamakee-Clayton, Boone Valley, Eastern Iowa, etc.)',
  'DATA: IN — 35+ utilities including all REMCs (Bartholomew, Boone, Carroll White, Daviess-Martin, etc.)',
  'DATA: GA — 30+ utilities including all EMCs (Cobb, Sawnee, Jackson, Walton, Snapping Shoals, etc.)',
  // Phase 13: Compliance Engine Fixes
  'FIX: Battery Backfeed NEC 705.12(B) — correct formula: Solar+Battery ≤ (Bus×1.2)−Main [was wrongly adding Main to load]',
  'FIX: Default rafterSpan 16ft → 12ft — 2×6 at 16ft always failed with snow load; 12ft is typical residential',
  'FIX: Busbar violation message — now shows full formula + remediation options (supply-side tap, derate, upgrade)',
  // Phase 14: BOM Wire Gauge Fix
  'FIX: BOM line items now generate ONE wire line item per gauge (#10/#8/#6/#4 AWG) matching summary card quantities',
  'FIX: BOM DC wire (ROOF_RUN #10 AWG) now appears as separate line item for microinverter systems',
  'FIX: BOM conduit now grouped by type+size — one line item per conduit type/size combination',
  'FIX: BOM wire quantities derived from ComputedSystem.runs (conductorCount × length × 1.15) — matches wire-in-conduit sizing section',
  // Phase 15: Generator Wire Run + 3D Performance + Ground Mount
  'NEW: Engineering — Generator to ATS Wire Length input (conditional, only shown when generator selected)',
  'NEW: Engineering — Live wire gauge/conduit/OCPD display from GENERATOR_TO_ATS_RUN when generator configured',
  'PERF: 3D — Incremental panel rendering (diff old vs new, only add/remove changed entities)',
  'PERF: 3D — Debounced panel useEffect (16ms batching prevents redundant rebuilds during auto-fill)',
  'PERF: 3D — clearPanels() resets incremental diff state for correct full rebuild on next render',
  'FIX: 3D — Row tool now inherits systemType from last active mode (roof/ground/fence) instead of hardcoded roof',
  'FIX: 3D — Ground row placement: switch to Ground mode then Row mode to place ground-type panel rows',
  // Phase 16: v30.7 — 3D Performance v2 + Ground Array Mode + AI Support Bot
  'PERF: 3D — React.memo with custom prop comparison (prevents re-renders on unrelated parent state changes)',
  'PERF: 3D — Dynamic shadow map resolution: 512px >800m, 1024px 300-800m, 2048px close-up (GPU load reduction)',
  'PERF: 3D — Camera-based tile LOD: maximumScreenSpaceError 32/16/4 based on camera height',
  'PERF: 3D — In-place entity position update (updates entity.position/orientation directly, eliminates flicker)',
  'PERF: 3D — Dynamic debounce window: 16ms single panel, 32ms 5+ panels, 50ms 20+ panels',
  'NEW: 3D — Ground Array mode (🌱 G-Array): chained row placement with auto-calculated inter-row spacing',
  'NEW: 3D — calcMinRowSpacing(): winter solstice shadow formula (tilt + latitude → minimum row spacing)',
  'NEW: 3D — Ground array keyboard shortcuts: Enter to finalize, Escape to cancel',
  'NEW: 3D — Ground array status UI: row count, panel count, kW, Confirm/Cancel buttons',
  'NEW: components/support/SolarAIBot.tsx — Free built-in AI chat widget (zero cost, no API keys)',
  'NEW: SolarAIBot — Rule-based pattern matching engine with 20+ solar knowledge base entries',
  'NEW: SolarAIBot — Covers: NEC wire sizing, panel placement, battery/generator wiring, BOM, SLD, proposals, incentives',
  'NEW: SolarAIBot — Quick replies, typing indicator, markdown formatting, floating button with unread badge',
  'NEW: app/layout.tsx — SolarAIBot integrated as global floating widget on all pages',
  // Phase 17: v30.9 — Panel Placement Engine v2
  'NEW: lib/placementEngine.ts — Grid snapping, orientation-aware layout, fire setback zones, multi-row placement',
  'NEW: PanelOrientation — portrait/landscape toggle swaps panel width/height for all layout calculations',
  'NEW: FireSetbackConfig — AHJ-configurable edge (18″), ridge (18″), pathway (36″) setbacks with per-AHJ override',
  'NEW: generateSetbackZones() — red restricted / green buildable polygon overlays on canvas',
  'NEW: generateAlignedGrid() — azimuth-rotated grid engine (ENU local frame + rotation + PIP test)',
  'NEW: generateMultipleRows() — multi-row placement from start/end line with auto row spacing',
  'NEW: calcMinRowSpacing() — winter solstice shadow formula (same as SolarEngine3D)',
  'NEW: snapToGrid() — invisible grid snapping anchored to first panel of array',
  'UPGRADE: panelLayoutOptimized.ts — orientation + fireSetbackM params, cache key uses panelW/panelH',
  'UPGRADE: DesignStudio — Portrait/Landscape toggle in Configuration sidebar',
  'UPGRADE: DesignStudio — Fire setback controls (edge/ridge sliders + pathway toggle) in sidebar',
  'UPGRADE: DesignStudio — Multi-row placement tool (⊞ toolbar button + row count selector)',
  'UPGRADE: DesignStudio — Setback zone overlay rendering (red/green zones on canvas)',
  'UPGRADE: DesignStudio — Multi-row guide line with cursor tracking on canvas',
  'UPGRADE: DesignStudio — Multi-row hint banner (top-center overlay when tool active)',
  'SAFE: All new features are additive — panel classification, BOM, proposals, engineering unchanged',
  // Phase 18: v31.1 — Interaction Audit & Repair
  'AUDIT: DIAGNOSTIC_REPORT.md — 9 bugs identified across 2D canvas + 3D Cesium engine',
  'FIX: 3D — drillPick replaces scene.pick() for panel selection (panels selectable through terrain/tile mesh)',
  'FIX: 2D — Per-panel orientation-aware hit detection (landscape panels now selectable)',
  'FIX: 2D — Per-panel systemType color (mixed roof+ground designs show correct colors)',
  'FIX: 2D — multiRowMode cleared when switching tools (Select tool no longer blocked)',
  'FIX: 2D — Keyboard shortcuts: V=Select, R=Roof, G=Ground, F=Fence, M=Measure, Del=Delete, Esc=Cancel',
  'FIX: 2D — Delete/Backspace key deletes selected panels (updates panel count + system size)',
  'FIX: 2D — Escape key cancels drawing / deactivates multi-row mode',
  'NEW: 2D — Active tool indicator (bottom-center canvas overlay with tool name + selection count)',
  'NEW: 3D — Active tool indicator badge in 3D toolbar (shows current PlacementMode)',
  'FIX: UI — 3D placement mode labels clarified (Place Roof / Place Ground vs ambiguous Roof/Ground)',
  'FIX: UI — Placement safety guard comment in handleCanvasClick (Select never places panels)',
  'SAFE: panel counting, systemType classification, engineering, BOM, proposals all unchanged',
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}