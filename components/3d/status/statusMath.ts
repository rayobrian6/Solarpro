/**
 * statusMath.ts — pure math for the bottom-right Design-phase status panel.
 *
 * Aurora frame 0147 parity (HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6):
 *
 *   Modules:               0
 *   System Size (STC):   0 kW
 *   Impact Price:        $ —
 *
 * - Modules:        live count of placed solar panels (integer)
 * - System Size:    modules × moduleWattage / 1000 in kW, 1 decimal place
 * - Impact Price:   modules × moduleWattage × costPerWatt, whole dollars
 *                   (null when zero, so the panel shows Aurora's "$ —")
 *
 * This file is pure JS — no React, no Cesium, no DOM. It is the
 * authoritative source for the math; tests in tests/statusPanel.test.ts
 * cover every branch.
 */

/**
 * Solarpro default STC wattage per module. Matches DesignStudio's
 * canonical sizing math (DesignStudio.tsx: panelCount400w + / 400)
 * and the equipment-db's Maxeon 6 / Maxeon 3 400W baseline.
 */
export const DEFAULT_MODULE_WATTAGE = 400;

/**
 * Sentinel for "no Design yet" — mirrors Aurora's "$ —" placeholder
 * (frame 0147). The costPerWatt parameter of the math functions
 * uses this when the user has not yet created a Design; the formatter
 * renders it as "$ —". An explicit `0` is a real $/W (rare but
 * legal); `null` is the placeholder.
 */
export const COST_NOT_SET: null = null;

/**
 * Input shape for the status panel math. The parent (SolarEngine3D via
 * the design-panel integration) supplies `modules`; the constants
 * above supply the defaults for the rest.
 */
export interface DesignTotals {
  /** Live count of placed solar panels. */
  modules: number;
  /** STC watts per module. Defaults to DEFAULT_MODULE_WATTAGE. */
  moduleWattage?: number;
  /** Dollars per watt, or `null` if the user has not yet created a
   *  Design (renders the Aurora "$ —" placeholder). Defaults to
   *  `null`. An explicit `0` is a real $/W (literal $0). */
  costPerWatt?: number | null;
}

/**
 * System size in kW STC, rounded to 1 decimal place.
 *
 * 0 modules → 0 kW.
 * 1 × 400W module → 0.4 kW.
 * 25 × 400W modules → 10 kW.
 *
 * The rounding is performed on tenths-of-a-kW so 1-decimal-place
 * output is exact (avoids 0.4 + 0.4 = 0.7999... drift).
 */
export function computeSystemSizeKw(
  modules: number,
  moduleWattage: number = DEFAULT_MODULE_WATTAGE
): number {
  if (!Number.isFinite(modules) || modules <= 0) return 0;
  if (!Number.isFinite(moduleWattage) || moduleWattage <= 0) return 0;
  // Round to 1dp via tenths: (W/100) gives tenths-of-a-kW, round to
  // integer, then / 10 back to kW.
  return Math.round((modules * moduleWattage) / 100) / 10;
}

/**
 * Impact price in whole dollars. Returns `null` for any of:
 *   - no modules placed (zero modules = no price yet)
 *   - costPerWatt is null (Aurora "$ —": no Design created yet)
 *   - costPerWatt is non-finite or negative (defensive)
 *
 * An explicit `costPerWatt: 0` returns a literal `0` (e.g. a $0/W
 * design — legal, even if unusual).
 *
 * Examples:
 *   0 modules, any cost           → null
 *   10 × 400W, no cost (null)     → null   (Aurora dash)
 *   10 × 400W × $4/W             → 16,000
 *   10 × 400W × $0/W             → 0       (literal $0, not null)
 *   25 × 400W × $3.50/W          → 35,000
 */
export function computeImpactPrice(
  modules: number,
  moduleWattage: number = DEFAULT_MODULE_WATTAGE,
  costPerWatt: number | null = COST_NOT_SET
): number | null {
  if (!Number.isFinite(modules) || modules <= 0) return null;
  if (!Number.isFinite(moduleWattage) || moduleWattage <= 0) return null;
  if (costPerWatt === null) return null;
  if (!Number.isFinite(costPerWatt) || costPerWatt < 0) return null;
  return Math.round(modules * moduleWattage * costPerWatt);
}

/**
 * Format a module count with thousands separators. Always integer.
 *
 * formatModuleCount(0)     === "0"
 * formatModuleCount(1)     === "1"
 * formatModuleCount(1234)  === "1,234"
 */
export function formatModuleCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString("en-US");
}

/**
 * Format a kW value with up to 1 decimal place + " kW" suffix. Aurora
 * shows "0 kW" for empty designs and "X.X kW" once any module is
 * placed; trailing zeros are stripped so whole-number kW values do
 * not render as "10.0 kW". Thousands separators are added via
 * toLocaleString.
 *
 * formatSystemSizeLabel(0)      === "0 kW"
 * formatSystemSizeLabel(0.4)    === "0.4 kW"
 * formatSystemSizeLabel(4)      === "4 kW"
 * formatSystemSizeLabel(412.8)  === "412.8 kW"
 * formatSystemSizeLabel(1234.5) === "1,234.5 kW"
 */
export function formatSystemSizeLabel(kw: number): string {
  if (!Number.isFinite(kw) || kw < 0) kw = 0;
  // Round to 1dp via tenths, then let toLocaleString trim trailing
  // zeros (maximumFractionDigits: 1) and add the thousands separator.
  const rounded = Math.round(kw * 10) / 10;
  const formatted = rounded.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  return `${formatted} kW`;
}

/**
 * Format a USD price as "$ N,NNN". Returns the Aurora placeholder
 * "$ —" when the input is null (no modules placed) or non-finite /
 * negative (defensive). An explicit zero renders as "$ 0" (which is
 * the correct post-Design state).
 *
 * formatImpactPriceLabel(null)    === "$ —"
 * formatImpactPriceLabel(0)       === "$ 0"
 * formatImpactPriceLabel(16000)   === "$ 16,000"
 * formatImpactPriceLabel(1234567) === "$ 1,234,567"
 * formatImpactPriceLabel(-1)      === "$ —"   (defensive: cost never < 0)
 * formatImpactPriceLabel(NaN)     === "$ —"
 */
export function formatImpactPriceLabel(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return "$ —";
  return `$ ${Math.round(usd).toLocaleString("en-US")}`;
}
