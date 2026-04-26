/**
 * lib/proposal/utilityTruthEngine.ts
 * v47.248 — Utility Truth Engine
 *
 * Formalizes the provenance and confidence tagging of utility data used in proposals.
 * Does NOT make external API calls — operates entirely on structured pipeline data.
 *
 * RESPONSIBILITIES:
 *   1. Tag the escalation rate source (utility_profile / state_avg_eia / fallback_unverified)
 *   2. Produce human-readable source labels for UI display
 *   3. Compute overall TruthConfidence for the proposal
 *   4. Surface UNVERIFIED_UTILITY_DATA flag when provider is unknown
 *
 * RULE: No hardcoded 3% without a source label. Every escalation % displayed
 *       in the UI must carry its source string from this engine.
 */

import type { EscalationRateSource, TruthConfidence } from './canonicalProposal';
import type { BuiltUtilityProfile } from '../proposalTruthEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Escalation Source Resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface EscalationSourceResult {
  /** The machine-readable source tag */
  source: EscalationRateSource;
  /** Human-readable label for UI display — always includes data origin */
  label: string;
  /** True when source is unverified — triggers UNVERIFIED_UTILITY_DATA flag */
  flagged: boolean;
}

/**
 * Resolves the source and label for the escalation rate assumption.
 *
 * Decision logic:
 *   - is_specific_match = true  → utility_profile (data from PROPOSAL_UTILITY_PROFILES)
 *   - is_state_fallback = true  → state_avg_eia   (STATE_UTILITY_FALLBACK from EIA 2024)
 *   - neither                   → fallback_unverified (hardcoded 3%, must be flagged)
 */
export function resolveEscalationSource(
  builtProfile: BuiltUtilityProfile,
  stateCode?: string
): EscalationSourceResult {
  const profile = builtProfile.profile;
  const stateName = stateCode ? stateCode.toUpperCase() : null;

  if (builtProfile.is_specific_match) {
    // High confidence: matched to a specific utility in our structured database
    const utilityName = profile.utility_name_pattern
      ? profile.utility_name_pattern.split('|')[0].replace(/[^a-zA-Z0-9& ]/g, '').trim()
      : 'utility profile';
    return {
      source: 'utility_profile',
      label: `based on ${profile.utility_id} utility profile data (${profile.last_updated})`,
      flagged: false,
    };
  }

  if (builtProfile.is_state_fallback && stateName && stateName.length === 2) {
    // Medium confidence: state-level average from EIA 2024 data
    return {
      source: 'state_avg_eia',
      label: `based on ${stateName} state avg — EIA 2024 data`,
      flagged: false,
    };
  }

  // Low confidence: complete fallback — no state code, no specific utility
  return {
    source: 'fallback_unverified',
    label: 'fallback estimate — utility data not verified',
    flagged: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Truth Confidence Computation
// ─────────────────────────────────────────────────────────────────────────────

export interface TruthConfidenceResult {
  level: TruthConfidence;
  /** Short human-readable description for UI badge */
  description: string;
  /** Detailed tooltip text */
  detail: string;
}

/**
 * Computes the overall TruthConfidence level for a proposal.
 *
 * VERIFIED:  Specific utility profile matched AND rate came from project/bill override
 * PARTIAL:   State fallback used OR rate is estimated (not from bill)
 * ESTIMATED: No specific utility match AND no bill-derived rate — all projections estimated
 *
 * @param builtProfile   The resolved BuiltUtilityProfile from buildUtilityProfile()
 * @param hasRateOverride  True if utilityRateOverride or clientUtilityRate was provided (> 0.10)
 * @param stateCode        2-letter state code (required for PARTIAL elevation)
 */
export function computeTruthConfidence(
  builtProfile: BuiltUtilityProfile,
  hasRateOverride: boolean,
  stateCode?: string
): TruthConfidenceResult {
  const hasSpecificMatch = builtProfile.is_specific_match;
  const hasStateCode = !!(stateCode && stateCode.length === 2);
  const dataConfidence = builtProfile.profile.data_confidence;

  if (hasSpecificMatch && hasRateOverride && dataConfidence === 'high') {
    return {
      level: 'VERIFIED',
      description: 'Verified',
      detail:
        'This proposal uses a verified utility profile with a bill-derived rate. ' +
        'All projections are based on real utility data.',
    };
  }

  if (hasSpecificMatch || (hasStateCode && hasRateOverride)) {
    return {
      level: 'PARTIAL',
      description: 'Partial',
      detail:
        hasSpecificMatch
          ? 'Utility profile matched but rate may be estimated. Projections use profile escalation data.'
          : 'Rate from bill but utility-specific escalation not available. State average used.',
    };
  }

  if (hasStateCode) {
    return {
      level: 'PARTIAL',
      description: 'Partial',
      detail:
        'No specific utility profile matched. State-level average data used for projections. ' +
        'Actual savings may vary.',
    };
  }

  return {
    level: 'ESTIMATED',
    description: 'Estimated',
    detail:
      'No utility profile or state data available. All projections are conservative estimates. ' +
      'Provide utility name and state for more accurate figures.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNVERIFIED_UTILITY_DATA flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the utility provider is unknown and ALL projections
 * should carry the "UNVERIFIED UTILITY DATA" label.
 */
export function isUnverifiedUtilityData(builtProfile: BuiltUtilityProfile): boolean {
  // v48.3 fix: previous condition (!is_specific_match && !is_state_fallback) was always
  // false because is_state_fallback = !is_specific_match by construction in buildUtilityProfile.
  // Correct sentinel: utility_id === 'unknown_failsafe' means no match was found at all.
  return builtProfile.profile.utility_id === 'unknown_failsafe';
}

/**
 * Returns the full escalation display string for UI use.
 * Format: "{rate}% ({sourceLabel})"
 * Example: "3% (based on VA state avg — EIA 2024)"
 * Example: "4% (based on pge_ca utility profile data (2025-01))"
 */
export function formatEscalationDisplay(
  escalationRate: number,
  sourceLabel: string
): string {
  const pct = Math.round(escalationRate * 100);
  return `${pct}% (${sourceLabel})`;
}