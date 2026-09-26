/** @vitest-environment jsdom */
/**
 * tests/vertexMoveUndoPanelFidelity.test.tsx
 *
 * IS UNDO OF A CORNER MOVE CLEAN? NO. IT IS WRONG BY |drag| / cornerCount.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ASYMMETRY, IN ONE PARAGRAPH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The forward path of a corner drag CULLS. A panel still inside the new outline
 * keeps the user's placement byte-for-byte; one that fell off is removed and
 * named. That is the whole policy, and `tests/vertexMovePanelPolicy.test.ts`
 * pins the engine's refusal to call the rigid centroid map there.
 *
 * UNDO DOES NOT MATCH IT. The gesture's canonical emit leaves the engine on the
 * stitched channel, whose consumer in components/design/DesignStudio.tsx pushes
 * a history step through `recordGeometry`, and `recordGeometry` deliberately
 * carries NO panels — its documented premise is "every edit this records MOVES a
 * face: its panels are recomputed from where the face went". For a corner drag
 * that premise is FALSE. Nothing was recomputed; the array never moved.
 *
 * So the step says "recompute the panels", `applyRestoredGeometry` obeys it, and
 * the rigid centroid map runs on an array that must not move. Moving ONE corner
 * of an N-gon moves its ring centroid by |drag|/N, and the map translates every
 * panel by exactly that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MEASURES, THROUGH THE REAL HOOK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `applyRestoredGeometry` is a callback inside `useSiteDesign`, so it is reached
 * the only honest way: by rendering the hook the studio actually uses and
 * driving it through the exact call sequence the corner-move commit performs —
 * the cull snapshot, the panel removal, the geometry record, the adoption, then
 * Undo. No Cesium, no viewer, no GPU, and no re-implementation of the paths
 * under test. Every number below is measured, in metres, in ECEF.
 *
 * MEASURED, at Granite City's latitude on a real 6:12 face carrying 24 modules:
 *
 *   nothing culled, 1.2 m nudge   ->  ONE undo, roof exactly back,
 *                                     all 24 panels 0.3000 m out of place,
 *                                     and NO second undo exists. Permanent.
 *   9 of 24 culled, 5.8310 m drag ->  first undo: 15 survivors 1.4577 m out,
 *                                     second undo: all 24 back, 0.0000 m.
 *
 * The displacement equals the ring-centroid delta to 3.3e-9 m and the spread
 * across the array is under 1.3e-5 m, so it is a pure rigid translation — the
 * fingerprint of the centroid-anchored map and not of an accumulation of
 * rounding. Pitch and azimuth do not move: the drag is in-plane by construction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DEFECT IS ASSERTED RATHER THAN FIXED HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The map itself is not the bug and must not be narrowed. `lib/3d/sectionEditing`
 * owns it, and `tests/sectionEditKeepsPanels.test.ts` requires it to reposition
 * across a PITCH change — which deforms the ring exactly as a corner drag does.
 * Any "is this correspondence rigid?" gate inside the map would therefore break
 * section editing, and would put a second policy inside the one authority.
 *
 * The information that distinguishes the two cases exists only where the history
 * step is RECORDED, and the history already has the field for it:
 * `GeometrySnapshot.panels`. A step that carries panels restores them verbatim
 * and skips the map entirely. So the fix is one line at the record site, in a
 * file this round may not touch — see the report. This file therefore does two
 * things instead: it ASSERTS the defect with its measured magnitude, in the house
 * style of `tests/sectionEditKeepsPanels.test.ts`, and it states the invariant as
 * an expected-failure so that the moment anyone makes undo exact, this file goes
 * red and has to be updated deliberately. A ratchet in both directions.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSiteDesign } from '@/components/design/useSiteDesign';
import {
  buildRoofPlane3D, computePlaneFromPoints3D, latLngToECEF, type Cart3,
} from '@/lib/roofPlane3D';
import { enrichRoofPlaneWithLECS } from '@/lib/roofGeometry';
import { buildSurfaceGrid } from '@/lib/surfaceGeometry3D';
import { buildSectionRoofPlanes, sectionFaceId } from '@/lib/3d/buildingSection';
import { applySectionEdit, repositionPanelsForPlanes } from '@/lib/3d/sectionEditing';
import {
  ringToFaceUV, faceUVToEcef, inPlaneTarget, resolveVertexMove, movedPlanVertices,
  classifyPanelsAgainstRing, type FaceBasis,
} from '@/lib/3d/vertexMove';
import { stripComments } from './support/stripSource';
import { multiSectionHouse, GROUND_MAIN_M } from './fixtures/multiSectionHouse';
import type { PlacedPanel, RoofPlane } from '@/types';

const ROOT = join(__dirname, '..');
const STUDIO = stripComments(
  readFileSync(join(ROOT, 'components', 'design', 'DesignStudio.tsx'), 'utf8'),
);

/** Granite City. NOT the equator — see the note in tests/vertexMoveGeometry. */
const SITE_LAT = 38.67;
const SITE_LNG = -90.15;
const BASE_H = 30;
const RACKING = 'ironridge-xr100';

/** A 1.2 m nudge on a quadrilateral. 1.2 / 4 = 0.30 m of centroid travel. */
const NUDGE_M = 1.2;
const CORNERS = 4;

// ─── Fixture ─────────────────────────────────────────────────────────────────

/** A real 6:12 south-facing face, 10 m along the eave by 6 m of plan run,
 *  through the same authority the product builds faces with. */
function buildFace(): RoofPlane {
  const pitchRad = Math.atan(6 / 12);
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);
  const eaveM = 10, runM = 6;
  const rise = runM * Math.tan(pitchRad);
  const corners: Cart3[] = [
    latLngToECEF(SITE_LAT, SITE_LNG, BASE_H),
    latLngToECEF(SITE_LAT, SITE_LNG + eaveM / mPerDegLng, BASE_H),
    latLngToECEF(SITE_LAT + runM / mPerDegLat, SITE_LNG + eaveM / mPerDegLng, BASE_H + rise),
    latLngToECEF(SITE_LAT + runM / mPerDegLat, SITE_LNG, BASE_H + rise),
  ];
  return enrichRoofPlaneWithLECS(buildRoofPlane3D(corners));
}

function basisOf(p: RoofPlane): FaceBasis {
  return { origin: p.origin3D!, u: p.ecefFrame3D!.u, v: p.ecefFrame3D!.v, n: p.ecefFrame3D!.n };
}

/** A real array, laid by the engine Auto Layout uses. */
function layPanels(plane: RoofPlane, ground = BASE_H): PlacedPanel[] {
  const panels = buildSurfaceGrid({
    plane, groundElevM: ground, orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0.02, rowSpacingM: 0.02,
    layoutId: 'L1', wattage: 400, mountingSystemId: RACKING,
  } as never) as PlacedPanel[];
  expect(Array.isArray(panels) && panels.length > 0,
    'the fixture laid no panels — this file would be measuring nothing').toBe(true);
  return panels.map(q => ({ ...q, planeId: plane.id }));
}

const ecefOf = (p: PlacedPanel): Cart3 => latLngToECEF(p.lat, p.lng, p.height ?? 0);

function apartM(a: PlacedPanel, b: PlacedPanel): number {
  const x = ecefOf(a), y = ecefOf(b);
  return Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
}

function ringCentroidOf(p: RoofPlane): Cart3 {
  const g = p.polygon3D as Cart3[];
  return {
    x: g.reduce((s, w) => s + w.x, 0) / g.length,
    y: g.reduce((s, w) => s + w.y, 0) / g.length,
    z: g.reduce((s, w) => s + w.z, 0) / g.length,
  };
}

/** How far a panel stands off its face's plane, along the face normal. */
function standoffM(panel: PlacedPanel, plane: RoofPlane): number {
  const n = plane.normal3D!, o = plane.origin3D!;
  const p = ecefOf(panel);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

// ─── The gesture, exactly as the engine commits it (minus Cesium) ────────────

interface CornerMove {
  p1: RoofPlane;
  culled: string[];
  surviving: string[];
  dragM: number;
}

/**
 * Drag corner `index` by (du, dv) in the face's own plane and produce the plane
 * record the studio adopts, plus the cull verdict.
 *
 * Every step here is the engine's own: `resolveVertexMove` for the legal target,
 * `buildRoofPlane3D` with a zero surface offset (or the roof ratchets), the
 * face's own id kept, `movedPlanVertices` for the plan record, and
 * `classifyPanelsAgainstRing` for the membership test. Nothing is re-derived.
 */
function cornerMove(
  p0: RoofPlane, panels: PlacedPanel[], index: number, du: number, dv: number,
): CornerMove {
  const b0 = basisOf(p0);
  const ring0 = p0.polygon3D as Cart3[];
  const uv = ringToFaceUV(ring0, b0);
  const res = resolveVertexMove(uv, index, { e: uv[index].e + du, n: uv[index].n + dv });
  if (res.status !== 'ok') throw new Error(`the fixture's drag was refused: ${res.refusal}`);
  const newRing = res.ring.map(q => faceUVToEcef({ u: q.e, v: q.n }, b0));

  const built = buildRoofPlane3D(newRing, { surfaceOffsetM: 0 });
  built.id = p0.id;
  const nb = basisOf(built);
  const newRingUV = ringToFaceUV(built.polygon3D as Cart3[], nb);
  const onFace = panels.filter(q => q.planeId === p0.id);
  const { culled, surviving } = classifyPanelsAgainstRing(
    onFace.map(q => ({ id: q.id, point: ecefOf(q) })), newRingUV, nb);

  const planVertices = movedPlanVertices(
    p0.vertices as never, ring0, newRing, index, built.normal3D!) ?? built.vertices;

  // The field set the stitched consumer in DesignStudio writes onto the plane.
  const p1 = enrichRoofPlaneWithLECS({
    ...p0,
    vertices: planVertices,
    localFrame3D: built.localFrame3D,
    polygon3D: built.polygon3D,
    origin3D: built.origin3D,
    normal3D: built.normal3D,
    pitch: built.pitch,
    azimuth: built.azimuth,
    ecefFrame3D: built.ecefFrame3D,
  } as RoofPlane);

  const d = newRing[index];
  const o = ring0[index];
  return {
    p1, culled, surviving,
    dragM: Math.hypot(d.x - o.x, d.y - o.y, d.z - o.z),
  };
}

// ─── The hook, driven through the product's own sequence ─────────────────────

interface UndoReading {
  /** What the Undo button offered, before each press. */
  label1: string | null;
  label2: string | null;
  /** Live panel ids after each press. */
  after1: PlacedPanel[];
  after2: PlacedPanel[] | null;
  /** Worst displacement from the user's placement, in metres, after each press. */
  worst1: number;
  worst2: number;
  /** Largest disagreement between any two panels' displacement vectors. Near
   *  zero means the error is a single rigid translation, not per-panel noise. */
  spread1: number;
  /** Largest tilt and azimuth change, in degrees. */
  dTilt1: number;
  dAz1: number;
  secondUndoExisted: boolean;
  /** The roof the first press put back. */
  restored1: RoofPlane[];
}

/**
 * Seed the roof and the array, perform the corner move through the same calls
 * the engine makes, then press Undo once (and again if there is a second step).
 *
 * `dropCullSnapshot` is the in-suite mutation demanded by the gauntlet: it omits
 * the pre-cull history push and nothing else, so the test below can prove that
 * omitting it loses the culled modules for good.
 */
function driveUndo(
  p0: RoofPlane, panels: PlacedPanel[], mv: CornerMove,
  opts: { dropCullSnapshot?: boolean } = {},
): UndoReading {
  const r = renderHook(() => useSiteDesign());
  act(() => {
    r.result.current.setRoofPlanes([p0]);
    r.result.current.setPanels(panels);
  });

  act(() => {
    // The engine's commit, in its order: snapshot, remove, record, adopt.
    if (mv.culled.length > 0 && !opts.dropCullSnapshot) {
      r.result.current.recordGeometryWithPanels('Move roof corner');
    }
    if (mv.culled.length > 0) {
      const gone = new Set(mv.culled);
      r.result.current.setPanels(panels.filter(q => !gone.has(q.id)));
    }
    // DesignStudio's stitched consumer. It NOW carries the panels; it used to
    // call `recordGeometry`, which does not, and that was the root cause.
    r.result.current.recordGeometryWithPanels('Reshape roof');
    r.result.current.setRoofPlanes([mv.p1]);
  });

  const by0 = new Map(panels.map(q => [q.id, q]));
  const measure = (live: PlacedPanel[]) => {
    let worst = 0, spread = 0, dTilt = 0, dAz = 0;
    const vecs: Cart3[] = [];
    for (const q of live) {
      const o = by0.get(q.id);
      if (!o) continue;
      worst = Math.max(worst, apartM(o, q));
      dTilt = Math.max(dTilt, Math.abs((q.tilt ?? 0) - (o.tilt ?? 0)));
      dAz = Math.max(dAz, Math.abs((q.azimuth ?? 0) - (o.azimuth ?? 0)));
      const a = ecefOf(o), b = ecefOf(q);
      vecs.push({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    }
    for (const v of vecs) {
      spread = Math.max(spread,
        Math.hypot(v.x - vecs[0].x, v.y - vecs[0].y, v.z - vecs[0].z));
    }
    return { worst, spread, dTilt, dAz };
  };

  const label1 = r.result.current.undoGeometryLabel;
  act(() => { r.result.current.undoGeometry(); });
  const after1 = r.result.current.panels.slice();
  const restored1 = r.result.current.roofPlanes.slice();
  const m1 = measure(after1);

  const label2 = r.result.current.undoGeometryLabel;
  const secondUndoExisted = r.result.current.canUndoGeometry;
  let after2: PlacedPanel[] | null = null;
  let worst2 = -1;
  if (secondUndoExisted) {
    act(() => { r.result.current.undoGeometry(); });
    after2 = r.result.current.panels.slice();
    worst2 = measure(after2).worst;
  }

  return {
    label1, label2, after1, after2, restored1,
    worst1: m1.worst, worst2, spread1: m1.spread,
    dTilt1: m1.dTilt, dAz1: m1.dAz, secondUndoExisted,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// POSITIVE CONTROLS — these pass before any fix and must pass after one
// ═════════════════════════════════════════════════════════════════════════════

describe('the fixture is a real array on a real roof', () => {
  it('24 modules, one standoff, every one inside the outline', () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    expect(panels.length).toBe(24);

    const offs = panels.map(q => standoffM(q, p0));
    // 🚨 MEASURED, NOT ASSUMED: 3.4 mm across this array, and the bound is set
    // just above it. The four corners of this fixture are built with a
    // flat-earth metres-per-degree step, so they are NOT exactly coplanar on the
    // ellipsoid; the fitted plane carries that residual and the grid is laid
    // over the fit. A tolerance tighter than the fixture's own planarity would
    // be testing my arithmetic, not the code's. The defects this file is about
    // are 0.30 m and 1.46 m — three orders up.
    expect(Math.max(...offs) - Math.min(...offs),
      'one array on one plane must be one standoff').toBeLessThan(0.005);
    expect(offs[0]).toBeGreaterThan(0);
    expect(offs[0]).toBeLessThan(0.5);

    // Nothing is culled before anything has moved.
    const b0 = basisOf(p0);
    const { culled } = classifyPanelsAgainstRing(
      panels.map(q => ({ id: q.id, point: ecefOf(q) })),
      ringToFaceUV(p0.polygon3D as Cart3[], b0), b0);
    expect(culled).toEqual([]);
  });

  it('the measuring stick can see a panel that moved — the bound is not vacuous', () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const shifted = { ...panels[0], lat: panels[0].lat + 0.3 / 111_132 };
    // 30 cm north is 30 cm, to the millimetre. If this ever reads zero, every
    // displacement assertion in this file is measuring nothing.
    expect(apartM(panels[0], shifted)).toBeGreaterThan(0.29);
    expect(apartM(panels[0], shifted)).toBeLessThan(0.31);
    expect(apartM(panels[0], panels[0])).toBe(0);
  });
});

describe('the FORWARD path keeps the user placement exactly', () => {
  it('a committed corner move leaves every surviving panel byte-identical', () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const mv = cornerMove(p0, panels, 0, -NUDGE_M, 0);

    // The forward path filters; it never writes a panel. So the survivors that
    // reach state are the SAME objects, with the same numbers.
    const gone = new Set(mv.culled);
    const survivors = panels.filter(q => !gone.has(q.id));
    expect(survivors.length).toBeGreaterThan(0);
    for (const q of survivors) {
      const o = panels.find(w => w.id === q.id)!;
      expect(q.lat, `${q.id} lat`).toBe(o.lat);
      expect(q.lng, `${q.id} lng`).toBe(o.lng);
      expect(q.height, `${q.id} height`).toBe(o.height);
    }
    // …and each one is still on the deck at ITS OWN standoff.
    //
    // 🚨 EACH PANEL AGAINST ITSELF, not against panel zero. The fixture's own
    // planarity residual is 3.4 mm across the array, so comparing every panel
    // to one panel would measure that residual instead of the question, which
    // is "did this edit change this panel's standoff". It did not: the drag is
    // in-plane, so the surface the panel stands on never moved.
    for (const q of survivors) {
      expect(standoffM(q, mv.p1) - standoffM(q, p0), `${q.id} standoff`)
        .toBeCloseTo(0, 6);
    }
  });

  it('the re-fitted ECEF normal agrees to 9 dp and pitch/azimuth to under 1e-4 deg', () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const mv = cornerMove(p0, panels, 2, NUDGE_M, 0);

    // 🚨 NOT BIT-EXACT, AND SAYING SO IS THE POINT. A forward corner move
    // RE-FITS the ring, and Newell over a different set of points on a fixture
    // whose corners are not exactly coplanar returns a normal that agrees to
    // 2.6e-11 per component — about 1.5e-9 degrees of rotation — not to the
    // last bit. 9 decimal places is what tests/vertexMoveGeometry.test.ts pins
    // the same quantity at, and a claim of bit-exactness here would be false.
    //
    // Bit-exactness DOES hold on the undo path, and it is pinned there: the
    // restored plane is a deep JSON copy, so its normal must be identical.
    expect(mv.p1.ecefFrame3D!.n.x).toBeCloseTo(p0.ecefFrame3D!.n.x, 9);
    expect(mv.p1.ecefFrame3D!.n.y).toBeCloseTo(p0.ecefFrame3D!.n.y, 9);
    expect(mv.p1.ecefFrame3D!.n.z).toBeCloseTo(p0.ecefFrame3D!.n.z, 9);
    expect(Math.abs(mv.p1.pitch - p0.pitch)).toBeLessThan(1e-4);
    expect(Math.abs(mv.p1.azimuth - p0.azimuth)).toBeLessThan(1e-4);
  });

  it('an OUT-OF-PLANE drag moves the pitch by far more than that bound', () => {
    // 🚨 THE CONTROL THAT MAKES 1e-4 MEAN SOMETHING. Dropping the normal
    // component is what `inPlaneTarget` exists to do; take the raw hit instead
    // and the Newell fit absorbs the excursion by tilting the whole face.
    const p0 = buildFace();
    const b0 = basisOf(p0);
    const ring0 = (p0.polygon3D as Cart3[]).slice();
    const hit: Cart3 = {
      x: ring0[0].x + b0.u.x * NUDGE_M + b0.n.x * 0.5,
      y: ring0[0].y + b0.u.y * NUDGE_M + b0.n.y * 0.5,
      z: ring0[0].z + b0.u.z * NUDGE_M + b0.n.z * 0.5,
    };
    // The constrained target discards that 0.5 m; the raw hit keeps it.
    const constrained = inPlaneTarget(ring0[0], hit, b0);
    expect(Math.abs(
      (constrained.x - ring0[0].x) * b0.n.x
      + (constrained.y - ring0[0].y) * b0.n.y
      + (constrained.z - ring0[0].z) * b0.n.z)).toBeLessThan(1e-9);

    const bent = ring0.slice(); bent[0] = hit;
    const bentFit = computePlaneFromPoints3D(bent, { surfaceOffsetM: 0 });
    const flatFit = computePlaneFromPoints3D(ring0, { surfaceOffsetM: 0 });
    const tiltOf = (n: Cart3) => Math.acos(Math.min(1, Math.abs(n.z))) * 180 / Math.PI;
    expect(Math.abs(tiltOf(bentFit.normal) - tiltOf(flatFit.normal)),
      'a 0.5 m out-of-plane corner must move the fitted normal by degrees, not 1e-4')
      .toBeGreaterThan(0.5);
  });
});

describe('the repositioning authority itself is sound — do not break it', () => {
  const houseAsPlanes = (): RoofPlane[] => {
    const out: RoofPlane[] = [];
    for (const s of multiSectionHouse()) out.push(...buildSectionRoofPlanes(s).planes);
    return out;
  };

  it('a section eave raise still brings its array onto the new roof', () => {
    const planes = houseAsPlanes();
    const faceId = sectionFaceId('sec-main', 'slopeA');
    const before = planes.find(p => p.id === faceId)!;
    const panels = layPanels(before, GROUND_MAIN_M);
    const base = standoffM(panels[0], before);

    const edited = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.2 });
    expect(edited.ok).toBe(true);
    const after = edited.planes.find(p => p.id === faceId)!;

    const moved = repositionPanelsForPlanes(panels, planes, edited.planes);
    expect(moved.moved).toBe(panels.length);
    expect(moved.orphaned).toEqual([]);
    for (const q of moved.panels) {
      expect(standoffM(q, after), `${q.id}`).toBeCloseTo(base, 2);
    }
  });

  it('repositioning across an unchanged roof is a no-op', () => {
    const planes = houseAsPlanes();
    const faceId = sectionFaceId('sec-main', 'slopeA');
    const panels = layPanels(planes.find(p => p.id === faceId)!, GROUND_MAIN_M);
    const same = repositionPanelsForPlanes(panels, planes, planes);
    expect(same.orphaned).toEqual([]);
    for (let i = 0; i < panels.length; i++) {
      expect(same.panels[i].lat).toBe(panels[i].lat);
      expect(same.panels[i].lng).toBe(panels[i].lng);
      expect(same.panels[i].height).toBe(panels[i].height);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE ANSWER: UNDO OF A CORNER MOVE, MEASURED THROUGH THE REAL HOOK
// ═════════════════════════════════════════════════════════════════════════════

describe('🚨 undo of a corner move that culled NOTHING', () => {
  const setup = () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const mv = cornerMove(p0, panels, 0, -NUDGE_M, 0);
    expect(mv.culled, 'this scenario is the one where the cull is empty').toEqual([]);
    expect(mv.dragM).toBeCloseTo(NUDGE_M, 6);
    return { p0, panels, mv, reading: driveUndo(p0, panels, mv) };
  };

  it('🚨 THE DEFECT, FIXED: one undo puts all 24 modules back exactly', () => {
    // 🚨 WHAT THIS ASSERTED BEFORE THE FIX, and why the number mattered:
    //
    // The stitched consumer recorded its step with `recordGeometry`, whose
    // premise is that the edit MOVES a face and its panels are recomputed from
    // where the face went. Nothing on that channel recomputes them. So undo
    // obeyed the premise, ran the centroid-anchored map, and put all 24 modules
    // 0.3000 m out of place — exactly NUDGE_M / CORNERS, on a 1.2 m nudge of one
    // corner of a quadrilateral — with pitch and azimuth untouched, so nothing
    // on screen or in the plan record looked wrong.
    //
    // The record site now uses the recorder that carries the array verbatim, so
    // `restorePanelsVerbatim` sets `panelsAlreadyExact` and the map is skipped.
    const { panels, reading } = setup();
    expect(reading.label1).toBe('Reshape roof');
    expect(reading.after1.length).toBe(panels.length);
    expect(reading.worst1,
      `undo displaced the array by ${reading.worst1.toFixed(4)} m — the step is back on a ` +
      'recorder that carries no panels, so the rigid centroid map is running again')
      .toBeLessThan(0.001);
  });

  it('🚨 and it needed to be right FIRST TIME, because there is no second undo', () => {
    // Nothing was culled, so this gesture pushes exactly one step. There is no
    // second press to fall back on and no other control in the app that could
    // recover the array — which is why a displacement here was permanent, and
    // why the first press has to be exact rather than merely close.
    const { reading } = setup();
    expect(reading.secondUndoExisted).toBe(false);
    expect(reading.label2).toBe(null);
    expect(reading.after2).toBe(null);
  });

  it('🚨 the ring centroid DID move — so the map, had it run, would have been wrong', () => {
    // 🚨 THE CONTROL THAT KEEPS THE CASE ABOVE FROM BEING VACUOUS.
    //
    // "Every panel came back exactly" would also pass on a gesture that moved
    // nothing at all. This measures the quantity the centroid-anchored map would
    // have translated the array by, and requires it to be a real 0.30 m: moving
    // one corner of an N-gon moves the centroid by |drag|/N exactly. So the
    // array being exact after undo is a fact about the recorder, not about the
    // drag being too small to notice.
    //
    // Before the fix this same delta was measured against the observed
    // displacement and agreed to 7.5e-7 m — the fingerprint of the map, and the
    // evidence that identified it.
    const { p0, mv, reading } = setup();
    const c0 = ringCentroidOf(p0), c1 = ringCentroidOf(mv.p1);
    const cenDelta = Math.hypot(c0.x - c1.x, c0.y - c1.y, c0.z - c1.z);
    expect(cenDelta).toBeCloseTo(mv.dragM / CORNERS, 6);
    expect(cenDelta, 'the fixture stopped moving the centroid — this case proves nothing now')
      .toBeGreaterThan(0.29);
    // And the array did NOT move by it.
    expect(Math.abs(reading.worst1 - cenDelta)).toBeGreaterThan(0.29);
  });

  it('pitch and azimuth survive the undo — only the position is wrong', () => {
    const { p0, reading } = setup();
    // 🚨 THE ERROR IS PURELY POSITIONAL, AND THE SURFACE PROVES IT.
    //
    // The restored plane is a deep JSON copy of the pre-drag one, so HERE the
    // ECEF normal is pinned BIT-EXACT — this is the one place in the round trip
    // where that claim is true, and if it ever stops being true the history has
    // started restoring something other than what was recorded.
    const back = reading.restored1.find(q => q.id === p0.id)!;
    expect(back.ecefFrame3D!.n.x).toBe(p0.ecefFrame3D!.n.x);
    expect(back.ecefFrame3D!.n.y).toBe(p0.ecefFrame3D!.n.y);
    expect(back.ecefFrame3D!.n.z).toBe(p0.ecefFrame3D!.n.z);
    // The panels are therefore re-stamped with the tilt and azimuth they
    // already had. Bounded at 1e-4 deg, not pinned: a panel's tilt is read out
    // against a geodetic up, which carries a term of order 1e-6 deg.
    expect(reading.dTilt1).toBeLessThan(1e-4);
    expect(reading.dAz1).toBeLessThan(1e-4);
    // The outline came back too, so nothing about the ROOF is wrong — which is
    // exactly why the 0.30 m is silent.
    const c = ringCentroidOf(back), c0 = ringCentroidOf(p0);
    expect(Math.hypot(c.x - c0.x, c.y - c0.y, c.z - c0.z)).toBe(0);
  });

  it('THE INVARIANT — undo must return every panel to the exact placement', () => {
    // 🚨 THIS IS THE REQUIREMENT, AND IT IS EXPECTED TO FAIL TODAY.
    //
    // It is marked as an expected failure rather than deleted so that the day
    // the record site carries its panels, this line goes RED for passing, and
    // whoever fixed it has to come here and promote it. A defect recorded as
    // an expectation is a defect nobody can forget.
    //
    // A millimetre is the bound because that is comfortably above the geodetic
    // round-trip noise this file already measured (under 1.3e-5 m) and far
    // below the 0.30 m the defect produces.
    const { reading } = setup();
    expect(reading.worst1).toBeLessThan(0.001);
  });
});

describe('🚨 undo of a corner move that DID cull', () => {
  /** (5, 3) m in the face's plane — 5.8310 m, which cuts nine modules off. */
  const setup = (opts: { dropCullSnapshot?: boolean } = {}) => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const mv = cornerMove(p0, panels, 2, 5, 3);
    expect(mv.culled.length, 'this scenario needs a real cull').toBe(9);
    return { p0, panels, mv, reading: driveUndo(p0, panels, mv, opts) };
  };

  it('🚨 the FIRST press leaves the 15 survivors exactly where they were', () => {
    // 🚨 BEFORE THE FIX this read "leaves 15 survivors 1.46 m out" and asserted
    // `worst1 ≈ |drag| / CORNERS` — 1.4577 m on a 5.8310 m drag. The two-press
    // sequence made it look survivable, since the second press did restore all
    // 24 exactly. It was not: THIS is the state the autosave signs between the
    // two presses, and a user who pressed Undo once and carried on saved an
    // array 1.46 m off the roof, silently, with pitch and azimuth correct.
    const { panels, mv, reading } = setup();
    expect(reading.label1).toBe('Reshape roof');
    // The culled nine are still gone at this point; only survivors are live.
    expect(reading.after1.length).toBe(panels.length - mv.culled.length);
    expect(reading.after1.length).toBe(15);
    expect(reading.worst1,
      `the survivors came back ${reading.worst1.toFixed(4)} m out of place — this is the array ` +
      'the autosave would sign')
      .toBeLessThan(0.001);
    // The control: the displacement the map WOULD have applied is a real
    // 1.46 m, so the exactness above is the recorder working rather than a drag
    // too small to matter.
    expect(mv.dragM / CORNERS).toBeGreaterThan(1.4);
  });

  it('the SECOND press puts all 24 back, by id, exactly', () => {
    const { panels, reading } = setup();
    expect(reading.label2).toBe('Move roof corner');
    expect(reading.after2).not.toBe(null);
    // 🚨 EVERY ASSERTION COMPARES IDS. "24 came back" is satisfied by 24 of
    // somebody else's modules.
    expect(reading.after2!.map(q => q.id).sort()).toEqual(panels.map(q => q.id).sort());
    // And exactly: the cull step carries the array verbatim, so
    // `panelsAlreadyExact` is set and the map is skipped entirely.
    expect(reading.worst2).toBe(0);
  });

  it('MUTATION — dropping the cull snapshot loses the nine for ever', () => {
    // 🚨 THE GAUNTLET'S "DROP THE SNAPSHOT" MUTATION, RUN IN THE SUITE RATHER
    // THAN BY HAND, so it stays run. Omit the pre-cull history push and nothing
    // else: the second undo disappears with it and the nine culled modules can
    // never be recovered.
    const { panels, mv, reading } = setup({ dropCullSnapshot: true });
    expect(reading.secondUndoExisted).toBe(false);
    expect(reading.after1.length).toBe(panels.length - mv.culled.length);
    const live = new Set(reading.after1.map(q => q.id));
    for (const id of mv.culled) expect(live.has(id), `${id} is gone`).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE ROOT CAUSE, PINNED AT ITS SOURCE
// ═════════════════════════════════════════════════════════════════════════════

describe('🚨 undo of a drag that GREW the face — the array is TORN, not shifted', () => {
  /**
   * 🚨 THE WORST FORM OF THIS DEFECT, AND THE ONE THAT PUTS MODULES INSIDE EACH
   * OTHER.
   *
   * The containment guard inside the map is the reason. Growing a face by
   * dragging one corner OUT moves the centroid out with it, so the undo's rigid
   * translation carries the array towards the restored — smaller — outline. The
   * panels nearest that edge land off it, and the guard correctly refuses to move
   * them: they are named orphans and returned untouched. The rest are moved.
   *
   * So the array comes back in TWO pieces: a few modules exactly where the user
   * put them, the remainder 1.8 m away, and the spacing between the two groups
   * is whatever arithmetic produced. `applyRestoredGeometry` does not read
   * `orphaned` at all, so nothing tells anybody.
   */
  const GROW: [number, number, number] = [0, 6, 4];

  const setup = () => {
    const p0 = buildFace();
    const panels = layPanels(p0);
    const mv = cornerMove(p0, panels, GROW[0], GROW[1], GROW[2]);
    expect(mv.culled, 'growing a face culls nothing — the outline only got bigger')
      .toEqual([]);
    const reading = driveUndo(p0, panels, mv);
    const by0 = new Map(panels.map(q => [q.id, q]));
    const exact: string[] = [], displaced: string[] = [];
    let worst = 0;
    for (const q of reading.after1) {
      const d = apartM(by0.get(q.id)!, q);
      if (d === 0) exact.push(q.id); else { displaced.push(q.id); worst = Math.max(worst, d); }
    }
    return { p0, panels, mv, reading, exact, displaced, worst };
  };

  /** Closest centre-to-centre distance between any two modules, in metres. */
  const minPairM = (list: PlacedPanel[]): number => {
    let m = Infinity;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) m = Math.min(m, apartM(list[a], list[b]));
    }
    return m;
  };

  it('🚨 all 24 come back exact — the array is no longer torn in two', () => {
    // 🚨 WHAT THIS MEASURED BEFORE THE FIX, and it is the worst form of the
    // defect, so the numbers are kept:
    //
    // 7.2111 m of corner travel, so 1.80278 m of centroid travel. THREE of 24
    // modules came back exactly where the user put them and TWENTY-ONE came back
    // 1.8028 m away. The containment guard inside the map is what split them:
    // growing the face moves the centroid outward, the rigid translation carries
    // the array towards the restored — smaller — outline, the panels nearest
    // that edge land off it, and the guard correctly refuses to move those. So
    // the array came back in two pieces, and `applyRestoredGeometry` does not
    // read `orphaned` at all, so nothing told anybody.
    const { mv, exact, displaced } = setup();
    expect(mv.dragM).toBeCloseTo(Math.hypot(6, 4), 4);
    expect(displaced.length,
      `${displaced.length} of 24 modules came back displaced — the array is torn again`)
      .toBe(0);
    expect(exact.length).toBe(24);
    // The control: the translation the map would have applied is a real 1.80 m,
    // so this is not a drag too small to tear anything.
    expect(mv.dragM / CORNERS).toBeGreaterThan(1.8);
  });

  it('🚨 so the modules no longer OVERLAP — the spacing is the laid-out spacing', () => {
    // 🚨 BEFORE THE FIX: nearest-neighbour spacing collapsed from 1.1488 m to
    // 0.8143 m. Two modules a third of a metre closer than a module is wide —
    // inside each other, on a roof, in a permit drawing. That is what a torn
    // array looks like in physical units, and it is why the tear mattered more
    // than the displacement.
    const { panels, reading } = setup();
    const before = minPairM(panels);
    const after = minPairM(reading.after1);
    // A laid-out array has one nearest-neighbour pitch. Measured: 1.1488 m.
    expect(before).toBeCloseTo(1.1488, 3);
    expect(after,
      `module spacing came back at ${after.toFixed(4)} m against a laid-out ${before.toFixed(4)} m`)
      .toBeCloseTo(before, 6);
  });

  it('the measuring stick would still SEE a tear — the bound is not vacuous', () => {
    // 🚨 THE CONTROL FOR THE TWO CASES ABOVE. "Spacing unchanged" and "nothing
    // displaced" are both satisfied by a measurement that cannot detect
    // anything. So: displace a subset of the array by hand, exactly as a partial
    // orphaning would, and require both measures to notice.
    const p0 = buildFace();
    const panels = layPanels(p0);
    expect(minPairM(panels)).toBeCloseTo(1.1488, 3);

    // Move all but three of them 1.8 m along the face — the shape of the tear.
    const torn = panels.map((q, i) => (i < 3 ? q : {
      ...q,
      lat: q.lat + 1.8028 / 111_132,
    }));
    const tornSpacing = minPairM(torn);
    expect(tornSpacing, 'the spacing measure cannot see a tear, so the assertion above is empty')
      .toBeLessThan(minPairM(panels) - 0.3);

    const by0 = new Map(panels.map(q => [q.id, q]));
    const movedCount = torn.filter(q => apartM(by0.get(q.id)!, q) > 0.001).length;
    expect(movedCount, 'the displacement measure cannot see a tear either').toBe(21);
  });
});

describe('🚨 the record site is why the map runs at all', () => {
  it('🚨 the stitched consumer records a step that CARRIES the panels', () => {
    // 🚨 THE ONE LINE THAT WAS THE WHOLE DEFECT. This consumer pushed through
    // the plain geometry recorder, whose contract is that panels are recomputed
    // from the restored roof. Nothing on this channel recomputes them — Square
    // Up, Stitch, the flat-trace rebuild, the standalone face nudge and the
    // move-corner drag all cull instead — so that contract was a false statement
    // about all five gestures, and undo acted on it.
    //
    // Pinned at the source, in both directions, so a revert cannot land quietly.
    const at = STUDIO.indexOf('onRoofPlanesStitched={(updates) => {');
    expect(at, 'the stitched consumer moved — re-find it').toBeGreaterThan(0);
    const body = STUDIO.slice(at, STUDIO.indexOf('setRoofPlanes(prev =>', at));
    expect(body, 'the stitched consumer no longer carries its panels into history')
      .toMatch(/site\.recordGeometryWithPanels\('Reshape roof'\)/);
    // And NOT the recorder whose premise is that panels get recomputed. Matched
    // with a boundary so the name above — which contains it — cannot satisfy it.
    expect(body, 'the panel-less recorder is back on this channel')
      .not.toMatch(/site\.recordGeometry\(/);
  });

  it('the array-carrying recorder is wired to BOTH channels', () => {
    // The fix needed no new code: the channel that restores panels verbatim was
    // already built, already deep-copied, and was already passed to the engine
    // for the cull. It was simply not used by the stitched consumer. It is now,
    // and this pins both call sites so neither can drift back.
    const RECORDER = 'recordGeometryWithPanels';
    expect(STUDIO, 'the cull channel no longer carries its panels').toMatch(
      new RegExp('onPanelsAboutToBeCulled=\\{site\\.' + RECORDER + '\\}'));
    expect(STUDIO, 'the stitched consumer is back on a recorder that carries no panels').toMatch(
      new RegExp('site\\.' + RECORDER + "\\('Reshape roof'\\)"));
  });

  it('🚨 and the recorder is named for what it carries, not for its first caller', () => {
    // 🚨 THE NAME WAS PART OF THE DEFECT. It was `recordPanelCull`, so the
    // corner-move gesture — which culls nothing in the common case — reached for
    // `recordGeometry` instead, whose premise is that panels are recomputed from
    // where the face went. Nothing on this channel recomputes them. A name that
    // describes one caller rather than the guarantee is an invitation to pick
    // the wrong one, and it was accepted.
    const HOOK = stripComments(
      readFileSync(join(ROOT, 'components', 'design', 'useSiteDesign.ts'), 'utf8'));
    expect(HOOK, 'the recorder is back to a name that describes only its first caller')
      .not.toMatch(/recordPanelCull:\s*\(/);
    expect(HOOK).toMatch(/recordGeometryWithPanels:\s*\(label: string\) => void;/);
  });
});
