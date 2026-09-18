'use client';
/**
 * components/3d/editing/VertexHandles.tsx
 *
 * In-place footprint editor for 3D primitives (Block, Gable, Hip, Tree).
 * For each placed primitive spec, render one Cesium Point primitive per
 * vertex. Click + drag a handle → onVertexUpdate fires with the new
 * (lat, lng) → parent updates the underlying entity's polygon.
 *
 * Aurora parity: HANDOFF_2026-08-25_AURORA_ANALYSIS.md §2 step 3.
 *
 * The component owns no state for the drag — refs only — so a long drag
 * does not trigger a React re-render. The parent receives the new vertex
 * via onVertexUpdate and updates the affected entity's polygon hierarchy
 * directly. This matches the existing block drag-to-resize pattern
 * (SolarEngine3D.tsx ~ line 3953).
 *
 * Math lives in lib/3d/vertexHandlesMath.ts. Tests live in
 * tests/vertexHandles.test.ts. This file is just the Cesium integration.
 */

import { useEffect, useRef } from 'react';
import {
  pickRayToLatLng,
  validateVertexMove,
  vertexDistanceM,
  dimensionReadoutFt,
  adjacentVertexIndices,
  type VertexTargetSpec,
} from '@/lib/3d/vertexHandlesMath';

export interface VertexHandlesProps {
  /** Cesium viewer instance. Pass the same ref SolarEngine3D already keeps. */
  viewer: any;
  /** Cesium namespace (window.Cesium) — pass it through to avoid window lookups. */
  C: any;
  /** Specs for every primitive whose vertices should be editable. */
  specs: VertexTargetSpec[];
  /** True when the editor should be active. Typically `placementMode === 'select'`. */
  enabled: boolean;
  /**
   * Called while a handle is being dragged, on every mouse-move.
   * Parent updates the affected Cesium entity's polygon hierarchy.
   * `newLat`/`newLng` are the validated, possibly-clamped lat/lng.
   * The parent's `h` for that vertex is preserved.
   */
  onVertexUpdate: (specId: string, vertexIdx: number, newLat: number, newLng: number) => void;
  /**
   * Called once when a drag starts. Parent can use this to show "↔ Edge: 41.3ft"
   * in the status bar.
   */
  onDragStart?: (specId: string, vertexIdx: number) => void;
  /**
   * Called once when a drag ends. Parent can use this to clear the status bar
   * or persist the new footprint.
   */
  onDragEnd?: (specId: string, vertexIdx: number) => void;
  /**
   * Called on each MOUSE_MOVE during a drag with the live distance to the
   * nearest adjacent vertex, formatted as "41.3ft". Parent can show this in
   * the status bar (mirrors Aurora frame_0095).
   */
  onDimensionReadout?: (readout: string) => void;
}

// Handle visual: black filled point with white outline, ~12 px.
const HANDLE_PIXEL_SIZE = 12;
const HANDLE_HOVER_PIXEL_SIZE = 14;
const HANDLE_COLOR = '#0a0a0a';
const HANDLE_OUTLINE_COLOR = '#ffffff';
const HANDLE_HOVER_COLOR = '#ff8c00';

interface RenderedHandle {
  /** Cesium Entity for the handle. */
  entity: any;
  /** Owning spec id. */
  specId: string;
  /** Index into spec.vertices. */
  vertexIdx: number;
}

export default function VertexHandles({
  viewer,
  C,
  specs,
  enabled,
  onVertexUpdate,
  onDragStart,
  onDragEnd,
  onDimensionReadout,
}: VertexHandlesProps) {
  // Refs (not state) so a long drag doesn't trigger a re-render.
  const handleEntitiesRef = useRef<RenderedHandle[]>([]);
  const handlerRef = useRef<any>(null);
  const dragStateRef = useRef<{
    specId: string;
    vertexIdx: number;
    originalLat: number;
    originalLng: number;
    startScreenPos: { x: number; y: number };
  } | null>(null);
  const specsRef = useRef<VertexTargetSpec[]>(specs);
  const onUpdateRef = useRef(onVertexUpdate);
  const onStartRef = useRef(onDragStart);
  const onEndRef = useRef(onDragEnd);
  const onReadoutRef = useRef(onDimensionReadout);
  const enabledRef = useRef(enabled);

  // Keep refs in sync with props so the drag closure always sees the latest values.
  useEffect(() => { specsRef.current = specs; }, [specs]);
  useEffect(() => { onUpdateRef.current = onVertexUpdate; }, [onVertexUpdate]);
  useEffect(() => { onStartRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { onEndRef.current = onDragEnd; }, [onDragEnd]);
  useEffect(() => { onReadoutRef.current = onDimensionReadout; }, [onDimensionReadout]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // ── 1. Sync handle entities with the current specs list ──────────────────
  useEffect(() => {
    if (!viewer || !C) return;

    // Remove any handles for specs that are no longer present.
    const specIds = new Set(specs.map(s => s.id));
    const survivors: RenderedHandle[] = [];
    for (const h of handleEntitiesRef.current) {
      if (specIds.has(h.specId)) survivors.push(h);
      else {
        try { viewer.entities.remove(h.entity); } catch { /* ignore */ }
      }
    }
    handleEntitiesRef.current = survivors;

    // Build a lookup from specId → set of existing (entityId, vertexIdx) pairs.
    const existingBySpec = new Map<string, Set<number>>();
    for (const h of survivors) {
      let s = existingBySpec.get(h.specId);
      if (!s) { s = new Set<number>(); existingBySpec.set(h.specId, s); }
      s.add(h.vertexIdx);
    }

    // Add handles for any new spec/vertex.
    for (const spec of specs) {
      let owned = existingBySpec.get(spec.id);
      if (!owned) { owned = new Set<number>(); existingBySpec.set(spec.id, owned); }
      for (let i = 0; i < spec.vertices.length; i++) {
        if (owned.has(i)) continue;
        const vert = spec.vertices[i];
        if (!isFiniteCoord(vert.lat, vert.lng)) continue;
        const pos = safeCartesian3(C, vert.lng, vert.lat, vert.h);
        if (!pos) continue;
        const entity = viewer.entities.add({
          id: `vertex-handle-${spec.id}-${i}`,
          name: `${spec.type} vertex ${i}`,
          position: pos,
          point: {
            pixelSize: HANDLE_PIXEL_SIZE,
            color: C.Color.fromCssColorString(HANDLE_COLOR),
            outlineColor: C.Color.fromCssColorString(HANDLE_OUTLINE_COLOR),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        // Tag the entity with specId + vertexIdx for the drag handler.
        try { (entity as any).__specId = spec.id; } catch { /* ignore */ }
        try { (entity as any).__vertexIdx = i; } catch { /* ignore */ }
        handleEntitiesRef.current.push({ entity, specId: spec.id, vertexIdx: i });
        owned.add(i);
      }
    }
  }, [viewer, C, specs]);

  // ── 2. Install / tear down the drag handler ──────────────────────────────
  useEffect(() => {
    if (!viewer || !C) return;

    const handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    // ── LEFT_DOWN: pick a vertex handle, start a drag ─────────────────────
    handler.setInputAction((event: any) => {
      if (!enabledRef.current) return;
      try {
        const screenPos = event.position;
        const picked = viewer.scene.pick(screenPos);
        if (!picked || !picked.id) return;
        const eid: string = picked.id.id || '';
        if (!eid.startsWith('vertex-handle-')) return;
        const specId = (picked.id as any).__specId as string | undefined;
        const vertexIdx = (picked.id as any).__vertexIdx as number | undefined;
        if (!specId || vertexIdx == null) return;
        const spec = specsRef.current.find(s => s.id === specId);
        if (!spec) return;
        const vert = spec.vertices[vertexIdx];
        if (!vert) return;
        dragStateRef.current = {
          specId,
          vertexIdx,
          originalLat: vert.lat,
          originalLng: vert.lng,
          startScreenPos: { x: screenPos.x, y: screenPos.y },
        };
        // Bump the handle's visual to "hover" so the user sees the grab.
        try {
          picked.id.point.pixelSize = HANDLE_HOVER_PIXEL_SIZE;
          picked.id.point.color = C.Color.fromCssColorString(HANDLE_HOVER_COLOR);
        } catch { /* ignore */ }
        if (onStartRef.current) {
          try { onStartRef.current(specId, vertexIdx); } catch { /* ignore */ }
        }
        try { viewer.scene.requestRender(); } catch { /* ignore */ }
      } catch { /* ignore — left-down is best-effort */ }
    }, C.ScreenSpaceEventType.LEFT_DOWN);

    // ── MOUSE_MOVE: drive the drag, update the handle position in real time ─
    handler.setInputAction((event: any) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      try {
        const screenPos = event.endPosition;
        const ray = viewer.camera.getPickRay(screenPos);
        if (!ray) return;
        const hit = pickRayToLatLng(ray, C.Cartographic.fromCartesian.bind(C.Cartographic), C.Math.toDegrees.bind(C.Math));
        if (!hit) return;
        const spec = specsRef.current.find(s => s.id === drag.specId);
        if (!spec) return;
        const validation = validateVertexMove(spec, drag.vertexIdx, hit.lat, hit.lng);
        if (!validation.accepted) return; // reject this frame, keep prior position

        // Update the handle's own visual position to follow the cursor.
        const handleEntry = handleEntitiesRef.current.find(
          h => h.specId === drag.specId && h.vertexIdx === drag.vertexIdx,
        );
        if (handleEntry) {
          const vert = spec.vertices[drag.vertexIdx];
          const newPos = safeCartesian3(C, validation.lng, validation.lat, vert.h);
          if (newPos) {
            try { handleEntry.entity.position = new C.ConstantPositionProperty(newPos); } catch { /* ignore */ }
          }
        }

        // Tell the parent to update the entity's polygon hierarchy.
        try { onUpdateRef.current(drag.specId, drag.vertexIdx, validation.lat, validation.lng); } catch { /* ignore */ }

        // Live dimension readout to the nearest adjacent vertex.
        if (onReadoutRef.current) {
          const neighbors = adjacentVertexIndices(spec, drag.vertexIdx);
          if (neighbors.length > 0) {
            // Show the distance to the CLOSEST neighbor.
            const dragVertex = spec.vertices[drag.vertexIdx];
            const dragH = dragVertex ? dragVertex.h : 0;
            let best = Infinity;
            for (const nIdx of neighbors) {
              const n = spec.vertices[nIdx];
              const d = vertexDistanceM({ lat: validation.lat, lng: validation.lng, h: dragH }, n);
              if (d < best) best = d;
            }
            try { onReadoutRef.current(dimensionReadoutFt(best)); } catch { /* ignore */ }
          }
        }

        try { viewer.scene.requestRender(); } catch { /* ignore */ }
      } catch { /* ignore — drag move is best-effort */ }
    }, C.ScreenSpaceEventType.MOUSE_MOVE);

    // ── LEFT_UP: finalize the drag, restore the handle's idle look ─────────
    handler.setInputAction(() => {
      const drag = dragStateRef.current;
      if (!drag) return;
      try {
        // Restore the handle's idle visual.
        const handleEntry = handleEntitiesRef.current.find(
          h => h.specId === drag.specId && h.vertexIdx === drag.vertexIdx,
        );
        if (handleEntry) {
          try {
            handleEntry.entity.point.pixelSize = HANDLE_PIXEL_SIZE;
            handleEntry.entity.point.color = C.Color.fromCssColorString(HANDLE_COLOR);
          } catch { /* ignore */ }
        }
        if (onEndRef.current) {
          try { onEndRef.current(drag.specId, drag.vertexIdx); } catch { /* ignore */ }
        }
        try { viewer.scene.requestRender(); } catch { /* ignore */ }
      } finally {
        dragStateRef.current = null;
      }
    }, C.ScreenSpaceEventType.LEFT_UP);

    return () => {
      try { handler.destroy(); } catch { /* ignore */ }
      handlerRef.current = null;
    };
  }, [viewer, C]);

  // ── 3. Cleanup: remove all handle entities when the component unmounts ───
  useEffect(() => {
    return () => {
      for (const h of handleEntitiesRef.current) {
        try { h.entity.viewer?.entities?.remove(h.entity); } catch { /* ignore */ }
      }
      handleEntitiesRef.current = [];
    };
  }, []);

  // No JSX — this component manipulates the Cesium scene only.
  return null;
}

// ── Local helpers ────────────────────────────────────────────────────────────

function isFiniteCoord(lat: number, lng: number): boolean {
  return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function safeCartesian3(C: any, lng: number, lat: number, h: number): any {
  if (!isFiniteCoord(lat, lng)) return null;
  try { return C.Cartesian3.fromDegrees(lng, lat, h); } catch { return null; }
}
