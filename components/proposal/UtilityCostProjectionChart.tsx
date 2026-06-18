/**
 * components/proposal/UtilityCostProjectionChart.tsx
 * v47.250 — Utility Cost Projection Chart (Utility DB Model Refactor)
 *
 * Pure SVG component — zero new dependencies.
 * Shows cumulative 25-year cost comparison:
 *   - Without Solar: utility bills compounding at escalationRate (red line)
 *   - With Solar:    solar total cost + remaining utility bills (green line)
 *
 * v47.250 SPEC §5 COMPLIANCE:
 *   Graph data is derived EXCLUSIVELY from yearlyFlow (CanonicalEnergyFlowYear[]).
 *   NO inline recomputation of rates, degradation, or escalation.
 *   cumulative_without_solar → red line values.
 *   cumulative_with_solar    → green line values.
 *   All values are pre-computed by the iterative model in calculate25yrProjection.
 *
 * PHASE 15 FEATURES (retained):
 *   - Break-even vertical marker with "Solar surpasses utility cost in Year X" callout
 *   - Shaded savings region (green fill between the two lines after crossover)
 *   - Cumulative savings label at Year 25
 *   - Source attribution label
 *
 * All values derived from CanonicalProposal — no inline math in this component.
 */

'use client';

import type {
  CanonicalUtility,
  CanonicalFinancial,
  CanonicalTruth25yr,
  CanonicalEnergyFlowYear,
} from '@/lib/proposal/canonicalProposal';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface UtilityCostProjectionChartProps {
  utility: CanonicalUtility;
  financial: CanonicalFinancial;
  truth25yr: CanonicalTruth25yr;
  /** Panel degradation rate — kept for prop-API compatibility but NOT used for computation */
  panelDegradation?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const W = 700;
const H = 290;
const PAD = { top: 36, right: 80, bottom: 48, left: 72 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;
const YEARS = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Chart
// ─────────────────────────────────────────────────────────────────────────────

export function UtilityCostProjectionChart({
  utility,
  financial,
  truth25yr,
  panelDegradation: _panelDegradation,   // accepted but not used — SPEC §5
}: UtilityCostProjectionChartProps) {
  const { escalationRateSourceLabel } = utility;

  // ── SPEC §5: Derive cumulative arrays from yearlyFlow (canonical iterative model) ──
  // yearlyFlow is guaranteed 25 entries by the pipeline (SPEC §9 assertion A9).
  // Fall back gracefully to empty arrays if somehow absent (should never happen in prod).
  const flow: CanonicalEnergyFlowYear[] = truth25yr.yearlyFlow ?? [];

  const withoutSolar: number[] = flow.map(yr => Math.round(yr.cumulative_without_solar));
  const withSolar:    number[] = flow.map(yr => Math.round(yr.cumulative_with_solar));

  // If yearlyFlow is empty (defensive fallback only), render nothing meaningful
  if (withoutSolar.length === 0 || withSolar.length === 0) {
    return (
      <div className="w-full p-4 text-sm text-slate-500 italic">
        Projection data unavailable.
      </div>
    );
  }

  // ── Y-axis range ──────────────────────────────────────────────────────────
  const maxVal = Math.max(...withoutSolar, ...withSolar);
  const yMax   = Math.ceil(maxVal / 10000) * 10000;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function xPos(i: number): number {
    return PAD.left + (i / (YEARS - 1)) * CHART_W;
  }
  function yPos(val: number): number {
    return PAD.top + CHART_H - (val / yMax) * CHART_H;
  }
  function formatK(val: number): string {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000)    return `$${Math.round(val / 1000)}k`;
    return `$${val}`;
  }

  // ── Path builders ─────────────────────────────────────────────────────────
  function buildPath(data: number[]): string {
    return data.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');
  }

  // ── Y-axis ticks (6 levels) ───────────────────────────────────────────────
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((yMax / 5) * i));

  // ── X-axis labels (every 5 years) ─────────────────────────────────────────
  const xLabels = [1, 5, 10, 15, 20, 25];

  // ── Break-even / crossover point ─────────────────────────────────────────
  // First year where cumulative_with_solar <= cumulative_without_solar (solar wins)
  let crossoverYear: number | null = null;
  for (let i = 0; i < withSolar.length; i++) {
    if (withSolar[i] <= withoutSolar[i]) {
      crossoverYear = i + 1;
      break;
    }
  }

  // ── Shaded savings region (from crossover to year 25) ────────────────────
  let savingsRegionPath = '';
  if (crossoverYear !== null && crossoverYear < YEARS) {
    const startIdx = crossoverYear - 1;
    const forwardPoints = Array.from({ length: YEARS - startIdx }, (_, j) => {
      const idx = startIdx + j;
      return `${j === 0 ? 'M' : 'L'}${xPos(idx).toFixed(1)},${yPos(withoutSolar[idx]).toFixed(1)}`;
    });
    const backwardPoints = Array.from({ length: YEARS - startIdx }, (_, j) => {
      const idx = YEARS - 1 - j;
      if (idx < startIdx) return '';
      return `L${xPos(idx).toFixed(1)},${yPos(withSolar[idx]).toFixed(1)}`;
    }).filter(Boolean);
    savingsRegionPath = [...forwardPoints, ...backwardPoints, 'Z'].join(' ');
  }

  // ── Savings at year 25 ────────────────────────────────────────────────────
  const savings25 = withoutSolar[YEARS - 1] - withSolar[YEARS - 1];

  // ── Crossover annotation position ─────────────────────────────────────────
  const crossoverX    = crossoverYear ? xPos(crossoverYear - 1) : null;
  const crossoverYVal = crossoverYear
    ? (withoutSolar[crossoverYear - 1] + withSolar[crossoverYear - 1]) / 2
    : 0;
  // Decide label side: if crossover is in first half, put label right; else left
  const labelOnRight = crossoverYear !== null && crossoverYear <= 15;

  return (
    <div className="w-full">
      {/* Break-even announcement banner */}
      {crossoverYear !== null && crossoverYear > 1 ? (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
          <span className="text-indigo-600 text-base">⚡</span>
          <span className="text-sm font-bold text-indigo-800">
            Solar surpasses utility cost in Year {crossoverYear}
          </span>
          <span className="text-xs text-indigo-500 ml-1">
            — every year after that is net savings
          </span>
        </div>
      ) : null}

      {/* Source label */}
      <p className="text-xs text-slate-500 mb-2">
        Projection based on{' '}
        <span className="font-medium text-slate-700">{escalationRateSourceLabel}</span>
      </p>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: 'block' }}
        aria-label="25-year cumulative energy cost comparison"
      >
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <line
            key={tick}
            x1={PAD.left}
            y1={yPos(tick)}
            x2={PAD.left + CHART_W}
            y2={yPos(tick)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((tick) => (
          <text
            key={tick}
            x={PAD.left - 8}
            y={yPos(tick) + 4}
            textAnchor="end"
            fontSize={10}
            fill="#94a3b8"
          >
            {formatK(tick)}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((yr) => (
          <text
            key={yr}
            x={xPos(yr - 1)}
            y={PAD.top + CHART_H + 18}
            textAnchor="middle"
            fontSize={10}
            fill="#94a3b8"
          >
            Yr {yr}
          </text>
        ))}

        {/* X-axis line */}
        <line
          x1={PAD.left}
          y1={PAD.top + CHART_H}
          x2={PAD.left + CHART_W}
          y2={PAD.top + CHART_H}
          stroke="#e2e8f0"
          strokeWidth={1}
        />

        {/* Shaded savings region (post-crossover) */}
        {savingsRegionPath ? (
          <path
            d={savingsRegionPath}
            fill="#d1fae5"
            opacity={0.6}
          />
        ) : null}

        {/* Shaded deficit region (pre-crossover, where solar costs more) */}
        {crossoverYear !== null && crossoverYear > 1 && (() => {
          const endIdx = crossoverYear - 1;
          const forwardPoints = Array.from({ length: endIdx + 1 }, (_, j) => {
            return `${j === 0 ? 'M' : 'L'}${xPos(j).toFixed(1)},${yPos(withSolar[j]).toFixed(1)}`;
          });
          const backwardPoints = Array.from({ length: endIdx + 1 }, (_, j) => {
            const idx = endIdx - j;
            return `L${xPos(idx).toFixed(1)},${yPos(withoutSolar[idx]).toFixed(1)}`;
          });
          const deficitPath = [...forwardPoints, ...backwardPoints, 'Z'].join(' ');
          return (
            <path
              d={deficitPath}
              fill="#fee2e2"
              opacity={0.4}
            />
          );
        })()}

        {/* Without solar line (red) */}
        <path
          d={buildPath(withoutSolar)}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2.5}
          strokeLinejoin="round"
        >
          <title>Cumulative utility cost without solar</title>
        </path>

        {/* With solar line (green) */}
        <path
          d={buildPath(withSolar)}
          fill="none"
          stroke="#16a34a"
          strokeWidth={2.5}
          strokeLinejoin="round"
        >
          <title>Cumulative cost with solar (payments + remaining utility)</title>
        </path>

        {/* Endpoint labels — right side */}
        <text
          x={xPos(YEARS - 1) + 6}
          y={yPos(withoutSolar[YEARS - 1]) + 4}
          fontSize={11}
          fill="#ef4444"
          fontWeight="600"
        >
          {formatK(withoutSolar[YEARS - 1])}
        </text>
        <text
          x={xPos(YEARS - 1) + 6}
          y={yPos(withSolar[YEARS - 1]) + 4}
          fontSize={11}
          fill="#16a34a"
          fontWeight="600"
        >
          {formatK(withSolar[YEARS - 1])}
        </text>

        {/* Break-even vertical marker */}
        {crossoverX !== null && crossoverYear !== null && crossoverYear > 1 && crossoverYear < YEARS ? (
          <>
            {/* Dashed vertical line */}
            <line
              x1={crossoverX}
              y1={PAD.top}
              x2={crossoverX}
              y2={PAD.top + CHART_H}
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="5,3"
            />
            {/* Dot at crossover point */}
            <circle
              cx={crossoverX}
              cy={yPos(crossoverYVal)}
              r={4}
              fill="#6366f1"
            />
            {/* Label above the line */}
            <rect
              x={labelOnRight ? crossoverX + 4 : crossoverX - 80}
              y={PAD.top - 28}
              width={76}
              height={22}
              rx={4}
              fill="#eef2ff"
              stroke="#a5b4fc"
              strokeWidth={1}
            />
            <text
              x={labelOnRight ? crossoverX + 42 : crossoverX - 42}
              y={PAD.top - 13}
              textAnchor="middle"
              fontSize={9}
              fill="#4f46e5"
              fontWeight="700"
            >
              Break-Even: Yr {crossoverYear}
            </text>
          </>
        ) : null}

        {/* Cumulative savings annotation at Year 25 midpoint */}
        {savings25 > 0 && (() => {
          const midY = (yPos(withoutSolar[YEARS - 1]) + yPos(withSolar[YEARS - 1])) / 2;
          const arrowX = xPos(YEARS - 1) - 10;
          return (
            <>
              <text
                x={arrowX - 4}
                y={midY - 6}
                textAnchor="end"
                fontSize={10}
                fill="#15803d"
                fontWeight="700"
              >
                {formatK(savings25)}
              </text>
              <text
                x={arrowX - 4}
                y={midY + 8}
                textAnchor="end"
                fontSize={8}
                fill="#16a34a"
              >
                saved
              </text>
              {/* Bracket line */}
              <line
                x1={arrowX}
                y1={yPos(withoutSolar[YEARS - 1])}
                x2={arrowX}
                y2={yPos(withSolar[YEARS - 1])}
                stroke="#16a34a"
                strokeWidth={1}
                strokeDasharray="3,2"
              />
            </>
          );
        })()}

        {/* Y-axis label */}
        <text
          x={12}
          y={PAD.top + CHART_H / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#94a3b8"
          transform={`rotate(-90, 12, ${PAD.top + CHART_H / 2})`}
        >
          Cumulative Cost ($)
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 bg-red-500" />
          <span className="text-xs text-slate-600">Without Solar</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 bg-green-600" />
          <span className="text-xs text-slate-600">With Solar</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 bg-green-100 border border-green-300 rounded-sm" />
          <span className="text-xs text-slate-500">Savings Region</span>
        </div>
        {savings25 > 0 ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-bold text-green-700">
              25-yr advantage: {formatK(savings25)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}