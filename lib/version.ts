// lib/version.ts -- SolarPro Build Version
export const BUILD_VERSION     = 'v47.49';
export const APP_VERSION       = BUILD_VERSION; // alias used by health route
export const BUILD_DATE        = '2026-03-14';
export const BUILD_DESCRIPTION = 'v47.49: Pipeline verification — debug page, version footer, layout DB audit';
export const BUILD_FEATURES    = [
  // v47.46 -- Full 13-page permit planset pipeline
  'PERMIT: 13-page planset (was 11) — PV-0 through E-1 (sheets 1 of 13 .. 13 of 13)',
  'PERMIT: pageArrayGeometry() — PV-2B: SVG panel grid, string color-coding, IFC §605.11 fire setback diagram, array parameters table',
  'PERMIT: pageSpecSheetReference() — APP-A: NEC 690.8 safety factor calcs (×1.25), module/inverter/racking specs, manufacturer data sheet links',
  'PERMIT: pageSiteInformation() — PV-1: replaced placeholder with full SVG schematic site plan (house, garage, array, meter, inverter, disco, MSP, conduit, north arrow)',
  'PERMIT: Cover sheet index updated to list all 13 sheets: PV-0 PV-1 PV-2A PV-2B PV-3 PV-4A PV-4B PV-4C PV-5 SCHED APP-A CERT E-1',
  'EQUIPMENT: lib/equipment/specSheets.ts — new spec sheet database for REC, LG, SunPower, Jinko, LONGi, Q CELLS, Canadian Solar, Silfab, Enphase, SolarEdge, Fronius, SMA, Tesla, IronRidge, Unirac',
  'EQUIPMENT: findModuleSpec(), findInverterSpec(), findBatterySpec(), findRackingSpec(), getPermitSpecSheets(), getGenericModuleSpecs()',
  'DATA: DesignStudio.tsx — critical fix: roofPlanes now saved to DB via roofPlanesRef pattern (were only in component state)',
  'DATA: sendBeacon() on page unload now includes roofPlanes in payload',
  // v47.45 -- Professional permit planset upgrades
  'PERMIT: Panel positions from 3D design engine rendered on roof plan',
  'PERMIT: AHJ auto-lookup from national database by state/county/city',
  'PERMIT: NEC 220.82 load calculation with actual service panel data',
  'PERMIT: 11×17 ANSI B page size (279.4mm × 431.8mm)',
  'PERMIT: Enhanced BOM with per-roof-plane attachment calculations',
  'PERMIT: Roof plane overlay on aerial imagery',
  'ENGINEERING: engineering/page.tsx — projectLayout state wiring (projectLayout useState + GET /layout fetch)',
  'ENGINEERING: zip field added to ProjectConfig interface for AHJ lookup',
  // v47.44 -- Universal equipment resolver
  'PERMIT: resolveEquipment() — 4-tier fallback: strings[] -> modules[] -> project fields -> system totals',
  'PERMIT: BOM table — panelMfr/panelModel now resolved from any payload shape (no more hardcoded fallbacks)',
  'PERMIT: NEC labels — panelIsc/panelVoc resolved from any payload shape (removed strings[0] hardcode)',
  'PERMIT: SLD builder — all 6 equipment fields resolved from any payload shape (removed Q.PEAK/IQ8M/Enphase hardcodes)',
  'PERMIT: Works with UI strings payload, modules[] array, project-level fields, or system totals only',
  // v47.38 -- Full 11-page permit plan set with SLD
  'PERMIT: pageSingleLineDiagram() — Sheet E-1 added to route.ts — IEEE/ANSI SVG SLD renderer',
  'PERMIT: Full MICROINVERTER topology: PV Array → J-Box → AC Combiner → AC Disco → MSP → IQ SC3/BUI → Utility Meter',
  'PERMIT: Battery storage shown (IQ Battery 5P × 2 connected via BUI) — NEC 705.12(B) 120% rule',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} - ${BUILD_DATE}`;
}