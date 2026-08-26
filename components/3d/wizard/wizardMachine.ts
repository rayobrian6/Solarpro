/**
 * components/3d/wizard/wizardMachine.ts
 *
 * Pure state machine for the 3-step Roof Wizard (Aurora parity).
 *
 * The wizard is a sticky top-center stepper that appears during any
 * roof-drawing mode. It does NOT own the drawing — SolarEngine3D keeps
 * full control of the placement mode and the geometry pipeline. The
 * machine is just a UX shell that tracks which Aurora step the user is on.
 *
 * Aurora parity: see HANDOFF_2026-08-25_AURORA_ANALYSIS.md §2.
 *
 * Design doc: components/3d/wizard/DESIGN.md
 *
 * No React, no Cesium, no DOM. 100% testable in Vitest.
 */

// ─── Public types ────────────────────────────────────────────────────────

/** The three Aurora-parity steps. */
export type WizardStep = 'mark_edges' | 'analyze_structure' | 'adjust_3d';

/** Which Solarpro placement modes activate the wizard. */
export type RoofDrawMode = 'block' | 'roof_gable' | 'roof_hip' | 'roof';

/** A single segment proposed by the analysis step (step 2). */
export interface WizardSegment {
  id: string;
  /** Endpoint A id — references a vertex by id. */
  a: string;
  /** Endpoint B id. */
  b: string;
  /** Ridge-direction normal: +1 or -1. The user can flip this in step 2. */
  normalDir: 1 | -1;
}

/** A single placed vertex. */
export interface WizardVertex {
  id: string;
  x: number;
  y: number;
}

/** Snapshot for back-navigation. */
export interface WizardSnapshot {
  step: WizardStep;
  vertexCount: number;
  segments: WizardSegment[];
}

/** Full reducer state. */
export interface WizardState {
  /** The step the user is on. `'idle'` means the wizard is hidden. */
  step: WizardStep | 'idle';
  /** Mirror of the parent's click count for the current mode. */
  vertexCount: number;
  /** Proposed segments after the analyze step. Empty before step 2. */
  segments: WizardSegment[];
  /** Stack of snapshots for back-navigation. */
  history: WizardSnapshot[];
  /** True once the user has clicked ×. Used to distinguish "cancelled" from "idle". */
  cancelled: boolean;
}

/** Events the machine accepts. */
export type WizardEvent =
  | { type: 'ENTER'; mode: RoofDrawMode }
  | { type: 'VERTEX_ADDED' }
  | { type: 'VERTEX_REMOVED' }
  | { type: 'CONTINUE' }
  | { type: 'BACK' }
  | { type: 'CANCEL' };

// ─── Per-mode metadata ──────────────────────────────────────────────────

/** Minimum vertices before step 1 → step 2 is allowed. */
export const MIN_VERTICES_FOR_STEP_2: Record<RoofDrawMode, number> = {
  block: 2,        // Solarpro block is 2-click (line-trace mode)
  roof_gable: 2,   // 2 eave corners
  roof_hip: 2,     // 2 eave corners
  roof: 3,         // legacy polygon mode — needs at least 3 to close
};

/** True if a given placement mode is a roof-draw mode the wizard owns. */
export function isRoofDrawMode(mode: string): mode is RoofDrawMode {
  return mode === 'block' || mode === 'roof_gable' || mode === 'roof_hip' || mode === 'roof';
}

/** Initial state — wizard is hidden. */
export function initialState(): WizardState {
  return {
    step: 'idle',
    vertexCount: 0,
    segments: [],
    history: [],
    cancelled: false,
  };
}

// ─── Reducer ────────────────────────────────────────────────────────────

/**
 * Pure reducer. The wizard NEVER advances without a user gesture —
 * auto-advance is signaled by a `canAdvance` flag the parent reads off
 * the resulting state, but the actual transition is gated by `CONTINUE`.
 */
export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case 'ENTER': {
      // If we're entering a roof-draw mode, reset to step 1.
      if (isRoofDrawMode(event.mode)) {
        return {
          step: 'mark_edges',
          vertexCount: 0,
          segments: [],
          history: [],
          cancelled: false,
        };
      }
      // Non-roof mode → hide wizard. Cancelled flag carries through
      // so the parent can distinguish an explicit cancel from a
      // mode switch.
      return {
        ...state,
        step: 'idle',
        history: [],
      };
    }

    case 'CANCEL': {
      return {
        ...state,
        step: 'idle',
        history: [],
        cancelled: true,
      };
    }

    case 'VERTEX_ADDED': {
      if (state.step !== 'mark_edges') return state;
      return { ...state, vertexCount: state.vertexCount + 1 };
    }

    case 'VERTEX_REMOVED': {
      if (state.step !== 'mark_edges') return state;
      return { ...state, vertexCount: Math.max(0, state.vertexCount - 1) };
    }

    case 'CONTINUE': {
      if (state.step === 'mark_edges') {
        const snapshot: WizardSnapshot = {
          step: 'mark_edges',
          vertexCount: state.vertexCount,
          segments: state.segments,
        };
        return {
          ...state,
          step: 'analyze_structure',
          history: [...state.history, snapshot],
        };
      }
      if (state.step === 'analyze_structure') {
        const snapshot: WizardSnapshot = {
          step: 'analyze_structure',
          vertexCount: state.vertexCount,
          segments: state.segments,
        };
        return {
          ...state,
          step: 'adjust_3d',
          history: [...state.history, snapshot],
        };
      }
      // No-op on 'adjust_3d' or 'idle'.
      return state;
    }

    case 'BACK': {
      if (state.history.length === 0) return state;
      const last = state.history[state.history.length - 1];
      return {
        ...state,
        step: last.step,
        vertexCount: last.vertexCount,
        segments: last.segments,
        history: state.history.slice(0, -1),
      };
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = event;
      return state;
    }
  }
}

// ─── Selectors ──────────────────────────────────────────────────────────

export interface CanAdvanceInfo {
  canAdvance: boolean;
  reason: 'no_mode' | 'need_more_vertices' | 'ready';
  /** How many more vertices are needed, if any. */
  remaining: number;
}

/** True if the user can hit CONTINUE from the current step. */
export function canAdvance(
  state: WizardState,
  currentMode: RoofDrawMode | null,
): CanAdvanceInfo {
  if (state.step === 'idle' || currentMode === null) {
    return { canAdvance: false, reason: 'no_mode', remaining: 0 };
  }
  if (state.step === 'mark_edges') {
    const min = MIN_VERTICES_FOR_STEP_2[currentMode];
    const remaining = Math.max(0, min - state.vertexCount);
    if (remaining > 0) {
      return { canAdvance: false, reason: 'need_more_vertices', remaining };
    }
    return { canAdvance: true, reason: 'ready', remaining: 0 };
  }
  if (state.step === 'analyze_structure') {
    return { canAdvance: true, reason: 'ready', remaining: 0 };
  }
  // adjust_3d: terminal step — only × can finish.
  return { canAdvance: false, reason: 'ready', remaining: 0 };
}

/** True if the user can go BACK from the current step. */
export function canGoBack(state: WizardState): boolean {
  return state.history.length > 0;
}

/** Visible step labels, in order. */
export const STEP_LABELS: ReadonlyArray<{ step: WizardStep; number: number; label: string }> = [
  { step: 'mark_edges',         number: 1, label: 'Mark roof edges' },
  { step: 'analyze_structure',  number: 2, label: 'Analyze roof structure' },
  { step: 'adjust_3d',          number: 3, label: 'Adjust 3D model' },
] as const;
