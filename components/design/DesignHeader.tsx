'use client';
/**
 * DesignHeader — Aurora-style metrics pill + popover for the design page.
 *
 * P1 of the design-page-simplify dispatch. Replaces the scattered
 * "production summary" + "cost summary" callouts inside the right sidebar
 * with a single header pill: `Size · Energy · Savings`. Click expands
 * to reveal the full monthly/financial breakdown.
 *
 * Design tokens (preserved):
 *  - amber-500 / amber-400 accent
 *  - bg-slate-900 / bg-slate-950
 */
import React, { useEffect, useRef, useState } from 'react';
import { Zap, TrendingUp, Coins, ChevronDown, Leaf, BarChart2, Clock, Percent } from 'lucide-react';

export interface DesignHeaderMetricsProps {
  /** Total system size in kW */
  systemSizeKw: number;
  /** Energy offset percentage (0..100). Null/undefined ⇒ pre-production */
  offsetPercentage?: number | null;
  /** Annual savings in dollars. Null/undefined ⇒ pre-cost */
  annualSavings?: number | null;
  /** Annual production (kWh) — for breakdown popover */
  annualProductionKwh?: number | null;
  /** Monthly production — for breakdown popover */
  monthlyProductionKwh?: number[] | null;
  /** CO₂ offset tons/year */
  co2OffsetTons?: number | null;
  /** ROI percentage */
  roi?: number | null;
  /** Lifetime savings (dollars) */
  lifetimeSavings?: number | null;
  /** Payback years */
  paybackYears?: number | null;
  /** Whether at least one panel has been placed (drives `Size` chip visibility) */
  hasPanels: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatKwh(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '–';
  return `${Math.round(v).toLocaleString()} kWh`;
}
function formatDollars(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '–';
  return `$${Math.round(v).toLocaleString()}`;
}
function formatPercent(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '–';
  return `${Math.round(v)}%`;
}

export default function DesignHeaderMetrics({
  systemSizeKw,
  offsetPercentage,
  annualSavings,
  annualProductionKwh,
  monthlyProductionKwh,
  co2OffsetTons,
  roi,
  lifetimeSavings,
  paybackYears,
  hasPanels,
}: DesignHeaderMetricsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Monthly chart data — fall back to empty
  const monthly = Array.isArray(monthlyProductionKwh) && monthlyProductionKwh.length === 12
    ? monthlyProductionKwh
    : null;
  const monthlyMax = monthly ? Math.max(...monthly, 1) : 1;

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl border transition-all ${
          open
            ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
            : 'bg-slate-800/70 border-slate-700/60 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
        }`}
        title="System metrics · click to expand"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex items-center gap-1 text-xs font-bold tabular-nums">
          <Zap size={11} className="text-amber-400" />
          <span className={hasPanels ? 'text-amber-400' : 'text-slate-500'}>
            {hasPanels ? systemSizeKw.toFixed(2) : '0.00'}
          </span>
          <span className="text-slate-500 text-[10px] font-medium">kW</span>
        </span>
        <span className="w-px h-3 bg-slate-700" />
        <span className="flex items-center gap-1 text-xs font-bold tabular-nums">
          <TrendingUp size={11} className="text-blue-400" />
          <span className={offsetPercentage != null ? 'text-blue-400' : 'text-slate-500'}>
            {offsetPercentage != null ? offsetPercentage : '–'}
          </span>
          <span className="text-slate-500 text-[10px] font-medium">%</span>
        </span>
        <span className="w-px h-3 bg-slate-700" />
        <span className="flex items-center gap-1 text-xs font-bold tabular-nums">
          <Coins size={11} className="text-emerald-400" />
          <span className={annualSavings != null ? 'text-emerald-400' : 'text-slate-500'}>
            {annualSavings != null ? annualSavings.toLocaleString() : '–'}
          </span>
          <span className="text-slate-500 text-[10px] font-medium">$/yr</span>
        </span>
        <ChevronDown
          size={12}
          className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Popover — clicks expand the breakdown. z-50 to escape the header overflow clip. */}
      {open ? (
        <div
          className="absolute top-full right-0 mt-2 z-50 w-80 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden text-left"
          role="dialog"
          aria-label="System metrics breakdown"
        >
          {/* Title strip */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                System metrics
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-amber-400/80 font-bold">P1</span>
          </div>

          {/* Top-row trio */}
          <div className="grid grid-cols-3 gap-px bg-slate-700/40">
            <MetricCell icon={<Zap size={12} className="text-amber-400" />} label="Size" value={hasPanels ? `${systemSizeKw.toFixed(2)} kW` : '0 kW'} />
            <MetricCell icon={<TrendingUp size={12} className="text-blue-400" />} label="Energy" value={formatPercent(offsetPercentage)} />
            <MetricCell icon={<Coins size={12} className="text-emerald-400" />} label="Savings" value={formatDollars(annualSavings)} />
          </div>

          {/* Detail rows */}
          <div className="px-4 py-3 space-y-2 text-xs">
            <DetailRow icon={<BarChart2 size={11} className="text-amber-400" />} label="Annual production" value={formatKwh(annualProductionKwh)} />
            <DetailRow icon={<Leaf size={11} className="text-emerald-400" />} label="CO₂ offset" value={co2OffsetTons != null ? `${co2OffsetTons.toFixed(1)} tons/yr` : '–'} />
            <DetailRow icon={<Percent size={11} className="text-blue-400" />} label="ROI" value={formatPercent(roi)} />
            <DetailRow icon={<Coins size={11} className="text-emerald-400" />} label="25-year savings" value={formatDollars(lifetimeSavings)} />
            <DetailRow icon={<Clock size={11} className="text-cyan-400" />} label="Payback" value={paybackYears != null && isFinite(paybackYears) ? `${paybackYears.toFixed(1)} years` : '–'} />
          </div>

          {/* Monthly sparkline */}
          {monthly ? (
            <div className="px-4 pb-4 pt-2 border-t border-slate-700/40">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
                Monthly production (kWh)
              </div>
              <div className="flex items-end gap-0.5 h-12">
                {monthly.map((kwh, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-amber-500/70 hover:bg-amber-400 rounded-sm transition-colors"
                      style={{ height: `${Math.max(2, (kwh / monthlyMax) * 40)}px` }}
                      title={`${MONTHS[i]}: ${kwh.toLocaleString()} kWh`}
                    />
                    <span className="text-slate-500" style={{ fontSize: '8px' }}>{MONTHS[i][0]}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MetricCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-900 px-3 py-2.5 flex flex-col">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        {icon}{label}
      </div>
      <div className="text-base font-bold text-white tabular-nums mt-1">{value}</div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}{label}
      </div>
      <span className="font-semibold text-white tabular-nums">{value}</span>
    </div>
  );
}
