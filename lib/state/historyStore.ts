/**
 * lib/state/historyStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Aurora-style ring-buffer state history.
 *
 * Public surface (see lib/state/DESIGN.md §6):
 *   createHistoryStore(initialState, bufferSize=50) → HistoryStore
 *
 *   HistoryStore {
 *     state          : SceneState       // always snapshots[cursor]
 *     dispatch       : (a: Action) => void
 *     undo           : () => void
 *     redo           : () => void
 *     replaceState   : (s: SceneState) => void
 *     markSaved      : () => void
 *     canUndo        : boolean
 *     canRedo        : boolean
 *     isDirty        : boolean
 *     stats          : { capacity, size, cursor }
 *   }
 *
 * This module is *pure* — no React, no Cesium, no I/O. The companion
 * `Buttons.tsx` wires the store into a React component.
 *
 * Design notes:
 *   - Snapshots are deep-cloned on write so external mutations to the
 *     SceneState handed in by the caller cannot poison the buffer.
 *   - The reducer is referentially stable: a no-op action returns the
 *     same `state` object. This keeps React renders cheap.
 *   - The dirty flag uses a structural JSON comparison (snapshots are
 *     JSON-serializable by design — see DESIGN.md §7). We avoid
 *     `JSON.stringify` on the live state on every read by caching the
 *     last-saved snapshot.
 */

'use client';

import type { Action, Primitive, SceneState } from './types';

// ─── Reducer ─────────────────────────────────────────────────────────────────

/**
 * Pure reducer. Returns a new SceneState only when the action actually
 * changes something; otherwise returns the same reference.
 */
export function sceneReducer(state: SceneState, action: Action): SceneState {
  switch (action.type) {
    case 'ADD': {
      // De-dupe: an ADD with a known id is a no-op.
      if (state.primitives.some(p => p.id === action.primitive.id)) {
        return state;
      }
      return {
        ...state,
        primitives: [...state.primitives, action.primitive],
        selectedId: action.primitive.id,
      };
    }

    case 'REMOVE': {
      if (!state.primitives.some(p => p.id === action.id)) {
        return state;
      }
      const primitives = state.primitives.filter(p => p.id !== action.id);
      const selectedId = state.selectedId === action.id ? null : state.selectedId;
      // If nothing actually changed, return the same reference.
      if (primitives === state.primitives && selectedId === state.selectedId) {
        return state;
      }
      return { ...state, primitives, selectedId };
    }

    case 'MOVE': {
      const idx = state.primitives.findIndex(p => p.id === action.id);
      if (idx === -1) return state;
      const target = state.primitives[idx];
      // The Primitive type is a discriminated union; only kinds that
      // already have a `lat`/`lng` field can be moved. We refuse to
      // graft those fields onto a kind that doesn't have them
      // (e.g. a Block has vertices, not a single lat/lng).
      if (!('lat' in target) || !('lng' in target)) {
        return state;
      }
      const lat = (target as { lat: number }).lat;
      const lng = (target as { lng: number }).lng;
      if (lat === action.to.lat && lng === action.to.lng) {
        return state;
      }
      const moved: Primitive = { ...target, lat: action.to.lat, lng: action.to.lng } as Primitive;
      const primitives = state.primitives.slice();
      primitives[idx] = moved;
      return { ...state, primitives };
    }

    case 'UPDATE': {
      const idx = state.primitives.findIndex(p => p.id === action.id);
      if (idx === -1) return state;
      // Strip `id` and `kind` from the patch to prevent identity drift.
      const safePatch: Partial<Primitive> = { ...action.patch };
      delete (safePatch as { id?: string }).id;
      delete (safePatch as { kind?: string }).kind;
      const merged: Primitive = { ...state.primitives[idx], ...safePatch } as Primitive;
      if (merged === state.primitives[idx]) return state;
      const primitives = state.primitives.slice();
      primitives[idx] = merged;
      return { ...state, primitives };
    }

    case 'SELECT':
      if (state.selectedId === action.id) return state;
      return { ...state, selectedId: action.id };

    case 'SET_VIEW': {
      // Shallow-merge and bail if nothing changed.
      let changed = false;
      const view = { ...state.view };
      for (const k of Object.keys(action.patch) as Array<keyof SceneState['view']>) {
        const next = action.patch[k];
        if (next !== undefined && view[k] !== next) {
          (view as Record<string, unknown>)[k] = next;
          changed = true;
        }
      }
      if (!changed) return state;
      return { ...state, view };
    }

    case 'BULK':
      // Full replacement — used for compound operations.
      return action.state;

    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ─── Deep clone (JSON-safe) ──────────────────────────────────────────────────

/**
 * Snapshots are guaranteed JSON-serializable (see types.ts), so a
 * JSON round-trip is the safest deep-clone. It's slower than a hand-rolled
 * copy, but it's correct and free of subtle reference aliasing bugs.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── History store ───────────────────────────────────────────────────────────

export interface HistoryStats {
  /** Maximum number of snapshots the buffer can hold. */
  capacity: number;
  /** Current number of snapshots in the buffer. */
  size: number;
  /** Index of the current snapshot within the buffer. */
  cursor: number;
  /** Number of discards (oldest dropped on overflow) since creation. */
  overflowed: number;
}

export interface HistoryStore {
  state: SceneState;
  dispatch: (action: Action) => void;
  undo: () => void;
  redo: () => void;
  replaceState: (state: SceneState) => void;
  markSaved: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  stats: HistoryStats;
}

const DEFAULT_BUFFER_SIZE = 50;
/** Public alias for the default ring-buffer size. Exported for tests. */
export { DEFAULT_BUFFER_SIZE };

export function createHistoryStore(
  initialState: SceneState,
  bufferSize: number = DEFAULT_BUFFER_SIZE,
): HistoryStore {
  if (bufferSize < 1) {
    throw new Error(`createHistoryStore: bufferSize must be ≥ 1, got ${bufferSize}`);
  }

  // ── Private state ────────────────────────────────────────────────────────
  let snapshots: SceneState[] = [clone(initialState)];
  let cursor = 0;
  let savedSnapshot: SceneState = clone(initialState);
  let overflowed = 0;

  // ── Derived flags (recomputed on every mutation) ─────────────────────────
  function canUndo(): boolean { return cursor > 0; }
  function canRedo(): boolean { return cursor < snapshots.length - 1; }
  function isDirty(): boolean {
    // Structural compare. JSON.stringify is fine here — SceneState is small
    // (primitives list + a view object) and not called on every render.
    return JSON.stringify(snapshots[cursor]) !== JSON.stringify(savedSnapshot);
  }

  // ── Mutation: dispatch ───────────────────────────────────────────────────
  function dispatch(action: Action): void {
    const current = snapshots[cursor];
    const next = sceneReducer(current, action);
    if (next === current) return; // no-op

    // Truncate the redo stack (everything after the cursor).
    if (cursor < snapshots.length - 1) {
      snapshots = snapshots.slice(0, cursor + 1);
    }

    // Append the new snapshot.
    snapshots.push(clone(next));
    cursor = snapshots.length - 1;

    // Ring-buffer overflow: drop from the front, keep the cursor on the
    // newest entry. The cursor therefore becomes 0 after a drop.
    if (snapshots.length > bufferSize) {
      const drop = snapshots.length - bufferSize;
      snapshots = snapshots.slice(drop);
      cursor = snapshots.length - 1;
      overflowed += drop;
    }
  }

  // ── Mutation: undo / redo ────────────────────────────────────────────────
  function undo(): void {
    if (cursor <= 0) return;
    cursor -= 1;
  }

  function redo(): void {
    if (cursor >= snapshots.length - 1) return;
    cursor += 1;
  }

  // ── Mutation: replaceState (initial load + post-Save) ────────────────────
  function replaceState(state: SceneState): void {
    const fresh = clone(state);
    snapshots = [fresh];
    cursor = 0;
    savedSnapshot = clone(fresh);
    // Reset overflow counter — the buffer was just re-seeded.
    overflowed = 0;
  }

  // ── Mutation: markSaved ──────────────────────────────────────────────────
  function markSaved(): void {
    savedSnapshot = clone(snapshots[cursor]);
  }

  // ── Read API ─────────────────────────────────────────────────────────────
  function stats(): HistoryStats {
    return {
      capacity: bufferSize,
      size: snapshots.length,
      cursor,
      overflowed,
    };
  }

  function state(): SceneState {
    return snapshots[cursor];
  }

  return {
    get state() { return state(); },
    dispatch,
    undo,
    redo,
    replaceState,
    markSaved,
    get canUndo() { return canUndo(); },
    get canRedo() { return canRedo(); },
    get isDirty() { return isDirty(); },
    get stats() { return stats(); },
  };
}
