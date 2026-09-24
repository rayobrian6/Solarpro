/**
 * tests/obstructionPlacementAuthority.test.ts
 *
 * ONE PHYSICAL VALIDITY AUTHORITY. NO PLACEMENT PATH GETS ITS OWN RULES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INSTRUCTION, AND WHAT AN AUDIT FOUND BEHIND IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Manual placement and Auto Layout must share the same physical validity
 *    authority. We already found `addRow` bypassing containment once. Do not
 *    allow another placement path to have different rules."
 *
 * For obstructions the rules were not merely different — there were almost none:
 *
 *   • `placePanelsControlled` is the ONE chokepoint for every 3D placement path
 *     (auto_roof, plane3d, surface_select, add_row, extend_row, single, ground,
 *     fence) and had NO obstruction awareness at all. A grep for
 *     obstruction/keepout across lib/3d/ returned zero matches.
 *   • The only keep-out filter was applied at three 2D call sites, and all
 *     three sit downstream of a `routeLayoutTo3D()` early return — so in 3D
 *     mode, which is where roofs are modelled, none of them ran.
 *   • `keepOutZones` had exactly one writer: the Nearmap AI fetch. The
 *     obstructions a PERSON places live in `placedObstructions` and were never
 *     converted, so a hand-marked chimney was consulted by nothing at all.
 *
 * 🚨 AND BOTH EXISTING TESTS USED THE PANEL CENTRE. A module is ~1.13 m × 1.72 m
 * and a default vent is 0.6 m across. "Is the panel's lat/lng inside the
 * footprint" is true for only a small fraction of the positions where the module
 * physically covers the vent, so a marked vent removed a panel roughly one time
 * in five and the other four times a module went straight through it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  panelHitsKeepOut, filterPanelsByKeepOut, positionClearsKeepOut,
  clearanceFor, keepOutHalfExtentsM, panelHalfExtentsM, keepOutRing,
  DEFAULT_CLEARANCE_M, FALLBACK_CLEARANCE_M,
} from '@/lib/3d/panelKeepOut';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const LAT = 38.70615, LNG = -90.04625;
const M_PER_DEG_LAT = 111_320;
/** Move `m` metres north of the obstruction. */
const north = (m: number) => LAT + m / M_PER_DEG_LAT;

/** A standard 60-cell residential module, as `PlacedPanel` carries it. */
const MODULE = { widthFeet: 3.72, heightFeet: 5.65 };   // 1.134 m x 1.722 m

const vent = { id: 'v1', lat: LAT, lng: LNG, type: 'vent', radiusM: 0.3, heightM: 0.4 };
const chimney = { id: 'c1', lat: LAT, lng: LNG, type: 'chimney', widthM: 0.9, depthM: 0.6, heightM: 1.2 };

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 footprint against footprint, not centre against footprint', () => {
  it('a module whose CENTRE is well clear of a vent still hits it', () => {
    // 0.55 m north. The module's centre is outside the 0.3 m vent and outside
    // its 0.15 m clearance — the old centre test said "fine" — but the module
    // extends 0.861 m from its own centre, so it physically covers the vent.
    const p = { id: 'p', lat: north(0.55), lng: LNG, ...MODULE };
    expect(panelHitsKeepOut(p, vent)).toBe(true);
  });

  it('🚨 MUTATION PROOF: the OLD centre test calls that same module clear', () => {
    // This is the defect, reproduced exactly: |dy| = 0.55 m, radius 0.3 m.
    const dyM = 0.55;
    const oldCentreTest = dyM < vent.radiusM;
    expect(oldCentreTest).toBe(false);          // the old answer: no conflict
    expect(panelHitsKeepOut({ id: 'p', lat: north(dyM), lng: LNG, ...MODULE }, vent)).toBe(true);
  });

  it('a module genuinely two metres away is clear', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: north(2), lng: LNG, ...MODULE }, vent)).toBe(false);
  });

  it('a module directly over it is obviously a hit', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, vent)).toBe(true);
  });

  it('the boundary is the sum of the half-extents, and it is continuous', () => {
    const k = keepOutHalfExtentsM(vent);          // 0.3 + 0.15 clearance
    const p = panelHalfExtentsM(MODULE as never); // 0.567 x 0.861
    const edge = k.halfY + p.halfY;               // ~1.311 m
    expect(panelHitsKeepOut({ id: 'p', lat: north(edge - 0.02), lng: LNG, ...MODULE }, vent)).toBe(true);
    expect(panelHitsKeepOut({ id: 'p', lat: north(edge + 0.02), lng: LNG, ...MODULE }, vent)).toBe(false);
  });

  it('a module with no CAD dimensions falls back to a real module, never to zero', () => {
    // Zero would silently restore the centre-point test this exists to replace.
    const e = panelHalfExtentsM({ lat: 0, lng: 0 } as never);
    expect(e.halfX).toBeGreaterThan(0.5);
    expect(e.halfY).toBeGreaterThan(0.8);
  });
});

describe('clearance is a real distance, and it has a default per type', () => {
  it('🚨 ZERO WAS THE OLD ANSWER FOR EVERYTHING, and it is wrong for all of them', () => {
    for (const t of ['vent', 'vent_pipe', 'plumbing_stack', 'chimney', 'skylight', 'roof_hatch', 'hvac']) {
      expect(DEFAULT_CLEARANCE_M[t], `${t} has no clearance`).toBeGreaterThan(0);
    }
  });

  it('a chimney is kept clearer than a vent — flashing and combustibles', () => {
    expect(DEFAULT_CLEARANCE_M.chimney).toBeGreaterThan(DEFAULT_CLEARANCE_M.vent);
  });

  it('an explicit clearance on the object wins over the type default', () => {
    expect(clearanceFor({ ...vent, clearanceM: 1.5 })).toBe(1.5);
    // Including an explicit zero: an installer may decide a vent needs none.
    expect(clearanceFor({ ...vent, clearanceM: 0 })).toBe(0);
  });

  it('an unknown type gets the fallback, not zero', () => {
    expect(clearanceFor({ lat: 0, lng: 0, type: 'something-new' })).toBe(FALLBACK_CLEARANCE_M);
    expect(clearanceFor({ lat: 0, lng: 0 })).toBe(FALLBACK_CLEARANCE_M);
  });

  it('a bigger clearance removes more', () => {
    const far = { id: 'p', lat: north(1.6), lng: LNG, ...MODULE };
    expect(panelHitsKeepOut(far, vent)).toBe(false);
    expect(panelHitsKeepOut(far, { ...vent, clearanceM: 1.0 })).toBe(true);
  });

  it('a rectangular chimney uses its width and depth, not a radius', () => {
    const k = keepOutHalfExtentsM(chimney);
    expect(k.halfX).toBeCloseTo(0.9 / 2 + DEFAULT_CLEARANCE_M.chimney, 6);
    expect(k.halfY).toBeCloseTo(0.6 / 2 + DEFAULT_CLEARANCE_M.chimney, 6);
  });

  it('the keep-out ring is drawable and matches the half-extents', () => {
    const ring = keepOutRing(chimney);
    expect(ring).toHaveLength(4);
    const k = keepOutHalfExtentsM(chimney);
    expect((ring[2].lat - ring[0].lat) * M_PER_DEG_LAT).toBeCloseTo(k.halfY * 2, 3);
  });
});

describe('the filter every placement path calls', () => {
  const panels = [
    { id: 'over', lat: LAT, lng: LNG, ...MODULE },
    { id: 'near', lat: north(0.55), lng: LNG, ...MODULE },
    { id: 'clear', lat: north(3), lng: LNG, ...MODULE },
  ];

  it('removes what stands on the obstruction and reports it', () => {
    const r = filterPanelsByKeepOut(panels, [vent]);
    expect(r.panels.map(p => p.id)).toEqual(['clear']);
    expect(r.removed.map(p => p.id)).toEqual(['over', 'near']);
  });

  it('with no obstructions it is the identity — and the SAME array', () => {
    // A layout that silently shrinks when nothing was marked would be a
    // regression on every existing design.
    expect(filterPanelsByKeepOut(panels, []).panels).toBe(panels);
    expect(filterPanelsByKeepOut(panels, null).panels).toBe(panels);
  });

  it('an obstruction with no coordinates is ignored rather than removing everything', () => {
    const r = filterPanelsByKeepOut(panels, [{ lat: NaN, lng: NaN } as never]);
    expect(r.panels).toHaveLength(3);
  });

  it('the interactive answer and the batch answer agree', () => {
    // A ghost preview that says "valid" and a commit that deletes the module
    // are two answers to one question.
    for (const p of panels) {
      const batch = filterPanelsByKeepOut([p], [vent]).removed.length > 0;
      const live = !positionClearsKeepOut(p, [vent]).ok;
      expect(live, `disagreement on ${p.id}`).toBe(batch);
    }
  });

  it('the interactive answer names what blocked it', () => {
    expect(positionClearsKeepOut({ lat: LAT, lng: LNG, ...MODULE }, [chimney]).blockedBy).toBe('chimney');
    expect(positionClearsKeepOut({ lat: north(9), lng: LNG, ...MODULE }, [chimney]).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WIRING — this is what makes it ONE authority rather than one more helper
// ═══════════════════════════════════════════════════════════════════════════

const CONTROL = strip(read('lib/3d/controlLayer.ts'));
const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));
const STUDIO = strip(read('components/design/DesignStudio.tsx'));

describe('🚨 the chokepoint enforces it, so no 3D path can opt out', () => {
  it('placePanelsControlled filters its own output', () => {
    expect(CONTROL).toMatch(/filterPanelsByKeepOut\(normalizedAll, config\.obstructions\)/);
  });

  it('…AFTER normalisation, so the modules carry their real dimensions', () => {
    const norm = CONTROL.indexOf('const normalizedAll = normalizePanels');
    const filt = CONTROL.indexOf('filterPanelsByKeepOut(normalizedAll');
    expect(norm).toBeGreaterThan(-1);
    expect(filt).toBeGreaterThan(norm);
  });

  it('and it reports what it removed rather than shrinking in silence', () => {
    expect(CONTROL).toMatch(/obstructedCount: keptAfterKeepOut\.removed\.length/);
  });

  it('🚨 EVERY call site in the studio passes the obstruction list', () => {
    // The guard that makes a NEW placement path impossible to add quietly. If
    // this count ever drops, a path has been added that plays by its own rules.
    const calls = (ENGINE.match(/placePanelsControlled\(\{/g) ?? []).length;
    const passes = (ENGINE.match(/obstructions: obstructionsRef\.current/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(passes, `${calls} placement call sites but only ${passes} pass obstructions`).toBe(calls);
  });
});

describe('🚨 the obstructions a PERSON marked reach the 2D paths too', () => {
  it('all three 2D filters consult placedObstructions, not only the AI list', () => {
    // `keepOutZones` has exactly one writer — the Nearmap fetch — so before
    // this a hand-marked chimney was honoured by nothing anywhere.
    const uses = (STUDIO.match(/filterPanelsByKeepOut\(/g) ?? []).length;
    expect(uses).toBe(3);
    expect(STUDIO).toMatch(/placedObstructionsRef\.current \?\? \[\]/);
  });

  it('and the AI keep-outs are still applied — both sources, one rule', () => {
    expect(STUDIO).toMatch(/filterPanelsByObstructions\(allNew, keepOutZones\)/);
  });
});

describe('🚨 an obstruction can be selected, and therefore deleted', () => {
  it('a click in select mode picks the obstruction under the cursor', () => {
    // It could be placed and never touched again: no gesture selected one, so
    // "delete this vent" was unreachable and the only way to remove a
    // mis-placed one was to remove every obstruction on the roof.
    expect(ENGINE).toMatch(/function pickObstructionAtScreen/);
    expect(ENGINE).toMatch(/const obsHit = pickObstructionAtScreen\(viewer, screenPos\)/);
  });

  it('…and it is checked BEFORE panels, or it is unclickable where it matters', () => {
    // An obstruction is small, sits on the roof surface and is usually
    // surrounded by modules.
    const at = ENGINE.indexOf('const obsHit = pickObstructionAtScreen');
    const panelAt = ENGINE.indexOf('const picked = pickPanelAtScreen(viewer, screenPos);');
    expect(at).toBeGreaterThan(-1);
    expect(panelAt).toBeGreaterThan(at);
  });

  it('the Delete key removes the selected one through the canonical path', () => {
    expect(ENGINE).toMatch(/onRequestDelete\?\.\('obstruction', selectedObstructionIdRef\.current\)/);
  });

  it('the picker reads the same id the placement path wrote', () => {
    // `[OBS] <id>` where <id> IS the PlacedObstruction id — one fact, read one
    // way, so a tombstone and an entity cannot disagree about which object it is.
    expect(ENGINE).toMatch(/nm\.startsWith\('\[OBS\] '\)/);
    // 🚨 THIS USED TO READ `${obsId}`, THE HAND-ROLLED ENTITY IN THE CLICK
    // HANDLER. It is now `${obs.id}` inside `drawObstructionEntity`, because
    // placement no longer builds its own entity.
    //
    // The old arrangement had TWO writers of this name: the click handler and
    // the redraw path. They also disagreed about colour — placement always drew
    // white, while `drawObstructionEntity` draws a site object green — so a
    // freshly placed tree looked like a vent until the page was reloaded, which
    // is part of "it does not visibly give me a useful tree". One writer now,
    // which is what makes this assertion worth having.
    //
    // 🚨 AND NOW EVERY PART OF THE OBJECT CARRIES IT. A tree is drawn as a
    // trunk and a canopy, not one box, so the name is hoisted to `partName` and
    // stamped on each part — clicking a tree's canopy must select the TREE.
    // The invariant is "the name is `[OBS] ` + the canonical id", not the
    // spelling of one literal.
    expect(ENGINE, 'the entity name is no longer built from the canonical id')
      .toMatch(/const partName = `\[OBS\] \$\{obs\.id\}`/);
    expect(ENGINE, 'a drawn part does not carry the object name, so it cannot be picked')
      .toMatch(/name: partName/);
    // Sub-parts must be distinct ENTITIES but the same OBJECT.
    expect(ENGINE, 'the parts of one object share an entity id and will collide')
      .toMatch(/\$\{obs\.id\}::\$\{part\.role\}/);
    expect(ENGINE, 'placement builds its own entity again')
      .not.toMatch(/name:\s+`\[OBS\] \$\{obsId\}`/);
  });
});

describe('🚨 a site object shades but does not occupy', () => {
  it('a tree beside the house does not delete the panels under it', () => {
    // Shaded production is a derate, not a no-build. Removing modules under a
    // tree would be a physically false answer and a commercially wrong one.
    const tree = { id: 't', lat: LAT, lng: LNG, type: 'tree', space: 'site' as const, radiusM: 3 };
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, tree)).toBe(false);
  });

  it('…while the identical footprint marked as a ROOF object does', () => {
    const roofThing = { id: 'r', lat: LAT, lng: LNG, type: 'hvac', radiusM: 3 };
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, roofThing)).toBe(true);
  });

  it('absent `space` reads as roof — every obstruction stored before it existed', () => {
    expect(panelHitsKeepOut({ id: 'p', lat: LAT, lng: LNG, ...MODULE }, vent)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKING A VENT SHOULD NOT BE A CAD SESSION
// ═══════════════════════════════════════════════════════════════════════════

import { clampToPreset, presetIsSelfConsistent, OBSTRUCTION_PRESETS, presetFor, legacyRadiusFor, DEFAULT_OBSTRUCTION_PRESET } from '@/lib/3d/obstructionPresets';

describe('🚨 the type a user picks is the type that gets stored', () => {
  it('EVERY obstruction used to be stamped "chimney", whatever it was', () => {
    // Harmless as a label; not harmless once the type decides the clearance.
    // A vent pipe was given a chimney's 450 mm keep-out, and a tree would have
    // been given one it should never have had.
    expect(ENGINE).not.toMatch(/type:\s+'chimney',\s*\n\s*\};/);
    expect(ENGINE).toMatch(/const preset = presetFor\(obstructionPresetRef\.current\)/);
    expect(ENGINE).toMatch(/type:\s+preset\.id,/);
    expect(ENGINE).toMatch(/space:\s+preset\.space,/);
  });

  it('the field workflow is pick-a-noun-then-click, not three sliders', () => {
    expect(ENGINE).toMatch(/OBSTRUCTION_PRESETS\.map\(pr =>/);
    expect(ENGINE).toMatch(/data-testid=\{`obstruction-preset-\$\{pr\.id\}`\}/);
    // Choosing the noun fills the dimensions, so the common case needs no typing.
    expect(ENGINE).toMatch(/setNewObstructionWidthM\(pr\.widthM\)/);
    expect(ENGINE).toMatch(/setNewObstructionHeightM\(pr\.heightM\)/);
  });

  it('…and the clearance it will get is on screen BEFORE the click', () => {
    expect(ENGINE).toMatch(/Panels keep \{\(DEFAULT_CLEARANCE_M\[obstructionPresetId\]/);
  });

  it('every preset names a real canonical type with a real clearance', () => {
    for (const pr of OBSTRUCTION_PRESETS) {
      expect(DEFAULT_CLEARANCE_M[pr.id], `${pr.id} has no clearance entry`).toBeDefined();
      expect(pr.widthM).toBeGreaterThan(0);
      expect(pr.heightM).toBeGreaterThan(0);
      expect(pr.hint.length).toBeGreaterThan(10);
    }
    expect(presetFor(DEFAULT_OBSTRUCTION_PRESET).id).toBe(DEFAULT_OBSTRUCTION_PRESET);
    expect(presetFor('nonsense').id).toBe(OBSTRUCTION_PRESETS[0].id);
  });

  it('a tree is the only SITE object, and it shades rather than occupies', () => {
    const site = OBSTRUCTION_PRESETS.filter(p => p.space === 'site');
    expect(site.map(p => p.id)).toEqual(['tree']);
    expect(DEFAULT_CLEARANCE_M.tree).toBe(0);
  });

  it('a flush skylight is genuinely flush, so it cannot pretend to shade', () => {
    expect(presetFor('skylight').heightM).toBeLessThan(0.2);
    // …while a chimney is tall enough to matter.
    expect(presetFor('chimney').heightM).toBeGreaterThan(1);
  });

  it('the legacy radius is still written, so no older path loses its keep-out', () => {
    expect(legacyRadiusFor(0.9, 0.6)).toBeCloseTo(Math.sqrt(0.81 + 0.36) / 2, 9);
    expect(ENGINE).toMatch(/legacyRadiusFor\(widthM, depthM\)/);
  });

  it('a roof object records the face it was marked on; a site object does not', () => {
    // Surface-local ownership: the object belongs to a face, not to a world
    // coordinate, so the face can move and take it along.
    //
    // 🚨 THIS TEST ASSERTED THE WRONG FACE AND IS CORRECTED, NOT DELETED.
    //
    // It used to require `selectedFaceIdRef.current` — the face that happened to
    // be SELECTED, which is not the face the user clicked. Marking a chimney on
    // the garage while the main roof was selected bound it to the main roof, so
    // it moved with the wrong section for ever; and with nothing selected it
    // bound to nothing at all and the object was orphaned the moment its roof
    // moved. The test named the right property ("the face it was marked on") and
    // then pinned the wrong implementation of it.
    //
    // The ray now answers: `resolvePlacementPoint` intersects the camera ray
    // with the design's own canonical faces and returns the id of the nearest
    // one actually hit. See tests/placementIntersection.test.ts.
    expect(ENGINE).toMatch(/planeId: preset\.space === 'roof' \? \(spot\.planeId \?\? undefined\) : undefined/);
    expect(ENGINE, 'the object is bound to the selected face again')
      .not.toMatch(/planeId: preset\.space === 'roof' \? \(selectedFaceIdRef\.current/);
    expect(ENGINE).toMatch(/canopyRadiusM: preset\.space === 'site'/);
  });
});

describe('🚨 a placed object can be edited, which is what makes it a tree', () => {
  it('the selected object gets an inspector with its physical numbers', () => {
    // 🚨 PLACING WAS ONLY HALF A WORKFLOW. Even once the Tree tool placed a
    // canonical object, nothing could CHANGE it — no height, no canopy, no
    // dimensions at all after the click. A tree you cannot size is a marker,
    // and those are precisely the two numbers Shade reads.
    expect(ENGINE).toMatch(/data-testid="obstruction-inspector"/);
    // The fields are built by one `num()` helper, so their ids are arguments
    // rather than literal attributes — assert the ids that reach it.
    for (const id of ['obstruction-height', 'obstruction-canopy', 'obstruction-width',
                      'obstruction-depth', 'obstruction-clearance']) {
      expect(ENGINE, `${id} is not offered`).toContain(`'${id}'`);
    }
    expect(ENGINE).toMatch(/data-testid=\{testId\}/);
  });

  it('a TREE is offered a canopy; a roof object is offered width, depth and clearance', () => {
    // They differ in their numbers, not in the act of editing them, so it is
    // one panel that shows only the fields that mean something.
    const at = ENGINE.indexOf('data-testid="obstruction-inspector"');
    const block = ENGINE.slice(at, at + 4200);
    expect(block).toContain('isTree');
    expect(block).toMatch(/num\('Canopy width'/);
    expect(block).toMatch(/num\('Clearance'/);
  });

  it('editing redraws from the SAME function placement uses', () => {
    // One picture from one record. Placement used to build the prism inline
    // from the slider values, so there was no way to draw an object that
    // already existed — which is why nothing could be resized.
    expect(ENGINE).toMatch(/function drawObstructionEntity/);
    expect(ENGINE).toMatch(/drawObstructionEntity\(viewerRef\.current, \(window as any\)\.Cesium, merged\)/);
  });

  it('and the delete is right there, through the canonical path', () => {
    expect(ENGINE).toMatch(/data-testid="obstruction-delete"/);
    expect(ENGINE).toMatch(/onRequestDelete\?\.\('obstruction', obs\.id\)/);
  });
});

describe('🚨 the Tree tool places the object Shade can actually use', () => {
  it('choosing Tree arms the canonical obstruction, not the decorative sphere', () => {
    // `handleTreeClick` added two Cesium entities with hardcoded dimensions,
    // wrote nothing to any canonical array, appeared in no Layout, survived no
    // reload, and its own tooltip said "No effect on solar production". Two
    // controls called Tree with the same emoji, one a placebo, is worse than
    // either alone.
    expect(ENGINE).toMatch(/if \(mode === 'tree'\) \{/);
    expect(ENGINE).toMatch(/obstructionPresetRef\.current = 'tree'/);
    // 🚨 AND IT STAYS ON THE TREE TOOL. This line used to require the opposite
    // — `onPlacementModeChange('obstruction')` — which is exactly the defect
    // the owner reported next: "When I click Tree, the UI immediately reverts
    // to Obstruction." Arming the right OBJECT while throwing away the tool
    // STATE is half a fix, and it reads to a user like none.
    // tests/toolStateAuthority.test.ts owns that invariant now.
    expect(ENGINE).toMatch(/else if \(mode === 'tree'\)\s+handleObstructionClick/);
    expect(ENGINE).not.toMatch(/No effect on solar production/);
  });
});


// ===========================================================================
describe('🚨 an object is placed at the size it says it is', () => {
  // -------------------------------------------------------------------------
  // THE LIVE FAILURE
  //
  //   "I tried the Tree button. It does not visibly give me a useful tree."
  //
  // The Tree tool armed a 6 m x 6 m x 8 m canopy, and placement then clamped it
  // to 3 x 3 x 5 -- because `clampObstructionFootprint` holds ONE range,
  // [0.2, 3.0] m footprint and [0.3, 5.0] m height, chosen for the single
  // generic 0.6 x 0.6 x 1.0 block the feature began as. Nine real objects now
  // share that clamp and four of them do not fit inside it.
  //
  // 🚨 THIS IS NOT COSMETIC. `canopyRadiusM` is derived from the placed
  // footprint, so the shade calculation ran on a tree of half the radius.
  // -------------------------------------------------------------------------

  it('🚨 every preset survives its own clamp unchanged', () => {
    // If a nominal value falls outside the range declared beside it, the
    // catalogue is lying about what it places. This is the assertion that found
    // all four rewrites.
    for (const preset of OBSTRUCTION_PRESETS) {
      const c = clampToPreset(preset, preset.widthM, preset.depthM, preset.heightM);
      expect(c.widthM,  `${preset.id} width is rewritten at placement`).toBe(preset.widthM);
      expect(c.depthM,  `${preset.id} depth is rewritten at placement`).toBe(preset.depthM);
      expect(c.heightM, `${preset.id} height is rewritten at placement`).toBe(preset.heightM);
      expect(presetIsSelfConsistent(preset), `${preset.id} is not self-consistent`).toBe(true);
    }
  });

  it('🚨 a tree keeps its 6 m canopy and its 8 m height', () => {
    // The exact numbers from the report. Under the old global clamp this was
    // 3 x 3 x 5.
    const tree = presetFor('tree');
    const c = clampToPreset(tree, tree.widthM, tree.depthM, tree.heightM);
    expect(c.widthM).toBe(6.0);
    expect(c.depthM).toBe(6.0);
    expect(c.heightM).toBe(8.0);
    // ...and the canopy RADIUS that shade reads is 3 m, not 1.5 m.
    expect(Math.max(c.widthM, c.depthM) / 2).toBe(3.0);
  });

  it('a vent pipe and a plumbing stack stay different objects', () => {
    // Both were forced to 0.20 m, which made them the same thing on the roof
    // and gave them the same keep-out.
    const pipe = presetFor('vent_pipe');
    const stack = presetFor('plumbing_stack');
    const cp = clampToPreset(pipe, pipe.widthM, pipe.depthM, pipe.heightM);
    const cs = clampToPreset(stack, stack.widthM, stack.depthM, stack.heightM);
    expect(cp.widthM).toBe(0.1);
    expect(cs.widthM).toBe(0.15);
    expect(cp.widthM).not.toBe(cs.widthM);
  });

  it('a flush skylight stays flush', () => {
    // 0.12 m -> 0.30 m turned a flush unit into a curb, and the preset's own
    // comment says "a flush skylight is genuinely 0.1 and not 1.0".
    const sky = presetFor('skylight');
    expect(clampToPreset(sky, sky.widthM, sky.depthM, sky.heightM).heightM).toBe(0.12);
  });

  it('the bounds still bound: nonsense is still refused', () => {
    // A range per object is not the absence of a range.
    const chimney = presetFor('chimney');
    expect(clampToPreset(chimney, 500, 500, 500).widthM).toBe(chimney.maxFootprintM);
    expect(clampToPreset(chimney, 0.0001, 0.0001, 0.0001).widthM).toBe(chimney.minFootprintM);
    expect(clampToPreset(chimney, -4, -4, -4).widthM).toBe(chimney.widthM);
    // ...and a tree may not be a vent pipe's size either.
    const tree = presetFor('tree');
    expect(clampToPreset(tree, 0.05, 0.05, 0.05).widthM).toBe(tree.minFootprintM);
  });

  it('a blank field places the object, not the smallest legal one', () => {
    // An empty input box reads as NaN. Falling back to the minimum would place
    // a 1 m tree; falling back to the nominal places a tree.
    const tree = presetFor('tree');
    const c = clampToPreset(tree, NaN, undefined as any, null as any);
    expect(c.widthM).toBe(tree.widthM);
    expect(c.depthM).toBe(tree.depthM);
    expect(c.heightM).toBe(tree.heightM);
  });

  it('🚨 placement asks the object, not the global band', () => {
    expect(ENGINE, 'placement is back on the one-size-fits-all clamp')
      .not.toMatch(/const \{ widthM, depthM \} = clampObstructionFootprint\(\s*newObstructionWidthM/);
    // 🚨 AND IT ASKS THE REF, NOT THE STATE. This used to pin the three
    // `newObstruction*M` state variables by name, which is exactly the read
    // that made a placed tree 1 m across instead of 6: `handleObstructionClick`
    // is reached only from a Cesium handler registered once at mount, so the
    // state it can see is the state from before the user chose anything, and
    // `clampToPreset` then raised the 0.6 m block default to the tree's 1.0 m
    // minimum footprint. The guard was pinning the defect in place.
    //
    // The live value now comes from `obstructionSizeRef`, mirrored by an effect.
    // See tests/mountFrozenClosure.test.ts for the full account.
    expect(ENGINE, 'placement reads React state again — see tests/mountFrozenClosure.test.ts')
      .not.toMatch(/clampToPreset\(preset, newObstructionWidthM/);
    expect(ENGINE).toMatch(/clampToPreset\(preset, armedSize\.widthM, armedSize\.depthM, armedSize\.heightM\)/);
  });
});

// ===========================================================================
describe('🚨 typing in the inspector does not delete what you are editing', () => {
  // -------------------------------------------------------------------------
  // The engine's keyboard handler is bound to `window`, so it saw every
  // keystroke in the application -- including the ones typed into its own
  // inspector. Backspace is how a person clears a number field, and Backspace
  // here DELETED THE SELECTED OBJECT. So the documented way to resize a tree
  //
  //     select the tree -> click "Canopy width" -> Backspace to clear it
  //
  // deleted the tree. It is the owner's own acceptance path: "click site ->
  // actual tree appears -> change height -> change canopy width".
  //
  // The same keystroke deletes a selected roof SECTION and a selected panel.
  // DesignStudio's handler has guarded this since v31.1; the engine's -- which
  // is the one that owns the inspector -- never did.
  // -------------------------------------------------------------------------

  it('🚨 the handler ignores keystrokes aimed at a text field', () => {
    expect(ENGINE).toMatch(/function keyEventIsTyping\(e: KeyboardEvent\): boolean/);
    expect(ENGINE).toMatch(/tag === 'input' \|\| tag === 'textarea' \|\| tag === 'select'/);
    expect(ENGINE).toMatch(/isContentEditable === true/);
  });

  it('🚨 ...and it is the FIRST thing the handler does', () => {
    // A guard placed after the delete branch is not a guard.
    const at = ENGINE.indexOf('function setupKeyboardHandler()');
    expect(at, 'the keyboard handler is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, at + 1200);
    expect(body.length).toBeGreaterThan(600);
    const guardAt = body.indexOf('if (keyEventIsTyping(e)) return;');
    const deleteAt = body.indexOf("e.key === 'Backspace'");
    expect(guardAt, 'the typing guard is missing from the handler').toBeGreaterThan(-1);
    expect(deleteAt, 'the delete branch is gone').toBeGreaterThan(-1);
    expect(guardAt, 'the delete branch runs before the typing guard').toBeLessThan(deleteAt);
  });

  it('the inspector really does contain the number fields this protects', () => {
    // If the inspector stopped having inputs the guard would be guarding
    // nothing, and this test would be the one that still passed.
    //
    // The ids are passed to the shared `num()` helper rather than written into
    // the JSX, so this asserts both halves: the call sites and the attribute.
    expect(ENGINE).toMatch(/'obstruction-canopy'/);
    expect(ENGINE).toMatch(/'obstruction-height'/);
    expect(ENGINE).toMatch(/data-testid=\{testId\}/);
    expect(ENGINE).toMatch(/type="number" data-no-drag/);
  });
});
