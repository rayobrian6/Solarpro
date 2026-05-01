// ============================================================================
// lib/system/electricalFromSurvey.ts — Survey → Electrical Integration
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   EnrichedSiteSurvey
//     → electricalFromSurvey() ← YOU ARE HERE
//       → InterconnectionInput  (electrical-calc.ts)
//       → ElectricalDefinition patches (systemDefinition.ts)
//       → SLD input data
//       → NEC 705.12 compliance context
//
// RESPONSIBILITIES:
//   1. Derive InterconnectionInput from survey panel data for electrical-calc.ts
//   2. Compute the preferred interconnection method (LOAD_SIDE, SUPPLY_SIDE_TAP,
//      MAIN_BREAKER_DERATE, PANEL_UPGRADE) based on NEC 705.12 120% rule
//   3. Build ElectricalDefinition override patch for systemDefinition.ts
//   4. Produce SLD (single-line diagram) input data from survey
//   5. Flag sub-panel, meter type, and service entrance for permit plan set
//
// NON-NEGOTIABLE RULES:
//   - NEVER throws — all errors are logged
//   - NEVER calls DB, network, or filesystem
//   - Input:  EnrichedSiteSurvey (output of enrichSurvey)
//   - Output: ElectricalFromSurveyResult
//   - electrical-calc.ts is NOT invoked here — this builds the inputs for it
// ============================================================================

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type EnrichedSiteSurvey,
} from '@/lib/siteSurvey/types';

import type {
  InterconnectionInput,
  InterconnectionMethod,
} from '@/lib/electrical-calc';

import type { ElectricalDefinition } from '@/lib/system/systemDefinition';

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * SLD input data derived from survey — used to pre-populate the single-line
 * diagram generator with field-verified electrical data.
 */
export interface SurveyDerivedSLDData {
  /** Main service panel label */
  mainPanelLabel: string;
  /** Main panel amperage */
  mainPanelAmps: number | null;
  /** Busbar amperage */
  busbarAmps: number | null;
  /** Main breaker size (assumed = main panel amps) */
  mainBreakerAmps: number | null;
  /** Service entrance type */
  serviceEntrance: string;
  /** Meter socket type */
  meterType: string;
  /** Interconnection point label */
  interconnectionPoint: string;
  /** Whether sub-panel exists */
  hasSubPanel: boolean | null;
  /** Sub-panel rating */
  subPanelAmps: number | null;
  /** Panel brand label (for SLD annotation) */
  panelBrandLabel: string;
  /** Whether panel brand is flagged (affects SLD notes) */
  panelBrandFlagged: boolean;
  /** NEC 705.12 compliance note for SLD */
  nec705Note: string;
}

/**
 * Full result of electricalFromSurvey().
 */
export interface ElectricalFromSurveyResult {
  /**
   * InterconnectionInput for electrical-calc.ts.
   * Contains the recommended method + panel data for NEC 705.12 check.
   * Caller passes this directly to calcInterconnection() in electrical-calc.ts.
   */
  interconnectionInput: InterconnectionInput | null;

  /** Recommended interconnection method + rationale */
  recommendedMethod: InterconnectionMethod;
  recommendedMethodRationale: string;

  /**
   * Partial ElectricalDefinition for override into systemDefinition.ts.
   * Caller merges these into the existing ElectricalDefinition.
   */
  electricalDefinitionPatch: Partial<ElectricalDefinition>;

  /** SLD input data for single-line diagram generation */
  sldData: SurveyDerivedSLDData;

  /**
   * NEC 705.12(B)(2) 120% rule result.
   * maxBackfeedAmps is the maximum allowed solar backfeed breaker size.
   * If ≤ 0, load-side interconnection is NOT possible without panel upgrade.
   */
  nec120PctRule: {
    busbarAmps: number | null;
    mainBreakerAmps: number | null;
    maxBackfeedAmps: number | null;
    passes: boolean;
    note: string;
  };

  /** Per-permit-sheet flags for PV-1 through PV-4 */
  permitFlags: {
    /** PV-1: Service entrance type for title block */
    serviceEntranceType: string;
    /** PV-2: Meter socket type for utility coordination */
    meterSocketType: string;
    /** PV-3: Interconnection method for electrical plan */
    interconnectionMethod: InterconnectionMethod;
    /** PV-3: Whether panel upgrade is required */
    panelUpgradeRequired: boolean;
    /** PV-3: Whether sub-panel is present (affects SLD) */
    subPanelPresent: boolean;
    /** PV-4: Whether flagged panel brand note is needed on plan set */
    flaggedPanelBrand: boolean;
    /** PV-4: Special handling notes for flagged panel brand */
    panelBrandNote: string | null;
  };

  /** Integration log */
  electricalLog: string[];
  warnings: string[];
}

// ─── Flagged panel brand set ──────────────────────────────────────────────────

const FLAGGED_BRANDS = new Set(['federal_pacific', 'zinsco']);

const PANEL_BRAND_DISPLAY: Record<string, string> = {
  siemens: 'Siemens',
  square_d: 'Square D / Schneider Electric',
  eaton: 'Eaton',
  cutler_hammer: 'Cutler-Hammer (Eaton)',
  ge: 'General Electric (GE)',
  federal_pacific: 'Federal Pacific Electric (FPE/Stab-Lok) ⚠',
  zinsco: 'Zinsco / Sylvania ⚠',
  leviton: 'Leviton',
  other: 'Other',
  unknown: 'Unknown',
};

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * electricalFromSurvey — derives electrical integration inputs from survey data.
 *
 * Pure synchronous function. Never throws.
 *
 * @param survey  EnrichedSiteSurvey (output of enrichSurvey)
 * @returns       ElectricalFromSurveyResult
 */
export function electricalFromSurvey(
  survey: EnrichedSiteSurvey,
): ElectricalFromSurveyResult {
  const log: string[] = [];
  const warnings: string[] = [];

  log.push(`[electrical] Building electrical integration for survey=${survey.id} project=${survey.projectId} pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  const e = survey.electrical;
  const ef = survey.derived.electricalFeasibility;

  // ── Resolve panel data ────────────────────────────────────────────────────────

  const mainPanelAmps = e.mainPanelRatingAmps;
  const busbarAmps = e.busbarRatingAmps;
  // For NEC 705.12, main breaker = main panel rating (worst case assumption)
  const mainBreakerAmps = mainPanelAmps;

  // ── NEC 705.12(B)(2) 120% rule ────────────────────────────────────────────────

  const nec120Result = computeNEC120PctRule(mainPanelAmps, busbarAmps, log);

  // ── Determine recommended interconnection method ───────────────────────────────

  const { method: recommendedMethod, rationale: recommendedMethodRationale } =
    resolveInterconnectionMethod(e, nec120Result, log, warnings);

  // ── Build InterconnectionInput ────────────────────────────────────────────────

  let interconnectionInput: InterconnectionInput | null = null;

  if (busbarAmps !== null && mainBreakerAmps !== null) {
    interconnectionInput = {
      method: recommendedMethod,
      busRating: busbarAmps,
      mainBreaker: mainBreakerAmps,
      // solarBreaker is omitted — electrical-calc.ts will compute the required size
    };
    log.push(`[electrical] InterconnectionInput: method=${recommendedMethod} busRating=${busbarAmps}A mainBreaker=${mainBreakerAmps}A`);
  } else {
    warnings.push(`Cannot build InterconnectionInput — main panel or busbar rating not captured`);
    log.push(`[electrical] WARN: InterconnectionInput skipped — missing panel data`);
  }

  // ── Build ElectricalDefinition patch ──────────────────────────────────────────

  const electricalDefinitionPatch: Partial<ElectricalDefinition> = {};
  if (mainPanelAmps !== null) {
    electricalDefinitionPatch.mainPanelAmps = mainPanelAmps;
    log.push(`[electrical] electricalDefinitionPatch.mainPanelAmps = ${mainPanelAmps}A`);
  }

  // ── Build SLD data ────────────────────────────────────────────────────────────

  const sldData = buildSLDData(survey, nec120Result, log);

  // ── Build permit flags ────────────────────────────────────────────────────────

  const permitFlags = buildPermitFlags(survey, recommendedMethod, nec120Result, log);

  // ── Warnings ──────────────────────────────────────────────────────────────────

  if (FLAGGED_BRANDS.has(e.panelBrand)) {
    warnings.push(`Panel brand '${e.panelBrand}' is flagged — replacement required before solar installation (PV-4 note required)`);
  }
  if (!nec120Result.passes && recommendedMethod === 'LOAD_SIDE') {
    warnings.push(`NEC 705.12 120% rule fails with load-side interconnection — panel upgrade may be required`);
  }
  if (e.breakerSpacesAvailable !== null && e.breakerSpacesAvailable < 1) {
    warnings.push(`No available breaker spaces — solar backfeed breaker cannot be added without panel work`);
  }

  log.push(`[electrical] Complete: method=${recommendedMethod} nec120=${nec120Result.passes ? 'PASS' : 'FAIL'} warnings=${warnings.length}`);

  return {
    interconnectionInput,
    recommendedMethod,
    recommendedMethodRationale,
    electricalDefinitionPatch,
    sldData,
    nec120PctRule: nec120Result,
    permitFlags,
    electricalLog: log,
    warnings,
  };
}

// ─── NEC 705.12(B)(2) 120% rule ───────────────────────────────────────────────

function computeNEC120PctRule(
  mainPanelAmps: number | null,
  busbarAmps: number | null,
  log: string[],
): ElectricalFromSurveyResult['nec120PctRule'] {
  if (busbarAmps === null || mainPanelAmps === null) {
    log.push(`[electrical] NEC 705.12: cannot compute — missing panel/busbar data`);
    return {
      busbarAmps,
      mainBreakerAmps: mainPanelAmps,
      maxBackfeedAmps: null,
      passes: true, // conservative: don't fail on missing data
      note: `NEC 705.12(B)(2) check unavailable — main panel or busbar rating not captured in survey`,
    };
  }

  // NEC 705.12(B)(2): sum of main breaker + solar backfeed breaker ≤ busbar × 1.2
  // → max_backfeed = (busbar × 1.2) - main_breaker
  const maxBackfeedAmps = Math.floor((busbarAmps * 1.2) - mainPanelAmps);
  const passes = maxBackfeedAmps > 0;

  const note = passes
    ? `NEC 705.12(B)(2) PASS — max backfeed breaker: ${maxBackfeedAmps}A (busbar=${busbarAmps}A × 1.2 − main=${mainPanelAmps}A)`
    : `NEC 705.12(B)(2) FAIL — load-side interconnection requires panel upgrade (busbar=${busbarAmps}A × 1.2 − main=${mainPanelAmps}A = ${maxBackfeedAmps}A ≤ 0)`;

  log.push(`[electrical] NEC 705.12: ${note}`);

  return {
    busbarAmps,
    mainBreakerAmps: mainPanelAmps,
    maxBackfeedAmps,
    passes,
    note,
  };
}

// ─── Interconnection method resolver ─────────────────────────────────────────

function resolveInterconnectionMethod(
  e: EnrichedSiteSurvey['electrical'],
  nec120: ElectricalFromSurveyResult['nec120PctRule'],
  log: string[],
  warnings: string[],
): { method: InterconnectionMethod; rationale: string } {
  // Rule 1: Supply-side explicit — use if inspector captured it
  if (e.interconnectionPoint === 'supply_side') {
    log.push(`[electrical] Method: SUPPLY_SIDE_TAP (inspector-captured)`);
    return {
      method: 'SUPPLY_SIDE_TAP',
      rationale: `Inspector captured supply-side interconnection — NEC 705.11 applies, 120% rule not required`,
    };
  }

  // Rule 2: Flagged panel — must upgrade regardless
  if (FLAGGED_BRANDS.has(e.panelBrand)) {
    log.push(`[electrical] Method: PANEL_UPGRADE (flagged panel brand=${e.panelBrand})`);
    return {
      method: 'PANEL_UPGRADE',
      rationale: `Panel brand '${e.panelBrand}' requires replacement — panel upgrade required before any interconnection`,
    };
  }

  // Rule 3: No breaker spaces — need to address panel capacity
  if (e.breakerSpacesAvailable !== null && e.breakerSpacesAvailable === 0) {
    log.push(`[electrical] Method: MAIN_BREAKER_DERATE (no breaker spaces available)`);
    return {
      method: 'MAIN_BREAKER_DERATE',
      rationale: `No available breaker spaces — main breaker derate method (NEC 705.12(B)(2)) or supply-side tap may be required`,
    };
  }

  // Rule 4: NEC 120% rule passes — load-side is preferred
  if (nec120.passes) {
    const method: InterconnectionMethod = 'LOAD_SIDE';
    log.push(`[electrical] Method: LOAD_SIDE (NEC 705.12(B)(2) passes, maxBackfeed=${nec120.maxBackfeedAmps}A)`);
    return {
      method,
      rationale: `NEC 705.12(B)(2) 120% rule passes — load-side backfeed allowed up to ${nec120.maxBackfeedAmps}A solar breaker`,
    };
  }

  // Rule 5: NEC 120% rule fails — recommend panel upgrade or derate
  if (nec120.maxBackfeedAmps !== null && nec120.maxBackfeedAmps <= 0) {
    // Check if derate is possible: main breaker > busbar × 0.2 means derate can help
    const canDerate = (nec120.mainBreakerAmps ?? 0) > ((nec120.busbarAmps ?? 0) * 0.2);
    if (canDerate) {
      log.push(`[electrical] Method: MAIN_BREAKER_DERATE (120% rule fails, derate possible)`);
      return {
        method: 'MAIN_BREAKER_DERATE',
        rationale: `NEC 705.12(B)(2) fails with current main breaker — main breaker derate may resolve (NEC 705.12(B)(2) alternative)`,
      };
    }
    log.push(`[electrical] Method: PANEL_UPGRADE (120% rule fails, derate not sufficient)`);
    return {
      method: 'PANEL_UPGRADE',
      rationale: `NEC 705.12(B)(2) fails and derate is insufficient — panel busbar upgrade required`,
    };
  }

  // Default: load-side (data insufficient to determine otherwise)
  log.push(`[electrical] Method: LOAD_SIDE (default — insufficient data for other methods)`);
  return {
    method: 'LOAD_SIDE',
    rationale: `Insufficient panel data for definitive method — defaulting to load-side (verify NEC 705.12 after panel inspection)`,
  };
}

// ─── SLD data builder ─────────────────────────────────────────────────────────

function buildSLDData(
  survey: EnrichedSiteSurvey,
  nec120: ElectricalFromSurveyResult['nec120PctRule'],
  log: string[],
): SurveyDerivedSLDData {
  const e = survey.electrical;
  const panelBrandFlagged = FLAGGED_BRANDS.has(e.panelBrand);
  const panelBrandLabel = PANEL_BRAND_DISPLAY[e.panelBrand] ?? e.panelBrand;

  // Build main panel label for SLD
  const mainPanelLabel = [
    panelBrandLabel,
    e.mainPanelRatingAmps ? `${e.mainPanelRatingAmps}A` : null,
    e.meterType !== 'unknown' ? `(${e.meterType})` : null,
  ].filter(Boolean).join(' ');

  // NEC 705 note for SLD
  const nec705Note = nec120.note;

  log.push(`[electrical] SLD: mainPanel="${mainPanelLabel}" service=${e.serviceEntrance} meter=${e.meterType} interconnect=${e.interconnectionPoint}`);

  return {
    mainPanelLabel,
    mainPanelAmps: e.mainPanelRatingAmps,
    busbarAmps: e.busbarRatingAmps,
    mainBreakerAmps: e.mainPanelRatingAmps, // conservative: main breaker = panel rating
    serviceEntrance: e.serviceEntrance,
    meterType: e.meterType,
    interconnectionPoint: e.interconnectionPoint,
    hasSubPanel: e.hasSubPanel,
    subPanelAmps: e.subPanelRatingAmps,
    panelBrandLabel,
    panelBrandFlagged,
    nec705Note,
  };
}

// ─── Permit flags builder ─────────────────────────────────────────────────────

function buildPermitFlags(
  survey: EnrichedSiteSurvey,
  method: InterconnectionMethod,
  nec120: ElectricalFromSurveyResult['nec120PctRule'],
  log: string[],
): ElectricalFromSurveyResult['permitFlags'] {
  const e = survey.electrical;
  const panelBrandFlagged = FLAGGED_BRANDS.has(e.panelBrand);

  // Panel upgrade required: explicit upgrade method OR 120% rule fails
  const panelUpgradeRequired =
    method === 'PANEL_UPGRADE' ||
    (!nec120.passes && method !== 'SUPPLY_SIDE_TAP');

  // Panel brand note for plan set
  const panelBrandNote = panelBrandFlagged
    ? `NOTICE: Existing panel (${PANEL_BRAND_DISPLAY[e.panelBrand] ?? e.panelBrand}) has known safety issues. ` +
      `Panel replacement is required prior to solar installation. ` +
      `Contractor shall coordinate panel upgrade per AHJ requirements.`
    : null;

  log.push(`[electrical] PermitFlags: method=${method} upgrade=${panelUpgradeRequired} subPanel=${e.hasSubPanel} flaggedBrand=${panelBrandFlagged}`);

  return {
    serviceEntranceType: e.serviceEntrance,
    meterSocketType: e.meterType,
    interconnectionMethod: method,
    panelUpgradeRequired,
    subPanelPresent: e.hasSubPanel === true,
    flaggedPanelBrand: panelBrandFlagged,
    panelBrandNote,
  };
}