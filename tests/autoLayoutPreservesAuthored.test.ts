/**
 * tests/autoLayoutPreservesAuthored.test.ts
 *
 * AUTO LAYOUT DELETED MY GARAGE AND MY SOLFENCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIVE FAILURE, AND THE TWO LINES THAT CAUSED IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I built a good custom garage and placed a good SolFence. I then pressed
 *    Auto Layout. Auto Layout deleted them."
 *
 * A trace found two independent destructions on that one click.
 *
 * ONE — `keepSubjectBuilding()` in DesignStudio ran the neighbour-roof crop and
 * then committed its answer to the design:
 *
 *     setRoofPlanes(kept);
 *     setPanels(prev => prev.filter(pan => kept.some(pl =>
 *       pointInLatLngRing(pan.lat, pan.lng, pl.vertices ?? []))));
 *
 * The crop keeps "only the seed's cluster", and clusters union only when two
 * outlines come within 1.2 m. A DETACHED garage is by definition further away
 * than that, so it is its own cluster, is not the seed's, and was deleted. The
 * line under it then kept only panels standing inside a surviving ROOF polygon —
 * and a SolFence panel stands on a fence line in the yard, inside no roof
 * polygon at all. That filter never looked at `systemType`.
 *
 * TWO — `handleAutoRoof` in the 3D engine ended with
 *
 *     onPanelsChange(newPanels);
 *
 * where `newPanels` is accumulated purely from roof planes. Not a merge: a
 * replacement of the whole array. It was the outlier — its sibling 3D paths
 * merge, and the 2D path already preserved MANUAL panels.
 *
 * Both were then persisted, because the autosave sends whole-design arrays and
 * `roof_planes = COALESCE($1, roof_planes)` writes a non-null array.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Site and building geometry OWNS surfaces. Auto Layout CONSUMES surfaces and
 * produces panels. A surface that receives no panels is still part of the
 * property — the sentence the old code had no way to say, because the only way
 * to express "not for panels" was "not in the design".
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  autoLayoutScope, panelsAutoRoofOwns, mergeAutoRoofPanels,
} from '@/lib/3d/autoLayoutScope';
import { filterToSubjectBuilding } from '@/lib/aerial/subjectBuildingCrop';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ═══════════════════════════════════════════════════════════════════════════
// THE OWNER'S FIXTURE: a house, a DETACHED garage, a SolFence
// ═══════════════════════════════════════════════════════════════════════════

/** A square footprint `sizeM` across, centred on (lat,lng). */
function squareAt(lat: number, lng: number, sizeM: number) {
  const dLat = sizeM / 2 / 111_320;
  const dLng = sizeM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    { lat: lat - dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng - dLng },
  ];
}

const HOUSE_LAT = 38.70615, HOUSE_LNG = -90.04625;
/** ~12 m north of the house — a normal detached garage, far outside the 1.2 m
 *  adjacency gap that decides whether two outlines are one building. */
const GARAGE_LAT = HOUSE_LAT + 12 / 111_320, GARAGE_LNG = HOUSE_LNG;

type Face = {
  id: string; vertices: Array<{ lat: number; lng: number }>; source?: string; createdFrom3D?: boolean;
  sectionId?: string;
};

const houseA: Face = { id: 'house::slopeA', vertices: squareAt(HOUSE_LAT, HOUSE_LNG, 12), source: 'manual', sectionId: 'sec-house' };
const houseB: Face = { id: 'house::slopeB', vertices: squareAt(HOUSE_LAT, HOUSE_LNG + 0.00005, 12), source: 'manual', sectionId: 'sec-house' };
const garage: Face = { id: 'garage::deck', vertices: squareAt(GARAGE_LAT, GARAGE_LNG, 7), source: 'manual', sectionId: 'sec-garage' };
/** A genuine neighbour, detected by a block-wide Google pass — ~45 m away. */
const neighbour: Face = { id: 'goog-7', vertices: squareAt(HOUSE_LAT + 45 / 111_320, HOUSE_LNG, 11), source: 'solar_api' };

const SITE: Face[] = [houseA, houseB, garage, neighbour];

const vertsOf = (f: Face) => f.vertices;
const isAuthored = (f: Face) => f.source === 'manual' || !!f.createdFrom3D;
const crop = (planes: Face[]) => {
  const r = filterToSubjectBuilding(planes, vertsOf, { lat: HOUSE_LAT, lng: HOUSE_LNG }, { maxDistM: 60 });
  return { kept: r.kept, cropped: r.cropped };
};

describe('🚨 THE GARAGE: Auto Layout chooses surfaces and owns no building', () => {
  it('the detached garage is in scope for panels', () => {
    const r = autoLayoutScope({ planes: SITE, vertsOf, isAuthored, crop });
    expect(r.scope.map(f => f.id)).toContain('garage::deck');
  });

  it('…and so is the house it is detached from', () => {
    const r = autoLayoutScope({ planes: SITE, vertsOf, isAuthored, crop });
    expect(r.scope.map(f => f.id)).toEqual(
      expect.arrayContaining(['house::slopeA', 'house::slopeB', 'garage::deck']),
    );
  });

  it('the genuine detected neighbour is still excluded — the original defect stays fixed', () => {
    // The crop exists for a real failure: a block-wide Google detect papering
    // 997 panels across ten houses. Fixing the garage must not undo that.
    const r = autoLayoutScope({ planes: SITE, vertsOf, isAuthored, crop });
    expect(r.scope.map(f => f.id)).not.toContain('goog-7');
    expect(r.outOfScope.map(f => f.id)).toEqual(['goog-7']);
  });

  it('🚨 NO AUTHORED FACE IS EVER EXCLUDED, however far away it is', () => {
    const far: Face = { id: 'barn', vertices: squareAt(HOUSE_LAT + 200 / 111_320, HOUSE_LNG, 9), source: 'manual' };
    const r = autoLayoutScope({ planes: [...SITE, far], vertsOf, isAuthored, crop });
    expect(r.scope.map(f => f.id)).toContain('barn');
    expect(r.authoredExcluded).toBe(0);
  });

  it('🚨 MUTATION PROOF: the OLD behaviour drops the garage and the test notices', () => {
    // Hand the crop everything, as `keepSubjectBuilding` used to. Distance is
    // its only evidence, and a garage IS far from the house, so it cannot tell
    // an outbuilding from a neighbour. This is the failure, reproduced.
    const old = crop(SITE);
    expect(old.kept.map(f => f.id)).not.toContain('garage::deck');
    // …and the fix keeps it, from the same inputs.
    expect(autoLayoutScope({ planes: SITE, vertsOf, isAuthored, crop }).scope.map(f => f.id))
      .toContain('garage::deck');
  });

  it('a single-face design is returned untouched — no crop, no surprise', () => {
    const r = autoLayoutScope({ planes: [houseA], vertsOf, isAuthored, crop });
    expect(r.scope).toEqual([houseA]);
    expect(r.outOfScope).toEqual([]);
  });

  it('a face with too few vertices is out of scope and NOT in the design-removal set', () => {
    const junk: Face = { id: 'junk', vertices: [{ lat: 1, lng: 1 }], source: 'manual' };
    const r = autoLayoutScope({ planes: [...SITE, junk], vertsOf, isAuthored, crop });
    expect(r.scope.map(f => f.id)).not.toContain('junk');
    // `outOfScope` is a REPORT, not a deletion list — nothing in this module
    // removes anything.
    expect(r.outOfScope.map(f => f.id)).toEqual(expect.arrayContaining(['junk']));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SOLFENCE
// ═══════════════════════════════════════════════════════════════════════════

type Panel = {
  id: string; lat: number; lng: number;
  systemType?: string; layoutSource?: string; planeId?: string;
  widthFeet?: number; heightFeet?: number;
};

const roofAuto: Panel = { id: 'r1', lat: HOUSE_LAT, lng: HOUSE_LNG, systemType: 'roof', layoutSource: 'AUTO', planeId: 'house::slopeA' };
const roofManual: Panel = { id: 'r2', lat: HOUSE_LAT + 0.0002, lng: HOUSE_LNG, systemType: 'roof', layoutSource: 'MANUAL', planeId: 'house::slopeA' };
const fence1: Panel = { id: 'f1', lat: HOUSE_LAT - 0.0003, lng: HOUSE_LNG, systemType: 'fence', layoutSource: 'AUTO' };
const fence2: Panel = { id: 'f2', lat: HOUSE_LAT - 0.00031, lng: HOUSE_LNG, systemType: 'fence', layoutSource: 'AUTO' };
const ground1: Panel = { id: 'g1', lat: HOUSE_LAT - 0.0005, lng: HOUSE_LNG, systemType: 'ground', layoutSource: 'AUTO' };

describe('🚨 THE SOLFENCE: an auto ROOF fill owns the auto ROOF panels', () => {
  const existing = [roofAuto, roofManual, fence1, fence2, ground1];

  it('fence panels survive an auto roof fill', () => {
    const { preserved } = panelsAutoRoofOwns(existing);
    expect(preserved.map(p => p.id)).toEqual(expect.arrayContaining(['f1', 'f2']));
  });

  it('ground panels survive too', () => {
    expect(panelsAutoRoofOwns(existing).preserved.map(p => p.id)).toContain('g1');
  });

  it('hand-placed roof modules survive — the protected invariant', () => {
    expect(panelsAutoRoofOwns(existing).preserved.map(p => p.id)).toContain('r2');
  });

  it('…and the auto roof panels ARE replaced, which is what the button is for', () => {
    expect(panelsAutoRoofOwns(existing).replaced.map(p => p.id)).toEqual(['r1']);
  });

  it('a panel with no systemType is read as roof, matching the rest of the app', () => {
    const { replaced } = panelsAutoRoofOwns([{ id: 'x', lat: 1, lng: 1, layoutSource: 'AUTO' }]);
    expect(replaced.map(p => p.id)).toEqual(['x']);
  });

  it('🚨 MUTATION PROOF: the OLD behaviour returns a roof-only array', () => {
    // `onPanelsChange(newPanels)` with newPanels accumulated from roof planes.
    // Every fence, ground and hand-placed module is simply not in it.
    const roofOnlyReplacement: Panel[] = [{ id: 'new1', lat: HOUSE_LAT, lng: HOUSE_LNG, systemType: 'roof', layoutSource: 'AUTO' }];
    expect(roofOnlyReplacement.some(p => p.systemType === 'fence')).toBe(false);
    // The merge keeps them.
    const { preserved } = panelsAutoRoofOwns(existing);
    const merged = mergeAutoRoofPanels(preserved, roofOnlyReplacement);
    expect(merged.panels.filter(p => p.systemType === 'fence')).toHaveLength(2);
    expect(merged.panels.filter(p => p.systemType === 'ground')).toHaveLength(1);
    expect(merged.panels.map(p => p.id)).toContain('new1');
  });
});

describe('the merge does not stack two modules in one place', () => {
  const manual: Panel = {
    id: 'm', lat: HOUSE_LAT, lng: HOUSE_LNG, systemType: 'roof', layoutSource: 'MANUAL',
    widthFeet: 3.72, heightFeet: 5.65,
  };

  it('a generated panel landing on a hand-placed one yields', () => {
    const onTop: Panel = { ...manual, id: 'gen', layoutSource: 'AUTO' };
    const r = mergeAutoRoofPanels([manual], [onTop]);
    expect(r.suppressed).toBe(1);
    expect(r.panels.map(p => p.id)).toEqual(['m']);
  });

  it('one two metres away does not', () => {
    const clear: Panel = { ...manual, id: 'gen', layoutSource: 'AUTO', lat: HOUSE_LAT + 2 / 111_320 };
    const r = mergeAutoRoofPanels([manual], [clear]);
    expect(r.suppressed).toBe(0);
    expect(r.panels.map(p => p.id).sort()).toEqual(['gen', 'm']);
  });

  it('with nothing preserved the generated set is returned unchanged', () => {
    const gen = [roofAuto];
    expect(mergeAutoRoofPanels([], gen).panels).toEqual(gen);
    expect(mergeAutoRoofPanels(null, gen).panels).toEqual(gen);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE BOUNDARY, AS SOURCE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

const STUDIO = strip(read('components/design/DesignStudio.tsx'));
const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));

describe('🚨 Auto Layout writes no geometry at all', () => {
  it('the subject-building guard no longer commits its answer to the design', () => {
    const at = STUDIO.indexOf('const keepSubjectBuilding');
    expect(at).toBeGreaterThan(-1);
    const body = STUDIO.slice(at, STUDIO.indexOf('const autoLayoutAll', at));
    expect(body, 'it still calls setRoofPlanes').not.toMatch(/setRoofPlanes\(/);
    expect(body, 'it still deletes panels').not.toMatch(/setPanels\(/);
  });

  it('the panel filter that deleted the SolFence is gone', () => {
    expect(STUDIO).not.toMatch(/prev\.filter\(pan => kept\.some\(pl => pointInLatLngRing/);
  });

  it('both scope call sites exempt authored faces', () => {
    for (const [name, src] of [['DesignStudio', STUDIO], ['SolarEngine3D', ENGINE]] as const) {
      const at = src.indexOf('autoLayoutScope({');
      expect(at, `${name} does not use autoLayoutScope`).toBeGreaterThan(-1);
      const call = src.slice(at, at + 700);
      expect(call, `${name} does not pass isAuthored`).toMatch(/isAuthored: \(p\) => isHandModelledFace\(p\)/);
    }
  });

  it('the 3D fill merges instead of replacing the whole array', () => {
    expect(ENGINE).toMatch(/const merged = mergeAutoRoofPanels\(preservedPanels, newPanels\)/);
    expect(ENGINE).toMatch(/onPanelsChange\(merged\.panels\)/);
    // 🚨 THE OLD LINE, ASSERTED AGAINST — inside handleAutoRoof only. Three
    // other functions legitimately call `onPanelsChange(newPanels)` with an
    // array they built from the whole existing set; this one built its from
    // roof planes alone, which is what made it a replacement.
    const at = ENGINE.indexOf('const ownership = panelsAutoRoofOwns');
    expect(at).toBeGreaterThan(-1);
    const fill = ENGINE.slice(at, ENGINE.indexOf('renderLayoutBBox', at));
    expect(fill).not.toMatch(/onPanelsChange\(newPanels\)/);
    expect(fill).not.toMatch(/panelsRef\.current = newPanels/);
  });

  it('the fill tears down only the entities it owns', () => {
    // It used to clear EVERY panel entity in the scene, so the SolFence
    // disappeared visually before any state was written.
    const at = ENGINE.indexOf('const ownership = panelsAutoRoofOwns');
    expect(at).toBeGreaterThan(-1);
    const body = ENGINE.slice(at, at + 400);
    expect(body).toMatch(/for \(const p of ownership\.replaced\)/);
    expect(body).toMatch(/removePanelEntities\(viewer, p\.id\)/);
  });
});
