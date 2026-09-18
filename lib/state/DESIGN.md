# Undo/Redo System — Design Doc

> Owner: `undo-system` agent
> Status: implemented
> Aurora reference: `HANDOFF_2026-08-25_AURORA_ANALYSIS.md` §1 + TIER 3 #11 + #20
> Frames: `aurora_frames/frame_0070.jpg`, `frame_0110.jpg`, `frame_0142.jpg`

## 1. What Aurora does (parity bar)

Aurora's top secondary bar shows three icon+label buttons in a row, left of
the map-source controls:

| Button | Behaviour                                                 | Visual states                     |
| ------ | --------------------------------------------------------- | --------------------------------- |
| Save   | Persists current design state                             | Highlighted (green checkmark) when there are unsaved changes; otherwise muted |
| Undo   | Reverts the last action (add/remove/move primitive)       | Enabled only when there is history (≥1 past snapshot); greyed out when at the bottom of the buffer |
| Redo   | Re-applies the last undone action                         | Enabled only when there is a redo stack (≥1 future snapshot); greyed out at the top of the buffer |

The buttons sit between the **New UI Project** action and the **Details ▼** /
**LiDAR** / **Street View** / **Google ▼** map-source cluster.

Underneath is an in-memory ring buffer of complete state snapshots (Aurora
keeps ~50 steps). Every user action that mutates the design state pushes a new
snapshot; Undo walks one step backward, Redo walks one step forward. At the
ends of the buffer the corresponding button is disabled.

## 2. What we are building (in this slice)

A **self-contained**, framework-agnostic history store + React toolbar that
implements Aurora's three-button bar. The store is pure TypeScript (no React,
no Cesium) and is designed to drop into the existing `SolarEngine3D.tsx`
without changing any primitive rendering.

### Files owned by this slice

| File                              | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `lib/state/DESIGN.md`             | This document                                                                          |
| `lib/state/types.ts`              | `SceneState`, `Primitive`, `Action` discriminated unions                                |
| `lib/state/historyStore.ts`       | `createHistoryStore(initialState, bufferSize=50)` factory                              |
| `lib/state/Buttons.tsx`           | React component rendering the Save/Undo/Redo toolbar (Aurora visual style)            |
| `lib/state/index.ts`              | Barrel re-export                                                                       |
| `tests/undoSystem.test.ts`        | Vitest unit tests for the history store                                                |

### Files touched minimally

| File                                    | Why                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `components/3d/SolarEngine3D.tsx`       | Mount the `<UndoRedoToolbar />` once in the canvas; pass a thin bridge to the design surface  |

Nothing else is modified. Primitive math (block, gable, hip, tree, etc.) stays
where it is.

## 3. State shape

The state that the ring buffer snapshots is a single `SceneState` object:

```ts
export interface SceneState {
  /** All scene primitives currently on the design surface. */
  primitives: Primitive[];
  /** ID of the currently selected primitive (or null). */
  selectedId: string | null;
  /** Free-form UI flags that the surface mutates and that the user
   *  expects to roll back. Kept here so the buffer is the single
   *  source of truth for "what does the scene look like right now". */
  view: {
    placementMode: string;
    newBlockEaveHeightM: number;
    newRoofEaveHeightM: number;
    newRoofPitchDeg: number;
  };
}
```

A `Primitive` is a discriminated union that covers every existing Solarpro
3D primitive plus the panel/obstruction layers. The store does not need to
know how each kind is rendered — it only stores the data and re-emits it on
undo/redo. The discriminated union is the contract with the rest of the app.

```ts
export type Primitive =
  | BlockPrimitive
  | GablePrimitive
  | HipPrimitive
  | TreePrimitive
  | ObstructionPrimitive
  | PanelGroupPrimitive;

export interface BasePrimitive {
  id: string;
  kind: Primitive['kind'];
  createdAt: number;     // epoch ms — used to sort + audit
}
```

Concrete primitive payloads mirror what `SolarEngine3D` already keeps in refs
(block footprint, gable/hip ridge, tree lat/lng, obstruction radius, panel
group IDs). We keep them as **opaque data** — the store never inspects them.

## 4. Action types

Actions are a small, closed set — the minimum Aurora needs to satisfy
"add/remove/move primitive":

```ts
export type Action =
  | { type: 'ADD';       primitive: Primitive }
  | { type: 'REMOVE';    id: string }
  | { type: 'MOVE';      id: string; to: { lat: number; lng: number } }
  | { type: 'UPDATE';    id: string; patch: Partial<Primitive> }
  | { type: 'SELECT';    id: string | null }
  | { type: 'SET_VIEW';  patch: Partial<SceneState['view']> }
  | { type: 'BULK';      state: SceneState };   // escape hatch for compound ops
```

`BULK` exists because real user actions (e.g. "drop a 2-roof compound") may
mutate many primitives in one event. It snapshots a fully built `SceneState`
in one shot so undo feels atomic to the user.

## 5. Reducer

```ts
export function sceneReducer(state: SceneState, action: Action): SceneState {
  switch (action.type) {
    case 'ADD': {
      if (state.primitives.some(p => p.id === action.primitive.id)) return state; // dedupe
      return {
        ...state,
        primitives: [...state.primitives, action.primitive],
        selectedId: action.primitive.id,
      };
    }
    case 'REMOVE': {
      return {
        ...state,
        primitives: state.primitives.filter(p => p.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }
    case 'MOVE': {
      return {
        ...state,
        primitives: state.primitives.map(p =>
          p.id === action.id
            ? { ...p, lat: action.to.lat, lng: action.to.lng } as Primitive
            : p
        ),
      };
    }
    case 'UPDATE': {
      return {
        ...state,
        primitives: state.primitives.map(p =>
          p.id === action.id ? ({ ...p, ...action.patch } as Primitive) : p
        ),
      };
    }
    case 'SELECT':
      return { ...state, selectedId: action.id };
    case 'SET_VIEW':
      return { ...state, view: { ...state.view, ...action.patch } };
    case 'BULK':
      return action.state;
    default:
      return state;
  }
}
```

The reducer is **pure** (no Date.now(), no Math.random()) so unit tests can
assert exact equality. It is also **referentially stable** — a no-op action
returns the same `state` object so React renders stay cheap.

## 6. History store (ring buffer)

```ts
export interface HistoryStore {
  /** Current state — always equal to buffer[cursor]. */
  state: SceneState;
  /** Dispatch an action. Pushes the new state onto the buffer,
   *  truncates any redo stack, and bumps the dirty flag. */
  dispatch: (action: Action) => void;
  /** Step back one snapshot. No-op if at the bottom. */
  undo: () => void;
  /** Step forward one snapshot. No-op if at the top. */
  redo: () => void;
  /** Replace the entire state without touching the history.
   *  Use this on initial load and after a successful Save. */
  replaceState: (state: SceneState) => void;
  /** Mark the current state as saved → clears isDirty. */
  markSaved: () => void;
  /** True iff there is at least one snapshot behind the cursor. */
  canUndo: boolean;
  /** True iff there is at least one snapshot ahead of the cursor. */
  canRedo: boolean;
  /** True iff the current state differs from the last saved snapshot. */
  isDirty: boolean;
  /** Buffer telemetry — for tests and debug. */
  stats: {
    capacity: number;
    size: number;          // current number of snapshots in the buffer
    cursor: number;        // index of the current snapshot
  };
}

export function createHistoryStore(
  initialState: SceneState,
  bufferSize: number = 50,
): HistoryStore;
```

### Buffer mechanics

- Internal storage: `Snapshot[]` of length ≤ `bufferSize`, plus a `cursor: number`
  that points at the current snapshot.
- `dispatch(action)`:
  1. Apply `sceneReducer(state, action)`.
  2. Truncate everything **after** the cursor (drop the redo stack).
  3. Push the new snapshot at the end.
  4. If `snapshots.length > bufferSize`, drop from the **front** (oldest). The
     cursor follows the newest. This is the ring-buffer overflow rule.
  5. Bump `isDirty = true`.
- `undo()`:
  - If `cursor > 0`, decrement the cursor and set `state` to the snapshot
    there. `isDirty` re-derives from the saved-snapshot compare.
- `redo()`:
  - If `cursor < snapshots.length - 1`, increment the cursor and set `state`.
- `replaceState(state)`:
  - Replace `snapshots` with a single entry `[state]`, reset `cursor` to 0.
  - This is what you call on initial load and after `Save` succeeds — both
    situations where the "current state" is the canonical state.
- `markSaved()`:
  - Records `savedSnapshot = deepClone(state)`. `isDirty` is then
    `state !== savedSnapshot` (compared by JSON — see §7).

### `isDirty` correctness

`isDirty` must remain true even after the user undoes back to the saved
snapshot, because Aurora's Save button is highlighted exactly when the
current state is not the last saved state. We track `savedSnapshot` and
compare structurally.

## 7. Snapshot format

Snapshots are **plain serializable JSON** (`Primitive[]` plus a view object).
No Cesium entities, no class instances, no refs. This makes:

- `JSON.stringify` safe for the dirty comparison.
- The Save handler able to POST the snapshot directly to a future `/api/save`
  endpoint.
- Undo/redo cross-tab safe (later — localStorage listener in a follow-up).

## 8. Visual parity (the toolbar)

The `<UndoRedoToolbar />` React component renders three icon+label buttons in
a row. Visual style mirrors Aurora's flat-icon + text-label:

- **Layout:** horizontal row, fixed to the top of the canvas (z-index 50, top: 10,
  left: 10) as a chip.
- **Icon:** `lucide-react` — `Save`, `Undo2`, `Redo2`.
- **Label:** small uppercase text under the icon (Aurora uses 9–10px caps).
- **Disabled state:** `opacity: 0.35; cursor: not-allowed` (Aurora greys them out).
- **Save highlight:** when `isDirty`, the Save button shows a green tint and
  the `Save` icon is swapped to `Check` (matches frame 142's green check).
- **Click behaviour:**
  - Save → `markSaved()` + a user-supplied `onSave(snapshot)` callback (the
    surface decides what persistence means — out of this slice's scope).
  - Undo → `undo()`.
  - Redo → `redo()`.

The component is a controlled view of the `HistoryStore` — it re-renders
on `state`, `canUndo`, `canRedo`, or `isDirty` change. A small
`useHistoryStore(store, selector)` hook (also pure, no React in core) bridges
the gap and is shipped in `lib/state/Buttons.tsx`.

## 9. Aurora parity score (planned)

| Aurora behaviour                              | This slice                           | Match |
| --------------------------------------------- | ------------------------------------ | ----- |
| Save / Undo / Redo buttons in top bar         | yes — `<UndoRedoToolbar />` mounted in canvas | 100% |
| Undo reverts last primitive action            | yes — `dispatch(ADD/REMOVE/MOVE/UPDATE)` | 100% |
| Redo re-applies last undone action            | yes — `redo()`                       | 100% |
| Save persists design state                    | partial — `onSave(snapshot)` callback exposed; persistence wiring is out of scope | 50% (we expose the seam) |
| Save button highlights when unsaved           | yes — green tint + check icon        | 100% |
| Undo/Redo disabled at buffer ends             | yes — `canUndo`/`canRedo` flags      | 100% |
| ~50-step ring buffer                          | yes — `bufferSize=50` default        | 100% |
| Snapshots are complete primitive states       | yes — full `SceneState` per slot     | 100% |

**Parity at end of slice: 100% of in-scope behaviour; 50% on persistence
(which is owned by a different slice and we expose the seam cleanly).**

## 10. Out of scope (deliberately)

- Network persistence (HTTP POST to `/api/save`) — exposed as `onSave` callback.
- localStorage sync across tabs — easy follow-up, ring buffer already
  serializes to JSON.
- Redo stack visualization (the "history flyout" in some editors) — Aurora
  doesn't have it, so we don't either.
- Per-primitive-type reducers (block / gable / hip / tree). One generic
  reducer is enough for Aurora parity; specialized reducers can be a later
  follow-up if needed.
- Wiring actual existing `setState` calls in `SolarEngine3D` to dispatch
  through this store. That is mechanical and lives in a follow-up commit
  once the rest of the design surface converges on `SceneState`.

## 11. Test plan (covered in `tests/undoSystem.test.ts`)

1. `createHistoryStore` returns the initial state untouched.
2. `dispatch({type:'ADD', primitive})` adds and selects the primitive.
3. `dispatch({type:'ADD', primitive})` with a duplicate id is a no-op.
4. `dispatch({type:'REMOVE', id})` removes + clears selection if it was selected.
5. `dispatch({type:'MOVE', id, to})` updates lat/lng of the named primitive.
6. `dispatch({type:'UPDATE', id, patch})` shallow-merges the patch.
7. `dispatch({type:'SELECT', id})` updates the selected id.
8. `dispatch({type:'SET_VIEW', patch})` merges view flags.
9. `dispatch({type:'BULK', state})` replaces the entire state.
10. `undo()` walks one step back; no-op at cursor 0.
11. `redo()` walks one step forward; no-op at top.
12. After a fresh `dispatch`, the redo stack is truncated.
13. Ring buffer overflow (default 50): the 51st dispatch drops the oldest
    snapshot, cursor stays valid, `canUndo` remains true.
14. `isDirty` is true after any dispatch; `markSaved()` clears it; the next
    dispatch sets it back to true.
15. `replaceState(s)` resets the buffer to a single snapshot and clears
    `isDirty`.
16. The store is pure-functional: dispatching with the same input twice
    produces the same `state` both times.
17. The reducer is referentially stable for actions that do not change the
    affected primitive (e.g. ADD with a duplicate id returns the same
    `primitives` array reference).
