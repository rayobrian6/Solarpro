'use client';

/**
 * ============================================================
 * RecommendationCard.tsx — Phase 2 UX Reusable Component
 *
 * A card that presents a computed recommendation alongside the
 * current value, allowing the user to Apply (accept) or
 * Dismiss (keep current). This is the "Recommend + Approve"
 * tier of the three-tier automation framework.
 *
 * Used for:
 *   - System size recommendation (PVWatts)
 *   - Utility rate suggestion
 *   - Tilt/azimuth optimization
 *   - Interconnection method (NEC 705.12)
 *   - System type inference
 *   - Panel selection default
 *
 * Pattern follows SizingRecommendation.tsx and SuggestionCard.tsx
 * but generalized for any field/value pair.
 *
 * HARD RULES:
 *   - NEVER auto-apply without explicit user action
 *   - Apply must overwrite cleanly
 *   - Dismiss preserves current value
 *   - Confidence source must always be visible
 *   - "Why?" derivation must be accessible
 * ============================================================
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  X,
  Zap,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
} from 'lucide-react';
import { ConfidenceBadge, type ConfidenceLevel, type ConfidenceSource } from './ConfidenceBadge';

// ── Types ────────────────────────────────────────────────────
export interface RecommendationValue {
  /** The recommended value (displayed as string) */
  display: string;
  /** The raw value to apply (could be number, string, object) */
  raw: unknown;
  /** Confidence level */
  confidence: ConfidenceLevel;
  /** Source of the recommendation */
  source: ConfidenceSource;
  /** Unit label (e.g. "kW", "°", "$/kWh") */
  unit?: string;
}

export interface RecommendationCardProps {
  /** Title of the recommendation (e.g. "System Size", "Utility Rate") */
  title: string;
  /** Current value display string */
  currentDisplay: string;
  /** Current raw value */
  currentRaw: unknown;
  /** Recommended value info */
  recommended: RecommendationValue;
  /** Brief reason for the recommendation */
  reason: string;
  /** Detailed derivation explanation (shown on expand) */
  derivation?: string;
  /** NEC/code reference if applicable */
  necReference?: string;
  /** Callback to apply the recommendation */
  onApply: (rawValue: unknown) => void;
  /** Callback to dismiss the recommendation */
  onDismiss: () => void;
  /** Whether the card is initially expanded */
  defaultExpanded?: boolean;
  /** Whether to show in "inline" compact mode vs full card */
  variant?: 'card' | 'inline';
  /** Additional CSS classes */
  className?: string;
  /** Test ID */
  'data-testid'?: string;
}

// ── Component ────────────────────────────────────────────────
export function RecommendationCard({
  title,
  currentDisplay,
  currentRaw,
  recommended,
  reason,
  derivation,
  necReference,
  onApply,
  onDismiss,
  defaultExpanded = false,
  variant = 'card',
  className = '',
  'data-testid': testId,
}: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Check if current and recommended match
  const isMatch = String(currentRaw) === String(recommended.raw);
  const isHighConfidence = recommended.confidence === 'high';

  // ── Inline variant ──
  if (variant === 'inline') {
    return (
      <div
        className={`flex items-center gap-2 text-xs ${isMatch ? 'text-emerald-400' : 'text-amber-400'} ${className}`}
        data-testid={testId}
      >
        <ConfidenceBadge
          confidence={recommended.confidence}
          source={recommended.source}
          size="xs"
        />
        {isMatch ? (
          <span className="text-emerald-300 flex items-center gap-1">
            <CheckCircle2 size={10} />
            {title}: {currentDisplay} ✓
          </span>
        ) : (
          <>
            <span className="text-slate-400 line-through">{currentDisplay}</span>
            <span className="text-emerald-300 font-medium">
              → {recommended.display}{recommended.unit ? ` ${recommended.unit}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onApply(recommended.raw)}
              className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-600/40 hover:bg-emerald-500/60 text-emerald-200 transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => { setDismissed(true); onDismiss(); }}
              className="text-slate-600 hover:text-slate-400"
            >
              <X size={10} />
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Full card variant ──
  return (
    <div
      className={`rounded-lg border-2 p-4 ${
        isMatch
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : isHighConfidence
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-amber-500/20 bg-amber-950/20'
      } ${className}`}
      data-testid={testId}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {isMatch ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <Sparkles size={16} className="text-amber-400" />
          )}
          <h4 className="text-sm font-bold text-white">
            {isMatch ? `${title} Matches` : `${title} Recommendation`}
          </h4>
          <ConfidenceBadge
            confidence={recommended.confidence}
            source={recommended.source}
            size="xs"
          />
        </div>
        <button
          type="button"
          onClick={() => { setDismissed(true); onDismiss(); }}
          className="text-slate-600 hover:text-slate-400 transition-colors"
          title="Dismiss recommendation"
          data-testid={`${testId}-dismiss`}
        >
          <X size={14} />
        </button>
      </div>

      {/* Current vs Recommended — side by side */}
      {!isMatch ? (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded bg-slate-800/60 border border-slate-700/50 px-3 py-2">
            <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">Current</p>
            <p className="text-slate-300 font-medium text-sm">
              {currentDisplay}
            </p>
          </div>
          <div className="rounded bg-emerald-950/40 border border-emerald-500/30 px-3 py-2">
            <p className="text-emerald-600 text-[10px] uppercase tracking-wide mb-0.5">Recommended</p>
            <p className="text-emerald-300 font-medium text-sm">
              {recommended.display}{recommended.unit ? ` ${recommended.unit}` : ''}
            </p>
          </div>
        </div>
      ) : null}

      {/* Match state display */}
      {isMatch ? (
        <div className="mb-3 text-sm text-emerald-300 flex items-center gap-2">
          <span className="font-medium">{currentDisplay}</span>
          {recommended.unit && <span className="text-emerald-400">{recommended.unit}</span>}
        </div>
      ) : null}

      {/* Reason text */}
      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
        {reason}
      </p>

      {/* Expandable derivation */}
      {derivation ? (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Hide details' : 'How was this computed?'}
          </button>
          {expanded ? (
            <div className="mt-1.5 px-3 py-2 rounded bg-slate-900/60 border-l-2 border-slate-700/60 text-[11px] text-slate-400 leading-relaxed">
              {derivation}
              {necReference ? (
                <span className="block mt-1 text-slate-600 font-mono">
                  Ref: {necReference}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* NEC reference when no derivation */}
      {!derivation && necReference ? (
        <p className="text-[10px] text-slate-600 mb-3 font-mono">
          Ref: {necReference}
        </p>
      ) : null}

      {/* Action buttons — only when mismatch */}
      {!isMatch ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApply(recommended.raw)}
            className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center justify-center gap-1.5"
            data-testid={`${testId}-apply`}
          >
            <Zap size={12} />
            Apply Recommendation
          </button>
          <button
            type="button"
            onClick={() => { setDismissed(true); onDismiss(); }}
            className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 hover:border-slate-500 transition-colors"
            data-testid={`${testId}-keep`}
          >
            Keep Current
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default RecommendationCard;
