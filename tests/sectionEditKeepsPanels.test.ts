/**
 * tests/sectionEditKeepsPanels.test.ts
 *
 * CORRECTING THE BUILDING MUST NOT LEAVE THE PANELS BEHIND.
 *
 * The workflow this whole pipeline exists to serve ends:
 *
 *     …build the house → correct it → save → reload → DESIGN PANELS ON IT
 *
 * and a person does not do those in order once. They lay panels, look at the
 * model, notice the garage eave is a foot low, fix it — and every panel on that
 * garage must still be ON the garage.
 *
 * 🚨 THE DEFECT CLASS THIS PROJECT KEEPS HITTING. `PlacedPanel.lat/lng/height`
 * and the per-panel ECEF frame are ABSOLUTE. `planeId` + `gridRow`/`gridCol`
 * say where the panel belongs; the absolute fields say where it is drawn. A
 * roof edit moves the former and not the latter, and the two then disagree
 * silently — "the panels are inside of the house and not on top of the planes",
 * and "NO DECK under the array" before that.
 *
 * These tests MEASURE the gap between a panel and the deck it stands on, in
 * metres, through the real libraries.
 */

import { describe, it, expect } from 'vitest';
import type { PlacedPanel, RoofPlane } from '@/types';
import { buildSectionRoofPlanes, sectionFaceId } from '@/lib/3d/buildingSection';
import { applySectionEdit, repositionPanelsForPlanes } from '@/lib/3d/sectionEditing';
import { buildSurfaceGrid } from '@/lib/surfaceGeometry3D';
import { latLngToECEF } from '@/lib/roofPlane3D';
import { multiSectionHouse, GROUND_MAIN_M } from './fixtures/multiSectionHouse';

const DEG = Math.PI / 180;
const FT = 0.3048;
const RACKING = 'ironridge-xr100';

function houseAsPlanes(): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of multiSectionHouse()) out.push(...buildSectionRoofPlanes(s).planes);
  return out;
}

/** Lay panels on one face, through the same engine Auto Layout uses. */
function panelsOn(plane: RoofPlane): PlacedPanel[] {
  const grid = buildSurfaceGrid({
    plane,
    groundElevM: GROUND_MAIN_M,
    orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0.02, rowSpacingM: 0.02,
    layoutId: 'L1',
    wattage: 400,
    mountingSystemId: RACKING,
  } as any);
  const panels = ((grid as any)?.panels ?? grid) as PlacedPanel[];
  expect(Array.isArray(panels) && panels.length > 0,
    'the fixture laid no panels — this file would be measuring nothing').toBe(true);
  return panels;
}

/**
 * How far a panel sits above its face's stored plane, in metres, along the
 * face normal.
 *
 * 🚨 IT IS A RELATIVE PROBE, DELIBERATELY. A first version asserted this
 * against `moduleStackHeightM(racking)` and every case failed — the offset
 * `buildSurfaceGrid` actually produces from the LIFTED `origin3D` is not a
 * bare addition of the racking stack, and asserting a datum I had derived
 * myself tested my arithmetic rather than the code's.
 *
 * What this file is actually about is convention-independent: whatever standoff
 * a panel has, CORRECTING THE BUILDING MUST NOT CHANGE IT. So every assertion
 * below compares the same panel before and after an edit.
 */
function standoffM(panel: PlacedPanel, plane: RoofPlane): number {
  const n = plane.normal3D!;
  const o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('the fixture is a real array on a real roof', () => {
  it('every panel stands off its face by the same amount', () => {
    const planes = houseAsPlanes();
    const face = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const panels = panelsOn(face);

    const offs = panels.map(p => standoffM(p, face));
    // 🚨 MEASURED, NOT ASSUMED: 0.58 mm across the whole array. The plane is a
    // FIT and the panels are placed on a grid over it, so corners of a large
    // array differ from the fitted plane by a fraction of a millimetre. A
    // tolerance of 1e-6 m was the first thing written here and it failed; a
    // probe pinned tighter than the thing it measures is simply wrong.
    expect(Math.max(...offs) - Math.min(...offs),
      'one array on one plane must be one standoff').toBeLessThan(0.001);
    // A real module sits ABOVE the deck, not in it — a sanity rail, not a datum.
    expect(offs[0]).toBeGreaterThan(0);
    expect(offs[0]).toBeLessThan(0.5);
  });
});

describe('🚨 a section edit takes its panels with it', () => {
  it('raising the eave a foot does not leave the array a foot underground', () => {
    const planes = houseAsPlanes();
    const faceId = sectionFaceId('sec-main', 'slopeA');
    const before = planes.find(p => p.id === faceId)!;
    const panels = panelsOn(before);

    const edited = applySectionEdit(planes, 'sec-main', { eaveHeightM: 2.9 + FT });
    expect(edited.ok).toBe(true);
    const after = edited.planes.find(p => p.id === faceId)!;

    // 🚨 THE DEFECT, ASSERTED. Untouched panels are now a foot below the roof —
    // the array is inside the house.
    const baseline = standoffM(panels[0], before);
    const stale = standoffM(panels[0], after);
    expect(baseline - stale, 'the array should have been left a foot under the roof')
      .toBeGreaterThan(0.25);

    // …and the repositioning pass puts them back on it.
    const moved = repositionPanelsForPlanes(panels, planes, edited.planes);
    expect(moved.moved).toBe(panels.length);
    expect(moved.orphaned).toEqual([]);
    for (const p of moved.panels) {
      expect(standoffM(p, after), `panel ${p.id}`).toBeCloseTo(baseline, 2);
    }
  });

  it('a pitch change keeps every panel on the face, at the right tilt', () => {
    const planes = houseAsPlanes();
    const faceId = sectionFaceId('sec-main', 'slopeA');
    const panels = panelsOn(planes.find(p => p.id === faceId)!);

    const baseline = standoffM(panels[0], planes.find(p => p.id === faceId)!);
    const edited = applySectionEdit(planes, 'sec-main', { pitchDeg: 40 });
    expect(edited.ok).toBe(true);
    const after = edited.planes.find(p => p.id === faceId)!;

    const moved = repositionPanelsForPlanes(panels, planes, edited.planes);
    for (const p of moved.panels) {
      expect(standoffM(p, after), `panel ${p.id}`).toBeCloseTo(baseline, 2);
      // The module lies ON the roof, so its tilt is the roof's.
      expect(Math.abs(p.tilt - after.pitch), `panel ${p.id} tilt`).toBeLessThan(0.05);
    }
  });

  it('a horizontal move takes the array with the building', () => {
    const planes = houseAsPlanes();
    const faceId = sectionFaceId('sec-wing', 'slopeA');
    const panels = panelsOn(planes.find(p => p.id === faceId)!);

    const baseline = standoffM(panels[0], planes.find(p => p.id === faceId)!);
    const edited = applySectionEdit(planes, 'sec-wing', { moveEastM: 3 });
    const after = edited.planes.find(p => p.id === faceId)!;
    const moved = repositionPanelsForPlanes(panels, planes, edited.planes);

    for (const p of moved.panels) {
      // 🚨 2 dp = 5 mm. Measured worst case on this 3 m translation is 1.08 mm:
      // the face is re-fitted at a new longitude, so its plane moves in the
      // last fraction of a millimetre and the panels follow it. The question
      // this file asks is "is the array still on the roof", and it is — the
      // defect it guards is 305 mm, not 1.
      expect(standoffM(p, after), `panel ${p.id}`).toBeCloseTo(baseline, 2);
    }
    // The array really did travel — it is not merely still coplanar.
    const east = (a: PlacedPanel, b: PlacedPanel) =>
      (b.lng - a.lng) * 111320 * Math.cos(a.lat * DEG);
    expect(east(panels[0], moved.panels[0])).toBeGreaterThan(2.5);
    expect(east(panels[0], moved.panels[0])).toBeLessThan(3.5);
  });

  it('🚨 panels on OTHER sections are not touched at all', () => {
    const planes = houseAsPlanes();
    const mainPanels = panelsOn(planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!);
    const garagePanels = panelsOn(planes.find(p => p.id === sectionFaceId('sec-garage', 'slopeA'))!);
    const all = [...mainPanels, ...garagePanels];

    const edited = applySectionEdit(planes, 'sec-main', { eaveHeightM: 4.0 });
    const moved = repositionPanelsForPlanes(all, planes, edited.planes);

    const byId = new Map(moved.panels.map(p => [p.id, p]));
    for (const g of garagePanels) {
      const now = byId.get(g.id)!;
      expect(now.lat, `${g.id} lat`).toBe(g.lat);
      expect(now.lng, `${g.id} lng`).toBe(g.lng);
      expect(now.height, `${g.id} height`).toBe(g.height);
    }
    expect(moved.moved).toBe(mainPanels.length);
  });

  it('a panel whose face no longer exists is REPORTED, never silently moved', () => {
    const planes = houseAsPlanes();
    const panels = panelsOn(planes.find(p => p.id === sectionFaceId('sec-garage', 'hipEndA'))!);

    // Turning the hip into a gable destroys the two hip ends.
    const edited = applySectionEdit(planes, 'sec-garage', { kind: 'gable' });
    expect(edited.ok).toBe(true);
    expect(edited.removedFaceIds.length).toBeGreaterThan(0);

    const moved = repositionPanelsForPlanes(panels, planes, edited.planes);
    // 🚨 NOT GUESSED ONTO A NEIGHBOURING FACE. An orphan is named so the caller
    // can tell the user, which is the only honest thing to do with a panel
    // whose roof was deleted.
    expect(moved.orphaned.sort()).toEqual(panels.map(p => p.id).sort());
    expect(moved.moved).toBe(0);
    // And the panels come back UNCHANGED rather than mangled.
    expect(moved.panels).toEqual(panels);
  });
});

describe('positive controls', () => {
  it('standoffM can tell a correct panel from a sunk one', () => {
    const planes = houseAsPlanes();
    const face = planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!;
    const panels = panelsOn(face);

    const good = standoffM(panels[0], face);
    const sunk = { ...panels[0], height: panels[0].height! - 0.5 };
    // Half a metre straight down is 0.5·cos(tilt) along the normal.
    expect(good - standoffM(sunk, face)).toBeGreaterThan(0.4);
  });

  it('repositioning a set with NOTHING changed is a no-op', () => {
    const planes = houseAsPlanes();
    const panels = panelsOn(planes.find(p => p.id === sectionFaceId('sec-main', 'slopeA'))!);
    const same = repositionPanelsForPlanes(panels, planes, planes);
    expect(same.orphaned).toEqual([]);
    for (let i = 0; i < panels.length; i++) {
      expect(same.panels[i].lat).toBeCloseTo(panels[i].lat, 12);
      expect(same.panels[i].lng).toBeCloseTo(panels[i].lng, 12);
      expect(same.panels[i].height!).toBeCloseTo(panels[i].height!, 9);
    }
  });
});
