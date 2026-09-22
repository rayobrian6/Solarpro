/**
 * lib/3d/geometryHistory.ts
 *
 * UNDO / REDO FOR CANONICAL ROOF GEOMETRY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY CANNOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It cannot snapshot the renderer. There is no Cesium type in this file, no
 * entity id, no frame, no viewer. A history that restores render state puts the
 * PICTURE back and leaves the data where it was, so the next autosave persists
 * the state the user just undid — and the roof they are looking at is not the
 * roof the permit will be drawn from.
 *
 * The unit of history is therefore `RoofPlane[]`: the canonical array that
 * DesignStudio owns, that the autosave signs, and that panels, setbacks,
 * production and the planset all read. Restoring it and then rebuilding the
 * derived geometry from it is the only ordering that leaves one truth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SNAPSHOT IS A DEEP COPY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 🚨 A SHALLOW COPY IS NOT A SNAPSHOT. Several paths in SolarEngine3D mutate a
 * plane in place — `(plane as any).__eaveDirENU = ...` is one, and the stitch
 * write-back edits `vertices` arrays. A `planes.slice()` shares every element,
 * so those mutations would reach back into the history and quietly rewrite the
 * past. Undo would then restore the present.
 *
 * The copy is a JSON round-trip. That is exact for this shape — every field of
 * RoofPlane is a number, string, boolean, plain object or array — and it also
 * normalises `undefined` away, which is what persistence does anyway.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COALESCING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Holding the eave-height stepper produces one snapshot per press, and undoing
 * a two-foot correction one inch at a time is its own usability failure. A push
 * may name a `coalesceKey`; consecutive pushes carrying the SAME key do not add
 * an entry, so the run collapses to the state before the run began.
 *
 * The key must name the section AND the field — 'eave:sec-garage' — so that
 * switching section or switching field breaks the run. A key that named only
 * the field would merge an edit to the house with an edit to the garage into
 * one undo step, which is the compensating-edit problem in another costume.
 */

import type { RoofPlane } from '@/types';

/** Deeper than this and the oldest is dropped. Roof arrays are small; the cost
 *  is bounded by plane count, not by session length. */
export const MAX_HISTORY_DEPTH = 60;

export interface GeometrySnapshot {
  /** What the user did, phrased so it reads after the word "Undo". */
  label: string;
  planes: RoofPlane[];
  /** Set when this entry may absorb an immediately following identical edit. */
  coalesceKey: string | null;
}

export interface GeometryHistory {
  past: GeometrySnapshot[];
  future: GeometrySnapshot[];
}

/**
 * 🚨 UNIFORM SHAPE, NOT A DISCRIMINATED UNION. This codebase compiles with
 * `strict: false` and no strictNullChecks, so narrowing on `ok` does not hold
 * at runtime and a caller reading `.planes` on a refusal would get `undefined`
 * with no compiler complaint. Every field is always present, and on a refusal
 * `planes` is the CURRENT array — applying it is a no-op rather than a wipe.
 */
export interface HistoryStep {
  ok: boolean;
  history: GeometryHistory;
  planes: RoofPlane[];
  label: string | null;
}

export function emptyHistory(): GeometryHistory {
  return { past: [], future: [] };
}

/** See the header: shallow is not a snapshot. */
function deepCopyPlanes(planes: ReadonlyArray<RoofPlane> | null | undefined): RoofPlane[] {
  if (!planes || planes.length === 0) return [];
  try {
    return JSON.parse(JSON.stringify(planes)) as RoofPlane[];
  } catch {
    // Circular or non-serialisable input. Refuse to record a snapshot that
    // would restore something other than what was here — the caller's push
    // becomes a no-op and undo simply reaches further back, which is safe.
    return null as any;
  }
}

/**
 * Record the state BEFORE a mutation.
 *
 * Call order is: push(current) -> mutate -> adopt. Pushing the state after the
 * mutation records the thing the user is trying to get rid of.
 */
export function pushSnapshot(
  history: GeometryHistory,
  label: string,
  planesBefore: ReadonlyArray<RoofPlane> | null | undefined,
  coalesceKey?: string | null,
): GeometryHistory {
  const copy = deepCopyPlanes(planesBefore);
  if (copy === null) return history; // see deepCopyPlanes

  const key = coalesceKey || null;
  const top = history.past.length > 0 ? history.past[history.past.length - 1] : null;

  // A run of identical edits keeps the state from BEFORE the run. Undo then
  // returns the user to where they started holding the button.
  if (key && top && top.coalesceKey === key) {
    return { past: history.past, future: [] };
  }

  const past = [...history.past, { label, planes: copy, coalesceKey: key }];
  while (past.length > MAX_HISTORY_DEPTH) past.shift();
  // 🚨 A NEW EDIT DESTROYS THE REDO BRANCH. Keeping it would let Redo apply a
  // geometry that was derived from a state that no longer exists.
  return { past, future: [] };
}

export function canUndo(history: GeometryHistory): boolean {
  return !!history && history.past.length > 0;
}

export function canRedo(history: GeometryHistory): boolean {
  return !!history && history.future.length > 0;
}

/** What "Undo" would undo, for the button's tooltip. Null when there is none. */
export function undoLabel(history: GeometryHistory): string | null {
  if (!canUndo(history)) return null;
  return history.past[history.past.length - 1].label;
}

/** What "Redo" would redo. Null when there is none. */
export function redoLabel(history: GeometryHistory): string | null {
  if (!canRedo(history)) return null;
  return history.future[history.future.length - 1].label;
}

/**
 * Step back one edit.
 *
 * `planesNow` is the live canonical array; it becomes the redo target. The
 * caller adopts `planes` and THEN rebuilds derived geometry from it.
 */
export function undo(
  history: GeometryHistory,
  planesNow: ReadonlyArray<RoofPlane> | null | undefined,
): HistoryStep {
  const current = (planesNow ?? []).slice();
  if (!canUndo(history)) {
    return { ok: false, history, planes: current, label: null };
  }
  const past = history.past.slice();
  const entry = past.pop()!;
  const forward = deepCopyPlanes(planesNow);
  if (forward === null) {
    return { ok: false, history, planes: current, label: null };
  }
  return {
    ok: true,
    history: {
      past,
      // The redo entry is labelled with the edit being undone, so Redo reads
      // as the same action rather than as "redo the state before it".
      future: [...history.future, { label: entry.label, planes: forward, coalesceKey: null }],
    },
    // Hand out a fresh copy: the caller will mutate what it adopts, and the
    // entry may be reached again through Redo.
    planes: deepCopyPlanes(entry.planes) ?? [],
    label: entry.label,
  };
}

/** Step forward one edit. Mirror of `undo`. */
export function redo(
  history: GeometryHistory,
  planesNow: ReadonlyArray<RoofPlane> | null | undefined,
): HistoryStep {
  const current = (planesNow ?? []).slice();
  if (!canRedo(history)) {
    return { ok: false, history, planes: current, label: null };
  }
  const future = history.future.slice();
  const entry = future.pop()!;
  const back = deepCopyPlanes(planesNow);
  if (back === null) {
    return { ok: false, history, planes: current, label: null };
  }
  return {
    ok: true,
    history: {
      past: [...history.past, { label: entry.label, planes: back, coalesceKey: null }],
      future,
    },
    planes: deepCopyPlanes(entry.planes) ?? [],
    label: entry.label,
  };
}

/** Drop everything. Used when the active site changes — history from one
 *  property must never be applicable to another. */
export function clearHistory(): GeometryHistory {
  return emptyHistory();
}
