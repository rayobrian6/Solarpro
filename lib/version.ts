// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.3';
export const BUILD_DATE        = '2026-03-11';
export const BUILD_DESCRIPTION = 'E-1 SLD now uses pre-rendered SVG from Design Studio — no more duplicate SLD generation';
export const BUILD_FEATURES    = [
  'E-1 plan-set page now uses the pre-rendered SLD SVG from Design Studio (existingSvg passthrough)',
  'Eliminates duplicate SLD generation — plan set E-1 always matches the SLD tab exactly',
  'electrical-sheet.ts: existingSvg field added to ElectricalSheetInput interface',
  'route.ts: sldSvg accepted from request body, passed as existingSvg to buildElectricalSheet',
  'page.tsx: sldSvg state variable included in plan-set payload',
  'UI plan set payload reads from computedSystem (cs) — no more stale config.* values',
  'dcWireGauge from cs.runMap[DC_STRING_RUN].wireGauge (was: config.wireGauge)',
  'acWireGauge from cs.runMap[DISCO_TO_METER_RUN].wireGauge (was: compliance.electrical.acWireGauge)',
  'acBreakerAmps/acDisconnectAmps from cs.acOcpdAmps (was: Math.ceil duplicate NEC calc)',
  'backfeedBreakerAmps from cs.backfeedBreakerAmps (was: compliance.electrical.busbar || 20)',
  'groundWireGauge from cs.runMap[DC_STRING_RUN].egcGauge (was: hardcoded #8 AWG)',
  'planStrings[i].ocpdAmps/wireGauge/stringVoc/Isc from cs.strings[i] (was: compliance fallback)',
  'Cover sheet engine version string is now dynamic (BUILD_VERSION — no more hardcoded v44.0)',
  '7-sheet permit plan set: G-1, E-1, E-2, S-1, A-1, M-1, C-1',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}
