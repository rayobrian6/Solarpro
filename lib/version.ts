// lib/version.ts — SolarPro Build Version
export const BUILD_VERSION     = 'v45.2';
export const BUILD_DATE        = '2025-01-12';
export const BUILD_DESCRIPTION = 'Plan Set payload now reads from computedSystem — single source of truth end-to-end';
export const BUILD_FEATURES    = [
  'UI plan set payload now reads from computedSystem (cs) — no more stale config.* values',
  'dcWireGauge from cs.runMap[DC_STRING_RUN].wireGauge (was: config.wireGauge)',
  'acWireGauge from cs.runMap[DISCO_TO_METER_RUN].wireGauge (was: compliance.electrical.acWireGauge)',
  'acBreakerAmps/acDisconnectAmps from cs.acOcpdAmps (was: Math.ceil duplicate NEC calc)',
  'backfeedBreakerAmps from cs.backfeedBreakerAmps (was: compliance.electrical.busbar || 20)',
  'groundWireGauge from cs.runMap[DC_STRING_RUN].egcGauge (was: hardcoded #8 AWG)',
  'planStrings[i].ocpdAmps/wireGauge/stringVoc/Isc from cs.strings[i] (was: compliance fallback)',
  'Design Studio SLD and Permit Plan Set now use identical engine output',
  'Cover sheet engine version string is now dynamic (BUILD_VERSION — no more hardcoded v44.0)',
  '7-sheet permit plan set: G-1, E-1, E-2, S-1, A-1, M-1, C-1',
];

export function getBuildBadge(): string {
  return `SolarPro ${BUILD_VERSION} · ${BUILD_DATE}`;
}

export const VERSION_HISTORY = [
  {
    version: 'v45.1',
    date:    '2025-01-12',
    summary: 'Architecture Refactor — Single Source of Truth extended to Design Studio SLD',
    changes: [
      'AUDIT FIX: /api/engineering/sld was not using PermitSystemModel — now it does',
      'REFACTOR: sld/route.ts imports buildPermitSystemModel(), calls it after computeSystem()',
      'FIX: acOCPD on Design Studio SLD now from systemModel.acOcpdAmps (NEC engine)',
      'FIX: backfeedAmps now from systemModel.backfeedBreakerAmps (NEC engine)',
      'FIX: dcWireGauge now from systemModel.dcWireGauge (NEC engine)',
      'FIX: acWireGauge now from systemModel.acWireGauge (NEC engine)',
      'FIX: egcGauge now from systemModel.egcGauge — NEC 250.122 table (no more hardcoded #10)',
      'FIX: dcOCPD now from systemModel.stringOcpdAmps (NEC engine)',
      'CLEAN: Removed duplicate Math.ceil(acOutputAmps * 1.25 / 5) * 5 from sld/route.ts',
      'NEW: SLDProfessionalInput accepts systemModel?: PermitSystemModel and egcGauge?: string',
      'NEW: All EGC wire labels in renderer now use engine-computed gauge (egcNum)',
      'TRACE: X-System-Model: computed | fallback header on all SLD responses',
      'TRACE: resolvedValues block in SLD JSON response for debugging',
    ],
  },
  {
    version: 'v45.0',
    date:    '2025-01-12',
    summary: 'Architecture Refactor — Single Source of Truth for Permit Generator',
    changes: [
      'ARCH: Permit plan set generator is now a pure visual renderer — zero duplicate NEC calculations',
      'ARCH: computeSystem() called ONCE at route entry — all NEC 690.7/690.8/310.15/705.12 values come from engine',
      'NEW:  lib/plan-set/permit-system-model.ts — PermitSystemModel bridge type + buildPermitSystemModel()',
      'REFACTOR: route.ts — imports computeSystem(), builds PermitSystemModel, passes to all sheet builders',
      'REFACTOR: electrical-sheet.ts — accepts systemModel: PermitSystemModel, renders pre-computed values only',
      'CLEAN: Removed duplicate NEC 690.7 table, vocTableFactor(), ambientCorrectionFactor90C() from electrical-sheet.ts',
      'CLEAN: Removed duplicate WIRE_AMPACITY_90C table and wireAmpacity lookup from route.ts',
      'CLEAN: Removed duplicate wire gauge / OCPD derivation from route.ts (now from system model)',
      'FIX:   Wire gauges on SLD now from computeSystem runs (DC_STRING_RUN, DISCO_TO_METER_RUN)',
      'FIX:   Backfeed breaker size on SLD now from computeSystem.backfeedBreakerAmps',
      'FIX:   EGC gauge now from computeSystem runs egcGauge (NEC 250.122 table)',
      'FIX:   AC OCPD on compliance sheet now from computeSystem.acOcpdAmps',
      'TRACE: X-System-Model response header indicates computed vs fallback mode',
      'DATA:  systemModelUsed field in JSON response',
    ],
  },
  {
    version: 'v44.0',
    date:    '2025-01-11',
    summary: '7-Sheet Permit Plan Set + v44.0 Field Upgrades',
    changes: [
      'NEW: A-1 Site/Roof Layout sheet with roof outline SVG, panel placement, fire setbacks',
      'NEW: M-1 Mounting Details sheet with 6 detail diagrams (rail, flashing, splice, bonding, lug)',
      'NEW: plan-set route.ts fully rewritten — 7 sheets, all v44.0 fields',
      'UPD: G-1 cover sheet — ownerContact, inverterKw, stringCount, panelsPerString, electricalLicense',
      'UPD: E-1 electrical sheet — full NEC 690.7 temp-corrected Voc calculation block',
      'UPD: E-1 — NEC 690.8(B) rooftop temp derating with formula display',
      'UPD: E-1 — NEC 705.12 120% rule with full formula and auto-correction',
      'UPD: E-1 — inverter spec block with MPPT range, max DC input',
      'UPD: S-1 structural — auto-fix attachment spacing, ASCE 7-22 load combos, detail diagrams',
      'UPD: C-1 compliance — all FAIL replaced with WARNING/REVIEW REQUIRED',
      'UPD: UI — 7 sheet cards (grid-cols-7), A-1 and M-1 preview modals',
      'UPD: version badge shows v44.0',
    ],
  },
  {
    version: 'v43.1.4',
    date:    '2025-01-10',
    summary: 'Previous stable release',
    changes: ['5-sheet plan set', 'String inverter + micro SLD', 'Basic NEC compliance'],
  },
];