/**
 * lib/proposal/canonicalProposal.ts
 * v47.250 — Canonical Proposal Interface (Utility DB Model Refactor)
 *
 * SINGLE SOURCE OF TRUTH for all proposal values.
 * Every number displayed in the UI must come from a CanonicalProposal.
 * No inline math permitted in the render layer.
 *
 * PIPELINE ORDER (enforced by buildCanonicalProposal):
 *   1. panel      — validatePanelIntegrity() → resolved wattage/count/systemSizeKw
 *   2. production — annualKwh, monthlyKwh[], degradation model
 *   3. utility    — buildUtilityProfile() → rate, escalation, NEM type
 *   4. financial  — system cost, financing, monthly payment, remaining utility monthly
 *   5. truth25yr  — calculate25yrProjection() → all 25yr values, single netDifference
 *   6. offset     — percentage, remaining percentage
 *   7. policy     — SREC available, incentives allowed, policy message
 *   8. return     — frozen CanonicalProposal
 *
 * SAVINGS DEFINITION (canonical, no other version exists):
 *   netDifference = utilityCostWithoutSolar - (solarCostTotal + remainingUtilityCost)
 *
 * v47.250 CHANGES:
 *   - Added CanonicalEnergyFlowYear interface (mirrors EnergyFlowYear from proposalTruthEngine)
 *   - Extended CanonicalUtility: retail_rate_type, export_rate_monthly,
 *     export_rate_annual_excess, true_up_period, policy_status, confidence
 *   - Extended CanonicalTruth25yr: srec_income_25yr, yearlyFlow: CanonicalEnergyFlowYear[]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Panel Section
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPanel {
  /** Panel manufacturer name (e.g. "Silfab", "REC") */
  manufacturer: string;
  /** Panel model string (e.g. "SIL-380-BK") */
  model: string;
  /** Panel wattage in Wp — THE ONLY wattage used anywhere in the proposal */
  wattage: number;
  /** Number of panels — positive integer */
  count: number;
  /**
   * System size in kW — ALWAYS computed as (count x wattage) / 1000.
   * Never taken from layout or UI directly. Panel integrity engine owns this.
   */
  systemSizeKw: number;
  /** Panel efficiency (%) — optional, used for display */
  efficiency?: number;
  /** Cell technology type e.g. "N-Type Mono-Crystalline 16BB Half-Cell", "Mono PERC" */
  cellType?: string | null;
  /** True if bifacial panel (captures rear-side light) */
  bifacial?: boolean;
  /** Bifacial gain factor e.g. 1.20 means 20% rear gain */
  bifacialFactor?: number;
  /** Temperature coefficient in pct per deg C, e.g. -0.30 */
  temperatureCoeff?: number | null;
  /** Performance warranty in years */
  warranty?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Production Section
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalProduction {
  /** Total annual production in kWh */
  annualKwh: number;
  /**
   * Monthly production array [Jan..Dec] in kWh.
   * 12-element array. Sourced from PVWatts or layout engine.
   */
  monthlyKwh: number[];
  /**
   * Total Solar Resource Fraction (TSRF) — the fraction of full-sun production
   * after accounting for shade from obstructions, trees, and inter-row shading.
   * Range: 0.0 (fully shaded) to 1.0 (no shade).
   *
   * TSRF = 1 - (shadeDeratePct / 100)
   *
   * Example: systemShadeDeratePct=8 → TSRF=0.92 (92% of full-sun output).
   *
   * Set only when shade analysis has been run on the design layout.
   * undefined when no shade data is available.
   */
  tsrf?: number;
  /**
   * Shade derate percentage applied to this proposal's production.
   * Computed from the weighted average of per-panel annualShadeFactor values
   * from the design studio layout.
   *
   * 0 = no shade loss, 100 = fully shaded.
   * Typically 2–15% for well-designed rooftop systems.
   *
   * Note: This is informational — the actual kWh impact is already baked into
   * annualKwh via the PVWatts effective losses calculation.
   */
  shadeDerateApplied?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Section
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Escalation Rate Source — tracks provenance of the escalation assumption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source of the utility rate escalation assumption.
 * - 'utility_profile'     : Specific utility in PROPOSAL_UTILITY_PROFILES (high confidence)
 * - 'state_avg_eia'       : State-level average from EIA 2024 data (medium confidence)
 * - 'fallback_unverified' : No state or utility data — 3% hardcoded fallback (flagged)
 */
export type EscalationRateSource =
  | 'utility_profile'
  | 'state_avg_eia'
  | 'fallback_unverified';

// ─────────────────────────────────────────────────────────────────────────────
// Truth Confidence — overall proposal data quality level
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truth confidence level for the entire proposal.
 * - 'VERIFIED'  : Specific utility matched + rate from bill or profile
 * - 'PARTIAL'   : Bill parsed but utility estimated, OR state fallback with known rate
 * - 'ESTIMATED' : No bill, no specific utility match — all projections are estimates
 */
export type TruthConfidence = 'VERIFIED' | 'PARTIAL' | 'ESTIMATED';

// ─────────────────────────────────────────────────────────────────────────────
// Per-year energy flow entry — SPEC §2
// Mirrors EnergyFlowYear from proposalTruthEngine. Declared here so UI
// consumers can import it from canonicalProposal without a dependency on the
// truth engine internals.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalEnergyFlowYear {
  /** 1-based year number (1–25) */
  year: number;
  /** Solar production this year (kWh, with degradation applied) */
  production_kwh: number;
  /** Household consumption this year (kWh) */
  consumption_kwh: number;
  /** kWh of production consumed on-site (min(production, consumption)) */
  self_consumed_kwh: number;
  /** kWh exported to grid (max(0, production - consumption)) */
  exported_kwh: number;
  /** Retail rate this year ($/kWh, escalated) */
  retail_rate: number;
  /** Value of self-consumed energy (self_consumed_kwh × retail_rate) */
  self_consumed_value: number;
  /** Export credit value applied monthly (exported_kwh × export_rate_monthly) */
  monthly_export_value: number;
  /** Annual true-up excess credit (exported_kwh × export_rate_annual_excess) when applicable */
  annual_excess_value: number;
  /** Total energy value = self_consumed_value + monthly_export_value + annual_excess_value */
  total_energy_value: number;
  /** Annual utility cost WITHOUT solar (consumption_kwh × retail_rate) */
  utility_cost_without_solar: number;
  /** Annual utility cost WITH solar (remaining_consumption × retail_rate − export_credit) */
  utility_cost_with_solar: number;
  /** Annual SREC income (production_kwh × srec_value_per_kwh) */
  srec_income: number;
  /** Running cumulative utility cost WITHOUT solar through this year */
  cumulative_without_solar: number;
  /** Running cumulative cost WITH solar through this year */
  cumulative_with_solar: number;
}

export interface CanonicalUtility {
  /** Resolved utility provider name (from project or state fallback) */
  provider: string;
  /** Resolved retail rate $/kWh — from profile or project override */
  rate: number;
  /** Annual household usage in kWh (from client bill or estimate) */
  annualUsageKwh: number;
  /** Annual utility rate escalation (e.g. 0.03 = 3%) */
  escalationRate: number;
  /**
   * Source of the escalation rate assumption — used to label projections accurately.
   */
  escalationRateSource: EscalationRateSource;
  /**
   * Human-readable source label for UI display.
   * e.g. "based on utility profile data" | "based on VA state avg — EIA 2024" | "fallback estimate — not verified"
   */
  escalationRateSourceLabel: string;
  /** Net metering type as resolved by buildUtilityProfile */
  netMeteringType: string;
  /** Export rate $/kWh (retail for NEM1, avoided_cost_rate for NEM3/billing) — monthly credit rate */
  exportRate: number;
  /**
   * Rate structure type from the utility profile (SPEC §1).
   * 'flat' | 'tiered' | 'tou'
   */
  retail_rate_type: string;
  /**
   * Export credit rate applied monthly ($/kWh).
   * For retail_1to1: equals retail rate. For net_billing/avoided_cost: below retail.
   * Null when net metering type is 'none'.
   */
  export_rate_monthly: number | null;
  /**
   * Export credit rate for annual true-up excess ($/kWh).
   * Applied to cumulative annual surplus at true-up period settlement.
   * Null when true_up_period is 'none' or 'monthly'.
   */
  export_rate_annual_excess: number | null;
  /**
   * When annual settlement occurs: 'monthly' | 'annual' | 'none'.
   */
  true_up_period: string;
  /**
   * Policy status from utility profile: 'stable' | 'under_review' | 'changing'.
   */
  policy_status: string;
  /**
   * Data confidence level for this utility profile: 'high' | 'medium' | 'low'.
   */
  confidence: string;
  /**
   * Estimated rate history for graph display.
   * Back-calculated from current rate using escalationRate.
   * All entries estimated: true — no real historical data in pipeline.
   * 10 years back + current year.
   */
  rateHistory: Array<{ year: number; rate: number; estimated: boolean }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Section
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Incentives Section — v47.251 Global Incentives Truth Rule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical incentives block.
 * When GLOBAL_INCENTIVES_CONFIG.incentives_enabled = false:
 *   ALL fields are zeroed/empty. No incentive data may leak into proposal.
 * When enabled: values sourced from verified program data only.
 */
export interface CanonicalIncentives {
  /**
   * Federal ITC rate (%). 0 when incentives disabled or allow_itc=false.
   * NEVER hardcoded to 30 — computed from program data when enabled.
   */
  itc_percent: number;
  /**
   * Federal ITC dollar amount = systemCost x itc_percent/100.
   * 0 when incentives disabled or allow_itc=false.
   */
  itc_value: number;
  /**
   * State incentives list. Empty array when incentives disabled.
   */
  state_incentives: Array<{
    name: string;
    type: string;
    estimated_value: number;
    description: string;
  }>;
  /**
   * Total of all incentive values (ITC + state).
   * 0 when incentives disabled.
   */
  total_incentives: number;
  /**
   * Whether incentives are globally enabled for this proposal.
   * Reflects GLOBAL_INCENTIVES_CONFIG.incentives_enabled.
   */
  incentives_enabled: boolean;
}

export interface CanonicalFinancial {
  /**
   * Gross system cost — base cash price, pre-incentives.
   * This is ALWAYS the basis for all financial metrics when incentives are disabled.
   * = systemCost (same value, explicit alias for clarity in rule enforcement).
   */
  gross_system_cost: number;
  /** Cash price (base, no ITC deduction) — same as gross_system_cost */
  systemCost: number;
  /** $/Watt used to derive systemCost if no stored price */
  pricePerWatt: number;
  /** Monthly solar loan payment (finance mode) */
  solarPaymentMonthly: number;
  /**
   * Monthly remaining utility bill after solar offset.
   * Profile-driven: retail_1to1 vs net_billing vs avoided_cost vs none.
   */
  utilityBillMonthly: number;
  /** Solar payment + remaining utility = total monthly energy cost */
  totalMonthlyCost: number;
  /**
   * Current average monthly utility bill (before solar).
   * Used for ownership delta calculation.
   */
  currentMonthlyBill: number;
  /**
   * totalMonthlyCost - currentMonthlyBill.
   * Positive = initial monthly increase. Negative = immediate savings.
   */
  ownershipDeltaMonthly: number;
  /** Finance APR as decimal (e.g. 0.0799 for 7.99%) */
  financeApr: number;
  /** Finance term in years */
  financeTermYears: number;
  /** Finance term in months */
  financeTermMonths: number;
  /**
   * Year 1 utility bill total WITHOUT solar (annualUsageKwh x rate x escalation year 0).
   * Used for truth-driven financial comparison display.
   */
  year1BillWithoutSolar: number;
  /**
   * Year 1 utility bill total WITH solar (remaining usage after offset x rate).
   * Does not include solar payment — that is solarPaymentMonthly x 12.
   */
  year1BillWithSolar: number;
  /** Annual energy value (annualProduction x utilityRate) — NOT savings */
  annualEnergyValue: number;
  /**
   * Federal ITC rate (%).
   * 0 when GLOBAL_INCENTIVES_CONFIG.allow_itc=false (default).
   * Set by buildCanonicalProposal — never read from UI input when config is disabled.
   */
  itcRate: number;
  /**
   * Federal ITC dollar amount.
   * 0 when GLOBAL_INCENTIVES_CONFIG.allow_itc=false (default).
   * Failsafe-guarded: guardItcValue() called before assignment.
   */
  itcAmount: number;
  /**
   * Net cost after ITC deduction.
   * When incentives disabled: netCost === gross_system_cost (no deduction applied).
   * When enabled: netCost = gross_system_cost - itcAmount.
   */
  netCost: number;
  /**
   * Payback years.
   * Always computed from gross_system_cost when incentives are disabled.
   * (netCost / annualEnergyValue) — netCost = grossCost when ITC=0.
   */
  paybackYears: number;
  /**
   * Year-1 energy value breakdown — read directly from yearlyFlow[0].
   * NO recomputation: these values are an identity map from the iterative model.
   * selfConsumed  = yearlyFlow[0].self_consumed_value
   * exported      = yearlyFlow[0].monthly_export_value + yearlyFlow[0].annual_excess_value
   * total         = yearlyFlow[0].total_energy_value
   */
  energyValueBreakdown: {
    selfConsumed: number;
    exported: number;
    total: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 25-Year Truth Section
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalTruth25yr {
  /**
   * Total utility cost over 25yr with NO solar.
   * Computed with iterative per-year escalation on annualUsageKwh × rate.
   */
  utilityCostWithoutSolar: number;
  /**
   * Total solar investment over 25yr.
   * Finance mode: solarPaymentMonthly × financeTermMonths.
   * Cash mode: systemCost.
   */
  solarCostTotal: number;
  /**
   * Total remaining utility bills after solar offset, over 25yr.
   * Accounts for panel degradation and rate escalation (iterative model).
   */
  remainingUtilityCost: number;
  /**
   * CANONICAL SAVINGS DEFINITION — the only savings number in the system:
   *   netDifference = utilityCostWithoutSolar - (solarCostTotal + remainingUtilityCost)
   * Positive = customer is ahead vs. no-solar scenario.
   */
  netDifference: number;
  /**
   * Cumulative solar energy value over 25yr.
   * Production × rate, compounded with escalation and degradation.
   * Used for payback chart — NOT the savings number.
   */
  estimatedEnergyValue: number;
  /**
   * Difference between estimatedEnergyValue and systemCost.
   * Kept for chart rendering only. netDifference is the canonical savings.
   */
  netFinancialDifference: number;
  /**
   * Finance-basis net difference: utilityCostWithoutSolar - (loanTotal + remainingUtilityCost).
   * May be negative for high-APR/long-term loans. Shown separately from netDifference.
   * Cash purchase: same as netDifference.
   */
  netDifferenceFinanced: number;
  /**
   * Total SREC income over 25yr (0 when srec_available = false).
   * From calculate25yrProjection iterative model — SPEC §7.
   */
  srec_income_25yr: number;
  /**
   * Monthly bill chart data [Jan..Dec].
   * before: current monthly bill, after: monthly bill with solar, savings: before-after.
   */
  monthlyBillChart: Array<{ month: string; before: number; after: number; savings: number }>;
  /**
   * 25-year projection chart data [Yr1..Yr25].
   * savings: annual production value, cumulative: running total.
   */
  projectionChart: Array<{ year: string; savings: number; cumulative: number }>;
  /**
   * Per-year energy flow data from the iterative model (SPEC §2).
   * 25 entries — one per year.
   * Used by UtilityCostProjectionChart to derive both lines from canonical data.
   * SPEC §5: graph engine MUST use this series — no inline recomputation.
   */
  yearlyFlow: CanonicalEnergyFlowYear[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Offset Section
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalOffset {
  /**
   * Percentage of annual usage offset by solar (0–100).
   * Capped at 100. Computed as (annualProduction / annualUsage) × 100.
   */
  percentage: number;
  /**
   * Remaining percentage of annual usage NOT covered by solar.
   * 100 - percentage.
   */
  remainingPercentage: number;
  /** True if system produces less than 100% of usage */
  isPartialOffset: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy Section
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalPolicy {
  /** True if SREC program is available for this location */
  srecAvailable: boolean;
  /** SREC program name (e.g. "Illinois Shines (ABP)") */
  srecProgramName: string;
  /** Estimated SREC value $/MWh */
  srecPricePerMwh: number;
  /**
   * True if incentives (non-tax) may be shown in proposal.
   * False when policy_effect is 'at_risk' or utility rules forbid.
   */
  incentivesAllowed: boolean;
  /**
   * Policy risk message to show to customer.
   * Null when policy is stable/neutral — never shown.
   */
  policyMessage: string | null;
  /** Net metering summary for display */
  netMeteringSummary: string;
  /** SREC summary for display (null if not available) */
  srecSummary: string | null;
  /** Failsafe notice when operating on conservative estimates */
  failsafeMessage: string | null;
  /** True if matched to a specific utility profile (vs. state fallback) */
  isSpecificUtilityMatch: boolean;
  // v48.27: Per-utility programs (TOU plans, battery incentives, rebates, special NEM)
  utilityPrograms: any | null;
  /** Human-readable Solar Pro note summarizing available utility programs (null if none) */
  utilityProgramsNote: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root CanonicalProposal
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalProposal {
  /**
   * Panel data — single source for wattage, count, and system size.
   * systemSizeKw = (count × wattage) / 1000. Always.
   */
  panel: CanonicalPanel;

  /**
   * Production data from PVWatts or layout engine.
   * annualKwh is the production basis for all financial calculations.
   */
  production: CanonicalProduction;

  /**
   * Utility resolution — rate, escalation, NEM type.
   * All values from buildUtilityProfile() structured data.
   */
  utility: CanonicalUtility;

  /**
   * Financial outputs — all derived from panel + production + utility.
   * No raw math in UI. Every financial display value comes from here.
   */
  financial: CanonicalFinancial;

  /**
   * 25-year truth — single savings definition.
   * netDifference is the ONLY savings number. No other savings value exists.
   */
  truth25yr: CanonicalTruth25yr;

  /**
   * Solar offset — percentage of usage covered by solar.
   */
  offset: CanonicalOffset;

  /**
   * Policy intelligence — SREC, incentives, NEM summary, failsafe.
   */
  policy: CanonicalPolicy;

  /**
   * Incentives block — controlled exclusively by GLOBAL_INCENTIVES_CONFIG.
   * When incentives_enabled=false: all values are 0 / empty.
   * No incentive data may appear in UI unless this block shows enabled=true.
   */
  incentives: CanonicalIncentives;

  /**
   * Pipeline metadata for debugging and audit.
   */
  _meta: {
    /** ISO timestamp when pipeline ran */
    builtAt: string;
    /** Pipeline version */
    version: string;
    /** Purchase mode used for 25yr calculations */
    purchaseMode: 'finance' | 'cash';
    /** True if any assertion failed during build */
    hasWarnings: boolean;
    /** Warning messages from pipeline assertions */
    warnings: string[];
    /**
     * Overall truth confidence for this proposal.
     * VERIFIED = specific utility match + bill-derived rate.
     * PARTIAL  = state fallback or estimated rate.
     * ESTIMATED = no utility match, no bill.
     */
    truthConfidence: TruthConfidence;
    /**
     * Year when cumulative energy value produced >= system cost (cash basis).
     * Null if system does not pay off within 25 years.
     */
    payoffYear: number | null;
    /**
     * Dynamic financial narrative generated by financialNarrativeEngine.
     * Used by UI for the financial story without hardcoded text.
     */
    narrative: {
      primaryStory: string;
      monthlyImpact: string;
      payoffStatement: string;
      outcomeStatement: string;
      fullNarrative: string;
    };
  };
}