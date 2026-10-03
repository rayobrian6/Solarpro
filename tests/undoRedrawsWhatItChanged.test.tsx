/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// AN UNDO MUST REDRAW WHAT IT CHANGED — and only that.
//
// Undo and Redo restore the canonical `RoofPlane[]` (and the autosave stores
// it), but the renderer never takes a face down because it went missing from a
// prop — ABSENCE IS NOT INTENT; the reconcile-deletions block that did deleted
// a hand-traced garage — and its restore pass skips any face still drawn. A
// review's live probe (Block → Gable → Hip → Flat → Gable, then Undo ×4):
//
//   undo #1  design [deck]                drawn deck + gable slopeA/slopeB
//   undo #2  design 4-face hip            drawn deck + hip ends + GABLE slopes,
//                                         and six pentagon walls around a hip
//   eave +3 ft → undo   design eave 4     faces and walls still at the raised height
//
// The fix is the explicit list the doctrine asks for: the OWNER, at the user's
// own Undo/Redo, names the faces that step removed and the faces whose geometry
// it changed (`restoreRedrawFor`), under a token. The engine takes those
// pictures down and its restore pass redraws the reshaped ones from the design.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, act } from '@testing-library/react';
import { stripComments } from './support/stripSource';
import { restoreRedrawFor } from '@/lib/3d/geometryHistory';
import { buildSectionRoofPlanes } from '@/lib/3d/buildingSection';
import { applySectionEdit } from '@/lib/3d/sectionEditing';
import type { RoofPlane } from '@/types';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(readFileSync(join(ROOT, 'components/3d/SolarEngine3D.tsx'), 'utf8'));
const STUDIO = stripComments(readFileSync(join(ROOT, 'components/design/DesignStudio.tsx'), 'utf8'));

const { useSiteDesign } = await import('@/components/design/useSiteDesign');

const LAT = 40.6936;
const LNG = -89.589;
const DEG = Math.PI / 180;
const mPerDegLng = 111320 * Math.cos(LAT * DEG);
const FOOTPRINT = [
  { lat: LAT - 4.5 / 111320, lng: LNG - 6 / mPerDegLng }, { lat: LAT - 4.5 / 111320, lng: LNG + 6 / mPerDegLng },
  { lat: LAT + 4.5 / 111320, lng: LNG + 6 / mPerDegLng }, { lat: LAT + 4.5 / 111320, lng: LNG - 6 / mPerDegLng },
];
const SID = 'sec-block-1';

function blockDeck(): RoofPlane[] {
  const out = buildSectionRoofPlanes({
    id: SID, kind: 'flat', pitchDeg: 0, eaveHeightM: 4, groundElevM: 127, footprint: FOOTPRINT,
    label: 'Flat section', source: 'user-traced', createdAtIso: '2026-10-03T00:00:00.000Z',
  });
  expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
  return out.planes;
}
function edit(planes: RoofPlane[], e: Parameters<typeof applySectionEdit>[2]): RoofPlane[] {
  const out = applySectionEdit(planes, SID, e);
  expect(out.ok, JSON.stringify(out.refusals)).toBe(true);
  return out.planes;
}
const ids = (xs: string[]) => [...xs].sort();

// ─────────────────────────────────────────────────────────────────────────────

describe('restoreRedrawFor — what a history step changed, by face id', () => {
  const deck = blockDeck();
  const gable = edit(deck, { kind: 'gable', pitchDeg: 22 });
  const hip = edit(gable, { kind: 'hip' });

  it('🚨 Hip → (undo) Gable: the hip ends are removed and the two slopes are reshaped', () => {
    const r = restoreRedrawFor(hip, gable);
    expect(ids(r.removedFaceIds)).toEqual([`${SID}::hipEndA`, `${SID}::hipEndB`]);
    // Same ids, different outline: a hip slope is a trapezoid, a gable slope a
    // rectangle. Skipping them because they are "still drawn" is the bug.
    expect(ids(r.reshapedFaceIds)).toEqual([`${SID}::slopeA`, `${SID}::slopeB`]);
  });

  it('Gable → (undo) Flat: both slopes go; the deck coming back is not listed (nothing is drawn for it)', () => {
    const r = restoreRedrawFor(gable, deck);
    expect(ids(r.removedFaceIds)).toEqual([`${SID}::slopeA`, `${SID}::slopeB`]);
    expect(r.reshapedFaceIds).toEqual([]);
  });

  it('🚨 an eave undo reshapes every face and removes none', () => {
    const raised = edit(hip, { eaveHeightM: 4.9 });
    const r = restoreRedrawFor(raised, hip);
    expect(r.removedFaceIds).toEqual([]);
    expect(ids(r.reshapedFaceIds)).toEqual(ids(hip.map(p => p.id)));
  });

  it('a face the step did not touch is never named — a deep copy is not a change', () => {
    const copy = JSON.parse(JSON.stringify(gable)) as RoofPlane[];
    expect(restoreRedrawFor(gable, copy)).toEqual({ removedFaceIds: [], reshapedFaceIds: [] });
    // Non-geometric fields (a label, a site key) do not make a redraw.
    const relabelled = copy.map(p => ({ ...p, siteKey: 'x', section: { ...p.section!, label: 'House' } }));
    expect(restoreRedrawFor(gable, relabelled as RoofPlane[])).toEqual({ removedFaceIds: [], reshapedFaceIds: [] });
  });

  it('🚨 a face in NEITHER array is never named — the renderer holds it, the design never listed it', () => {
    // The garage rule: a traced face the canonical array did not list at the
    // moment of the step must not be taken down by it.
    const r = restoreRedrawFor(gable, deck);
    expect([...r.removedFaceIds, ...r.reshapedFaceIds]).not.toContain('traced-garage');
  });

  it('empty and missing inputs are safe', () => {
    expect(restoreRedrawFor(null, undefined)).toEqual({ removedFaceIds: [], reshapedFaceIds: [] });
    expect(restoreRedrawFor([], gable)).toEqual({ removedFaceIds: [], reshapedFaceIds: [] });
  });
});

describe('🚨 the owner publishes it on every Undo and Redo — by running the hook', () => {
  function setup() {
    const r = renderHook(() => useSiteDesign());
    const deck = blockDeck();
    act(() => { r.result.current.setRoofPlanes(deck); });
    act(() => { r.result.current.recordGeometry('Change roof to Gable', `kind:${SID}:gable`); });
    const gable = edit(deck, { kind: 'gable', pitchDeg: 22 });
    act(() => { r.result.current.setRoofPlanes(gable); });
    return { r, deck, gable };
  }

  it('nothing is published before any undo', () => {
    const { r } = setup();
    expect(r.result.current.geometryRestore).toBeNull();
  });

  it('Undo of Block → Gable names the two slopes it removed, under a new token', () => {
    const { r } = setup();
    let label: string | null = null;
    act(() => { label = r.result.current.undoGeometry(); });
    expect(label).toBe('Change roof to Gable');
    const g = r.result.current.geometryRestore!;
    expect(g, 'the undo published no redraw instruction').not.toBeNull();
    expect(g.token).toBeGreaterThan(0);
    expect(ids(g.removedFaceIds)).toEqual([`${SID}::slopeA`, `${SID}::slopeB`]);
    expect(g.reshapedFaceIds).toEqual([]);
    expect(r.result.current.roofPlanes.map(p => p.id)).toEqual([`${SID}::deck`]);
  });

  it('…and Redo names the deck, under ANOTHER token — two steps are two instructions', () => {
    const { r } = setup();
    act(() => { r.result.current.undoGeometry(); });
    const first = r.result.current.geometryRestore!.token;
    act(() => { r.result.current.redoGeometry(); });
    const g = r.result.current.geometryRestore!;
    expect(g.token).toBeGreaterThan(first);
    expect(g.removedFaceIds).toEqual([`${SID}::deck`]);
    // Undo again: the same ids as the first undo, and still a new token.
    act(() => { r.result.current.undoGeometry(); });
    expect(r.result.current.geometryRestore!.token).toBeGreaterThan(g.token);
    expect(ids(r.result.current.geometryRestore!.removedFaceIds)).toEqual([`${SID}::slopeA`, `${SID}::slopeB`]);
  });

  it('an undo with nothing to undo publishes nothing', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.undoGeometry(); });
    expect(r.result.current.geometryRestore).toBeNull();
  });
});

describe('🚨 the engine acts on it — wiring', () => {
  it('DesignStudio hands the owner’s instruction to the engine', () => {
    expect(STUDIO).toMatch(/geometryRestore=\{site\.geometryRestore \?\? undefined\}/);
  });

  it('the engine keys on the TOKEN and takes down exactly the named faces, rails kept', () => {
    const at = ENGINE.indexOf('const lastRestoreTokenRef');
    expect(at, 'the restore-token effect is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('}, [geometryRestore?.token]);', at));
    expect(body).toMatch(/geometryRestore\.token === lastRestoreTokenRef\.current/);
    expect(body).toMatch(
      /removeFaceEntities\(viewer, \[\.\.\.removedIds, \.\.\.reshapedIds\], \{ keepRails: true \}\)/);
    expect(body).toMatch(/for \(const id of reshapedIds\) historyRedrawIdsRef\.current\.add\(id\)/);
    // 🚨 NO PRUNE. The render cache is never pruned anywhere in this file.
    expect(body).not.toMatch(/plane3D\w*Map\.current\.(delete|clear)\(/);
  });

  it('🚨 it runs BEFORE the restore pass in the same commit, so the reshaped faces are redrawn there', () => {
    const tokenAt = ENGINE.indexOf('}, [geometryRestore?.token]);');
    const restoreAt = ENGINE.indexOf('const planesToRestore = planes.filter(p => !stillDrawn(p.id))');
    expect(tokenAt).toBeGreaterThan(-1);
    expect(restoreAt, 'the restore pass moved — this guard is blind').toBeGreaterThan(-1);
    expect(tokenAt, 'React runs effects in declaration order').toBeLessThan(restoreAt);
  });

  it('a redraw after Undo is not a load: it does not switch the roof model on', () => {
    const at = ENGINE.indexOf('const planesToRestore = planes.filter(p => !stillDrawn(p.id))');
    const body = ENGINE.slice(ENGINE.lastIndexOf('useEffect(() => {', at), ENGINE.indexOf('}, [stage, roofPlanes, panels]);', at));
    expect(body).toMatch(/historyRedrawIdsRef\.current = new Set\(\)/);
    expect(body).toMatch(/if \(historyRedraw\.has\(plane\.id\)\) redrawnAfterHistory\+\+/);
    expect(body).toMatch(/if \(restored > redrawnAfterHistory\) setShowRoofModel\(true\)/);
  });

  it('a delete still clears the rails — only the Undo redraw keeps them', () => {
    expect(ENGINE).toMatch(/removeFaceEntities\(viewer, deletion\.faceIds \?\? \[\]\)/);
    const fn = ENGINE.slice(ENGINE.indexOf('function removeFaceEntities('));
    expect(fn.slice(0, 900)).toMatch(/if \(!opts\.keepRails\) \{ try \{ clearRoofRails\(viewer, id\);/);
  });
});
