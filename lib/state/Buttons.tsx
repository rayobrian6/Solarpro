/**
 * lib/state/Buttons.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Aurora-style Save / Undo / Redo toolbar.
 *
 * Renders three icon+label buttons in a horizontal row. Visual states:
 *   - Save: muted when clean, green-tinted with a check icon when isDirty.
 *   - Undo: disabled (opacity 0.35) when canUndo is false.
 *   - Redo: disabled (opacity 0.35) when canRedo is false.
 *
 * The component is a *thin* React view of a `HistoryStore`. It subscribes to
 * the store via a `useStoreSelector` helper (declared in this file) and
 * re-renders only when the selector output changes.
 *
 * Mount the toolbar in `SolarEngine3D.tsx` exactly once, near the existing
 * collapsible toolbar.
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Save, Undo2, Redo2, Check } from 'lucide-react';
import type { HistoryStore, HistoryStats } from './historyStore';
import type { SceneState } from './types';

// ─── Subscription helper (no React in core) ──────────────────────────────────

type Listener = () => void;

/**
 * Subscribe to a HistoryStore with a derived selector. Returns the latest
 * selected value; the component re-renders only when the selected slice
 * changes by reference.
 *
 * Why not just useState on the whole store? The store is mutated in place
 * (the `state` field is a getter) — we need a render-triggering signal.
 */
function useStoreSelector<T>(
  store: HistoryStore,
  select: (s: { state: SceneState; canUndo: boolean; canRedo: boolean; isDirty: boolean; stats: HistoryStats }) => T,
): T {
  const [value, setValue] = useState<T>(() => select(store));
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    let prev = selectRef.current(store);
    const listener: Listener = () => {
      const next = selectRef.current(store);
      if (!Object.is(prev, next)) {
        prev = next;
        setValue(next as React.SetStateAction<T>);
      }
    };
    // We don't have a real subscription API on the store; poll on a microtask
    // after every dispatch via a MutationObserver-style hack. Instead, the
    // caller wraps dispatch in `dispatchAndNotify` (see export below), and
    // we subscribe to that custom event.
    const handler = () => listener();
    if (typeof window !== 'undefined') {
      window.addEventListener('solarpro:history-changed', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('solarpro:history-changed', handler);
      }
    };
  }, [store]);

  return value;
}

/**
 * Wrap a dispatch call so the toolbar re-renders. Use this from the host
 * component instead of calling `store.dispatch` directly.
 */
export function dispatchAndNotify(store: HistoryStore, action: Parameters<HistoryStore['dispatch']>[0]): void {
  store.dispatch(action);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('solarpro:history-changed'));
  }
}

function notifyHistoryChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('solarpro:history-changed'));
  }
}

// ─── Visual style ────────────────────────────────────────────────────────────

const TOOLBAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'row',
  gap: 4,
  alignItems: 'center',
  background: 'rgba(15,15,30,0.92)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '4px 6px',
  pointerEvents: 'auto',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const BTN_BASE: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: '#e0e0e0',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  transition: 'background 0.15s, color 0.15s, opacity 0.15s',
  padding: 0,
};

const BTN_DISABLED: React.CSSProperties = {
  opacity: 0.35,
  cursor: 'not-allowed',
};

const BTN_DIRTY: React.CSSProperties = {
  background: 'rgba(34,197,94,0.18)',
  color: '#4ade80',
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface UndoRedoToolbarProps {
  store: HistoryStore;
  /**
   * Called when the user clicks Save. The host decides what persistence
   * means (POST to /api/save, write to localStorage, etc.). After the
   * caller has successfully saved, it should call `store.markSaved()` —
   * we do NOT call it automatically because the host may want to surface
   * a failure first.
   */
  onSave?: (snapshot: SceneState) => void | Promise<void>;
  /**
   * Optional: hide the toolbar entirely (e.g. while a modal is open).
   * Defaults to false.
   */
  hidden?: boolean;
  /**
   * Optional override of the toolbar position. Default: top-left (10,10).
   */
  style?: React.CSSProperties;
}

export function UndoRedoToolbar(props: UndoRedoToolbarProps): React.ReactElement | null {
  const { store, onSave, hidden, style } = props;

  // One selector for everything the toolbar needs. We split into three
  // separate `useStoreSelector` calls so the re-render only fires when the
  // specific value changes.
  const canUndo = useStoreSelector(store, s => s.canUndo);
  const canRedo = useStoreSelector(store, s => s.canRedo);
  const isDirty = useStoreSelector(store, s => s.isDirty);
  const stats = useStoreSelector(store, s => s.stats);

  const onUndo = useCallback(() => {
    if (!canUndo) return;
    store.undo();
    notifyHistoryChanged();
  }, [store, canUndo]);

  const onRedo = useCallback(() => {
    if (!canRedo) return;
    store.redo();
    notifyHistoryChanged();
  }, [store, canRedo]);

  const onClickSave = useCallback(() => {
    // Always mark saved + fire the callback. Hosts that want a "save
    // failure" flow can call `replaceState` to revert.
    if (onSave) {
      const result = onSave(store.state);
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => { store.markSaved(); notifyHistoryChanged(); },
          () => { /* host can show its own error */ },
        );
      } else {
        store.markSaved();
        notifyHistoryChanged();
      }
    } else {
      // No persistence wired up — just mark clean so the highlight clears.
      store.markSaved();
      notifyHistoryChanged();
    }
  }, [onSave, store]);

  if (hidden) return null;

  const undoStyle: React.CSSProperties = canUndo ? BTN_BASE : { ...BTN_BASE, ...BTN_DISABLED };
  const redoStyle: React.CSSProperties = canRedo ? BTN_BASE : { ...BTN_BASE, ...BTN_DISABLED };
  const saveStyle: React.CSSProperties = isDirty ? { ...BTN_BASE, ...BTN_DIRTY } : BTN_BASE;

  // Save icon swaps to a green check when dirty (mirrors frame 142).
  const SaveIcon = isDirty ? Check : Save;

  return (
    <div
      data-testid="undo-redo-toolbar"
      data-undo-count={stats.size - 1 - stats.cursor}     // how many undos available
      data-redo-count={stats.cursor < stats.size - 1 ? stats.size - 1 - stats.cursor : 0}
      data-is-dirty={isDirty ? 'true' : 'false'}
      style={{ ...TOOLBAR_STYLE, ...style }}
      role="toolbar"
      aria-label="Scene history"
    >
      <button
        type="button"
        onClick={onClickSave}
        style={saveStyle}
        aria-label={isDirty ? 'Save (unsaved changes)' : 'Save'}
        title={isDirty ? 'Save (unsaved changes)' : 'Save'}
        data-testid="save-button"
        data-dirty={isDirty ? 'true' : 'false'}
      >
        <SaveIcon size={16} strokeWidth={2} aria-hidden="true" />
        <span>Save</span>
      </button>

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        style={undoStyle}
        aria-label="Undo"
        title={`Undo${canUndo ? '' : ' (nothing to undo)'}`}
        data-testid="undo-button"
        data-enabled={canUndo ? 'true' : 'false'}
      >
        <Undo2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Undo</span>
      </button>

      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        style={redoStyle}
        aria-label="Redo"
        title={`Redo${canRedo ? '' : ' (nothing to redo)'}`}
        data-testid="redo-button"
        data-enabled={canRedo ? 'true' : 'false'}
      >
        <Redo2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Redo</span>
      </button>
    </div>
  );
}

export default UndoRedoToolbar;
