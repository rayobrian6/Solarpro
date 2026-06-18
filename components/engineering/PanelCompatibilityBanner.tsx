// ════════════════════════════════════════════════════════════════════════════
// PanelCompatibilityBanner
// components/engineering/PanelCompatibilityBanner.tsx
//
// v47.423 — Renders the panel↔brand compatibility verdict as a
// non-blocking banner above the sizing panel. Two visual tiers:
//
//   • Auto-switched (blue info):  "We changed your panel for you, here's why"
//   • Marginal      (yellow warn): "It fits, but tightly — consider upgrading"
//   • Incompatible+no suggestions (red): hard stop, pick another brand
//
// Includes a "Why?" dropdown that expands to show:
//   • The original panel's design current vs the brand's MPPT cap
//   • The top-3 compatible replacements with headroom %
//   • Click-to-apply shortcut on each suggestion
//
// Brand-agnostic — zero per-brand logic. Reads the verdict straight from
// the sizing engine's panelCompatibility payload.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import React, { useState } from 'react';
import type { SystemSizingResult } from '@/lib/system/sizingEngine';

export interface PanelCompatibilityBannerProps {
  /** The sizing engine's panelCompatibility payload. */
  verdict: NonNullable<SystemSizingResult['panelCompatibility']>;
  /**
   * Called when the user clicks a suggestion pill to change panels.
   * Passes the selected panel id.
   */
  onChangePanel?: (panelId: string) => void;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
}

export function PanelCompatibilityBanner({
  verdict,
  onChangePanel,
  onDismiss,
}: PanelCompatibilityBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // 'compatible' is silent — no banner needed.
  if (verdict.status === 'compatible') return null;

  // Choose palette based on autoSwitched vs marginal vs incompatible
  let palette: {
    bg:      string;
    border:  string;
    text:    string;
    pillBg:  string;
    icon:    string;
    heading: string;
  };

  if (verdict.autoSwitched) {
    palette = {
      bg:      'bg-blue-950/40',
      border:  'border-blue-600/40',
      text:    'text-blue-100',
      pillBg:  'bg-blue-900/60 hover:bg-blue-800/70 border-blue-600/50',
      icon:    '🔄',
      heading: 'Panel auto-switched for compatibility',
    };
  } else if (verdict.status === 'marginal') {
    palette = {
      bg:      'bg-amber-950/40',
      border:  'border-amber-600/40',
      text:    'text-amber-100',
      pillBg:  'bg-amber-900/60 hover:bg-amber-800/70 border-amber-600/50',
      icon:    '⚠️',
      heading: 'Marginal compatibility — consider a different panel',
    };
  } else {
    // incompatible with no catalog suggestion (rare)
    palette = {
      bg:      'bg-rose-950/40',
      border:  'border-rose-600/40',
      text:    'text-rose-100',
      pillBg:  'bg-rose-900/60 hover:bg-rose-800/70 border-rose-600/50',
      icon:    '⛔',
      heading: 'Panel incompatible with this brand',
    };
  }

  const hasSuggestions = verdict.suggestions.length > 0;

  return (
    <div
      className={`rounded-lg border ${palette.border} ${palette.bg} ${palette.text} px-4 py-3 text-sm`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden>
          {palette.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold mb-1">{palette.heading}</div>
          <div className="opacity-90">{verdict.reason}</div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="px-2 py-1 text-xs rounded-md border border-current/30 hover:bg-white/5 font-medium"
              aria-expanded={expanded}
            >
              {expanded ? 'Hide details ▲' : 'Why? ▼'}
            </button>

            {hasSuggestions && !verdict.autoSwitched && onChangePanel ? (
              <button
                type="button"
                onClick={() => onChangePanel(verdict.suggestions[0].id)}
                className={`px-2 py-1 text-xs rounded-md border font-medium ${palette.pillBg}`}
              >
                Switch to {verdict.suggestions[0].manufacturer}{' '}
                {verdict.suggestions[0].model} →
              </button>
            ) : null}

            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="px-2 py-1 text-xs rounded-md border border-current/20 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            ) : null}
          </div>

          {expanded ? (
            <div className="mt-3 pt-3 border-t border-current/20 space-y-3">
              <div className="text-xs opacity-80">
                <strong>Brand MPPT cap:</strong>{' '}
                {verdict.brand.effectiveMaxInputCurrentPerMppt !== null
                  ? `${verdict.brand.effectiveMaxInputCurrentPerMppt.toFixed(1)} A per channel (NEC 690.8(A)(1) design current)`
                  : 'not available'}
              </div>

              <div className="text-xs opacity-80">
                <strong>Original panel headroom:</strong>{' '}
                {verdict.headroomPct.toFixed(1)}%{' '}
                {verdict.headroomPct < 0 && '(OVER CAP)'}
              </div>

              {hasSuggestions ? (
                <div>
                  <div className="text-xs font-semibold mb-1.5">
                    Compatible replacements
                    {verdict.autoSwitched ? (
                      <span className="ml-2 opacity-70 font-normal">
                        (top choice applied automatically)
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {verdict.suggestions.map(s => {
                      const isActive = s.id === verdict.effectivePanelId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onChangePanel?.(s.id)}
                          disabled={isActive || !onChangePanel}
                          className={`px-2.5 py-1.5 text-xs rounded-md border text-left
                            ${isActive
                              ? 'border-emerald-500/60 bg-emerald-900/40 text-emerald-100 cursor-default'
                              : `${palette.pillBg} cursor-pointer`}
                          `}
                          title={`Isc ${s.isc.toFixed(2)} A · design ${s.designCurrent.toFixed(2)} A`}
                        >
                          <div className="font-semibold">
                            {s.manufacturer} {s.model}
                            {isActive && <span className="ml-1.5 text-emerald-400">✓ applied</span>}
                          </div>
                          <div className="opacity-75">
                            {s.watts}W · {s.headroomPct.toFixed(1)}% headroom ·{' '}
                            <span className="opacity-60">{s.tier}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default PanelCompatibilityBanner;