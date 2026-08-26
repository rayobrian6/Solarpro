'use client';
/**
 * StatusPanel — bottom-right live status readout for the Design phase.
 *
 * Aurora frame 0147 parity (HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6):
 *
 *   Modules:               0
 *   System Size (STC):   0 kW
 *   Impact Price:        $ —
 *
 * The component is **display-only**. All math lives in statusMath.ts
 * and is unit-tested. The hook useDesignTotals() is a convenience for
 * callers that want the pre-formatted labels, but StatusPanel also
 * accepts the raw `modules / moduleWattage / costPerWatt` numbers
 * directly so a parent can skip the hook when wiring from a plain
 * store.
 *
 * Mounting: render once inside the canvas-relative wrapper. The
 * parent is responsible for gating visibility on its Design-phase
 * flag (SolarEngine3D passes `isDesignPhase` to control `visible`).
 */
import React from 'react';
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

export interface StatusPanelProps {
  /** Live count of placed solar panels. */
  modules: number;
  /** Optional: STC watts per module. Defaults to 400W. */
  moduleWattage?: number;
  /** Optional: dollars per watt. Defaults to `null` (Aurora "$ —"
   *  placeholder). An explicit `0` is a real $/W and is respected. */
  costPerWatt?: number | null;
  /** Optional: hide the panel. Default true. SolarEngine3D passes
   *  isDesignPhase so the panel only shows in Design mode. */
  visible?: boolean;
}

/**
 * Internal default-value resolution. Hoisted out of the JSX so the
 * destructured props below carry the resolved (not-undefined) values
 * and downstream type-narrowing is clean.
 */
function resolveProps(props: StatusPanelProps): {
  modules: number;
  moduleWattage: number;
  costPerWatt: number | null;
  visible: boolean;
} {
  return {
    modules: props.modules,
    moduleWattage: props.moduleWattage ?? DEFAULT_MODULE_WATTAGE,
    // `null` when the parent doesn't supply a $/W — renders Aurora's
    // "$ —" placeholder. An explicit 0 from the parent is preserved.
    costPerWatt: props.costPerWatt !== undefined ? props.costPerWatt : COST_NOT_SET,
    visible: props.visible !== false,
  };
}

/**
 * StatusPanel — renders the three-row Aurora parity bar. Pure render;
 * no state, no effects. Re-renders are cheap: the parent only updates
 * the `modules` / `costPerWatt` props when something actually changes
 * in the design state.
 */
function StatusPanelBase(props: StatusPanelProps): React.ReactElement | null {
  const { modules, moduleWattage, costPerWatt, visible } = resolveProps(props);

  if (!visible) return null;

  const systemSizeKw = computeSystemSizeKw(modules, moduleWattage);
  const impactPriceUsd = computeImpactPrice(modules, moduleWattage, costPerWatt);

  const modulesLabel = formatModuleCount(modules);
  const systemSizeLabel = formatSystemSizeLabel(systemSizeKw);
  const impactPriceLabel = formatImpactPriceLabel(impactPriceUsd);

  // Matches Aurora's "label-left, value-right, padded gutter" look.
  // The grid template keeps the colons visually aligned even if
  // module counts grow into the thousands.
  return (
    <div
      data-testid="status-panel"
      role="status"
      aria-live="polite"
      aria-label={`Design status: ${modulesLabel} modules, ${systemSizeLabel} system size, ${impactPriceLabel} impact price`}
      style={{
        position: 'absolute',
        bottom: 28,
        right: 8,
        zIndex: 40,
        background: 'rgba(0,0,0,0.55)',
        borderRadius: 5,
        padding: '6px 10px',
        color: '#ddd',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: '16px',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: 14,
          rowGap: 1,
        }}
      >
        <span style={{ color: '#aaa', textAlign: 'left' }}>Modules:</span>
        <span style={{ color: '#ddd', textAlign: 'right' }} data-testid="status-modules">{modulesLabel}</span>

        <span style={{ color: '#aaa', textAlign: 'left' }}>System Size (STC):</span>
        <span style={{ color: '#ddd', textAlign: 'right' }} data-testid="status-system-size">{systemSizeLabel}</span>

        <span style={{ color: '#aaa', textAlign: 'left' }}>Impact Price:</span>
        <span style={{ color: '#ddd', textAlign: 'right' }} data-testid="status-impact-price">{impactPriceLabel}</span>
      </div>
    </div>
  );
}

/**
 * Memoize on the three input values + visible. The parent
 * (SolarEngine3D) already wraps itself in React.memo with a custom
 * comparator, so this is belt-and-suspenders, but it keeps the panel
 * cheap if some downstream parent re-renders for unrelated reasons.
 */
const StatusPanel = React.memo(StatusPanelBase, (prev, next) => {
  return (
    prev.modules === next.modules &&
    prev.moduleWattage === next.moduleWattage &&
    prev.costPerWatt === next.costPerWatt &&
    prev.visible === next.visible
  );
});

export default StatusPanel;
export { StatusPanelBase };
export type { DesignTotals };
