/**
 * components/proposal/UtilityRateGraph.tsx
 * v47.247 — Utility Rate Graph
 *
 * Shows historical (estimated), projected utility rates, and flat solar equivalent rate.
 * ALL data comes from cp.utility and cp.financial — NO calculations inside this component.
 * Pipeline owns the numbers; this component owns only the rendering geometry.
 */

'use client';

import React from 'react';
import type { CanonicalUtility, CanonicalFinancial } from '@/lib/proposal/canonicalProposal';

interface UtilityRateGraphProps {
  utility: CanonicalUtility;
  financial: CanonicalFinancial;
  /** Annual system production (kWh) — the energy the payment actually buys.
   *  Without it the flat solar rate was computed against USAGE, which on an
   *  oversized system (185% of usage) showed $0.309/kWh — telling the customer
   *  solar costs 2× grid until ~2038 on the same page as a Year-7 payoff. */
  annualProductionKwh?: number;
}

export function UtilityRateGraph({ utility, financial, annualProductionKwh }: UtilityRateGraphProps) {
  const { rateHistory, rate, escalationRate, annualUsageKwh } = utility;
  const { solarPaymentMonthly } = financial;

  // ── Build projected future rates (25 years from current year) ──────────────
  // currentYear is the last point in rateHistory (index 10, yearsBack=0)
  const currentYear = rateHistory[rateHistory.length - 1].year;

  const projectedRates = Array.from({ length: 26 }, (_, i) => ({
    year: currentYear + i,
    rate: parseFloat((rate * Math.pow(1 + escalationRate, i)).toFixed(4)),
    estimated: false,
  }));

  // ── Solar flat line rate ── payment ÷ energy DELIVERED (production) ───────
  // Effective $/kWh the customer pays for solar (fixed, never escalates).
  // Divide by production, not usage: the payment buys every kWh the system
  // makes. Falls back to usage only when production is unavailable.
  const monthlyEnergyKwh = (annualProductionKwh ?? 0) > 0
    ? (annualProductionKwh as number) / 12
    : (annualUsageKwh > 0 ? annualUsageKwh / 12 : 1);
  const solarEffectiveRate = solarPaymentMonthly > 0
    ? parseFloat((solarPaymentMonthly / monthlyEnergyKwh).toFixed(4))
    : 0;

  // ── Combine all data points for Y-axis scaling ────────────────────────────
  const allRates = [
    ...rateHistory.map(p => p.rate),
    ...projectedRates.map(p => p.rate),
    solarEffectiveRate,
  ].filter(r => r > 0);

  const minRate = Math.min(...allRates) * 0.8;
  const maxRate = Math.max(...allRates) * 1.1;
  const rateRange = maxRate - minRate || 1;

  // ── SVG viewport ──────────────────────────────────────────────────────────
  const W = 700;
  const H = 220;
  const PAD_LEFT   = 52;
  const PAD_RIGHT  = 20;
  const PAD_TOP    = 16;
  const PAD_BOTTOM = 32;
  const CHART_W = W - PAD_LEFT - PAD_RIGHT;
  const CHART_H = H - PAD_TOP - PAD_BOTTOM;

  // ── All years (history + future, deduplicated) ────────────────────────────
  const histYears = rateHistory.map(p => p.year);
  const futYears  = projectedRates.slice(1).map(p => p.year); // skip currentYear (already in history)
  const allYears  = [...histYears, ...futYears];
  const totalPoints = allYears.length;

  function xPos(yearIndex: number): number {
    return PAD_LEFT + (yearIndex / (totalPoints - 1)) * CHART_W;
  }

  function yPos(r: number): number {
    return PAD_TOP + CHART_H - ((r - minRate) / rateRange) * CHART_H;
  }

  // ── Build polyline point strings ──────────────────────────────────────────
  // Historical line (indices 0..10)
  const histPoints = rateHistory.map((p, i) => `${xPos(i)},${yPos(p.rate)}`).join(' ');

  // Projected line (indices 10..totalPoints-1, starting from currentYear)
  const projPoints = projectedRates.map((p, i) => {
    const idx = histYears.length - 1 + i; // connects from last history point
    return `${xPos(idx)},${yPos(p.rate)}`;
  }).join(' ');

  // Solar flat line: spans full X range
  const solarY = solarEffectiveRate > 0 ? yPos(solarEffectiveRate) : -1;

  // ── Y-axis tick labels (4 ticks) ──────────────────────────────────────────
  const yTicks = [0, 1, 2, 3].map(i => {
    const r = minRate + (rateRange * i) / 3;
    return { rate: r, y: yPos(r) };
  });

  // ── X-axis year labels (every 5 years) ───────────────────────────────────
  const xLabels: { year: number; x: number }[] = [];
  allYears.forEach((yr, i) => {
    if (yr % 5 === 0) xLabels.push({ year: yr, x: xPos(i) });
  });

  // ── Divider: where history ends / projection begins ───────────────────────
  const dividerX = xPos(histYears.length - 1);

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-red-400 rounded" style={{ borderTop: '2px dashed #f87171' }} />
          <span className="text-slate-500">Historical (est.)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0.5 bg-red-600 rounded" />
          <span className="text-slate-500">Projected utility rate</span>
        </div>
        {solarEffectiveRate > 0 ? (
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-emerald-500 rounded" />
            <span className="text-slate-500">Your solar rate (fixed)</span>
          </div>
        ) : null}
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto', maxHeight: 260 }}
        aria-label="Utility rate history and projection chart"
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD_LEFT} y1={t.y}
            x2={W - PAD_RIGHT} y2={t.y}
            stroke="#e2e8f0" strokeWidth="1"
          />
        ))}

        {/* Divider: history / projection boundary */}
        <line
          x1={dividerX} y1={PAD_TOP}
          x2={dividerX} y2={PAD_TOP + CHART_H}
          stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"
        />
        <text
          x={dividerX + 4} y={PAD_TOP + 10}
          fontSize="8" fill="#94a3b8"
        >Today</text>

        {/* Solar flat line */}
        {solarEffectiveRate > 0 && solarY > 0 ? (
          <>
            <line
              x1={PAD_LEFT} y1={solarY}
              x2={W - PAD_RIGHT} y2={solarY}
              stroke="#10b981" strokeWidth="2"
              strokeDasharray="6 3"
            />
            <text
              x={W - PAD_RIGHT - 4} y={solarY - 4}
              fontSize="8" fill="#059669" textAnchor="end"
            >${solarEffectiveRate.toFixed(3)}/kWh</text>
          </>
        ) : null}

        {/* Historical rate line (dashed red) */}
        <polyline
          points={histPoints}
          fill="none"
          stroke="#f87171"
          strokeWidth="2"
          strokeDasharray="5 3"
        />

        {/* Projected rate line (solid red) */}
        <polyline
          points={projPoints}
          fill="none"
          stroke="#dc2626"
          strokeWidth="2"
        />

        {/* Data dots — history */}
        {rateHistory.map((p, i) => (
          <circle
            key={`h${i}`}
            cx={xPos(i)} cy={yPos(p.rate)}
            r="2.5" fill="#f87171"
          >
            <title>{p.year}: ${p.rate.toFixed(3)}/kWh (estimated)</title>
          </circle>
        ))}

        {/* Data dots — projection (every 5 years) */}
        {projectedRates.filter((_, i) => i % 5 === 0 && i > 0).map((p) => {
          const idx = histYears.length - 1 + projectedRates.indexOf(p);
          return (
            <circle
              key={`p${p.year}`}
              cx={xPos(idx)} cy={yPos(p.rate)}
              r="2.5" fill="#dc2626"
            >
              <title>{p.year}: ${p.rate.toFixed(3)}/kWh (projected)</title>
            </circle>
          );
        })}

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text
            key={i}
            x={PAD_LEFT - 4} y={t.y + 3}
            fontSize="9" fill="#94a3b8" textAnchor="end"
          >${t.rate.toFixed(2)}</text>
        ))}

        {/* Y-axis label */}
        <text
          x={10} y={PAD_TOP + CHART_H / 2}
          fontSize="9" fill="#94a3b8" textAnchor="middle"
          transform={`rotate(-90, 10, ${PAD_TOP + CHART_H / 2})`}
        >$/kWh</text>

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x} y={H - 4}
            fontSize="8" fill="#94a3b8" textAnchor="middle"
          >{l.year}</text>
        ))}

        {/* X-axis baseline */}
        <line
          x1={PAD_LEFT} y1={PAD_TOP + CHART_H}
          x2={W - PAD_RIGHT} y2={PAD_TOP + CHART_H}
          stroke="#cbd5e1" strokeWidth="1"
        />

        {/* Y-axis baseline */}
        <line
          x1={PAD_LEFT} y1={PAD_TOP}
          x2={PAD_LEFT} y2={PAD_TOP + CHART_H}
          stroke="#cbd5e1" strokeWidth="1"
        />
      </svg>
    </div>
  );
}