/**
 * lib/3d/vertexHandleOverlay.ts
 *
 * THE CORNER DOTS, AND NOTHING ELSE.
 *
 * A factory, created once at viewer init and held in a ref — the same shape as
 * the segment-arrow overlay, and deliberately NOT a React component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 THREE THINGS THIS FILE MUST NOT DO, EACH FOR A RECORDED REASON
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. IT REGISTERS NO INPUT HANDLER. `setInputAction` is an OVERWRITE on one
 *    handler but a second `ScreenSpaceEventHandler` on the same canvas does not
 *    replace the engine's registrations — BOTH fire. A press here would also run
 *    the engine's select / panel-array / block-height logic in the same event.
 *    The gesture lives in the engine's own handlers, where `claimPointer` is
 *    reachable and where the pointer-authority guard can see it.
 *
 * 2. IT IS NOT PICKED. Nothing here is ever hit-tested with `scene.pick`. The
 *    dots are drawn so a person can aim; the engine grabs them with ray-sphere
 *    arithmetic against the canonical ring. That split is the whole reason this
 *    works on a machine with no usable GPU, where a GPU pick returns zero hits
 *    for geometry standing in plain view.
 *
 * 3. CLEANUP GOES THROUGH THE VIEWER THIS FACTORY WAS BUILT WITH. Not through
 *    `entity.viewer?.entities?.remove(entity)` — Cesium entities carry no
 *    `viewer` property, so that optional chain short-circuits to undefined,
 *    removes nothing, and silently leaks every handle ever drawn. That is a real
 *    defect in the component this overlay replaces.
 *
 * Positions are served through `CallbackProperty` so a drag moves a dot without
 * adding or removing a single entity: entity churn at pointer-move rate is how
 * an overlay ends up costing more than the render it decorates.
 */

import type { Cart3 } from '../roofPlane3D';

export interface VertexHandleOverlay {
  /** Draw a handle per corner. Replaces whatever was shown before. */
  show(ring: ReadonlyArray<Cart3>, activeIndex?: number | null): void;
  /** Move one already-drawn handle during a drag. No entity churn. */
  moveHandle(index: number, to: Cart3): void;
  /** Mark one handle as the grabbed one (or null for none). */
  setActive(index: number | null): void;
  /** Show the candidate outline during a drag, or null to hide it. */
  setPreview(ring: ReadonlyArray<Cart3> | null, valid?: boolean): void;
  /** Remove every entity this overlay owns. */
  clear(): void;
}

const HANDLE_PIXEL_SIZE = 14;
const HANDLE_PIXEL_SIZE_ACTIVE = 20;

export function createVertexHandleOverlay(viewer: any, C: any): VertexHandleOverlay {
  /** Live positions, read by the callbacks. Mutated in place during a drag. */
  let positions: Cart3[] = [];
  let handles: any[] = [];
  let activeIndex: number | null = null;
  let previewRing: Cart3[] | null = null;
  let previewValid = true;
  let previewEntity: any = null;

  const toCartesian = (p: Cart3) => new C.Cartesian3(p.x, p.y, p.z);

  function removeEntity(e: any) {
    if (!e) return;
    // See note 3 in the header: the viewer captured by this closure, never a
    // property fished off the entity.
    try { viewer.entities.remove(e); } catch { /* viewer already torn down */ }
  }

  function clear() {
    for (const h of handles) removeEntity(h);
    handles = [];
    positions = [];
    activeIndex = null;
    removeEntity(previewEntity);
    previewEntity = null;
    previewRing = null;
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
  }

  function show(ring: ReadonlyArray<Cart3>, active: number | null = null) {
    clear();
    if (!ring || ring.length < 3) return;
    positions = ring.map(p => ({ x: p.x, y: p.y, z: p.z }));
    activeIndex = active ?? null;

    for (let i = 0; i < positions.length; i++) {
      const idx = i;
      try {
        const e = viewer.entities.add({
          name: `[VERTEX-HANDLE] ${idx}`,
          position: new C.CallbackProperty(() => toCartesian(positions[idx]), false),
          point: {
            // 🚨 The drawn size and the grab sphere are derived from the SAME
            // pixel diameter (see `handleRadiusM`), so the target is the dot.
            pixelSize: new C.CallbackProperty(
              () => (activeIndex === idx ? HANDLE_PIXEL_SIZE_ACTIVE : HANDLE_PIXEL_SIZE), false),
            color: new C.CallbackProperty(
              () => (activeIndex === idx ? C.Color.YELLOW : C.Color.WHITE), false),
            outlineColor: C.Color.BLACK,
            outlineWidth: 2,
            // Corners behind the ridge must still be aimable — a handle you can
            // see but not reach is the same defect as one you cannot see.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        handles.push(e);
      } catch { /* ignore a single failed handle rather than lose the overlay */ }
    }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
  }

  function moveHandle(index: number, to: Cart3) {
    if (index < 0 || index >= positions.length) return;
    positions[index] = { x: to.x, y: to.y, z: to.z };
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
  }

  function setActive(index: number | null) {
    activeIndex = index;
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
  }

  function setPreview(ring: ReadonlyArray<Cart3> | null, valid = true) {
    previewValid = valid;
    if (!ring || ring.length < 3) {
      removeEntity(previewEntity);
      previewEntity = null;
      previewRing = null;
      try { viewer.scene.requestRender(); } catch { /* ignore */ }
      return;
    }
    previewRing = ring.map(p => ({ x: p.x, y: p.y, z: p.z }));
    if (!previewEntity) {
      try {
        previewEntity = viewer.entities.add({
          name: '[VERTEX-PREVIEW]',
          polyline: {
            positions: new C.CallbackProperty(() => {
              if (!previewRing) return [];
              const pts = previewRing.map(toCartesian);
              return [...pts, pts[0]];
            }, false),
            width: 3,
            material: new C.ColorMaterialProperty(
              new C.CallbackProperty(
                () => (previewValid ? C.Color.CYAN : C.Color.ORANGERED), false)),
            clampToGround: false,
            // Same reason as the handles: the outline being edited must be
            // visible through the building extrusion it sits on.
            depthFailMaterial: new C.ColorMaterialProperty(
              new C.CallbackProperty(
                () => (previewValid
                  ? C.Color.CYAN.withAlpha(0.5)
                  : C.Color.ORANGERED.withAlpha(0.5)), false)),
          },
        });
      } catch { previewEntity = null; }
    }
    try { viewer.scene.requestRender(); } catch { /* ignore */ }
  }

  return { show, moveHandle, setActive, setPreview, clear };
}
