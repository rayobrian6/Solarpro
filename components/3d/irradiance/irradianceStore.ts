/**
 * components/3d/irradiance/irradianceStore.ts
 *
 * Zustand store implementing the irradiance toggle state machine.
 *
 *   idle  ──toggle()──►  queued  ──microtick──►  computing
 *                                                      │
 *                                                compute_done(2s stub)
 *                                                      │
 *                                                      ▼
 *                                                   visible
 *                                                      │
 *                                              toggle() (hide)
 *                                                      │
 *                                                      ▼
 *                                                    idle
 *
 * Re-triggering `toggle()` while state is `queued` or `computing`
 * is a no-op (guarded by `inFlight`). This matches the Aurora
 * behavior — once a computation is queued, the user waits for it
 * to finish before they can toggle the layer off again.
 *
 * The actual per-vertex kWh/m²/year calculation is a future epic.
 * This slice ships the UI/UX contract; `computeIrradiance()` is a
 * 2-second `setTimeout` that returns a uniform placeholder.
 */

'use client';

import { create } from 'zustand';
import {
  IRRADIANCE_COMPUTE_DELAY_MS,
  IRRADIANCE_QUEUED_TOAST_TITLE,
  IRRADIANCE_TOAST_DURATION_MS,
  IRRADIANCE_TRANSITIONS,
  type IrradianceResult,
  type IrradianceState,
  type IrradianceToast,
} from './types';

// ─── Store shape ────────────────────────────────────────────────────────────

export interface IrradianceStoreState {
  /** Current state in the machine. See IRRADIANCE_TRANSITIONS. */
  state: IrradianceState;

  /**
   * True while a computation is in flight (`queued` or `computing`).
   * Used to debounce `toggle()` — once a request is queued the user
   * can't queue another until the result is ready.
   */
  inFlight: boolean;

  /** Latest computation result, populated when state becomes `visible`. */
  result: IrradianceResult | null;

  /** Single-slot toast queue (Aurora shows at most one at a time). */
  toast: IrradianceToast | null;

  // ── Actions ────────────────────────────────────────────────────────────
  /**
   * Toggle the layer. From `idle` → queue a computation.
   * From `visible` → hide the overlay and clear state.
   * No-op while `inFlight` is true.
   */
  toggle: () => void;

  /** Force-clear (used by tests and by the future abort epic). */
  reset: () => void;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Monotonic counter so successive toasts get unique ids even if
 *  `Date.now()` collides inside a single tick. */
let toastSeq = 0;
function nextToastId(): string {
  toastSeq += 1;
  return `irradiance-toast-${Date.now()}-${toastSeq}`;
}

/** Whether the store will accept a `toggle()` right now. */
function canToggle(state: IrradianceState, inFlight: boolean): boolean {
  if (inFlight) return false;
  // Only `idle` (start a compute) and `visible` (hide the overlay)
  // are user-reachable end states. `queued` and `computing` are
  // transient — also covered by the inFlight guard above.
  return state === 'idle' || state === 'visible';
}

/** Whether the requested transition is on the legal table. */
function isLegalTransition(from: IrradianceState, to: IrradianceState): boolean {
  return IRRADIANCE_TRANSITIONS[from].includes(to);
}

// ─── Store factory ──────────────────────────────────────────────────────────

export const useIrradianceStore = create<IrradianceStoreState>((set, get) => {
  // Per-instance timer handles. Captured in closure so the store
  // can cancel an in-flight compute on reset() without leaking the
  // timer into React state.
  let computeTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function clearComputeTimer(): void {
    if (computeTimer !== null) {
      clearTimeout(computeTimer);
      computeTimer = null;
    }
  }

  function clearToastTimer(): void {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function scheduleToastDismiss(id: string, durationMs: number): void {
    clearToastTimer();
    toastTimer = setTimeout(() => {
      // Only clear if the toast that's still on screen is *this* one.
      // Avoids a race where a newer toast has already replaced it.
      const current = get().toast;
      if (current && current.id === id) {
        set({ toast: null });
      }
      toastTimer = null;
    }, durationMs);
  }

  function showQueuedToast(): void {
    const id = nextToastId();
    set({
      toast: {
        id,
        title: IRRADIANCE_QUEUED_TOAST_TITLE,
        createdAt: Date.now(),
      },
    });
    scheduleToastDismiss(id, IRRADIANCE_TOAST_DURATION_MS);
  }

  function startComputeStub(): void {
    clearComputeTimer();
    computeTimer = setTimeout(() => {
      computeTimer = null;
      // Verify the user didn't reset() / abort while we were waiting.
      const current = get();
      if (current.state !== 'computing') return;
      if (!isLegalTransition('computing', 'visible')) return;
      const result: IrradianceResult = {
        computedAt: Date.now(),
        // Uniform placeholder; real engine returns per-vertex grid.
        annualKwhPerM2: 1500,
      };
      set({ state: 'visible', inFlight: false, result });
    }, IRRADIANCE_COMPUTE_DELAY_MS);
  }

  return {
    state: 'idle',
    inFlight: false,
    result: null,
    toast: null,

    toggle: () => {
      const { state, inFlight } = get();
      if (!canToggle(state, inFlight)) return;

      if (state === 'idle') {
        // Start a fresh computation.
        if (!isLegalTransition('idle', 'queued')) return;
        set({ state: 'queued', inFlight: true, result: null });
        showQueuedToast();
        // The `queued` state is purely so the UI can show "queued"
        // for one frame; the microtask below flips to `computing`
        // synchronously, before any user can re-trigger.
        // We still go through `queued` because the state machine
        // table in DESIGN.md lists it explicitly.
        queueMicrotask(() => {
          if (get().state === 'queued' && isLegalTransition('queued', 'computing')) {
            set({ state: 'computing' });
            startComputeStub();
          }
        });
        return;
      }

      if (state === 'visible') {
        // Hide the overlay.
        if (!isLegalTransition('visible', 'idle')) return;
        clearComputeTimer();
        set({ state: 'idle', inFlight: false, result: null });
        return;
      }

      // Defensive: canToggle already filtered these out.
      return;
    },

    reset: () => {
      clearComputeTimer();
      clearToastTimer();
      set({ state: 'idle', inFlight: false, result: null, toast: null });
    },
  };
});

// ─── Selectors (export for components + tests) ──────────────────────────────

/** True while a computation is queued or running. */
export const selectIsInFlight = (s: IrradianceStoreState): boolean => s.inFlight;

/** True when the overlay should be rendered. */
export const selectIsVisible = (s: IrradianceStoreState): boolean => s.state === 'visible';

/** Current toast (single-slot), or null. */
export const selectToast = (s: IrradianceStoreState): IrradianceToast | null => s.toast;

// ─── Pure helpers (exported for tests; no React, no Zustand) ────────────────

/**
 * Decide whether a keyboard event should fire the irradiance hotkey.
 * Pure function — exported for direct unit testing without JSDOM.
 *
 *   - Bare `i` / `I`, no modifiers, not a key-repeat.
 *
 * The SolarEngine3D's existing `onKey` closure calls this and
 * dispatches to the store on `true`.
 */
export function isIrradianceHotkeyEvent(e: { key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  if (e.repeat) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === 'i' || e.key === 'I';
}
