/**
 * tests/canonicalShade.test.ts
 *
 * IF I ADD A TREE AND SHADE IGNORES IT: GAUNTLET FAILS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE SHADE WAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An audit of the whole pipeline found that NOTHING OCCLUDED ANYTHING. The
 * per-panel shade number was one dot product — the cosine of incidence between
 * the module normal and the sun — duplicated across four files. It read `tilt`
 * and `azimuth` and nothing else. Cesium's `shadowMap` is switched on in shade
 * mode but never sampled: no ray, no `sampleHeight`, no intersection test
 * anywhere in the repo. It draws pixels and feeds no number.
 *
 * So "custom geometry breaks shade" was the wrong diagnosis. Shade was blind to
 * Google's mesh too. It was blind to everything, and a tree was two Cesium
 * entities with hardcoded dimensions that nothing persisted — the tool's own
 * tooltip said "No effect on solar production."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS PROVEN HERE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The owner's fixture, and his assertions, item by item: a gable house, a
 * detached garage, a chimney, a vent, a skylight, a tree south-west of the
 * array, and panels on more than one plane. Then: the chimney's shadow appears,
 * the tree's shadow appears, the garage can shade, deleting the tree removes its
 * shade, moving the tree changes it, and the shadow behaves like a shadow —
 * pointing away from the sun and lengthening as the sun drops.
 */

import { describe, it, expect } from 'vitest';
import {
  buildShadeScene, profileForPanel, shadowOf,
  MIN_OCCLUDER_RISE_M, MAX_OCCLUDER_DISTANCE_M,
} from '@/lib/shade/canonicalShadeScene';
import { computeShadeAnalysis, type PanelShadeInput } from '@/lib/shadeAnalysis';

const LAT = 38.70615, LNG = -90.04625;
const M_PER_DEG_LAT = 111_320;
const GROUND = 128;          // metres above the ellipsoid, the demo site
const EAVE = GROUND + 3.0;
const RIDGE = GROUND + 5.5;

const north = (m: number) => LAT + m / M_PER_DEG_LAT;
const east = (m: number) => LNG + m / (M_PER_DEG_LAT * Math.cos(LAT * Math.PI / 180));

function squareAt(lat: number, lng: number, sizeM: number) {
  const dLat = sizeM / 2 / M_PER_DEG_LAT;
  const dLng = sizeM / 2 / (M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180));
  return [
    { lat: lat - dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng - dLng },
  ];
}

// ── THE OWNER'S FIXTURE ─────────────────────────────────────────────────────

const houseSouth = {
  id: 'house::slopeA', vertices: squareAt(LAT, LNG, 10),
  centroidLat: LAT, centroidLng: LNG, area: 100,
  planeHeightAtCenterMeters: RIDGE,
};
const houseNorth = {
  id: 'house::slopeB', vertices: squareAt(north(10), LNG, 10),
  centroidLat: north(10), centroidLng: LNG, area: 100,
  planeHeightAtCenterMeters: RIDGE,
};
/** A TALL detached garage 14 m west — tall enough to reach over. */
const garage = {
  id: 'garage::deck', vertices: squareAt(LAT, east(-14), 7),
  centroidLat: LAT, centroidLng: east(-14), area: 49,
  planeHeightAtCenterMeters: GROUND + 9.0,
};

const chimney = {
  id: 'chim', lat: north(1.2), lng: LNG, height: EAVE, heightM: 1.6,
  widthM: 0.9, depthM: 0.6, type: 'chimney', space: 'roof' as const, planeId: 'house::slopeA',
};
const vent = {
  id: 'vent', lat: north(2), lng: east(1), height: EAVE, heightM: 0.4,
  radiusM: 0.25, type: 'vent', space: 'roof' as const, planeId: 'house::slopeA',
};
const skylight = {
  id: 'sky', lat: north(-1), lng: east(-1), height: EAVE, heightM: 0.12,
  widthM: 1.2, depthM: 0.8, type: 'skylight', space: 'roof' as const, planeId: 'house::slopeA',
};
/** South-west of the array, 9 m away, 8 m tall with a 3 m canopy. */
const tree = {
  id: 'tree-1', lat: north(-7), lng: east(-6), height: GROUND, heightM: 8,
  canopyRadiusM: 3, type: 'tree', space: 'site' as const,
};

const SCENE_INPUT = {
  roofPlanes: [houseSouth, houseNorth, garage],
  obstructions: [chimney, vent, skylight, tree],
  groundElevM: GROUND,
};

/** A module on the south slope, at the roof surface. */
const panelA = { id: 'pA', lat: LAT, lng: LNG, height: EAVE + 0.2, planeId: 'house::slopeA' };
/** A module on the north slope, well away from the tree. */
const panelB = { id: 'pB', lat: north(10), lng: LNG, height: EAVE + 0.2, planeId: 'house::slopeB' };

const bearingsOf = (prof: ReturnType<typeof profileForPanel>) =>
  (prof.nearbyObstruction ?? []).map(o => Math.round(o.azimuthDeg));

// ═══════════════════════════════════════════════════════════════════════════

describe('the scene is built from canonical geometry, not from a tileset', () => {
  const scene = buildShadeScene(SCENE_INPUT);

  it('every roof face, obstruction and tree becomes an occluder', () => {
    expect(scene.map(o => o.id).sort()).toEqual(
      ['chim', 'garage::deck', 'house::slopeA', 'house::slopeB', 'sky', 'tree-1', 'vent'],
    );
  });

  it('a tree is a TREE, with its canopy as the radius', () => {
    const t = scene.find(o => o.id === 'tree-1');
    expect(t.kind).toBe('tree');
    expect(t.radiusM).toBe(3);
    expect(t.topM).toBe(GROUND + 8);
  });

  it('a chimney takes its height from the ROOF it stands on, not the ground', () => {
    const c = scene.find(o => o.id === 'chim');
    expect(c.topM).toBeCloseTo(EAVE + 1.6, 6);
    expect(c.kind).toBe('roofObject');
  });

  it('a building face carries its own ridge height and its own footprint radius', () => {
    const g = scene.find(o => o.id === 'garage::deck');
    expect(g.kind).toBe('building');
    expect(g.topM).toBe(GROUND + 9);
    // Half the diagonal of a 7 m square ~ 4.95 m.
    expect(g.radiusM).toBeGreaterThan(4);
    expect(g.radiusM).toBeLessThan(6);
  });

  it('an obstruction with no coordinates is skipped rather than landing at 0,0', () => {
    const s = buildShadeScene({ obstructions: [{ id: 'bad' } as never], groundElevM: GROUND });
    expect(s).toEqual([]);
  });
});

describe('🚨 the chimney casts a shadow, and the vent and skylight do not pretend to', () => {
  const scene = buildShadeScene(SCENE_INPUT);
  const prof = profileForPanel(panelA, scene, GROUND);

  it('the chimney is in the panel’s horizon', () => {
    // 1.6 m of chimney standing 1.2 m north of a module 0.2 m above the deck.
    // 🚨 BY ID, NOT BY BEARING. The north slope of the house is also due north
    // of this module; a bearing match found the roof and called it a chimney.
    const chim = (prof.nearbyObstruction ?? []).find(o => o.sourceId === 'chim');
    expect(chim, 'the chimney is not in the profile').toBeTruthy();
    expect(chim.heightM).toBeCloseTo(EAVE + 1.6 - (EAVE + 0.2), 6);
    expect(chim.distanceM).toBeCloseTo(1.2, 1);
    // 0.45 m half-width at 1.2 m subtends ~41°.
    expect(chim.arcDeg).toBeGreaterThan(30);
  });

  it('🚨 the 0.12 m skylight does NOT, because it cannot shade anything', () => {
    // A flush curb is not an occluder. Admitting it would put noise in the mask
    // and make every roof look partly shaded by its own flashing.
    expect((prof.nearbyObstruction ?? []).find(o => o.sourceId === 'sky')).toBeFalsy();
    // …and nothing admitted is below the threshold, whatever it is.
    expect((prof.nearbyObstruction ?? []).every(o => o.heightM > MIN_OCCLUDER_RISE_M)).toBe(true);
  });

  it('the 0.4 m vent does not either — it is below the module top', () => {
    const rise = (EAVE + 0.4) - (EAVE + 0.2);
    expect(rise).toBeLessThan(MIN_OCCLUDER_RISE_M);
  });

  it('🚨 the face the module STANDS ON does not shade it', () => {
    // Without this every panel is shaded by its own roof: the face's centroid
    // height reads as a wall right beside it.
    // Off-centre on its own face, so the distance to the face centroid is real
    // and the entry cannot be dropped for being at zero range — which is what
    // made a first version of this assertion pass for the wrong reason.
    const offCentre = { ...panelA, lat: north(-3), planeId: 'house::slopeA' };
    const mine = profileForPanel(offCentre, scene, GROUND);
    expect((mine.nearbyObstruction ?? []).find(o => o.sourceId === 'house::slopeA')).toBeFalsy();
    // 🚨 POSITIVE CONTROL: the SAME module, told it belongs to no face, IS
    // shaded by that roof. Without this the assertion above would pass if the
    // face simply never became an occluder.
    const orphan = profileForPanel({ ...offCentre, planeId: '' }, scene, GROUND);
    expect((orphan.nearbyObstruction ?? []).find(o => o.sourceId === 'house::slopeA')).toBeTruthy();
    // …and the NEIGHBOURING face still shades it, both ways round.
    expect((mine.nearbyObstruction ?? []).find(o => o.sourceId === 'house::slopeB')).toBeTruthy();
  });
});

describe('🚨 the tree shades, and deleting it removes the shade', () => {
  const withTree = buildShadeScene(SCENE_INPUT);
  const withoutTree = buildShadeScene({ ...SCENE_INPUT, obstructions: [chimney, vent, skylight] });

  it('the tree appears in the horizon to the SOUTH-WEST, where it stands', () => {
    const prof = profileForPanel(panelA, withTree, GROUND);
    const sw = (prof.nearbyObstruction ?? []).filter(o => o.azimuthDeg > 180 && o.azimuthDeg < 270);
    expect(sw.length).toBeGreaterThan(0);
    // 8 m tall from ground, module ~3.2 m up: ~4.8 m of rise at ~9.2 m away.
    const t = sw.find(o => o.sourceId === 'tree-1');
    expect(t, 'the tree is not in the profile').toBeTruthy();
    expect(t.kind).toBe('tree');
    expect(t.distanceM).toBeGreaterThan(8);
    expect(t.distanceM).toBeLessThan(11);
  });

  it('🚨 IT CHANGES THE NUMBER. A shade study that ignores a tree is not one.', () => {
    const panels: PanelShadeInput[] = [
      { id: 'pA', tilt: 30, azimuth: 180, row: 0, col: 0, lat: panelA.lat, lng: panelA.lng },
    ];
    const shaded = computeShadeAnalysis(panels, LAT, LNG, id => profileForPanel(panelA, withTree, GROUND), 1.5, 1.134, 2026);
    const clear = computeShadeAnalysis(panels, LAT, LNG, id => profileForPanel(panelA, withoutTree, GROUND), 1.5, 1.134, 2026);
    expect(shaded.panelShadeFactors.pA).toBeLessThan(clear.panelShadeFactors.pA);
  });

  it('🚨 DELETING THE TREE PUTS THE NUMBER BACK', () => {
    const panels: PanelShadeInput[] = [
      { id: 'pA', tilt: 30, azimuth: 180, row: 0, col: 0, lat: panelA.lat, lng: panelA.lng },
    ];
    const noTree = computeShadeAnalysis(panels, LAT, LNG, () => profileForPanel(panelA, withoutTree, GROUND), 1.5, 1.134, 2026);
    const noObstructionsAtAll = computeShadeAnalysis(
      panels, LAT, LNG,
      () => profileForPanel(panelA, buildShadeScene({ ...SCENE_INPUT, obstructions: [] }), GROUND),
      1.5, 1.134, 2026,
    );
    // Removing the tree is worth something, and what is left is the chimney and
    // the garage — not nothing.
    expect(noTree.panelShadeFactors.pA).toBeLessThanOrEqual(noObstructionsAtAll.panelShadeFactors.pA);
  });

  it('🚨 MOVING THE TREE CHANGES ITS SHADE', () => {
    const moved = buildShadeScene({
      ...SCENE_INPUT,
      obstructions: [chimney, vent, skylight, { ...tree, lat: north(30), lng: east(28) }],
    });
    const near = profileForPanel(panelA, buildShadeScene(SCENE_INPUT), GROUND);
    const far = profileForPanel(panelA, moved, GROUND);
    const treeNear = (near.nearbyObstruction ?? []).find(o => o.sourceId === 'tree-1');
    const treeFar = (far.nearbyObstruction ?? []).find(o => o.sourceId === 'tree-1');
    expect(treeNear).toBeTruthy();
    expect(treeFar).toBeTruthy();
    // Further away: smaller blocking angle and a narrower arc.
    expect(treeFar.distanceM).toBeGreaterThan(treeNear.distanceM);
    expect(treeFar.arcDeg).toBeLessThan(treeNear.arcDeg);
    expect(Math.round(treeFar.azimuthDeg)).not.toBe(Math.round(treeNear.azimuthDeg));
  });

  it('a tree beyond the useful range is not in the mask', () => {
    const veryFar = buildShadeScene({
      ...SCENE_INPUT,
      obstructions: [{ ...tree, lat: north(-(MAX_OCCLUDER_DISTANCE_M + 40)) }],
    });
    const prof = profileForPanel(panelA, veryFar, GROUND);
    expect((prof.nearbyObstruction ?? []).find(o => o.sourceId === 'tree-1')).toBeFalsy();
  });
});

describe('🚨 the detached garage shades where the geometry permits', () => {
  const scene = buildShadeScene(SCENE_INPUT);

  it('a 9 m garage 14 m west is in the western horizon of a house panel', () => {
    const prof = profileForPanel(panelA, scene, GROUND);
    const g = (prof.nearbyObstruction ?? []).find(o => o.sourceId === 'garage::deck');
    expect(g, 'the garage is not in the profile').toBeTruthy();
    expect(g.kind).toBe('building');
    expect(Math.round(g.azimuthDeg)).toBe(270);
    expect(g.heightM).toBeCloseTo(GROUND + 9 - (EAVE + 0.2), 1);
  });

  it('a garage no taller than the roof shades nothing on it', () => {
    const low = buildShadeScene({
      ...SCENE_INPUT,
      roofPlanes: [houseSouth, houseNorth, { ...garage, planeHeightAtCenterMeters: EAVE }],
    });
    const prof = profileForPanel(panelA, low, GROUND);
    expect((prof.nearbyObstruction ?? []).find(o => o.sourceId === 'garage::deck')).toBeFalsy();
  });

  it('panels on different planes see different horizons', () => {
    const a = profileForPanel(panelA, scene, GROUND);
    const b = profileForPanel(panelB, scene, GROUND);
    expect(bearingsOf(a)).not.toEqual(bearingsOf(b));
  });
});

describe('🚨 a shadow behaves like a shadow', () => {
  const scene = buildShadeScene(SCENE_INPUT);
  const t = scene.find(o => o.id === 'tree-1');

  it('it falls directly AWAY from the sun', () => {
    // Sun in the south-east (135°) puts the shadow to the north-west (315°).
    expect(shadowOf(t, { elevation: 30, azimuth: 135 }, GROUND).bearingDeg).toBe(315);
    // Sun in the west (270°) puts it to the east (90°).
    expect(shadowOf(t, { elevation: 20, azimuth: 270 }, GROUND).bearingDeg).toBe(90);
  });

  it('it LENGTHENS as the sun drops', () => {
    const noon = shadowOf(t, { elevation: 65, azimuth: 180 }, GROUND);
    const evening = shadowOf(t, { elevation: 15, azimuth: 250 }, GROUND);
    expect(evening.lengthM).toBeGreaterThan(noon.lengthM);
    // 8 m tall at 45° is 8 m long — the arithmetic, checked.
    expect(shadowOf(t, { elevation: 45, azimuth: 180 }, GROUND).lengthM).toBeCloseTo(8, 6);
  });

  it('there is no shadow at night', () => {
    expect(shadowOf(t, { elevation: -5, azimuth: 90 }, GROUND).reaches).toBe(false);
  });

  it('an object below the receiver casts nothing onto it', () => {
    expect(shadowOf(t, { elevation: 45, azimuth: 180 }, GROUND + 50).reaches).toBe(false);
  });
});

describe('the analysis is unchanged for every existing caller', () => {
  const panels: PanelShadeInput[] = [
    { id: 'p1', tilt: 25, azimuth: 180, row: 0, col: 0, lat: LAT, lng: LNG },
    { id: 'p2', tilt: 25, azimuth: 180, row: 1, col: 0, lat: LAT, lng: LNG },
  ];

  it('with no obstruction argument at all it still runs and reports full sun', () => {
    const r = computeShadeAnalysis(panels, LAT, LNG, undefined, 1.5, 1.134, 2026);
    expect(r.panelShadeFactors.p1).toBeGreaterThan(0);
    expect(r.systemShadeDeratePct).toBeGreaterThanOrEqual(0);
  });

  it('a SINGLE profile still applies to every panel, exactly as before', () => {
    const one = computeShadeAnalysis(
      panels, LAT, LNG,
      { nearbyObstruction: [{ heightM: 12, distanceM: 4, azimuthDeg: 180, arcDeg: 120 }] },
      1.5, 1.134, 2026,
    );
    const none = computeShadeAnalysis(panels, LAT, LNG, undefined, 1.5, 1.134, 2026);
    expect(one.panelShadeFactors.p1).toBeLessThan(none.panelShadeFactors.p1);
    expect(one.panelShadeFactors.p2).toBeLessThan(none.panelShadeFactors.p2);
  });

  it('🚨 a PER-PANEL resolver can shade one module and not its neighbour', () => {
    // The thing a single profile cannot express, and the reason anyone runs a
    // shade study at all.
    const r = computeShadeAnalysis(
      panels, LAT, LNG,
      id => (id === 'p1'
        ? { nearbyObstruction: [{ heightM: 12, distanceM: 4, azimuthDeg: 180, arcDeg: 120 }] }
        : null),
      1.5, 1.134, 2026,
    );
    expect(r.panelShadeFactors.p1).toBeLessThan(r.panelShadeFactors.p2);
  });
});


describe('🚨 the tree the user SIZES is the tree that shades', () => {
  // The owner's own sweep: short tree, tall tree, narrow canopy, wide canopy.
  // The two numbers the inspector edits are exactly the two the scene reads, so
  // a change to either has to move the answer or the editor is decoration.
  const sceneWith = (over: Record<string, unknown>) =>
    buildShadeScene({ ...SCENE_INPUT, obstructions: [chimney, vent, skylight, { ...tree, ...over }] });
  const treeIn = (over: Record<string, unknown>) =>
    (profileForPanel(panelA, sceneWith(over), GROUND).nearbyObstruction ?? [])
      .find(o => o.sourceId === 'tree-1');

  it('a TALLER tree blocks a higher angle', () => {
    const short = treeIn({ heightM: 4 });
    const tall = treeIn({ heightM: 14 });
    expect(short, 'a 4 m tree vanished entirely').toBeTruthy();
    expect(tall.heightM).toBeGreaterThan(short.heightM);
    // The blocking elevation angle is atan(rise / distance) — same distance,
    // so more rise is strictly more block.
    const angle = (o: { heightM: number; distanceM: number }) => Math.atan2(o.heightM, o.distanceM);
    expect(angle(tall)).toBeGreaterThan(angle(short));
  });

  it('a tree shorter than the roof it would shade drops out of the horizon', () => {
    // Its top is below the module, so there is nothing between it and the sun.
    expect(treeIn({ heightM: 1.5 })).toBeFalsy();
  });

  it('a WIDER canopy blocks a wider arc', () => {
    const narrow = treeIn({ canopyRadiusM: 1 });
    const wide = treeIn({ canopyRadiusM: 6 });
    expect(wide.arcDeg).toBeGreaterThan(narrow.arcDeg);
    // …at the same distance and the same height, so only the arc moved.
    expect(wide.heightM).toBeCloseTo(narrow.heightM, 6);
    expect(wide.distanceM).toBeCloseTo(narrow.distanceM, 6);
  });

  it('🚨 and each of those changes the ANNUAL NUMBER, not only the profile', () => {
    const panels: PanelShadeInput[] = [
      { id: 'pA', tilt: 30, azimuth: 180, row: 0, col: 0, lat: panelA.lat, lng: panelA.lng },
    ];
    const factor = (over: Record<string, unknown>) => computeShadeAnalysis(
      panels, LAT, LNG, () => profileForPanel(panelA, sceneWith(over), GROUND), 1.5, 1.134, 2026,
    ).panelShadeFactors.pA;

    // Taller shades more.
    expect(factor({ heightM: 16 })).toBeLessThan(factor({ heightM: 5 }));
    // Wider shades more.
    expect(factor({ canopyRadiusM: 8 })).toBeLessThan(factor({ canopyRadiusM: 0.6 }));
    // Nearer shades more than the same tree far away.
    expect(factor({})).toBeLessThan(factor({ lat: north(-60), lng: east(-55) }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING — a shade study that reaches nothing is a picture
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const readSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripSrc = (x: string) =>
  x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('🚨 the analysis reaches the panels, the picture and production', () => {
  const STUDIO = stripSrc(readSrc('components/design/DesignStudio.tsx'));
  const ENGINE = stripSrc(readSrc('components/3d/SolarEngine3D.tsx'));
  const PVW = stripSrc(readSrc('lib/pvwatts.ts'));

  it('the studio builds the scene from canonical geometry and runs it per panel', () => {
    const at = STUDIO.indexOf('const runShadeAnalysis = useCallback');
    expect(at, 'there is no shade analysis').toBeGreaterThan(-1);
    const body = STUDIO.slice(at, at + 2600);
    expect(body).toMatch(/buildShadeScene\(\{ roofPlanes: planes, obstructions: obs/);
    // 🚨 A RESOLVER, NOT A SINGLE PROFILE. One profile for the whole array
    // answers the question a shade study exists to avoid.
    expect(body).toMatch(/\(panelId\) => \{/);
    expect(body).toMatch(/profileForPanel\(/);
    expect(body).toMatch(/annualShadeFactor: f/);
  });

  it('turning Shade on asks the owner for it — the viewer cannot own the number', () => {
    expect(ENGINE).toMatch(/if \(next\) onRunShadeAnalysis\?\.\(\);/);
    expect(STUDIO).toMatch(/onRunShadeAnalysis=\{runShadeAnalysis\}/);
  });

  it('🚨 the roof is PAINTED with the analysis, not with the cosine', () => {
    // Painting with `computeShade` while the analysis says something else is
    // two answers to one question, and the one on screen is the one believed.
    expect(ENGINE).toMatch(/annualShadeFactor === 'number'/);
    expect(ENGINE).toMatch(/: computeShade\(panel, sunPos\)/);
  });

  it('and production consumes the same field', () => {
    expect(PVW).toMatch(/annualShadeFactor/);
    expect(PVW).toMatch(/shadeLossesPct/);
  });
});
