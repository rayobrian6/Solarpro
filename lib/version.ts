/**
 * BUILD VERSION - Single source of truth for all version badges
 * Auto-increment BUILD_VERSION by 0.1 on every commit push
 */
export const BUILD_VERSION = 'v30.6';
export const BUILD_DATE = '2026-03-08';
export const BUILD_DESCRIPTION = '3D PERF + GROUND MOUNT — incremental panel rendering, debounced updates, row tool systemType context';
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
] as const;

export function getBuildBadge(): string {
  return `BUILD ${BUILD_VERSION} — ${BUILD_DESCRIPTION}`;
}