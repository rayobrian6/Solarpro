/**
 * lib/incentivesConfig.ts
 * v47.260 — Global Incentives Configuration (Single Source of Truth)
 *
 * THIS IS THE AUTHORITATIVE GATE for all incentive-related logic.
 *
 * LEGAL STATUS (as of v47.260, May 2026):
 *   - §25D Residential Clean Energy Credit: REPEALED by P.L. 119-21
 *     (One Big Beautiful Bill Act, signed July 4 2025) for expenditures
 *     made after December 31, 2025. allow_itc remains FALSE — correct.
 *   - §25C Energy Efficient Home Improvement Credit: REPEALED same law.
 *   - §48E Commercial/Business ITC: ALIVE — 30% for solar facilities
 *     beginning construction before July 4 2026, placed in service by
 *     Dec 31 2027. Passed to homeowners via lease/PPA by solar companies.
 *   - State incentives (SRECs, property/sales tax exemptions, rebates,
 *     utility programs, NEM/net billing): FULLY ALIVE — unaffected by
 *     P.L. 119-21. allow_state_incentives = TRUE (enabled v47.260).
 *
 * RULES:
 *   - When incentives_enabled = false: NO incentive data appears anywhere —
 *     not in calculations, not in UI, not in financial tables, not in footers.
 *   - When allow_itc = false: itcRate = 0, itcAmount = 0, netCost = grossCost.
 *     Payback and all financial metrics use gross system cost only.
 *   - allow_state_incentives = true: state tax credits, rebates, SRECs,
 *     property/sales tax exemptions shown in proposals for residential customers.
 *   - These flags override ALL per-project noItc toggles, all UI toggles,
 *     and all inline incentive conditionals.
 *
 * ENFORCEMENT POINTS (must check GLOBAL_INCENTIVES_CONFIG):
 *   1. buildCanonicalProposal.ts  — canonical financial calculations
 *   2. incentiveTruthEngine.ts    — incentive resolution
 *   3. ProposalTab.tsx            — internal toggle UI
 *   4. proposals/view/[id]/page.tsx — proposal render layer
 *
 * HARD RULE: Incentives must NEVER appear in UI, affect calculations,
 * or influence messaging unless explicitly enabled here.
 * No exceptions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Config Type
// ─────────────────────────────────────────────────────────────────────────────

export interface IncentivesConfigType {
  /**
   * Master gate for all incentive logic.
   * false → suppress ALL incentive display and calculations system-wide.
   * true  → incentive logic may run (subject to allow_itc, allow_state_incentives).
   */
  incentives_enabled: boolean;

  /**
   * Federal ITC gate.
   * false → itcRate=0, itcAmount=0, netCost=grossCost everywhere.
   * true  → ITC may be computed (requires incentives_enabled=true).
   *
   * NOTE: Requires verified program source + year-specific logic.
   * NEVER hardcode 30% when this is true — compute from program data.
   */
  allow_itc: boolean;

  /**
   * State incentives gate.
   * false → no state incentives shown or computed.
   * true  → state incentives may be shown (requires incentives_enabled=true).
   *
   * NOTE: State incentives (property/sales tax exemptions, SRECs, utility rebates,
   * state tax credits) are UNAFFECTED by P.L. 119-21. Enabled v47.260.
   */
  allow_state_incentives: boolean;

  /**
   * §48E Commercial ITC gate — for lease/PPA products only.
   * When true: solar companies that own the system may offer lease/PPA
   * with a pass-through of up to 30% §48E credit to homeowners.
   * Safe-harbor deadline: construction must begin by July 4, 2026.
   * Placed-in-service deadline: December 31, 2027.
   *
   * NOTE: This is a COMPANY-LEVEL credit, not homeowner-claimable.
   * Only show §48E messaging when financeType = 'lease' or 'ppa'.
   */
  allow_section48e: boolean;

  /** §48E credit rate (30% through July 4 2026 safe harbor) */
  section48e_rate: number;

  /**
   * §48E safe-harbor deadline (ISO date string).
   * Construction must begin by this date for full 30% credit.
   * After this date, credit only available if placed in service by Dec 31 2027.
   */
  section48e_safe_harbor_deadline: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CONFIG — DEFAULT: ALL INCENTIVES DISABLED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GLOBAL_INCENTIVES_CONFIG
 *
 * v47.260 STATE:
 *   incentives_enabled      = true   (state incentives now live)
 *   allow_itc               = false  (§25D repealed by P.L. 119-21 for residential 2026+)
 *   allow_state_incentives  = true   (SRECs, property/sales tax exemptions, rebates live)
 *   allow_section48e        = true   (§48E commercial ITC, lease/PPA pass-through)
 *   section48e_rate         = 30     (30% through safe-harbor deadline)
 *   section48e_safe_harbor_deadline = '2026-07-04' (construction must begin by this date)
 *
 * This is the single source of truth for all incentive gating in the system.
 * Import this constant — do NOT duplicate the logic elsewhere.
 *
 * Change history:
 *   v47.251: Created. Default = all disabled.
 *   v47.260: Enable state incentives + §48E. §25D remains disabled (repealed).
 */
export const GLOBAL_INCENTIVES_CONFIG: Readonly<IncentivesConfigType> = Object.freeze({
  incentives_enabled:              true,
  allow_itc:                       false,  // §25D repealed P.L. 119-21 — do NOT enable
  allow_state_incentives:          true,   // SRECs, property/sales tax, rebates — live
  allow_section48e:                true,   // §48E lease/PPA pass-through — live
  section48e_rate:                 30,     // 30% through July 4 2026 safe harbor
  section48e_safe_harbor_deadline: '2026-07-04',
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: is ITC active?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true only when BOTH incentives_enabled AND allow_itc are true.
 * Use this guard everywhere ITC computations appear.
 */
export function isItcEnabled(): boolean {
  return GLOBAL_INCENTIVES_CONFIG.incentives_enabled && GLOBAL_INCENTIVES_CONFIG.allow_itc;
}

/**
 * Returns true only when BOTH incentives_enabled AND allow_state_incentives are true.
 */
export function areStateIncentivesEnabled(): boolean {
  return GLOBAL_INCENTIVES_CONFIG.incentives_enabled && GLOBAL_INCENTIVES_CONFIG.allow_state_incentives;
}

/**
 * Returns true when §48E lease/PPA pass-through is enabled.
 * Use this guard for any §48E-specific messaging or calculations.
 */
export function isSection48eEnabled(): boolean {
  return GLOBAL_INCENTIVES_CONFIG.incentives_enabled && GLOBAL_INCENTIVES_CONFIG.allow_section48e;
}

/**
 * Returns the §48E rate (0 when disabled).
 */
export function getSection48eRate(): number {
  return isSection48eEnabled() ? GLOBAL_INCENTIVES_CONFIG.section48e_rate : 0;
}

/**
 * Returns the §48E safe-harbor deadline ISO string, or null when disabled.
 */
export function getSection48eSafeHarborDeadline(): string | null {
  return isSection48eEnabled() ? GLOBAL_INCENTIVES_CONFIG.section48e_safe_harbor_deadline : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Failsafe Guard (SPEC §5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call this before rendering any incentive value.
 * If incentives are disabled but itc_value > 0, logs [INCENTIVE LEAK DETECTED]
 * and forces the value to 0.
 *
 * @param itcValue  - The itcAmount to validate
 * @param context   - Caller context for the log message
 * @returns         - 0 if incentives are disabled, itcValue otherwise
 */
export function guardItcValue(itcValue: number, context: string): number {
  if (!isItcEnabled() && itcValue > 0) {
    console.error(
      `[INCENTIVE LEAK DETECTED] ${context}: itc_value=${itcValue} but incentives are disabled. Forcing to 0.`
    );
    return 0;
  }
  return itcValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev Mode Label
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a dev-mode visibility string for debug UI.
 * Only show in development — never in production proposal output.
 */
export function getIncentivesDebugLabel(): string {
  if (!GLOBAL_INCENTIVES_CONFIG.incentives_enabled) {
    return 'Incentives Disabled (Global)';
  }
  const parts: string[] = [];
  if (GLOBAL_INCENTIVES_CONFIG.allow_itc) parts.push('ITC: ON');
  else parts.push('ITC: OFF');
  if (GLOBAL_INCENTIVES_CONFIG.allow_state_incentives) parts.push('State: ON');
  else parts.push('State: OFF');
  return `Incentives Enabled — ${parts.join(', ')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Message (SPEC §4 + §6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the standard incentives disclaimer for proposal footers and notice blocks.
 * When incentives_enabled=false: uses the globally-disabled message.
 * When enabled: uses the accurate post-OBBBA message.
 */
export function getIncentivesComplianceMessage(): string {
  if (!GLOBAL_INCENTIVES_CONFIG.incentives_enabled) {
    return 'Tax incentives are not included in this proposal. Consult a tax professional for eligibility.';
  }
  return (
    'State incentives shown are estimates based on published program data. ' +
    'Note: The federal residential solar tax credit (§25D) was repealed for installations ' +
    'after December 31, 2025 (P.L. 119-21). State programs, SRECs, and property/sales tax ' +
    'exemptions are unaffected. Consult a qualified tax professional to confirm eligibility.'
  );
}

/**
 * Returns the short notice for inline incentives sections.
 * Used when a section that would show incentives is suppressed.
 */
export function getIncentivesNotIncludedNotice(): string {
  return 'Incentives are not included in this proposal.';
}