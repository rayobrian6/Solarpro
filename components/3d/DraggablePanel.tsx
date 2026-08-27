'use client';

/**
 * components/3d/DraggablePanel.tsx
 *
 * Generic "drag-to-move" wrapper for the 3D canvas chrome.
 *
 * Design: doesn't replace or move the panel's CSS position. The panel
 * is rendered exactly where the parent placed it, then a CSS transform
 * (`translate(dx, dy)`) is added on top based on how far the user has
 * dragged it. The original position stays intact, so the panel starts
 * where the existing layout put it and the user can fine-tune.
 *
 * The drag handle is the panel's first direct child (or any element
 * with the `data-drag-handle` attribute). Clicking buttons/inputs
 * inside the handle does NOT start a drag.
 *
 * Position offsets are persisted to localStorage under
 * `draggable-panel-offset-v1` keyed by `id`, so the layout survives
 * page reloads.
 *
 * No external deps, no portal, no resize observer. Direct DOM via
 * React state, no CSS transition during drag (1:1 cursor tracking).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface DraggablePanelProps {
  /** Stable string id; used for the localStorage key. */
  id: string;
  /** Z-index forwarded to the wrapper. Default 50. */
  zIndex?: number;
  /** Optional className for the wrapper. */
  className?: string;
  /** Optional style merged into the wrapper. */
  style?: React.CSSProperties;
  /** Panel content. The first direct child becomes the drag handle. */
  children: React.ReactNode;
}

interface Offset { x: number; y: number; }

const STORAGE_KEY = 'draggable-panel-offset-v1';

function readAllOffsets(): Record<string, Offset> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, Offset>;
  } catch {
    /* ignore */
  }
  return {};
}

function writeAllOffsets(all: Record<string, Offset>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

export function DraggablePanel({
  id,
  zIndex = 50,
  className,
  style,
  children,
}: DraggablePanelProps) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const hydratedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const all = readAllOffsets();
    if (all[id] && Number.isFinite(all[id].x) && Number.isFinite(all[id].y)) {
      setOffset(all[id]);
    }
  }, [id]);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const all = readAllOffsets();
    all[id] = offset;
    writeAllOffsets(all);
  }, [id, offset]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Pointermove/up listener installed on window while dragging.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      setOffset({ x: drag.startOffsetX + dx, y: drag.startOffsetY + dy });
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  // Event-delegated pointerdown on the wrapper. The drag handle is the
  // first child by default; if a child (or descendant) has
  // `data-drag-handle` set, that element becomes the handle instead.
  // Interactive children (button/input/select/textarea/a/label/
  // [data-no-drag]) inside the handle do NOT start a drag — they keep
  // their own click semantics.
  const onWrapperPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement;
      // If an explicit handle is marked, only start drag when the
      // pointerdown target is inside the handle. If no handle is
      // marked, fall back to "pointerdown is on the wrapper" — i.e.
      // the first child wrapped in a default handle div.
      const explicitHandle = (e.currentTarget as HTMLElement).querySelector('[data-drag-handle]');
      if (explicitHandle) {
        if (!explicitHandle.contains(target) && target !== explicitHandle) return;
      }
      // Don't drag if the user clicked an interactive child
      if (target.closest('button, input, select, textarea, a, label, [data-no-drag]')) {
        return;
      }
      e.preventDefault();
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffsetX: offset.x,
        startOffsetY: offset.y,
      };
      setDragging(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture may fail in some browsers */
      }
    },
    [offset.x, offset.y],
  );

  // Wrap the first child in a drag-handle div, render the rest as-is.
  // If a child already has `data-drag-handle`, skip the auto-wrap so
  // the user-specified handle is preserved.
  const childArray = React.Children.toArray(children);
  const first = childArray[0];
  const rest = childArray.slice(1);

  const hasExplicitHandle = React.Children.toArray(children).some((c) => {
    if (!React.isValidElement(c)) return false;
    return (c.props as { 'data-drag-handle'?: unknown })?.['data-drag-handle'] === true;
  });

  if (!first) {
    return (
      <div
        ref={wrapperRef}
        className={className}
        onPointerDown={onWrapperPointerDown}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          zIndex,
          cursor: dragging ? 'grabbing' : 'default',
          userSelect: dragging ? 'none' : 'auto',
          touchAction: 'none',
          ...style,
        }}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={className}
      onPointerDown={hasExplicitHandle ? undefined : onWrapperPointerDown}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        zIndex,
        cursor: dragging ? 'grabbing' : 'default',
        userSelect: dragging ? 'none' : 'auto',
        touchAction: 'none',
        ...style,
      }}
    >
      {hasExplicitHandle ? (
        <>
          {childArray}
        </>
      ) : (
        <>
          <div
            data-drag-handle
            role="button"
            tabIndex={0}
            aria-label="Drag panel"
            onPointerDown={onWrapperPointerDown}
            style={{
              cursor: dragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            {first}
          </div>
          {rest}
        </>
      )}
    </div>
  );
}
