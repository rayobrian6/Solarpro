/**
 * tests/geometryHistory.test.ts
 *
 * UNDO MUST RESTORE THE DATA, NOT THE PICTURE.
 *
 * The requirement, verbatim: "The history must restore canonical geometry, then
 * rebuild derived geometry. Do not snapshot only Cesium/render state."
 *
 * The failure mode a render snapshot produces is specific and nasty: the roof
 * LOOKS restored, the canonical array still holds the undone edit, the autosave
 * fires, and the design that reaches the permit is the one the user rejected.
 * So the tests below check the array, never a frame.
 */

import { describe, it, expect } from 'vitest';
import type { RoofPlane } from '@/types';
import {
  emptyHistory, pushSnapshot, undo, redo, canUndo, canRedo,
  undoLabel, redoLabel, clearHistory, MAX_HISTORY_DEPTH,
} from '@/lib/3d/geometryHistory';
import { buildSectionRoofPlanes, sectionFaceId } from '@/lib/3d/buildingSection';
import { applySectionEdit, measureFaceVertical } from '@/lib/3d/sectionEditing';
import { multiSectionHouse, GROUND_MAIN_M } from './fixtures/multiSectionHouse';

function houseAsPlanes(): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of multiSectionHouse()) out.push(...buildSectionRoofPlanes(s).planes);
  return out;
}

const eaveOf = (planes: RoofPlane[], faceId: string) =>
  measureFaceVertical(planes.find(p => p.id === faceId)!).wallHeightM!;

const MAIN_A = sectionFaceId('sec-main', 'slopeA');

describe('the history holds canonical geometry', () => {
  it('there is no renderer in the snapshot — only RoofPlane data', () => {
    const planes = houseAsPlanes();
    const h = pushSnapshot(emptyHistory(), 'Set eave height', planes);
    const snap = h.past[0].planes;

    expect(Array.isArray(snap)).toBe(true);
    expect(snap.length).toBe(8);
    for (const p of snap) {
      expect(typeof p.id).toBe('string');
      expect(Array.isArray(p.vertices)).toBe(true);
      // Nothing from Cesium can survive a JSON round-trip, and nothing should
      // be here to try: no entity ids, no viewer handles, no materials.
      expect((p as any).entity).toBeUndefined();
      expect((p as any).viewer).toBeUndefined();
    }
  });

  it('🚨 the snapshot is DEEP — mutating a live plane cannot rewrite the past', () => {
    const planes = houseAsPlanes();
    const h = pushSnapshot(emptyHistory(), 'Set eave height', planes);

    // Exactly what SolarEngine3D does in several places: edit a plane in place.
    (planes[0] as any).__eaveDirENU = { x: 9, y: 9 };
    planes[0].pitch = 99;
    planes[0].vertices[0].lat += 0.001;
    planes[0].section!.eaveHeightM = 99;

    const kept = h.past[0].planes[0];
    expect(kept.pitch).not.toBe(99);
    expect(kept.section!.eaveHeightM).toBe(2.9);
    expect((kept as any).__eaveDirENU).not.toEqual({ x: 9, y: 9 });
  });

  it('undo restores the geometry an edit replaced', () => {
    const before = houseAsPlanes();
    expect(eaveOf(before, MAIN_A)).toBeCloseTo(2.9, 5);

    const h1 = pushSnapshot(emptyHistory(), 'Set eave height', before);
    const after = applySectionEdit(before, 'sec-main', { eaveHeightM: 4.2 }).planes;
    expect(eaveOf(after, MAIN_A)).toBeCloseTo(4.2, 5);

    const step = undo(h1, after);
    expect(step.ok).toBe(true);
    expect(step.label).toBe('Set eave height');
    expect(eaveOf(step.planes, MAIN_A)).toBeCloseTo(2.9, 5);

    // …and the other sections came back untouched too.
    expect(step.planes.length).toBe(8);
    expect(eaveOf(step.planes, sectionFaceId('sec-garage', 'slopeA'))).toBeCloseTo(2.4, 5);
  });

  it('redo puts it back, and the pair round-trips exactly', () => {
    const before = houseAsPlanes();
    const h1 = pushSnapshot(emptyHistory(), 'Set roof pitch', before);
    const after = applySectionEdit(before, 'sec-main', { pitchDeg: 41 }).planes;

    const u = undo(h1, after);
    expect(canRedo(u.history)).toBe(true);
    expect(redoLabel(u.history)).toBe('Set roof pitch');

    const r = redo(u.history, u.planes);
    expect(r.ok).toBe(true);
    expect(r.planes.find(p => p.id === MAIN_A)!.section!.pitchDeg).toBe(41);
    // Byte-for-byte the same design, not merely a similar one.
    expect(JSON.parse(JSON.stringify(r.planes))).toEqual(JSON.parse(JSON.stringify(after)));
  });

  it('covers the whole required operation set, in sequence and in reverse', () => {
    // The stated minimum: create, delete, move, resize, height, pitch, azimuth.
    let planes = houseAsPlanes();
    let h = emptyHistory();
    const record = (label: string, next: RoofPlane[]) => {
      h = pushSnapshot(h, label, planes);
      planes = next;
    };

    const marks: number[] = [];
    marks.push(eaveOf(planes, MAIN_A));

    record('Create section', [...planes, ...buildSectionRoofPlanes({
      id: 'sec-porch', kind: 'flat', footprint: multiSectionHouse()[0].footprint,
      eaveHeightM: 2.4, pitchDeg: 2, groundElevM: GROUND_MAIN_M, label: 'Porch',
    }).planes]);
    record('Set eave height', applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.6 }).planes);
    record('Set roof pitch', applySectionEdit(planes, 'sec-main', { pitchDeg: 40 }).planes);
    record('Move section', applySectionEdit(planes, 'sec-wing', { moveEastM: 2 }).planes);
    record('Set ridge direction', applySectionEdit(planes, 'sec-wing', { ridgeAxis: 'long' }).planes);
    record('Set pad elevation', applySectionEdit(planes, 'sec-garage', { groundElevM: 148.2 }).planes);
    record('Delete section', planes.filter(p => p.sectionId !== 'sec-porch'));

    expect(planes.length).toBe(8);
    expect(h.past.length).toBe(7);

    // Walk all the way back. Every step must succeed and the last must be the
    // building we started with.
    let cur = planes;
    for (let i = 0; i < 7; i++) {
      const s = undo(h, cur);
      expect(s.ok, `undo ${i}`).toBe(true);
      h = s.history; cur = s.planes;
    }
    expect(canUndo(h)).toBe(false);
    expect(cur.length).toBe(8);
    expect(eaveOf(cur, MAIN_A)).toBeCloseTo(marks[0], 6);
    expect(JSON.parse(JSON.stringify(cur))).toEqual(JSON.parse(JSON.stringify(houseAsPlanes())));
  });

  it('a section deleted and undone comes back whole, record and all', () => {
    const planes = houseAsPlanes();
    const h = pushSnapshot(emptyHistory(), 'Delete section', planes);
    const deleted = planes.filter(p => p.sectionId !== 'sec-garage');
    expect(deleted.length).toBe(4);

    const s = undo(h, deleted);
    const garage = s.planes.filter(p => p.sectionId === 'sec-garage');
    expect(garage.length).toBe(4);
    expect(garage[0].section!.eaveHeightM).toBe(2.4);
    expect(garage[0].section!.kind).toBe('hip');
    // It is editable again, which a render snapshot could never deliver.
    expect(applySectionEdit(s.planes, 'sec-garage', { pitchDeg: 30 }).ok).toBe(true);
  });
});

describe('the edges', () => {
  it('🚨 undo on an empty history is a no-op that returns the CURRENT planes', () => {
    const planes = houseAsPlanes();
    const s = undo(emptyHistory(), planes);
    expect(s.ok).toBe(false);
    expect(s.label).toBeNull();
    // Not an empty array. A failed undo must never be able to wipe a roof.
    expect(s.planes.length).toBe(8);
    expect(s.planes).toEqual(planes);
  });

  it('redo on an empty future is the same no-op', () => {
    const planes = houseAsPlanes();
    const s = redo(emptyHistory(), planes);
    expect(s.ok).toBe(false);
    expect(s.planes).toEqual(planes);
  });

  it('🚨 a new edit destroys the redo branch', () => {
    const planes = houseAsPlanes();
    let h = pushSnapshot(emptyHistory(), 'Set eave height', planes);
    const a = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.3 }).planes;

    const u = undo(h, a);
    expect(canRedo(u.history)).toBe(true);

    // Branch off instead of redoing. The old forward path described a state
    // that no longer exists, so keeping it would let Redo apply geometry
    // derived from a design that was abandoned.
    h = pushSnapshot(u.history, 'Set roof pitch', u.planes);
    expect(canRedo(h)).toBe(false);
  });

  it('consecutive presses of one stepper collapse into one undo step', () => {
    let planes = houseAsPlanes();
    let h = emptyHistory();
    for (let i = 1; i <= 8; i++) {
      h = pushSnapshot(h, 'Set eave height', planes, 'eave:sec-main');
      planes = applySectionEdit(planes, 'sec-main', { eaveHeightM: 2.9 + i * 0.3048 }).planes;
    }
    expect(h.past.length).toBe(1);

    // One undo returns the user to where they started holding the button.
    const s = undo(h, planes);
    expect(eaveOf(s.planes, MAIN_A)).toBeCloseTo(2.9, 5);
  });

  it('🚨 the coalesce key names the SECTION, so two buildings never merge', () => {
    let planes = houseAsPlanes();
    let h = emptyHistory();

    h = pushSnapshot(h, 'Set eave height', planes, 'eave:sec-main');
    planes = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.5 }).planes;

    h = pushSnapshot(h, 'Set eave height', planes, 'eave:sec-garage');
    planes = applySectionEdit(planes, 'sec-garage', { eaveHeightM: 3.0 }).planes;

    // Two entries, not one. Undoing the garage must not undo the house.
    expect(h.past.length).toBe(2);
    const s = undo(h, planes);
    expect(eaveOf(s.planes, sectionFaceId('sec-garage', 'slopeA'))).toBeCloseTo(2.4, 5);
    expect(eaveOf(s.planes, MAIN_A)).toBeCloseTo(3.5, 5);
  });

  it('a different field breaks the run too', () => {
    const planes = houseAsPlanes();
    let h = pushSnapshot(emptyHistory(), 'Set eave height', planes, 'eave:sec-main');
    h = pushSnapshot(h, 'Set roof pitch', planes, 'pitch:sec-main');
    expect(h.past.length).toBe(2);
  });

  it('the stack is bounded and drops the OLDEST', () => {
    const planes = houseAsPlanes();
    let h = emptyHistory();
    for (let i = 0; i < MAX_HISTORY_DEPTH + 25; i++) {
      h = pushSnapshot(h, `edit ${i}`, planes, `k${i}`);
    }
    expect(h.past.length).toBe(MAX_HISTORY_DEPTH);
    expect(undoLabel(h)).toBe(`edit ${MAX_HISTORY_DEPTH + 24}`);
    expect(h.past[0].label).toBe(`edit ${25}`);
  });

  it('clearHistory empties both directions — history from one site is not applicable to another', () => {
    const planes = houseAsPlanes();
    const h = pushSnapshot(emptyHistory(), 'Set eave height', planes);
    const cleared = clearHistory();
    expect(canUndo(cleared)).toBe(false);
    expect(canRedo(cleared)).toBe(false);
    expect(canUndo(h)).toBe(true); // the original is not mutated
  });

  it('pushing is immutable — the caller keeps whatever it held', () => {
    const planes = houseAsPlanes();
    const h0 = emptyHistory();
    const h1 = pushSnapshot(h0, 'a', planes);
    const h2 = pushSnapshot(h1, 'b', planes);
    expect(h0.past.length).toBe(0);
    expect(h1.past.length).toBe(1);
    expect(h2.past.length).toBe(2);
  });
});
