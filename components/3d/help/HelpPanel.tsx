/**
 * components/3d/help/HelpPanel.tsx
 *
 * The left-sidebar INSTRUCTIONS panel. Shows context-aware helper text that
 * changes per tool/mode.
 *
 * Aurora parity: matches the `INSTRUCTIONS` section visible in
 * `C:\Users\carpe\.mimax-agent\projects\aurora_frames\frame_0070.jpg`.
 *
 * Usage:
 *   <HelpPanel placementMode={placementMode} />
 *
 *   // Optional context enriches the text (e.g. "3 vertices placed"):
 *   <HelpPanel placementMode="block" context={{ pointsPlaced: 3 }} />
 *
 *   // Or start collapsed (user clicks + to expand):
 *   <HelpPanel placementMode={placementMode} defaultCollapsed />
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  HELP_TEXT_BY_MODE,
  helpTextFor,
  type HelpMode,
} from './helpText';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface HelpPanelContext {
  /** Number of points the user has placed so far (e.g. block vertices). */
  pointsPlaced?: number;
  /** Number of objects currently selected. */
  selectedCount?: number;
  /** A short live count (e.g. "12 panels placed"). */
  liveCount?: { label: string; value: number | string };
}

export interface HelpPanelProps {
  /** Active mode from SolarEngine3D's PlacementMode union (or a HelpMode). */
  placementMode: string;
  /** Optional context that enriches the help text. */
  context?: HelpPanelContext;
  /** When false, the small header label is hidden (compact mode). */
  showHeader?: boolean;
  /** When true, the panel starts collapsed. */
  defaultCollapsed?: boolean;
  /** Optional className for the wrapping div. */
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function HelpPanel({
  placementMode,
  context,
  showHeader = true,
  defaultCollapsed = false,
  className,
}: HelpPanelProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  const handleToggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  // Resolve the raw help text for the active mode — never undefined.
  const rawText = useMemo(
    () => helpTextFor(placementMode),
    [placementMode],
  );

  // Optionally enrich the text with live context.
  const displayText = useMemo(
    () => enrichWithContext(rawText, context),
    [rawText, context],
  );

  return (
    <div
      className={className}
      data-testid="help-panel"
      data-mode={placementMode}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 12px',
        // Aurora parity: no background, no border. Just text in the sidebar.
      }}
    >
      {showHeader ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: collapsed ? 0 : 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: '#6b7280',
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Instructions
          </span>
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={!collapsed}
            aria-controls="help-panel-body"
            aria-label={collapsed ? 'Expand instructions' : 'Collapse instructions'}
            data-testid="help-panel-toggle"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {collapsed ? '+' : '–'}
          </button>
        </div>
      ) : null}

      <div
        id="help-panel-body"
        role="region"
        aria-live="polite"
        aria-label="Mode instructions"
        data-testid="help-panel-body"
        data-collapsed={collapsed}
        style={{
          // Keep the node mounted so aria-live can announce on mode change.
          // But visually hide when collapsed to preserve the "expand on +" UX.
          display: collapsed ? 'none' : 'block',
          fontSize: 12,
          lineHeight: 1.45,
          color: '#9ca3af',
          whiteSpace: 'pre-wrap',
        }}
      >
        {displayText}
      </div>
    </div>
  );
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Enrich the base help text with live context (e.g. "3 points placed").
 * The base text is preserved as-is; the context is appended as a small
 * parenthetical.
 */
function enrichWithContext(
  baseText: string,
  context?: HelpPanelContext,
): string {
  if (!context) return baseText;
  const extras: string[] = [];
  if (typeof context.pointsPlaced === 'number' && context.pointsPlaced > 0) {
    extras.push(
      `${context.pointsPlaced} ${context.pointsPlaced === 1 ? 'point' : 'points'} placed`,
    );
  }
  if (typeof context.selectedCount === 'number' && context.selectedCount > 0) {
    extras.push(
      `${context.selectedCount} selected`,
    );
  }
  if (context.liveCount) {
    extras.push(`${context.liveCount.label}: ${context.liveCount.value}`);
  }
  if (extras.length === 0) return baseText;
  return `${baseText}\n(${extras.join(' • ')})`;
}

// ─── Re-exports for convenience ────────────────────────────────────────────

export { HELP_TEXT_BY_MODE, helpTextFor };
export type { HelpMode };
export default HelpPanel;
