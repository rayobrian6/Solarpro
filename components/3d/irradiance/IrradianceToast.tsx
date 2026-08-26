/**
 * components/3d/irradiance/IrradianceToast.tsx
 *
 * Top-right single-slot toast notification for the irradiance flow.
 *
 * Aurora parity reference: HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6
 *   - Text: literal "Irradiance Map was queued"
 *   - Position: top-right of the canvas, just below the top bar
 *   - Auto-dismiss (Aurora fades it out after a couple of seconds)
 *
 * This is intentionally separate from the global `Toast` system in
 * `components/ui/Toast.tsx` (which is bottom-right). Aurora puts
 * the irradiance message at the top, and a top-right anchor next
 * to the toolbar button is the most direct visual connection.
 */

'use client';

import React from 'react';
import { useIrradianceStore, selectToast } from './irradianceStore';

export interface IrradianceToastProps {
  /** Override the default top-right anchor (e.g. for embedded viewers). */
  className?: string;
  /** Override default position style. */
  style?: React.CSSProperties;
}

export default function IrradianceToast(props: IrradianceToastProps): React.JSX.Element | null {
  const { className, style } = props;
  const toast = useIrradianceStore(selectToast);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="irradiance-toast"
      data-toast-id={toast.id}
      className={[
        'pointer-events-none fixed top-12 right-4 z-[60]',
        'rounded-md border border-slate-500/50 bg-slate-900/90 backdrop-blur-sm',
        'px-3 py-2 text-[12px] font-medium text-slate-100 shadow-lg',
        'transition-opacity duration-200',
        className ?? '',
      ].join(' ').trim()}
      style={style}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
          aria-hidden="true"
        />
        <span>{toast.title}</span>
      </div>
    </div>
  );
}
