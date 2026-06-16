/**
 * lib/proposal/incentiveTruthEngine.ts
 * v47.251 — Incentive Truth Engine (Global Incentives Truth Rule)
 *
 * Wraps the existing stateIncentives calculateIncentives() to provide flagged,
 * source-tagged incentive outputs. When incentive data is unavailable or
 * uncertain, surfaces "Incentives not included in this proposal" rather
 * than showing estimated/fabricated values.
 *
 * v47.251 CHANGES:
 *   - All ITC logic now gated by GLOBAL_INCENTIVES_CONFIG.allow_itc (default: false)
 *   - State incentives gated by GLOBAL_INCENTIVES_CONFIG.allow_state_incentives (default: false)
 *   - guardItcValue() called before any ITC amount is used
 *   - When globally disabled: federalItc.rate=0, federalItc.amount=0, incentivesNotIncluded=true
 *   - incentivesNotIncluded is now also triggered by global disable (highest priority)
 *
 * RULES:
 *   - Federal ITC: gated by GLOBAL_INCENTIVES_CONFIG.allow_itc
 *     Residential §25D: repealed by P.L. 119-21 for 2026+ installs
 *     Commercial §48E: still 30% (only active when globally enabled)
 *   - SREC: only shown when cp.policy.srecAvailable = true (from structured profile)
 *   - State incentives: gated by GLOBAL_INCENTIVES_CONFIG.allow_state_incentives
 *   - Unknown state: show "Incentives not included" — never fabricate
 *   - Policy at_risk: suppress incentive messaging per existing policy engine
 */

import { calculateIncentives, getStateIncentives } from '../incentives/stateIncentives';
import type { PolicyEffect } from '../proposalTruthEngine';
import {
  isItcEnabled,
  areStateIncentivesEnabled,
  guardItcValue,
  getIncentivesNotIncludedNotice,
  GLOBAL_INCENTIVES_CONFIG,
} from '../incentivesConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Output Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FederalItcTruth {
  /** ITC rate as a percentage (e.g. 30 or 0) */
  rate: number;
  /** Dollar amount = systemCost x rate/100 */
  amount: number;
  /** True when ITC is suppressed (noItc = true OR globally disabled) */
  suppressed: boolean;
  /** Citation string for UI display */
  citation: string;
  /** Warning shown when customer may not qualify */
  eligibilityNote: string | null;
}

export interface SrecTruth {
  /** Whether SREC is available for this location */
  available: boolean;
  /** Program name from utility profile */
  programName: string;
  /** Estimated $/MWh value (0 if not available) */
  pricePerMwh: number;
  /** Estimated annual SREC revenue = (annualKwh/1000) x pricePerMwh */
  estimatedAnnualRevenue: number;
  /** Display note for proposal */
  displayNote: string;
}

export interface StateIncentiveTruth {
  /** Whether any state incentives are known for this state */
  available: boolean;
  /** Total estimated state incentive value */
  totalEstimatedValue: number;
  /** Individual incentives */
  incentives: Array<{
    name: string;
    type: string;
    estimatedValue: number;
    description: string;
    citation: string;
  }>;
  /** Display note for proposal */
  displayNote: string;
}

export interface IncentiveTruthResult {
  /** Federal ITC — always present, flagged with citation */
  federalItc: FederalItcTruth;
  /** SREC program truth */
  srec: SrecTruth;
  /** State incentives truth */
  stateIncentives: StateIncentiveTruth;
  /**
   * When true: show "Incentives not included in this proposal"
   * Triggered by: global disable, unknown state, policy at_risk, or noItc + no state data
   */
  incentivesNotIncluded: boolean;
  /** Reason for incentivesNotIncluded = true (for internal logging) */
  incentivesNotIncludedReason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Resolver
// ─────────────────────────────────────────────────────────────────────────────

export interface IncentiveTruthInput {
  stateCode: string;
  systemCost: number;
  systemKw: number;
  annualKwh: number;
  isCommercial: boolean;
  noItc: boolean;
  /** Policy effect from utility profile — 'at_risk' suppresses incentive display */
  policyEffect: PolicyEffect;
  /** From cp.policy */
  srecAvailable: boolean;
  srecProgramName: string;
  srecPricePerMwh: number;
}

export function resolveIncentiveTruth(input: IncentiveTruthInput): IncentiveTruthResult {
  const {
    stateCode,
    systemCost,
    systemKw,
    annualKwh,
    isCommercial,
    noItc,
    policyEffect,
    srecAvailable,
    srecProgramName,
    srecPricePerMwh,
  } = input;

  const isResidential = !isCommercial;
  const hasStateCode = !!(stateCode && stateCode.length === 2);

  // ── Federal ITC — v47.251 Global Incentives Truth Rule ────────────────────
  // Gate 1: GLOBAL_INCENTIVES_CONFIG.allow_itc must be true (default: false).
  // Gate 2: noItc per-project flag must be false.
  // When globally disabled: rate=0, amount=0, suppressed=true — no ITC anywhere.
  const itcGloballyAllowed = isItcEnabled();

  let itcRate = 0;
  let itcAmount = 0;
  let itcCitation = '';

  if (!itcGloballyAllowed) {
    // SPEC §3: Global gate — all ITC zeroed regardless of project flags
    itcRate = 0;
    itcAmount = 0;
    itcCitation = 'Tax incentives are not included in this proposal.';
  } else if (noItc) {
    itcRate = 0;
    itcAmount = 0;
    itcCitation = 'ITC suppressed for this customer';
  } else if (isResidential) {
    // P.L. 119-21: residential §25D repealed for installs after 2025
    itcRate = 0;
    itcAmount = 0;
    itcCitation = 'Residential ITC (§25D) repealed by P.L. 119-21 for 2026+ installations';
  } else {
    // Commercial §48E: still 30% (only reached when itcGloballyAllowed=true)
    itcRate = 30;
    // SPEC §5 FAILSAFE: guardItcValue before any ITC amount is used
    itcAmount = guardItcValue(Math.round(systemCost * 0.30), 'incentiveTruthEngine');
    itcCitation = 'Federal Investment Tax Credit — IRA §48E (Commercial), 30% through 2032';
  }

  const federalItc: FederalItcTruth = {
    rate: itcRate,
    amount: itcAmount,
    suppressed: noItc || !itcGloballyAllowed,
    citation: itcCitation,
    eligibilityNote: !itcGloballyAllowed
      ? getIncentivesNotIncludedNotice()
      : noItc
        ? 'Tax credit not applicable — customer indicated no federal tax liability.'
        : isResidential
          ? 'Note: Residential federal solar tax credit repealed for installations after December 31, 2025 (P.L. 119-21). Consult a tax professional.'
          : null,
  };

  // ── SREC ──────────────────────────────────────────────────────────────────
  const estimatedAnnualSrecRevenue = srecAvailable && srecPricePerMwh > 0
    ? Math.round((annualKwh / 1000) * srecPricePerMwh)
    : 0;

  const srec: SrecTruth = {
    available: srecAvailable,
    programName: srecProgramName || '',
    pricePerMwh: srecPricePerMwh,
    estimatedAnnualRevenue: estimatedAnnualSrecRevenue,
    displayNote: srecAvailable
      ? `SREC program available: ${srecProgramName || 'Active program'}. ` +
        `Estimated value: $${srecPricePerMwh}/MWh (~$${estimatedAnnualSrecRevenue}/yr). ` +
        `Actual values vary by market.`
      : 'No SREC program available for this location.',
  };

  // ── State Incentives — v47.251 Global Incentives Truth Rule ───────────────
  // Gate: GLOBAL_INCENTIVES_CONFIG.allow_state_incentives must be true (default: false).
  // When globally disabled: return empty state incentives regardless of state data.
  let stateIncentives: StateIncentiveTruth;

  if (!areStateIncentivesEnabled()) {
    // Global gate: state incentives disabled — return empty, no computation
    stateIncentives = {
      available: false,
      totalEstimatedValue: 0,
      incentives: [],
      displayNote: getIncentivesNotIncludedNotice(),
    };
  } else if (!hasStateCode) {
    stateIncentives = {
      available: false,
      totalEstimatedValue: 0,
      incentives: [],
      displayNote: 'State incentives unknown — no state code provided.',
    };
  } else {
    // Use calculateIncentives() which already handles all value types correctly
    const calc = calculateIncentives(stateCode, systemCost, systemKw, annualKwh, isResidential);
    const stateProfile = getStateIncentives(stateCode);

    const mapped = calc.state.map(inc => ({
      name: inc.incentiveName,
      type: inc.type,
      estimatedValue: inc.calculatedValue,
      description: inc.description,
      citation: inc.incentiveId,
    }));

    stateIncentives = {
      // Use STATE-only cash — calc.cashTotal includes the federal ITC, which is
      // already reported separately, so using it here double-counts federal.
      available: mapped.length > 0 && calc.cashStateTotal > 0,
      totalEstimatedValue: calc.cashStateTotal,
      incentives: mapped,
      displayNote: mapped.length > 0
        ? `${mapped.length} state incentive(s) available in ${stateCode}. ` +
          `Estimated cash value: $${calc.cashStateTotal.toLocaleString()}. ` +
          `Verify eligibility with your tax advisor.`
        : stateProfile
          ? `No additional state incentives found for ${stateCode} beyond federal programs.`
          : `State incentive data not available for ${stateCode}.`,
    };
  }

  // ── incentivesNotIncluded flag ────────────────────────────────────────────
  // Priority 1: global disable (highest — overrides all other checks)
  // Priority 2: policy at_risk
  // Priority 3: no ITC qualification + no state code
  const globallyDisabled = !GLOBAL_INCENTIVES_CONFIG.incentives_enabled;
  const policyAtRisk = policyEffect === 'at_risk';
  const incentivesNotIncluded = globallyDisabled || policyAtRisk || (!hasStateCode && noItc);
  const incentivesNotIncludedReason = incentivesNotIncluded
    ? globallyDisabled
      ? 'Global incentives disabled (GLOBAL_INCENTIVES_CONFIG.incentives_enabled=false)'
      : policyAtRisk
        ? 'Policy at_risk — incentive messaging suppressed per policy engine'
        : 'No ITC qualification and no state code — cannot compute any incentives'
    : null;

  return {
    federalItc,
    srec,
    stateIncentives,
    incentivesNotIncluded,
    incentivesNotIncludedReason,
  };
}