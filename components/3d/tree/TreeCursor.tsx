'use client';
/**
 * components/3d/tree/TreeCursor.tsx
 *
 * 2D tree-placement cursor preview — Aurora parity.
 *
 * Aurora (frame 0115) shows a translucent light-blue circle that follows the
 * mouse while the user is in tree-placement mode, sized to the tree's actual
 * canopy radius. Clicking drops the tree. This component adds the
 * "preview" half; the existing `handleTreeClick` in SolarEngine3D.tsx owns
 * the "drop" half.
 *
 * Why a self-contained React component:
 *   TreeCursor's lifecycle is fully driven by one prop (`active`). Mounting
 *   it inside SolarEngine3D and flipping `active` is the cleanest way to
 *   keep the cursor's MOUSE_MOVE handler, Cesium entity, and teardown
 *   fully encapsulated.
 *
 * Why entity-property mutation, not React state:
 *   Mouse-move fires ~60×/s. Putting the cursor's lat/lng into React state
 *   would re-render the entire SolarEngine3D tree on every event and tank
 *   the frame rate. Instead the component holds the Cesium entity in a ref
 *   and mutates `entity.position` directly. Zero React work per mouse move.
 *
 * Why a Cesium EllipseGraphics, not a DOM <div>:
 *   A DOM overlay drifts when the camera tilts or orbits. An EllipseGraphics
 *   is a real primitive in the scene, so it co-registers with the terrain
 *   drape, the 3D tiles, and the existing roof primitives at all camera
 *   angles.
 *
 * The picking chain:
 *   The same getWorldPosition 3-tier fallback (3D tiles → terrain →
 *   ellipsoid) that the rest of SolarEngine3D uses is replicated here. We
 *   do NOT import getWorldPosition from SolarEngine3D because it lives
 *   inside the component closure; duplicating the chain in 10 lines keeps
 *   this component standalone.
 */

import React, { useEffect, useRef } from 'react';
import {
  DEFAULT_TREE_CANOPY_RADIUS_M,
  canopyRadiusToEllipseAxes,
} from './canopy';

// ── Visual constants (Aurora parity) ──────────────────────────────────────
// Light blue, translucent. The values are inlined (not imported) because
// they are presentation-only and we want a single place to tune the look
// without dragging a Cesium import into the math module.
const CURSOR_FILL_HEX    = '#a8d4ec';
const CURSOR_FILL_ALPHA  = 0.42;
const CURSOR_OUTLINE_HEX = '#7fb8d8';
const CURSOR_OUTLINE_ALPHA = 0.95;
const CURSOR_OUTLINE_WIDTH_PX = 2;
const CURSOR_HEIGHT_REFERENCE = 'CLAMP_TO_GROUND';

export interface TreeCursorProps {
  /** The Cesium Viewer instance. `null` while the engine is still booting —
   *  the component no-ops until both the viewer and `(window as any).Cesium`
   *  are available. */
  viewer: any | null;
  /** Show the cursor. `true` while `placementMode === 'tree'`, `false`
   *  otherwise. Flipping this from `true` to `false` removes the entity
   *  and handler immediately. */
  active: boolean;
  /** Canopy radius in meters. Defaults to `DEFAULT_TREE_CANOPY_RADIUS_M`
   *  (1.8 m, matching the v64 tree primitive). Configurable so future
   *  tree species / obstruction primitives can override without changing
   *  this component. */
  canopyRadiusM?: number;
}

// Type shim for the bits of Cesium we touch. Keeps this file self-contained
// and avoids an `import { ... } from 'cesium'` in a project that pulls Cesium
// off the global `window` (same pattern SolarEngine3D uses).
type CesiumGlobal = {
  Cartesian3: any;
  Cartographic: any;
  Math: { toDegrees: (rad: number) => number; toRadians: (deg: number) => number };
  Color: { fromCssColorString: (css: string) => any };
  HeightReference: Record<string, number>;
  ScreenSpaceEventHandler: any;
  ScreenSpaceEventType: { MOUSE_MOVE: number };
};

/** Pull Cesium off the window. Mirrors SolarEngine3D's
 *  `(window as any).Cesium` pattern; returns null if Cesium hasn't been
 *  loaded yet. */
function getCesium(): CesiumGlobal | null {
  if (typeof window === 'undefined') return null;
  const C = (window as any).Cesium;
  if (!C || !C.Color || !C.ScreenSpaceEventHandler) return null;
  return C as CesiumGlobal;
}

export const TreeCursor: React.FC<TreeCursorProps> = ({
  viewer,
  active,
  canopyRadiusM = DEFAULT_TREE_CANOPY_RADIUS_M,
}) => {
  const entityRef = useRef<any>(null);
  const handlerRef = useRef<any>(null);

  useEffect(() => {
    if (!active || !viewer) {
      teardown(viewer, entityRef, handlerRef);
      return;
    }

    const C = getCesium();
    if (!C) {
      // Cesium still loading — try again next render.
      return;
    }

    const { semiMajorAxis, semiMinorAxis } = canopyRadiusToEllipseAxes(canopyRadiusM);
    const fillMaterial = C.Color.fromCssColorString(CURSOR_FILL_HEX);
    const outlineMaterial = C.Color.fromCssColorString(CURSOR_OUTLINE_HEX);

    let entity: any;
    try {
      entity = viewer.entities.add({
        id: 'tree-cursor-preview',
        name: 'Tree placement preview',
        position: C.Cartesian3.fromDegrees(0, 0, 0), // hidden until first mouse-move
        ellipse: {
          semiMajorAxis,
          semiMinorAxis,
          material: fillMaterial.withAlpha(CURSOR_FILL_ALPHA),
          outline: true,
          outlineColor: outlineMaterial.withAlpha(CURSOR_OUTLINE_ALPHA),
          outlineWidth: CURSOR_OUTLINE_WIDTH_PX,
          height: 0,
          heightReference: C.HeightReference[CURSOR_HEIGHT_REFERENCE],
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[TreeCursor] failed to create preview entity:', err);
      return;
    }
    entity.show = false;
    entityRef.current = entity;

    let handler: any;
    try {
      handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: { endPosition: any }) => {
        const screenPos = event.endPosition;
        if (!screenPos) return;

        const cartesian = pickWorldPosition(viewer, C, screenPos);
        if (!cartesian) {
          if (entityRef.current) entityRef.current.show = false;
          return;
        }

        const carto = C.Cartographic.fromCartesian(cartesian);
        if (!carto) {
          if (entityRef.current) entityRef.current.show = false;
          return;
        }
        const lat = C.Math.toDegrees(carto.latitude);
        const lng = C.Math.toDegrees(carto.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          if (entityRef.current) entityRef.current.show = false;
          return;
        }

        // Mutate the entity in place — NO setState, NO React re-render.
        entityRef.current.position = C.Cartesian3.fromDegrees(lng, lat, 0);
        entityRef.current.show = true;
        try { viewer.scene.requestRender(); } catch { /* scene may be gone */ }
      }, C.ScreenSpaceEventType.MOUSE_MOVE);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[TreeCursor] failed to attach MOUSE_MOVE handler:', err);
      try { viewer.entities.remove(entity); } catch { /* ignore */ }
      entityRef.current = null;
      return;
    }
    handlerRef.current = handler;

    return () => {
      teardown(viewer, entityRef, handlerRef);
    };
    // We intentionally do NOT depend on canopyRadiusM as a reactive value —
    // changing the canopy radius mid-placement is rare and the cost of
    // re-creating the entity on every change is high.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewer]);

  return null;
};

function teardown(
  viewer: any | null,
  entityRef: React.MutableRefObject<any>,
  handlerRef: React.MutableRefObject<any>,
): void {
  if (handlerRef.current) {
    try { handlerRef.current.destroy(); } catch { /* ignore */ }
    handlerRef.current = null;
  }
  if (entityRef.current && viewer) {
    try { viewer.entities.remove(entityRef.current); } catch { /* ignore */ }
  }
  entityRef.current = null;
}

/** Replicates the 3-tier picking chain from SolarEngine3D.getWorldPosition:
 *  3D tiles (primary) → terrain globe.pick (fallback) → ray-ellipsoid
 *  (last resort). Returns a Cesium Cartesian3 or null. */
function pickWorldPosition(viewer: any, C: CesiumGlobal, screenPos: any): any | null {
  // 1. 3D tiles (scene.pick → scene.pickPosition)
  try {
    const picked = viewer.scene.pick(screenPos);
    if (picked && picked.primitive) {
      const pos = viewer.scene.pickPosition(screenPos);
      if (pos && Number.isFinite(pos.x)) return pos;
    }
  } catch { /* fall through */ }

  // 2. Terrain globe.pick (globe is hidden once tiles load)
  try {
    const pos = viewer.scene.globe?.pick?.(screenPos, viewer.scene);
    if (pos && Number.isFinite(pos.x)) return pos;
  } catch { /* fall through */ }

  // 3. Ray-ellipsoid (last resort, when both 3D tiles and terrain unavailable)
  try {
    if (viewer.camera && viewer.camera.pickEllipsoid) {
      const pos = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe?.ellipsoid);
      if (pos && Number.isFinite(pos.x)) return pos;
    }
  } catch { /* give up */ }

  return null;
}

export default TreeCursor;
