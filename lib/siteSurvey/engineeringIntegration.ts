// ============================================================================
// lib/siteSurvey/engineeringIntegration.ts — Survey → Engineering Integration
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   EnrichedSiteSurvey
//     → engineeringIntegration() ← YOU ARE HERE
//       → StructuralInput overrides (structural-calc.ts)
//       → FeasibilityInput context (feasibilityEvaluator.ts)
//
// RESPONSIBILITIES:
//   1. Build a StructuralInput override patch from survey structural data
//      (rafterSize, rafterSpacing, roofPitch, roofType, windExposure, snowLoad)
//   2. Build a FeasibilityContextPatch from survey electrical data
//      (mainPanelAmps, busbarAmps, interconnectionPoint, panelBrand flags)
//   3. Validate structural feasibility from enrichment flags
//   4. Emit warnings for any field defaulted due to missing survey data
//
// CONTRACTS:
//   - NEVER throws — all errors are logged and safe fallbacks used
//   - NEVER calls DB, network, or filesystem
//   - Input:  EnrichedSiteSurvey (output of enrichSurvey)
//   - Output: EngineeringIntegrationResult
//   - The structural-calc.ts and feasibilityEvaluator.ts are NOT invoked here —
//     this module provides inputs for the caller to invoke them with.
//
// PATTERN:
//   Mirrors how billEnrichment fills missing rate fields from survey data.
//   Each field resolved: log source, value, and confidence.
// ============================================================================

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type EnrichedSiteSurvey,
  type StructuralFeasibilityFlags,
  type ElectricalFeasibilityFlags,
} from './types';

import type {
  StructuralInput,
  WindExposureCategory as StructuralWindExposure,
  RoofType,
} from '@/lib/structural-calc';

// --- Output types -------------------------------------------------------------

/**
 * Partial StructuralInput built from survey data.
 * Fields are optional — caller merges these into their existing StructuralInput.
 * Survey data is authoritative for physical measurements (rafters, pitch, material).
 * Caller provides system-specific data (panel weight, attachment spacing, etc.).
 */
export type StructuralInputPatch = Partial<StructuralInput>;

/**
 * Electrical feasibility context from survey.
 * Used by the electrical integration module and permit pipeline.
 */
export interface ElectricalFeasibilityContext {
  /** NEC 705.12 120% rule — computed from survey panel/busbar data */
  mainPanelAmps: number | null;
  busbarAmps: number | null;
  maxBackfeedAmps: number | null;
  nec120PctLikelyPasses: boolean;
  /** True if panel brand requires special handling or replacement */
  panelBrandFlagged: boolean;
  panelBrand: string;
  /** True if load-side interconnection is possible */
  loadSideInterconnectionPossible: boolean;
  /** Interconnection point from survey */
  interconnectionPoint: string;
  /** Breaker spaces available for solar backfeed breaker */
  breakerSpacesAvailable: number | null;
  /** Summary flags for permit plan set */
  flags: string[];
  warnings: string[];
}

/**
 * Full engineering integration result.
 */
export interface EngineeringIntegrationResult {
  /** Partial StructuralInput to merge into structural-calc.ts call */
  structuralPatch: StructuralInputPatch;

  /** Electrical feasibility context for NEC 705.12 check and SLD generation */
  electricalContext: ElectricalFeasibilityContext;

  /**
   * Pre-computed feasibility flags from enrichment — available immediately
   * without re-running the full structural or electrical evaluation.
   */
  structuralFeasibility: StructuralFeasibilityFlags;
  electricalFeasibility: ElectricalFeasibilityFlags;

  /** Field resolution log — what was used and from where */
  integrationLog: string[];

  /** Warnings for missing or defaulted fields */
  warnings: string[];
}

// --- Roof type normalizer -----------------------------------------------------
// Maps survey roofMaterial strings → structural-calc.ts RoofType union.
// Must remain in sync with structural-calc.ts's RoofType type.

const ROOF_MATERIAL_MAP: Record<string, RoofType> = {
  // Shingle variants
  'shingle': 'shingle',
  'asphalt shingle': 'shingle',
  'asphalt': 'shingle',
  'composition shingle': 'shingle',
  'composition': 'shingle',
  '3-tab': 'shingle',
  'architectural': 'shingle',

  // Tile variants
  'tile': 'tile',
  'concrete tile': 'tile',
  'clay tile': 'tile',
  'ceramic tile': 'tile',
  's-tile': 'tile',
  'barrel tile': 'tile',
  'flat tile': 'tile',

  // Metal variants
  'metal': 'metal_standing_seam',
  'metal standing seam': 'metal_standing_seam',
  'standing seam': 'metal_standing_seam',
  'metal corrugated': 'metal_corrugated',
  'corrugated metal': 'metal_corrugated',
  'corrugated': 'metal_corrugated',
  'exposed fastener': 'metal_corrugated',
  'r-panel': 'metal_corrugated',

  // Flat/low slope variants
  'flat': 'flat_tpo',
  'flat tpo': 'flat_tpo',
  'tpo': 'flat_tpo',
  'tpo membrane': 'flat_tpo',
  'pvc': 'flat_tpo',
  'epdm': 'flat_epdm',
  'rubber': 'flat_epdm',
  'modified bitumen': 'flat_epdm',
  'built-up': 'flat_gravel',
  'bur': 'flat_gravel',
  'gravel': 'flat_gravel',
  'tar and gravel': 'flat_gravel',
};

function normalizeRoofType(
  roofMaterial: string | null,
  log: string[],
  warnings: string[],
): RoofType {
  const DEFAULT_ROOF_TYPE: RoofType = 'shingle';

  if (!roofMaterial) {
    warnings.push(`Roof material not captured — defaulting to '${DEFAULT_ROOF_TYPE}' for structural calc`);
    log.push(`[engineering] roofType: not captured — default='${DEFAULT_ROOF_TYPE}'`);
    return DEFAULT_ROOF_TYPE;
  }

  const key = roofMaterial.toLowerCase().trim();
  const mapped = ROOF_MATERIAL_MAP[key];
  if (mapped) {
    log.push(`[engineering] roofType: "${roofMaterial}" → '${mapped}'`);
    return mapped;
  }

  // Partial match fallback
  if (key.includes('shingle') || key.includes('asphalt')) {
    log.push(`[engineering] roofType: "${roofMaterial}" partial match → 'shingle'`);
    return 'shingle';
  }
  if (key.includes('tile')) {
    log.push(`[engineering] roofType: "${roofMaterial}" partial match → 'tile'`);
    return 'tile';
  }
  if (key.includes('metal') || key.includes('standing seam')) {
    log.push(`[engineering] roofType: "${roofMaterial}" partial match → 'metal_standing_seam'`);
    return 'metal_standing_seam';
  }
  if (key.includes('flat') || key.includes('tpo') || key.includes('membrane')) {
    log.push(`[engineering] roofType: "${roofMaterial}" partial match → 'flat_tpo'`);
    return 'flat_tpo';
  }

  warnings.push(`Unrecognized roof material "${roofMaterial}" — defaulting to '${DEFAULT_ROOF_TYPE}'`);
  log.push(`[engineering] roofType: "${roofMaterial}" unrecognized — default='${DEFAULT_ROOF_TYPE}'`);
  return DEFAULT_ROOF_TYPE;
}

// --- Main integration function ------------------------------------------------

/**
 * buildEngineeringIntegration — derives structural and electrical inputs
 * from an EnrichedSiteSurvey for use by structural-calc.ts and feasibilityEvaluator.ts.
 *
 * Pure synchronous function. Never throws.
 *
 * @param survey   EnrichedSiteSurvey (output of enrichSurvey)
 * @returns        EngineeringIntegrationResult with patches and pre-computed flags
 */
export function buildEngineeringIntegration(
  survey: EnrichedSiteSurvey,
): EngineeringIntegrationResult {
  const log: string[] = [];
  const warnings: string[] = [];

  log.push(`[engineering] Building integration for survey=${survey.id} project=${survey.projectId} pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  // Build structural patch
  const structuralPatch = buildStructuralPatch(survey, log, warnings);

  // Build electrical context
  const electricalContext = buildElectricalContext(survey, log, warnings);

  // Extract pre-computed feasibility flags
  const structuralFeasibility = survey.derived.structuralFeasibility;
  const electricalFeasibility = survey.derived.electricalFeasibility;

  log.push(`[engineering] Complete: ${Object.keys(structuralPatch).length} structural fields, ${warnings.length} warnings`);

  return {
    structuralPatch,
    electricalContext,
    structuralFeasibility,
    electricalFeasibility,
    integrationLog: log,
    warnings,
  };
}

// --- Structural patch builder -------------------------------------------------

function buildStructuralPatch(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): StructuralInputPatch {
  const s = survey.structural;
  const patch: StructuralInputPatch = {};

  // Wind speed — not in survey, caller must provide from ASCE 7 wind map
  log.push(`[engineering] windSpeed: not in survey — caller must provide from ASCE 7 wind map`);

  // Wind exposure — survey captures directly from inspector observation
  const windExposure = s.windExposure as StructuralWindExposure;
  patch.windExposure = windExposure;
  log.push(`[engineering] windExposure: '${windExposure}' (from survey)`);

  // Ground snow load
  if (s.snowLoadPsf !== null) {
    patch.groundSnowLoad = s.snowLoadPsf;
    log.push(`[engineering] groundSnowLoad: ${s.snowLoadPsf} psf (from survey)`);
  } else {
    warnings.push(`groundSnowLoad not captured in survey — caller must provide from AHJ snow map`);
    log.push(`[engineering] groundSnowLoad: not captured — caller must provide`);
  }

  // Roof type
  patch.roofType = normalizeRoofType(s.roofMaterial, log, warnings);

  // Roof pitch
  if (s.roofPitchDegrees !== null) {
    patch.roofPitch = s.roofPitchDegrees;
    log.push(`[engineering] roofPitch: ${s.roofPitchDegrees}° (from survey structural data)`);
  } else if (survey.geometry.roofPlanes.length > 0) {
    const primaryPitch = survey.geometry.roofPlanes[0].pitch;
    if (primaryPitch > 0) {
      patch.roofPitch = primaryPitch;
      log.push(`[engineering] roofPitch: ${primaryPitch}° (from primary roof plane)`);
    } else {
      warnings.push(`Roof pitch not available — structural calc will use its own default`);
      log.push(`[engineering] roofPitch: not available`);
    }
  } else {
    warnings.push(`Roof pitch not available — structural calc will use its own default`);
  }

  // Rafter spacing — check if explicitly captured vs defaulted
  const rafterSpacingCaptured = !survey.normalizationLog.some(
    l => l.includes('rafterSpacingIn not provided')
  );
  if (rafterSpacingCaptured) {
    patch.rafterSpacing = s.rafterSpacingIn;
    log.push(`[engineering] rafterSpacing: ${s.rafterSpacingIn}" OC (from survey)`);
  } else {
    warnings.push(`Rafter spacing not explicitly captured — using normalized default ${s.rafterSpacingIn}"`);
    log.push(`[engineering] rafterSpacing: defaulted to ${s.rafterSpacingIn}" (not explicitly captured)`);
    patch.rafterSpacing = s.rafterSpacingIn;
  }

  // Rafter size
  if (s.rafterSize !== 'other') {
    patch.rafterSize = s.rafterSize;
    log.push(`[engineering] rafterSize: '${s.rafterSize}' (from survey)`);
  } else {
    warnings.push(`Rafter size captured as 'other' — structural calc will use its own default`);
    log.push(`[engineering] rafterSize: 'other' — not applied to patch`);
  }

  // System type
  const structuralSystemType = survey.systemType === 'roof'
    ? 'roof' as const
    : survey.systemType === 'ground'
    ? 'ground' as const
    : 'roof' as const;
  patch.systemType = structuralSystemType;
  log.push(`[engineering] systemType: '${structuralSystemType}'`);

  // Array tilt
  if (s.roofPitchDegrees !== null) {
    patch.arrayTilt = s.roofPitchDegrees;
  } else if (survey.geometry.roofPlanes.length > 0) {
    patch.arrayTilt = survey.geometry.roofPlanes[0].pitch;
  }

  return patch;
}

// --- Electrical context builder -----------------------------------------------

function buildElectricalContext(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): ElectricalFeasibilityContext {
  const e = survey.electrical;
  const ef = survey.derived.electricalFeasibility;
  const flags: string[] = [...ef.flags];

  // NEC 705.12 120% rule
  const mainPanelAmps = e.mainPanelRatingAmps;
  const busbarAmps = e.busbarRatingAmps;
  const { maxBackfeedAmps, likelyPasses: nec120PctLikelyPasses } = ef.nec120PctRule;

  log.push(`[engineering] electrical: main=${mainPanelAmps ?? 'none'}A busbar=${busbarAmps ?? 'none'}A maxBackfeed=${maxBackfeedAmps ?? 'none'}A nec120=${nec120PctLikelyPasses ? 'PASS' : 'FAIL'}`);

  // Panel brand flags
  const panelBrandFlagged = !ef.checks.notFederalPacificOrZinsco;
  if (panelBrandFlagged) {
    flags.push(`Panel brand '${e.panelBrand}' is flagged — replacement required before solar installation`);
    log.push(`[engineering] WARN: panelBrand=${e.panelBrand} is flagged`);
  }

  // Load-side interconnection possibility
  const loadSideInterconnectionPossible = (
    e.interconnectionPoint === 'main_panel' ||
    e.interconnectionPoint === 'sub_panel' ||
    e.interconnectionPoint === 'load_side'
  ) && nec120PctLikelyPasses;

  log.push(`[engineering] load-side interconnection: ${loadSideInterconnectionPossible ? 'possible' : 'not confirmed'} (point=${e.interconnectionPoint})`);

  // Breaker spaces warnings
  if (e.breakerSpacesAvailable !== null && e.breakerSpacesAvailable < 2) {
    warnings.push(`Only ${e.breakerSpacesAvailable} breaker space(s) available — may require tandem breaker or sub-panel`);
  }

  // Interconnection point warnings
  if (e.interconnectionPoint === 'supply_side') {
    warnings.push(`Supply-side interconnection detected — requires utility approval and special metering`);
    log.push(`[engineering] WARN: supply-side interconnection — extra approval required`);
  }
  if (e.interconnectionPoint === 'unknown') {
    warnings.push(`Interconnection point not captured — required for SLD generation`);
  }

  return {
    mainPanelAmps,
    busbarAmps,
    maxBackfeedAmps,
    nec120PctLikelyPasses,
    panelBrandFlagged,
    panelBrand: e.panelBrand,
    loadSideInterconnectionPossible,
    interconnectionPoint: e.interconnectionPoint,
    breakerSpacesAvailable: e.breakerSpacesAvailable,
    flags,
    warnings: [...ef.warnings, ...warnings],
  };
}

// --- Convenience: merge structural patch into existing StructuralInput ---------

/**
 * mergeStructuralPatch — safely merges a StructuralInputPatch into an
 * existing StructuralInput without overwriting non-null values that the
 * engineering pipeline has already confirmed.
 *
 * RULE: Survey data wins for physical site measurements.
 *       Engineering defaults win for system-specific data (panel count, etc.).
 *
 * @param base   Existing StructuralInput from engineering pipeline
 * @param patch  Survey-derived StructuralInputPatch
 * @returns      Merged StructuralInput (new object — base is not mutated)
 */
export function mergeStructuralPatch(
  base: StructuralInput,
  patch: StructuralInputPatch,
): StructuralInput {
  // Physical site measurements — survey wins
  const SURVEY_WINS: Array<keyof StructuralInput> = [
    'windExposure',
    'groundSnowLoad',
    'roofType',
    'roofPitch',
    'rafterSpacing',
    'rafterSize',
    'arrayTilt',
    'systemType',
  ];

  const merged: StructuralInput = { ...base };

  for (const key of SURVEY_WINS) {
    const patchValue = patch[key];
    if (patchValue !== null && patchValue !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = patchValue;
    }
  }

  return merged;
}