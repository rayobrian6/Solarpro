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

/** US-average specific yield in kWh per installed kW per year. */
export const US_AVG_KWH_PER_KW_YEAR = 1370;

/** US grid-average CO2 emissions in kg per kWh generated. */
export const US_GRID_CO2_KG_PER_KWH = 0.4;

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
