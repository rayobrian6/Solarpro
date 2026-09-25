/**
 * tests/duplicateSiteObject.test.ts
 *
 * A ROOF HAS FOURTEEN IDENTICAL VENTS.
 *
 * Placing each one meant re-arming the tool, re-aiming, and re-typing the
 * dimensions — every time, for an object the installer had already fully
 * described once. Both competitors solved this and converged on it
 * independently: OpenSolar puts a Duplicate button on the selected object
 * ("there's a couple of them there, so I'm just going to click the duplicate
 * button", XxbekUwu_nQ @03:43), Aurora uses Ctrl+C / Ctrl+V on an obstruction
 * it has already traced (EJT1_haxY2M @00:30). SolarPro had neither.
 *
 * Two invariants:
 *
 * 1. 🚨 ONE COMMIT PATH. Duplicate needs every line of what placement does —
 *    draw through `drawObstructionEntity` (a second draw path is how a tree
 *    once looked like a vent until reload), append to the ref AND the state,
 *    cull the panels underneath, and snapshot BEFORE culling or a mis-placed
 *    vent costs the array for good. Copying those lines into a second handler
 *    creates a path that drifts, which this file has recorded against itself
 *    more than once. So the tail was EXTRACTED, not duplicated.
 *
 * 2. 🚨 IT COPIES THE RECORD, NOT THE SCREEN. Every canonical field comes from
 *    the source object — type, all three dimensions, canopy radius, the face
 *    it is bound to — so the copy is the same OBJECT, not a similar-looking
 *    one. Only the id and the position may differ.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const SRC = stripComments(
  readFileSync(join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);

function fn(name: string): string {
  const i = SRC.indexOf(`function ${name}(`);
  expect(i, `${name} was not found`).toBeGreaterThan(-1);
  const next = SRC.indexOf('\n  function ', i + 10);
  return SRC.slice(i, next > i ? next : i + 5_000);
}

describe('🚨 there is ONE commit path for a site object', () => {
  const commit = fn('commitPlacedObstruction');

  it('the shared commit exists and does the whole job', () => {
    expect(commit).toMatch(/drawObstructionEntity\(viewer, C, obs\)/);
    expect(commit, 'the ref is what the mount-frozen handlers read')
      .toMatch(/obstructionsRef\.current = updatedObs/);
    expect(commit, 'the state is what the inspector renders from')
      .toMatch(/setObstructions\(updatedObs\)/);
    // 🚨 THE CLEARANCE-AWARE AUTHORITY. This asserted
    // `removeObstructedPanels` — the centre-point test — which accepted any
    // module whose centre cleared the bare footprint by 1 mm and so left panels
    // lying across a chimney flue. See tests/panelKeepOutIsTheOneFilter.test.ts.
    expect(commit).toMatch(/filterPanelsByKeepOut\(panelsRef\.current, \[obs\]\)/);
  });

  it('🚨 it snapshots BEFORE culling panels, or the array is lost for good', () => {
    const cull = commit.indexOf('lastRenderedPanelsRef.current = filtered');
    const snap = commit.indexOf('onPanelsAboutToBeCulled?.');
    expect(snap, 'no undo snapshot before the cull').toBeGreaterThan(-1);
    expect(snap, 'the snapshot must precede the cull').toBeLessThan(cull);
  });

  it('placement calls the shared commit instead of inlining it', () => {
    const place = fn('handleObstructionClick');
    expect(place).toMatch(/commitPlacedObstruction\(viewer, C, newObs, preset\)/);
    // The extracted lines must be GONE from the caller, or there are two paths.
    expect(place, 'the commit was copied, not extracted')
      .not.toMatch(/filterPanelsByKeepOut\(panelsRef\.current/);
    expect(place).not.toMatch(/setObstructions\(updatedObs\)/);
  });

  it('duplicate calls the SAME shared commit', () => {
    expect(fn('duplicateSelectedObstruction')).toMatch(/commitPlacedObstruction\(viewer, C, copy, preset/);
  });

  it('nothing else in the engine draws a site object independently', () => {
    // drawObstructionEntity may be called from the commit, from a redraw and
    // from restore — but never from a third ad-hoc placement path.
    const calls = (SRC.match(/drawObstructionEntity\(/g) || []).length;
    expect(calls, 'an unexpected number of draw sites — check for a new path')
      .toBeLessThanOrEqual(6);
  });
});

describe('the copy is the same object, not a similar-looking one', () => {
  const dup = fn('duplicateSelectedObstruction');

  it('it spreads the source record rather than rebuilding fields', () => {
    // A hand-listed field set silently drops whatever is added to
    // PlacedObstruction later — clearance, canopy radius, the bound face.
    expect(dup, 'the copy must inherit every canonical field').toMatch(/\.\.\.src,/);
  });

  it('only the id and the position differ', () => {
    const i = dup.indexOf('...src,');
    const lit = dup.slice(i, dup.indexOf('};', i));
    const keys = [...lit.matchAll(/^\s*([a-zA-Z]+):/gm)].map(m => m[1]);
    expect(keys.sort(), 'a duplicate that changes anything else is not a duplicate')
      .toEqual(['id', 'lng']);
  });

  it('it resolves the preset from the SOURCE type, not the armed tool', () => {
    // Duplicating a vent while the Tree tool happens to be armed must produce
    // a vent. The armed preset is irrelevant here.
    expect(dup).toMatch(/presetFor\(\(src\.type as string\)/);
    expect(dup).not.toMatch(/obstructionPresetRef/);
  });

  it('the offset is metric, converted at this latitude', () => {
    // A fixed degree offset is a different distance in Illinois than in
    // Arizona, and a copy that lands 30 m away is not "beside" anything.
    expect(dup).toMatch(/111_320 \* Math\.cos\(\(src\.lat \* Math\.PI\) \/ 180\)/);
    expect(dup, 'the step must scale with the object, with a floor')
      .toMatch(/Math\.max\(1\.0, \(src\.widthM \?\? 1\) \* 1\.4\)/);
  });

  it('it never divides by a degenerate metres-per-degree', () => {
    expect(dup).toMatch(/mPerDegLng > 1 \? stepM \/ mPerDegLng : 0/);
  });

  it('🚨 the COPY becomes the selection, in both the ref and the state', () => {
    // The next thing a person does is move the new one. Leaving the original
    // selected means the following edit changes the wrong object.
    expect(dup).toMatch(/selectedObstructionIdRef\.current = copy\.id/);
    expect(dup).toMatch(/setSelectedObstructionId\(copy\.id\)/);
  });

  it('it refuses politely when nothing is selected', () => {
    expect(dup).toMatch(/if \(!viewer \|\| !C \|\| !id\) return;/);
    expect(dup, 'and when the id no longer resolves to a record')
      .toMatch(/if \(!src\) return;/);
  });
});

describe('it is reachable by button and by keyboard', () => {
  it('the inspector offers it, above Delete', () => {
    expect(SRC).toMatch(/data-testid="obstruction-duplicate"/);
    const dupAt = SRC.indexOf('data-testid="obstruction-duplicate"');
    const delAt = SRC.indexOf('data-testid="obstruction-delete"');
    expect(dupAt).toBeGreaterThan(-1);
    expect(delAt).toBeGreaterThan(-1);
    expect(dupAt, 'the destructive control must not be the one muscle memory finds')
      .toBeLessThan(delAt);
  });

  it('Ctrl+D duplicates, and only with something selected', () => {
    const i = SRC.indexOf("e.key.toLowerCase() === 'd'");
    expect(i, 'the Ctrl+D binding was not found').toBeGreaterThan(-1);
    const branch = SRC.slice(Math.max(0, i - 200), i + 300);
    expect(branch).toMatch(/e\.ctrlKey \|\| e\.metaKey/);
    expect(branch, 'it must not fire on a bare D, which arms nothing')
      .toMatch(/!e\.altKey && !e\.shiftKey/);
    expect(branch, 'it must read the LIVE selection ref, not frozen state')
      .toMatch(/selectedObstructionIdRef\.current/);
    expect(branch).toMatch(/duplicateSelectedObstructionRef\.current\?\.\(\)/);
  });

  it('the keyboard route goes through a ref, because the handler is mount-frozen', () => {
    expect(SRC).toMatch(/const duplicateSelectedObstructionRef = useRef<\(\(\) => void\) \| null>\(null\)/);
    expect(SRC).toMatch(/duplicateSelectedObstructionRef\.current = duplicateSelectedObstruction;/);
  });

  it('Ctrl+D never fires while the user is typing', () => {
    const typing = SRC.indexOf('keyEventIsTyping(e)');
    const ctrlD = SRC.indexOf("e.key.toLowerCase() === 'd'");
    expect(typing).toBeGreaterThan(-1);
    expect(typing, 'the typing guard must come first').toBeLessThan(ctrlD);
  });
});
