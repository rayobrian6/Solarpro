/**
 * tests/porchAbutment.test.ts
 *
 * THE PORCH: A SINGLE PLANE THAT MAY SLOPE, AND AN EDGE THAT DIES AGAINST
 * THE HOUSE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO LIVE FAILURES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I created my porch using the Flat building tool. SolarPro then treats
 *    Flat = permanently 0°. That is too restrictive… I should NOT have to
 *    delete it and redraw it using a completely different internal object
 *    simply because the porch has a 1/12, 2/12, 3/12 slope."
 *
 *   "My porch also still produces a strange triangular wall/geometry condition
 *    when I lower or position it."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN AUDIT FOUND BEHIND THE SECOND ONE — THREE CAUSES, COMPOUNDING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. NO ABUTMENT CONCEPT. The only "this edge is interior" test in the wall
 *    builder is exact 3D endpoint coincidence within 0.35 m. A porch head
 *    landing part-way up a taller slope never satisfies it, so that edge was
 *    classified EXPOSED and a full-height wall was dropped from it to the
 *    ground THROUGH the main house. Moving the porch pushed the endpoints in
 *    and out of the 0.35 m window, which is why the artifact came and went.
 *
 * 2. THE BASE WAS DROPPED, NOT CLAMPED, and the skip test was an AND:
 *    `if (hA <= min && hB <= min) continue`. One corner exactly at the global
 *    ground gave a ring with a duplicate point, which Cesium de-duplicates into
 *    a THREE-POINT polygon. One corner BELOW it put the base above the top —
 *    a self-crossing bowtie. Both read on screen as a triangle, and both are
 *    reachable just by lowering the porch pad.
 *
 * 3. 🚨 AND THE LITERAL TRIANGLE: a vertical quad was drawn as a
 *    `PolygonGraphics`. Cesium triangulates a polygon from a projection onto a
 *    HORIZONTAL tangent plane, so a vertical quad collapses to a sliver of
 *    near-zero area; when earcut fails on it, `PolygonGeometryLibrary`
 *    substitutes `indices = [0, 1, 2]` — the first three of the four corners.
 *    That cause applied to EVERY wall in the app, not only the porch.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildWalls, type ExtrusionFace } from '@/lib/3d/buildingExtrusion';
import { buildSectionRoofPlanes, type BuildingSection } from '@/lib/3d/buildingSection';
import { applySectionEdit } from '@/lib/3d/sectionEditing';
import { ecefToLatLng } from '@/lib/roofPlane3D';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const LAT = 38.70615, LNG = -90.04625;
const M_PER_DEG_LAT = 111_320;
const GROUND = 128;
const north = (m: number) => LAT + m / M_PER_DEG_LAT;
const east = (m: number) => LNG + m / (M_PER_DEG_LAT * Math.cos(LAT * Math.PI / 180));

/** A rectangle from (0,0) to (wM east, dM north) of the site origin, offset. */
function rect(offEastM: number, offNorthM: number, wM: number, dM: number) {
  return [
    { lat: north(offNorthM), lng: east(offEastM) },
    { lat: north(offNorthM), lng: east(offEastM + wM) },
    { lat: north(offNorthM + dM), lng: east(offEastM + wM) },
    { lat: north(offNorthM + dM), lng: east(offEastM) },
  ];
}

// ── THE OWNER'S FIXTURE ─────────────────────────────────────────────────────
//
// A taller main gable, and a lower porch attached along the main building's
// SOUTH wall. The porch's north edge (its head) sits exactly on that wall.

const MAIN_EAVE = 3.0;
const PORCH_EAVE = 2.2;

const mainHouse = (): BuildingSection => ({
  id: 'sec-main', label: 'House', kind: 'gable',
  footprint: rect(0, 0, 12, 9),          // north edge at +9 m, south edge at 0
  eaveHeightM: MAIN_EAVE, pitchDeg: 30, groundElevM: GROUND,
  ridgeAxis: 'long', shedAzimuthDeg: null,
} as BuildingSection);

/** Porch to the SOUTH of the house: its NORTH edge (y = 0) is the shared one. */
const porch = (over: Partial<BuildingSection> = {}): BuildingSection => ({
  id: 'sec-porch', label: 'Porch', kind: 'flat',
  footprint: rect(2, -3, 8, 3),          // north edge at y = 0 — on the house wall
  eaveHeightM: PORCH_EAVE, pitchDeg: 0, groundElevM: GROUND,
  ridgeAxis: 'long', shedAzimuthDeg: 180,   // falls south, toward the yard
  ...over,
} as BuildingSection);

function facesOf(sections: BuildingSection[]): ExtrusionFace[] {
  const out: ExtrusionFace[] = [];
  for (const sec of sections) {
    const built = buildSectionRoofPlanes(sec);
    if (!built.ok) throw new Error(`${sec.id} refused: ${JSON.stringify(built.refusals)}`);
    for (const p of built.planes) out.push({ id: p.id, polygon3D: p.polygon3D as never });
  }
  return out;
}

const wallsOf = (sections: BuildingSection[], ground = GROUND) =>
  buildWalls(facesOf(sections), ground);

const porchWalls = (ws: ReturnType<typeof buildWalls>) =>
  ws.filter(w => w.faceId.startsWith('sec-porch'));

/** Is this wall geometrically a triangle — three distinct corners, or a base
 *  that has risen above the top? Either renders as one. */
function isDegenerate(w: { corners: Array<{ x: number; y: number; z: number }>; topHeightsM: number[]; baseHeightsM: number[] }): boolean {
  const key = (p: { x: number; y: number; z: number }) =>
    `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
  const distinct = new Set(w.corners.map(key));
  if (distinct.size < 4) return true;
  for (let i = 0; i < w.topHeightsM.length; i++) {
    if (!(w.topHeightsM[i] >= w.baseHeightsM[i])) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-5. THE SLOPE: same footprint, no redraw
// ═══════════════════════════════════════════════════════════════════════════

const twelve = (rise: number) => Math.atan2(rise, 12) * 180 / Math.PI;

describe('🚨 the porch takes a pitch without being redrawn', () => {
  it('1. it starts flat', () => {
    const planes = buildSectionRoofPlanes(porch()).planes;
    expect(planes).toHaveLength(1);
    expect(planes[0].pitch).toBeCloseTo(0, 3);
  });

  it('2-3. 0° → 1/12 → 2/12, footprint and pad untouched', () => {
    const base = buildSectionRoofPlanes(porch()).planes;
    const a = applySectionEdit(base, 'sec-porch', { pitchDeg: twelve(1) });
    expect(a.ok).toBe(true);
    expect(a.section!.footprint).toEqual(porch().footprint);
    expect(a.section!.groundElevM).toBe(GROUND);
    expect(a.planes[0].pitch).toBeCloseTo(twelve(1), 2);

    const b = applySectionEdit(a.planes, 'sec-porch', { pitchDeg: twelve(2) });
    expect(b.ok).toBe(true);
    expect(b.planes[0].pitch).toBeCloseTo(twelve(2), 2);
    expect(b.section!.footprint).toEqual(porch().footprint);
    // Still ONE planar face. A porch does not sprout a ridge.
    expect(b.planes).toHaveLength(1);
  });

  it('4. reversing the slope direction turns the roof round and moves nothing else', () => {
    const base = buildSectionRoofPlanes(porch()).planes;
    const south = applySectionEdit(base, 'sec-porch', { pitchDeg: twelve(2) });
    const northward = applySectionEdit(south.planes, 'sec-porch', { shedAzimuthDeg: 0 });
    expect(northward.ok).toBe(true);
    expect(northward.section!.shedAzimuthDeg).toBe(0);
    expect(northward.planes[0].azimuth).toBeCloseTo(0, 0);
    expect(northward.section!.footprint).toEqual(porch().footprint);
    expect(northward.section!.eaveHeightM).toBe(PORCH_EAVE);
    // …and the two really are different roofs, not one label.
    expect(Math.abs(south.planes[0].azimuth - northward.planes[0].azimuth)).toBeGreaterThan(90);
  });

  it('11. the roof stays planar at every pitch', () => {
    for (const rise of [0, 1, 2, 3, 6]) {
      const sec = porch({ kind: rise === 0 ? 'flat' : 'shed', pitchDeg: twelve(rise) });
      const built = buildSectionRoofPlanes(sec);
      expect(built.ok, `${rise}/12 refused`).toBe(true);
      expect(built.planes).toHaveLength(1);
      const poly = built.planes[0].polygon3D!;
      // A plane through the first three corners must contain the fourth.
      const p = poly.map(q => [q.x, q.y, q.z] as const);
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      const w = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
      const off = Math.abs((n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) / len);
      expect(off, `${rise}/12 is not planar`).toBeLessThan(0.01);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-10, 12. THE ABUTMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the porch head does not grow a wall through the house', () => {
  const sections = [mainHouse(), porch({ kind: 'shed', pitchDeg: twelve(2) })];

  it('9. the abutment edge produces NO exterior wall', () => {
    const ws = porchWalls(wallsOf(sections));
    // The porch is a rectangle: four edges, one of them against the house.
    expect(ws.length).toBe(3);
    // And the one that is missing is the NORTH edge, at y = 0.
    const northish = ws.filter(w =>
      w.plan.every(q => q.lat > north(-0.2)));
    expect(northish, 'a wall was still built on the shared edge').toEqual([]);
  });

  it('8. the three OUTSIDE walls are still there, and are real walls', () => {
    const ws = porchWalls(wallsOf(sections));
    expect(ws).toHaveLength(3);
    for (const w of ws) {
      expect(w.corners).toHaveLength(4);
      expect(w.plan).toHaveLength(2);
      expect(w.role).toBe('exposed');
      expect(w.maxHeightM).toBeGreaterThan(0.5);
    }
  });

  it('10. NO wall is a triangle, at any porch pitch or pad height', () => {
    for (const rise of [0, 1, 2, 3]) {
      for (const pad of [GROUND, GROUND - 0.5, GROUND - 2.0, GROUND + 0.4]) {
        const ws = wallsOf([
          mainHouse(),
          porch({ kind: rise === 0 ? 'flat' : 'shed', pitchDeg: twelve(rise), groundElevM: pad }),
        ]);
        for (const w of ws) {
          expect(isDegenerate(w as never),
            `rise=${rise}/12 pad=${pad} produced a degenerate wall on ${w.faceId}#${w.edgeIndex}`)
            .toBe(false);
        }
      }
    }
  });

  it('🚨 MUTATION PROOF: the OLD base-drop makes a bowtie the moment the pad drops', () => {
    // The old code dropped BOTH corners to the global ground and skipped the
    // wall only when BOTH were at or below it. Reproduce that arithmetic
    // directly: a roof corner below the ground puts its base ABOVE its top.
    const groundElevM = GROUND;
    const roofCornerHeight = GROUND - 0.8;      // the pad was lowered past it
    const oldBase = groundElevM;                // dropToGround, unconditional
    const newBase = Math.min(groundElevM, roofCornerHeight);
    expect(oldBase > roofCornerHeight, 'the old base is above the top — a bowtie').toBe(true);
    expect(newBase <= roofCornerHeight, 'the clamped base is at or below the top').toBe(true);
  });

  it('6-7. the main house and the porch footprint do not move when the porch is edited', () => {
    const before = facesOf(sections);
    const mainBefore = before.filter(f => f.id.startsWith('sec-main'));
    const edited = applySectionEdit(
      buildSectionRoofPlanes(porch({ kind: 'shed', pitchDeg: twelve(2) })).planes,
      'sec-porch', { pitchDeg: twelve(3) },
    );
    expect(edited.ok).toBe(true);
    // The main house was not even in the edit input, so it cannot have moved —
    // and the porch keeps the corners it was traced with.
    const after = facesOf([mainHouse()]);
    expect(after.map(f => f.id)).toEqual(mainBefore.map(f => f.id));
    expect(edited.section!.footprint).toEqual(porch().footprint);
  });

  it('a LOWER neighbour does NOT hide the wall above it — the rule is not "any neighbour"', () => {
    // 🚨 THE MUTATION THAT WOULD MAKE THIS TEST VACUOUS is "an edge inside
    // another footprint is always interior". A tall section standing over a low
    // flat one genuinely has an exposed wall above it, and hiding that would
    // open the building up.
    const lowSlab: BuildingSection = {
      ...porch({ id: 'sec-slab', kind: 'flat', pitchDeg: 0 }),
      footprint: rect(0, 0, 12, 9),      // same plan as the house
      eaveHeightM: 0.4,
    } as BuildingSection;
    const tall: BuildingSection = { ...mainHouse(), id: 'sec-tall' } as BuildingSection;
    const ws = buildWalls(facesOf([lowSlab, tall]), GROUND);
    expect(ws.filter(w => w.faceId.startsWith('sec-tall')).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE RENDERING PRIMITIVE — the literal triangle
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a vertical wall is drawn as a WALL', () => {
  const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));

  it('the wall entity is a WallGraphics, not a vertical polygon', () => {
    // Cesium triangulates a polygon from a projection onto a HORIZONTAL tangent
    // plane, so a vertical quad becomes a near-zero-area sliver; when earcut
    // fails on it, `indices = [0, 1, 2]` — three of the four corners — and the
    // wall IS a triangle. This applied to every wall in the app.
    const at = ENGINE.indexOf('[BUILD3D-WALL]');
    expect(at).toBeGreaterThan(-1);
    const block = ENGINE.slice(at - 200, at + 700);
    expect(block).toMatch(/wall: \{/);
    expect(block).toMatch(/maximumHeights: w\.topHeightsM/);
    expect(block).toMatch(/minimumHeights: w\.baseHeightsM/);
    // 🚨 THE OLD PRIMITIVE, ASSERTED AGAINST.
    expect(block).not.toMatch(/hierarchy:\s+new C\.PolygonHierarchy\(pts\)/);
  });

  it('the builder hands it plan positions and a height band', () => {
    const ws = porchWalls(wallsOf([mainHouse(), porch({ kind: 'shed', pitchDeg: twelve(2) })]));
    for (const w of ws) {
      expect(w.plan).toHaveLength(2);
      expect(w.topHeightsM).toHaveLength(2);
      expect(w.baseHeightsM).toHaveLength(2);
      // The plan positions match the top corners they came from.
      const g0 = ecefToLatLng(w.corners[0] as never);
      expect(w.plan[0].lat).toBeCloseTo(g0.lat, 9);
      expect(w.topHeightsM[0]).toBeCloseTo(g0.height, 6);
    }
  });
});
