'use client';
/**
 * ViewOptionsMenu — Aurora-style header dropdown for view toggles.
 *
 * P3b + P3d of the design-page-simplify dispatch. Replaces the previous 4 standalone
 * header toggle buttons (Show Panels / Shade / 3D↔2D / HD Imagery) plus the tile
 * provider segmented control with a single gear button that opens a dropdown.
 *
 * Design tokens (preserved):
 *  - bg-slate-900 / bg-slate-800 / bg-slate-700
 *  - amber-500/400, blue-500/400, emerald-500/400 accents
 *  - btn-primary / btn-secondary / btn-ghost, btn-sm classes
 *
 * Popover behavior mirrors DesignHeaderMetrics:
 *  - outside-click + Escape both close
 *  - z-50 to escape the header's overflow-x-auto clip
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, SlidersHorizontal, Sun, Map, Satellite, ChevronDown,
} from 'lucide-react';

export type TileProvider = 'auto' | 'google' | 'esri';
export type ActiveTileSource = 'google' | 'esri';

interface Props {
  showPanels: boolean;
  setShowPanels: (v: boolean | ((p: boolean) => boolean)) => void;
  showShade3D: boolean;
  setShowShade3D: (v: boolean | ((p: boolean) => boolean)) => void;
  show3D: boolean;
  setShow3D: (v: boolean | ((p: boolean) => boolean)) => void;
  hdImagery: boolean;
  setHdImagery: (v: boolean | ((p: boolean) => boolean)) => void;
  hdStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  // P3d: tile provider (only used in 2D mode; pass-through state owned by parent)
  tileProvider: TileProvider;
  setTileProvider: (p: TileProvider) => void;
  activeTileSource: ActiveTileSource;
  onTileProviderChange: (p: TileProvider) => void;  // wraps setTileProvider with the cache reset
}

const TILE_OPTIONS: Array<{ id: TileProvider; label: string; sub: string }> = [
  { id: 'auto',   label: '🔍 Auto',   sub: 'Google primary, ESRI fallback' },
  { id: 'google', label: 'Google',    sub: 'Force Google satellite (zoom 21)' },
  { id: 'esri',   label: 'ESRI',      sub: 'Force ESRI World Imagery (zoom 19 max)' },
];

export default function ViewOptionsMenu({
  showPanels, setShowPanels,
  showShade3D, setShowShade3D,
  show3D, setShow3D,
  hdImagery, setHdImagery,
  hdStatus,
  tileProvider,
  activeTileSource,
  onTileProviderChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        title="View options"
        aria-label="View options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
          open
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
            : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
        }`}
      >
        <SlidersHorizontal size={12} />
        <span>View</span>
        <ChevronDown
          size={11}
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          className="absolute top-full right-0 mt-2 z-50 w-64 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden text-left"
          role="menu"
          aria-label="View options"
        >
          {/* Title strip */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={12} className="text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                View options
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-amber-400/80 font-bold">P3b</span>
          </div>

          {/* Toggles */}
          <div className="py-1">
            <ToggleRow
              icon={showPanels ? <Eye size={12} className="text-amber-400" /> : <EyeOff size={12} className="text-slate-500" />}
              label="Show Panels"
              checked={showPanels}
              onChange={() => setShowPanels(v => !v)}
            />
            <ToggleRow
              icon={<Sun size={12} className={showShade3D ? 'text-amber-400' : 'text-slate-500'} />}
              label="Shade Analysis"
              checked={showShade3D}
              onChange={() => setShowShade3D(v => !v)}
            />
            {/* 3D / 2D is a single toggle, not a checkbox */}
            <button
              role="menuitemcheckbox"
              aria-checked={show3D}
              onClick={() => setShow3D(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2 hover:bg-slate-800/60 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs text-slate-200">
                {show3D ? <Map size={12} className="text-blue-400" /> : <Sun size={12} className="text-blue-400" />}
                {show3D ? '🌐 3D View' : '🗺️ 2D Map'}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                show3D ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-700 text-slate-400'
              }`}>
                {show3D ? 'ON' : 'OFF'}
              </span>
            </button>
            <ToggleRow
              icon={<Satellite size={12} className={hdImagery ? 'text-emerald-400' : 'text-slate-500'} />}
              label="HD Imagery"
              hint={show3D ? 'Available in 2D mode only' : undefined}
              disabled={show3D}
              checked={hdImagery}
              onChange={() => setHdImagery(v => !v)}
              extraLabel={hdStatus === 'loading' ? '⏳' : hdStatus === 'unavailable' ? 'n/a' : null}
            />
          </div>

          {/* P3d: tile provider segmented — only meaningful in 2D mode */}
          <div className="border-t border-slate-700/60 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
              Tile provider {show3D ? <span className="text-slate-600 normal-case">(2D mode only)</span> : null}
            </div>
            {show3D ? (
              <div className="text-[11px] text-slate-500 italic">
                Available in 2D mode only. Switch the view above to enable.
              </div>
            ) : (
              <div className="flex items-center gap-0.5 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                {TILE_OPTIONS.map(opt => {
                  const selected = tileProvider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => onTileProviderChange(opt.id)}
                      title={opt.sub}
                      className={`flex-1 px-2 py-1 text-[10px] font-semibold transition-colors ${
                        selected
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <span
                  className={`px-1.5 py-1 text-[9px] font-bold border-l border-slate-600 ${
                    activeTileSource === 'google' ? 'text-blue-400' : 'text-amber-400'
                  }`}
                  title={`Active source: ${activeTileSource}`}
                >
                  {activeTileSource === 'google' ? '✓G' : '✓E'}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  hint?: string;
  extraLabel?: string | null;
}

function ToggleRow({ icon, label, checked, onChange, disabled, hint, extraLabel }: ToggleRowProps) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onChange(); }}
      title={hint}
      className={`w-full flex items-center justify-between gap-2 px-4 py-2 transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-slate-800/60'
      }`}
    >
      <span className="flex items-center gap-2 text-xs text-slate-200">
        {icon}
        {label}
        {extraLabel ? <span className="text-[10px] text-slate-500">{extraLabel}</span> : null}
      </span>
      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
        checked ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-500'
      }`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
