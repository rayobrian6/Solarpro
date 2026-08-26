/**
 * useDesignTotals — derive the display strings for the bottom-right
 * status panel from a `DesignTotals` input.
 *
 * The hook is intentionally a thin wrapper over the pure math in
 * statusMath.ts. It does NOT subscribe to any context or store — the
 * parent (SolarEngine3D via the design-panel integration) supplies
 * the live values.
 *
 * Once the design-panel agent lands their Design-phase context, the
 * parent will pass `{ modules, costPerWatt }` from that store and the
 * panel will update live. For now, callers can pass just
 * `{ modules: 0 }` and the defaults take over.
 *
 * Returns a flat object with three ready-to-render label strings plus
 * the raw numbers, so any downstream consumer (analytics, exports)
 * can read the same source of truth.
 */
import {
  DEFAULT_MODULE_WATTAGE,
  COST_NOT_SET,
  computeSystemSizeKw,
  computeImpactPrice,
  formatModuleCount,
  formatSystemSizeLabel,
  formatImpactPriceLabel,
  type DesignTotals,
} from './statusMath';

export interface DesignTotalsView {
  /** "0" or "1,234" — already formatted for display. */
  modulesLabel: string;
  /** "0 kW" or "412.8 kW" — already formatted for display. */
  systemSizeLabel: string;
  /** "$ —" or "$ 16,000" — already formatted for display. */
  impactPriceLabel: string;
  /** Raw system size in kW (1 decimal place). For downstream consumers. */
  systemSizeKw: number;
  /** Raw impact price in whole dollars. null when no Design yet or
   *  no modules placed. */
  impactPriceUsd: number | null;
}

export function useDesignTotals(input: Partial<DesignTotals> = {}): DesignTotalsView {
  const modules = input.modules ?? 0;
  const moduleWattage = input.moduleWattage ?? DEFAULT_MODULE_WATTAGE;
  // Default to `null` (Aurora "$ —") when the parent doesn't supply a
  // $/W. An explicit 0 from the parent is a real $/W and is respected.
  const costPerWatt = input.costPerWatt !== undefined ? input.costPerWatt : COST_NOT_SET;

  const systemSizeKw = computeSystemSizeKw(modules, moduleWattage);
  const impactPriceUsd = computeImpactPrice(modules, moduleWattage, costPerWatt);

  return {
    modulesLabel: formatModuleCount(modules),
    systemSizeLabel: formatSystemSizeLabel(systemSizeKw),
    impactPriceLabel: formatImpactPriceLabel(impactPriceUsd),
    systemSizeKw,
    impactPriceUsd,
  };
}
