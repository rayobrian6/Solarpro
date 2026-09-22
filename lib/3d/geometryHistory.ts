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
  /**
   * THE PROVIDER DECISION AS IT STOOD BEFORE THE EDIT.
   *
   * 🚨 A GEOMETRY EDIT CAN CHANGE IT, SO AN UNDO THAT IGNORES IT IS HALF AN
   * UNDO. Every face a section tool emits carries `.section`, and DesignStudio
   * files `custom` for the property the moment one arrives. So: draw one gable
   * by mistake on a property with no other planes, press Undo — the roof comes
   * back empty and the property stays permanently 'custom'. `custom` refuses
   * every native-acquisition door, and an audit confirmed that no control in
   * the app could clear it; the user's first evidence was a toast, hours later,
   * telling them to "clear that decision first".
   *
   * Carried as an opaque string so this module stays free of the disposition
   * vocabulary — it records what it was told and hands it back. `null` means
   * the caller recorded no decision with this step, and the caller then leaves
   * whatever is current alone.
   */
  disposition: string | null;
  /**
   * THE DELETION LEDGER AS IT STOOD BEFORE THE EDIT.
   *
   * 🚨 A TOMBSTONE THAT OUTLIVES ITS UNDO IS A FACE THAT COMES BACK AND THEN
   * DISAPPEARS AGAIN ON RELOAD. Deleting a face writes an entry to the ledger
   * so no restore path can re-admit it; undoing that deletion is a person
   * saying they did not mean it, so the entry has to go with it. Without this
   * the undone face would be on screen, in `roofPlanes`, and filtered out of
   * the very next hydration — the worst possible answer, because it looks like
   * it worked.
   *
   * Opaque, for the same reason `disposition` is: this module records what it
   * was told and hands it back, and stays free of the deletion vocabulary.
   */
  deletions: unknown | null;
  /**
   * THE PANELS AS THEY STOOD BEFORE, carried ONLY by a step that removes them.
   *
   * 🚨 THE "PANELS ARE DERIVED" RULE HAS EXACTLY ONE EXCEPTION, AND THIS IS IT.
   * Every other edit MOVES a face, so its panels are recomputed from the face
   * they stand on — storing them would be a second record of one fact. A
   * DELETE removes the face, and a panel cannot be recomputed from a roof that
   * is not there. `null` means "recompute as usual", which is what every
   * existing caller records and what every existing step does.
   */
  panels: unknown[] | null;
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
  /** The decision to restore alongside `planes`, or null when the step carried
   *  none. See `GeometrySnapshot.disposition`. */
  disposition: string | null;
  /** The deletion ledger to restore alongside `planes`, or null. */
  deletions: unknown | null;
  /** The panels to restore VERBATIM, or null to recompute them from `planes`
   *  exactly as before. See `GeometrySnapshot.panels`. */
  panels: unknown[] | null;
}

export function emptyHistory(): GeometryHistory {
  return { past: [], future: [] };
}

/** Deep copy for the opaque carried values. Returns null rather than throwing:
 *  a value that cannot be copied is recorded as "the step carried none", which
 *  degrades to the pre-existing behaviour instead of handing a shared mutable
 *  reference to two history entries. */
function copyOpaque(v: ReadonlyArray<unknown> | null | undefined): unknown[] | null {
  if (!v) return null;
  try { return JSON.parse(JSON.stringify(v)) as unknown[]; } catch { return null; }
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
  /** The provider decision as it stands NOW, before the edit. See
   *  `GeometrySnapshot.disposition`. Omitted means "do not restore one". */
  dispositionBefore?: string | null,
  /** The deletion ledger as it stands NOW, before the edit. Omitted means
   *  "do not restore one". See `GeometrySnapshot.deletions`. */
  deletionsBefore?: unknown | null,
  /** The panels as they stand NOW. Supplied ONLY by a step that removes
   *  panels; omitted means the caller recomputes them, which is the rule for
   *  every other edit. See `GeometrySnapshot.panels`. */
  panelsBefore?: ReadonlyArray<unknown> | null,
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

  let panelCopy: unknown[] | null = null;
  if (panelsBefore) {
    try { panelCopy = JSON.parse(JSON.stringify(panelsBefore)) as unknown[]; }
    // A non-serialisable panel list must not silently become "recompute them",
    // which on a delete step means the panels never come back. Refuse the push
    // instead; undo then reaches one edit further, which is recoverable.
    catch { return history; }
  }
  const past = [...history.past, {
    label, planes: copy, coalesceKey: key,
    disposition: dispositionBefore ?? null,
    deletions: deletionsBefore ?? null,
    panels: panelCopy,
  }];
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
  /** The decision as it stands NOW. It becomes the redo target, exactly as
   *  `planesNow` does — otherwise Redo would put the geometry forward and
   *  leave the decision behind, which is the same half-undo in the other
   *  direction. */
  dispositionNow?: string | null,
  /** The ledger as it stands NOW. Becomes the redo target, exactly as
   *  `planesNow` does. */
  deletionsNow?: unknown | null,
  /** The panels as they stand NOW. Carried onto the redo entry only when the
   *  step being undone carried panels — a redo of a deletion must remove them
   *  again, and it can only do that if it knows what "after" looked like. */
  panelsNow?: ReadonlyArray<unknown> | null,
): HistoryStep {
  const current = (planesNow ?? []).slice();
  if (!canUndo(history)) {
    return { ok: false, history, planes: current, label: null, disposition: null, deletions: null, panels: null };
  }
  const past = history.past.slice();
  const entry = past.pop()!;
  const forward = deepCopyPlanes(planesNow);
  if (forward === null) {
    return { ok: false, history, planes: current, label: null, disposition: null, deletions: null, panels: null };
  }
  return {
    ok: true,
    history: {
      past,
      // The redo entry is labelled with the edit being undone, so Redo reads
      // as the same action rather than as "redo the state before it".
      future: [...history.future, {
        label: entry.label, planes: forward, coalesceKey: null,
        disposition: dispositionNow ?? null,
        deletions: deletionsNow ?? null,
        panels: entry.panels ? copyOpaque(panelsNow) : null,
      }],
    },
    // Hand out a fresh copy: the caller will mutate what it adopts, and the
    // entry may be reached again through Redo.
    planes: deepCopyPlanes(entry.planes) ?? [],
    label: entry.label,
    disposition: entry.disposition ?? null,
    deletions: entry.deletions ?? null,
    panels: copyOpaque(entry.panels),
  };
}

/** Step forward one edit. Mirror of `undo`. */
export function redo(
  history: GeometryHistory,
  planesNow: ReadonlyArray<RoofPlane> | null | undefined,
  dispositionNow?: string | null,
  deletionsNow?: unknown | null,
  panelsNow?: ReadonlyArray<unknown> | null,
): HistoryStep {
  const current = (planesNow ?? []).slice();
  if (!canRedo(history)) {
    return { ok: false, history, planes: current, label: null, disposition: null, deletions: null, panels: null };
  }
  const future = history.future.slice();
  const entry = future.pop()!;
  const back = deepCopyPlanes(planesNow);
  if (back === null) {
    return { ok: false, history, planes: current, label: null, disposition: null, deletions: null, panels: null };
  }
  return {
    ok: true,
    history: {
      past: [...history.past, {
        label: entry.label, planes: back, coalesceKey: null,
        disposition: dispositionNow ?? null,
        deletions: deletionsNow ?? null,
        panels: entry.panels ? copyOpaque(panelsNow) : null,
      }],
      future,
    },
    planes: deepCopyPlanes(entry.planes) ?? [],
    label: entry.label,
    disposition: entry.disposition ?? null,
    deletions: entry.deletions ?? null,
    panels: copyOpaque(entry.panels),
  };
}

/** Drop everything. Used when the active site changes — history from one
 *  property must never be applicable to another. */
export function clearHistory(): GeometryHistory {
  return emptyHistory();
}
