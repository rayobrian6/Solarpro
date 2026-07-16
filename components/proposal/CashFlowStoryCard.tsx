/**
 * components/proposal/CashFlowStoryCard.tsx
 *
 * v50.x — Cash-Flow Story Card
 *
 * UI-only storytelling card that sits at the top of the proposal screen and
 * condenses the 25-year financial outlook into four readable numbers plus the
 * existing UtilityCostProjectionChart inline. Inspired by OpenSolar 3.0's
 * Cash Flow view.
 *
 * Data model: pulls CanonicalUtility / CanonicalFinancial / CanonicalTruth25yr
 * directly from the proposal pipeline (built by buildCanonicalProposal).
 * Zero new calculations — every number on this card is already precomputed
 * by the canonical model and surfaced here as a presentation layer.
 *
 * Styling stays in the Solarpro dark-slate + amber + emerald palette used
 * throughout the proposal page. No new dependencies, no light theme, no
 * emoji.
 */

'use client';

import React from 'react';
import { DollarSign, TrendingUp, CheckCircle, Zap } from 'lucide-react';
import type {
  CanonicalUtility,
  CanonicalFinancial,
  CanonicalTruth25yr,
} from '@/lib/proposal/canonicalProposal';
import { UtilityCostProjectionChart } from './UtilityCostProjectionChart';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CashFlowStoryCardProps {
  utility: CanonicalUtility;
  financial: CanonicalFinancial;
  truth25yr: CanonicalTruth25yr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash-Flow Story Card
// ─────────────────────────────────────────────────────────────────────────────

export function CashFlowStoryCard({
  utility,
  financial,
  truth25yr,
}: CashFlowStoryCardProps) {
  // All four headline numbers come from the canonical model — no recompute.
  const upfront    = financial.systemCost;     // gross / pre-incentive
  const taxCredit  = financial.itcAmount;       // federal ITC $
  const net        = financial.netCost;         // after ITC
  const paybackYr  = financial.paybackYears;    // years to break-even

  // Fallback: if yearlyFlow is empty (shouldn't happen in prod), show only the
  // four numbers and skip the chart — keeps the card useful even defensively.
  const hasChart = (truth25yr.yearlyFlow?.length ?? 0) > 0;

  return (
    <div
      className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5"
      data-block-id="cash-flow-story"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white text-base flex items-center gap-2">
          <DollarSign size={16} className="text-amber-400" />
          Your Cash-Flow Story
        </h3>
        <span className="text-xs text-slate-500">
          25-year projection · canonical data
        </span>
      </div>

      {/* Four headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {/* Upfront cost */}
        <div className="bg-slate-900/50 border border-slate-700/40 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Zap size={11} />
            Upfront cost
          </div>
          <div className="text-lg font-bold text-slate-100">
            {formatUSD(upfront)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            gross system price
          </div>
        </div>

        {/* Tax credit (30%) — negative line, emerald */}
        <div className="bg-slate-900/50 border border-emerald-700/30 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-1">
            <TrendingUp size={11} />
            Tax credit ({(financial.itcRate).toFixed(0)}%)
          </div>
          <div className="text-lg font-bold text-emerald-400">
            −{formatUSD(taxCredit)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            federal ITC applied
          </div>
        </div>

        {/* Net cost — amber, prominent */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs text-amber-300 mb-1">
            <DollarSign size={11} />
            Net cost
          </div>
          <div className="text-2xl font-black text-amber-400">
            {formatUSD(net)}
          </div>
          <div className="text-[10px] text-amber-300/70 mt-0.5">
            after incentives
          </div>
        </div>

        {/* Payback period — emerald badge */}
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300 mb-1">
            <CheckCircle size={11} />
            Payback period
          </div>
          {paybackYr > 0 && isFinite(paybackYr) ? (
            <div className="text-lg font-bold text-emerald-400">
              Year {Math.ceil(paybackYr)}
            </div>
          ) : (
            <div className="text-lg font-bold text-slate-500">—</div>
          )}
          <div className="text-[10px] text-emerald-300/70 mt-0.5">
            {paybackYr > 0 && isFinite(paybackYr)
              ? 'pays for itself'
              : 'see 25-yr chart'}
          </div>
        </div>
      </div>

      {/* Existing chart, reused inline (no rewrite) */}
      {hasChart ? (
        <div className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={13} className="text-emerald-400" />
            <span className="text-xs font-semibold text-slate-300">
              25-year cost comparison
            </span>
            <span className="text-[10px] text-slate-500 ml-auto">
              green = with solar · red = utility only
            </span>
          </div>
          <UtilityCostProjectionChart
            utility={utility}
            financial={financial}
            truth25yr={truth25yr}
          />
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
            The green line shows your total cost with solar. The red line
            shows what you&apos;d pay staying on grid power with your
            utility&apos;s {(utility.escalationRate * 100).toFixed(1)}%
            annual rate increase.
          </p>
        </div>
      ) : null}
    </div>
  );
}