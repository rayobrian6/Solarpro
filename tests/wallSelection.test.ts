/**
 * tests/wallSelection.test.ts
 *
 * THE WALL IS THE THIRD SELECTABLE OBJECT, AND IT WAS A HOLE IN THE SCENE.
 *
 * The acceptance list is explicit: "When I select geometry I need to see
 * unmistakably: Selected: Section / Roof Face / Wall, and the controls must
 * change to that object's scope."
 *
 * What a wall click did, in order of repair:
 *
 *   1. Walls are drawn as `[BUILD3D-WALL] <faceId>#<edgeIndex>` and that string
 *      was matched by NOTHING. A click fell past the wall to a geometric ray
 *      test, which answered with whatever roof lay BEHIND it — so at street
 *      level, clicking the front of the house selected a slope on the far side
 *      of the ridge and the inspector silently retargeted.
 *   2. Then it resolved to the face that owns the wall. Honest, and never the
 *      wrong building — but it still could not answer the question a person
 *      clicking a wall is asking, which is "how tall is THIS wall".
 *   3. Now it selects the wall, measures it, and says plainly that a wall has
 *      no controls of its own because it is derived from the roof face above it
 *      and the pad below it.
 *
 * 🚨 AND THE MEASUREMENT IS MEASURED. Every number comes out of the face's own
 * `polygon3D`, with the render lift removed vertically and deliberately NOT
 * removed horizontally — it shifts both ends of an edge by the same vector, so
 * the plan length is already right and "correcting" it would introduce the
 * error the correction is named after.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoofPlane } from '@/types';
import { buildSectionRoofPlanes } from '@/lib/3d/buildingSection';
import { measureWall, wallId, parseWallId } from '@/lib/3d/sectionEditing';
import { mainSection, garageSection, GROUND_MAIN_M } from './fixtures/multiSectionHouse';

const ENGINE = fs.readFileSync(
  path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
const INSPECTOR = fs.readFileSync(
  path.join(process.cwd(), 'components/3d/inspector/SectionInspector.tsx'), 'utf8');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function house(): RoofPlane[] {
  const out: RoofPlane[] = [];
  for (const s of [mainSection(), garageSection()]) out.push(...buildSectionRoofPlanes(s).planes);
  return out;
}

/** The eave edge of slope A: the one whose two corners are both at eave height. */
function eaveEdgeOf(plane: RoofPlane): number {
  const hs = (plane.polygon3D ?? []).map((_, i) => i);
  // The fixture's slopeA is traced [eave, eave, ridge, ridge], so edge 0 is the
  // eave and edge 2 is the ridge. Asserted rather than assumed below.
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('a wall id is a face and an edge, and nothing else', () => {
  it('round-trips', () => {
    expect(wallId('sec-main::slopeA', 2)).toBe('sec-main::slopeA#2');
    expect(parseWallId('sec-main::slopeA#2')).toEqual({ faceId: 'sec-main::slopeA', edgeIndex: 2 });
  });

  it('refuses anything that is not one', () => {
    for (const bad of ['', null, undefined, 'no-hash', 'face#', 'face#x', 'face#-1', '#3']) {
      expect(parseWallId(bad as any).faceId, String(bad)).toBeNull();
    }
    // 🚨 THE LAST `#` WINS, so a face id that itself contains one still parses.
    expect(parseWallId('weird#id#4')).toEqual({ faceId: 'weird#id', edgeIndex: 4 });
  });
});

describe('🚨 a wall is MEASURED from the face it hangs from', () => {
  const planes = house();
  const slopeA = planes.find(p => p.id === 'sec-main::slopeA')!;

  it('its length is the plan length of that edge — 14 m on the main mass', () => {
    const w = measureWall(planes, wallId('sec-main::slopeA', eaveEdgeOf(slopeA)));
    expect(w.refusals).toEqual([]);
    expect(w.found).toBe(true);
    // The fixture states 14 m x 9 m in true metres, independently of the
    // geometry engine. Two centimetres is the plane fitter's residual.
    expect(w.lengthM!).toBeCloseTo(14, 1);
  });

  it('🚨 its HEIGHT is the section eave, not the number a stepper was pressed to', () => {
    const w = measureWall(planes, wallId('sec-main::slopeA', 0));
    // The main section has a 2.9 m wall on a pad at 150 m.
    expect(w.baseElevM).toBeCloseTo(GROUND_MAIN_M, 6);
    expect(w.heightHighM!).toBeCloseTo(2.9, 2);
    expect(w.heightLowM!).toBeCloseTo(2.9, 2);
    // Both ends the same: an eave wall is rectangular.
    expect(w.raked).toBe(false);
    // 🚨 THE LIFT IS REMOVED. Without it the top reads 0.104 m high — four
    // inches, which is exactly the size of correction a person starts chasing.
    expect(w.topHighElevM!).toBeCloseTo(GROUND_MAIN_M + 2.9, 2);
  });

  it('🚨 a RAKE wall is a triangle, and is reported as a range', () => {
    // Edge 1 of slopeA runs from an eave corner up to the ridge, so the wall
    // under it is a gable end: one number for "the wall height" would be wrong
    // at both ends.
    const w = measureWall(planes, wallId('sec-main::slopeA', 1));
    expect(w.found).toBe(true);
    expect(w.raked).toBe(true);
    expect(w.heightLowM!).toBeCloseTo(2.9, 1);
    // 14 x 9 gable at 30°: ridge is 4.5·tan30 = 2.598 m above the eave.
    expect(w.heightHighM!).toBeCloseTo(2.9 + 4.5 * Math.tan(30 * Math.PI / 180), 1);
    expect(w.heightHighM! - w.heightLowM!).toBeGreaterThan(2);
  });

  it('it knows which face and which section it belongs to', () => {
    const w = measureWall(planes, wallId('sec-garage::slopeA', 0));
    expect(w.faceId).toBe('sec-garage::slopeA');
    expect(w.sectionId).toBe('sec-garage');
    // The garage sits on a LOWER pad than the house, and the wall says so.
    expect(w.baseElevM!).toBeLessThan(GROUND_MAIN_M);
  });

  it('it faces outward, away from the roof above it', () => {
    // The main mass runs east–west with its ridge along the long axis, so its
    // two eave walls face north and south.
    const a = measureWall(planes, wallId('sec-main::slopeA', 0));
    const b = measureWall(planes, wallId('sec-main::slopeB', 0));
    expect(a.facingDeg).not.toBeNull();
    expect(b.facingDeg).not.toBeNull();
    const gap = Math.abs(((a.facingDeg! - b.facingDeg!) % 360 + 360) % 360);
    // Opposite sides of the house: 180° apart, either way round.
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(170);
  });
});

describe('🚨 what a wall CANNOT say', () => {
  it('a standalone face has no pad, so its walls have no height', () => {
    const planes = house();
    const p = planes.find(q => q.id === 'sec-main::slopeA')!;
    delete (p as any).section;
    delete (p as any).sectionId;
    p.id = 'hand-1';
    const w = measureWall([p], wallId('hand-1', 0));
    expect(w.found).toBe(true);
    // 🚨 NULL, NOT ZERO AND NOT A DEFAULT. "Show unresolved rather than a
    // misleading number" — the elevations are still real, the height is not.
    expect(w.baseElevM).toBeNull();
    expect(w.heightHighM).toBeNull();
    expect(w.topHighElevM).not.toBeNull();
    expect(w.lengthM!).toBeCloseTo(14, 1);
  });

  it('…unless the caller supplies a ground elevation, which is then used', () => {
    const planes = house();
    const p = planes.find(q => q.id === 'sec-main::slopeA')!;
    delete (p as any).section;
    delete (p as any).sectionId;
    p.id = 'hand-1';
    const w = measureWall([p], wallId('hand-1', 0), GROUND_MAIN_M);
    expect(w.baseElevM).toBe(GROUND_MAIN_M);
    expect(w.heightHighM!).toBeCloseTo(2.9, 2);
  });

  it('an unknown face or edge is a refusal, not a zero-length wall', () => {
    const planes = house();
    expect(measureWall(planes, 'nope#0').found).toBe(false);
    expect(measureWall(planes, wallId('sec-main::slopeA', 99)).found).toBe(false);
    expect(measureWall(planes, 'not-a-wall').found).toBe(false);
    for (const id of ['nope#0', 'not-a-wall']) {
      expect(measureWall(planes, id).refusals.length, id).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a click on a wall selects the wall', () => {
  const engine = stripComments(ENGINE);

  it('the pick carries the wall tag out, and clears it on every other pick', () => {
    // A stale tag would put the panel on a wall the user is no longer pointing
    // at, which is the class of defect the whole selection rework is about.
    expect(engine).toMatch(/hitWallIdRef\.current = null;/);
    expect(engine).toMatch(/hitWallIdRef\.current = tag;/);
    const fn = engine.slice(
      engine.indexOf('function pickBuildingFaceAtScreen('),
      engine.indexOf('function handleSelectClick('));
    // Cleared at the TOP of the pick, before any hit can set it.
    expect(fn.indexOf('hitWallIdRef.current = null'))
      .toBeLessThan(fn.indexOf('hitWallIdRef.current = tag'));
  });

  it('the click handler reads it BEFORE selectRoofFace resets the level', () => {
    // `selectRoofFace` sets the level back to 'section' on every new click, so
    // reading the tag after it would always lose the wall.
    const i = engine.indexOf('const wallHit = hitWallIdRef.current;');
    expect(i, 'the wall hit is never read').toBeGreaterThan(-1);
    const j = engine.indexOf('selectRoofFace(toggledOff ? null : faceId);');
    expect(j).toBeGreaterThan(i);
    expect(engine).toMatch(/setSelectionLevel\('wall'\)/);
  });

  it('selecting anything else clears the wall', () => {
    const fn = engine.slice(
      engine.indexOf('function selectRoofFace('),
      engine.indexOf('function selectionMessageFor('));
    expect(fn).toMatch(/setSelectedWallId\(null\)/);
  });

  it('the inspector state carries a measured wall, never a stale one', () => {
    expect(engine).toMatch(/measureWall\(planes, selectedWallId/);
    // Only ever built when the level IS 'wall' — otherwise the panel could
    // render a wall for a selection that is not one.
    expect(engine).toMatch(/selectionLevel === 'wall' && selectedWallId/);
  });
});

describe('🚨 the panel names the level and offers no control it cannot honour', () => {
  const ui = stripComments(INSPECTOR);

  it('Wall is one of the three chips', () => {
    expect(ui).toMatch(/levelChip\('wall', 'Wall'/);
    expect(ui).toMatch(/InspectorLevel = 'none' \| 'section' \| 'face' \| 'wall'/);
  });

  it('a wall renders measurements and NO editable field', () => {
    const i = ui.indexOf('data-testid="inspector-wall"');
    expect(i, 'the wall panel is not mounted').toBeGreaterThan(-1);
    const block = ui.slice(i, ui.indexOf('inspector-refusal'));
    expect(block).toMatch(/Length/);
    expect(block).toMatch(/Base above sea/);
    // 🚨 NOT ONE INPUT. A wall is derived; a box here would write nowhere.
    expect(block).not.toMatch(/<NumberField/);
    expect(block).not.toMatch(/<input/);
    // And it names the controls that DO move it.
    expect(block).toMatch(/Wall \/ eave/);
    expect(block).toMatch(/Pad elevation/);
    expect(block).toMatch(/inspector-wall-to-section/);
  });

  it('a raked wall shows a range rather than one number for two heights', () => {
    const i = ui.indexOf('data-testid="inspector-wall"');
    const block = ui.slice(i, ui.indexOf('inspector-refusal'));
    expect(block).toMatch(/w\.raked \?/);
    expect(block).toMatch(/Height \(low\)/);
    expect(block).toMatch(/Height \(high\)/);
  });

  it('an unresolved base says so instead of printing a number', () => {
    const i = ui.indexOf('data-testid="inspector-wall"');
    const block = ui.slice(i, ui.indexOf('inspector-refusal'));
    expect(block).toMatch(/w\.baseElevM == null \? 'unresolved' : 'measured'/);
    expect(block).toMatch(/inspector-wall-unresolved/);
  });
});
