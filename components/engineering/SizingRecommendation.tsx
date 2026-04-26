'use client';

/**
 * ============================================================
 * SizingRecommendation.tsx — Phase 11 UI wiring
 *
 * Shows a non-intrusive recommendation panel when the user's
 * current inverter/string/battery config differs from what the
 * brand-driven sizing engine would recommend for the current
 * system type + panel count.
 *
 * HARD RULES:
 *   - NO silent override. Only suggest + allow apply.
 *   - Apply must overwrite cleanly (no partial mutations).
 *   - "Auto-apply" is opt-in, default OFF, user-controlled.
 * ============================================================
 */

import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Zap, Battery } from 'lucide-react';
import type { SystemSizingResult } from '@/lib/system/sizingEngine';
import {
  normalizeInverterState,
  formatNormalizedInverterSummary,
} from '@/lib/system/normalizedInverter';
import {
  diffCurrentVsRecommended,
  type CurrentConfigSnapshot,
} from './sizingDiff';
// Phase 13.8.1 — apply UI severity mapping to sizing-engine warnings.
import { mapIssueToUI } from '@/lib/ui/severityMapper';

// Re-export the pure helpers for consumers that imported from this file.
export { diffCurrentVsRecommended, detectStringLayoutMismatch } from './sizingDiff';
export type { CurrentConfigSnapshot, RecommendationDiff } from './sizingDiff';

interface SizingRecommendationProps {
  sizing: SystemSizingResult | null;
  current: CurrentConfigSnapshot;
  autoApply: boolean;
  onAutoApplyChange: (next: boolean) => void;
  onApply: () => void;
  /** Hide the whole panel (use when the page has no inverters yet). */
  hidden?: boolean;
  /**
   * Optional — panel count source metadata. When provided AND indicates a
   * mismatch with config (e.g. CAD says 36 but inverter cards show 10),
   * a prominent stale-state warning is surfaced.
   */
  panelCountSource?: {
    value: number;
    source: 'cad-panels' | 'cad-total' | 'system-definition' | 'config-fallback' | 'none';
    mismatchedWithConfig: boolean;
    configValue: number;
  };
}

export function SizingRecommendation({
  sizing,
  current,
  autoApply,
  onAutoApplyChange,
  onApply,
  hidden,
  panelCountSource,
}: SizingRecommendationProps) {
  const diff = useMemo(
    () => (sizing ? diffCurrentVsRecommended(current, sizing) : null),
    [sizing, current],
  );

  // Phase 13.8.1 — map engine warnings to UI severity before counting/rendering.
  // Must be called before any early return to satisfy React hooks rules.
  const mappedWarnings = useMemo(
    () => (sizing ? sizing.warnings.map(w => ({ mapped: mapIssueToUI(w), original: w })) : []),
    [sizing],
  );

  if (hidden || !sizing || !diff) return null;

  const hasMismatch = !diff.matches;
  const warningCount = mappedWarnings.filter(m => m.mapped.severity === 'warning').length;
  const errorCount   = mappedWarnings.filter(m => m.mapped.severity === 'error').length;
  const infoCount    = mappedWarnings.filter(m => m.mapped.severity === 'info').length;

  return (
    <div
      className={`card p-4 border-2 ${
        hasMismatch
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-emerald-500/30 bg-emerald-500/5'
      }`}
      data-testid="sizing-recommendation"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {hasMismatch ? (
            <AlertTriangle size={16} className="text-amber-400" />
          ) : (
            <CheckCircle2 size={16} className="text-emerald-400" />
          )}
          <h4 className="text-sm font-bold text-white">
            {hasMismatch
              ? 'System Mismatch Detected'
              : 'System Matches Recommendation'}
          </h4>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoApply}
            onChange={e => onAutoApplyChange(e.target.checked)}
            className="accent-amber-500"
          />
          Auto-apply recommendations
        </label>
      </div>

      {/* Panel-count source of truth banner — surfaces stale config state */}
      {panelCountSource && panelCountSource.mismatchedWithConfig && (
        <div
          className="mb-3 px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200"
          data-testid="panel-count-source-warning"
        >
          <div className="font-bold text-rose-300 mb-0.5">
            Panel Count Source: {panelCountSource.source}
          </div>
          System has <span className="font-bold text-white">{panelCountSource.value} panels</span>{' '}
          (from {panelCountSource.source === 'cad-panels' ? 'CAD layout' : panelCountSource.source}),
          but inverter config currently reflects{' '}
          <span className="font-bold text-white">{panelCountSource.configValue}</span>. Sizing
          recommendations below use the authoritative value ({panelCountSource.value}). Click
          Apply to rebuild strings.
        </div>
      )}
      {panelCountSource && !panelCountSource.mismatchedWithConfig && panelCountSource.source !== 'config-fallback' && panelCountSource.source !== 'none' && (
        <div
          className="mb-3 px-3 py-1.5 rounded border border-slate-700/40 bg-slate-800/40 text-[11px] text-slate-400"
          data-testid="panel-count-source-ok"
        >
          Panel count: <span className="text-white font-semibold">{panelCountSource.value}</span> from {panelCountSource.source} ✓
        </div>
      )}

      {/*
        v47.408 — Dedicated string-layout drift banner.
        When the current per-string panel distribution differs from the
        sizing recommendation, the Compliance tab (which evaluates the
        CURRENT config, not the recommendation) can produce misleading
        results — especially on optimizer topologies where a stale layout
        can cascade into false MPPT_CURRENT_EXCEEDED / DC-AC warnings.
        This banner gives the user a loud, actionable signal independent
        of the smaller "Differences from recommended" table below.
      */}
      {diff.stringLayoutMismatch && (
        <div
          className="mb-3 px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200"
          data-testid="string-layout-drift-warning"
        >
          <div className="font-bold text-rose-300 mb-0.5 flex items-center gap-1">
            <AlertTriangle size={12} />
            Config layout differs from Sizing Recommendation
          </div>
          <div>
            {sizing.topology === 'micro' ? (
              <>
                Current panel count doesn't match the recommendation.
                Compliance & electrical calculations below use the current
                config and may not reflect an optimal layout.
              </>
            ) : (
              <>
                Current strings:{' '}
                <span className="font-bold text-white">
                  {current.stringPanelCounts.length
                    ? current.stringPanelCounts.join('/')
                    : '(none)'}
                </span>
                {' '}→ Recommended:{' '}
                <span className="font-bold text-white">
                  {sizing.strings.map(s => s.panelCount).join('/')}
                </span>
                . Compliance & electrical calculations below evaluate the
                CURRENT layout — not the recommendation — so any MPPT /
                current / DC-AC warnings may reflect the stale config rather
                than a real design issue.
                {sizing.topology === 'optimizer' && (
                  <>
                    {' '}
                    This is especially important for optimizer systems where
                    string current is regulated by the optimizer output (not
                    panel Isc).
                  </>
                )}
              </>
            )}
            {' '}
            <span className="font-semibold text-rose-100">
              Click &ldquo;Apply Recommended Configuration&rdquo; below to sync.
            </span>
          </div>
        </div>
      )}

      {/* Brand / topology summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-400 uppercase tracking-wide text-[10px]">Brand</div>
          <div className="text-white font-semibold">{sizing.brand.displayName}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2">
          <div className="text-slate-400 uppercase tracking-wide text-[10px]">Topology</div>
          <div className="text-white font-semibold uppercase">{sizing.topology}</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2" data-testid="sizing-inverters-card">
          <div className="text-slate-400 uppercase tracking-wide text-[10px]">Inverters</div>
          <div className="text-white font-semibold" data-testid="sizing-inverters-summary">
            {/*
              v47.370 (Phase 12.5): Render the normalized inverter summary
              instead of the raw `sizing.inverterCount`. For micro this now
              shows e.g. "36 microinverters • 1 system group" so users can
              clearly see physical units vs logical grouping. For other
              topologies this degrades to e.g. "3 string inverters".
            */}
            {formatNormalizedInverterSummary(
              normalizeInverterState({ sizingResult: sizing }),
            )}
            {sizing.topology !== 'micro' && sizing.strings.length > 0 && (
              <span className="text-slate-400 font-normal">
                {' '}× {sizing.strings.length} strings
              </span>
            )}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded p-2 flex items-center gap-1">
          {sizing.battery ? (
            <>
              <Battery size={12} className="text-emerald-400" />
              <div>
                <div className="text-slate-400 uppercase tracking-wide text-[10px]">Battery</div>
                <div className="text-white font-semibold">{sizing.battery.installedKwh} kWh</div>
              </div>
            </>
          ) : (
            <>
              <Battery size={12} className="text-slate-500" />
              <div>
                <div className="text-slate-400 uppercase tracking-wide text-[10px]">Battery</div>
                <div className="text-slate-500">—</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mismatch details */}
      {hasMismatch && (
        <div className="space-y-1 mb-3">
          <div className="text-xs text-slate-300 font-semibold mb-1">
            Differences from recommended:
          </div>
          {diff.mismatches.map((m, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs bg-slate-900/40 rounded px-2 py-1"
            >
              <span className="text-slate-400">{m.field}</span>
              <span className="text-slate-300">
                <span className="text-red-400 line-through mr-2">{String(m.current)}</span>
                <span className="text-emerald-400">→ {String(m.recommended)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Engine warnings — Phase 13.8.1: rendered with UI-mapped severity.
          Advisory codes (STRING_VOC_VOLTAGE_CLAMP, FEASIBILITY_*, etc.) are
          shown as info/blue rather than alarming yellow. Messages are
          rewritten to plain English explanations. */}
      {(warningCount + errorCount + infoCount) > 0 && (
        <div className="mb-3 space-y-1" data-testid="sizing-warnings">
          {mappedWarnings.map(({ mapped }, i) => (
            <div
              key={i}
              data-testid={`sizing-warning-${mapped.severity}`}
              data-engine-severity={mapped.engineSeverity}
              className={`text-xs px-2 py-1 rounded border ${
                mapped.severity === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : mapped.severity === 'warning'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
              }`}
            >
              <span className="font-mono text-[10px] mr-2 opacity-70">{mapped.code}</span>
              {mapped.message}
            </div>
          ))}
        </div>
      )}

      {/* Apply button */}
      {hasMismatch && (
        <button
          type="button"
          onClick={onApply}
          className="btn-primary btn-sm text-xs w-full flex items-center justify-center gap-2"
          data-testid="apply-recommendation"
        >
          <Zap size={12} />
          Apply Recommended Configuration
        </button>
      )}
    </div>
  );
}