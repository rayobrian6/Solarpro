'use client';
/**
 * components/3d/panel/ModuleGhost.tsx
 *
 * THE MODULE THAT FOLLOWS THE CURSOR — Aurora / OpenSolar parity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Aurora and OpenSolar operators get a translucent module under the pointer,
 * already lying on the plane of the face beneath it, so placing one is
 * aim-and-click. SolarPro made you place -> look -> undo. This is the preview
 * half; `handleRoofClick` in SolarEngine3D.tsx remains the only thing that
 * commits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 WHY THIS COMPONENT CONTAINS NO MATHS AT ALL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A preview that lies is worse than no preview, because the operator AIMS with
 * it. This repo has paid for that twice:
 *
 *   • `TreeCursor` deliberately duplicated the engine's pick chain to stay
 *     standalone. That survived for a circle on the ground — and it still
 *     shipped the wrong SIZE: a constant 1.8 m canopy against a 6.0 m tree, so
 *     the ring installers aimed with was 36% of the footprint they got, and the
 *     Width box moved the tree but not the preview (fixed in 7542c9b4).
 *   • `showGhostPanel` — the next-slot ghost drawn after a placement — computes
 *     its own flat-earth step, and shipped a defect of exactly this kind: it
 *     added the mount stack a second time, so the ghost sat one stack ABOVE the
 *     module it was previewing.
 *
 * A module has a position, a pitch, an azimuth, an in-plane heading and a
 * footprint. Every one of them is a chance for a preview to disagree with the
 * commit. So this component does not compute any of them: it is handed the pose
 * the COMMIT's own snapper and the RENDERER's own orienter produced, through the
 * `resolvePose` prop, and it draws that. It cannot be wrong about where the
 * module will go, because it does not know how to work it out.
 *
 * Everything below the prop boundary is presentation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COMPONENT, AND WHY ITS OWN HANDLER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `TreeCursor` is the precedent and this follows it exactly: lifecycle driven by
 * one `active` prop, a Cesium entity held in a ref and mutated in place (mouse
 * move fires ~60x/s — a setState per event would re-render the whole engine),
 * and a MOUSE_MOVE registration on its OWN ScreenSpaceEventHandler.
 *
 * 🚨 MOUSE_MOVE ONLY, AND DELIBERATELY. `setInputAction` is a plain assignment
 * into a keyed map, so a second registration for the same type on the SAME
 * handler silently deletes the first — which is why this must not be added to
 * the engine's handlers, and why it registers exactly one action of its own. And
 * a hover owns no PRESS: it never competes with the custom left-drag turntable,
 * so it takes no pointer ownership. `tests/pointerGestureAuthority.test.ts`
 * blesses TreeCursor on precisely that basis; the moment this took LEFT_DOWN it
 * would become a drag and would have to claim the pointer.
 */

import React, { useEffect, useRef } from 'react';

// ── Visual constants ──────────────────────────────────────────────────────────
// Cyan, translucent — the same family as the engine's next-slot ghost, so the
// two previews read as one idea rather than two features.
const GHOST_FILL_HEX = '#00ccff';
const GHOST_FILL_ALPHA = 0.35;
const GHOST_OUTLINE_ALPHA = 0.85;
const GHOST_OUTLINE_WIDTH_PX = 2;
/** A pose that landed on no known roof face. Amber says "the design does not own
 *  this surface" — the module will still be placed, at the picked surface's own
 *  normal, and the operator can see that before committing. */
const GHOST_OFF_FACE_HEX = '#ffb020';

/**
 * The pose, as an ANSWER. Every field is opaque to this component: it is
 * produced by the engine's shared snapper + orienter and passed through
 * untouched.
 */
export interface GhostModulePose {
  /** Module centre, in ECEF. Built by the engine, not by this component. */
  position: unknown;
  /** The quaternion the renderer would draw this module with. */
  orientation: unknown;
  /** The box extents the renderer would draw, already packed in the renderer's
   *  own axis order. This component never assembles them. */
  dimensions: unknown;
  /** The roof face the pose came from, or null when the pick landed on a surface
   *  the design does not own. Presentation only — it picks the outline colour. */
  planeId: string | null;
}

export interface ModuleGhostProps {
  /** The Cesium Viewer, or null while the engine is still booting. */
  viewer: any | null;
  /** Show the ghost. True while the module tool is armed. */
  active: boolean;
  /**
   * 🚨 THE COMMIT'S OWN SNAPPER AND ORIENTER, HANDED IN.
   *
   * The single reason this is a prop rather than an implementation: it is the
   * same function the click path resolves its placement with. If this preview
   * ever computed a pose itself it would become a second placement authority,
   * and the operator would aim with the one that is wrong.
   *
   * Returns null when the click could not be resolved (off the globe, no
   * surface, outside the placement bound) — the ghost then hides, which is the
   * honest answer: a click there would place nothing.
   */
  resolvePose: (screenPos: { x: number; y: number }) => GhostModulePose | null;
}

/** Pull Cesium off the window — the same pattern SolarEngine3D and TreeCursor
 *  use in a project that loads Cesium from a script tag. Null until it loads. */
function getCesium(): any | null {
  if (typeof window === 'undefined') return null;
  const C = (window as any).Cesium;
  if (!C || !C.Color || !C.ScreenSpaceEventHandler) return null;
  return C;
}

export const ModuleGhost: React.FC<ModuleGhostProps> = ({ viewer, active, resolvePose }) => {
  const entityRef = useRef<any>(null);
  const handlerRef = useRef<any>(null);
  const poseRef = useRef<GhostModulePose | null>(null);

  /**
   * 🚨 THROUGH A REF, BECAUSE THE HANDLER'S CLOSURE IS FROZEN.
   *
   * The MOUSE_MOVE handler is created once, when `active` flips true. A prop
   * read inside it would be the function from THAT render for ever — and this
   * one closes over the engine's live refs (armed orientation, mounting system,
   * the panels already placed), so a frozen copy would go stale the moment the
   * operator changed any of them. Same reason TreeCursor reads its radius from a
   * ref rather than from the dependency list.
   */
  const resolveRef = useRef(resolvePose);
  resolveRef.current = resolvePose;

  useEffect(() => {
    if (!active || !viewer) {
      teardown(viewer, entityRef, handlerRef, poseRef);
      return;
    }

    const C = getCesium();
    if (!C) return; // Cesium still loading — retry on the next render.

    const fill = C.Color.fromCssColorString(GHOST_FILL_HEX).withAlpha(GHOST_FILL_ALPHA);
    const onFaceOutline = C.Color.fromCssColorString(GHOST_FILL_HEX).withAlpha(GHOST_OUTLINE_ALPHA);
    const offFaceOutline = C.Color.fromCssColorString(GHOST_OFF_FACE_HEX).withAlpha(GHOST_OUTLINE_ALPHA);

    /**
     * Created on the FIRST resolved pose, not up front.
     *
     * TreeCursor adds its entity immediately at a placeholder coordinate and
     * hides it. That works for an ellipse clamped to the ground; a box needs a
     * real ECEF centre and a real orientation, and inventing either would be
     * this component computing a pose — the one thing it must never do. So there
     * is no entity until there is an answer to draw.
     */
    const ensureEntity = (pose: GhostModulePose): any | null => {
      if (entityRef.current) return entityRef.current;
      try {
        // A fixed id makes the ghost findable and impossible to duplicate — and
        // `entities.add` THROWS on a duplicate id, so a previous mount whose
        // teardown did not run (a hot reload, a viewer that threw on remove)
        // would leave the preview permanently dead with only a console warning.
        // Drop any stale one first; the id is ours alone.
        try { viewer.entities.removeById?.('module-ghost-preview'); } catch { /* none */ }
        const entity = viewer.entities.add({
          id: 'module-ghost-preview',
          name: '[GHOST-MODULE] cursor preview',
          position: pose.position,
          orientation: pose.orientation,
          box: {
            // Read per frame from the pose ref, so crossing onto a face with a
            // different pitch — or flipping portrait/landscape — is visible
            // immediately WITHOUT destroying and rebuilding the entity.
            dimensions: new C.CallbackProperty(
              () => poseRef.current?.dimensions ?? pose.dimensions, false,
            ),
            material: new C.ColorMaterialProperty(fill),
            outline: true,
            outlineColor: new C.CallbackProperty(
              () => (poseRef.current?.planeId ? onFaceOutline : offFaceOutline), false,
            ),
            outlineWidth: GHOST_OUTLINE_WIDTH_PX,
            // 🚨 A PREVIEW CASTS NO SHADOW. A GeometryUpdater defaults to this,
            // so it is belt and braces — written explicitly because the opposite
            // mistake (an entity that silently refuses to cast) has cost a whole
            // session here, and a reader must see that the silence is deliberate.
            shadows: C.ShadowMode.DISABLED,
            // 🚨 NO `disableDepthTestDistance` HERE, DELIBERATELY. The real
            // module's frame box passes one, and it is INERT: `BoxGraphics` has no
            // such property (verified against the installed Cesium's own
            // Cesium.d.ts — it exists on billboards, labels, points and
            // polylines, not on box geometry). Copying it would be copying a
            // no-op and implying it does something. The ghost sits a mount stack
            // above the face, so ordinary depth testing puts it in front of the
            // roof exactly as the committed module is.
          },
        });
        entityRef.current = entity;
        return entity;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ModuleGhost] failed to create the preview entity:', err);
        return null;
      }
    };

    let handler: any;
    try {
      handler = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((event: { endPosition?: { x: number; y: number } }) => {
        const screenPos = event?.endPosition;
        if (!screenPos) return;

        const pose = resolveRef.current?.(screenPos) ?? null;
        if (!pose) {
          // No resolvable placement here, so show nothing. Hiding is the honest
          // answer: a click at this pixel would place no module either.
          poseRef.current = null;
          if (entityRef.current) entityRef.current.show = false;
          try { viewer.scene.requestRender(); } catch { /* scene may be gone */ }
          return;
        }

        poseRef.current = pose;
        const entity = ensureEntity(pose);
        if (!entity) return;
        // Mutate in place — NO setState, NO React re-render per mouse move.
        entity.position = pose.position;
        entity.orientation = pose.orientation;
        entity.show = true;
        try { viewer.scene.requestRender(); } catch { /* scene may be gone */ }
      }, C.ScreenSpaceEventType.MOUSE_MOVE);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ModuleGhost] failed to attach the MOUSE_MOVE handler:', err);
      teardown(viewer, entityRef, handlerRef, poseRef);
      return;
    }
    handlerRef.current = handler;

    return () => {
      teardown(viewer, entityRef, handlerRef, poseRef);
    };
    // `resolvePose` is deliberately absent, and correctly so: it is read per
    // event through `resolveRef`, which every render refreshes. Listing it here
    // would tear down and rebuild the handler on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewer]);

  return null;
};

function teardown(
  viewer: any | null,
  entityRef: React.MutableRefObject<any>,
  handlerRef: React.MutableRefObject<any>,
  poseRef: React.MutableRefObject<GhostModulePose | null>,
): void {
  if (handlerRef.current) {
    try { handlerRef.current.destroy(); } catch { /* ignore */ }
    handlerRef.current = null;
  }
  if (entityRef.current && viewer) {
    try { viewer.entities.remove(entityRef.current); } catch { /* ignore */ }
  }
  entityRef.current = null;
  poseRef.current = null;
}

export default ModuleGhost;
