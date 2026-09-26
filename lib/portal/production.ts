/**
 * lib/portal/production.ts
 *
 * Production estimation helpers for the homeowner portal dashboard. The
 * portal can't pull live production data without a monitoring API
 * integration (see the existing `MonitoringFoundation` component, which
 * surfaces a link to the homeowner's monitoring provider). Until that's
 * built, these helpers give the homeowner a credible estimate based on
 * their system size and US-average solar irradiance.
 *
 * These are ESTIMATES, not actuals. They use:
 *   - US-average specific yield: 1370 kWh per installed kW per year
 *     (NREL PVWatts default, range 1100-1600 across the US)
 *   - US grid-average CO2 emissions: 0.4 kg CO2 per kWh
 *     (EPA eGRID 2022 average, range 0.05-0.9 by region)
 *
 * Real production varies with tilt, azimuth, shading, soiling, and
 * weather. The disclaimer in the UI makes that explicit. Once a live
 * monitoring API is wired up, this card stays as a fallback (e.g., for
 * customers who don't have a monitoring account yet) and the live
 * numbers win.
 */

/**
 * 🚨 THE PORTAL ANSWERED "HOW MUCH WILL MY SYSTEM MAKE?" TWICE, DIFFERENTLY, ON
 *    THE SAME SCREEN.
 *
 * `app/portal/dashboard/page.tsx` carried a local `calcBenefits()` using 1400
 * kWh/kW/yr and 0.386 kg CO2/kWh, while the SystemPerformance card a few
 * hundred pixels below used this module's 1370 and 0.4. A completed-stage
 * homeowner therefore scrolled past two cards disagreeing by ~300 kWh/yr and
 * 0.1 tons of CO2, with nothing on the page indicating which was right — and
 * the "Est. Annual Savings" dollar figure was derived from the one that was NOT
 * the module.
 *
 * So every number the portal asserts about production, carbon and savings is
 * defined here, and `calcBenefits` is gone. One system, one answer.
 */

/** US-average specific yield in kWh per installed kW per year. */
export const US_AVG_KWH_PER_KW_YEAR = 1370;

/** US grid-average CO2 emissions in kg per kWh generated. */
export const US_GRID_CO2_KG_PER_KWH = 0.4;

/**
 * Blended US residential retail electricity rate, USD per kWh, used for the
 * "estimated annual savings" figure.
 *
 * 🚨 THIS IS A DISPLAY ESTIMATE, NEVER A QUOTE. It carries over unchanged from
 * the `calcBenefits` it replaced (0.135), deliberately: consolidating three
 * numbers into one place must not silently move the dollar figure a homeowner
 * may already have screenshotted. Revising the rate is a separate, deliberate
 * decision — and when it is made, it is made here, once.
 *
 * The real savings number for a given customer is the one in their PROPOSAL,
 * which is built from their own utility rate and usage. This is the pre-proposal
 * placeholder the portal shows, under an explicit disclaimer.
 */
export const US_AVG_RETAIL_RATE_USD_PER_KWH = 0.135;

/**
 * Trees-equivalent per metric ton of CO2 per year.
 *
 * Also carried over from `calcBenefits` (16.5). It is an illustration, not a
 * measurement, and it is derived FROM the CO2 figure above so the two can never
 * disagree.
 */
export const TREES_PER_CO2_TON_YEAR = 16.5;

/** Round to nearest integer (kWh). */
export function estimateAnnualKwh(systemSizeKw: number): number {
  if (!Number.isFinite(systemSizeKw) || systemSizeKw <= 0) return 0;
  return Math.round(systemSizeKw * US_AVG_KWH_PER_KW_YEAR);
}

/** Spread evenly across 12 months (kWh). */
export function estimateMonthlyKwh(annualKwh: number): number {
  if (!Number.isFinite(annualKwh) || annualKwh <= 0) return 0;
  return Math.round(annualKwh / 12);
}

/** CO2 offset in metric tons, 1 decimal place. */
export function estimateCo2Tons(annualKwh: number): number {
  if (!Number.isFinite(annualKwh) || annualKwh <= 0) return 0;
  const kg = annualKwh * US_GRID_CO2_KG_PER_KWH;
  return Math.round(kg / 100) / 10;
}

/** Estimated annual bill savings in whole USD. Display estimate — not a quote. */
export function estimateAnnualSavingsUsd(annualKwh: number): number {
  if (!Number.isFinite(annualKwh) || annualKwh <= 0) return 0;
  return Math.round(annualKwh * US_AVG_RETAIL_RATE_USD_PER_KWH);
}

/** Trees-equivalent illustration, derived from the CO2 tons above. */
export function estimateTreesEquivalent(co2Tons: number): number {
  if (!Number.isFinite(co2Tons) || co2Tons <= 0) return 0;
  return Math.round(co2Tons * TREES_PER_CO2_TON_YEAR);
}

/**
 * Every projected figure the portal shows for one system, from ONE input.
 *
 * The chain is single-valued on purpose: savings and trees are derived from the
 * same `annualKwh` and `co2Tons` the production card displays, so no two cards
 * can be built from different intermediates.
 *
 * Returns null when there is no system size to project from — the caller renders
 * nothing rather than zeros, because "0 kWh/yr" is a claim and "we don't know
 * yet" is the truth.
 */
export function projectedBenefits(systemSizeKw: number | null | undefined): {
  annualKwh: number;
  annualSavings: number;
  co2Tons: number;
  treesEq: number;
} | null {
  if (systemSizeKw == null || !Number.isFinite(systemSizeKw) || systemSizeKw <= 0) return null;
  const annualKwh = estimateAnnualKwh(systemSizeKw);
  const co2Tons   = estimateCo2Tons(annualKwh);
  return {
    annualKwh,
    annualSavings: estimateAnnualSavingsUsd(annualKwh),
    co2Tons,
    treesEq:       estimateTreesEquivalent(co2Tons),
  };
}
