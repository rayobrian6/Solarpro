'use client';
/**
 * components/3d/panel/RightPanel.tsx
 *
 * Phase-aware right-sidebar tool panel for the 3D design surface.
 *
 *   - When phase === 'design'      → renders the 9 Aurora design tools
 *                                    (Auto Design, Solar Panels, Inverter, BOS,
 *                                    String Modules, Connect, Walkway,
 *                                    Roof Face Info, Ruler)
 *   - When phase === 'site_model'  → renders the 5 Aurora site-model tools
 *                                    (Draw Roof, Draw Tree, Add Obstruction,
 *                                    Measurements, Ruler) — for future parity
 *
 * Source: Aurora 2017 "reDesigned" frame 147 (design) + HANDOFF §1 (site-model).
 *
 * The 9 design tools are stubs in this slice — they only update the active
 * tool. The actual behaviors (panel placement, stringing, inverter selection,
 * etc.) are implemented by separate agents' work and will key off the active
 * tool id emitted by this panel.
 *
 * Visual style: matches SolarEngine3D's dark glass theme (inline styles
 * only — no Tailwind recompile needed).
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { RightPanelProps, ToolId, PanelEntry } from './types';
import { getToolsForPhase } from './tools';
import { designHotkeyToToolId, hasModifierKey } from './hotkeys';

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  alignItems: 'center',
  background: 'rgba(15,15,30,0.92)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',     // Safari
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  padding: '6px 4px',
  zIndex: 50,
  pointerEvents: 'all',
  width: 200,
};

const ROW_BASE: React.CSSProperties = {
  width: '100%',
  minHeight: 34,
  borderRadius: 8,
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.12s',
  background: 'rgba(255,255,255,0.07)',
  color: '#ccc',
  fontWeight: 400,
};

const ROW_ACTIVE: React.CSSProperties = {
  background: 'linear-gradient(135deg,#ff8c00,#ffd700)',
  color: '#000',
  fontWeight: 700,
  boxShadow: '0 0 8px rgba(255,180,0,0.35)',
};

const TOGGLE_BTN_STYLE: React.CSSProperties = {
  width: '100%',
  height: 30,
  borderRadius: 6,
  background: 'rgba(255,255,255,0.05)',
  border: 'none',
  color: '#888',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  marginBottom: 4,
};

const SEPARATOR: React.CSSProperties = {
  width: '100%',
  height: 1,
  background: 'rgba(255,255,255,0.1)',
  margin: '2px 0',
};

const PHASE_LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  color: '#ffa040',
  textAlign: 'center',
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  paddingBottom: 4,
  paddingTop: 2,
};

const HOTKEY_STYLE: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'rgba(255,255,255,0.35)',
  fontSize: 10,
  fontFamily: 'monospace',
};

/**
 * The phase-aware right panel.
 *
 * Default phase is 'design' so the panel is "ready to ship" as a Design
 * tool sidebar. Pass `phase='site_model'` to get the site-model variant.
 *
 * The component can be controlled (`activeToolId` + `onToolChange`) or
 * uncontrolled (omit `activeToolId` and the panel keeps its own state).
 */
export default function RightPanel({
  phase = 'design',
  activeToolId,
  onToolChange,
  collapsed: collapsedProp = false,
  enableHotkeys = true,
  className,
}: RightPanelProps): React.ReactElement {
  // Uncontrolled active tool. Only used when activeToolId is undefined.
  const [internalActive, setInternalActive] = useState<ToolId | null>(null);
  const isControlled = activeToolId !== undefined;
  const current = isControlled ? activeToolId : internalActive;

  // Local collapse state — toggled by the chevron button. The `collapsed`
  // prop is the initial value; we ignore further changes to it (parent
  // should remount with a new key to force a different starting state).
  const [collapsed, setCollapsed] = useState<boolean>(collapsedProp);

  // ── Click handler: toggle active tool and notify parent ─────────────
  const handleClick = useCallback(
    (entry: PanelEntry) => {
      const next: ToolId | null = current === entry.id ? null : entry.id;
      if (!isControlled) setInternalActive(next);
      onToolChange?.(next);
    },
    [current, isControlled, onToolChange],
  );

  // ── Hotkey handler: install a window keydown listener ───────────────
  useEffect(() => {
    if (!enableHotkeys) return;
    if (phase !== 'design') return; // only design tools have hotkeys for now
    if (typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (hasModifierKey(e)) return;
      const id = designHotkeyToToolId(e.key);
      if (!id) return;
      const next: ToolId | null = current === id ? null : id;
      if (!isControlled) setInternalActive(next);
      onToolChange?.(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enableHotkeys, phase, current, isControlled, onToolChange]);

  // ── Render ──────────────────────────────────────────────────────────
  const entries = getToolsForPhase(phase);

  return (
    <div
      data-testid="right-panel"
      data-phase={phase}
      data-active-tool={current ?? ''}
      className={className}
      style={PANEL_STYLE}
    >
      {/* Toggle button — collapses the list to just the chevron */}
      <button
        type="button"
        data-testid="right-panel-toggle"
        aria-label={collapsed ? 'Expand right panel' : 'Collapse right panel'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(c => !c)}
        style={TOGGLE_BTN_STYLE}
      >
        <span
          style={{
            display: 'inline-block',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          {'\u25BE'}
        </span>
      </button>

      {!collapsed ? (
        <>
          <div style={PHASE_LABEL_STYLE}>{phase === 'design' ? 'Design' : 'Site Model'}</div>
          <div style={SEPARATOR} />
          {entries.map(entry => {
            const isActive = current === entry.id;
            const rowStyle: React.CSSProperties = isActive
              ? { ...ROW_BASE, ...ROW_ACTIVE }
              : ROW_BASE;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`right-panel-row-${entry.id}`}
                data-active={isActive ? 'true' : 'false'}
                aria-pressed={isActive}
                title={entry.tip}
                onClick={() => handleClick(entry)}
                style={rowStyle}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,140,0,0.18)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)';
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ display: 'inline-flex', width: 18, justifyContent: 'center' }}
                >
                  {entry.icon}
                </span>
                <span style={{ flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.label}
                </span>
                {entry.hotkey ? (
                  <span style={HOTKEY_STYLE}>({entry.hotkey.toUpperCase()})</span>
                ) : null}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
