'use client';

/**
 * MetricPill — Compact inline metric display with optional ConfidenceBadge.
 *
 * Two visual patterns from the UX audit (CC-2):
 *   1. MetricCard (primary) — for standalone important numbers (already exists)
 *   2. MetricPill (inline)  — for contextual metrics within a section
 *
 * This implements pattern #2: a compact bg-slate-800/60 pill with
 * icon + value + label + optional ConfidenceBadge.
 *
 * Psychology basis: Gestalt Similarity — consistent pill pattern lets
 * users instantly recognize "this is a metric" without re-learning
 * the visual grammar on each page.
 */

import React from 'react';
import { ConfidenceBadge, ConfidenceLevel, ConfidenceSource } from '@/components/recommend/ConfidenceBadge';

type PillColor = 'amber' | 'emerald' | 'blue' | 'red' | 'teal' | 'purple' | 'slate';

interface MetricPillProps {
  /** Display label (e.g. "Annual kWh") */
  label: string;
  /** Display value (e.g. "12,400") */
  value: string | number;
  /** Unit suffix (e.g. "kWh", "$") — displayed after value */
  unit?: string;
  /** Color accent */
  color?: PillColor;
  /** Optional icon */
  icon?: React.ReactNode;
  /** Optional confidence level — shows ConfidenceBadge when provided */
  confidence?: ConfidenceLevel;
  /** Optional confidence source — required when confidence is provided */
  confidenceSource?: ConfidenceSource;
  /** Optional confidence detail text */
  confidenceDetail?: string;
  /** Whether user overrode the computed value */
  overridden?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const PILL_COLORS: Record<PillColor, {
  iconBg: string;
  iconColor: string;
  valueColor: string;
}> = {
  amber:   { iconBg: 'bg-amber-500/15',   iconColor: 'text-amber-400',   valueColor: 'text-amber-400' },
  emerald: { iconBg: 'bg-emerald-500/15',  iconColor: 'text-emerald-400', valueColor: 'text-emerald-400' },
  blue:    { iconBg: 'bg-blue-500/15',     iconColor: 'text-blue-400',    valueColor: 'text-blue-400' },
  red:     { iconBg: 'bg-red-500/15',      iconColor: 'text-red-400',    valueColor: 'text-red-400' },
  teal:    { iconBg: 'bg-teal-500/15',     iconColor: 'text-teal-400',   valueColor: 'text-teal-400' },
  purple:  { iconBg: 'bg-purple-500/15',   iconColor: 'text-purple-400', valueColor: 'text-purple-400' },
  slate:   { iconBg: 'bg-slate-700/40',     iconColor: 'text-slate-400',  valueColor: 'text-white' },
};

export function MetricPill({
  label,
  value,
  unit,
  color = 'slate',
  icon,
  confidence,
  confidenceSource,
  confidenceDetail,
  overridden = false,
  className = '',
}: MetricPillProps) {
  const cfg = PILL_COLORS[color];
  const hasConfidence = confidence && confidenceSource;

  return (
    <div className={`inline-flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 ${className}`}>
      {icon ? (
        <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${cfg.iconBg}`}>
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold leading-tight">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-black tabular-nums leading-tight ${cfg.valueColor}`}>
            {value}
            {unit ? <span className="text-xs font-normal text-slate-400 ml-0.5">{unit}</span> : null}
          </span>
          {hasConfidence ? (
            <ConfidenceBadge
              confidence={confidence}
              source={confidenceSource}
              detail={confidenceDetail}
              size="xs"
              overridden={overridden}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MetricPill;
