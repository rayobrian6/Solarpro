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

  it('the reshape channel marks section faces as no longer parametric', () => {
    // Every reshape — Stitch, Square Up, the flat-trace rebuild and the
    // standalone nudge — arrives at ONE handler in DesignStudio, and this is
    // the line that stops the next section edit undoing it.
    expect(studio).toMatch(/sectionFaceReshaped:\s*true/);
    // …only for faces that belong to a section. A standalone face has no
    // parameters for the mark to protect it from.
    expect(studio).toMatch(/p\.sectionId \|\| p\.section \?/);
  });

  it('the handler it sits in is the one Stitch and Square Up both reach', () => {
    const i = studio.indexOf('onRoofPlanesStitched={(updates)');
    expect(i, 'the reshape handler is not mounted').toBeGreaterThan(-1);
    const block = studio.slice(i, i + 3000);
    expect(block).toMatch(/sectionFaceReshaped:\s*true/);
    // The same handler records history, so Undo steps back past the reshape —
    // which is the escape the refusal message tells the user about.
    expect(block).toMatch(/recordGeometry\('Reshape roof'\)/);
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
