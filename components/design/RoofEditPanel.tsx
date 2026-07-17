'use client';
/**
 * RoofEditPanel — Aurora-style slide-up panel for roof edit context.
 *
 * P0 of the design-page-simplify dispatch. Renders ONLY when the user is in
 * `draw_roof` mode. Slides up from the bottom of the 3D canvas with the
 * roof-specific configuration that used to live in the always-on right
 * sidebar (setback slider, racking picker, paint-mode toggle, AHJ fire code).
 *
 * Design tokens (preserved):
 *  - amber-500 / amber-400 accent
 *  - btn-primary / btn-secondary / btn-ghost classes
 *  - card / card-hover helper classes (where applicable)
 *  - rounded card on dark slate
 *
 * Animations are pure Tailwind transitions (no framer) so we don't pull a
 * new dep in scope of P0.
 */
import React from 'react';
import {
  Home, Settings, Zap, Brush, Compass, ChevronDown, ChevronUp,
  Box, X, Layers, Rows3
} from 'lucide-react';
import { RACKING_SYSTEMS } from '@/lib/equipment-db';
import type { SystemType } from '@/types';
import type { Topology } from '@/lib/stringAssignment';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  hint?: string;
}

function SliderRow({ label, value, min, max, step, unit, onChange, hint }: SliderRowProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-[11px] text-slate-400 font-medium">{label}</label>
        <span className="text-xs font-semibold text-amber-400 tabular-nums">
          {typeof value === 'number' ? value.toFixed(unit === 'm' ? 2 : 0) : value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
      />
      {hint ? <p className="text-[10px] text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

interface Props {
  /** Active system type — panel only really matters in `roof` but accepts all. */
  activeZoneType: SystemType;
  /** Open by default — controlled by parent (true ⇔ `drawingMode === 'draw_roof'`). */
  open: boolean;

  // ── Setbacks (roof only) ──────────────────────────────────────────────
  setback: number;
  setSetback: (v: number) => void;

  // ── Racking (roof / fence) ────────────────────────────────────────────
  rackingId: string;
  onRackingChange: (id: string) => void;

  // ── Paint mode (v63 manual string painting) ───────────────────────────
  paintMode: boolean;
  togglePaintMode: () => void;
  paintStringCount: number;
  paintStringIndex: number;
  setPaintStringIndex: (i: number) => void;

  // ── AHJ-derived fire code (display only) ───────────────────────────────
  ahjCity?: string | null;
  ahjCounty?: string | null;
  ridgeSetbackInches?: number;
  pathwayWidthInches?: number;
  eaveSetbackInches?: number;

  // ── Multi-Row (P2b) — moved out of the left toolbar into this panel ──
  multiRowMode: boolean;
  setMultiRowMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  multiRowCount: number;
  setMultiRowCount: (v: number | ((prev: number) => number)) => void;

  // ── 3D view toggle (Aurora-style 3D-cube corner button) ───────────────
  show3D: boolean;
  toggle3D: () => void;

  // ── Close panel (exits draw_roof mode in parent) ──────────────────────
  onClose: () => void;
}

const AHJ_FIELD_LABELS: Record<string, string> = {
  ridgeSetbackInches: 'Ridge setback',
  pathwayWidthInches: 'Pathway width',
  eaveSetbackInches: 'Eave setback',
};

export default function RoofEditPanel({
  activeZoneType,
  open,
  setback,
  setSetback,
  rackingId,
  onRackingChange,
  paintMode,
  togglePaintMode,
  paintStringCount,
  paintStringIndex,
  setPaintStringIndex,
  ahjCity,
  ahjCounty,
  ridgeSetbackInches,
  pathwayWidthInches,
  eaveSetbackInches,
  multiRowMode,
  setMultiRowMode,
  multiRowCount,
  setMultiRowCount,
  show3D,
  toggle3D,
  onClose,
}: Props) {
  const [ahjOpen, setAhjOpen] = React.useState(true);
  const [paintOpen, setPaintOpen] = React.useState(true);
  const [rackingOpen, setRackingOpen] = React.useState(false);
  const [multiRowOpen, setMultiRowOpen] = React.useState(true);

  // Outer panel: transform translate-y-full ↔ translate-y-0 with opacity.
  // Pure CSS transition (300ms) keeps it crisp.
  return (
    <div
      className={`absolute z-30 bottom-4 left-4 right-4 md:right-auto md:max-w-2xl
        transition-all duration-300 ease-out
        ${open ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'}
      `}
      role="region"
      aria-label="Roof editing controls"
      aria-hidden={!open}
    >
      <div className="relative bg-amber-500/[0.08] backdrop-blur-xl border border-amber-500/40 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* 3D-cube toggle pinned to top-right corner (Aurora-style accent) */}
        <button
          onClick={toggle3D}
          title={show3D ? 'Switch to 2D map' : 'Switch to 3D view'}
          aria-label={show3D ? 'Switch to 2D map view' : 'Switch to 3D view'}
          className="absolute top-0 right-12 -translate-y-1/2 w-11 h-11 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 border-2 border-amber-500/60 text-white shadow-lg shadow-black/40 flex items-center justify-center transition-colors z-10"
        >
          <Box size={18} />
        </button>
        {/* Close button (exits draw_roof mode) */}
        <button
          onClick={onClose}
          title="Close roof editing (V)"
          aria-label="Close roof editing panel"
          className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center justify-center transition-colors"
        >
          <X size={14} />
        </button>

        {/* Card body */}
        <div className="px-5 pt-4 pb-5">
          {/* Title */}
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-2xl font-bold text-white tracking-tight">Edit roof</h2>
            <span className="text-[11px] uppercase tracking-wider text-amber-300/80 font-semibold">
              {activeZoneType === 'roof' ? 'Roof zone' : `${activeZoneType} zone`}
            </span>
          </div>

          {/* Setbacks */}
          {activeZoneType === 'roof' ? (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Layers size={11} className="text-amber-400" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Setbacks</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 py-3 bg-slate-900/60 rounded-xl border border-slate-700/40">
                <SliderRow
                  label="Roof setback"
                  value={setback}
                  min={0}
                  max={2.0}
                  step={0.05}
                  unit="m"
                  onChange={setSetback}
                  hint="Applied to usable roof polygon before panel placement."
                />
                <div className="text-[11px] text-slate-400 self-center">
                  <div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold mb-1">Fire setbacks (AHJ)</div>
                  <div className="space-y-0.5">
                    <div>Ridge: <span className="text-white font-mono">{ridgeSetbackInches ?? 18}"</span></div>
                    <div>Pathway: <span className="text-white font-mono">{pathwayWidthInches ?? 36}"</span></div>
                    <div>Eave: <span className="text-white font-mono">{eaveSetbackInches ?? 0}"</span></div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Racking picker */}
          <div className="mb-4">
            <button
              onClick={() => setRackingOpen(v => !v)}
              className="w-full flex items-center justify-between mb-1.5 group"
            >
              <div className="flex items-center gap-1.5">
                <Settings size={11} className="text-amber-400" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Racking (mid-clamp)</span>
              </div>
              {rackingOpen ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
            </button>
            {rackingOpen ? (
              <div className="px-3 py-3 bg-slate-900/60 rounded-xl border border-slate-700/40">
                <select
                  value={rackingId}
                  onChange={e => onRackingChange(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded text-xs text-slate-200 px-2 py-1.5"
                >
                  {RACKING_SYSTEMS.filter(r => activeZoneType === 'fence'
                    ? r.systemType === 'fence'
                    : (r.systemType === 'roof' || r.systemType === 'flat_roof')
                  ).map(r => (
                    <option key={r.id} value={r.id}>{r.manufacturer} {r.model}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Mid-clamp gaps accumulate across each row — applied to panel spacing and the firewalk filter.
                </p>
              </div>
            ) : null}
          </div>

          {/* Paint mode */}
          <div className="mb-4">
            <button
              onClick={() => setPaintOpen(v => !v)}
              className="w-full flex items-center justify-between mb-1.5 group"
            >
              <div className="flex items-center gap-1.5">
                <Brush size={11} className="text-fuchsia-400" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Paint mode</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  paintMode ? 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300' : 'border-slate-700 text-slate-500'
                }`}>
                  {paintMode ? 'ON' : 'OFF'}
                </span>
              </div>
              {paintOpen ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
            </button>
            {paintOpen ? (
              <div className="px-3 py-3 bg-slate-900/60 rounded-xl border border-slate-700/40 space-y-2">
                <button
                  onClick={togglePaintMode}
                  className={`w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                    paintMode
                      ? 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300'
                      : 'border-slate-600 text-slate-300 hover:bg-slate-700/40'
                  }`}
                >
                  {paintMode ? 'Painting — click panels in 3D to assign' : 'Toggle paint mode'}
                </button>
                {paintMode && paintStringCount > 0 ? (
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Active string (click panels in 3D to assign):</div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: paintStringCount }).map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setPaintStringIndex(idx)}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                            paintStringIndex === idx
                              ? 'border-white text-white bg-slate-700/60'
                              : 'border-slate-600 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          String {idx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-[10px] text-slate-500">
                  Manual string painting — click a panel in the 3D view to assign it to the active string.
                </p>
              </div>
            ) : null}
          </div>

          {/* design-page-simplify P2b: Multi-Row (was inline in the left toolbar) */}
          <div className="mb-4">
            <button
              onClick={() => setMultiRowOpen(v => !v)}
              className="w-full flex items-center justify-between mb-1.5"
            >
              <div className="flex items-center gap-1.5">
                <Rows3 size={11} className="text-amber-400" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Multi-row placement</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  multiRowMode ? 'border-amber-500/60 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-500'
                }`}>
                  {multiRowMode ? 'ON' : 'OFF'}
                </span>
              </div>
              {multiRowOpen ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
            </button>
            {multiRowOpen ? (
              <div className="px-3 py-3 bg-slate-900/60 rounded-xl border border-slate-700/40 space-y-2">
                <button
                  onClick={() => setMultiRowMode(v => !v)}
                  className={`w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                    multiRowMode
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-slate-600 text-slate-300 hover:bg-slate-700/40'
                  }`}
                >
                  {multiRowMode ? '✓ Active — click end of first row on the canvas' : '⊞ Activate multi-row mode'}
                </button>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Rows per placement</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setMultiRowCount(v => Math.max(2, v - 1))}
                      className="w-6 h-6 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center text-xs"
                      aria-label="Decrease row count"
                    >
                      −
                    </button>
                    <span className="text-xs font-semibold text-white w-5 text-center tabular-nums">{multiRowCount}</span>
                    <button
                      onClick={() => setMultiRowCount(v => Math.min(20, v + 1))}
                      className="w-6 h-6 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex items-center justify-center text-xs"
                      aria-label="Increase row count"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  Roof-only tool. Click two points on the canvas to lay down {multiRowCount} stacked rows of panels.
                </p>
              </div>
            ) : null}
          </div>

          {/* AHJ Fire Code */}
          <div>
            <button
              onClick={() => setAhjOpen(v => !v)}
              className="w-full flex items-center justify-between mb-1.5"
            >
              <div className="flex items-center gap-1.5">
                <Compass size={11} className="text-emerald-400" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">AHJ fire code</span>
                {(ahjCity || ahjCounty) ? (
                  <span className="text-[10px] text-emerald-400/80 font-normal normal-case">
                    {[ahjCity, ahjCounty].filter(Boolean).join(', ')}
                  </span>
                ) : null}
              </div>
              {ahjOpen ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
            </button>
            {ahjOpen ? (
              <div className="px-3 py-3 bg-slate-900/60 rounded-xl border border-slate-700/40">
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {(['ridgeSetbackInches', 'pathwayWidthInches', 'eaveSetbackInches'] as const).map(key => (
                    <div key={key} className="bg-slate-800/60 rounded-lg p-2 border border-slate-700/30">
                      <div className="text-slate-500 text-[10px] uppercase tracking-wide">{AHJ_FIELD_LABELS[key]}</div>
                      <div className="font-mono text-emerald-400 font-bold text-sm mt-0.5">
                        {key === 'ridgeSetbackInches' ? ridgeSetbackInches :
                          key === 'pathwayWidthInches' ? pathwayWidthInches :
                          eaveSetbackInches}{'"'}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Values are looked up from the project address. Adjust the roof setback above to override the ridge setback.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
