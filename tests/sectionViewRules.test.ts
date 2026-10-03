// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE 3D VIEW DOES ABOUT A BUILDING SECTION — by what each rule DECIDES.
//
// These four decisions were inline in SolarEngine3D and guarded only by
// regexes over its source. A review found two mutations every such guard let
// through:
//   (a) the prism predicate compared a FACE id to a SECTION id
//       (`planes.some(p => p.id === sid)`), so no prism was ever hidden;
//   (b) the "kind before" lookup read a field no face carries, so every eave
//       nudge turned the Building view on.
// So the rules are pure functions now, and these tests feed them real section
// faces built by the real domain (`buildSectionRoofPlanes`, `applySectionEdit`).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { buildSectionRoofPlanes } from '@/lib/3d/buildingSection';
import { applySectionEdit } from '@/lib/3d/sectionEditing';
import {
  blockPrismHidden, editChangedRoofKind, isLevelByDesign, sectionKindOf, selectionAfterRebuild,
} from '@/lib/3d/sectionViewRules';
import type { RoofPlane } from '@/types';

const LAT = 40.6936;
const LNG = -89.589;
const GROUND = 127;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/** A 12 × 9 m footprint, as the Block tool builds it. */
function footprint(cx = 0) {
  const dLng = 6 / mPerDegLng;
  const dLat = 4.5 / M_PER_DEG_LAT;
  const lng = LNG + cx / mPerDegLng;
  return [
    { lat: LAT - dLat, lng: lng - dLng }, { lat: LAT - dLat, lng: lng + dLng },
    { lat: LAT + dLat, lng: lng + dLng }, { lat: LAT + dLat, lng: lng - dLng },
  ];
}

/** Exactly what finalizeBlock builds: a flat deck at a 4 m eave. */
function block(id = 'sec-block-1', cx = 0): RoofPlane[] {
  const out = buildSectionRoofPlanes({
    id, kind: 'flat', pitchDeg: 0, eaveHeightM: 4, groundElevM: GROUND,
    footprint: footprint(cx), label: 'Flat section', source: 'user-traced',
    createdAtIso: '2026-10-03T00:00:00.000Z',
  });
  expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
  return out.planes;
}

function gable(id = 'sec-gable-1', cx = 30): RoofPlane[] {
  const out = buildSectionRoofPlanes({
    id, kind: 'gable', pitchDeg: 22, eaveHeightM: 4, groundElevM: GROUND,
    footprint: footprint(cx), ridgeAxis: 'auto', label: 'Gable section', source: 'user-traced',
    createdAtIso: '2026-10-03T00:00:00.000Z',
  });
  expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
  return out.planes;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('sectionKindOf — the authority’s lookup, not the first face’s record', () => {
  it('names the kind of a section whose faces carry its record', () => {
    expect(sectionKindOf(block(), 'sec-block-1')).toBe('flat');
    expect(sectionKindOf(gable(), 'sec-gable-1')).toBe('gable');
  });

  it('🚨 finds the record even when the FIRST face of the section carries none', () => {
    // The inline lookup took the first face matching the section and read its
    // `section`. Here that face has no record: it returned null, and the caller
    // read null → 'gable' as a kind change on an ordinary eave edit.
    const [a, b] = gable();
    const bare = { ...a, section: undefined } as RoofPlane;
    expect(sectionKindOf([bare, b], 'sec-gable-1')).toBe('gable');
  });

  it('finds a section by its face ids even when `sectionId` is not stamped', () => {
    const faces = gable().map(p => ({ ...p, sectionId: undefined }) as RoofPlane);
    expect(sectionKindOf(faces, 'sec-gable-1')).toBe('gable');
  });

  it('null when there is no such section, or no section was named', () => {
    expect(sectionKindOf(block(), 'sec-nope')).toBeNull();
    expect(sectionKindOf(block(), '')).toBeNull();
    expect(sectionKindOf(null, 'sec-block-1')).toBeNull();
  });
});

describe('editChangedRoofKind — only a real change of kind turns the walls on', () => {
  it('Block → Gable is a change', () => {
    const planes = block();
    const before = sectionKindOf(planes, 'sec-block-1');
    const out = applySectionEdit(planes, 'sec-block-1', { kind: 'gable', pitchDeg: 22 });
    expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
    expect(editChangedRoofKind(before, out)).toBe(true);
  });

  it('🚨 an eave edit is not — even when the first face has no record', () => {
    const [a, b] = gable();
    const planes = [{ ...a, section: undefined } as RoofPlane, b];
    const before = sectionKindOf(planes, 'sec-gable-1');
    const out = applySectionEdit(planes, 'sec-gable-1', { eaveHeightM: 5 });
    expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
    expect(out.section!.kind).toBe('gable');
    expect(editChangedRoofKind(before, out)).toBe(false);
  });

  it('a pitch edit is not', () => {
    const planes = gable();
    const out = applySectionEdit(planes, 'sec-gable-1', { pitchDeg: 30 });
    expect(out.ok).toBe(true);
    expect(editChangedRoofKind(sectionKindOf(planes, 'sec-gable-1'), out)).toBe(false);
  });

  it('a refusal changed nothing', () => {
    expect(editChangedRoofKind('flat', { ok: false, section: null })).toBe(false);
    // A refused edit can still echo a section; it is not adopted.
    expect(editChangedRoofKind('flat', { ok: false, section: { kind: 'gable' } as any })).toBe(false);
  });

  it('an unknown kind before is not read as a change', () => {
    expect(editChangedRoofKind(null, { ok: true, section: { kind: 'gable' } as any })).toBe(false);
  });
});

describe('blockPrismHidden — the box steps aside for the walls, and never haunts a deleted house', () => {
  const sid = 'sec-block-1';

  it('🚨 a section in the design hides its prism while Building is on (face ids are <sid>::deck)', () => {
    // Mutation (a): `planes.some(p => p.id === sid)` is never true for
    // `sec-block-1::deck`, so this is the assertion that catches it.
    expect(block().map(p => p.id)).toEqual([`${sid}::deck`]);
    expect(blockPrismHidden(block(), sid, true)).toBe(true);
  });

  it('…and shows it while Building is off — the box is then the only massing on screen', () => {
    expect(blockPrismHidden(block(), sid, false)).toBe(false);
  });

  it('…and still once the Block has become a gable (two faces, no deck)', () => {
    const out = applySectionEdit(block(), sid, { kind: 'gable', pitchDeg: 22 });
    expect(out.ok).toBe(true);
    expect(blockPrismHidden(out.planes, sid, true)).toBe(true);
    expect(blockPrismHidden(out.planes, sid, false)).toBe(false);
  });

  it('a Block whose roof face was REFUSED keeps its prism, whatever the view', () => {
    expect(blockPrismHidden(block(), undefined, true)).toBe(false);
    expect(blockPrismHidden(block(), null, false)).toBe(false);
    expect(blockPrismHidden([], undefined, true)).toBe(false);
  });

  it('🚨 a Block whose section was deleted (or its creation undone) stays hidden, Building on or off', () => {
    // The review's probe p05: delete the section, and the 4 m box came back
    // where the house had just been removed.
    const others = gable();
    expect(blockPrismHidden(others, sid, true)).toBe(true);
    expect(blockPrismHidden(others, sid, false)).toBe(true);
    expect(blockPrismHidden([], sid, false)).toBe(true);
  });

  it('only ITS section counts — another section in the design does not hide it', () => {
    const planes = [...block('sec-block-1'), ...block('sec-block-2', 40)];
    expect(blockPrismHidden(planes, 'sec-block-2', false)).toBe(false);
    expect(blockPrismHidden(planes.filter(p => !p.id.startsWith('sec-block-2')), 'sec-block-2', false)).toBe(true);
  });
});

describe('selectionAfterRebuild — the selection follows the section, not a face the edit removed', () => {
  it('🚨 Block → Gable with the deck selected moves the selection to a slope of the same section', () => {
    // The deck is the face a person clicks to reach the Roof row, and Gable
    // removes it. Left on the dead id, the selection was cleared a render later
    // and the orphaned-panel notice went with it.
    const out = applySectionEdit(block(), 'sec-block-1', { kind: 'gable', pitchDeg: 22 });
    expect(out.removedFaceIds).toEqual(['sec-block-1::deck']);
    const next = selectionAfterRebuild('sec-block-1::deck', out);
    expect(next).not.toBeNull();
    expect(next).toMatch(/^sec-block-1::slope[AB]$/);
    expect(out.planes.some(p => p.id === next)).toBe(true);
  });

  it('Gable → Flat with a slope selected moves it to the deck', () => {
    const out = applySectionEdit(gable(), 'sec-gable-1', { kind: 'flat', pitchDeg: 0 });
    expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
    expect(selectionAfterRebuild('sec-gable-1::slopeA', out)).toBe('sec-gable-1::deck');
  });

  it('a selection the edit did not remove is left exactly where it was', () => {
    const out = applySectionEdit(gable(), 'sec-gable-1', { eaveHeightM: 5 });
    expect(out.removedFaceIds).toEqual([]);
    expect(selectionAfterRebuild('sec-gable-1::slopeB', out)).toBe('sec-gable-1::slopeB');
    // A face of ANOTHER section is untouched by this edit.
    expect(selectionAfterRebuild('sec-other::deck', out)).toBe('sec-other::deck');
  });

  it('no selection stays no selection; a refusal moves nothing', () => {
    const out = applySectionEdit(block(), 'sec-block-1', { kind: 'gable', pitchDeg: 22 });
    expect(selectionAfterRebuild(null, out)).toBeNull();
    expect(selectionAfterRebuild('sec-block-1::deck',
      { ok: false, planes: [], removedFaceIds: ['sec-block-1::deck'] })).toBe('sec-block-1::deck');
  });

  it('when nothing of the section survives, the selection is cleared rather than pointed at a ghost', () => {
    expect(selectionAfterRebuild('sec-x::deck', { ok: true, planes: [], removedFaceIds: ['sec-x::deck'] })).toBeNull();
  });
});

describe('isLevelByDesign — the ⚠ FLAT warning is for a face nobody asked to be level', () => {
  it('🚨 a Block’s deck is level on purpose', () => {
    const [deck] = block();
    expect(isLevelByDesign(deck)).toBe(true);
  });

  it('a FLAT section is level whatever stray pitch its record carries — the domain builds it at 0°', () => {
    // buildingSection treats kind 'flat' as 0° regardless of `pitchDeg`, so a
    // persisted row carrying 5 still draws a level deck, on purpose.
    const [deck] = block();
    const stray = { ...deck, section: { ...deck.section!, pitchDeg: 5 } } as RoofPlane;
    expect(isLevelByDesign(stray)).toBe(true);
  });

  it('a 0° shed is level on purpose', () => {
    const out = buildSectionRoofPlanes({
      id: 'sec-shed-0', kind: 'shed', pitchDeg: 0, eaveHeightM: 3, groundElevM: GROUND,
      footprint: footprint(60), shedAzimuthDeg: 180, label: 'Shed', source: 'user-traced',
      createdAtIso: '2026-10-03T00:00:00.000Z',
    });
    expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
    expect(out.planes.every(p => isLevelByDesign(p))).toBe(true);
  });

  it('a gable slope is not', () => {
    expect(gable().some(p => isLevelByDesign(p))).toBe(false);
  });

  it('a traced face with no section is not — its record cannot vouch for it', () => {
    const [deck] = block();
    expect(isLevelByDesign({ ...deck, section: undefined, sectionId: undefined } as RoofPlane)).toBe(false);
    expect(isLevelByDesign(undefined)).toBe(false);
  });

  it('a face Stitch or Square Up reshaped is not — it no longer follows its record', () => {
    const [deck] = block();
    expect(isLevelByDesign({ ...deck, sectionFaceReshaped: true } as RoofPlane)).toBe(false);
  });
});
