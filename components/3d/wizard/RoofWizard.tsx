/**
 * components/3d/wizard/RoofWizard.tsx
 *
 * The 3-step sticky Roof Wizard (Aurora parity — see
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §2).
 *
 * This is a *thin* UX shell. It does not own the drawing — that lives
 * in SolarEngine3D. The wizard just shows the user where they are in
 * the Mark → Analyze → Adjust flow and gives them an explicit Cancel
 * button.
 *
 * Behavior:
 *  - Hidden when `placementMode` is not a roof-draw mode.
 *  - Mounts at top-center of the canvas, sticky-feeling (absolute).
 *  - Active step: orange gradient. Inactive: white card. × button: cancel.
 *  - Per-step "Continue →" affordance appears when the user can advance.
 *
 * Design doc: components/3d/wizard/DESIGN.md
 */

'use client';

import React, { useEffect, useMemo, useReducer, useCallback } from 'react';
import {
  wizardReducer,
  initialState,
  canAdvance,
  canGoBack,
  isRoofDrawMode,
  STEP_LABELS,
  type RoofDrawMode,
  type WizardSegment,
} from './wizardMachine';

// ─── Props ──────────────────────────────────────────────────────────────

export interface RoofWizardProps {
  /** Current Solarpro placement mode (e.g. 'block' | 'roof_gable' | 'roof_hip' | 'roof' | 'select' | …) */
  placementMode: string;
  /** Number of vertices the user has placed in the current draw session. */
  vertexCount: number;
  /**
   * Called when the user clicks × (Cancel). The parent should reset to
   * `'select'` mode and clear any in-progress drawing state.
   */
  onCancel: () => void;
  /**
   * Optional: called when the user clicks "Continue" and the wizard
   * advances to a new step. Most parents will not need this — the
   * `placementMode` prop already drives the actual UX.
   */
  onStepChange?: (step: 'mark_edges' | 'analyze_structure' | 'adjust_3d') => void;
  /**
   * Optional: proposed segments produced by the analyze step (step 2).
   * Surfaced as a prop so the parent (or the vertex-handles agent) can
   * render the yellow ridge-direction arrows. Out of scope for this
   * slice — left as a hook for future work.
   */
  analyzedSegments?: WizardSegment[];
  /**
   * Optional: when true, hides the wizard even if the mode is a roof-draw
   * mode. Useful for showing the wizard only on explicit Draw Roof click.
   * Defaults to `false` (auto-show on roof-draw mode).
   */
  hidden?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────

export const RoofWizard: React.FC<RoofWizardProps> = ({
  placementMode,
  vertexCount,
  onCancel,
  onStepChange,
  hidden = false,
}) => {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialState);

  // ── Drive ENTER events from the parent's placement mode ────────────
  // The `hidden` prop is purely visual (parent toggles the wizard on/off
  // without changing the workflow). The reducer's step stays as-is when
  // hidden=true; the render check below hides the JSX.
  useEffect(() => {
    if (hidden) return; // visual-only — don't mutate state
    if (isRoofDrawMode(placementMode)) {
      // Only ENTER if we're not already on a roof-draw mode — prevents
      // resetting the vertexCount on every parent re-render.
      if (state.step === 'idle' || state.cancelled) {
        dispatch({ type: 'ENTER', mode: placementMode });
      }
    } else {
      // Non-roof mode → hide the bar. We dispatch CANCEL; the parent's
      // onCancel is only fired from the × click (not from this effect),
      // so cancelling silently here is safe.
      if (state.step !== 'idle') {
        dispatch({ type: 'CANCEL' });
      }
    }
    // We intentionally only depend on `placementMode` and `hidden` so
    // vertexCount updates do not re-fire ENTER.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementMode, hidden]);

  // ── Mirror parent's vertexCount into the reducer ──────────────────
  useEffect(() => {
    if (state.step !== 'mark_edges') return;
    if (vertexCount === state.vertexCount) return;
    if (vertexCount > state.vertexCount) {
      const delta = vertexCount - state.vertexCount;
      for (let i = 0; i < delta; i++) dispatch({ type: 'VERTEX_ADDED' });
    } else {
      const delta = state.vertexCount - vertexCount;
      for (let i = 0; i < delta; i++) dispatch({ type: 'VERTEX_REMOVED' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertexCount, state.step]);

  // ── Fire onStepChange on transitions ──────────────────────────────
  useEffect(() => {
    if (state.step !== 'idle' && onStepChange) {
      onStepChange(state.step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  // ── Derived info ──────────────────────────────────────────────────
  const currentMode: RoofDrawMode | null = useMemo(
    () => (isRoofDrawMode(placementMode) ? placementMode : null),
    [placementMode],
  );
  const advance = canAdvance(state, currentMode);
  const back = canGoBack(state);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    dispatch({ type: 'CANCEL' });
    onCancel();
  }, [onCancel]);

  const handleContinue = useCallback(() => {
    if (!advance.canAdvance) return;
    dispatch({ type: 'CONTINUE' });
  }, [advance.canAdvance]);

  const handleBack = useCallback(() => {
    if (!back) return;
    dispatch({ type: 'BACK' });
  }, [back]);

  const handleStepClick = useCallback(
    (step: typeof STEP_LABELS[number]['step']) => {
      // Active step → try to advance if allowed
      if (state.step === step) {
        if (advance.canAdvance) handleContinue();
        return;
      }
      // Clicking a previous step (in history) → go back to it
      if (back) handleBack();
    },
    [state.step, advance.canAdvance, back, handleContinue, handleBack],
  );

  // ── Hidden when not in a roof-draw mode ───────────────────────────
  if (state.step === 'idle' || hidden) return null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      role="region"
      aria-label="Roof drawing wizard"
      data-testid="roof-wizard"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '4px 4px 4px 8px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 30,
        backdropFilter: 'blur(6px)',
        pointerEvents: 'auto',
        maxWidth: 'calc(100vw - 32px)',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {STEP_LABELS.map((item) => {
        const isActive = state.step === item.step;
        const isPast = state.step !== 'idle' && isStepPast(state.step, item.step);
        const showArrow = isActive && advance.canAdvance;
        return (
          <button
            key={item.step}
            type="button"
            onClick={() => handleStepClick(item.step)}
            data-testid={`wizard-step-${item.number}`}
            data-active={isActive ? 'true' : 'false'}
            data-past={isPast ? 'true' : 'false'}
            aria-current={isActive ? 'step' : undefined}
            title={isActive && !advance.canAdvance ? advanceHint(advance.remaining) : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px 8px 8px',
              border: 'none',
              borderRadius: 22,
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              lineHeight: 1.2,
              minHeight: 40,
              background: isActive
                ? 'linear-gradient(135deg,#ff8c00,#ff7e1a)'
                : '#ffffff',
              color: isActive ? '#ffffff' : '#1a1a1a',
              boxShadow: isActive
                ? '0 4px 14px rgba(255,140,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
                : isPast
                ? '0 1px 3px rgba(0,0,0,0.10)'
                : '0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
              outline: 'none',
              textAlign: 'left',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  '0 3px 8px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.06)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.transform = '';
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  '0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)';
              }
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                fontSize: 12,
                fontWeight: 800,
                background: isActive
                  ? 'rgba(255,255,255,0.22)'
                  : isPast
                  ? 'rgba(255,140,0,0.18)'
                  : 'rgba(0,0,0,0.08)',
                color: isActive ? '#fff' : isPast ? '#ff7e1a' : '#1a1a1a',
                flexShrink: 0,
              }}
            >
              {item.number}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, fontWeight: 'inherit' }}>{item.label}</span>
            </span>
            {showArrow ? (
              <span
                aria-hidden="true"
                data-testid="wizard-step-arrow"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: 4,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                →
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Cancel × */}
      <button
        type="button"
        onClick={handleCancel}
        aria-label="Cancel roof wizard"
        title="Cancel roof drawing"
        data-testid="wizard-cancel"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.06)',
          color: '#555',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 4,
          transition: 'all 0.15s ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,80,80,0.18)';
          (e.currentTarget as HTMLButtonElement).style.color = '#c92a2a';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.06)';
          (e.currentTarget as HTMLButtonElement).style.color = '#555';
        }}
      >
        ×
      </button>
    </div>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────

/** True if `candidate` is a step that comes before `current` in the flow. */
function isStepPast(
  current: 'mark_edges' | 'analyze_structure' | 'adjust_3d',
  candidate: 'mark_edges' | 'analyze_structure' | 'adjust_3d',
): boolean {
  const order = { mark_edges: 0, analyze_structure: 1, adjust_3d: 2 } as const;
  return order[candidate] < order[current];
}

/** Human-readable hint for why CONTINUE is not yet available. */
function advanceHint(remaining: number): string {
  if (remaining <= 0) return '';
  return `Place ${remaining} more vertex${remaining === 1 ? '' : 'es'} to continue`;
}
