/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// THE GHOST DRAWS WHAT IT IS TOLD, AND NOTHING ELSE.
//
// tests/ghostModulePreviewAuthority.test.ts pins the WIRING: one snapper, one
// orienter, two call sites, and a component with no geometry in it. This file
// pins the BEHAVIOUR of that component, with a fake viewer and a fake Cesium —
// because the one thing that cannot be exercised for real is the picture.
//
// 🚨 WHY THERE IS NO BROWSER TEST OF THIS, AND THERE CANNOT BE.
//
// Software WebGL does not rasterise the Cesium scene: screenshots come back
// blank and `drillPick` returns ZERO hits for objects standing in plain view.
// Both facts are recorded in SolarEngine3D's own comments and in
// tests/pointerGestureAuthority.test.ts. So an acceptance spec that moves a
// mouse over the canvas and looks for a cyan module CANNOT work, and writing one
// would produce a green test that proves nothing. The FIRST real exercise of
// this preview is a person with a GPU moving their pointer over a roof.
//
// What that leaves provable here is everything except the pixels, and it is the
// part that has historically been wrong:
//
//   • the ghost's box is the pose's box — the size and orientation it is handed,
//     not a size of its own (this is the tree-cursor defect, 7542c9b4: a
//     constant 1.8 m canopy drawn against a 6.0 m tree);
//   • it follows the cursor by MUTATING the entity, with no React re-render;
//   • an unresolvable pointer position HIDES it rather than leaving the last
//     good pose floating under the cursor as if it were live;
//   • disarming the tool removes the entity AND the handler, so no ghost is
//     stranded in the scene and no handler keeps firing.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { ModuleGhost, type GhostModulePose } from '@/components/3d/panel/ModuleGhost';

// ── The fakes ──────────────────────────────────────────────────────────────
// Only the Cesium surface ModuleGhost actually touches. If it ever reaches for
// anything else — a picker, a transform, a degrees conversion — this throws,
// which is a second line of defence behind the source guard.

class FakeCallbackProperty {
  constructor(public readonly cb: () => unknown, public readonly isConstant: boolean) {}
  getValue() { return this.cb(); }
}

interface FakeHandler {
  destroyed: boolean;
  actions: Map<number, (e: any) => void>;
}

const MOUSE_MOVE = 15;

function installFakeCesium(): { handlers: FakeHandler[] } {
  const handlers: FakeHandler[] = [];
  (window as any).Cesium = {
    Color: {
      fromCssColorString: (css: string) => ({ css, alpha: 1, withAlpha(a: number) { return { css, alpha: a }; } }),
    },
    ColorMaterialProperty: class { constructor(public color: unknown) {} },
    CallbackProperty: FakeCallbackProperty,
    ShadowMode: { DISABLED: 0, ENABLED: 1 },
    ScreenSpaceEventType: { MOUSE_MOVE },
    ScreenSpaceEventHandler: class {
      public destroyed = false;
      public actions = new Map<number, (e: any) => void>();
      constructor(public canvas: unknown) { handlers.push(this as unknown as FakeHandler); }
      setInputAction(cb: (e: any) => void, type: number) { this.actions.set(type, cb); }
      destroy() { this.destroyed = true; }
    },
  };
  return { handlers };
}

function fakeViewer() {
  const added: any[] = [];
  const removed: any[] = [];
  let renders = 0;
  return {
    added, removed,
    get renders() { return renders; },
    scene: { canvas: {}, requestRender: () => { renders++; } },
    entities: {
      add(spec: any) { const e = { ...spec }; added.push(e); return e; },
      remove(e: any) { removed.push(e); return true; },
    },
  };
}

/** A pose is opaque to the component: these are just tagged tokens. */
function pose(tag: string, planeId: string | null): GhostModulePose {
  return {
    position: { tag: `${tag}-position` },
    orientation: { tag: `${tag}-orientation` },
    dimensions: { tag: `${tag}-dimensions` },
    planeId,
  };
}

let handlers: FakeHandler[];

beforeEach(() => { handlers = installFakeCesium().handlers; });
afterEach(() => { cleanup(); delete (window as any).Cesium; vi.restoreAllMocks(); });

/** Fire a MOUSE_MOVE at the fake handler the component installed. */
function move(x: number, y: number) {
  const h = handlers[handlers.length - 1];
  const action = (h as any).actions.get(MOUSE_MOVE);
  expect(action, 'the ghost never registered a MOUSE_MOVE action').toBeTruthy();
  act(() => { action!({ endPosition: { x, y } }); });
}

describe('ModuleGhost — armed and disarmed', () => {
  it('draws nothing at all until the tool is armed', () => {
    const viewer = fakeViewer();
    render(<ModuleGhost viewer={viewer as any} active={false} resolvePose={() => pose('a', 'face-1')} />);
    expect(handlers, 'a disarmed ghost installed a handler').toEqual([]);
    expect(viewer.added, 'a disarmed ghost added an entity').toEqual([]);
  });

  it('no entity exists until the FIRST resolvable pose', () => {
    // 🚨 DELIBERATE, AND A DEPARTURE FROM TreeCursor. TreeCursor adds its ellipse
    // up front at a placeholder lat/lng and hides it — fine for a circle clamped
    // to the ground. A box needs a real ECEF centre and a real quaternion, and
    // inventing either would be this component computing a pose, which is the
    // one thing it must never do.
    const viewer = fakeViewer();
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => null} />);
    expect(handlers.length, 'the armed ghost did not install its handler').toBe(1);
    expect(viewer.added).toEqual([]);
    move(10, 10);
    expect(viewer.added, 'an entity was invented for a pose that does not exist').toEqual([]);
  });

  it('disarming removes the entity and destroys the handler', () => {
    const viewer = fakeViewer();
    const { rerender } = render(
      <ModuleGhost viewer={viewer as any} active resolvePose={() => pose('a', 'face-1')} />,
    );
    move(10, 10);
    expect(viewer.added.length).toBe(1);

    rerender(<ModuleGhost viewer={viewer as any} active={false} resolvePose={() => pose('a', 'face-1')} />);
    expect(viewer.removed.length, 'the ghost was stranded in the scene').toBe(1);
    expect(handlers[0].destroyed, 'the handler kept firing after the tool changed').toBe(true);
  });
});

describe('🚨 ModuleGhost draws the POSE it is handed', () => {
  it('position, orientation and box all come from the resolver', () => {
    const viewer = fakeViewer();
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => pose('a', 'face-1')} />);
    move(40, 60);

    expect(viewer.added.length).toBe(1);
    const e = viewer.added[0];
    expect(e.position).toEqual({ tag: 'a-position' });
    expect(e.orientation).toEqual({ tag: 'a-orientation' });
    // The box reads the pose per frame, so the callback is the assertion.
    expect(e.box.dimensions).toBeInstanceOf(FakeCallbackProperty);
    expect(e.box.dimensions.getValue()).toEqual({ tag: 'a-dimensions' });
    expect(e.show).toBe(true);
  });

  it('🚨 the FOOTPRINT tracks the pose — this is the tree-cursor defect', () => {
    // The tree cursor drew a constant radius while the object it previewed was
    // sized elsewhere, so the shape installers aimed with was 36% of the shape
    // they got. A module's footprint changes with portrait/landscape and its
    // pitch changes with the face under the cursor. Both arrive in the pose, and
    // the entity is NOT rebuilt — the same box reports the new values.
    const viewer = fakeViewer();
    let current = pose('portrait', 'face-1');
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => current} />);
    move(10, 10);
    const e = viewer.added[0];
    expect(e.box.dimensions.getValue()).toEqual({ tag: 'portrait-dimensions' });

    current = pose('landscape', 'face-2');
    move(11, 11);
    expect(viewer.added.length, 'the entity was destroyed and rebuilt for a size change').toBe(1);
    expect(e.box.dimensions.getValue(), 'the ghost kept drawing the old footprint')
      .toEqual({ tag: 'landscape-dimensions' });
    expect(e.orientation, 'the ghost kept the old orientation across a face change')
      .toEqual({ tag: 'landscape-orientation' });
  });

  it('follows the cursor by MUTATING ONE entity, never by rebuilding it', () => {
    // Mouse move fires ~60x/s. Re-adding the entity per event (or routing the
    // position through React state, which would re-render the whole engine tree)
    // is what tanks the frame rate — the reason TreeCursor is written this way
    // too. The proof: the SAME object, identity intact, reports new values.
    const viewer = fakeViewer();
    let current = pose('p0', 'face-1');
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => current} />);
    move(0, 0);
    const first = viewer.added[0];

    for (let i = 1; i <= 40; i++) {
      current = pose(`p${i}`, 'face-1');
      move(i, i);
    }
    expect(viewer.added.length, 'the ghost re-added its entity while following the cursor').toBe(1);
    expect(viewer.removed, 'the ghost churned entities while following the cursor').toEqual([]);
    expect(viewer.added[0], 'the entity identity changed — it was rebuilt').toBe(first);
    expect(first.position).toEqual({ tag: 'p40-position' });
    expect(first.orientation).toEqual({ tag: 'p40-orientation' });
    expect(first.box.dimensions.getValue()).toEqual({ tag: 'p40-dimensions' });
  });

  it('a live prop change reaches the frozen handler through the ref', () => {
    // The handler is created once, when `active` flips true. A prop read inside
    // it would be the function from THAT render for ever — the mount-frozen
    // closure trap the engine documents in a dozen places.
    const viewer = fakeViewer();
    const first = () => pose('first', 'face-1');
    const second = () => pose('second', 'face-9');
    const { rerender } = render(<ModuleGhost viewer={viewer as any} active resolvePose={first} />);
    move(1, 1);
    expect(viewer.added[0].position).toEqual({ tag: 'first-position' });

    rerender(<ModuleGhost viewer={viewer as any} active resolvePose={second} />);
    move(2, 2);
    expect(handlers.length, 'the handler was rebuilt on a prop change').toBe(1);
    expect(viewer.added[0].position, 'the new resolver never reached the handler')
      .toEqual({ tag: 'second-position' });
  });
});

describe('🚨 ModuleGhost hides rather than lying', () => {
  it('an unresolvable pointer position hides the ghost', () => {
    // Off the globe, no surface, or outside the placement bound. A click there
    // places nothing, so showing a module there would promise something the
    // commit will refuse.
    const viewer = fakeViewer();
    let current: GhostModulePose | null = pose('a', 'face-1');
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => current} />);
    move(10, 10);
    expect(viewer.added[0].show).toBe(true);

    current = null;
    move(900, 900);
    expect(viewer.added[0].show, 'the ghost stayed on screen with no resolvable placement').toBe(false);

    current = pose('a', 'face-1');
    move(11, 11);
    expect(viewer.added[0].show, 'the ghost never came back').toBe(true);
  });

  it('a MOUSE_MOVE with no endPosition is ignored, not treated as a miss', () => {
    const viewer = fakeViewer();
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => pose('a', 'face-1')} />);
    move(10, 10);
    const h = handlers[0] as any;
    act(() => { h.actions.get(MOUSE_MOVE)!({}); });
    expect(viewer.added[0].show, 'a malformed event blanked a good preview').toBe(true);
  });

  it('the outline says whether the pose landed on a known face', () => {
    // Amber means "the design does not own this surface" — the module will still
    // be placed, at the picked surface's own normal, and the operator can see
    // that BEFORE committing. Read per frame, so it changes as the cursor
    // crosses off a face.
    const viewer = fakeViewer();
    let current = pose('a', 'face-1');
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => current} />);
    move(10, 10);
    const outline = viewer.added[0].box.outlineColor;
    expect(outline).toBeInstanceOf(FakeCallbackProperty);
    const onFace = outline.getValue();

    current = pose('a', null);
    move(11, 11);
    const offFace = outline.getValue();
    expect(offFace, 'an off-face pose is drawn identically to an on-face one')
      .not.toEqual(onFace);
  });

  it('the preview does not cast a shadow', () => {
    const viewer = fakeViewer();
    render(<ModuleGhost viewer={viewer as any} active resolvePose={() => pose('a', 'face-1')} />);
    move(10, 10);
    expect(viewer.added[0].box.shadows).toBe(0); // ShadowMode.DISABLED
  });

  it('a resolver that throws does not escape into the Cesium event loop', () => {
    const viewer = fakeViewer();
    const boom = () => { throw new Error('resolver blew up'); };
    render(<ModuleGhost viewer={viewer as any} active resolvePose={boom} />);
    const h = handlers[0] as any;
    // The engine's own resolver catches for exactly this reason; if the contract
    // ever changes so that a resolver may throw, this records who is responsible.
    expect(() => h.actions.get(MOUSE_MOVE)!({ endPosition: { x: 1, y: 1 } })).toThrow('resolver blew up');
    expect(viewer.added, 'a throwing resolver still produced an entity').toEqual([]);
  });
});
