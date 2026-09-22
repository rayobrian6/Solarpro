// ═══════════════════════════════════════════════════════════════════════════
// SECTION PERSISTENCE — create → save → reload → the same canonical design.
//
// "Every custom-design feature is incomplete until create/edit → save →
// reload/reopen → same canonical design." So this is part of the feature, not
// a follow-up to it.
//
// The section rides inside `layouts.roof_planes`, which already round-trips
// arbitrary plane fields. These tests exercise the actual round-trip: the real
// signature function that decides whether a save is scheduled, and the real
// bundle coercion that the archive and the address-change path run through.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import type { RoofPlane } from '@/types';
import {
  buildSectionRoofPlanes,
  faceIdsOfSection,
  replaceSectionFaces,
  sectionRecord,
  sectionsFromPlanes,
  type BuildingSection,
  type LatLng,
} from '@/lib/3d/buildingSection';
import { SIGNED_FIELDS, roofPlanesSignature } from '@/lib/roofPlanesSignature';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const C_LAT = 38.7;
const C_LNG = -89.9;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(C_LAT * DEG);

function rect(lengthM: number, widthM: number, bearingDeg: number, dE = 0, dN = 0): LatLng[] {
  const t = bearingDeg * DEG;
  const uE = Math.sin(t), uN = Math.cos(t);
  const vE = Math.cos(t), vN = -Math.sin(t);
  return [
    [+lengthM / 2 * uE + widthM / 2 * vE, +lengthM / 2 * uN + widthM / 2 * vN],
    [+lengthM / 2 * uE - widthM / 2 * vE, +lengthM / 2 * uN - widthM / 2 * vN],
    [-lengthM / 2 * uE - widthM / 2 * vE, -lengthM / 2 * uN - widthM / 2 * vN],
    [-lengthM / 2 * uE + widthM / 2 * vE, -lengthM / 2 * uN + widthM / 2 * vN],
  ].map(([e, n]) => ({
    lat: C_LAT + (n + dN) / M_PER_DEG_LAT,
    lng: C_LNG + (e + dE) / M_PER_DEG_LNG,
  }));
}

const house = (over: Partial<BuildingSection> = {}): BuildingSection => ({
  id: 'sec-house', kind: 'gable', footprint: rect(14, 9, 30),
  eaveHeightM: 3, pitchDeg: 30, groundElevM: 140,
  label: 'House', siteKey: 'site-1', source: 'user-traced',
  createdAtIso: '2026-09-21T00:00:00.000Z', ...over,
});

const garage = (over: Partial<BuildingSection> = {}): BuildingSection => ({
  id: 'sec-garage', kind: 'hip', footprint: rect(7, 6, 30, 16, 0),
  eaveHeightM: 2.6, pitchDeg: 26, groundElevM: 140,
  label: 'Garage', siteKey: 'site-1', source: 'user-traced', ...over,
});

/** The real JSONB round-trip: Postgres stores JSON, not object references. */
const throughDb = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ─────────────────────────────────────────────────────────────────────────────

describe('create → save → reload → the same design', () => {
  it('a two-section house survives the JSON round-trip intact', () => {
    const planes = [
      ...buildSectionRoofPlanes(house()).planes,
      ...buildSectionRoofPlanes(garage()).planes,
    ];
    expect(planes).toHaveLength(6); // gable 2 + hip 4

    const reloaded = sectionsFromPlanes(throughDb(planes));
    expect(reloaded.conflicted).toEqual([]);
    expect(reloaded.standaloneFaceIds).toEqual([]);
    expect(reloaded.sections.map(s => s.id).sort()).toEqual(['sec-garage', 'sec-house']);

    // Not merely present — IDENTICAL, field for field, including the label the
    // installer typed and the footprint they traced.
    const back = reloaded.sections.find(s => s.id === 'sec-house')!;
    expect(back).toEqual(sectionRecord(house()));
  });

  it('rebuilding from the reloaded record reproduces the same faces', () => {
    const first = buildSectionRoofPlanes(house()).planes;
    const reloaded = sectionsFromPlanes(throughDb(first)).sections[0];
    const second = buildSectionRoofPlanes(reloaded).planes;

    expect(second.map(p => p.id)).toEqual(first.map(p => p.id));
    for (let i = 0; i < first.length; i++) {
      expect(second[i].pitch).toBeCloseTo(first[i].pitch, 9);
      expect(second[i].azimuth).toBeCloseTo(first[i].azimuth, 9);
      expect(second[i].area).toBeCloseTo(first[i].area, 6);
    }
  });

  it('the site key travels with the section, so it moves with the property', () => {
    const planes = throughDb(buildSectionRoofPlanes(house({ siteKey: 'site-melvin' })).planes);
    for (const p of planes) expect(p.siteKey).toBe('site-melvin');
    expect(sectionsFromPlanes(planes).sections[0].siteKey).toBe('site-melvin');
  });
});

describe('🚨 the autosave actually fires for a section edit', () => {
  // An unsigned field never schedules a save, and the edit is gone on reload
  // with no error anywhere. Each case below changes something a person would
  // reasonably expect to persist.
  const sig = (s: BuildingSection) => roofPlanesSignature(buildSectionRoofPlanes(s).planes);

  it('the section record and its id are both signed', () => {
    expect(SIGNED_FIELDS as readonly string[]).toContain('section');
    expect(SIGNED_FIELDS as readonly string[]).toContain('sectionId');
  });

  it('changing the pitch schedules a save', () => {
    expect(sig(house({ pitchDeg: 30 }))).not.toBe(sig(house({ pitchDeg: 38 })));
  });

  it('changing the eave height schedules a save', () => {
    expect(sig(house({ eaveHeightM: 3 }))).not.toBe(sig(house({ eaveHeightM: 3.6 })));
  });

  it('moving the footprint schedules a save', () => {
    expect(sig(house({ footprint: rect(14, 9, 30) })))
      .not.toBe(sig(house({ footprint: rect(14, 9, 30, 5, 0) })));
  });

  it('🚨 RENAMING the section schedules a save, though no geometry moved', () => {
    // This is the case a geometry-only signature silently loses.
    expect(sig(house({ label: 'House' }))).not.toBe(sig(house({ label: 'Main house' })));
  });

  it('🚨 flipping the ridge axis on a SQUARE section schedules a save', () => {
    // On a square footprint 'long' and 'short' can produce ridges of the same
    // length, so a geometry-only signature may not notice the flip at all.
    const sq = rect(10, 10, 0);
    expect(sig(house({ footprint: sq, ridgeAxis: 'long' })))
      .not.toBe(sig(house({ footprint: sq, ridgeAxis: 'short' })));
  });

  it('…and re-saving an UNCHANGED section does not schedule a spurious save', () => {
    expect(sig(house())).toBe(sig(house()));
  });
});

describe('🚨 stored copies that disagree are refused, not reconciled', () => {
  it('a section whose faces disagree is withheld and named', () => {
    const planes = throughDb(buildSectionRoofPlanes(house()).planes);
    // Simulate the failure this encoding could have: one face's stored record
    // drifts — a partial write, a hand edit, a bad migration.
    planes[1].section!.eaveHeightM = 9.9;

    const out = sectionsFromPlanes(planes);
    expect(out.sections).toEqual([]);
    expect(out.conflicted).toHaveLength(1);
    expect(out.conflicted[0].sectionId).toBe('sec-house');
    expect(out.conflicted[0].faceIds.sort()).toEqual(planes.map(p => p.id).sort());
  });

  it('a conflict in ONE section does not withhold the others', () => {
    const planes = throughDb([
      ...buildSectionRoofPlanes(house()).planes,
      ...buildSectionRoofPlanes(garage()).planes,
    ]);
    planes[0].section!.pitchDeg = 55;

    const out = sectionsFromPlanes(planes);
    expect(out.conflicted.map(c => c.sectionId)).toEqual(['sec-house']);
    expect(out.sections.map(s => s.id)).toEqual(['sec-garage']);
  });

  it('the copies are deep, so editing one does not silently edit the rest', () => {
    // A shared array reference would make the disagreement check unfireable:
    // the copies would be the same object rather than equal objects.
    const planes = buildSectionRoofPlanes(house()).planes;
    planes[0].section!.footprint[0].lat += 0.001;
    expect(planes[1].section!.footprint[0].lat).not.toBe(planes[0].section!.footprint[0].lat);
    expect(sectionsFromPlanes(planes).conflicted).toHaveLength(1);
  });
});

describe('legacy and hand-traced designs are untouched', () => {
  const legacy = (id: string): RoofPlane => ({
    id, vertices: rect(8, 6, 0), pitch: 25, azimuth: 180, area: 50, usableArea: 45,
    source: 'manual', confirmed: true,
  });

  it('a project with no sections at all yields none, and no conflict', () => {
    const out = sectionsFromPlanes([legacy('a'), legacy('b')]);
    expect(out.sections).toEqual([]);
    expect(out.conflicted).toEqual([]);
    expect(out.standaloneFaceIds).toEqual(['a', 'b']);
  });

  it('hand-traced faces sit alongside sections without being adopted', () => {
    const mixed = throughDb([...buildSectionRoofPlanes(house()).planes, legacy('hand-1')]);
    const out = sectionsFromPlanes(mixed);
    expect(out.sections.map(s => s.id)).toEqual(['sec-house']);
    expect(out.standaloneFaceIds).toEqual(['hand-1']);
  });

  it('🚨 a section id with NO record is standalone, never a half-built section', () => {
    // Reconstituting it would produce an object with no footprint that every
    // consumer would then have to guard against.
    const orphan = { ...legacy('sec-x::slopeA'), sectionId: 'sec-x' } as RoofPlane;
    const out = sectionsFromPlanes([orphan]);
    expect(out.sections).toEqual([]);
    expect(out.conflicted).toEqual([]);
    expect(out.standaloneFaceIds).toEqual(['sec-x::slopeA']);
  });

  it('an empty or absent plane list is not an error', () => {
    for (const v of [null, undefined, []]) {
      const out = sectionsFromPlanes(v as RoofPlane[] | null | undefined);
      expect(out.sections).toEqual([]);
      expect(out.conflicted).toEqual([]);
    }
  });
});

describe('🚨 editing a section replaces ITS faces and nothing else', () => {
  // The "detect roof from aerial" path does `setRoofPlanes(planes)` — an
  // unconditional blind replace that destroys every hand-modelled face in one
  // click. A section edit must never be able to do that.
  const world = (): RoofPlane[] => throughDb([
    ...buildSectionRoofPlanes(house()).planes,
    ...buildSectionRoofPlanes(garage()).planes,
    { id: 'hand-1', vertices: rect(8, 6, 0), pitch: 25, azimuth: 180, area: 50, usableArea: 45 } as RoofPlane,
  ]);

  it('raising the house eave leaves the garage and the hand-traced face alone', () => {
    const before = world();
    const rebuilt = buildSectionRoofPlanes(house({ eaveHeightM: 4.2 })).planes;
    const after = replaceSectionFaces(before, 'sec-house', rebuilt);

    expect(after).toHaveLength(before.length);
    // The garage is byte-identical.
    const g = (l: RoofPlane[]) => l.filter(p => p.sectionId === 'sec-garage');
    expect(g(after)).toEqual(g(before));
    // The hand-traced face is still there, untouched.
    expect(after.find(p => p.id === 'hand-1')).toEqual(before.find(p => p.id === 'hand-1'));
    // And the house DID change.
    const h = (l: RoofPlane[]) => l.filter(p => p.sectionId === 'sec-house');
    expect(h(after)[0].section!.eaveHeightM).toBe(4.2);
    expect(h(before)[0].section!.eaveHeightM).toBe(3);
  });

  it('the face ids are unchanged by the edit, so the panels keep their plane', () => {
    const before = world();
    const after = replaceSectionFaces(before, 'sec-house',
      buildSectionRoofPlanes(house({ eaveHeightM: 4.2, pitchDeg: 41 })).planes);
    expect(after.map(p => p.id).sort()).toEqual(before.map(p => p.id).sort());
  });

  it('faceIdsOfSection finds exactly that section’s faces', () => {
    const w = world();
    expect(faceIdsOfSection(w, 'sec-garage').sort())
      .toEqual(['sec-garage::hipEndA', 'sec-garage::hipEndB',
                'sec-garage::slopeA', 'sec-garage::slopeB']);
    expect(faceIdsOfSection(w, 'sec-nope')).toEqual([]);
    expect(faceIdsOfSection(null, 'sec-house')).toEqual([]);
  });

  it('deleting a section removes only its faces', () => {
    const before = world();
    const after = replaceSectionFaces(before, 'sec-garage', []);
    expect(after).toHaveLength(before.length - 4);
    expect(after.some(p => p.sectionId === 'sec-garage')).toBe(false);
    expect(after.some(p => p.id === 'hand-1')).toBe(true);
    expect(after.filter(p => p.sectionId === 'sec-house')).toHaveLength(2);
  });
});
