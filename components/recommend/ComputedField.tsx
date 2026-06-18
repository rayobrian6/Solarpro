'use client';

/**
 * ============================================================
 * ComputedField.tsx — Phase 2 UX Reusable Component
 *
 * A form field that displays a computed/recommended value with
 * confidence indicator, derivation info, and an expert override
 * mechanism. The user can always override — this is NOT a
 * locked field, just a "smart default" with provenance.
 *
 * Three states:
 *   1. Computed — shows computed value + confidence badge + derivation
 *   2. Overridden — shows user's manual value, muted original source
 *   3. Empty — no computation available, shows placeholder
 *
 * HARD RULES:
 *   - NEVER lock the field — user can always override
 *   - Confidence source must always be visible
 *   - When overridden, show what the original computed value was
 *   - Clear "undo override" action to restore computed value
 *   - Compact design — fits in existing form layouts
 * ============================================================
 */

import React, { useState, useCallback } from 'react';
import { Pencil, RotateCcw, Info, Sparkles } from 'lucide-react';
import { ConfidenceBadge, type ConfidenceLevel, type ConfidenceSource } from './ConfidenceBadge';

// ── Types ────────────────────────────────────────────────────
export interface ComputedFieldValue {
  /** The computed/recommended value */
  value: string | number;
  /** Confidence level of the computation */
  confidence: ConfidenceLevel;
  /** Source of the computation */
  source: ConfidenceSource;
  /** Optional detail about derivation (e.g. "From 12 months of bills") */
  derivation?: string;
  /** Optional NEC/code reference (e.g. "NEC 705.12(B)") */
  necReference?: string;
  /** Unit label (e.g. "kWh", "°", "$/kWh", "ft") */
  unit?: string;
}

export interface ComputedFieldProps {
  /** Field label */
  label: string;
  /** The computed value (null = no computation available) */
  computed: ComputedFieldValue | null;
  /** Current value (controlled — may differ from computed if overridden) */
  value: string | number;
  /** Change handler */
  onChange: (value: string) => void;
  /** Input type for formatting */
  type?: 'text' | 'number';
  /** Placeholder when empty */
  placeholder?: string;
  /** Whether the field is disabled entirely */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Optional min/max for number inputs */
  min?: number;
  max?: number;
  /** Step for number inputs */
  step?: number;
  /** Compact mode — hides derivation, shows badge inline */
  compact?: boolean;
  /** Test ID */
  'data-testid'?: string;
}

// ── Component ────────────────────────────────────────────────
export function ComputedField({
  label,
  computed,
  value,
  onChange,
  type = 'number',
  placeholder = '—',
  disabled = false,
  className = '',
  min,
  max,
  step,
  compact = false,
  'data-testid': testId,
}: ComputedFieldProps) {
  const [showDerivation, setShowDerivation] = useState(false);
  const isOverridden = computed !== null && String(value) !== String(computed.value);
  const hasComputedValue = computed !== null;

  const handleOverride = useCallback(() => {
    // Focus the input and let the user type
    const input = document.querySelector<HTMLInputElement>(
      `[data-testid="${testId}-input"]`
    );
    input?.focus();
    input?.select();
  }, [testId]);

  const handleRestore = useCallback(() => {
    if (computed) {
      onChange(String(computed.value));
    }
  }, [computed, onChange]);

  return (
    <div className={`group ${className}`} data-testid={testId}>
      {/* Label row with confidence badge */}
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
          {label}
          {hasComputedValue ? (
            <ConfidenceBadge
              confidence={computed.confidence}
              source={computed.source}
              detail={computed.derivation}
              size="xs"
              overridden={isOverridden}
            />
          ) : null}
        </label>

        {/* Override/restore actions */}
        {hasComputedValue && !isOverridden && !disabled ? (
          <button
            type="button"
            onClick={handleOverride}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
            title="Override computed value"
          >
            <Pencil size={12} />
          </button>
        ) : null}
        {isOverridden && !disabled ? (
          <button
            type="button"
            onClick={handleRestore}
            className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
            title={`Restore computed value: ${computed.value}${computed.unit || ''}`}
            data-testid={`${testId}-restore`}
          >
            <RotateCcw size={10} />
            <span>Restore</span>
          </button>
        ) : null}
      </div>

      {/* Input field with computed value styling */}
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          data-testid={`${testId}-input`}
          className={`
            w-full rounded px-3 py-1.5 text-sm transition-colors
            ${isOverridden
              ? 'bg-amber-950/30 border border-amber-500/30 text-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30'
              : hasComputedValue
                ? 'bg-emerald-950/20 border border-emerald-500/20 text-emerald-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30'
                : 'bg-slate-800/60 border border-slate-700/50 text-slate-200 focus:border-slate-500 focus:ring-1 focus:ring-slate-500/30'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
            outline-none
          `}
        />

        {/* Computed value sparkles indicator */}
        {hasComputedValue && !isOverridden ? (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-400">
            <Sparkles size={12} />
          </span>
        ) : null}

        {/* Unit suffix */}
        {computed?.unit ? (
          <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {computed.unit}
          </span>
        ) : null}
      </div>

      {/* Derivation / NEC reference — expandable */}
      {hasComputedValue && !compact ? (
        <div className="mt-1">
          {computed.derivation ? (
            <button
              type="button"
              onClick={() => setShowDerivation(!showDerivation)}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-400 transition-colors"
            >
              <Info size={10} />
              {showDerivation ? 'Hide details' : 'How was this computed?'}
            </button>
          ) : null}
          {showDerivation && computed.derivation ? (
            <p className="text-[10px] text-slate-500 mt-0.5 pl-3 border-l border-slate-700/40">
              {computed.derivation}
              {computed.necReference ? (
                <span className="block mt-0.5 text-slate-600">
                  Ref: {computed.necReference}
                </span>
              ) : null}
            </p>
          ) : null}
          {!computed.derivation && computed.necReference ? (
            <p className="text-[10px] text-slate-600">
              Ref: {computed.necReference}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Overridden warning */}
      {isOverridden ? (
        <p className="text-[10px] text-amber-500/70 mt-1">
          Custom value — computed was {String(computed.value)}{computed.unit ? ` ${computed.unit}` : ''}
        </p>
      ) : null}
    </div>
  );
}

export default ComputedField;
