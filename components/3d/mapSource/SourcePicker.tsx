/**
 * components/3d/mapSource/SourcePicker.tsx
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { SOURCES } from './constants';
import SourceIcon from './SourceIcon';
import type { MapSource } from './types';

interface Props {
  source: MapSource;
  onChange: (source: MapSource) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  disabled?: boolean;
  showAttribution?: boolean;
  className?: string;
}

export default function SourcePicker({
  source, onChange, open, onOpenChange, disabled, showAttribution = true, className,
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

  const current = SOURCES.find(s => s.id === source) ?? SOURCES[0];

  return (
    <div ref={containerRef} className={`relative flex-shrink-0 ${className ?? ''}`} data-testid="map-source-picker">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        title="Change raster basemap provider"
        aria-label={`Source: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-r-xl border border-l-0 text-xs font-semibold transition-colors ${
          open ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-200 hover:text-white hover:border-slate-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <SourceIcon kind={current.iconKey} size={14} />
        <span data-testid="map-source-picker-label">{current.label}</span>
        <span aria-hidden className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open ? (
        <div
          className="absolute top-full right-0 mt-2 z-50 w-64 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden text-left"
          role="menu"
          aria-label="Map source"
          data-testid="map-source-picker-menu"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Source</span>
            {showAttribution ? (
              <span className="text-[10px] uppercase tracking-wider text-emerald-400/80 font-bold">Powered</span>
            ) : null}
          </div>
          <div className="py-1">
            {SOURCES.map(s => {
              const isActive = s.id === source;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    if (s.id !== source) onChange(s.id);
                    onOpenChange(false);
                  }}
                  disabled={disabled}
                  title={s.description}
                  data-testid={`map-source-option-${s.id}`}
                  className={`w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-800/60 transition-colors text-left ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <span aria-hidden className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-transparent'}`} />
                  <SourceIcon kind={s.iconKey} size={14} />
                  <span className="flex-1 text-xs text-slate-200">{s.label}</span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-500'
                    }`}
                  >
                    {isActive ? 'ON' : ''}
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
