/**
 * lib/state/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Barrel re-export for the undo/redo feature.
 *
 * Public surface (see DESIGN.md):
 *   - createHistoryStore, sceneReducer        (historyStore.ts)
 *   - HistoryStore, HistoryStats              (historyStore.ts)
 *   - SceneState, Action, Primitive, …       (types.ts)
 *   - UndoRedoToolbar, dispatchAndNotify      (Buttons.tsx)
 */

'use client';

export {
  createHistoryStore,
  sceneReducer,
  DEFAULT_BUFFER_SIZE,
  type HistoryStore,
  type HistoryStats,
} from './historyStore';

export {
  createEmptySceneState,
  type SceneState,
  type SceneView,
  type Action,
  type Primitive,
  type PrimitiveKind,
  type BasePrimitive,
  type BlockPrimitive,
  type GablePrimitive,
  type HipPrimitive,
  type TreePrimitive,
  type ObstructionPrimitive,
  type PanelGroupPrimitive,
} from './types';

export {
  UndoRedoToolbar,
  dispatchAndNotify,
  type UndoRedoToolbarProps,
} from './Buttons';
