/**
 * components/3d/mapSource/DetailsDropdown.tsx
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { LAYERS } from './constants';
import type { MapLayer } from './types';

interface Props {
  activeLayers: ReadonlySet<MapLayer>;
  onToggle: (layer: MapLayer) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export default function DetailsDropdown({
  activeLayers,
  onToggle,
  open,
  onOpenChange,
  disabled,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className={`relative flex-shrink-0 ${className ?? ''}`} data-testid="map-source-details">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        title="Toggle overlay layers"
        aria-label={`Details (${activeLayers.size})`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-l-xl border text-xs font-semibold transition-colors ${
          open
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            : 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:border-slate-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span>Details</span>
        <span
          className={`text-[10px] tabular-nums px-1 rounded ${
            open ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-700/70 text-slate-300'
          }`}
          data-testid="map-source-details-count"
        >
          {activeLayers.size}
        </span>
        <span aria-hidden className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open ? (
        <div
          className="absolute top-full right-0 mt-2 z-50 w-64 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden text-left"
          role="menu"
          aria-label="Details"
          data-testid="map-source-details-menu"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Details</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              {activeLayers.size} / {LAYERS.length}
            </span>
          </div>
          <div className="py-1">
            {LAYERS.map(layer => {
              const on = activeLayers.has(layer.id);
              const isLocked = !!layer.locked;
              return (
                <button
                  key={layer.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  aria-disabled={isLocked || disabled}
                  disabled={isLocked || disabled}
                  onClick={() => onToggle(layer.id)}
                  title={layer.description}
                  data-testid={`map-source-layer-${layer.id}`}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 transition-colors text-left ${
                    isLocked || disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs text-slate-200">
                    <span
                      aria-hidden
                      className={`inline-block w-2.5 h-2.5 rounded-sm border ${
                        on ? 'bg-amber-400 border-amber-400' : 'bg-transparent border-slate-500'
                      }`}
                    />
                    <span>{layer.label}</span>
                    {isLocked ? (
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider" title="Always on">locked</span>
                    ) : null}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      on ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-500'
                    }`}
                  >
                    {on ? 'ON' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
