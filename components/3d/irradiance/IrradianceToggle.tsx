/**
 * components/3d/irradiance/IrradianceToggle.tsx
 *
 * Toolbar button + Aurora-style "Toggle Irradiance Map (I)" tooltip.
 *
 * Aurora parity reference: HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6
 *   - Tooltip text: literal "Toggle Irradiance Map (I)"
 *   - Visual: small icon button on the top-right toolbar
 *   - Disabled state while a computation is in flight (Aurora locks
 *     the toggle while the request is queued / computing)
 *
 * The button reads from the Zustand store and dispatches
 * `toggle()` on click. The hotkey is owned by `useIrradianceHotkey`
 * (or by the parent's existing keydown handler).
 */

'use client';

import React, { useState } from 'react';
import { Sun } from 'lucide-react';
import { useIrradianceStore, selectIsInFlight, selectIsVisible } from './irradianceStore';
import { IRRADIANCE_TOGGLE_TOOLTIP } from './types';

export interface IrradianceToggleProps {
  /** Optional className to override the default anchor positioning
   *  when embedded somewhere other than the canvas top-right. */
  className?: string;
  /** Optional inline style for the anchor. */
  style?: React.CSSProperties;
}

export default function IrradianceToggle(props: IrradianceToggleProps): React.JSX.Element {
  const { className, style } = props;
  const toggle = useIrradianceStore((s) => s.toggle);
  const inFlight = useIrradianceStore(selectIsInFlight);
  const isVisible = useIrradianceStore(selectIsVisible);
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (inFlight) return; // mirror the store guard at the UI level
    toggle();
  };

  // Aurora's button is small and dark-themed to match the Design
  // phase canvas (frame 147). When the layer is visible, the icon
  // brightens to amber; otherwise it's a soft slate. While in
  // flight, the icon shows a subtle pulse so the user knows work
  // is happening.
  const accent = isVisible
    ? 'text-amber-300 border-amber-400/60 bg-amber-500/15'
    : 'text-slate-200 border-slate-500/40 bg-slate-800/60 hover:border-slate-300/60 hover:text-white';

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      disabled={inFlight}
      aria-label={IRRADIANCE_TOGGLE_TOOLTIP}
      aria-pressed={isVisible}
      data-state={isVisible ? 'visible' : inFlight ? 'in-flight' : 'idle'}
      data-testid="irradiance-toggle"
      title={IRRADIANCE_TOGGLE_TOOLTIP}
      className={[
        'relative flex items-center justify-center w-9 h-9 rounded-md border transition-colors',
        accent,
        inFlight ? 'cursor-wait opacity-80' : 'cursor-pointer',
        className ?? '',
      ].join(' ').trim()}
      style={style}
    >
      <Sun
        size={16}
        className={inFlight ? 'animate-pulse' : undefined}
        aria-hidden="true"
      />
      {hovered ? (
        <span
          role="tooltip"
          data-testid="irradiance-toggle-tooltip"
          className="absolute top-full mt-1 right-0 whitespace-nowrap rounded-md bg-slate-900/95 border border-slate-600/60 px-2 py-1 text-[11px] font-medium text-slate-100 shadow-lg pointer-events-none z-50"
        >
          {IRRADIANCE_TOGGLE_TOOLTIP}
        </span>
      ) : null}
    </button>
  );
}
