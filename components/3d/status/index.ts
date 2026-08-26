/**
 * Public exports for the bottom-right status panel (Aurora frame 0147).
 *
 * Consumers should import from this barrel rather than reaching into
 * the individual files, so the surface is one path:
 *
 *   import { StatusPanel, useDesignTotals, DEFAULT_MODULE_WATTAGE } from '@/components/3d/status';
 */
export {
  default as StatusPanel,
  StatusPanelBase,
  type StatusPanelProps,
} from './StatusPanel';

export {
  useDesignTotals,
  type DesignTotalsView,
} from './useDesignTotals';

export {
  DEFAULT_MODULE_WATTAGE,
  COST_NOT_SET,
  computeSystemSizeKw,
  computeImpactPrice,
  formatModuleCount,
  formatSystemSizeLabel,
  formatImpactPriceLabel,
  type DesignTotals,
} from './statusMath';
