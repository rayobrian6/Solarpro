/**
 * components/3d/irradiance/IrradianceOverlay.tsx
 *
 * Placeholder overlay shown when the irradiance computation finishes
 * (state === 'visible').
 *
 * Aurora parity reference: HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6
 *   - "When computation finishes, the irradiance overlay renders on
 *      the roof (color ramp showing kWh/m²/year)"
 *
 * The actual per-vertex color ramp on the roof is a **separate
 * epic** (per DESIGN.md "Out of scope"). This component renders
 * the proof-of-life badge — a small floating card near the toggle
 * button that confirms the layer is active and shows the average
 * kWh/m²/year from the stub result. When the real engine lands,
 * this component stays (it shows the legend / status) and the
 * future Cesium entity rendering plugs in alongside it.
 */

'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useIrradianceStore } from './irradianceStore';
import { IRRADIANCE_TOGGLE_TOOLTIP } from './types';

export interface IrradianceOverlayProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function IrradianceOverlay(props: IrradianceOverlayProps): React.JSX.Element | null {
  const { className, style } = props;
  const state = useIrradianceStore((s) => s.state);
  const result = useIrradianceStore((s) => s.result);
  const toggle = useIrradianceStore((s) => s.toggle);

  // Only render when the state machine says "visible".
  if (state !== 'visible' || !result) return null;

  return (
    <div
      role="region"
      aria-label="Irradiance map"
      data-testid="irradiance-overlay"
      className={[
        'pointer-events-auto flex items-center gap-2',
        'rounded-md border border-amber-400/40 bg-slate-900/85 backdrop-blur-sm',
        'px-3 py-2 text-[12px] text-slate-100 shadow-lg',
        className ?? '',
      ].join(' ').trim()}
      style={style}
    >
      <span
        className="inline-block w-2 h-2 rounded-full bg-amber-400"
        aria-hidden="true"
      />
      <div className="flex flex-col leading-tight">
        <span className="font-semibold">Irradiance map ready</span>
        <span className="text-slate-300 text-[11px]">
          {Math.round(result.annualKwhPerM2).toLocaleString()} kWh/m²/yr (avg)
        </span>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={`${IRRADIANCE_TOGGLE_TOOLTIP} (hide)`}
        data-testid="irradiance-overlay-close"
        className="ml-1 text-slate-400 hover:text-white transition-colors"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
