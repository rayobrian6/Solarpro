/**
 * tests/obstructionGeometry.test.ts
 *
 * "THAT IS A TREE, ROUGHLY 35 FT TALL WITH A 20 FT CANOPY."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every placed object was drawn by one call that extruded a rectangle. A tree
 * was a green box; a chimney was a white one. The source comment admitted it:
 * "It is the same primitive; only the colour says which of the two kinds of
 * object it is."
 *
 * 🚨 AND THE EXTRUSION DATUM WAS WRONG IN A WAY THE BROWSER GATE COULD NOT SEE.
 * `extrudedHeight` is the ALTITUDE of the top face, not a height above the
 * base. Measured in real Cesium with positions at 150 m and extrudedHeight 8:
 * the solid rendered from 8 m to 150 m — 142 m tall. Every object at every
 * property with a real elevation was a spike from near the ellipsoid up to the
 * ground.
 *
 * It passed the browser gate because the ground elevation resolves only from
 * the Google Solar API, so on the test property it is unresolved and reads 0 —
 * and with a base of 0, an absolute top of 8 and a relative top of 8 are the
 * same number. The defect was invisible precisely where it was measured.
 *
 * So these assertions are about ALTITUDES with a non-zero base, deliberately.
 * A test that places everything at ground zero re-creates the blind spot.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildObstructionGeometry,
  canopyRadiusFor,
  isTreeLike,
  TRUNK_FRACTION_OF_HEIGHT,
  type CylinderPart,
  type EllipsoidPart,
  type PrismPart,
} from '@/lib/3d/obstructionGeometry';

/** A realistic site elevation. Nothing here is allowed to sit at 0. */
const GROUND = 150.0;
const FT = 0.3048;

const trunkOf = (g: ReturnType<typeof buildObstructionGeometry>) =>
  g.parts.find(p => p.role === 'trunk') as CylinderPart;
const canopyOf = (g: ReturnType<typeof buildObstructionGeometry>) =>
  g.parts.find(p => p.role === 'canopy') as EllipsoidPart;
const bodyOf = (g: ReturnType<typeof buildObstructionGeometry>) =>
  g.parts.find(p => p.role === 'body') as PrismPart;

describe("🚨 the owner's acceptance test: a 35 ft tree with a 20 ft canopy", () => {
  const g = buildObstructionGeometry({
    type: 'tree', space: 'site',
    widthM: 20 * FT, depthM: 20 * FT, heightM: 35 * FT,
    baseAltitudeM: GROUND,
  });

  it('is 35 ft from the ground to the top of its canopy', () => {
    expect(g.totalHeightM / FT).toBeCloseTo(35, 6);
    expect(g.topAltitudeM).toBeCloseTo(GROUND + 35 * FT, 6);
    // The literal thing a person would measure: the highest drawn point.
    const c = canopyOf(g);
    expect((c.centreAltitudeM + c.radiusZM) / FT).toBeCloseTo((GROUND + 35 * FT) / FT, 6);
  });

  it('has a canopy 20 ft across', () => {
    const c = canopyOf(g);
    expect((c.radiusXM * 2) / FT).toBeCloseTo(20, 6);
    expect((c.radiusYM * 2) / FT).toBeCloseTo(20, 6);
    expect(g.maxWidthM / FT).toBeCloseTo(20, 6);
  });

  it('🚨 stands ON the ground — the trunk starts at the ground, not below it', () => {
    const t = trunkOf(g);
    const trunkBase = t.centreAltitudeM - t.lengthM / 2;
    expect(trunkBase).toBeCloseTo(GROUND, 6);
    // And nothing is underground.
    for (const p of g.parts) {
      const lowest = p.kind === 'prism' ? p.bottomAltitudeM
        : p.kind === 'cylinder' ? p.centreAltitudeM - p.lengthM / 2
        : p.centreAltitudeM - p.radiusZM;
      expect(lowest, `${p.role} is below the ground`).toBeGreaterThanOrEqual(GROUND - 1e-9);
    }
  });

  it('has a visible trunk under the canopy, and they meet', () => {
    const t = trunkOf(g), c = canopyOf(g);
    const trunkTop = t.centreAltitudeM + t.lengthM / 2;
    const canopyBottom = c.centreAltitudeM - c.radiusZM;
    expect(trunkTop, 'the canopy floats above the trunk').toBeCloseTo(canopyBottom, 6);
    expect(t.lengthM, 'there is no trunk to see').toBeGreaterThan(0.5);
    expect(t.radiusM).toBeGreaterThan(0);
    expect(t.radiusM, 'the trunk is as fat as the canopy').toBeLessThan(c.radiusXM / 2);
  });
});

describe('🚨 the shape stays truthful at any size', () => {
  for (const [h, w] of [[3, 2], [8, 6], [30, 25], [1, 1]] as const) {
    it(`a ${h} m tree with a ${w} m canopy measures ${h} m and ${w} m`, () => {
      const g = buildObstructionGeometry({
        type: 'tree', space: 'site', widthM: w, depthM: w, heightM: h,
        baseAltitudeM: GROUND,
      });
      expect(g.totalHeightM).toBeCloseTo(h, 9);
      expect(g.maxWidthM).toBeCloseTo(w, 9);
      expect(canopyOf(g).radiusXM * 2).toBeCloseTo(w, 9);
      const t = trunkOf(g);
      expect(t.centreAltitudeM - t.lengthM / 2).toBeCloseTo(GROUND, 9);
      expect(canopyOf(g).centreAltitudeM + canopyOf(g).radiusZM).toBeCloseTo(GROUND + h, 9);
    });
  }

  it('the trunk is a proportion of height, never a fixed 2 m', () => {
    // The dead decorative tree hardcoded trunkHeightM = 2.0 and
    // foliageRadiusM = 1.8 for every tree ever placed. A 30 m tree and a 3 m
    // tree came out the same shape.
    const small = buildObstructionGeometry({ type: 'tree', widthM: 2, depthM: 2, heightM: 3, baseAltitudeM: GROUND });
    const big = buildObstructionGeometry({ type: 'tree', widthM: 25, depthM: 25, heightM: 30, baseAltitudeM: GROUND });
    expect(trunkOf(small).lengthM).toBeCloseTo(3 * TRUNK_FRACTION_OF_HEIGHT, 9);
    expect(trunkOf(big).lengthM).toBeCloseTo(30 * TRUNK_FRACTION_OF_HEIGHT, 9);
    expect(trunkOf(big).lengthM).toBeGreaterThan(trunkOf(small).lengthM * 5);
    expect(trunkOf(big).radiusM, 'a 25 m canopy has the same trunk as a 2 m one')
      .toBeGreaterThan(trunkOf(small).radiusM);
  });
});

describe('🚨 a roof object stands ON the roof, at an ABSOLUTE altitude', () => {
  // The regression this whole file exists for. `extrudedHeight` is an altitude.
  const ROOF = 156.4;
  const g = buildObstructionGeometry({
    type: 'chimney', space: 'roof',
    widthM: 0.9, depthM: 0.6, heightM: 1.2, baseAltitudeM: ROOF,
  });

  it('its base is the roof and its top is the roof plus its height', () => {
    const b = bodyOf(g);
    expect(b.bottomAltitudeM).toBeCloseTo(ROOF, 9);
    expect(b.topAltitudeM).toBeCloseTo(ROOF + 1.2, 9);
  });

  it('🚨 it is 1.2 m tall, not 155 m tall', () => {
    const b = bodyOf(g);
    expect(b.topAltitudeM - b.bottomAltitudeM).toBeCloseTo(1.2, 9);
    // The exact defect, named: passing the height where the altitude belongs
    // would have produced a solid from 1.2 m to 156.4 m.
    expect(b.topAltitudeM - b.bottomAltitudeM,
      'the object is drawn as a spike from the ellipsoid to the roof')
      .toBeLessThan(10);
  });

  it('keeps its own footprint, and does not become a square', () => {
    const b = bodyOf(g);
    expect(b.widthM).toBeCloseTo(0.9, 9);
    expect(b.depthM).toBeCloseTo(0.6, 9);
  });

  it('a zero base still works, but is not what proves anything', () => {
    // Kept because the browser gate runs at base 0 — it must not throw there.
    // It is NOT evidence: at base 0 the correct and the broken datum agree.
    const z = buildObstructionGeometry({ type: 'chimney', widthM: 1, depthM: 1, heightM: 2, baseAltitudeM: 0 });
    expect(bodyOf(z).topAltitudeM).toBeCloseTo(2, 9);
  });
});

describe('every other object type gets a body it can be seen as', () => {
  for (const t of ['vent', 'vent_pipe', 'plumbing_stack', 'skylight', 'roof_hatch', 'hvac', 'other']) {
    it(`${t} is a prism at its own size`, () => {
      const g = buildObstructionGeometry({
        type: t, space: 'roof', widthM: 0.4, depthM: 0.3, heightM: 0.25, baseAltitudeM: 156.4,
      });
      expect(isTreeLike({ type: t })).toBe(false);
      const b = bodyOf(g);
      expect(b).toBeTruthy();
      expect(b.topAltitudeM - b.bottomAltitudeM).toBeCloseTo(0.25, 9);
      expect(b.widthM).toBeCloseTo(0.4, 9);
    });
  }
});

describe('🚨 one canopy radius, shared', () => {
  it('the renderer and the shade model cannot disagree', () => {
    // Two places computing "the canopy radius" is how a drawn tree and a
    // shading tree come to be different trees.
    const w = 6.0, d = 6.0;
    const g = buildObstructionGeometry({ type: 'tree', widthM: w, depthM: d, heightM: 8, baseAltitudeM: GROUND });
    expect(canopyRadiusFor(w, d)).toBeCloseTo(canopyOf(g).radiusXM, 9);
    expect(canopyRadiusFor(w, d)).toBeCloseTo(g.maxWidthM / 2, 9);
  });

  it('a non-square canopy takes the wider dimension, consistently', () => {
    const g = buildObstructionGeometry({ type: 'tree', widthM: 4, depthM: 9, heightM: 10, baseAltitudeM: GROUND });
    expect(canopyOf(g).radiusXM * 2).toBeCloseTo(9, 9);
    expect(canopyRadiusFor(4, 9)).toBeCloseTo(4.5, 9);
  });
});

describe('🚨 the renderer actually uses this, and passes an ALTITUDE', () => {
  const ENGINE = readFileSync(
    join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8',
  );

  it('drawObstructionEntity builds its parts from the authority', () => {
    const at = ENGINE.indexOf('function drawObstructionEntity');
    expect(at, 'the renderer is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 10));
    expect(body, 'the renderer invents its own shape again')
      .toContain('buildObstructionGeometry({');
    expect(body, 'the object no longer draws a part list').toMatch(/geo\.parts\.forEach/);
  });

  it('🚨 extrudedHeight is the part TOP ALTITUDE, never the object height', () => {
    const at = ENGINE.indexOf('function drawObstructionEntity');
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 10));
    // 🚨 ANCHORED TO THE END OF THE EXPRESSION, AND THAT IS NOT PEDANTRY.
    // The first version of this assertion was `/extrudedHeight: part\.topAltitudeM/`
    // and a mutation to `part.topAltitudeM - part.bottomAltitudeM` — which is
    // exactly the original bug, a height where an altitude belongs — SURVIVED
    // it, because a substring match cannot tell a value from the first term of
    // a subtraction. A guard that passes on the defect it names is worse than
    // no guard.
    expect(body, 'extrudedHeight is not the top altitude — every object at a ' +
      'property with a real elevation becomes a spike from the ellipsoid')
      .toMatch(/extrudedHeight: part\.topAltitudeM,\s*$/m);
    // And no arithmetic may creep back in on that line.
    expect(/extrudedHeight: part\.topAltitudeM\s*[-+*/]/.test(body),
      'extrudedHeight is being computed from the altitude instead of being it')
      .toBe(false);
    // The exact old expression, named so it cannot come back.
    expect(body.includes('extrudedHeight: prismHeightM'),
      'the renderer passes the object height where an altitude belongs again')
      .toBe(false);
  });

  it('a tree is drawn as a trunk and a canopy, not a box', () => {
    const at = ENGINE.indexOf('function drawObstructionEntity');
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 10));
    expect(body, 'no cylinder — the tree has no trunk').toMatch(/cylinder:\s*\{/);
    expect(body, 'no ellipsoid — the tree has no canopy').toMatch(/ellipsoid:\s*\{/);
    // The old giveaway was one polygon whose only type-awareness was a colour
    // ternary. Asserted on the CODE, not on a comment phrase — the note that
    // explains this fix quotes the old comment verbatim, so matching prose here
    // would fail against the fix itself.
    expect(/isTree \? '#4a8a3a' : '#f5f5f5'/.test(body),
      'the renderer distinguishes a tree from a chimney by colour alone again')
      .toBe(false);
  });

  it('🚨 every part carries the object name, so any part selects the object', () => {
    const at = ENGINE.indexOf('function drawObstructionEntity');
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 10));
    const named = [...body.matchAll(/name: partName/g)].length;
    expect(named, 'not every drawn part is named for the object — clicking a ' +
      'tree canopy would select nothing').toBeGreaterThanOrEqual(3);
  });

  it('🚨 editing a canopy moves every field that describes it, together', () => {
    // A tree's canopy is carried by THREE fields — widthM, depthM and
    // canopyRadiusM — because the renderer takes the first two and shade takes
    // the third. That is the duplication this whole audit exists to rule out,
    // so the one control that edits it must write all three in one patch or a
    // drawn tree and a shading tree become different trees.
    const at = ENGINE.indexOf("'obstruction-canopy'");
    expect(at, 'the canopy control is gone').toBeGreaterThan(-1);
    const call = ENGINE.slice(at, at + 260);
    expect(call, 'the canopy edit no longer updates canopyRadiusM — shade will ' +
      'keep the old canopy').toMatch(/canopyRadiusM: v \/ 2/);
    expect(call, 'the canopy edit no longer updates widthM — the drawn tree will ' +
      'keep the old canopy').toMatch(/widthM: v/);
    expect(call, 'the canopy edit no longer updates depthM').toMatch(/depthM: v/);
  });

  it('the placement path stamps the canopy radius from the shared helper', () => {
    expect(ENGINE, 'the canopy radius is computed inline again, so the drawn ' +
      'tree and the shading tree can diverge')
      .toMatch(/canopyRadiusM: preset\.space === 'site' \? canopyRadiusFor\(widthM, depthM\)/);
  });
});

describe('a malformed record cannot produce a malformed object', () => {
  it('a missing height does not make a zero-height or NaN object', () => {
    const g = buildObstructionGeometry({
      type: 'chimney', widthM: 1, depthM: 1, heightM: NaN as any, baseAltitudeM: 156.4,
    });
    const b = bodyOf(g);
    expect(Number.isFinite(b.topAltitudeM)).toBe(true);
    expect(b.topAltitudeM).toBeGreaterThan(b.bottomAltitudeM);
  });

  it('a missing base is not silently the ellipsoid for a tree that has one', () => {
    // Nothing here can invent a ground. It falls back to 0 and says so by
    // construction; the CALLER is responsible for passing a real datum, and
    // resolvePlacementPoint is where that is decided.
    const g = buildObstructionGeometry({ type: 'tree', widthM: 6, depthM: 6, heightM: 8, baseAltitudeM: NaN as any });
    expect(g.topAltitudeM).toBeCloseTo(8, 9);
    expect(g.totalHeightM).toBeCloseTo(8, 9);
  });
});
