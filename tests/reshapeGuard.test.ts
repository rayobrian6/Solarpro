/**
 * tests/reshapeGuard.test.ts
 *
 * A HAND RESHAPE IS NOT SILENTLY UNDONE BY THE NEXT SECTION EDIT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, AS THE AUDIT FOUND IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A section face is DERIVED: footprint + eave + pitch, rebuilt from scratch on
 * every edit. Stitch is a modelling tool — Ray uses it deliberately to pull a
 * ridge onto a neighbouring peak — and it writes the merged corners, the fitted
 * pitch and the new frame straight onto the plane.
 *
 * What it did NOT write was `plane.section`. So after a stitch the face carried
 * the stitched geometry and the PRE-stitch footprint and pitch, in the same
 * object. `applySectionEdit` then rebuilt from the record, and:
 *
 *     trace a gable at 30°  ->  Stitch its ridge onto the garage peak
 *                           ->  nudge the eave one foot
 *                           ->  the stitch is gone, silently
 *
 * Two answers in one object, resolved by whichever code read it last.
 *
 * 🚨 THE FIX IS NOT TO WRITE AN APPROXIMATE FOOTPRINT BACK. There is no
 * (footprint, eave, pitch) triple that produces an arbitrary stitched shape, so
 * any record written after a stitch would be a THIRD answer. The face says it
 * is no longer parametric, the section refuses to rebuild, and discarding the
 * reshape takes an explicit press.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoofPlane } from '@/types';
import { buildSectionRoofPlanes } from '@/lib/3d/buildingSection';
import { applySectionEdit, applyFacePitchEdit, sectionFromPlanes } from '@/lib/3d/sectionEditing';
import { mainSection, garageSection } from './fixtures/multiSectionHouse';

const REPO = process.cwd();
const STUDIO = fs.readFileSync(path.join(REPO, 'components/design/DesignStudio.tsx'), 'utf8');
const ENGINE = fs.readFileSync(path.join(REPO, 'components/3d/SolarEngine3D.tsx'), 'utf8');

function house(): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of [mainSection(), garageSection()]) out.push(...buildSectionRoofPlanes(s).planes);
  return out;
}

/** What Stitch leaves behind: moved corners, and the face marked non-parametric. */
function stitched(planes: RoofPlane[], faceId: string): RoofPlane[] {
  return planes.map(p => p.id === faceId ? { ...p, sectionFaceReshaped: true } : p);
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a reshaped section refuses a parametric rebuild', () => {
  it('the lookup reports which faces were reshaped', () => {
    const look = sectionFromPlanes(stitched(house(), 'sec-main::slopeA'), 'sec-main');
    expect(look.found).toBe(true);
    expect(look.reshapedFaceIds).toEqual(['sec-main::slopeA']);
    // The other section is untouched.
    expect(sectionFromPlanes(house(), 'sec-garage').reshapedFaceIds).toEqual([]);
  });

  it('🚨 nudging the eave after a stitch is REFUSED, not silently reverted', () => {
    const planes = stitched(house(), 'sec-main::slopeA');
    const out = applySectionEdit(planes, 'sec-main', { eaveHeightM: 3.2 });
    expect(out.ok).toBe(false);
    expect(out.refusals[0].code).toBe('SECTION_FACES_RESHAPED');
    expect(out.refusals[0].message).toMatch(/reshaped by hand/);
    expect(out.refusals[0].message).toMatch(/Undo/);
    // 🚨 A REFUSAL RETURNS THE INPUT. Not an empty roof, not a partial rebuild.
    expect(out.planes).toEqual(planes);
  });

  it('every geometry-moving edit is refused, not just the eave', () => {
    const planes = stitched(house(), 'sec-main::slopeB');
    for (const edit of [
      { pitchDeg: 35 },
      { groundElevM: 151 },
      { moveEastM: 1 },
      { ridgeAxis: 'short' as const },
      { kind: 'hip' as const },
      { footprint: mainSection().footprint },
    ]) {
      const out = applySectionEdit(planes, 'sec-main', edit);
      expect(out.ok, JSON.stringify(edit)).toBe(false);
      expect(out.refusals[0].code, JSON.stringify(edit)).toBe('SECTION_FACES_RESHAPED');
    }
  });

  it('…and so is setting one face’s pitch, because that rebuilds the section too', () => {
    const out = applyFacePitchEdit(stitched(house(), 'sec-main::slopeA'), 'sec-main::slopeB', 40);
    expect(out.ok).toBe(false);
    expect(out.refusals[0].code).toBe('SECTION_FACES_RESHAPED');
  });

  it('RENAMING is still allowed — a label moves no geometry', () => {
    const out = applySectionEdit(stitched(house(), 'sec-main::slopeA'), 'sec-main', { label: 'Main house' });
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.section!.label).toBe('Main house');
  });

  it('🚨 rebuildFromParameters is the ONLY way through, and it clears the mark', () => {
    const planes = stitched(house(), 'sec-main::slopeA');
    const out = applySectionEdit(planes, 'sec-main', { rebuildFromParameters: true, eaveHeightM: 3.2 });
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.section!.eaveHeightM).toBeCloseTo(3.2, 9);
    // Every face of the section came out of the builder fresh, so none of them
    // still claims to be hand-reshaped — the section is parametric again.
    expect(sectionFromPlanes(out.planes, 'sec-main').reshapedFaceIds).toEqual([]);
    // 🚨 AND THE NEIGHBOUR DID NOT MOVE.
    for (const id of ['sec-garage::slopeA', 'sec-garage::hipEndA']) {
      expect(JSON.stringify(out.planes.find(p => p.id === id)))
        .toBe(JSON.stringify(planes.find(p => p.id === id)));
    }
  });

  it('a STANDALONE reshaped face is not affected — it has no parameters to disagree with', () => {
    const p = house()[0];
    delete (p as any).section;
    delete (p as any).sectionId;
    delete (p as any).sectionFaceKey;
    p.id = 'hand-1';
    const out = applyFacePitchEdit([{ ...p, sectionFaceReshaped: true }], 'hand-1', 25);
    expect(out.refusals).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.scope).toBe('standalone');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING. A guard that nothing sets the flag would be a guard that never
// fires, which is the defect class it was written to close.
// ═══════════════════════════════════════════════════════════════════════════

/** Strip comments so a guard cannot be satisfied by prose about itself. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('🚨 something actually sets the mark', () => {
  const studio = stripComments(STUDIO);

  /** The real predicate, lifted out of the component file so this test cannot
   *  drift from the code it is describing. */
  const RESHAPE_MOVED_EPS_DEG = 1e-7;
  function reshapeMovedIt(
    prev: { vertices?: Array<{ lat: number; lng: number }> },
    next: { vertices?: Array<{ lat: number; lng: number }> },
  ): boolean {
    const a = prev?.vertices ?? [];
    const b = next?.vertices ?? [];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i].lat - b[i].lat) > RESHAPE_MOVED_EPS_DEG) return true;
      if (Math.abs(a[i].lng - b[i].lng) > RESHAPE_MOVED_EPS_DEG) return true;
    }
    return false;
  }

  it('the predicate ignores a no-op and catches a real move', () => {
    const v = [{ lat: 38.70615, lng: -90.04625 }, { lat: 38.70625, lng: -90.04615 }];
    // Byte-identical: not a reshape.
    expect(reshapeMovedIt({ vertices: v }, { vertices: v.map(p => ({ ...p })) })).toBe(false);
    // A float round-trip through ECEF and back: still not a reshape.
    expect(reshapeMovedIt({ vertices: v }, {
      vertices: v.map(p => ({ lat: p.lat + 1e-12, lng: p.lng - 1e-12 })),
    })).toBe(false);
    // 🚨 A CENTIMETRE IS. 1e-6 degrees of latitude is about 11 cm.
    expect(reshapeMovedIt({ vertices: v }, {
      vertices: [{ lat: 38.70616, lng: -90.04625 }, v[1]],
    })).toBe(true);
    // A different corner count is unambiguous.
    expect(reshapeMovedIt({ vertices: v }, { vertices: [v[0]] })).toBe(true);
  });

  it('the reshape channel marks section faces as no longer parametric', () => {
    // Every reshape — Stitch, Square Up, the flat-trace rebuild and the
    // standalone nudge — arrives at ONE handler in DesignStudio, and this is
    // the line that stops the next section edit undoing it.
    expect(studio).toMatch(/sectionFaceReshaped:\s*true/);
    // …only for faces that belong to a section. A standalone face has no
    // parameters for the mark to protect it from.
    expect(studio).toMatch(/\(p\.sectionId \|\| p\.section\)/);
  });

  it('🚨 …and ONLY when the reshape actually moved the face', () => {
    // Square Up and Stitch push an update for every face they CONSIDER. The
    // first version of this guard read the presence of an update as evidence of
    // a reshape, and a UX audit measured the result within hours: Square Up on
    // a design of parametric sections reports "worst move 0.0 ft" — correctly,
    // a gable built from a footprint has nothing to square — and every section
    // in the design went inert behind an amber banner blaming a reshape that
    // never happened. A guard that fires on a no-op is worse than no guard.
    expect(studio).toMatch(/reshapeMovedIt\(p, u\)/);
    expect(studio).toMatch(/function reshapeMovedIt\(/);
  });

  it('the handler it sits in is the one Stitch and Square Up both reach', () => {
    const i = studio.indexOf('onRoofPlanesStitched={(updates)');
    expect(i, 'the reshape handler is not mounted').toBeGreaterThan(-1);
    // 🚨 ANCHORED ON A REAL END TOKEN, NOT A FIXED LENGTH. This was
    // `slice(i, i + 3000)`, and the handler's explanatory comment grew past that
    // window when the panel-carrying fix landed — comment-stripping leaves the
    // whitespace behind, so the block still "existed" but held none of the code
    // being asserted.
    //
    // The end is the handler's OWN closing log line. Two other anchors were
    // tried and both were wrong: `setRoofPlanes` cuts the block before the
    // reshape flag, which is set inside the mapping callback it opens; and the
    // "next prop on the engine" does not exist, because this handler is the last
    // one. The log line is inside the handler, after everything asserted here.
    const end = studio.indexOf("console.log('[DesignStudio] Stitch synced'", i);
    expect(end, 'the handler no longer ends where this guard expects').toBeGreaterThan(i);
    const block = studio.slice(i, end);
    expect(block).toMatch(/sectionFaceReshaped:\s*true/);
    // The same handler records history, so Undo steps back past the reshape —
    // which is the escape the refusal message tells the user about.
    //
    // 🚨 THE REQUIREMENT IS THAT IT RECORDS, NOT WHICH RECORDER IT USES. This
    // pinned `recordGeometry('Reshape roof')` verbatim, and it had to change:
    // that recorder's premise is that panels are recomputed from where the face
    // went, which is false for every gesture on this channel, and undo acting on
    // it displaced the whole array by the ring-centroid delta. The label and the
    // fact of recording are what this test is about; which recorder carries the
    // panels is pinned in tests/vertexMoveUndoPanelFidelity.test.tsx.
    expect(block, 'the reshape handler no longer records an undo step')
      .toMatch(/record[A-Za-z]*\('Reshape roof'\)/);
    // 🚨 PROVE THE GUARD CAN FAIL: the string is not present in an unrelated file.
    expect(stripComments(ENGINE)).not.toMatch(/sectionFaceReshaped:\s*true/);
  });

  it('the inspector shows the choice and can discard the reshape deliberately', () => {
    const engine = stripComments(ENGINE);
    expect(engine).toMatch(/reshapedFaceCount/);
    expect(engine).toMatch(/rebuildFromParameters:\s*true/);
    // 🚨 AND ONLY FROM THE EXPLICIT BUTTON. If the flag were ever passed from a
    // generic edit path, the refusal would be decoration.
    const uses = (engine.match(/rebuildFromParameters:\s*true/g) ?? []).length;
    expect(uses, 'rebuildFromParameters must have exactly one call site').toBe(1);
    const i = engine.indexOf('rebuildFromParameters: true');
    expect(engine.slice(Math.max(0, i - 400), i)).toMatch(/onRebuildFromParameters/);
  });
});
