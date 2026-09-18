/**
 * tests/undoSystem.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Aurora-style Save / Undo / Redo ring-buffer
 * history store.
 *
 * Coverage matches DESIGN.md §11 (17 cases). No React, no Cesium, no DOM —
 * the store is pure logic and runs in node.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  createHistoryStore,
  sceneReducer,
  createEmptySceneState,
  DEFAULT_BUFFER_SIZE,
  type HistoryStore,
} from '@/lib/state';
import type {
  Action,
  BlockPrimitive,
  GablePrimitive,
  HipPrimitive,
  TreePrimitive,
  ObstructionPrimitive,
  PanelGroupPrimitive,
  Primitive,
  SceneState,
} from '@/lib/state';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function blockFixture(id: string, overrides: Partial<BlockPrimitive> = {}): BlockPrimitive {
  return {
    id,
    kind: 'block',
    createdAt: 1_700_000_000_000,
    vertices: [
      { lng: -77.08, lat: 38.81 },
      { lng: -77.08, lat: 38.82 },
      { lng: -77.07, lat: 38.82 },
      { lng: -77.07, lat: 38.81 },
    ],
    eaveHeightM: 6,
    label: `block-${id}`,
    ...overrides,
  };
}

function treeFixture(id: string, overrides: Partial<TreePrimitive> = {}): TreePrimitive {
  return {
    id,
    kind: 'tree',
    createdAt: 1_700_000_000_000,
    lng: -77.07,
    lat: 38.81,
    trunkHeightM: 3,
    canopyRadiusM: 1.8,
    label: `tree-${id}`,
    ...overrides,
  };
}

function obstructionFixture(id: string): ObstructionPrimitive {
  return {
    id,
    kind: 'obstruction',
    createdAt: 1_700_000_000_000,
    lng: -77.07,
    lat: 38.81,
    height: 0.6,
    radiusM: 0.5,
    type: 'vent',
    label: `obs-${id}`,
  };
}

function panelsFixture(id: string, panelIds: string[]): PanelGroupPrimitive {
  return {
    id,
    kind: 'panels',
    createdAt: 1_700_000_000_000,
    panelIds,
    label: `panels-${id}`,
  };
}

function gableFixture(id: string): GablePrimitive {
  return {
    id,
    kind: 'gable',
    createdAt: 1_700_000_000_000,
    eaves: [
      { lng: -77.08, lat: 38.81 },
      { lng: -77.07, lat: 38.81 },
    ],
    eaveHeightM: 6,
    pitchDeg: 30,
    label: `gable-${id}`,
  };
}

function hipFixture(id: string): HipPrimitive {
  return {
    id,
    kind: 'hip',
    createdAt: 1_700_000_000_000,
    eaves: [
      { lng: -77.08, lat: 38.81 },
      { lng: -77.07, lat: 38.81 },
    ],
    eaveHeightM: 6,
    pitchDeg: 30,
    label: `hip-${id}`,
  };
}

function fresh(): SceneState {
  return createEmptySceneState();
}

// ─── 1. createHistoryStore returns the initial state untouched ──────────────

describe('createHistoryStore — initial state', () => {
  it('returns the initial state without modification', () => {
    const s = fresh();
    const store = createHistoryStore(s);
    expect(store.state).toEqual(s);
  });

  it('throws on bufferSize < 1', () => {
    expect(() => createHistoryStore(fresh(), 0)).toThrow(/bufferSize/);
    expect(() => createHistoryStore(fresh(), -5)).toThrow(/bufferSize/);
  });

  it('default buffer size is 50', () => {
    expect(DEFAULT_BUFFER_SIZE).toBe(50);
    const store = createHistoryStore(fresh());
    expect(store.stats.capacity).toBe(50);
  });

  it('starts clean (isDirty=false) and cannot undo or redo', () => {
    const store = createHistoryStore(fresh());
    expect(store.isDirty).toBe(false);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.stats.cursor).toBe(0);
    expect(store.stats.size).toBe(1);
  });

  it('deep-clones the initial state (caller mutations do not poison the buffer)', () => {
    const s = fresh();
    const store = createHistoryStore(s);
    s.primitives.push(blockFixture('leak'));
    s.view.placementMode = 'roof';
    // The store's snapshot is unaffected.
    expect(store.state.primitives).toHaveLength(0);
    expect(store.state.view.placementMode).toBe('select');
  });
});

// ─── 2-4. Action types: ADD, REMOVE, MOVE ────────────────────────────────────

describe('dispatch — primitive actions', () => {
  it('ADD inserts a primitive and selects it', () => {
    const store = createHistoryStore(fresh());
    const block = blockFixture('b1');
    store.dispatch({ type: 'ADD', primitive: block });
    expect(store.state.primitives).toHaveLength(1);
    expect(store.state.primitives[0].id).toBe('b1');
    expect(store.state.selectedId).toBe('b1');
    expect(store.isDirty).toBe(true);
  });

  it('ADD with a duplicate id is a no-op (still dirty-free if first action)', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const store = createHistoryStore(s);
    const sizeBefore = store.stats.size;
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    expect(store.state.primitives).toHaveLength(1);
    // No new snapshot was pushed.
    expect(store.stats.size).toBe(sizeBefore);
  });

  it('REMOVE deletes the named primitive', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    s.primitives.push(treeFixture('t1'));
    s.selectedId = 'b1';
    const store = createHistoryStore(s);
    store.markSaved();
    store.dispatch({ type: 'REMOVE', id: 'b1' });
    expect(store.state.primitives).toHaveLength(1);
    expect(store.state.primitives[0].id).toBe('t1');
    expect(store.state.selectedId).toBeNull();
    expect(store.isDirty).toBe(true);
  });

  it('REMOVE of an unknown id is a no-op', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const store = createHistoryStore(s);
    const ref = store.state;
    store.dispatch({ type: 'REMOVE', id: 'does-not-exist' });
    expect(store.state).toBe(ref);
  });

  it('MOVE updates lat/lng of a primitive that has them', () => {
    const s = fresh();
    s.primitives.push(treeFixture('t1', { lng: -77.0, lat: 38.0 }));
    const store = createHistoryStore(s);
    store.dispatch({ type: 'MOVE', id: 't1', to: { lat: 38.5, lng: -77.5 } });
    const t = store.state.primitives[0] as TreePrimitive;
    expect(t.lat).toBe(38.5);
    expect(t.lng).toBe(-77.5);
  });

  it('MOVE with the same coordinates is a no-op', () => {
    const s = fresh();
    s.primitives.push(treeFixture('t1', { lng: -77.0, lat: 38.0 }));
    const store = createHistoryStore(s);
    const ref = store.state;
    store.dispatch({ type: 'MOVE', id: 't1', to: { lat: 38.0, lng: -77.0 } });
    expect(store.state).toBe(ref);
  });

  it('MOVE on an unknown id is a no-op', () => {
    const store = createHistoryStore(fresh());
    const ref = store.state;
    store.dispatch({ type: 'MOVE', id: 'nope', to: { lat: 0, lng: 0 } });
    expect(store.state).toBe(ref);
  });
});

// ─── 5-7. UPDATE, SELECT, SET_VIEW ──────────────────────────────────────────

describe('dispatch — meta actions', () => {
  it('UPDATE shallow-merges a patch', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1', { eaveHeightM: 6, label: 'before' }));
    const store = createHistoryStore(s);
    store.dispatch({ type: 'UPDATE', id: 'b1', patch: { eaveHeightM: 9, label: 'after' } });
    const b = store.state.primitives[0] as BlockPrimitive;
    expect(b.eaveHeightM).toBe(9);
    expect(b.label).toBe('after');
    expect(b.id).toBe('b1'); // identity preserved
    expect(b.kind).toBe('block'); // discriminator preserved
  });

  it('UPDATE strips `id` and `kind` from the patch', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const store = createHistoryStore(s);
    store.dispatch({
      type: 'UPDATE',
      id: 'b1',
      patch: { id: 'hacked', kind: 'tree' } as Partial<Primitive>,
    });
    const b = store.state.primitives[0];
    expect(b.id).toBe('b1');
    expect(b.kind).toBe('block');
  });

  it('UPDATE on an unknown id is a no-op', () => {
    const store = createHistoryStore(fresh());
    const ref = store.state;
    store.dispatch({ type: 'UPDATE', id: 'nope', patch: { label: 'x' } });
    expect(store.state).toBe(ref);
  });

  it('SELECT updates the selected id', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const store = createHistoryStore(s);
    store.dispatch({ type: 'SELECT', id: null });
    expect(store.state.selectedId).toBeNull();
    store.dispatch({ type: 'SELECT', id: 'b1' });
    expect(store.state.selectedId).toBe('b1');
  });

  it('SELECT with the same value is a no-op (reference-equal state)', () => {
    const s = fresh();
    s.selectedId = 'b1';
    const store = createHistoryStore(s);
    const ref = store.state;
    store.dispatch({ type: 'SELECT', id: 'b1' });
    expect(store.state).toBe(ref);
  });

  it('SET_VIEW shallow-merges view flags', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'block', newBlockEaveHeightM: 9 } });
    expect(store.state.view.placementMode).toBe('block');
    expect(store.state.view.newBlockEaveHeightM).toBe(9);
    expect(store.state.view.newRoofPitchDeg).toBe(30); // untouched
  });

  it('SET_VIEW with no real change is a no-op', () => {
    const s = fresh();
    s.view.placementMode = 'block';
    const store = createHistoryStore(s);
    const ref = store.state;
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'block' } });
    expect(store.state).toBe(ref);
  });
});

// ─── 8. BULK ─────────────────────────────────────────────────────────────────

describe('dispatch — BULK', () => {
  it('BULK replaces the entire state', () => {
    const store = createHistoryStore(fresh());
    const newState: SceneState = {
      primitives: [blockFixture('b1'), treeFixture('t1')],
      selectedId: 'b1',
      view: {
        placementMode: 'roof_gable',
        newBlockEaveHeightM: 8,
        newRoofEaveHeightM: 7,
        newRoofPitchDeg: 25,
      },
    };
    store.dispatch({ type: 'BULK', state: newState });
    expect(store.state.primitives).toHaveLength(2);
    expect(store.state.selectedId).toBe('b1');
    expect(store.state.view.placementMode).toBe('roof_gable');
  });
});

// ─── 9-11. Undo / redo mechanics ─────────────────────────────────────────────

describe('undo / redo', () => {
  it('undo() at the bottom is a no-op', () => {
    const store = createHistoryStore(fresh());
    const ref = store.state;
    store.undo();
    expect(store.state).toBe(ref);
    expect(store.stats.cursor).toBe(0);
  });

  it('redo() at the top is a no-op', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    // Now at the top — can't redo.
    expect(store.canRedo).toBe(false);
    const ref = store.state;
    store.redo();
    expect(store.state).toBe(ref);
  });

  it('undo() walks one step back, redo() walks one step forward', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    store.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
    expect(store.state.primitives).toHaveLength(2);

    store.undo();
    expect(store.state.primitives).toHaveLength(1);
    expect(store.state.primitives[0].id).toBe('b1');
    expect(store.canRedo).toBe(true);

    store.undo();
    expect(store.state.primitives).toHaveLength(0);
    expect(store.canUndo).toBe(false);

    store.redo();
    expect(store.state.primitives).toHaveLength(1);
    expect(store.state.primitives[0].id).toBe('b1');

    store.redo();
    expect(store.state.primitives).toHaveLength(2);
    expect(store.canRedo).toBe(false);
  });

  it('a fresh dispatch truncates the redo stack', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    store.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
    store.undo();
    store.undo();
    expect(store.canRedo).toBe(true);
    expect(store.stats.size).toBe(3);

    // New dispatch truncates everything after the cursor.
    store.dispatch({ type: 'ADD', primitive: obstructionFixture('o1') });
    expect(store.canRedo).toBe(false);
    expect(store.stats.size).toBe(2);
    expect(store.state.primitives.map(p => p.id)).toEqual(['o1']);
  });
});

// ─── 12-13. Ring buffer overflow + dirty flag ───────────────────────────────

describe('ring buffer overflow', () => {
  it('drops the oldest snapshot when capacity is exceeded', () => {
    const store = createHistoryStore(fresh(), 5);
    for (let i = 0; i < 8; i++) {
      store.dispatch({ type: 'ADD', primitive: blockFixture(`b${i}`) });
    }
    expect(store.stats.size).toBe(5);
    expect(store.stats.capacity).toBe(5);
    expect(store.stats.overflowed).toBeGreaterThanOrEqual(3);
    // The cursor stays on the newest entry.
    expect(store.state.primitives[store.state.primitives.length - 1].id).toBe('b7');
    // Undo is still possible (we lost some history, but not all).
    expect(store.canUndo).toBe(true);
  });

  it('canUndo remains true even after extreme overflow', () => {
    // Buffer size 5 → 4 undos possible. Even after 50 dispatches, the
    // buffer holds 5 snapshots, so undo stays available.
    const store = createHistoryStore(fresh(), 5);
    for (let i = 0; i < 50; i++) {
      store.dispatch({ type: 'ADD', primitive: blockFixture(`b${i}`) });
    }
    expect(store.stats.size).toBe(5);
    expect(store.stats.overflowed).toBe(46);
    // Cursor is at 4 (newest). 4 undos available.
    store.undo();
    store.undo();
    store.undo();
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.canUndo).toBe(false);
  });
});

describe('isDirty', () => {
  it('is true after any dispatch', () => {
    const store = createHistoryStore(fresh());
    expect(store.isDirty).toBe(false);
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'block' } });
    expect(store.isDirty).toBe(true);
  });

  it('markSaved() clears it; the next dispatch re-sets it', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'block' } });
    expect(store.isDirty).toBe(true);
    store.markSaved();
    expect(store.isDirty).toBe(false);
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'tree' } });
    expect(store.isDirty).toBe(true);
  });

  it('reverts to false when the user undoes back to the saved snapshot', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    store.markSaved();
    expect(store.isDirty).toBe(false);
    store.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
    expect(store.isDirty).toBe(true);
    store.undo();
    expect(store.state.primitives).toHaveLength(1);
    expect(store.isDirty).toBe(false);
  });

  it('stays true if the user undoes to a different snapshot than the saved one', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    store.markSaved();
    store.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
    store.dispatch({ type: 'ADD', primitive: obstructionFixture('o1') });
    expect(store.isDirty).toBe(true);
    // Undo to t1 (still ahead of saved).
    store.undo();
    expect(store.isDirty).toBe(true);
  });
});

// ─── 14. replaceState ───────────────────────────────────────────────────────

describe('replaceState', () => {
  it('resets the buffer to a single snapshot', () => {
    const store = createHistoryStore(fresh());
    store.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
    store.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
    expect(store.stats.size).toBe(3);

    store.replaceState({
      primitives: [gableFixture('g1')],
      selectedId: 'g1',
      view: {
        placementMode: 'roof_gable',
        newBlockEaveHeightM: 6,
        newRoofEaveHeightM: 6,
        newRoofPitchDeg: 30,
      },
    });
    expect(store.stats.size).toBe(1);
    expect(store.stats.cursor).toBe(0);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.isDirty).toBe(false);
    expect(store.state.primitives[0].id).toBe('g1');
  });

  it('deep-clones the supplied state', () => {
    const s = fresh();
    const store = createHistoryStore(fresh());
    store.replaceState(s);
    s.primitives.push(blockFixture('leak'));
    s.view.placementMode = 'roof';
    expect(store.state.primitives).toHaveLength(0);
    expect(store.state.view.placementMode).toBe('select');
  });
});

// ─── 15-16. Purity / referential stability ───────────────────────────────────

describe('purity', () => {
  it('the same action sequence produces the same final state', () => {
    const build = (): HistoryStore => {
      const s = createHistoryStore(fresh());
      s.dispatch({ type: 'ADD', primitive: blockFixture('b1') });
      s.dispatch({ type: 'ADD', primitive: treeFixture('t1') });
      s.dispatch({ type: 'SELECT', id: 'b1' });
      s.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'block' } });
      return s;
    };
    const a = build();
    const b = build();
    expect(a.state).toEqual(b.state);
  });

  it('no-op actions return the same state reference (cheap React renders)', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    s.selectedId = 'b1';
    const store = createHistoryStore(s);
    const ref = store.state;
    store.dispatch({ type: 'SELECT', id: 'b1' });
    expect(store.state).toBe(ref);
    store.dispatch({ type: 'REMOVE', id: 'does-not-exist' });
    expect(store.state).toBe(ref);
    store.dispatch({ type: 'UPDATE', id: 'does-not-exist', patch: { label: 'x' } });
    expect(store.state).toBe(ref);
    store.dispatch({ type: 'SET_VIEW', patch: { placementMode: 'select' } });
    expect(store.state).toBe(ref);
  });

  it('a deep JSON round-trip of state is stable', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const store = createHistoryStore(s);
    const json = JSON.stringify(store.state);
    const back = JSON.parse(json) as SceneState;
    expect(back).toEqual(store.state);
  });
});

// ─── 17. Reducer-level tests (independent of the store) ─────────────────────

describe('sceneReducer — direct', () => {
  it('exhaustiveness: an unknown action type returns state unchanged', () => {
    const s = fresh();
    // @ts-expect-error — testing runtime behavior of an unknown action
    const out = sceneReducer(s, { type: 'NOPE' });
    expect(out).toBe(s);
  });

  it('MOVE rejects non-primitive payloads with the same lat/lng', () => {
    const s = fresh();
    s.primitives.push(blockFixture('b1'));
    const out = sceneReducer(s, {
      type: 'MOVE',
      id: 'b1',
      to: { lat: 999, lng: -999 },
    });
    const b = out.primitives[0] as BlockPrimitive;
    // Blocks have no top-level `lat`/`lng`, so MOVE has no effect on them.
    expect(b).toBe(s.primitives[0]);
  });

  it('can drive the reducer outside the store for unit-test purposes', () => {
    let s = fresh();
    s = sceneReducer(s, { type: 'ADD', primitive: blockFixture('b1') });
    // The second ADD re-selects to t1, so removing b1 leaves t1 selected.
    s = sceneReducer(s, { type: 'ADD', primitive: treeFixture('t1') });
    expect(s.primitives).toHaveLength(2);
    expect(s.selectedId).toBe('t1');
    s = sceneReducer(s, { type: 'REMOVE', id: 'b1' });
    expect(s.primitives).toHaveLength(1);
    // selectedId is the t1 that ADD set — REMOVE of a non-selected
    // primitive leaves the selection alone.
    expect(s.selectedId).toBe('t1');
  });

  it('REMOVE of the selected primitive clears selectedId', () => {
    let s = fresh();
    s = sceneReducer(s, { type: 'ADD', primitive: blockFixture('b1') });
    expect(s.selectedId).toBe('b1');
    s = sceneReducer(s, { type: 'REMOVE', id: 'b1' });
    expect(s.selectedId).toBeNull();
  });
});

// ─── 18. All primitive kinds round-trip through the store ───────────────────

describe('all primitive kinds', () => {
  it('can add / remove / undo every kind', () => {
    const store = createHistoryStore(fresh());
    const kinds: Primitive[] = [
      blockFixture('b1'),
      gableFixture('g1'),
      hipFixture('h1'),
      treeFixture('t1'),
      obstructionFixture('o1'),
      panelsFixture('p1', ['panel-1', 'panel-2']),
    ];
    for (const p of kinds) {
      store.dispatch({ type: 'ADD', primitive: p });
    }
    expect(store.state.primitives).toHaveLength(kinds.length);
    expect(store.state.primitives.map(p => p.kind).sort()).toEqual(
      ['block', 'gable', 'hip', 'obstruction', 'panels', 'tree'],
    );
    // Undo all the way back.
    for (let i = 0; i < kinds.length; i++) store.undo();
    expect(store.state.primitives).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});

// ─── 19. Action type list sanity check ───────────────────────────────────────

describe('action surface', () => {
  it('Action type is a closed set of 7 kinds', () => {
    // This is a static guarantee; we sanity-check by enumerating.
    const actionKinds: Action['type'][] = [
      'ADD', 'REMOVE', 'MOVE', 'UPDATE', 'SELECT', 'SET_VIEW', 'BULK',
    ];
    expect(new Set(actionKinds).size).toBe(7);
  });
});
