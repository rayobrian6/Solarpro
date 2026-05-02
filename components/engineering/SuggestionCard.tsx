/**
 * components/engineering/SuggestionCard.tsx
 *
 * SolarPro v61 — Guided Mode suggestion card.
 *
 * Shown when the auto-config engine wants to override a locked/guided field.
 * User can accept (apply the change) or keep their selection (lock the field).
 *
 * Purely presentational — callbacks are provided by the engineering page.
 */

'use client';

import React from 'react';
import type { LockableField } from '@/lib/solardog/controlMode';
import { FIELD_LABELS } from '@/lib/solardog/controlMode';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PendingSuggestion {
  /** The field the system wants to change */
  field: LockableField;
  /** Human-readable description of the current value */
  currentValue: string;
  /** Human-readable description of the recommended value */
  recommendedValue: string;
  /** Short reason why the system recommends this change */
  reason: string;
  /** Callback to apply the suggestion */
  onAccept: () => void;
  /** Callback to keep the current selection (and lock the field) */
  onKeep: () => void;
}

interface SuggestionCardProps {
  suggestion: PendingSuggestion;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SuggestionCard({ suggestion }: SuggestionCardProps) {
  const { field, currentValue, recommendedValue, reason, onAccept, onKeep } = suggestion;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 mb-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <span className="text-amber-400 text-sm flex-shrink-0 mt-0.5">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">
            {FIELD_LABELS[field]} Suggestion
          </p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {reason}
          </p>
        </div>
      </div>

      {/* Current vs Recommended */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-800/60 border border-slate-700/50 px-3 py-2">
          <p className="text-slate-500 mb-0.5">Your selection</p>
          <p className="text-slate-300 font-medium truncate">{currentValue}</p>
        </div>
        <div className="rounded bg-emerald-950/40 border border-emerald-500/30 px-3 py-2">
          <p className="text-emerald-600 mb-0.5">Recommended</p>
          <p className="text-emerald-300 font-medium truncate">{recommendedValue}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onAccept}
          className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          ✓ Accept Suggestion
        </button>
        <button
          onClick={onKeep}
          className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 hover:border-slate-500 transition-colors"
        >
          🔒 Keep My Selection
        </button>
      </div>
    </div>
  );
}