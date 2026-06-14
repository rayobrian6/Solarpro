// ============================================================================
// v47.438 - Usable Roof Area Computer
//
// Computes usable roof area percentage from obstructions + roof geometry.
// Can be called:
//   1. As part of the satellite analysis pipeline (pre-fill)
//   2. Independently when the user manually adds/removes obstructions
//   3. From the Design Studio when panel layout changes
//
// Returns a ComputedFieldValue-compatible result for the ComputedField UX.
// ============================================================================

import type { Obstruction, ObstructionType } from '../survey/v2/types';
import type { ConfidenceLevel } from '../../components/recommend/ConfidenceBadge';

// ---------------------------------------------------------------------------
// Obstruction area impact (percentage reduction of usable roof)
// ---------------------------------------------------------------------------
const OBSTRUCTION_AREA_IMPACT: Record<ObstructionType, number> = {
  chimney: 3,
  hvac_unit: 8,
  vent_pipe: 1,
  skylight: 4,
  dormer: 10,
  tree_shade: 15,
  antenna: 2,
  satellite_dish: 2,
  exhaust_fan: 2,
  solar_tube: 2,
  other: 5,
};

// ---------------------------------------------------------------------------
// Standard fire setback reductions by pitch
// ---------------------------------------------------------------------------
const SETBACK_BASE_PCT: Record<string, number> = {
  residential: 80,   // 3ft ridge, 3ft sides, 3ft valley
  commercial: 75,    // Wider setbacks often required
  industrial: 75,
  default: 80,
};

// ---------------------------------------------------------------------------
// Computed usable area result
// ---------------------------------------------------------------------------
export interface UsableAreaResult {
  /** Usable percentage 0-100 */
  usablePct: number;
  /** Confidence of the estimate */
  confidence: ConfidenceLevel;
  /** Source label for ConfidenceBadge */
  source: 'satellite' | 'local_calc' | 'survey';
  /** Human-readable derivation */
  derivation: string;
  /** Total reduction from obstructions (percentage points) */
  obstructionReductionPct: number;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------
export function computeUsableRoofArea(input: {
  obstructions: Obstruction[];
  structureType?: string;
  /** If obstructions came from satellite detection */
  obstructionsSource?: 'satellite' | 'survey' | 'manual';
  /** Override the base setback percentage */
  baseSetbackPct?: number;
}): UsableAreaResult {
  const { obstructions, structureType, obstructionsSource, baseSetbackPct } = input;

  // Base usable percentage after standard fire setbacks
  const structKey = structureType ?? 'default';
  const basePct = baseSetbackPct ?? SETBACK_BASE_PCT[structKey] ?? 80;

  // Calculate total obstruction impact
  let reduction = 0;
  for (const obs of obstructions) {
    reduction += OBSTRUCTION_AREA_IMPACT[obs.type] ?? 5;
  }

  // Cap reduction at 60% (even the most obstructed roof has some usable area)
  reduction = Math.min(reduction, 60);

  const usablePct = Math.max(5, basePct - reduction);

  // Determine confidence based on source
  let confidence: ConfidenceLevel;
  let source: UsableAreaResult['source'];

  if (obstructionsSource === 'satellite') {
    confidence = usablePct >= 60 ? 'medium' : 'low';
    source = 'satellite';
  } else if (obstructionsSource === 'survey') {
    confidence = 'high';
    source = 'survey';
  } else {
    // Manual or unknown source -- treat as local calc
    confidence = obstructions.length > 0 ? 'medium' : 'low';
    source = 'local_calc';
  }

  // Build derivation string
  const derivation = obstructions.length > 0
    ? `Base ${basePct}% (standard fire setbacks) - ${reduction}% from ${obstructions.length} obstruction${obstructions.length !== 1 ? 's' : ''} = ${usablePct}% usable`
    : `Estimated ${usablePct}% after standard fire setbacks (no obstructions mapped)`;

  return {
    usablePct,
    confidence,
    source,
    derivation,
    obstructionReductionPct: reduction,
  };
}

// ---------------------------------------------------------------------------
// Quick estimate with no obstructions (for initial pre-fill)
// ---------------------------------------------------------------------------
export function quickUsableAreaEstimate(
  structureType?: string,
): UsableAreaResult {
  const structKey = structureType ?? 'default';
  const basePct = SETBACK_BASE_PCT[structKey] ?? 80;

  return {
    usablePct: basePct,
    confidence: 'low',
    source: 'local_calc',
    derivation: `Estimated ${basePct}% after standard fire setbacks (no obstructions mapped yet)`,
    obstructionReductionPct: 0,
  };
}
