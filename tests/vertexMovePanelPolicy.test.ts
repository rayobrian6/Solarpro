/**
 * tests/vertexMovePanelPolicy.test.ts
 *
 * WHAT HAPPENS TO THE MODULES WHEN THE ROOF UNDER THEM CHANGES SHAPE.
 *
 * The policy is CULL: snapshot first, remove the panels whose centre is no
 * longer on the face, report the count, and touch nothing else. Each of the
 * three alternatives is wrong in a specific way, and the assertions below pin
 * the boundary between them.
 *
 *   RE-LAY — forbidden. A re-layout destroys every manual adjustment, and
 *     rearranging design panels to tidy a drawing is a standing prohibition. A
 *     20 cm corner nudge must not re-shuffle an array somebody spent ten
 *     minutes positioning: that is a BIGGER edit than the one performed, which
 *     is the definition of a surprising tool.
 *
 *   REPOSITION — forbidden, and this is the subtle one.
 *     `repositionPanelsForPlanes` maps each panel through (u,v) in the old
 *     frame to (u,v) in the new one, anchored on the RING CENTROID. That is
 *     exactly right for a RIGID motion — a section translating or changing
 *     height — and exactly wrong for a non-rigid one. Dragging one corner MOVES
 *     THE CENTROID, so every panel on the face would translate by that delta.
 *     Nobody asked for the array to slide.
 *
 *   REFUSE — useless. It would disable the feature on precisely the faces that
 *     matter: automation gets the roof 90% right and then you lay panels; the
 *     10% fix comes after, not before.
 *
 * 🚨 CULLING IS ONLY CHEAP BECAUSE THE DRAG IS CONSTRAINED TO THE FACE'S OWN
 * PLANE. The plane does not move, so a panel still inside the new ring is still
 * exactly on the deck, at its old lat/lng/height, on the correct mount stack.
 * There is genuinely nothing to reposition. If the in-plane constraint is ever
 * relaxed, this policy stops being honest and must be revisited with it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyPanelsAgainstRing,
  ringToFaceUV,
  PANEL_ON_FACE_PAD_M,
  type FaceBasis,
  type PanelPoint,
} from '@/lib/3d/vertexMove';
import {
  buildRoofPlane3D,
  latLngToECEF,
  add3, scale3, sub3, mag3,
  type Cart3,
} from '@/lib/roofPlane3D';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(
  readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);

const SITE_LAT = 38.67;
const SITE_LNG = -90.15;

/** The same real 6:12 face the geometry suite uses. */
function buildFace() {
  const pitchRad = Math.atan(6 / 12);
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);
  const eaveM = 12, runM = 8;
  const rise = runM * Math.tan(pitchRad);
  const baseH = 30;
  const corners: Cart3[] = [
    latLngToECEF(SITE_LAT,                     SITE_LNG,                      baseH),
    latLngToECEF(SITE_LAT,                     SITE_LNG + eaveM / mPerDegLng,  baseH),
    latLngToECEF(SITE_LAT + runM / mPerDegLat, SITE_LNG + eaveM / mPerDegLng,  baseH + rise),
    latLngToECEF(SITE_LAT + runM / mPerDegLat, SITE_LNG,                       baseH + rise),
  ];
  const plane = buildRoofPlane3D(corners);
  const basis: FaceBasis = {
    origin: plane.origin3D!,
    u: plane.ecefFrame3D!.u,
    v: plane.ecefFrame3D!.v,
    n: plane.ecefFrame3D!.n,
  };
  return { plane, basis, ring: plane.polygon3D as Cart3[] };
}

/** A panel sitting ON the deck at (u,v) metres, lifted by a mount stack. */
function panelAt(id: string, u: number, v: number, basis: FaceBasis, stackM = 0.15): PanelPoint {
  const onDeck = add3(basis.origin, add3(scale3(basis.u, u), scale3(basis.v, v)));
  return { id, point: add3(onDeck, scale3(basis.n, stackM)) };
}

describe('the membership test', () => {
  it('keeps panels inside the ring and culls the ones outside it', () => {
    const { basis, ring } = buildFace();
    const ringUV = ringToFaceUV(ring, basis);
    const panels = [
      panelAt('inside-1', 3, 3, basis),
      panelAt('inside-2', 8, 6, basis),
      panelAt('outside-1', 30, 3, basis),
      panelAt('outside-2', -20, -20, basis),
    ];
    const { surviving, culled } = classifyPanelsAgainstRing(panels, ringUV, basis);
    expect(surviving.sort()).toEqual(['inside-1', 'inside-2']);
    expect(culled.sort()).toEqual(['outside-1', 'outside-2']);
  });

  it('a panel half over the eave still counts as on the roof', () => {
    // 0.35 m of pad, which is the tolerance the section code already chose and
    // defended for the same question. Without it, the eave row would be culled
    // by a drag that did not touch the eave.
    const { basis, ring } = buildFace();
    const ringUV = ringToFaceUV(ring, basis);
    const justOff = classifyPanelsAgainstRing([panelAt('p', 6, -0.2, basis)], ringUV, basis);
    expect(justOff.surviving).toEqual(['p']);
    const wellOff = classifyPanelsAgainstRing([panelAt('p', 6, -1.5, basis)], ringUV, basis);
    expect(wellOff.culled).toEqual(['p']);
    expect(PANEL_ON_FACE_PAD_M).toBe(0.35);
  });

  it('🚨 the mount stack is invisible to the test, and must NOT be corrected for', () => {
    // A panel floats above the deck along the face NORMAL. (u,v,n) is
    // orthonormal, so that offset contributes EXACTLY ZERO to u and to v — at
    // any pitch and any stack height. The membership test is already exact.
    //
    // This case exists because the first implementation did not believe that
    // and "corrected" for the stack by dropping each panel vertically onto the
    // plane first. Local up is not the face normal, so that drop has its own
    // in-plane component: it displaced the test point by stack*tan(tilt), about
    // 7.5 cm at 6:12 — introducing the pitch-dependent error it was written to
    // remove, small enough to hide inside the 0.35 m pad and so invisible until
    // somebody measured it. The right amount of correction is none.
    const { basis, ring } = buildFace();
    const ringUV = ringToFaceUV(ring, basis);
    const flat = panelAt('p', 5, 4, basis, 0);
    for (const stack of [0, 0.15, 0.5, 2.0]) {
      const lifted = panelAt('p', 5, 4, basis, stack);
      // The lifted point really IS somewhere else in space...
      if (stack > 0) expect(mag3(sub3(lifted.point, flat.point))).toBeCloseTo(stack, 6);
      // ...and lands on exactly the same (u,v).
      const a = classifyPanelsAgainstRing([flat], ringUV, basis);
      const b = classifyPanelsAgainstRing([lifted], ringUV, basis);
      expect(b.surviving, `stack ${stack} changed the answer`).toEqual(a.surviving);
    }
    // And the sharpest form: a panel 0.1 m inside the eave must survive at every
    // stack height. Under the vertical-drop version, a tall stack pushed it out.
    const nearEave = ringUV.reduce((m, p) => Math.min(m, p.n), Infinity);
    for (const stack of [0, 0.15, 2.0]) {
      const p = panelAt('edge', 6, nearEave + 0.1, basis, stack);
      expect(classifyPanelsAgainstRing([p], ringUV, basis).surviving,
        `a panel just inside the eave was culled at stack ${stack}`).toEqual(['edge']);
    }
  });

  it('a shrinking corner culls exactly the panels the new outline lost', () => {
    const { basis, ring } = buildFace();
    // Pull corner 2 sharply in, cutting the top-right of the face away.
    const uv = ringToFaceUV(ring, basis);
    const shrunk = uv.map((p, i) => (i === 2 ? { e: 2, n: 2 } : p));
    const panels = [
      panelAt('a', 1.0, 1.0, basis),
      panelAt('b', 1.5, 1.5, basis),
      panelAt('c', 9.0, 7.0, basis),
      panelAt('d', 11.0, 7.5, basis),
    ];
    const before = classifyPanelsAgainstRing(panels, uv, basis);
    expect(before.culled).toEqual([]);
    const after = classifyPanelsAgainstRing(panels, shrunk, basis);
    expect(after.culled.length).toBeGreaterThan(0);
    // Whatever survived was ALREADY surviving: a cull never adds a panel.
    for (const id of after.surviving) expect(before.surviving).toContain(id);
  });

  it('survivors are returned by id only — this function cannot move a panel', () => {
    // The strongest form of "panels are not repositioned": the policy has no
    // channel through which a position could change. It returns ids.
    const { basis, ring } = buildFace();
    const res = classifyPanelsAgainstRing([panelAt('p', 3, 3, basis)], ringToFaceUV(ring, basis), basis);
    expect(res.surviving).toEqual(['p']);
    expect(typeof res.surviving[0]).toBe('string');
  });
});

describe('🚨 the commit path applies the policy in the right ORDER', () => {
  /** The body of the release-side commit. */
  function commitBody(): string {
    const i = ENGINE.indexOf('function vertexDragUp(');
    expect(i, 'vertexDragUp is gone — renamed or deleted').toBeGreaterThan(-1);
    const end = ENGINE.indexOf('\n    }', i);
    expect(end, 'could not find the end of vertexDragUp').toBeGreaterThan(i);
    return ENGINE.slice(i, end);
  }

  it('snapshots BEFORE it removes — a cull with no undo is the defect', () => {
    // Marking a vent culled modules with no history step, and deleting the vent
    // did not bring them back. The snapshot callback exists because of that.
    const body = commitBody();
    const snapshot = body.indexOf("onPanelsAboutToBeCulled?.('Move roof corner')");
    const remove = body.indexOf('onPanelsChange(');
    expect(snapshot, 'the cull no longer snapshots first').toBeGreaterThan(-1);
    expect(remove, 'the cull no longer removes anything').toBeGreaterThan(-1);
    expect(snapshot, 'the snapshot moved AFTER the removal — Undo would not restore the modules')
      .toBeLessThan(remove);
  });

  it('🚨 does NOT call repositionPanelsForPlanes', () => {
    // A rigid map anchored on the ring centroid, and a corner drag moves the
    // centroid. Calling it here would slide the whole array sideways.
    expect(commitBody(), 'the corner commit started repositioning panels — it would slide the array')
      .not.toMatch(/repositionPanelsForPlanes/);
  });

  it('does not re-lay the face either', () => {
    const body = commitBody();
    expect(body).not.toMatch(/placePanelsControlled|buildSurfaceGrid|autoLayout/);
  });

  it('overrides the minted id with the face id — a new id orphans every panel', () => {
    // `buildRoofPlane3D` mints a fresh uuid. Adopting it would break every
    // panel's `planeId`, section-face id determinism and the deletion ledger.
    const body = commitBody();
    expect(body).toMatch(/buildRoofPlane3D\(newRing, \{ surfaceOffsetM: 0 \}\)/);
    expect(body, 'the rebuilt face no longer keeps its own id').toMatch(/built\.id = drag\.faceId;/);
  });

  it('passes surfaceOffsetM: 0 everywhere it re-fits — the 12 cm-per-press ratchet', () => {
    const body = commitBody();
    const fits = body.match(/(buildRoofPlane3D|computePlaneFromPoints3D)\([^)]*\)/g) ?? [];
    expect(fits.length).toBeGreaterThan(0);
    for (const f of fits) {
      expect(f, `a re-fit without surfaceOffsetM: 0 floats the roof 12 cm per release: ${f}`)
        .toMatch(/surfaceOffsetM: 0/);
    }
  });

  it('reports the count, because silence is the failure mode', () => {
    const body = commitBody();
    expect(body).toMatch(/culledCount/);
    expect(body, 'the status line no longer mentions the removed modules')
      .toMatch(/module\$\{culledCount === 1 \? '' : 's'\} removed/);
    expect(body, 'the status line no longer says Undo restores them').toMatch(/Undo to restore/);
  });

  it('emits exactly one reshape update, on release only', () => {
    const body = commitBody();
    expect((body.match(/onRoofPlanesStitched\?\.\(/g) ?? []).length).toBe(1);
    // And nothing canonical escapes the per-frame handler.
    const mv = ENGINE.indexOf('function vertexDragMove(');
    const mvBody = ENGINE.slice(mv, ENGINE.indexOf('\n    }', mv));
    expect(mvBody, 'the drag emits geometry per frame — that is hundreds of undo entries for one drag')
      .not.toMatch(/onRoofPlanesStitched|onPanelsChange|onPanelsAboutToBeCulled/);
  });

  it('🚨 emits the PRESERVED plan ring, not the rebuilt one', () => {
    // `built.vertices` are the LIFTED ring's lat/lng, because `surfaceOffsetM: 0`
    // disables the plan-record un-lift as well as the lift. Emitting them slides
    // all four plan corners down-slope by offset*sin(tilt) — including the three
    // nobody dragged — and that lands on the permit site plan.
    const body = commitBody();
    expect(body, 'the commit no longer preserves the unmoved plan corners')
      .toMatch(/movedPlanVertices\(/);
    expect(body).toMatch(/vertices: planVertices,/);
    expect(body, 'the commit went back to emitting the rebuilt plan ring')
      .not.toMatch(/vertices: built\.vertices,/);
  });

  it('carries the rebuilt AREA, which nothing downstream recomputes', () => {
    // `enrichRoofPlaneWithLECS` returns the centroid, the local vertices and the
    // edge angle — not the area. So without this the stored area keeps its
    // pre-reshape value on a gesture whose entire purpose is to change the
    // outline, and the primary-plane pick reads that number.
    const body = commitBody();
    expect(body).toMatch(/area: built\.area,/);
    expect(body).toMatch(/usableArea: built\.usableArea,/);
  });

  it('a no-op drag commits nothing at all', () => {
    const body = commitBody();
    expect(body).toMatch(/if \(!ringMoved\(drag\.ring0, newRing\)\)/);
    expect(body).toMatch(/if \(!drag\.armed \|\| !drag\.moved\)/);
  });
});
