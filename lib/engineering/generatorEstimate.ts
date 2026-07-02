import { APPLIANCES, GENERATORS, type Generator } from "./generatorData";

export type SelectedAppliance = {
  id: string;
  quantity: number;
};

export type LoadBreakdown = {
  category: string;
  runningWatts: number;
  startingWatts: number;
  count: number;
};

/**
 * Load profile determines the demand factor applied to the appliance
 * running load. Recognizes that not all selected loads run simultaneously.
 *
 * - whole-house: no load management, 100% (every selected load on at once)
 * - managed: Generac SMM or smart panel cycles heavy loads, ~70%
 * - essentials: only critical circuits, no big loads simultaneously, ~50%
 *
 * The demand factor is applied ONLY to the appliance running load. The
 * bill baseline is already the empirical peak demand, so it stays a
 * floor regardless of profile.
 */
export type LoadProfile = "whole-house" | "managed" | "essentials";

export const LOAD_PROFILE_FACTORS: Record<LoadProfile, number> = {
  "whole-house": 1.0,
  managed: 0.7,
  essentials: 0.5,
};

export const LOAD_PROFILE_LABELS: Record<LoadProfile, string> = {
  "whole-house": "Whole-house (no load management)",
  managed: "With Smart Management Module (SMM)",
  essentials: "Essential circuits only",
};

export type EstimateInput = {
  selected: SelectedAppliance[];
  /**
   * Optional peak demand in kW from a parsed electric bill. When provided,
   * it is added to the running load as a baseline — the user can still
   * add appliances on top via the picker.
   */
  billPeakKw?: number | null;
  /**
   * Load profile. Defaults to "whole-house" (no demand factor applied).
   * Reduces the appliance running load by the profile's demand factor to
   * account for non-simultaneous operation.
   */
  loadProfile?: LoadProfile;
};

export type EstimateResult = {
  totalRunningWatts: number;
  totalRunningAmps: number;
  largestMotorStartingWatts: number;
  totalPeakWatts: number;
  recommendedKw: number;
  recommendedSizeLabel: string;
  /**
   * The raw recommendation before the catalog ceiling is applied. When
   * `exceedsCatalog` is true, this is the size the load actually needs
   * (commercial-grade or liquid-cooled). When `false`, equals
   * `recommendedKw`.
   */
  rawRecommendedKw: number;
  /**
   * Largest kW unit in the residential catalog. The displayed
   * `recommendedKw` is capped at this when `exceedsCatalog` is true.
   */
  catalogCeilingKw: number;
  breakdown: LoadBreakdown[];
  /** Baseline from a parsed bill, in kW. 0 if none. */
  billPeakKw: number;
  /** Demand factor (0.5–1.0) applied to the appliance running load. */
  demandFactor: number;
  /** Load profile used for this estimate. */
  loadProfile: LoadProfile;
  /**
   * True when the recommended kW exceeds the largest generator in the
   * catalog — the user must add load management or a bigger unit. The
   * `bestValue` pick in this case is the largest catalog unit, not a
   * cheapest-match.
   */
  exceedsCatalog: boolean;
  picks: {
    bestValue: Generator;
    highestSurge: Generator;
    alternative: Generator;
  };
  installedCostLow: number;
  installedCostHigh: number;
};

// Generac's 80% rule: a standby generator should never run at more than 80%
// of its continuous rating. That means generator_size ≥ load / 0.80, which
// is mathematically the same as load × 1.25. Both the bill method and the
// appliance method use this same 1.25 safety margin per Generac's official
// sizing guide (and NEC 700/701/702 for emergency/optional standby systems).
const APPLIANCE_SAFETY_MARGIN = 1.25;
const BILL_SAFETY_MARGIN = 1.25;

const VOLTAGE = 240;

export function calculateEstimate(input: EstimateInput): EstimateResult {
  const breakdownMap = new Map<string, LoadBreakdown>();
  let applianceRunning = 0;
  let largestMotorRunning = 0;
  let largestMotorStarting = 0;
  const billPeakKw = input.billPeakKw && input.billPeakKw > 0 ? input.billPeakKw : 0;
  const billRunningWatts = billPeakKw * 1000;

  for (const sel of input.selected) {
    const app = APPLIANCES.find((a) => a.id === sel.id);
    if (!app) continue;
    const qty = Math.max(1, Math.floor(sel.quantity || 1));
    const running = app.runningWatts * qty;
    const starting = app.startingWatts * qty;
    applianceRunning += running;
    if (app.startingWatts > largestMotorStarting) {
      largestMotorStarting = app.startingWatts;
      largestMotorRunning = app.runningWatts;
    }
    const existing = breakdownMap.get(app.category);
    if (existing) {
      existing.runningWatts += running;
      existing.startingWatts += starting;
      existing.count += qty;
    } else {
      breakdownMap.set(app.category, {
        category: app.category,
        runningWatts: running,
        startingWatts: starting,
        count: qty,
      });
    }
  }

  // Running total: when a bill baseline exists, the meter is the empirical
  // ceiling — nameplate appliance sums above it are theoretical, not observed.
  // We use the LARGER of the two so a new appliance the bill didn't capture
  // (e.g., a new EV charger) still pushes the recommendation up. The bill
  // peak is itself already a 15-min average, so the motor-start addition is
  // ONLY made on top of the appliance path (not the bill path).
  const loadProfile: LoadProfile = input.loadProfile ?? "whole-house";
  const demandFactor = LOAD_PROFILE_FACTORS[loadProfile];
  const adjustedApplianceRunning = applianceRunning * demandFactor;

  let totalRunning: number;
  let appliedMotorStart: number;
  if (billRunningWatts > 0 && billRunningWatts >= adjustedApplianceRunning) {
    // Bill is the higher number — it's the empirical peak and already
    // captures any motor starts within its 15-min window.
    totalRunning = billRunningWatts;
    appliedMotorStart = 0;
  } else {
    // Appliance sum wins. Apply the largest motor's full starting watts
    // per the industry appliance method (NEC 220.50 / Generac sizing).
    totalRunning = adjustedApplianceRunning;
    appliedMotorStart = largestMotorStarting;
  }

  const totalPeak = (totalRunning + appliedMotorStart) * APPLIANCE_SAFETY_MARGIN;
  const rawRecommendedKw = Math.ceil(totalPeak / 1000);

  // Catalog ceiling: residential standby tops out at the largest catalog
  // unit (currently 26 kW). Anything above that needs liquid-cooled
  // commercial OR aggressive load management.
  const CATALOG_CEILING_KW = Math.max(...GENERATORS.map((g) => g.kw));

  const { bestValue, highestSurge, alternative, exceedsCatalog } = pickGenerators(rawRecommendedKw);

  // When the raw recommendation exceeds the catalog, cap the displayed
  // recommendation at the ceiling and surface the raw number so the UI
  // can warn about needing commercial-grade or load management.
  const recommendedKw = exceedsCatalog ? CATALOG_CEILING_KW : rawRecommendedKw;

  // Installed cost = MSRP × 1.5–1.8 + $1.5k–$3.5k for transfer switch, gas line,
  // electrical, permits, and labor. Based on industry typicals for residential
  // standby installs (see Generac / Briggs dealer install factors).
  const installedCostLow = Math.round((bestValue.msrp * 1.5 + 1500) / 100) * 100;
  const installedCostHigh = Math.round((bestValue.msrp * 1.8 + 3500) / 100) * 100;

  const totalRunningAmps = Math.round(totalRunning / VOLTAGE);

  return {
    totalRunningWatts: totalRunning,
    totalRunningAmps,
    largestMotorStartingWatts: largestMotorStarting,
    totalPeakWatts: Math.round(totalPeak),
    recommendedKw,
    recommendedSizeLabel: exceedsCatalog
      ? `${recommendedKw} kW (ceiling — needs commercial or load management for full coverage)`
      : `${recommendedKw} kW`,
    rawRecommendedKw,
    catalogCeilingKw: CATALOG_CEILING_KW,
    breakdown: Array.from(breakdownMap.values()).sort((a, b) => b.runningWatts - a.runningWatts),
    billPeakKw,
    demandFactor,
    loadProfile,
    exceedsCatalog,
    picks: { bestValue, highestSurge, alternative },
    installedCostLow,
    installedCostHigh,
  };
}

/**
 * Pick the best-value, highest-surge, and alternative generators for a
 * given recommended kW. When the recommended exceeds the largest catalog
 * unit, falls back to the largest unit (the only honest answer) and
 * flags `exceedsCatalog` so the UI can show a note.
 */
function pickGenerators(recommendedKw: number): {
  bestValue: Generator;
  highestSurge: Generator;
  alternative: Generator;
  exceedsCatalog: boolean;
} {
  const matched = GENERATORS.filter((g) => g.kw >= recommendedKw);
  const exceedsCatalog = matched.length === 0;
  // matched: cheapest MSRP among units that meet the recommended kW.
  // fallback: largest kW unit (the only viable pick when nothing meets it).
  const tier = exceedsCatalog
    ? [...GENERATORS].sort((a, b) => b.kw - a.kw)
    : matched.sort((a, b) => a.kw - b.kw);
  const bestValue = exceedsCatalog
    ? tier[0]
    : [...tier].sort((a, b) => a.msrp - b.msrp)[0];
  const highestSurge = [...tier].sort(
    (a, b) => (b.motorStartingAmps ?? 0) - (a.motorStartingAmps ?? 0)
  )[0];
  const alternative = tier.find((g) => g !== bestValue) ?? bestValue;
  return { bestValue, highestSurge, alternative, exceedsCatalog };
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatWatts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(w % 1000 === 0 ? 0 : 1)} kW`;
  return `${w} W`;
}

export type BillInput = {
  /** Peak demand in kW as measured by the utility. */
  peakKw: number;
  /** Optional monthly usage in kWh, for the cost estimate. */
  kWh?: number | null;
};

/**
 * Size a standby generator from a real utility bill.
 *
 * Bill-recorded peak demand is the max 15-min (or 30-min) average draw at the
 * meter — it already includes every appliance running simultaneously during
 * the worst observed period. A standby generator sized to that number handles
 * everything below it. We apply a 1.25 safety margin (industry standard for
 * residential standby) to cover future load growth and engine derating over
 * the unit's service life.
 */
export function calculateEstimateFromBill(input: BillInput): EstimateResult {
  if (input.peakKw <= 0) {
    throw new Error("peakKw must be positive");
  }

  const peakWatts = input.peakKw * 1000;
  const sizedWatts = peakWatts * BILL_SAFETY_MARGIN;
  const rawRecommendedKw = Math.ceil(sizedWatts / 1000);

  const CATALOG_CEILING_KW = Math.max(...GENERATORS.map((g) => g.kw));
  const { bestValue, highestSurge, alternative, exceedsCatalog } = pickGenerators(rawRecommendedKw);
  const recommendedKw = exceedsCatalog ? CATALOG_CEILING_KW : rawRecommendedKw;

  // Installed cost: MSRP × 1.5–1.8 + $1.5k–$3.5k for transfer switch, gas line,
  // electrical, permits, labor. Industry typicals for residential standby.
  const installedCostLow = Math.round((bestValue.msrp * 1.5 + 1500) / 100) * 100;
  const installedCostHigh = Math.round((bestValue.msrp * 1.8 + 3500) / 100) * 100;

  return {
    totalRunningWatts: peakWatts,
    totalRunningAmps: Math.round(peakWatts / VOLTAGE),
    largestMotorStartingWatts: 0, // bill-level; no appliance breakdown
    totalPeakWatts: Math.round(sizedWatts),
    recommendedKw,
    recommendedSizeLabel: exceedsCatalog
      ? `${recommendedKw} kW (ceiling — needs commercial for full coverage)`
      : `${recommendedKw} kW`,
    rawRecommendedKw,
    catalogCeilingKw: CATALOG_CEILING_KW,
    breakdown: [],
    billPeakKw: input.peakKw,
    // The bill is empirical — demand factor doesn't apply. We report
    // "whole-house" as the implicit profile so the UI has a consistent field.
    demandFactor: 1.0,
    loadProfile: "whole-house",
    exceedsCatalog,
    picks: { bestValue, highestSurge, alternative },
    installedCostLow,
    installedCostHigh,
  };
}