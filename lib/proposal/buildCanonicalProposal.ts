/**
 * lib/proposal/buildCanonicalProposal.ts
 * v48.3 — Deterministic Canonical Proposal Pipeline (Bill Rate → Proposal Connection)
 *
 * ARCHITECTURE:
 *   This is the ONLY place calculations live.
 *   The UI (page.tsx) calls this once and renders the result.
 *   No math is permitted outside this file and proposalTruthEngine.ts.
 *
 * PIPELINE STEPS (strict order, each step depends on the previous):
 *   1. PANEL      — validatePanelIntegrity() → resolved wattage / count / systemSizeKw
 *   2. PRODUCTION — annualKwh, monthlyKwh[12]
 *   3. UTILITY    — buildUtilityProfile() → rate, escalation, NEM type, export rate
 *   4. FINANCIAL  — system cost, financing, monthly payments, ownership delta
 *   5. TRUTH25YR  — calculate25yrProjection() → single netDifference savings definition
 *   6. OFFSET     — percentage, remainingPercentage, isPartialOffset
 *   7. POLICY     — SREC, incentivesAllowed, policyMessage, NEM/failsafe summaries
 *   8. RETURN     — assembled CanonicalProposal
 *
 * SAVINGS DEFINITION (enforced in Step 5, no other version exists):
 *   netDifference = utilityCostWithoutSolar - (solarCostTotal + remainingUtilityCost)
 *
 * v47.250 CHANGES:
 *   - calculate25yrProjection now receives solarAnnualPayment, loanYears, panelDegradation
 *   - yearlyFlow from iterative model wired into truth25yr (SPEC §5)
 *   - projectionChart derived from yearlyFlow — no inline recomputation (SPEC §5)
 *   - New utility fields wired: retail_rate_type, export_rate_monthly,
 *     export_rate_annual_excess, true_up_period, policy_status, confidence
 *   - srec_income_25yr wired into truth25yr
 *
 * DEV ASSERTION LOCK:
 *   In development mode (NODE_ENV === 'development'), any truth violation
 *   throws Error("TRUTH VIOLATION: <details>") immediately.
 *   In production, violations are logged as console.error but never throw.
 */

import type { CanonicalProposal, CanonicalProduction, CanonicalEnergyFlowYear, CanonicalIncentives } from './canonicalProposal';
import {
  isItcEnabled,
  areStateIncentivesEnabled,
  guardItcValue,
  getIncentivesComplianceMessage,
} from '../incentivesConfig';
import {
  resolveEscalationSource,
  computeTruthConfidence,
} from './utilityTruthEngine';
import {
  buildFinancialNarrative,
  computePayoffYear,
  computePayoffFromFlow,
} from './financialNarrativeEngine';
import {
  validatePanelIntegrity,
  buildUtilityProfile,
  calculate25yrProjection,
  calculateRemainingUtility,
  getNetMeteringSummary,
  getSrecSummary,
  getPolicyMessage,
  getFailsafeMessage,
  type EnergyFlowYear,
  type PanelSpec,
} from '../proposalTruthEngine';
import {
  illinoisShinesGroupForUtility,
  illinoisShinesRecPrice,
  IL_SHINES_PROGRAM_YEAR,
  IL_SHINES_CUSTOMER_OWNED_ADDER,
} from '../incentives/illinoisShines';
import {
  resolveDefaultFencePanelSpec,
  getPanelDegradationRate,
} from '../systemEquipmentResolver';
import { getDbReady } from '@/lib/db-neon';

// ─────────────────────────────────────────────────────────────────────────────
// Input type for the pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildCanonicalProposalInput {
  // Panel data (from project.selectedPanel + layout)
  panelSpec: PanelSpec | null | undefined;
  panelCount: number;
  layoutSystemSizeKw: number;   // from layout.systemSizeKw (used as hint only — P1 validates)

  // Production data (from PVWatts or layout engine)
  annualProductionKwh: number;
  monthlyProductionKwh: number[];  // 12-element array

  // Utility / client data
  utilityName: string;
  stateCode: string;              // 2-letter state code
  clientState: string;            // full state name (fallback)
  address?: string;               // v48.17: project address — used for ZIP lookup when utilityName is empty
  zip?: string;                   // v48.17: explicit ZIP code override
  utilityRateOverride?: number;   // project-level rate override (must be > 0.10 to apply)
  clientUtilityRate?: number;     // client bill-derived rate (fallback)
  parsedBillRate?: number;        // v48.3: rate extracted from uploaded utility bill (highest priority)
  dbUtilityRate?: number;         // v48.3: rate fetched from utility_policies DB (second priority)
  annualUsageKwh: number;         // from client.annualKwh
  /**
   * v48.x: the homeowner's ACTUAL total annual utility bill in dollars (from
   * their real bill — includes delivery, fixed charges, and taxes, not just
   * energy). When present and plausible, the model anchors the effective
   * $/kWh to (actualAnnualBill ÷ annualUsageKwh) so the proposal's current
   * bill, 25-yr projection, and savings all reconcile with the real bill
   * instead of an energy-only estimate.
   */
  actualAnnualBill?: number;      // from client.annualBill

  // Pricing
  systemType: 'roof' | 'ground' | 'fence' | 'carport' | string;
  storedCashPrice: number;        // cost.cashPrice ?? cost.grossCost (0 if not stored)
  roofPricePerWatt?: number;
  groundPricePerWatt?: number;
  fencePricePerWatt?: number;
  carportPricePerWatt?: number;
  defaultPricePerWatt?: number;   // fallback $/W

  // Financing
  loanApr?: number;               // % (e.g. 7.99)
  loanTermYears?: number;         // e.g. 25
  purchaseMode: 'finance' | 'cash';

  // Policy / incentives
  isCommercial?: boolean;
  noItc?: boolean;              // suppress ITC display for clients who don't qualify (e.g. non-tax-liability residential)

  // Shade analysis (v1.shade)
  /**
   * System-level shade derate percentage computed from per-panel annualShadeFactor
   * values in the design layout.  Range 0–100.  0 means no shade data or no shade.
   *
   * Computed by:
   *   shadedPanels = panels.filter(p => typeof p.annualShadeFactor === 'number')
   *   avgFactor = mean(shadedPanels.map(p => p.annualShadeFactor))
   *   panelsShadeDerateComputedPct = (1 - avgFactor) * 100
   *
   * When provided, TSRF and shadeDerateApplied are set on CanonicalProduction.
   * The actual kWh impact was already applied by PVWatts via effectiveLosses.
   */
  panelsShadeDerateComputedPct?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const SEASONAL_FACTORS = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87] as const;
// PANEL_DEGRADATION is now system-type-aware via getPanelDegradationRate()
// Sol Fence (Philadelphia Solar Nexus): 0.004 (0.4%/yr) | All others: 0.005 (0.5%/yr)
const PIPELINE_VERSION = 'v48.3';

// Default $/W by system type (used only when storedCashPrice = 0)
const DEFAULT_PPW: Record<string, number> = {
  roof:    3.10,
  ground:  2.35,
  fence:   4.25,
  carport: 3.75,
};

// ─────────────────────────────────────────────────────────────────────────────
// Dev assertion lock
// ─────────────────────────────────────────────────────────────────────────────

function assertTruth(condition: boolean, message: string, warnings: string[]): void {
  if (!condition) {
    const fullMessage = `TRUTH VIOLATION: ${message}`;
    if (process.env.NODE_ENV === 'development') {
      throw new Error(fullMessage);
    } else {
      console.error(`[CanonicalPipeline][${PIPELINE_VERSION}]`, fullMessage);
      warnings.push(fullMessage);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: map EnergyFlowYear → CanonicalEnergyFlowYear
// Identity map — same fields, typed separately so UI consumers don't need
// to import from proposalTruthEngine directly.
// ─────────────────────────────────────────────────────────────────────────────

function mapEnergyFlowYear(y: EnergyFlowYear): CanonicalEnergyFlowYear {
  return {
    year:                      y.year,
    production_kwh:            y.production_kwh,
    consumption_kwh:           y.consumption_kwh,
    self_consumed_kwh:         y.self_consumed_kwh,
    exported_kwh:              y.exported_kwh,
    retail_rate:               y.retail_rate,
    self_consumed_value:       y.self_consumed_value,
    monthly_export_value:      y.monthly_export_value,
    annual_excess_value:       y.annual_excess_value,
    total_energy_value:        y.total_energy_value,
    utility_cost_without_solar: y.utility_cost_without_solar,
    utility_cost_with_solar:   y.utility_cost_with_solar,
    srec_income:               y.srec_income,
    cumulative_without_solar:  y.cumulative_without_solar,
    cumulative_with_solar:     y.cumulative_with_solar,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject fixed / non-energy utility charges (delivery, meter/connection fee,
// taxes) into a 25-yr projection. Solar does NOT offset these — the customer
// stays grid-connected and keeps paying them — so they're added to BOTH the
// without-solar and with-solar streams each year (escalating with rates). Net
// savings (the difference) is unchanged; only the absolute displayed costs
// become honest, and "after solar" is never falsely shown as $0.
// ─────────────────────────────────────────────────────────────────────────────
function applyFixedCharges(
  proj: ReturnType<typeof calculate25yrProjection>,
  fixedAnnualBase: number,
  escalation: number,
): ReturnType<typeof calculate25yrProjection> {
  if (fixedAnnualBase <= 0) return proj;
  let cumAdd = 0;
  let sumFixed = 0;
  const yearlyFlow = proj.yearlyFlow.map((y, i) => {
    const fixedY = Math.round(fixedAnnualBase * Math.pow(1 + escalation, i));
    cumAdd += fixedY;
    sumFixed += fixedY;
    return {
      ...y,
      utility_cost_without_solar: y.utility_cost_without_solar + fixedY,
      utility_cost_with_solar:    y.utility_cost_with_solar + fixedY,
      cumulative_without_solar:   y.cumulative_without_solar + cumAdd,
      cumulative_with_solar:      y.cumulative_with_solar + cumAdd,
    };
  });
  return {
    ...proj,
    yearlyFlow,
    utility_cost_without_solar_25yr: proj.utility_cost_without_solar_25yr + sumFixed,
    remaining_utility_cost_total:    proj.remaining_utility_cost_total + sumFixed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v48.3: Async DB rate fetcher (mirrors fetchRateFromDb in billEnrichment.ts)
// Call this BEFORE buildCanonicalProposal() from server-side callers and pass
// the result as input.dbUtilityRate.  No-ops gracefully if DB is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchProposalUtilityRate(
  utilityName: string | null | undefined,
  stateCode: string | null | undefined,
): Promise<number | null> {
  const RATE_MIN = 0.05;
  const RATE_MAX = 0.50;
  if (!utilityName) return null;
  try {
    const sql = await getDbReady();
    // Exact match first
    const rows = await sql`
      SELECT retail_rate, default_residential_rate
      FROM utility_policies
      WHERE LOWER(TRIM(utility_name)) = LOWER(TRIM(${utilityName}))
        ${stateCode ? sql`AND state = ${stateCode.toUpperCase()}` : sql``}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const rate = (rows[0].retail_rate ?? rows[0].default_residential_rate) as number | null;
      if (rate && rate >= RATE_MIN && rate <= RATE_MAX) return rate;
    }
    // Trigram fuzzy match fallback
    if (stateCode) {
      const fuzzyRows = await sql`
        SELECT retail_rate, default_residential_rate
        FROM utility_policies
        WHERE state = ${stateCode.toUpperCase()}
          AND similarity(LOWER(utility_name), LOWER(${utilityName})) > 0.45
        ORDER BY similarity(LOWER(utility_name), LOWER(${utilityName})) DESC
        LIMIT 1
      `.catch(() => [] as any[]);
      if (fuzzyRows.length > 0) {
        const rate = (fuzzyRows[0].retail_rate ?? fuzzyRows[0].default_residential_rate) as number | null;
        if (rate && rate >= RATE_MIN && rate <= RATE_MAX) return rate;
      }
    }
  } catch {
    // DB unavailable — callers fall through to next tier in rate chain
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export function buildCanonicalProposal(
  input: BuildCanonicalProposalInput
): CanonicalProposal {
  const warnings: string[] = [];
  const builtAt = new Date().toISOString();

  // ─── STEP 1: PANEL ──────────────────────────────────────────────────────────
  // validatePanelIntegrity is the single authority on wattage, count, systemSizeKw.
  // resolvedSystemSizeKw = (resolvedPanelCount × resolvedWattage) / 1000 — always.
  // This value is used for ALL subsequent calculations. layoutSystemSizeKw is only
  // passed to P1 for cross-validation — it is NEVER used downstream directly.
  //
  // v47.242: For Sol Fence systems with no panelSpec, inject the Philadelphia Solar
  // Nexus PS-MNB108(HCBF)-440W as the default. Roof/ground are unaffected.
  // Store full SolarPanel for extended display fields (cellType, bifacial, temperatureCoeff, warranty).

  const sysTypeNorm = (input.systemType || 'roof').toLowerCase();
  const isFenceSystem = sysTypeNorm === 'fence' || sysTypeNorm === 'sol_fence' || sysTypeNorm === 'solfence';

  // Full SolarPanel object for fence default (has cellType, bifacial, etc.)
  const _fenceDefaultPanel = isFenceSystem && !input.panelSpec ? resolveDefaultFencePanelSpec() : null;

  const resolvedPanelSpec: PanelSpec | null = input.panelSpec ?? (
    _fenceDefaultPanel ? {
      manufacturer: _fenceDefaultPanel.manufacturer,
      model:        _fenceDefaultPanel.model,
      wattage:      _fenceDefaultPanel.wattage,
      efficiency:   _fenceDefaultPanel.efficiency,
      width:        _fenceDefaultPanel.width,
      height:       _fenceDefaultPanel.height,
    } : null
  );

  // Full panel detail source: fence default overrides input panelSpec for extended fields
  // when the selected panel is still the generic default (no custom fence panel assigned).
  const _fullPanelSource = _fenceDefaultPanel ?? (input.panelSpec as any) ?? null;

  // System-type-aware panel degradation rate
  const PANEL_DEGRADATION = getPanelDegradationRate(input.systemType);

  const panelIntegrity = validatePanelIntegrity({
    panelSpec:    resolvedPanelSpec,
    panelCount:   input.panelCount,
    systemSizeKw: input.layoutSystemSizeKw,
  });

  if (!panelIntegrity.passed) {
    panelIntegrity.failures.forEach(f => {
      assertTruth(false, f, warnings);
    });
  }
  warnings.push(...panelIntegrity.warnings);

  const resolvedWattage      = panelIntegrity.resolvedWattage;
  const resolvedPanelCount   = panelIntegrity.resolvedPanelCount;
  // CANONICAL system size: always (count × wattage) / 1000
  const resolvedSystemSizeKw = resolvedPanelCount > 0 && resolvedWattage > 0
    ? (resolvedPanelCount * resolvedWattage) / 1000
    : panelIntegrity.resolvedSystemSizeKw;

  // RULE 5 — DEV ASSERTION: system size truth lock
  // If count and wattage are both valid, the canonical size MUST equal (count × wattage) / 1000.
  // Any drift here means something upstream is overriding the canonical pipeline — catch it immediately.
  if (process.env.NODE_ENV === 'development' && resolvedPanelCount > 0 && resolvedWattage > 0) {
    const expectedKw = (resolvedPanelCount * resolvedWattage) / 1000;
    if (Math.abs(expectedKw - resolvedSystemSizeKw) > 0.001) {
      throw new Error(
        `SYSTEM SIZE TRUTH VIOLATION: expected ${expectedKw.toFixed(3)} kW ` +
        `(${resolvedPanelCount} panels × ${resolvedWattage}W) ` +
        `but got ${resolvedSystemSizeKw.toFixed(3)} kW. ` +
        `Do NOT override resolvedSystemSizeKw after canonical pipeline.`
      );
    }
  }

  const panel = {
    manufacturer:     resolvedPanelSpec?.manufacturer ?? '',
    model:            resolvedPanelSpec?.model ?? '',
    wattage:          resolvedWattage,
    count:            resolvedPanelCount,
    systemSizeKw:     resolvedSystemSizeKw,
    efficiency:       resolvedPanelSpec?.efficiency,
    // Extended display fields — from fence default or selectedPanel
    cellType:         _fullPanelSource?.cellType ?? null,
    bifacial:         _fullPanelSource?.bifacial ?? false,
    bifacialFactor:   _fullPanelSource?.bifacialFactor ?? 1.0,
    temperatureCoeff: _fullPanelSource?.temperatureCoeff ?? null,
    warranty:         _fullPanelSource?.warranty ?? 25,
  };

  // ─── STEP 2: PRODUCTION ─────────────────────────────────────────────────────
  // Production comes from PVWatts/layout engine. We do NOT recalculate it.
  // Monthly array must be 12 elements; pad with zeros if short.

  // v48.17: PVWatts CONUS average monthly production fractions (south-facing 20 deg tilt).
  // Used as fallback when the snapshot has no monthly array (older proposals).
  // Sum = 1.0000.  Source: NREL PVWatts v8 US national average.
  const PVWATTS_MONTHLY_FRACTIONS = [
    0.0612, // Jan
    0.0692, // Feb
    0.0894, // Mar
    0.0943, // Apr
    0.0985, // May
    0.0972, // Jun
    0.0962, // Jul
    0.0928, // Aug
    0.0837, // Sep
    0.0728, // Oct
    0.0547, // Nov
    0.0500, // Dec
  ]; // sum ≈ 1.0000

  const rawMonthly = input.monthlyProductionKwh ?? [];
  const hasRealMonthly = rawMonthly.some((v: number) => v > 0);
  const annualKwh = input.annualProductionKwh > 0
    ? input.annualProductionKwh
    : rawMonthly.reduce((a: number, b: number) => a + b, 0);

  // If the monthly array is all-zeros but we have an annual total, synthesise
  // estimated monthly values using PVWatts seasonal fractions so the bar chart
  // doesn't show as empty.  Values are clearly estimated (not from PVWatts run).
  let monthlyKwh: number[];
  if (hasRealMonthly) {
    monthlyKwh = Array.from({ length: 12 }, (_: unknown, i: number) => rawMonthly[i] ?? 0);
  } else if (annualKwh > 0) {
    monthlyKwh = PVWATTS_MONTHLY_FRACTIONS.map((f: number) => Math.round(annualKwh * f));
  } else {
    monthlyKwh = Array(12).fill(0) as number[];
  }

  assertTruth(
    annualKwh >= 0,
    `annualProductionKwh is negative: ${annualKwh}`,
    warnings
  );

  const production: CanonicalProduction = { annualKwh, monthlyKwh };

  // v1.shade: Attach TSRF + shade derate to production when shade analysis was run
  // TSRF = Total Solar Resource Fraction = 1 - (shadeDeratePct / 100)
  // The kWh impact was already applied by PVWatts effective losses; this is display metadata.
  if (
    typeof input.panelsShadeDerateComputedPct === 'number' &&
    input.panelsShadeDerateComputedPct > 0
  ) {
    const clampedDerate = Math.min(100, Math.max(0, input.panelsShadeDerateComputedPct));
    production.shadeDerateApplied = Math.round(clampedDerate * 10) / 10; // 1 decimal place
    production.tsrf               = Math.round((1 - clampedDerate / 100) * 1000) / 1000; // 3 decimal places
  }

  // ─── STEP 3: UTILITY ────────────────────────────────────────────────────────
  // buildUtilityProfile resolves rate, NEM type, export rate, escalation,
  // SREC, and policy from structured data. No utility-name string logic.

  // v48.8: 4-tier rate priority chain (revised)
  // Tier 1: parsedBillRate    — extracted directly from uploaded utility bill (most accurate)
  // Tier 2: dbUtilityRate     — fetched from utility_policies DB via fetchProposalUtilityRate()
  // Tier 3: utilityRateOverride — project-level manual override (installer set deliberately)
  // Tier 4: clientUtilityRate — ONLY used when no specific profile match exists.
  //                             When a named utility is matched (e.g. ameren_il), the profile rate
  //                             is EIA-verified and more current than a client's manually-entered rate,
  //                             which is often the supply-only portion, not the all-in blended rate.
  //                             clientUtilityRate is passed to buildUtilityProfile as a weak fallback
  //                             that the profile engine only uses for state-fallback / unknown utilities.
  // Fallback: 0.15 hardcoded national average
  function validRate(r: number | null | undefined): r is number {
    return typeof r === 'number' && isFinite(r) && r >= 0.05 && r <= 0.50;
  }

  // Strong overrides: parsedBillRate (OCR bill), dbUtilityRate, utilityRateOverride (manual).
  // These take precedence over the profile rate regardless of match quality.
  const strongRateOverride: number | undefined =
    validRate(input.parsedBillRate)      ? input.parsedBillRate      :
    validRate(input.dbUtilityRate)       ? input.dbUtilityRate       :
    validRate(input.utilityRateOverride) ? input.utilityRateOverride :
    undefined;

  // clientUtilityRate is a weak override: passed to buildUtilityProfile but only wins
  // when no specific profile is matched (state-fallback or failsafe path).
  const utilityRatePerKwh = strongRateOverride ?? 0;

  // v48.4: dev-only rate source trace — never logged in production
  if (process.env.NODE_ENV !== 'production') {
    const source =
      validRate(input.parsedBillRate)      ? 'parsed'   :
      validRate(input.dbUtilityRate)       ? 'db'        :
      validRate(input.utilityRateOverride) ? 'override'  :
      'profile_or_client_fallback';
    console.log('[PROPOSAL_RATE_SOURCE v48.8]', {
      source,
      strongOverride: strongRateOverride ?? null,
      clientRate: input.clientUtilityRate ?? null,
      utility: input.utilityName ?? 'unknown',
      state:   input.stateCode   ?? '??',
    });
  }

  const builtProfile = buildUtilityProfile({
    utilityName:           input.utilityName,
    stateCode:             input.stateCode,
    state:                 input.clientState,
    address:               input.address,    // v48.17: for ZIP-based lookup when utilityName is empty
    zip:                   input.zip,
    utilityRatePerKwh,
    // v48.8: clientUtilityRate passed separately — only used by buildUtilityProfile
    // when there is NO specific profile match (state fallback / unknown utility).
    // This prevents a stale client-entered rate from overriding an EIA-verified profile rate.
    clientUtilityRateFallback: validRate(input.clientUtilityRate) ? input.clientUtilityRate : undefined,
  });

  const utilityProfile   = builtProfile.profile;
  // ── Illinois Shines: replace the flat per-utility REC estimate with the
  //    accurate 2026-27 price (Group A/B × size tier) + the $20/REC customer-
  //    owned adder (residential federal ITC/§25D is repealed for 2026+, so a
  //    residential customer-owned project qualifies). Feeds BOTH the 25-yr
  //    projection and the incentive/SREC summary. Off-IL or an unrecognized IL
  //    utility (co-op/muni) keeps the profile's own estimate.
  let effectiveUtilityProfile = utilityProfile;
  if (utilityProfile.srec_available && utilityProfile.state === 'IL') {
    const _ilGroup = illinoisShinesGroupForUtility(utilityProfile.utility_name);
    if (_ilGroup) {
      const _rec = illinoisShinesRecPrice({
        group:           _ilGroup,
        sizeKwAc:        resolvedSystemSizeKw / 1.2,   // DC→AC estimate for the size tier
        customerOwned:   input.purchaseMode === 'cash' || input.purchaseMode === 'finance',
        takesFederalItc: !!input.isCommercial,         // residential §25D repealed → false → adder eligible
      });
      effectiveUtilityProfile = { ...utilityProfile, srec_price_estimate: _rec.total, srec_value_estimate: _rec.total };
    }
  }
  const resolvedRate     = builtProfile.resolved_rate;
  const escalationRate   = utilityProfile.escalation_rate || 0.03;

  // ── Fixed / non-energy charges (delivery, meter/connection fee, taxes) ──────
  // A utility bill is NOT just energy. When we have the homeowner's ACTUAL bill,
  // anything above the energy cost (usage × rate) is the fixed/delivery/meter
  // charge. Solar does NOT remove it — they stay grid-connected and keep paying
  // it — so it appears on BOTH the "before" and "after solar" side. This makes
  // the current bill match the real bill AND kills the "$0/mo, bill eliminated"
  // lie (there is always a utility bill). Energy-only rate is kept for display.
  const energyAnnualCost   = input.annualUsageKwh * resolvedRate;
  const fixedMonthlyCharge =
    input.actualAnnualBill && input.actualAnnualBill > energyAnnualCost && input.annualUsageKwh > 0
      ? Math.max(0, Math.round((input.actualAnnualBill - energyAnnualCost) / 12))
      : 0;
  const exportRate       = builtProfile.financial_rules.export_rate;
  const netMeteringType  = utilityProfile.net_metering_type;

  // Resolve escalation rate source + label for truth-tagged UI display
  // v48.8: hasRateOverride reflects strong overrides only (not weak clientUtilityRate)
  const hasRateOverride = !!(
    validRate(input.parsedBillRate) ||
    validRate(input.dbUtilityRate) ||
    validRate(input.utilityRateOverride)
  );
  const escalationSourceResult    = resolveEscalationSource(builtProfile, input.stateCode);
  const escalationRateSource      = escalationSourceResult.source;
  const escalationRateSourceLabel = escalationSourceResult.label;

  // Build 10-year back-calculated rate history (estimated — no real historical source in pipeline).
  // Back-calculate: rate_n_years_ago = currentRate / (1 + escalationRate)^n
  const currentYear = new Date().getFullYear();
  const rateHistory = Array.from({ length: 11 }, (_, i) => {
    const yearsBack = 10 - i;
    const year = currentYear - yearsBack;
    const rate = parseFloat((resolvedRate / Math.pow(1 + escalationRate, yearsBack)).toFixed(4));
    return { year, rate, estimated: true };
  });

  // v47.250: Wire new SPEC §1 fields from utilityProfile into canonical utility
  const utilityRetailRateType    = utilityProfile.retail_rate_type ?? 'flat';
  const utilityExportRateMonthly = utilityProfile.export_rate_monthly !== undefined
    ? utilityProfile.export_rate_monthly
    : exportRate;
  const utilityExportRateAnnualExcess = utilityProfile.export_rate_annual_excess !== undefined
    ? utilityProfile.export_rate_annual_excess
    : (builtProfile.financial_rules as any).export_rate_annual_excess ?? null;
  const utilityTrueUpPeriod  = utilityProfile.true_up_period ?? 'none';
  const utilityPolicyStatus  = utilityProfile.policy_status ?? 'stable';
  const utilityConfidence    = utilityProfile.confidence ?? utilityProfile.data_confidence ?? 'medium';

  const utility = {
    provider:                  input.utilityName || utilityProfile.utility_name || utilityProfile.utility_name_pattern || 'Your Electric Utility',
    rate:                      resolvedRate,
    annualUsageKwh:            input.annualUsageKwh,
    escalationRate,
    escalationRateSource,
    escalationRateSourceLabel,
    netMeteringType,
    exportRate,
    // v47.250 new fields (SPEC §1)
    retail_rate_type:           utilityRetailRateType,
    export_rate_monthly:        utilityExportRateMonthly,
    export_rate_annual_excess:  utilityExportRateAnnualExcess,
    true_up_period:             utilityTrueUpPeriod,
    policy_status:              utilityPolicyStatus,
    confidence:                 utilityConfidence,
    rateHistory,
  };

  // ─── STEP 4: FINANCIAL ──────────────────────────────────────────────────────
  // System cost: stored cash price if available, else live calculated from $/W.
  // effectiveFinal = baseCashPrice (no ITC deduction — IRC §25D compliance).

  const sysType  = input.systemType || 'roof';
  const livePpw  = (({
    roof:    input.roofPricePerWatt    ?? input.defaultPricePerWatt ?? DEFAULT_PPW.roof,
    ground:  input.groundPricePerWatt  ?? input.defaultPricePerWatt ?? DEFAULT_PPW.ground,
    fence:   input.fencePricePerWatt   ?? input.defaultPricePerWatt ?? DEFAULT_PPW.fence,
    carport: input.carportPricePerWatt ?? input.defaultPricePerWatt ?? DEFAULT_PPW.carport,
  } as Record<string, number>)[sysType]) ?? (input.defaultPricePerWatt ?? DEFAULT_PPW.roof);

  const systemSizeW          = resolvedSystemSizeKw * 1000;
  const liveCalculatedPrice  = systemSizeW > 0 ? Math.round(systemSizeW * livePpw) : 0;
  const baseCashPrice        = input.storedCashPrice > 0 ? input.storedCashPrice : liveCalculatedPrice;

  // Section 1: effectiveFinal = baseCashPrice. IRC §25D tax credit is NOT a proposal item.
  const effectiveFinal = baseCashPrice;

  assertTruth(effectiveFinal >= 0, `effectiveFinal is negative: ${effectiveFinal}`, warnings);

  // Financing
  const financeAprDecimal  = ((input.loanApr ?? 7.99) / 100);
  const financeTermYears   = input.loanTermYears ?? 25;
  const financeMonthlyRate = financeAprDecimal / 12;
  const financeTermMonths  = financeTermYears * 12;
  const financeMonthlyPayment = effectiveFinal > 0 && financeMonthlyRate > 0
    ? Math.round(
        effectiveFinal *
        (financeMonthlyRate * Math.pow(1 + financeMonthlyRate, financeTermMonths)) /
        (Math.pow(1 + financeMonthlyRate, financeTermMonths) - 1)
      )
    : 0;

  // Monthly usage
  const avgMonthlyUsageKwh      = input.annualUsageKwh > 0 ? input.annualUsageKwh / 12 : 0;
  const avgMonthlyProductionKwh = annualKwh > 0 ? annualKwh / 12 : 0;

  // Profile-driven remaining utility monthly cost (residual energy + the fixed
  // charge that survives solar — the customer always has SOME utility bill).
  const remaining_utility_monthly = Math.max(0, calculateRemainingUtility({
    monthlyUsageKwh:      avgMonthlyUsageKwh,
    monthlyProductionKwh: avgMonthlyProductionKwh,
    profile:              utilityProfile,
    retailRate:           resolvedRate,
  })) + fixedMonthlyCharge;

  const solar_payment_monthly   = financeMonthlyPayment;
  const total_energy_cost_monthly = solar_payment_monthly + remaining_utility_monthly;

  // Monthly bill chart (before/after with seasonal factors)
  const monthlyBillChart = MONTHS.map((month, i) => {
    const monthlyUsage    = avgMonthlyUsageKwh > 0
      ? avgMonthlyUsageKwh * SEASONAL_FACTORS[i]
      : ((input.annualUsageKwh > 0 ? input.annualUsageKwh : 12000) / 12) * SEASONAL_FACTORS[i];
    const monthlyProduced = monthlyKwh[i] ?? 0;
    // Both before and after carry the fixed charge — solar offsets energy only.
    const before = Math.round(monthlyUsage * resolvedRate) + fixedMonthlyCharge;
    // v47.253: NEM-aware monthly bill — uses calculateRemainingUtility, not (usage-production)*rate
    const after  = Math.max(0, calculateRemainingUtility({
      monthlyUsageKwh:      monthlyUsage,
      monthlyProductionKwh: monthlyProduced,
      profile:              utilityProfile,
      retailRate:           resolvedRate,
    })) + fixedMonthlyCharge;
    return { month, before, after, savings: before - after };
  });

  const avgMonthlyBillBefore = Math.round(
    monthlyBillChart.reduce((s, m) => s + m.before, 0) / 12
  );
  const ownershipDeltaMonthly = total_energy_cost_monthly - avgMonthlyBillBefore;

  // Year 1 bill WITHOUT solar — energy (usage × rate) + fixed/delivery charges
  const year1BillWithoutSolar = Math.round(input.annualUsageKwh * resolvedRate) + fixedMonthlyCharge * 12;
  // annualEnergyValue and year1BillWithSolar derived AFTER proj25 (see STEP 5 below)

  // ── ITC — v47.251 Global Incentives Truth Rule ──────────────────────────────
  // ITC is gated by GLOBAL_INCENTIVES_CONFIG.allow_itc (default: false).
  // When disabled: itcRate=0, itcAmount=0, netCost=grossCost.
  // When enabled: computed from program data — no hardcoded 30%.
  // The per-project noItc flag is a secondary suppressor (still respected when ITC is globally on).
  const itcGloballyEnabled = isItcEnabled();
  const itcSuppressedByProject = !!(input.noItc);

  // ITC rate: 0 unless globally enabled AND not suppressed by project
  // When globally enabled: residential §25D rate (currently 0 per P.L. 119-21 repeal for 2026+);
  // commercial §48E: 30%. Do not hardcode for residential — engine returns 0.
  const itcRate = (!itcGloballyEnabled || itcSuppressedByProject)
    ? 0
    : (input.isCommercial ? 30 : 0);  // residential §25D = 0 (P.L. 119-21); commercial §48E = 30%

  // SPEC §5 FAILSAFE: guardItcValue ensures no leak when config is off
  const rawItcAmount = Math.round(effectiveFinal * itcRate / 100);
  const itcAmount    = guardItcValue(rawItcAmount, 'buildCanonicalProposal');

  // net_system_cost: gross when incentives disabled (SPEC §2)
  const netCost = itcGloballyEnabled ? effectiveFinal - itcAmount : effectiveFinal;

  // paybackBasis, paybackYears, financial object — defined after proj25/annualEnergyValue (see below)

  // ── Canonical Incentives Block (SPEC §2) ─────────────────────────────────
  // When incentives_enabled=false: ALL values zeroed, state_incentives=[].
  // State incentives also gated by areStateIncentivesEnabled().
  const incentivesBlock: CanonicalIncentives = {
    itc_percent:        itcRate,
    itc_value:          itcAmount,
    state_incentives:   [],   // populated below only when state incentives are globally on
    total_incentives:   itcAmount,
    incentives_enabled: itcGloballyEnabled,
  };

  // ─── STEP 5: TRUTH25YR ──────────────────────────────────────────────────────
  // Single savings definition. calculate25yrProjection is the authority.
  //
  // CASH BASIS (always): netDifference = utilityCostWithoutSolar - (cashPrice + remainingUtilityCost)
  // This is the canonical "25-yr net savings" shown in the proposal — independent of purchase mode.
  // Rationale: the loan is a financing vehicle, not the system cost. Showing financed total as "cost"
  // penalizes financing buyers with a misleading negative savings figure. Cash basis is industry
  // standard for proposal savings displays.
  //
  // FINANCE BASIS (separate): netDifferenceFinanced — for internal financing comparison only.
  //
  // v47.250: Pass solarAnnualPayment, loanYears, panelDegradation to calculate25yrProjection.
  // The iterative model uses these to compute per-year utility_cost_with_solar correctly.

  const financeTotal         = financeMonthlyPayment * financeTermMonths;
  const solarAnnualPayment   = financeMonthlyPayment * 12;
  const loanYears            = financeTermYears;

  // Cash-basis projection (canonical savings display — always uses cash price, not loan total)
  // Fixed/delivery charges are injected onto BOTH sides so the displayed totals
  // are honest while net savings stay correct (the fixed charge cancels).
  const proj25 = applyFixedCharges(calculate25yrProjection({
    annualProductionKwh:  annualKwh,
    annualUsageKwh:       input.annualUsageKwh,
    retailRate:           resolvedRate,
    profile:              effectiveUtilityProfile,
    systemCost:           effectiveFinal,
    financeTotal:         undefined,   // cash basis: netDifference independent of purchase mode
    solarAnnualPayment,
    loanYears,
    panelDegradation:     PANEL_DEGRADATION,
  }), fixedMonthlyCharge * 12, escalationRate);

  // Finance-basis projection (for financing cost comparison only)
  const proj25Finance = input.purchaseMode === 'finance' ? applyFixedCharges(calculate25yrProjection({
    annualProductionKwh:  annualKwh,
    annualUsageKwh:       input.annualUsageKwh,
    retailRate:           resolvedRate,
    profile:              effectiveUtilityProfile,
    systemCost:           effectiveFinal,
    financeTotal,
    solarAnnualPayment,
    loanYears,
    panelDegradation:     PANEL_DEGRADATION,
  }), fixedMonthlyCharge * 12, escalationRate) : proj25;

  // CANONICAL SAVINGS DEFINITION — cash basis, enforced here, used everywhere.
  // INCLUDES SREC contract income (real contracted revenue, scheduled per-year
  // in yearlyFlow): before this, the payoff year included SREC while the
  // headline savings + both cumulative charts excluded it — the same proposal
  // showed contradictory bottom lines (SREC audit 2026-07-16).
  const netDifference = proj25.utility_cost_without_solar_25yr
    - (proj25.solar_cost_total + proj25.remaining_utility_cost_total)
    + (proj25.srec_income_25yr ?? 0);

  // Finance-basis difference (may be negative for high-APR/long-term loans)
  const netDifferenceFinanced = proj25Finance.utility_cost_without_solar_25yr
    - (proj25Finance.solar_cost_total + proj25Finance.remaining_utility_cost_total)
    + (proj25Finance.srec_income_25yr ?? 0);

  // v47.253: annualEnergyValue — Year 1 total energy value from the iterative flow engine
  // SPEC v47.253 RULE: derive from yearlyFlow[0].total_energy_value, NOT annualKwh * resolvedRate
  // yearlyFlow[0] = Year 1 of the 25-year iterative model (NEM-type-aware, self-consumption + export)
  const annualEnergyValue = proj25.yearlyFlow.length > 0
    ? proj25.yearlyFlow[0].total_energy_value
    : 0;

  // v47.253: year1BillWithSolar — from iterative model (NEM-aware remaining utility)
  const year1BillWithSolar = proj25.yearlyFlow.length > 0
    ? proj25.yearlyFlow[0].utility_cost_with_solar
    : Math.round(Math.max(0, input.annualUsageKwh - annualKwh) * resolvedRate); // fallback only

  // Payback from the REAL year-by-year flow (energy value + SREC as actually
  // scheduled) — the single walk that also drives payoffYear below, so the
  // cash-flow card, the hero "Payoff Year", and the chart tell ONE story.
  // Falls back to the naive ratio only when the flow is unavailable.
  const paybackBasis = netCost;  // = effectiveFinal when ITC disabled (SPEC §3)
  const _payoffWalk = computePayoffFromFlow(proj25.yearlyFlow, paybackBasis);
  const paybackYears = _payoffWalk
    ? _payoffWalk.fractional
    : (paybackBasis > 0 && annualEnergyValue > 0
        ? parseFloat((paybackBasis / annualEnergyValue).toFixed(1))
        : 0);

  // v47.254: energyValueBreakdown — identity map from yearlyFlow[0], NO recomputation
  // selfConsumed = yearlyFlow[0].self_consumed_value
  // exported     = yearlyFlow[0].monthly_export_value + yearlyFlow[0].annual_excess_value
  // total        = yearlyFlow[0].total_energy_value (same as annualEnergyValue)
  const y0 = proj25.yearlyFlow.length > 0 ? proj25.yearlyFlow[0] : null;
  const energyValueBreakdown = {
    selfConsumed: y0 ? y0.self_consumed_value : 0,
    exported:     y0 ? (y0.monthly_export_value + y0.annual_excess_value) : 0,
    total:        y0 ? y0.total_energy_value : 0,
  };

  const financial = {
    gross_system_cost:    effectiveFinal,   // always gross, pre-incentives (SPEC §2)
    systemCost:           effectiveFinal,
    pricePerWatt:         livePpw,
    solarPaymentMonthly:  solar_payment_monthly,
    utilityBillMonthly:   remaining_utility_monthly,
    totalMonthlyCost:     total_energy_cost_monthly,
    currentMonthlyBill:   avgMonthlyBillBefore,
    ownershipDeltaMonthly,
    financeApr:           financeAprDecimal,
    financeTermYears,
    financeTermMonths,
    annualEnergyValue,
    year1BillWithoutSolar,
    year1BillWithSolar,
    itcRate,
    itcAmount,
    netCost,
    paybackYears,
    energyValueBreakdown,
  };

  // Assertion: netDifference must be consistent
  assertTruth(
    Math.abs(netDifference - (proj25.utility_cost_without_solar_25yr - proj25.solar_cost_total - proj25.remaining_utility_cost_total)) < 1,
    `netDifference calculation inconsistency detected`,
    warnings
  );

  // v47.250 SPEC §5: projectionChart derived from yearlyFlow — no inline recomputation.
  // Each year's savings = total_energy_value from the iterative model.
  // cumulative = cumulative_without_solar - cumulative_with_solar (net advantage at that year).
  const yearlyFlow: CanonicalEnergyFlowYear[] = proj25.yearlyFlow.map(mapEnergyFlowYear);

  const projectionChart = yearlyFlow.map((yr, i) => ({
    year:       `Yr ${i + 1}`,
    savings:    Math.round(yr.total_energy_value),
    cumulative: Math.round(yr.cumulative_without_solar - yr.cumulative_with_solar),
  }));

  const truth25yr = {
    utilityCostWithoutSolar: proj25.utility_cost_without_solar_25yr,
    solarCostTotal:          proj25.solar_cost_total,
    remainingUtilityCost:    proj25.remaining_utility_cost_total,
    netDifference,
    netDifferenceFinanced,
    estimatedEnergyValue:    proj25.estimated_energy_value_25yr,
    netFinancialDifference:  proj25.net_financial_difference_25yr,
    srec_income_25yr:        proj25.srec_income_25yr,
    monthlyBillChart,
    projectionChart,
    yearlyFlow,
  };

  // ─── STEP 6: OFFSET ─────────────────────────────────────────────────────────

  // UNCAPPED (proposal audit 2026-07-16): Math.min(...,100) displayed a 185%-of-
  // usage system as "~100% offset" — hiding oversizing the customer should see
  // (and a NEM-eligibility question the installer must answer). Display truth.
  const offsetPct = input.annualUsageKwh > 0
    ? Math.round((annualKwh / input.annualUsageKwh) * 100)
    : 0;

  const offset = {
    percentage:          offsetPct,
    remainingPercentage: 100 - offsetPct,
    isPartialOffset:     offsetPct < 100,
  };

  // ─── STEP 7: POLICY ─────────────────────────────────────────────────────────
  // SREC, incentives, policy message, NEM summary, failsafe.
  // incentivesAllowed = false when policy is 'at_risk' (removes incentive messaging).

  const policyEffect     = utilityProfile.policy_effect;
  const incentivesAllowed = policyEffect !== 'at_risk';
  const policyMessage    = getPolicyMessage(utilityProfile);
  const netMeteringSummary = getNetMeteringSummary(utilityProfile);
  // SREC summary quotes the REAL scheduled payout (total + 50% upfront) from
  // the projection — replaces the old flat "$X/year, typical 8 MWh system" prose.
  const srecSummary      = getSrecSummary(effectiveUtilityProfile, annualKwh,
    (proj25.srec_income_25yr ?? 0) > 0 && proj25.yearlyFlow.length > 0
      ? { totalValue: proj25.srec_income_25yr, upfrontValue: proj25.yearlyFlow[0].srec_income ?? 0 }
      : null);
  const failsafeMessage  = getFailsafeMessage(builtProfile);

  const policy = {
    srecAvailable:          effectiveUtilityProfile.srec_available,
    srecProgramName:        effectiveUtilityProfile.srec_program_name,
    srecPricePerMwh:        effectiveUtilityProfile.srec_price_estimate,
    incentivesAllowed,
    policyMessage,
    netMeteringSummary,
    srecSummary,
    failsafeMessage,
    isSpecificUtilityMatch: builtProfile.is_specific_match,
    // v48.27: Per-utility program intelligence (TOU, battery incentives, rebates, special NEM)
    utilityPrograms:        builtProfile.utility_programs ?? null,
    utilityProgramsNote:    builtProfile.utility_programs_note ?? null,
  };

  // ─── STEP 8: RETURN ─────────────────────────────────────────────────────────

  const hasWarnings = warnings.length > 0;

  // Compute overall truth confidence for this proposal
  const truthConfidenceResult = computeTruthConfidence(builtProfile, hasRateOverride, input.stateCode);
  const truthConfidence = truthConfidenceResult.level;

  // ─── STEP 8b: PAYOFF YEAR ───────────────────────────────────────────────────
  // Canonical payoff year: first year cumulative (energy value + SREC income AS
  // ACTUALLY SCHEDULED per yearlyFlow) covers the system cost. The old v48.6
  // approach fed yearlyFlow[0].srec_income into computePayoffYear as a RECURRING
  // annual amount — under the 2026-27 Illinois Shines schedule that Year-1 value
  // is the 50% UPFRONT chunk, so payback came out absurdly short (~25× SREC
  // overstatement). Same walk as paybackYears above — one break-even story.
  const payoffYear = _payoffWalk
    ? _payoffWalk.year
    : computePayoffYear(annualEnergyValue, escalationRate, effectiveFinal, PANEL_DEGRADATION);

  // ─── STEP 8c: FINANCIAL NARRATIVE ───────────────────────────────────────────
  const narrative = buildFinancialNarrative({
    currentMonthlyBill:        avgMonthlyBillBefore,
    solarPaymentMonthly:       solar_payment_monthly,
    utilityBillMonthly:        remaining_utility_monthly,
    escalationRate,
    escalationRateSourceLabel,
    payoffYear,
    netSavings25yr:            Math.max(0, netDifference),
    purchaseMode:              input.purchaseMode,
    annualEnergyValue,
    isPartialOffset:           offset.isPartialOffset,
    offsetPct:                 offset.percentage,
  });

  const proposal: CanonicalProposal = {
    panel,
    production,
    utility,
    financial,
    truth25yr,
    offset,
    policy,
    incentives: incentivesBlock,
    _meta: {
      builtAt,
      version:     PIPELINE_VERSION,
      purchaseMode: input.purchaseMode,
      hasWarnings,
      warnings:    [...warnings],
      truthConfidence,
      payoffYear,
      narrative,
    },
  };

  return proposal;
}