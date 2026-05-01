/**
 * lib/incentivesConfig.ts
 * v47.251 — Global Incentives Configuration (Single Source of Truth)
 *
 * THIS IS THE AUTHORITATIVE GATE for all incentive-related logic.
 *
 * RULES:
 *   - When incentives_enabled = false: NO incentive data appears anywhere —
 *     not in calculations, not in UI, not in financial tables, not in footers.
 *   - When allow_itc = false: itcRate = 0, itcAmount = 0, netCost = grossCost.
 *     Payback and all financial metrics use gross system cost only.
 *   - These flags override ALL per-project noItc toggles, all UI toggles,
 *     and all inline incentive conditionals.
 *
 * ENFORCEMENT POINTS (must check GLOBAL_INCENTIVES_CONFIG):
 *   1. buildCanonicalProposal.ts  — canonical financial calculations
 *   2. incentiveTruthEngine.ts    — incentive resolution
 *   3. ProposalTab.tsx            — internal toggle UI
 *   4. proposals/view/[id]/page.tsx — proposal render layer
 *
 * TO ENABLE INCENTIVES IN FUTURE:
 *   Requires:
 *     - verified program source
 *     - year-specific logic
 *     - no hardcoded 30%
 *   Set incentives_enabled = true AND allow_itc = true
 *   only after meeting those requirements.
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
   */
  allow_state_incentives: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CONFIG — DEFAULT: ALL INCENTIVES DISABLED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GLOBAL_INCENTIVES_CONFIG
 *
 * DEFAULT STATE: incentives_enabled=false, allow_itc=false, allow_state_incentives=false
 *
 * This is the single source of truth for all incentive gating in the system.
 * Import this constant — do NOT duplicate the logic elsewhere.
 *
 * Change history:
 *   v47.251: Created. Default = all disabled.
 */
export const GLOBAL_INCENTIVES_CONFIG: Readonly<IncentivesConfigType> = Object.freeze({
  incentives_enabled:     false,
  allow_itc:              false,
  allow_state_incentives: false,
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
 * When enabled: uses the standard "consult a tax professional" message.
 */
export function getIncentivesComplianceMessage(): string {
  if (!GLOBAL_INCENTIVES_CONFIG.incentives_enabled) {
    return 'Tax incentives are not included in this proposal. Consult a tax professional for eligibility.';
  }
  return 'Tax incentives shown are estimates only. Consult a qualified tax professional for eligibility, timing, and applicable credits.';
}

/**
 * Returns the short notice for inline incentives sections.
 * Used when a section that would show incentives is suppressed.
 */
export function getIncentivesNotIncludedNotice(): string {
  return 'Incentives are not included in this proposal.';
}