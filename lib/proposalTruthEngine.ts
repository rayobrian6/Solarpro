/**
 * lib/proposalTruthEngine.ts
 * v47.250 — Proposal Truth Engine (Utility DB Model Refactor)
 *
 * Nationwide utility-intelligence system that generates accurate, compliant,
 * and utility-specific proposal logic using structured data.
 *
 * SECTIONS IMPLEMENTED:
 *   Section 2:  ProposalUtilityProfile interface + PROPOSAL_UTILITY_PROFILES registry
 *   Section 3:  buildUtilityProfile(project) function
 *   Section 4:  Data-driven messaging helpers (net metering, SREC)
 *   Section 5:  Policy risk engine / getPolicyMessage()
 *   Section 9:  Net metering financial logic / getFinancialRules()
 *   Section 10: Per-year energy flow model (EnergyFlowYear)
 *   Section 11: Full iterative 25-year projection (calculate25yrProjection)
 *   Section 12: validateProposalTruth() — enhanced validation engine
 *   Section 13: Failsafe for missing utility data
 *
 * CRITICAL: All outputs derive from structured data attributes — never from utility name strings.
 * CRITICAL: No hardcoded rates. All calculations flow from UtilityProfile fields.
 */

import { STATE_UTILITY_FALLBACK } from './utilityDetector';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: ProposalUtilityProfile Interface
// ─────────────────────────────────────────────────────────────────────────────

export type NetMeteringType =
  | 'retail_1to1'     // Full retail credit for every kWh exported (classic NEM)
  | 'net_billing'     // Export credited at a rate below retail (NEM 3.0, net billing)
  | 'avoided_cost'    // Export credited at utility avoided cost only
  | 'none';           // No net metering — self-consumption only

export type TrueUpType =
  | 'retail'          // Annual true-up at full retail rate
  | 'avoided_cost'    // Annual excess credited at avoided cost rate
  | 'none';           // No true-up / banking

export type PolicyStatus =
  | 'stable'          // Current policy expected to remain unchanged
  | 'under_review'    // Active proceeding — outcome unknown
  | 'changing';       // Policy change confirmed, transition underway

export type PolicyEffect =
  | 'neutral'         // Change does not materially affect proposal economics
  | 'favorable'       // Change improves economics (higher rates, better incentives)
  | 'at_risk';        // Change degrades economics (lower export rates, NEM changes)

export type RetailRateType =
  | 'flat'            // Single flat $/kWh rate
  | 'tiered'          // Tiered rate structure (blended_rate = blended avg)
  | 'tou';            // Time-of-use pricing (blended_rate = blended avg)

export type TrueUpPeriod =
  | 'monthly'         // Credits settled monthly (no carryover)
  | 'annual'          // Credits carry forward; settled annually
  | 'none';           // No true-up mechanism

export interface ProposalUtilityProfile {
  // Identity
  utility_id: string;
  utility_name: string;           // human-readable display name for proposals
  utility_name_pattern: string;   // regex or substring for fuzzy matching
  state: string;

  // Rate structure (SPEC §1)
  retail_rate_type: RetailRateType;
  blended_rate: number;           // $/kWh — blended residential rate (canonical rate field)

  // Net metering (SPEC §1 + §2)
  net_metering_type: NetMeteringType;
  rollover_rules: string;         // Human-readable description of credit rollover

  // Export rates (SPEC §1)
  export_rate_monthly: number | null;       // $/kWh — export credit rate applied monthly
  export_rate_annual_excess: number | null; // $/kWh — rate for annual true-up excess

  // True-up (SPEC §1)
  true_up_period: TrueUpPeriod;   // When annual settlement occurs
  trueup_type: TrueUpType;        // What rate applies at true-up
  avoided_cost_rate: number;      // $/kWh — avoided cost rate (used for annual excess)

  // SREC / performance credits (SPEC §7)
  srec_available: boolean;
  srec_value_estimate: number | null; // $/MWh — null if not available (SPEC §1)
  srec_price_estimate: number;        // $/MWh — same value, legacy field for compat
  srec_program_name: string;          // e.g. "Illinois Shines (ABP)"

  // Rate data
  utility_rate: number;           // $/kWh — same as blended_rate (legacy alias)
  escalation_rate: number;        // Annual utility rate escalation assumption (e.g. 0.03)
  escalation_source: 'utility_profile' | 'state_avg_eia' | 'fallback'; // SPEC §6

  // Policy (SPEC §8)
  policy_status: PolicyStatus;
  policy_effect: PolicyEffect;
  policy_note: string;            // Detail shown when effect is at_risk or changing

  // Metadata (SPEC §1)
  confidence: 'high' | 'medium' | 'low'; // SPEC §1 field name
  last_updated: string;           // YYYY-MM
  data_confidence: 'high' | 'medium' | 'low'; // legacy alias for confidence
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: PROPOSAL_UTILITY_PROFILES Registry
// ─────────────────────────────────────────────────────────────────────────────

export const PROPOSAL_UTILITY_PROFILES: ProposalUtilityProfile[] = [

  // ── California ──────────────────────────────────────────────────────────────
  {
    utility_id: 'pge_ca',
    utility_name: 'Pacific Gas & Electric (PG&E)',
    utility_name_pattern: 'pg&e|pacific gas|pge',
    state: 'CA',
    retail_rate_type: 'tiered',
    blended_rate: 0.338,
    net_metering_type: 'net_billing',
    rollover_rules: 'Monthly credits roll forward. Annual true-up: excess generation credited at Avoided Cost Transfer Credit (ACTC), typically $0.05–$0.08/kWh.',
    export_rate_monthly: 0.06,
    export_rate_annual_excess: 0.06,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.06,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.338,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'NEM 3.0 (Net Billing Tariff) is in effect for systems interconnected after April 2023. Export credits are significantly lower than retail rate. System should be sized to maximize self-consumption.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'sce_ca',
    utility_name: 'Southern California Edison',
    utility_name_pattern: 'sce|southern california edison',
    state: 'CA',
    retail_rate_type: 'tiered',
    blended_rate: 0.338,
    net_metering_type: 'net_billing',
    rollover_rules: 'Monthly credits roll forward. Annual true-up: excess generation credited at Avoided Cost Transfer Credit (ACTC), typically $0.05–$0.08/kWh.',
    export_rate_monthly: 0.06,
    export_rate_annual_excess: 0.06,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.06,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.338,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'NEM 3.0 (Net Billing Tariff) is in effect. Export value is significantly below retail. System should be sized for self-consumption optimization.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'sdge_ca',
    utility_name: 'San Diego Gas & Electric',
    utility_name_pattern: 'sdg&e|san diego gas|sdge',
    state: 'CA',
    retail_rate_type: 'tiered',
    blended_rate: 0.420,
    net_metering_type: 'net_billing',
    rollover_rules: 'Monthly credits roll forward. Annual true-up: excess generation credited at Avoided Cost Transfer Credit (ACTC), typically $0.05–$0.08/kWh.',
    export_rate_monthly: 0.06,
    export_rate_annual_excess: 0.06,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.06,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.420,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'NEM 3.0 (Net Billing Tariff) is in effect. SDG&E has the highest residential rates in California — high self-consumption value.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Illinois ────────────────────────────────────────────────────────────────
  {
    utility_id: 'comed_il',
    utility_name: 'Commonwealth Edison (ComEd)',
    utility_name_pattern: 'comed|commonwealth edison',
    state: 'IL',
    retail_rate_type: 'flat',
    // v48.6: Updated to 2026 all-in residential rate (~15.5¢/kWh per ICC filings + PJM capacity auction).
    // Rates have risen +94% since 2021 (8¢ → 15.5¢). Escalation updated to 6% — conservative floor
    // given actual historical average of 12%+/yr; defensible long-run projection per CUB & EIA data.
    blended_rate: 0.155,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward indefinitely. Unused annual excess paid out at avoided cost rate in April. NOTE: Illinois Net Metering 2.0 (Jan 1, 2025+) limits credits to supply portion only for new installs — grandfathered systems retain full 1:1 retail credit.',
    export_rate_monthly: 0.155,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.155,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'Illinois has strong net metering law (ILSR 625 ILCS 5/16-107.5). Illinois Shines ABP provides long-term REC contracts — significant additional income stream. ComEd rates have risen 94% since 2021 driven by PJM capacity auction spikes and ICC-approved delivery rate increases. Illinois NEM 2.0 (effective Jan 1, 2025) applies supply-only credits for new installs; grandfathered systems retain full retail 1:1 NEM.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'ameren_il',
    utility_name: 'Ameren Illinois',
    utility_name_pattern: 'ameren',
    state: 'IL',
    retail_rate_type: 'flat',
    // v48.6: Updated to 2026 all-in residential rate (~15.5¢/kWh per ICC filings + MISO capacity auction).
    // Ameren rates rose 94% since 2021. MISO 2025-26 capacity auction spiked 22x ($30→$666.50/MW-day).
    // Escalation updated to 6% — conservative floor given actual historical avg of 12%+/yr.
    blended_rate: 0.155,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward indefinitely. Unused annual excess paid out at avoided cost rate in April. NOTE: Illinois Net Metering 2.0 (Jan 1, 2025+) limits credits to supply portion only for new installs — grandfathered systems retain full 1:1 retail credit.',
    export_rate_monthly: 0.155,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.155,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'Ameren Illinois serves central/southern IL on the MISO grid. Illinois Shines ABP provides long-term REC contracts. Ameren rates rose 94% since 2021 driven by MISO capacity auction 22x spike and ICC-approved $308.6M delivery rate increase (Dec 2024) plus $48.4M grid modernization surcharge (Dec 2025). MISO reserve margin collapsed 6.5→2.6 GW — structural upward rate pressure projected through 2031+. Illinois NEM 2.0 (effective Jan 1, 2025) applies supply-only credits for new installs; grandfathered systems retain full retail 1:1 NEM.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Florida ─────────────────────────────────────────────────────────────────
  {
    utility_id: 'fpl_fl',
    utility_name: 'Florida Power & Light',
    utility_name_pattern: 'fpl|florida power|florida light',
    state: 'FL',
    retail_rate_type: 'flat',
    blended_rate: 0.158,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess credits paid out at avoided cost rate (typically ~$0.03–$0.04/kWh).',
    export_rate_monthly: 0.158,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.158,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'under_review',
    policy_effect: 'at_risk',
    policy_note: 'Florida utilities have sought to modify net metering compensation. Current retail-rate net metering is protected through 2029 under HB 741 (2022), but annual true-up excess is paid at avoided cost. Monitor for future rate cases.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'duke_fl',
    utility_name: 'Duke Energy Florida',
    utility_name_pattern: 'duke energy florida|duke.*florida|duke fl|duke energy.*fl',
    state: 'FL',
    retail_rate_type: 'flat',
    blended_rate: 0.150,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at avoided cost.',
    export_rate_monthly: 0.150,
    export_rate_annual_excess: 0.034,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.034,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.150,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'under_review',
    policy_effect: 'at_risk',
    policy_note: 'Duke Energy Florida has filed rate cases seeking to reduce export compensation. Current net metering protected through 2029 under state law.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Maryland ────────────────────────────────────────────────────────────────
  {
    utility_id: 'bge_md',
    utility_name: 'Baltimore Gas & Electric',
    utility_name_pattern: 'bge|baltimore gas|baltimore electric',
    state: 'MD',
    retail_rate_type: 'flat',
    blended_rate: 0.224,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at retail rate (one of the few states with full retail true-up).',
    export_rate_monthly: 0.224,
    export_rate_annual_excess: 0.224,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.224,
    srec_available: true,
    srec_value_estimate: 53,
    srec_price_estimate: 53,
    srec_program_name: 'Maryland SREC Program',
    utility_rate: 0.224,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'Maryland has strong net metering with full retail rate true-up. Active SREC market provides additional income. BGE territory benefits from both programs.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'pepco_md',
    utility_name: 'Pepco (Maryland)',
    utility_name_pattern: 'pepco|potomac electric',
    state: 'MD',
    retail_rate_type: 'flat',
    blended_rate: 0.224,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at retail rate.',
    export_rate_monthly: 0.224,
    export_rate_annual_excess: 0.224,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.224,
    srec_available: true,
    srec_value_estimate: 53,
    srec_price_estimate: 53,
    srec_program_name: 'Maryland SREC Program',
    utility_rate: 0.224,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'Maryland net metering at retail rate with active SREC market. Favorable policy environment for residential solar.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── New England ──────────────────────────────────────────────────────────────
  {
    utility_id: 'eversource_ct',
    utility_name: 'Eversource Energy (CT)',
    utility_name_pattern: 'eversource',
    state: 'CT',
    retail_rate_type: 'flat',
    blended_rate: 0.278,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at retail rate.',
    export_rate_monthly: 0.278,
    export_rate_annual_excess: 0.278,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.278,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: 'Connecticut ZREC/LREC (utility-contracted, not open-market SREC)',
    utility_rate: 0.278,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'Connecticut has strong net metering at retail rate. ZREC/LREC program provides performance payments. High electricity rates make solar economics excellent.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'eversource_ma',
    utility_name: 'Eversource Energy (MA)',
    utility_name_pattern: 'eversource',
    state: 'MA',
    retail_rate_type: 'flat',
    blended_rate: 0.315,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward at retail rate. Unused annual excess paid to charity or carried forward.',
    export_rate_monthly: 0.315,
    export_rate_annual_excess: 0.315,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.315,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: 'MA SMART Program (replaces SRECs)',
    utility_rate: 0.315,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Massachusetts SMART program provides fixed incentive payments. Net metering at retail rate. High electricity rates improve solar economics significantly.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'green_mountain_vt',
    utility_name: 'Green Mountain Power',
    utility_name_pattern: 'green mountain power|gmp',
    state: 'VT',
    retail_rate_type: 'flat',
    blended_rate: 0.249,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward at retail rate for 12 months. Annual excess paid out.',
    export_rate_monthly: 0.249,
    export_rate_annual_excess: 0.249,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.249,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.249,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Vermont has strong net metering law. Green Mountain Power actively supports rooftop solar and battery storage programs.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'cmp_me',
    utility_name: 'Central Maine Power',
    utility_name_pattern: 'central maine power|cmp',
    state: 'ME',
    retail_rate_type: 'flat',
    blended_rate: 0.296,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at retail rate.',
    export_rate_monthly: 0.296,
    export_rate_annual_excess: 0.296,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.296,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.296,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Maine offers retail-rate net metering. High electricity rates make solar economically strong.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Mid-Atlantic / DC ────────────────────────────────────────────────────────
  {
    utility_id: 'pepco_dc',
    utility_name: 'Pepco (DC)',
    utility_name_pattern: 'pepco',
    state: 'DC',
    retail_rate_type: 'flat',
    blended_rate: 0.240,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits at retail rate. Annual true-up: excess paid at retail.',
    export_rate_monthly: 0.240,
    export_rate_annual_excess: 0.240,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.240,
    srec_available: true,
    srec_value_estimate: 383,
    srec_price_estimate: 383,
    srec_program_name: 'DC SREC Market (highest-value in US)',
    utility_rate: 0.240,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'DC SRECs are among the most valuable in the nation (~$350–$430/MWh) due to aggressive RPS requirements. Significant additional income stream for DC solar owners.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'pseg_nj',
    utility_name: 'PSE&G',
    utility_name_pattern: 'pseg|public service enterprise|jcp&l|jersey central',
    state: 'NJ',
    retail_rate_type: 'flat',
    blended_rate: 0.227,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at retail rate.',
    export_rate_monthly: 0.227,
    export_rate_annual_excess: 0.227,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.227,
    srec_available: true,
    srec_value_estimate: 25,
    srec_price_estimate: 25,
    srec_program_name: 'New Jersey SREC Market / TREC Program',
    utility_rate: 0.227,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'New Jersey has strong net metering. TREC program replaced SRECs — provides performance-based incentive.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'peco_pa',
    utility_name: 'PECO / PPL Electric',
    utility_name_pattern: 'peco|ppl|duquesne|penelec|penn power|west penn',
    state: 'PA',
    retail_rate_type: 'flat',
    blended_rate: 0.206,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at wholesale/avoided cost rate.',
    export_rate_monthly: 0.206,
    export_rate_annual_excess: 0.04,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.04,
    srec_available: true,
    srec_value_estimate: 23,
    srec_price_estimate: 23,
    srec_program_name: 'Pennsylvania SREC Market',
    utility_rate: 0.206,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Pennsylvania has retail-rate net metering with annual avoided-cost true-up on excess. Active but lower-value SREC market (~$10–$30/MWh).',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Carolinas / Southeast ────────────────────────────────────────────────────
  {
    utility_id: 'duke_nc',
    utility_name: 'Duke Energy Carolinas',
    utility_name_pattern: 'duke energy|duke.*carolina|duke.*progress|duke.*nc|duke.*sc',
    state: 'NC',
    retail_rate_type: 'flat',
    blended_rate: 0.151,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at avoided cost rate.',
    export_rate_monthly: 0.151,
    export_rate_annual_excess: 0.038,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.038,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.151,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'under_review',
    policy_effect: 'at_risk',
    policy_note: 'Duke Energy has filed proceedings to reduce net metering compensation in both NC and SC. Current retail-rate net metering may be modified. Monitor Duke rate cases.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Midwest ──────────────────────────────────────────────────────────────────
  {
    utility_id: 'xcel_co',
    utility_name: 'Xcel Energy Colorado',
    utility_name_pattern: 'xcel',
    state: 'CO',
    retail_rate_type: 'flat',
    blended_rate: 0.163,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at retail rate.',
    export_rate_monthly: 0.163,
    export_rate_annual_excess: 0.163,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.163,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.163,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Colorado has strong net metering law. Xcel Energy offers retail-rate net metering with full annual rollover.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'dte_mi',
    utility_name: 'DTE Energy',
    utility_name_pattern: 'dte|detroit edison',
    state: 'MI',
    retail_rate_type: 'flat',
    blended_rate: 0.206,
    net_metering_type: 'net_billing',
    rollover_rules: 'Inflow/Outflow billing: exported kWh credited at avoided cost rate (~$0.09/kWh). Monthly net billing — no rollover.',
    export_rate_monthly: 0.09,
    export_rate_annual_excess: null,
    true_up_period: 'monthly',
    trueup_type: 'none',
    avoided_cost_rate: 0.09,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.206,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'changing',
    policy_effect: 'at_risk',
    policy_note: 'Michigan transitioned from traditional net metering to Inflow/Outflow billing in 2023. Exported energy is credited at avoided cost (~$0.09/kWh), significantly below the retail rate (~$0.188/kWh). System should be sized for self-consumption.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },
  {
    utility_id: 'consumers_mi',
    utility_name: 'Consumers Energy',
    utility_name_pattern: 'consumers energy|consumers',
    state: 'MI',
    retail_rate_type: 'flat',
    blended_rate: 0.206,
    net_metering_type: 'net_billing',
    rollover_rules: 'Inflow/Outflow billing: exported kWh credited at avoided cost. No monthly rollover.',
    export_rate_monthly: 0.088,
    export_rate_annual_excess: null,
    true_up_period: 'monthly',
    trueup_type: 'none',
    avoided_cost_rate: 0.088,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.206,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'changing',
    policy_effect: 'at_risk',
    policy_note: 'Michigan Inflow/Outflow billing applies. Exported energy credited well below retail. Optimize system for self-consumption over export.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Texas ────────────────────────────────────────────────────────────────────
  {
    utility_id: 'oncor_tx',
    utility_name: 'Oncor Electric',
    utility_name_pattern: 'oncor|ercot',
    state: 'TX',
    retail_rate_type: 'flat',
    blended_rate: 0.162,
    net_metering_type: 'none',
    rollover_rules: 'No statewide net metering mandate. Individual REPs (retail electric providers) may offer buy-back programs at their discretion, typically at wholesale rates ($0.02–$0.05/kWh).',
    export_rate_monthly: null,
    export_rate_annual_excess: null,
    true_up_period: 'none',
    trueup_type: 'none',
    avoided_cost_rate: 0.03,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.162,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Texas has no statewide net metering law. Export value depends on the retail electric provider (REP). System value comes primarily from self-consumption savings. Sizing to match daytime usage is optimal.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Nevada ───────────────────────────────────────────────────────────────────
  {
    utility_id: 'nv_energy',
    utility_name: 'NV Energy',
    utility_name_pattern: 'nv energy|nevada energy|nevada power',
    state: 'NV',
    retail_rate_type: 'flat',
    blended_rate: 0.138,
    net_metering_type: 'net_billing',
    rollover_rules: 'Monthly credits roll forward. Annual true-up: excess paid at avoided cost rate. NV Energy transitioned to NEM 3.0-style net billing.',
    export_rate_monthly: 0.075,
    export_rate_annual_excess: 0.075,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.075,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.138,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Nevada net metering 3.0 is in effect. Export credit rate is below retail. System should be sized for self-consumption optimization.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── New York ──────────────────────────────────────────────────────────────────
  {
    utility_id: 'con_ed_ny',
    utility_name: 'Con Edison',
    utility_name_pattern: 'con ed|consolidated edison|coned',
    state: 'NY',
    retail_rate_type: 'tiered',
    blended_rate: 0.271,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at average retail rate under VDER (Value of Distributed Energy Resources).',
    export_rate_monthly: 0.271,
    export_rate_annual_excess: 0.271,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.271,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: 'NY-Sun Incentive Program',
    utility_rate: 0.271,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'New York VDER (Value Stack) provides compensation based on time and location of generation. High electricity rates make solar economics strong.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Ohio ──────────────────────────────────────────────────────────────────────
  {
    utility_id: 'aep_oh',
    utility_name: 'AEP Ohio',
    utility_name_pattern: 'aep ohio|aep|ohio power|appalachian power',
    state: 'OH',
    retail_rate_type: 'flat',
    blended_rate: 0.179,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at retail rate.',
    export_rate_monthly: 0.179,
    export_rate_annual_excess: 0.179,
    true_up_period: 'annual',
    trueup_type: 'retail',
    avoided_cost_rate: 0.179,
    srec_available: true,
    srec_value_estimate: 3,
    srec_price_estimate: 3,
    srec_program_name: 'Ohio SREC Market (PJM)',
    utility_rate: 0.179,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'Ohio has retail-rate net metering. SREC market is active but lower-value (~$5–$10/MWh). Standard favorable solar policy environment.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Arizona ──────────────────────────────────────────────────────────────────
  {
    utility_id: 'aps_az',
    utility_name: 'Arizona Public Service',
    utility_name_pattern: 'aps|arizona public service',
    state: 'AZ',
    retail_rate_type: 'tou',
    blended_rate: 0.156,
    net_metering_type: 'avoided_cost',
    rollover_rules: 'Exported energy credited at Excess Generation Credit (~$0.076/kWh). No monthly kWh rollover — each month settled independently.',
    export_rate_monthly: 0.076,
    export_rate_annual_excess: null,
    true_up_period: 'monthly',
    trueup_type: 'none',
    avoided_cost_rate: 0.076,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.156,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'APS moved away from retail-rate net metering. Exported energy is compensated at the Excess Generation Credit rate (~$0.076/kWh), below the retail rate. System should be sized to minimize excess export.',
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ── Virginia ─────────────────────────────────────────────────────────────────
  {
    utility_id: 'dominion_va',
    utility_name: 'Dominion Energy Virginia',
    utility_name_pattern: 'dominion',
    state: 'VA',
    retail_rate_type: 'flat',
    blended_rate: 0.164,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up: excess paid at avoided cost rate.',
    export_rate_monthly: 0.164,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.164,
    escalation_rate: 0.035,
    escalation_source: 'utility_profile',
    policy_status: 'under_review',
    policy_effect: 'at_risk',
    policy_note: 'Dominion Energy Virginia has sought modifications to net metering in rate cases. Current retail-rate net metering is in place, but future changes are possible as the utility pursues rate reform.',
    confidence: 'medium',
    last_updated: '2026-07',
    data_confidence: 'medium',
  },

  // ── Hawaii ───────────────────────────────────────────────────────────────────
  {
    utility_id: 'hawaiian_electric',
    utility_name: 'Hawaiian Electric (HECO)',
    utility_name_pattern: 'hawaiian electric|heco|helco|maui electric|kiuc',
    state: 'HI',
    retail_rate_type: 'flat',
    blended_rate: 0.420,
    net_metering_type: 'net_billing',
    rollover_rules: 'Customer Self-Supply (CSS): exported energy credited at customer-generator avoided cost rate. Grid-supply option available for larger systems.',
    export_rate_monthly: 0.10,
    export_rate_annual_excess: 0.10,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.10,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.420,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: "Hawaii eliminated traditional net metering in 2015. CSS program credits exports at avoided cost. However, Hawaii's extremely high electricity rates make self-consumption savings very high. Battery storage strongly recommended.",
    confidence: 'high',
    last_updated: '2026-07',
    data_confidence: 'high',
  },

  // ─── Illinois Co-ops + additional states (EIA 861 + direct tariff sources) ────
  {
    utility_id: 'swec_il',
    utility_name: 'Southwestern Electric Cooperative',
    utility_name_pattern: 'southwestern electric|swec|sw electric coop|southwestern electric coop',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.148,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost. Illinois NEM 2.0 (Jan 2025+) limits new installs to supply-only credits.',
    export_rate_monthly: 0.148,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.148,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op purchasing from Wabash Valley Power. MISO capacity costs jumped to $666.50/MW-day in 2025. Serves 11 counties along I-70 corridor (Pocahontas/Greenville/Vandalia area). Illinois Shines SREC available. EIA 861 IL co-op avg 2025.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'coles_moultrie_il',
    utility_name: 'Coles-Moultrie Electric Cooperative',
    utility_name_pattern: 'coles.moultrie|coles moultrie electric',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.143,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.143,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.143,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op — EIA 861 IL co-op avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'norris_electric_il',
    utility_name: 'Norris Electric Cooperative',
    utility_name_pattern: 'norris electric|norris electric coop',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.143,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.143,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.143,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op — EIA 861 IL co-op avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'shelby_electric_il',
    utility_name: 'Shelby Electric Cooperative',
    utility_name_pattern: 'shelby electric|shelby electric coop',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.143,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.143,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.143,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op — EIA 861 IL co-op avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'corn_belt_energy_il',
    utility_name: 'Corn Belt Energy',
    utility_name_pattern: 'corn belt energy|corn belt electric',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.143,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.143,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.143,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op — EIA 861 IL co-op avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'spoon_river_il',
    utility_name: 'Spoon River Electric Cooperative',
    utility_name_pattern: 'spoon river electric|spoon river coop',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.143,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.143,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.143,
    escalation_rate: 0.06,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'IL co-op — EIA 861 IL co-op avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'cwlp_il',
    utility_name: 'City Water Light & Power Springfield IL',
    utility_name_pattern: 'cwlp|city water light|springfield.*electric|city of springfield.*electric',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.152,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.152,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.152,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'City-owned municipal utility, Springfield IL. EIA 861 municipal avg 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },
  {
    utility_id: 'midamerican_il',
    utility_name: 'MidAmerican Energy Illinois',
    utility_name_pattern: 'midamerican|mid-american|mid american energy',
    state: 'IL',
    retail_rate_type: 'flat',
    blended_rate: 0.118,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly kWh credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.118,
    export_rate_annual_excess: 0.032,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.032,
    srec_available: true,
    srec_value_estimate: 75,
    srec_price_estimate: 75,
    srec_program_name: 'Illinois Shines (Adjustable Block Program)',
    utility_rate: 0.118,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'MidAmerican Energy serves western IL. EIA 861 2025. Illinois Shines SREC available.',
    confidence: 'medium',
    last_updated: '2026-05',
    data_confidence: 'medium',
  },

  // ─── Additional major utilities ─────────────────────────────────────────
  {
    utility_id: 'georgia_power',
    utility_name: 'Georgia Power',
    utility_name_pattern: 'georgia power|southern company.*ga|georgia electric',
    state: 'GA',
    retail_rate_type: 'flat',
    blended_rate: 0.146,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.146,
    export_rate_annual_excess: 0.040,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.040,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.146,
    escalation_rate: 0.03,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 GA avg 14.60¢. Georgia Power net metering at retail rate up to 10kW (residential).',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'entergy_ar',
    utility_name: 'Entergy Arkansas',
    utility_name_pattern: 'entergy arkansas|entergy ar',
    state: 'AR',
    retail_rate_type: 'flat',
    blended_rate: 0.133,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.133,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.133,
    escalation_rate: 0.03,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 AR avg 13.32¢. Net metering at retail rate up to 25kW.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'entergy_la',
    utility_name: 'Entergy Louisiana',
    utility_name_pattern: 'entergy louisiana|entergy la|cleco|entergy new orleans',
    state: 'LA',
    retail_rate_type: 'flat',
    blended_rate: 0.124,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.124,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.124,
    escalation_rate: 0.025,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 LA avg 12.44¢. Cheapest state in US.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'xcel_mn',
    utility_name: 'Xcel Energy Minnesota / Northern States Power',
    utility_name_pattern: 'xcel.*mn|xcel.*minnesota|northern states power|nsp.*mn',
    state: 'MN',
    retail_rate_type: 'flat',
    blended_rate: 0.164,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual excess paid at avoided cost.',
    export_rate_monthly: 0.164,
    export_rate_annual_excess: 0.040,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.040,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.164,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 MN avg 16.44¢. Xcel/NSP serves metro MN.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'we_energies_wi',
    utility_name: 'We Energies / WPS Wisconsin',
    utility_name_pattern: 'we energies|wisconsin electric|wisconsin public service|wps|wpsc',
    state: 'WI',
    retail_rate_type: 'flat',
    blended_rate: 0.185,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual excess paid at avoided cost.',
    export_rate_monthly: 0.185,
    export_rate_annual_excess: 0.040,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.040,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.185,
    escalation_rate: 0.04,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 WI avg 18.45¢. We Energies + WPS serve most of WI.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'idaho_power',
    utility_name: 'Idaho Power',
    utility_name_pattern: 'idaho power|ipco',
    state: 'ID',
    retail_rate_type: 'flat',
    blended_rate: 0.125,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual excess paid at avoided cost.',
    export_rate_monthly: 0.125,
    export_rate_annual_excess: 0.040,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.040,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.125,
    escalation_rate: 0.025,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 ID avg 12.51¢. Idaho Power NEM at retail rate up to 100kW.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'alabama_power',
    utility_name: 'Alabama Power',
    utility_name_pattern: 'alabama power|southern company.*al',
    state: 'AL',
    retail_rate_type: 'flat',
    blended_rate: 0.168,
    net_metering_type: 'avoided_cost',
    rollover_rules: 'Exports credited at avoided cost only. No rollover credit.',
    export_rate_monthly: 0.060,
    export_rate_annual_excess: 0.060,
    true_up_period: 'monthly',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.060,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.168,
    escalation_rate: 0.03,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 AL avg 16.79¢. Alabama Power credits exports at avoided cost (~6¢). Self-consumption is primary value driver — size system accordingly.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'kentucky_utilities',
    utility_name: 'Kentucky Utilities / LG&E',
    utility_name_pattern: 'kentucky utilities|lge|louisville gas|kentucky power|aep.*ky|big sandy',
    state: 'KY',
    retail_rate_type: 'flat',
    blended_rate: 0.137,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.137,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.137,
    escalation_rate: 0.03,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 KY avg 13.68¢. KU/LG&E serve most of KY.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'tva_tn',
    utility_name: 'TVA / Local Power Company Tennessee',
    utility_name_pattern: 'tva|tennessee valley|local power company|lcub|kub|epb|mte.*tn|cub.*tn',
    state: 'TN',
    retail_rate_type: 'flat',
    blended_rate: 0.131,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual true-up at avoided cost.',
    export_rate_monthly: 0.131,
    export_rate_annual_excess: 0.035,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.035,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.131,
    escalation_rate: 0.025,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: 'EIA May 2026 TN avg 13.12¢. TVA Green Power Providers program for excess solar.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
  {
    utility_id: 'national_grid_ri',
    utility_name: 'National Grid Rhode Island',
    utility_name_pattern: 'national grid.*ri|national grid.*rhode|rhode island energy|ri energy',
    state: 'RI',
    retail_rate_type: 'flat',
    blended_rate: 0.313,
    net_metering_type: 'retail_1to1',
    rollover_rules: 'Monthly credits roll forward. Annual excess paid at avoided cost.',
    export_rate_monthly: 0.313,
    export_rate_annual_excess: 0.060,
    true_up_period: 'annual',
    trueup_type: 'avoided_cost',
    avoided_cost_rate: 0.060,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: 0.313,
    escalation_rate: 0.05,
    escalation_source: 'utility_profile',
    policy_status: 'stable',
    policy_effect: 'favorable',
    policy_note: 'EIA May 2026 RI avg 31.30¢. 4th most expensive state. Excellent solar ROI.',
    confidence: 'high',
    last_updated: '2026-05',
    data_confidence: 'high',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: buildUtilityProfile(project) function
// ─────────────────────────────────────────────────────────────────────────────

export interface BuiltUtilityProfile {
  profile: ProposalUtilityProfile;
  is_specific_match: boolean;
  is_state_fallback: boolean;
  resolved_rate: number;
  net_metering_summary: string;
  srec_summary: string | null;
  system_design_guidance: string;
  financial_rules: {
    export_rate: number;
    export_rate_annual_excess: number;
    trueup_type: TrueUpType;
    trueup_rate: number;
    true_up_period: TrueUpPeriod;
    use_self_consumption_model: boolean;
  };
  policy_message: string | null;
  using_conservative_estimates: boolean;
}

export function buildUtilityProfile(project: {
  utilityName?: string;
  state?: string;
  stateCode?: string;
  utilityRatePerKwh?: number;
  // v48.8: weak fallback — only used when no specific profile is matched.
  // A named utility match (e.g. ameren_il) has an EIA-verified rate that is more
  // accurate than a client's manually-entered or OCR-parsed bill rate, which often
  // reflects only the supply charge and not the full all-in blended rate.
  clientUtilityRateFallback?: number;
  client?: { state?: string; utilityRate?: number };
}): BuiltUtilityProfile {

  const stateCode = (
    project.stateCode ||
    project.state ||
    project.client?.state ||
    ''
  ).toUpperCase().trim().slice(0, 2);

  const utilityName = (project.utilityName || '').toLowerCase().trim();

  let matchedProfile: ProposalUtilityProfile | null = null;

  if (utilityName) {
    for (const p of PROPOSAL_UTILITY_PROFILES) {
      if (p.state !== stateCode && stateCode) continue;
      try {
        const pattern = new RegExp(p.utility_name_pattern, 'i');
        if (pattern.test(utilityName)) {
          matchedProfile = p;
          break;
        }
      } catch {
        // Pattern error — skip
      }
    }
  }

  const isSpecificMatch = matchedProfile !== null;
  const isStateFallback = !isSpecificMatch;
  const usingConservativeEstimates = !stateCode;

  const stateFallbackData = stateCode ? STATE_UTILITY_FALLBACK[stateCode] : null;

  if (!matchedProfile) {
    matchedProfile = buildStateFallbackProfile(stateCode, stateFallbackData);
  }

  // v48.10: Rate resolution logic
  // - utilityRatePerKwh: strong override ONLY when it's a credible full blended rate.
  //   For specific utility matches (e.g. ameren_il), the profile rate is EIA-verified.
  //   A "strong" override only wins if it's >= 85% of the profile rate — otherwise it's
  //   likely a supply-only OCR extraction (e.g. $0.107 when full rate is $0.155).
  // - clientUtilityRateFallback: weak override — ONLY used when there's no specific profile match.
  // - profile rate: always used for specific matches when override is absent or supply-only.
  const profileRate = matchedProfile.blended_rate || matchedProfile.utility_rate;
  const strongRate = project.utilityRatePerKwh ?? 0;

  // For a specific match, only trust the override if it's >= 85% of the profile rate.
  // This catches supply-only OCR extractions that are typically 45–70% of full retail.
  const strongRateIsCredible = isSpecificMatch
    ? (strongRate >= profileRate * 0.85)
    : (strongRate > 0.08);

  const resolvedRate = (strongRate > 0.08 && strongRateIsCredible)
    ? strongRate
    : isSpecificMatch
      ? profileRate
      : ( (project.clientUtilityRateFallback ?? 0) > 0.08
          ? project.clientUtilityRateFallback!
          : profileRate );

  const netMeteringSummary = getNetMeteringSummary(matchedProfile);
  const srecSummary = getSrecSummary(matchedProfile, resolvedRate);
  const systemDesignGuidance = getSystemDesignGuidance(matchedProfile);

  const exportRate = getExportRate(matchedProfile, resolvedRate);
  const exportRateAnnualExcess = getExportRateAnnualExcess(matchedProfile, resolvedRate);
  const financialRules = {
    export_rate: exportRate,
    export_rate_annual_excess: exportRateAnnualExcess,
    trueup_type: matchedProfile.trueup_type,
    trueup_rate: matchedProfile.trueup_type === 'retail'
      ? resolvedRate
      : (matchedProfile.avoided_cost_rate || exportRateAnnualExcess),
    true_up_period: matchedProfile.true_up_period,
    use_self_consumption_model: exportRate < resolvedRate * 0.75,
  };

  const policyMessage = getPolicyMessage(matchedProfile);

  return {
    profile: matchedProfile,
    is_specific_match: isSpecificMatch,
    is_state_fallback: isStateFallback,
    resolved_rate: resolvedRate,
    net_metering_summary: netMeteringSummary,
    srec_summary: srecSummary,
    system_design_guidance: systemDesignGuidance,
    financial_rules: financialRules,
    policy_message: policyMessage,
    using_conservative_estimates: usingConservativeEstimates,
  };
}

function buildStateFallbackProfile(
  stateCode: string,
  fallback: typeof STATE_UTILITY_FALLBACK[string] | null
): ProposalUtilityProfile {
  if (!fallback) {
    // SPEC §13: Failsafe for missing utility profile.
    // export_rate_monthly = retail_rate * 0.25 (conservative avoided-cost estimate, NOT retail offset)
    // net_metering_type = 'avoided_cost' (conservative — do NOT assume retail_1to1)
    // Consumers should be warned this is an unverified conservative estimate.
    const failsafeRetailRate = 0.15;
    const failsafeExportRate = parseFloat((failsafeRetailRate * 0.25).toFixed(4)); // = 0.0375
    return {
      utility_id: 'unknown_failsafe',
      utility_name: 'Your Electric Utility',
      utility_name_pattern: '',
      state: stateCode || 'US',
      retail_rate_type: 'flat',
      blended_rate: failsafeRetailRate,
      net_metering_type: 'avoided_cost',  // conservative — no retail_1to1 assumed without verification
      rollover_rules: 'Utility export structure not verified — conservative estimate applied.',
      export_rate_monthly: failsafeExportRate,        // retail * 0.25 per SPEC §13
      export_rate_annual_excess: failsafeExportRate,  // same conservative rate at true-up
      true_up_period: 'annual',
      trueup_type: 'avoided_cost',
      avoided_cost_rate: failsafeExportRate,
      srec_available: false,
      srec_value_estimate: null,
      srec_price_estimate: 0,
      srec_program_name: '',
      utility_rate: failsafeRetailRate,
      escalation_rate: 0.03,
      escalation_source: 'fallback',
      policy_status: 'stable',
      policy_effect: 'neutral',
      policy_note: '',
      confidence: 'low',
      last_updated: '2025-01',
      data_confidence: 'low',
    };
  }

  let netMeteringType: NetMeteringType = 'retail_1to1';
  let trueupType: TrueUpType = 'retail';
  let trueUpPeriod: TrueUpPeriod = 'annual';
  let avoidedCostRate = fallback.exportRate;
  let exportRateMonthly: number | null = fallback.exportRate;
  let exportRateAnnualExcess: number | null = fallback.exportRate;

  const policy = fallback.netMeteringPolicy.toLowerCase();
  if (!fallback.netMetering || policy.includes('no statewide') || policy.includes('no mandate')) {
    netMeteringType = 'none';
    trueupType = 'none';
    trueUpPeriod = 'none';
    exportRateMonthly = null;
    exportRateAnnualExcess = null;
  } else if (policy.includes('nem 3') || policy.includes('net billing') || policy.includes('inflow')) {
    netMeteringType = 'net_billing';
    trueupType = 'avoided_cost';
    trueUpPeriod = 'monthly';
    exportRateMonthly = fallback.exportRate;
    exportRateAnnualExcess = null;
  } else if (policy.includes('avoided cost')) {
    netMeteringType = 'avoided_cost';
    trueupType = 'avoided_cost';
    trueUpPeriod = 'monthly';
    exportRateMonthly = fallback.exportRate;
    exportRateAnnualExcess = null;
  } else if (policy.includes('retail rate') || policy.includes('retail')) {
    netMeteringType = 'retail_1to1';
    trueupType = 'retail';
    trueUpPeriod = 'annual';
    exportRateMonthly = fallback.avgRate;
    exportRateAnnualExcess = fallback.avgRate;
  }

  const avgRate = fallback.avgRate || 0.15;

  return {
    utility_id: `state_fallback_${stateCode}`,
    utility_name: stateCode ? `Your ${stateCode} Electric Utility` : 'Your Electric Utility',
    utility_name_pattern: '',
    state: stateCode,
    retail_rate_type: 'flat',
    blended_rate: avgRate,
    net_metering_type: netMeteringType,
    rollover_rules: fallback.netMeteringPolicy,
    export_rate_monthly: exportRateMonthly,
    export_rate_annual_excess: exportRateAnnualExcess,
    true_up_period: trueUpPeriod,
    trueup_type: trueupType,
    avoided_cost_rate: avoidedCostRate,
    srec_available: false,
    srec_value_estimate: null,
    srec_price_estimate: 0,
    srec_program_name: '',
    utility_rate: avgRate,
    escalation_rate: 0.03,
    escalation_source: 'state_avg_eia',
    policy_status: 'stable',
    policy_effect: 'neutral',
    policy_note: '',
    confidence: 'medium',
    last_updated: '2025-01',
    data_confidence: 'medium',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Data-driven messaging helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getNetMeteringSummary(profile: ProposalUtilityProfile): string {
  const rate = profile.blended_rate || profile.utility_rate;
  const exportMonthly = profile.export_rate_monthly ?? rate;
  const exportAnnual = profile.export_rate_annual_excess ?? profile.avoided_cost_rate;

  switch (profile.net_metering_type) {
    case 'retail_1to1':
      if (profile.trueup_type === 'retail') {
        return `Your utility offers full retail-rate net metering. Excess solar energy exported to the grid is credited at your full retail rate (~$${exportMonthly.toFixed(3)}/kWh). Credits roll forward monthly and any unused annual excess is settled at retail.`;
      } else {
        return `Your utility offers retail-rate net metering. Excess solar is credited at your retail rate (~$${exportMonthly.toFixed(3)}/kWh) during the month. At your annual true-up, any remaining excess is settled at the utility's avoided cost rate (~$${(exportAnnual ?? 0.04).toFixed(3)}/kWh).`;
      }

    case 'net_billing':
      return `Your utility uses a net billing structure. Solar energy you consume directly offsets your bill at full retail value (~$${rate.toFixed(3)}/kWh). Energy exported to the grid is credited at a lower rate (~$${(profile.export_rate_monthly ?? profile.avoided_cost_rate).toFixed(3)}/kWh). Maximizing self-consumption improves your system's economics.`;

    case 'avoided_cost':
      return `Your utility compensates exported solar energy at the avoided cost rate (~$${(profile.export_rate_monthly ?? profile.avoided_cost_rate).toFixed(3)}/kWh), which is below the retail rate (~$${rate.toFixed(3)}/kWh). Each solar kilowatt-hour you use directly in your home provides the most value.`;

    case 'none':
      return `Your utility does not offer a standard net metering program. The value of your solar system comes entirely from the electricity you consume directly, offsetting what you would otherwise purchase at ~$${rate.toFixed(3)}/kWh. Any excess generation beyond your immediate consumption is not compensated.`;
  }
}

export function getSrecSummary(
  profile: ProposalUtilityProfile,
  utilityRate: number
): string | null {
  const srecValue = profile.srec_value_estimate ?? profile.srec_price_estimate;
  if (!profile.srec_available || !srecValue || srecValue <= 0) return null;

  const annualMwhEstimate = 8;
  const annualSrecIncome = Math.round((srecValue / 1000) * annualMwhEstimate * 1000);

  return `${profile.srec_program_name}: Your utility's state participates in a Solar Renewable Energy Credit (SREC) program. For every 1,000 kWh (1 MWh) your system produces, you may earn one SREC, currently estimated at ~$${srecValue}/MWh. For a typical system, this could represent approximately $${annualSrecIncome}/year in additional income. SREC prices fluctuate with market supply and demand.`;
}

function getSystemDesignGuidance(profile: ProposalUtilityProfile): string {
  switch (profile.net_metering_type) {
    case 'retail_1to1':
      return profile.trueup_type === 'retail'
        ? 'System sized for 100% annual offset is optimal — excess monthly credits are fully valued at retail rate through annual true-up.'
        : 'System can be sized for 90–100% annual offset. Modest annual excess is acceptable, though settled at avoided cost rate.';
    case 'net_billing':
    case 'avoided_cost':
      return 'System should be sized to match daytime consumption rather than total annual usage. Over-sized systems export excess at significantly below-retail rates, reducing overall economics.';
    case 'none':
      return 'System should be sized to match daytime self-consumption patterns only. All production value comes from direct use — any excess exported to the grid is not compensated.';
  }
}

function getExportRate(profile: ProposalUtilityProfile, resolvedRate: number): number {
  switch (profile.net_metering_type) {
    case 'retail_1to1':
      // For 1:1 NEM, export rate cannot exceed the retail rate used for savings math.
      // If the project has a project-level rate override that is lower than the profile's
      // hardcoded export_rate_monthly, cap at resolvedRate to stay internally consistent.
      return Math.min(profile.export_rate_monthly ?? resolvedRate, resolvedRate);
    case 'net_billing':
      return profile.export_rate_monthly ?? profile.avoided_cost_rate;
    case 'avoided_cost':
      return profile.export_rate_monthly ?? profile.avoided_cost_rate;
    case 'none':
      return 0;
  }
}

function getExportRateAnnualExcess(profile: ProposalUtilityProfile, resolvedRate: number): number {
  if (profile.true_up_period === 'none') return 0;
  switch (profile.trueup_type) {
    case 'retail':
      return profile.export_rate_annual_excess ?? resolvedRate;
    case 'avoided_cost':
      return profile.export_rate_annual_excess ?? profile.avoided_cost_rate;
    case 'none':
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Policy Risk Engine (SPEC §8)
// ─────────────────────────────────────────────────────────────────────────────

export function getPolicyMessage(profile: ProposalUtilityProfile): string | null {
  // SPEC §8: under_review or changing → always inject compensation change message
  if (profile.policy_status === 'under_review' || profile.policy_status === 'changing') {
    return (profile.policy_note && profile.policy_note.trim())
      ? profile.policy_note
      : 'Utility compensation structure may change over time, impacting long-term export value.';
  }
  if (profile.policy_effect === 'neutral') return null;
  if (!profile.policy_note) return null;
  return profile.policy_note;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Net metering financial calculations
// ─────────────────────────────────────────────────────────────────────────────

export function calculateExportValue(params: {
  exportedKwh: number;
  profile: ProposalUtilityProfile;
  retailRate: number;
}): number {
  const { exportedKwh, profile, retailRate } = params;
  if (exportedKwh <= 0) return 0;
  switch (profile.net_metering_type) {
    case 'retail_1to1':
      return Math.round(exportedKwh * (profile.export_rate_monthly ?? retailRate));
    case 'net_billing':
    case 'avoided_cost':
      return Math.round(exportedKwh * (profile.export_rate_monthly ?? profile.avoided_cost_rate));
    case 'none':
      return 0;
  }
}

export function calculateRemainingUtility(params: {
  monthlyUsageKwh: number;
  monthlyProductionKwh: number;
  profile: ProposalUtilityProfile;
  retailRate: number;
}): number {
  const { monthlyUsageKwh, monthlyProductionKwh, profile, retailRate } = params;
  if (monthlyUsageKwh <= 0) return 0;

  const selfConsumed = Math.min(monthlyUsageKwh, monthlyProductionKwh);
  const exported = Math.max(0, monthlyProductionKwh - monthlyUsageKwh);
  const remainingConsumption = Math.max(0, monthlyUsageKwh - monthlyProductionKwh);

  switch (profile.net_metering_type) {
    case 'retail_1to1': {
      const remainingBill = remainingConsumption * retailRate;
      const exportCredit = exported * (profile.export_rate_monthly ?? retailRate);
      return Math.round(remainingBill - exportCredit);
    }
    case 'net_billing':
    case 'avoided_cost': {
      const remainingBill = remainingConsumption * retailRate;
      const exportCredit = exported * (profile.export_rate_monthly ?? profile.avoided_cost_rate);
      return Math.round(remainingBill - exportCredit);
    }
    case 'none': {
      return Math.round(remainingConsumption * retailRate);
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9b: Canonical Energy Flow Engine (SPEC v47.253)
// Single source of truth for all energy valuation.
// ALL proposal calculations must derive from these functions.
// NO production * retail_rate shortcuts anywhere in the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export interface EnergyFlow {
  selfConsumptionKwh: number;
  exportKwh: number;
}

export interface EnergyValueResult {
  selfConsumptionValue: number;
  exportValue: number;
  totalValue: number;
}

/**
 * SPEC v47.253 §2: Canonical energy flow split.
 * selfConsumptionKwh = min(production, usage)
 * exportKwh         = max(production - usage, 0)
 * RULE: exportKwh can never exceed productionKwh.
 */
export function computeEnergyFlow(productionKwh: number, usageKwh: number): EnergyFlow {
  const selfConsumptionKwh = Math.min(productionKwh, usageKwh);
  const exportKwh          = Math.max(productionKwh - usageKwh, 0);
  return { selfConsumptionKwh, exportKwh };
}

/**
 * SPEC v47.253 §3: Canonical energy value engine.
 * HARD RULE: Only retail_1to1 profiles may value export at retail rate.
 * net_billing / avoided_cost: export at profile.export_rate (below retail).
 * none: no export value.
 */
export function computeEnergyValue(
  flow: EnergyFlow,
  profile: ProposalUtilityProfile,
  retailRate: number
): EnergyValueResult {
  const selfConsumptionValue = flow.selfConsumptionKwh * retailRate;

  let exportValue = 0;
  switch (profile.net_metering_type) {
    case 'retail_1to1':
      // Only case where export is valued at (or near) retail rate
      exportValue = flow.exportKwh * (profile.export_rate_monthly ?? retailRate);
      break;
    case 'net_billing':
    case 'avoided_cost':
      // Export valued at below-retail profile rate — NEVER at retail
      exportValue = flow.exportKwh * (profile.export_rate_monthly ?? profile.avoided_cost_rate);
      break;
    case 'none':
      exportValue = 0;
      break;
  }

  return {
    selfConsumptionValue,
    exportValue,
    totalValue: selfConsumptionValue + exportValue,
  };
}

/**
 * SPEC v47.253 §4: True-up adjustment (annual profiles only).
 * Returns additional value for net annual kWh surplus settled at true-up rate.
 * Only applies when true_up_rule === 'annual' and annual_trueup_rate is defined.
 * For monthly/none settlement profiles: returns 0.
 */
export function applyTrueUp(
  flow: EnergyFlow,
  profile: ProposalUtilityProfile,
  usageKwh: number,
  productionKwh: number
): number {
  if (profile.true_up_period !== 'annual') return 0;
  const annualTrueupRate = profile.export_rate_annual_excess;
  if (!annualTrueupRate || annualTrueupRate <= 0) return 0;
  // Net annual surplus = production - usage (positive only)
  const netAnnualSurplus = Math.max(0, productionKwh - usageKwh);
  return netAnnualSurplus * annualTrueupRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Per-Year Energy Flow Model (SPEC §2)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnergyFlowYear {
  year: number;
  production_kwh: number;
  consumption_kwh: number;
  self_consumed_kwh: number;
  exported_kwh: number;
  retail_rate: number;
  self_consumed_value: number;
  monthly_export_value: number;
  annual_excess_value: number;
  total_energy_value: number;
  utility_cost_without_solar: number;
  utility_cost_with_solar: number;
  srec_income: number;
  cumulative_without_solar: number;
  cumulative_with_solar: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Full Iterative 25-Year Projection (SPEC §3–7)
// ─────────────────────────────────────────────────────────────────────────────

export interface Projection25yr {
  utility_cost_without_solar_25yr: number;
  solar_cost_total: number;
  remaining_utility_cost_total: number;
  net_financial_difference_25yr: number;
  estimated_energy_value_25yr: number;
  srec_income_25yr: number;
  yearlyFlow: EnergyFlowYear[];
}

export function calculate25yrProjection(params: {
  annualProductionKwh: number;
  annualUsageKwh: number;
  retailRate: number;
  profile: ProposalUtilityProfile;
  systemCost: number;
  financeTotal?: number;
  solarAnnualPayment?: number;
  loanYears?: number;
  panelDegradation?: number;
}): Projection25yr {
  const {
    annualProductionKwh,
    annualUsageKwh,
    retailRate,
    profile,
    systemCost,
    financeTotal,
    solarAnnualPayment = 0,
    loanYears = 25,
    panelDegradation = 0.005,
  } = params;

  // All rates from profile — SPEC §1: no hardcoded rates
  const escalation = profile.escalation_rate || 0.03;
  const exportRateMonthlyBase = getExportRate(profile, retailRate);
  const exportRateAnnualExcessBase = getExportRateAnnualExcess(profile, retailRate);

  // SREC: $/kWh equivalent
  const srecValueBase = profile.srec_value_estimate ?? profile.srec_price_estimate;
  const srecValuePerKwh = (profile.srec_available && srecValueBase && srecValueBase > 0)
    ? (srecValueBase / 1000)
    : 0;

  // SPEC §10 HARD FAIL check
  if (
    profile.net_metering_type !== 'retail_1to1' &&
    exportRateMonthlyBase > 0 &&
    Math.abs(exportRateMonthlyBase - retailRate) < 0.001
  ) {
    console.warn(
      `[TruthEngine] HARD FAIL: export_rate (${exportRateMonthlyBase}) ≈ retail_rate (${retailRate}) ` +
      `but net_metering_type="${profile.net_metering_type}". Check profile: ${profile.utility_id}`
    );
  }

  let utilityCostWithoutSolar = 0;
  let estimatedEnergyValue = 0;
  let remainingUtilityCost = 0;
  let srecIncome25yr = 0;
  let cumulativeWithoutSolar = 0;
  let cumulativeWithSolar = 0;

  const yearlyFlow: EnergyFlowYear[] = [];

  for (let i = 0; i < 25; i++) {
    // SPEC §3: iterative escalation from base rate — no shortcuts
    const rate = retailRate * Math.pow(1 + escalation, i);

    // SPEC §2: production with degradation
    const yearProduction = annualProductionKwh * Math.pow(1 - panelDegradation, i);

    // SPEC §2: split into self-consumed and exported
    const consumption = annualUsageKwh > 0 ? annualUsageKwh : yearProduction;
    const selfConsumed = Math.min(yearProduction, consumption);
    const exported = Math.max(0, yearProduction - consumption);
    // ASSERTION: exported_kwh ≤ production_kwh always holds by construction

    // SPEC §3: utility cost without solar (iterative, year by year)
    const yearUsageCost = consumption * rate;
    utilityCostWithoutSolar += yearUsageCost;
    cumulativeWithoutSolar += yearUsageCost;

    // SPEC §2: self-consumed value at this year's retail rate
    const selfConsumedValue = selfConsumed * rate;

    // SPEC §2 + §4: Export value model — utility-driven, NEM-type-aware
    // monthly_export_value: credits applied during the billing year at export_rate_monthly
    // annual_excess_value:  at true-up settlement, net annual surplus kWh paid at export_rate_annual_excess
    //   - Only applicable when true_up_period === 'annual' (not 'monthly' or 'none')
    //   - For retail_1to1/annual: annual surplus settled at export_rate_annual_excess (often avoided_cost rate)
    //   - For net_billing/annual: same — monthly at export_rate_monthly, surplus at export_rate_annual_excess
    //   - For trueup_period=monthly or none: annualExcessValue = 0 (settled monthly or no settlement)

    // Net annual energy balance: positive = annual surplus (more produced than consumed)
    const netAnnualKwh = yearProduction - consumption; // positive = net-producing year

    let monthlyExportKwh: number;
    let annualExcessKwh: number;

    if (profile.true_up_period === 'annual' && netAnnualKwh > 0) {
      // Annual true-up: all exported kWh credited monthly, but net surplus at year-end
      // is settled at the (typically lower) annual_excess rate
      // In a simplified annual model: treat monthly credits as (exported - netSurplus) * monthly_rate
      // and the net surplus kWh as annualExcess settled at export_rate_annual_excess
      monthlyExportKwh = Math.max(0, exported - netAnnualKwh);
      annualExcessKwh  = netAnnualKwh; // net surplus = annual true-up bucket
    } else {
      // Monthly settlement or no true-up: all exported kWh at monthly rate
      monthlyExportKwh = exported;
      annualExcessKwh  = 0;
    }

    const monthlyExportRate = profile.net_metering_type === 'retail_1to1'
      ? (profile.export_rate_monthly ?? rate)
      : (profile.export_rate_monthly ?? profile.avoided_cost_rate);

    const annualExcessRate = exportRateAnnualExcessBase; // from getExportRateAnnualExcess

    const scaledExportValue  = monthlyExportKwh * monthlyExportRate;
    const annualExcessValue  = annualExcessKwh  * annualExcessRate;

    const totalEnergyValue = selfConsumedValue + scaledExportValue + annualExcessValue;
    estimatedEnergyValue += totalEnergyValue;

    // SPEC §6: remaining utility bill with solar
    // remainingConsumption = max(0, consumption - production) — never negative
    const remainingConsumption = Math.max(0, consumption - yearProduction);
    const yearRemainingBill = remainingConsumption * rate;
    // For retail_1to1: monthly export credits reduce the net bill (rollover offsets future usage)
    // For net_billing/avoided_cost: bill only covers remaining consumption; export is separate credit
    // For none: full remaining bill, no credit
    const yearRemainingWithCredit = profile.net_metering_type === 'retail_1to1'
      ? Math.max(0, yearRemainingBill - scaledExportValue - annualExcessValue)
      : yearRemainingBill;
    remainingUtilityCost += yearRemainingWithCredit;

    // SPEC §7: SREC income added to solar scenario
    const yearSrecIncome = srecValuePerKwh * yearProduction;
    srecIncome25yr += yearSrecIncome;

    // Cumulative with-solar: solar payment (while loan active) + remaining utility
    const yearSolarPayment = i < loanYears ? solarAnnualPayment : 0;
    cumulativeWithSolar += yearRemainingWithCredit + yearSolarPayment;

    yearlyFlow.push({
      year: i + 1,
      production_kwh: Math.round(yearProduction),
      consumption_kwh: Math.round(consumption),
      self_consumed_kwh: Math.round(selfConsumed),
      exported_kwh: Math.round(exported),
      retail_rate: parseFloat(rate.toFixed(4)),
      self_consumed_value: Math.round(selfConsumedValue),
      monthly_export_value: Math.round(scaledExportValue),
      annual_excess_value: Math.round(annualExcessValue),
      total_energy_value: Math.round(totalEnergyValue),
      utility_cost_without_solar: Math.round(yearUsageCost),
      utility_cost_with_solar: Math.round(yearRemainingWithCredit),
      srec_income: Math.round(yearSrecIncome),
      cumulative_without_solar: Math.round(cumulativeWithoutSolar),
      cumulative_with_solar: Math.round(cumulativeWithSolar),
    });
  }

  return {
    utility_cost_without_solar_25yr: Math.round(utilityCostWithoutSolar),
    solar_cost_total: financeTotal ?? systemCost,
    remaining_utility_cost_total: Math.round(remainingUtilityCost),
    net_financial_difference_25yr: Math.round(estimatedEnergyValue - (financeTotal ?? systemCost)),
    estimated_energy_value_25yr: Math.round(estimatedEnergyValue),
    srec_income_25yr: Math.round(srecIncome25yr),
    yearlyFlow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: validateProposalTruth — enhanced validation (SPEC §9+10)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

export function validateProposalTruth(params: {
  effectiveFinal: number;
  annualEnergyValue: number;
  paybackYears: number;
  estimatedEnergyValue25yr: number;
  annualProductionKwh: number;
  utilityRate: number;
  energyOffset: number;
  annualUsageKwh: number;
  financeMonthlyPayment: number;
  remainingUtilityMonthly: number;
  totalEnergyCostMonthly: number;
  yearlyFlow?: EnergyFlowYear[];
  exportKwh?: number;
  productionKwh?: number;
  escalationSource?: string;
  escalationConfidence?: string;
  exportRate?: number;
  netMeteringType?: string;
  panelIntegrity?: PanelIntegrityResult;
}): ValidationResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  const {
    effectiveFinal,
    annualEnergyValue,
    paybackYears,
    estimatedEnergyValue25yr,
    annualProductionKwh,
    utilityRate,
    energyOffset,
    annualUsageKwh,
    financeMonthlyPayment,
    remainingUtilityMonthly,
    totalEnergyCostMonthly,
  } = params;

  // A1 (v47.253): annualEnergyValue sanity check — utility-aware
  // RULE: annualEnergyValue must be:
  //   (a) > 0 when production > 0
  //   (b) ≤ production × retailRate (can never EXCEED full retail offset)
  //   (c) For retail_1to1: may equal production × retailRate (full offset OK)
  //   (d) For net_billing/avoided_cost: will be < production × retailRate (by design)
  //   (e) Comparing against production × retailRate as an equality check is INVALID for non-retail_1to1
  if (annualProductionKwh > 0 && utilityRate > 0) {
    const maxPossibleValue = annualProductionKwh * utilityRate;
    if (annualEnergyValue <= 0) {
      failures.push(
        `[A1] annualEnergyValue is zero or negative: ${annualEnergyValue}. ` +
        `Production is ${annualProductionKwh} kWh — check energy flow engine.`
      );
    } else if (annualEnergyValue > maxPossibleValue * 1.01) {
      // > 1% above full retail offset is physically impossible
      failures.push(
        `[A1] annualEnergyValue (${annualEnergyValue}) exceeds max possible (${Math.round(maxPossibleValue)}) ` +
        `= production (${annualProductionKwh} kWh) × retail (${utilityRate}/kWh). Check export valuation.`
      );
    }
  }

  // A2: paybackYears ≈ effectiveFinal / annualEnergyValue (±10%)
  if (annualEnergyValue > 0 && effectiveFinal > 0 && paybackYears > 0) {
    const expectedPayback = effectiveFinal / annualEnergyValue;
    if (Math.abs(paybackYears - expectedPayback) > expectedPayback * 0.10) {
      warnings.push(
        `[A2] paybackYears mismatch: got ${paybackYears}, expected ~${expectedPayback.toFixed(1)}`
      );
    }
  }

  // A3: estimatedEnergyValue25yr ≥ annualEnergyValue × 25 × 0.85
  if (annualEnergyValue > 0 && estimatedEnergyValue25yr > 0) {
    const minExpected = annualEnergyValue * 25 * 0.85;
    if (estimatedEnergyValue25yr < minExpected) {
      failures.push(
        `[A3] estimatedEnergyValue25yr too low: got ${estimatedEnergyValue25yr}, ` +
        `minimum expected ${Math.round(minExpected)}`
      );
    }
  }

  // A4: energyOffset must be 0–100%
  if (energyOffset < 0 || energyOffset > 100) {
    failures.push(`[A4] energyOffset out of range: ${energyOffset}% (must be 0–100)`);
  }

  // A5: totalEnergyCostMonthly = financeMonthlyPayment + remainingUtilityMonthly (±$5)
  if (financeMonthlyPayment > 0) {
    const expected = financeMonthlyPayment + remainingUtilityMonthly;
    if (Math.abs(totalEnergyCostMonthly - expected) > 5) {
      failures.push(
        `[A5] totalEnergyCostMonthly mismatch: got ${totalEnergyCostMonthly}, expected ${expected}`
      );
    }
  }

  // A6: effectiveFinal must be positive
  if (effectiveFinal <= 0) {
    failures.push(`[A6] effectiveFinal is zero or negative: ${effectiveFinal}`);
  } else if (effectiveFinal > 500000) {
    warnings.push(`[A6] effectiveFinal unusually high: $${effectiveFinal.toLocaleString()}`);
  }

  // A7: Panel integrity
  if (params.panelIntegrity && !params.panelIntegrity.passed) {
    for (const f of params.panelIntegrity.failures) {
      failures.push(`[A7/Panel] ${f}`);
    }
  }

  // SPEC §9 A8: export value never exceeds production value
  if (params.exportKwh !== undefined && params.productionKwh !== undefined) {
    if (params.exportKwh > params.productionKwh + 1) {
      failures.push(
        `[A8] exported_kwh (${params.exportKwh}) exceeds production_kwh (${params.productionKwh}). ` +
        `Export cannot exceed production.`
      );
    }
  }

  // SPEC §9 A9: graph must use iterative model (yearlyFlow must be 25 entries)
  if (params.yearlyFlow !== undefined && params.yearlyFlow.length !== 25) {
    failures.push(`[A9] yearlyFlow must contain exactly 25 entries. Got ${params.yearlyFlow.length}.`);
  }

  // SPEC §10 A10: escalation_source=fallback must have confidence=low
  if (params.escalationSource === 'fallback_unverified' && params.escalationConfidence !== 'low') {
    failures.push(
      `[A10] escalation_source='fallback_unverified' but confidence='${params.escalationConfidence}'. Must be low.`
    );
  }

  // SPEC §10 A11: export_rate ≈ retail_rate only valid for retail_1to1
  if (
    params.exportRate !== undefined &&
    params.netMeteringType !== undefined &&
    params.netMeteringType !== 'retail_1to1' &&
    utilityRate > 0 &&
    Math.abs((params.exportRate ?? 0) - utilityRate) < 0.001
  ) {
    failures.push(
      `[A11] export_rate (${params.exportRate}) ≈ retail_rate (${utilityRate}) ` +
      `but net_metering_type="${params.netMeteringType}". Only valid for retail_1to1.`
    );
  }



  // SPEC v47.253 A9: Retail Overvaluation Check
  // IF any calculation uses exportKwh * retail_rate AND net_metering_type !== 'retail_1to1'
  // this is an overvaluation error. Check export rate vs retail rate for non-retail_1to1 profiles.
  if (
    params.exportKwh !== undefined &&
    params.productionKwh !== undefined &&
    params.exportRate !== undefined &&
    params.netMeteringType !== undefined &&
    params.netMeteringType !== 'retail_1to1' &&
    utilityRate > 0 &&
    params.exportKwh > 0
  ) {
    // exportRate must be < retail for all non-retail_1to1 profiles
    if ((params.exportRate ?? 0) >= utilityRate) {
      const msg = `[A9] EXPORT OVERVALUATION: exportRate (${params.exportRate}) >= retailRate (${utilityRate}) ` +
        `for net_metering_type="${params.netMeteringType}". Non-retail_1to1 export must be below retail.`;
      failures.push(msg);
      console.error('[ProposalTruthEngine][EXPORT OVERVALUATION DETECTED]', msg);
    }
  }

  // SPEC v47.253 A10: Value Consistency Check
  // totalEnergyValue must never exceed productionKwh * retailRate (max possible value)
  // If it does, something in the value engine is broken (double-counting or wrong rates)
  if (
    params.productionKwh !== undefined &&
    utilityRate > 0 &&
    annualEnergyValue > 0
  ) {
    const maxTheoretical = (params.productionKwh ?? 0) * utilityRate;
    if (maxTheoretical > 0 && annualEnergyValue > maxTheoretical * 1.01) {
      const msg = `[A10] VALUE OVERFLOW: annualEnergyValue (${annualEnergyValue}) > max theoretical ` +
        `(${Math.round(maxTheoretical)} = ${params.productionKwh} kWh × $${utilityRate}/kWh). ` +
        `Energy cannot be valued above full retail production.`;
      failures.push(msg);
      console.error('[ProposalTruthEngine][VALUE OVERFLOW DETECTED]', msg);
    }
  }

  // SPEC §12 A12: export_rate >= retail_rate is invalid for non-retail_1to1
  // Catches cases where export_rate meets or exceeds retail for billing/avoided_cost profiles
  if (
    params.exportRate !== undefined &&
    params.netMeteringType !== undefined &&
    params.netMeteringType !== 'retail_1to1' &&
    utilityRate > 0 &&
    (params.exportRate ?? 0) >= utilityRate
  ) {
    const msg =
      `[A12] Invalid export rate logic: export_rate (${params.exportRate}) >= retail_rate (${utilityRate}) ` +
      `for net_metering_type="${params.netMeteringType}". Export can only equal retail for retail_1to1.`;
    failures.push(msg);
    if (typeof window !== 'undefined' || typeof process !== 'undefined') {
      console.error('[ProposalTruthEngine][A12 EXPORT RATE INVALID]', msg);
    }
  }
  const passed = failures.length === 0;

  if (!passed && typeof window !== 'undefined') {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.error('[ProposalTruthEngine][VALIDATION FAILED]', failures);
    } else {
      console.warn('[ProposalTruthEngine][VALIDATION WARNINGS]', failures);
    }
  }

  return { passed, failures, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Panel Data Integrity Engine
// ─────────────────────────────────────────────────────────────────────────────

export interface PanelSpec {
  manufacturer: string;
  model: string;
  wattage: number;
  efficiency?: number;
  width?: number;
  height?: number;
}

export interface PanelIntegrityResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  resolvedWattage: number;
  resolvedSystemSizeKw: number;
  resolvedPanelCount: number;
}

export function validatePanelIntegrity(params: {
  panelSpec: PanelSpec | null | undefined;
  panelCount: number;
  systemSizeKw: number;
}): PanelIntegrityResult {
  const { panelSpec, panelCount, systemSizeKw } = params;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!panelSpec || !panelSpec.wattage) {
    warnings.push('[P0] No panel spec available. Panel wattage cross-check skipped.');
    return {
      passed: true, failures, warnings,
      resolvedWattage: panelCount > 0 && systemSizeKw > 0
        ? Math.round((systemSizeKw * 1000) / panelCount) : 0,
      resolvedSystemSizeKw: systemSizeKw,
      resolvedPanelCount: panelCount,
    };
  }

  const wattage = panelSpec.wattage;
  const resolvedSystemSizeKw = panelCount > 0 ? (panelCount * wattage) / 1000 : systemSizeKw;

  if (panelCount > 0 && systemSizeKw > 0) {
    const expectedSizeKw = (panelCount * wattage) / 1000;
    const tolerance = expectedSizeKw * 0.02;
    if (Math.abs(systemSizeKw - expectedSizeKw) > tolerance) {
      failures.push(
        `[P1] system_size mismatch: layout says ${systemSizeKw.toFixed(3)} kW, ` +
        `but panel_count(${panelCount}) x wattage(${wattage}W) = ${expectedSizeKw.toFixed(3)} kW.`
      );
    }
  }

  if (panelCount <= 0) {
    failures.push(`[P2] panel_count is zero or negative: ${panelCount}`);
  } else if (!Number.isInteger(panelCount)) {
    warnings.push(`[P2] panel_count is not an integer: ${panelCount}`);
  }

  if (wattage < 200 || wattage > 700) {
    failures.push(`[P3] Panel wattage out of expected range: ${wattage}W (expected 200–700W)`);
  }

  if (panelSpec.efficiency !== undefined) {
    const eff = panelSpec.efficiency;
    const effPct = eff > 1 ? eff : eff * 100;
    if (effPct < 12 || effPct > 25) {
      warnings.push(`[P4] Panel efficiency out of expected range: ${effPct.toFixed(1)}%`);
    }
  }

  if (!panelSpec.model || panelSpec.model.trim() === '') {
    warnings.push('[P5] Panel model name is empty');
  }

  const passed = failures.length === 0;

  if (typeof window !== 'undefined') {
    if (!passed) {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) console.error('[ProposalTruthEngine][PANEL INTEGRITY FAILED]', failures);
      else console.warn('[ProposalTruthEngine][PANEL INTEGRITY WARNINGS]', failures);
    }
  }

  return { passed, failures, warnings, resolvedWattage: wattage, resolvedSystemSizeKw, resolvedPanelCount: Math.round(panelCount) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: Failsafe message for missing utility data
// ─────────────────────────────────────────────────────────────────────────────

export function getFailsafeMessage(builtProfile: BuiltUtilityProfile): string | null {
  // SPEC §13: fully unknown utility — specific language + conservative estimate warning
  if (builtProfile.profile.utility_id === 'unknown_failsafe') {
    return "Utility export structure not verified \u2014 conservative estimate applied. " +
      "Export value is estimated at 25% of retail rate. " +
      "Actual export compensation depends on your utility's net metering policy. " +
      "Contact your installer or utility to confirm actual terms before making financial decisions.";
  }
  if (builtProfile.using_conservative_estimates) {
    return "Utility-specific rules are not available for this location. Conservative industry-average estimates are used for all financial projections. Actual results may vary based on your specific utility's net metering policy and rate structure.";
  }
  if (builtProfile.is_state_fallback && builtProfile.profile.data_confidence === 'low') {
    return "Detailed utility data is not available for this utility. State-average estimates are used. Consult your installer for utility-specific net metering terms.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience re-exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  getExportRate as _getExportRate,
};