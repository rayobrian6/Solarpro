/**
 * components/engineering/ControlModeBanner.tsx
 *
 * SolarPro v61 — Control Mode selector + per-field lock indicators.
 *
 * Shows the current control mode (Auto / Guided / Manual) with a mode
 * selector and a row of per-field lock toggles.
 *
 * Purely presentational — all state lives in the parent (engineering page).
 */

'use client';

import React from 'react';
import type { ControlMode, SystemConfigLocks } from '@/types';
import { CONTROL_MODE_LABELS, CONTROL_MODE_DESCRIPTIONS, FIELD_LABELS, lockField, unlockField } from '@/lib/solardog/controlMode';
import type { LockableField } from '@/lib/solardog/controlMode';

// ─── Props ────────────────────────────────────────────────────────────────────
interface ControlModeBannerProps {
  mode:      ControlMode;
  locks:     SystemConfigLocks;
  onModeChange:  (mode: ControlMode) => void;
  onLocksChange: (locks: SystemConfigLocks) => void;
  /** If true, collapse to a compact single-line summary */
  compact?: boolean;
}

// ─── Mode colors ──────────────────────────────────────────────────────────────
const MODE_STYLES: Record<ControlMode, { bg: string; border: string; text: string; dot: string }> = {
  auto:    { bg: 'bg-emerald-950/40',  border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  guided:  { bg: 'bg-amber-950/40',    border: 'border-amber-500/30',   text: 'text-amber-400',   dot: 'bg-amber-400'   },
  manual:  { bg: 'bg-rose-950/40',     border: 'border-rose-500/30',    text: 'text-rose-400',    dot: 'bg-rose-400'    },
};

const MODE_ICONS: Record<ControlMode, string> = {
  auto:   '🟢',
  guided: '🟡',
  manual: '🔴',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function ControlModeBanner({
  mode,
  locks,
  onModeChange,
  onLocksChange,
  compact = false,
}: ControlModeBannerProps) {
  const styles = MODE_STYLES[mode];

  const handleLockToggle = (field: LockableField) => {
    const newLocks = locks[field]
      ? unlockField(locks, field)
      : lockField(locks, field);
    onLocksChange(newLocks);
  };

  const lockedCount = Object.values(locks).filter(Boolean).length;

  return (
    <div className={`rounded-lg border ${styles.bg} ${styles.border} px-4 py-3 mb-4`}>
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${styles.dot} flex-shrink-0`} />
          <span className={`text-sm font-semibold ${styles.text}`}>
            {MODE_ICONS[mode]} {CONTROL_MODE_LABELS[mode]} Mode
          </span>
          {lockedCount > 0 && (
            <span className="text-xs text-slate-400 ml-1">
              · {lockedCount} field{lockedCount !== 1 ? 's' : ''} locked
            </span>
          )}
        </div>

        {/* Mode selector buttons */}
        <div className="flex items-center gap-1">
          {(['auto', 'guided', 'manual'] as ControlMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all border ${
                mode === m
                  ? `${MODE_STYLES[m].bg} ${MODE_STYLES[m].border} ${MODE_STYLES[m].text} ring-1 ring-inset ring-current`
                  : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-300 hover:border-slate-600'
              }`}
              title={CONTROL_MODE_DESCRIPTIONS[m]}
            >
              {MODE_ICONS[m]} {CONTROL_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Description (hide in compact mode) ── */}
      {!compact && (
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          {CONTROL_MODE_DESCRIPTIONS[mode]}
        </p>
      )}

      {/* ── Field lock toggles ── */}
      {!compact && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-xs text-slate-500">Field locks:</span>
          {(Object.keys(locks) as LockableField[]).map((field) => {
            const isLocked = locks[field];
            return (
              <button
                key={field}
                onClick={() => handleLockToggle(field)}
                title={isLocked ? `Unlock ${FIELD_LABELS[field]} — allow auto-config` : `Lock ${FIELD_LABELS[field]} — prevent auto-config overrides`}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all ${
                  isLocked
                    ? 'bg-rose-950/60 border-rose-500/40 text-rose-300 hover:border-rose-400'
                    : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-300 hover:border-slate-600'
                }`}
              >
                <span>{isLocked ? '🔒' : '🔓'}</span>
                <span>{FIELD_LABELS[field]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}