/**
 * tests/toolStateAuthority.test.ts
 *
 * THE BUTTON A PERSON PRESSES IS THE TOOL THAT STAYS ARMED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIVE FAILURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I tested the Tree tool. When I click Tree, the UI immediately reverts to
 *    Obstruction. I never actually enter a persistent Tree-placement state, so
 *    I cannot place a tree at all."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WAS, AND WHY IT IS THE SAME MISTAKE TWICE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The first Tree tool placed a decorative sphere that no array recorded — no
 * canonical object, no persistence, no shade. Pointing it at the real object
 * was done by having `activateTool('tree')` switch the placement mode to
 * `obstruction` and set a type preset. The palette highlight follows the MODE,
 * so the Tree button went dark the instant it was pressed and the Obstruction
 * button lit instead.
 *
 * 🚨 BOTH REPORTS ARE ONE DEFECT IN TWO PLACES: THE TOOL STATE CARRIED THE
 * PLACEMENT CATEGORY AND LOST THE OBJECT TYPE. They are two facts. Sharing the
 * placement machinery is fine and correct — a tree and a chimney are both
 * canonical site objects written by one path. Collapsing the user-facing tool
 * state into the category is not.
 *
 * So `tree` is a placement mode of its own, dispatched to the same canonical
 * placement, and the two halves of "what is armed" — the mode and the type —
 * are moved together by whichever control the user touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE SOURCE GUARDS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The tool state lives in `placementMode`, which is a PROP of SolarEngine3D
 * owned by DesignStudio, driven through `onPlacementModeChange`. Mounting the
 * engine needs Cesium and a WebGL context, so the browser spec in
 * e2e/ is where the live gesture is proven; these pin the wiring that makes it
 * possible, including the exact line whose removal reintroduces the bug.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OBSTRUCTION_PRESETS, presetFor, DEFAULT_OBSTRUCTION_PRESET } from '@/lib/3d/obstructionPresets';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));

/** The body of `activateTool`, which is where a tool is armed. */
function activateToolBody(): string {
  const at = ENGINE.indexOf('const activateTool = (mode: PlacementMode) => {');
  expect(at, 'activateTool is gone').toBeGreaterThan(-1);
  return ENGINE.slice(at, ENGINE.indexOf('type ToolDef', at));
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 choosing Tree leaves Tree armed', () => {
  it('activateTool does NOT redirect the tree tool to another mode', () => {
    // 🚨 THE EXACT LINE THAT CAUSED IT. `onPlacementModeChange('obstruction')`
    // inside the tree branch is what made the palette revert the instant the
    // button was pressed. Its absence is the fix.
    const body = activateToolBody();
    const treeAt = body.indexOf("if (mode === 'tree') {");
    expect(treeAt, 'the tree branch is gone').toBeGreaterThan(-1);
    // 🚨 THE WINDOW ENDS AT THE NEXT BRANCH, NOT AT THE NEXT CLOSING BRACE.
    // A first version cut at the first `}` after the status message — and that
    // message contains a unicode escape whose own syntax includes a closing
    // brace. The slice was a few characters long, so the mutation proof PASSED
    // with the defect restored: a test that could not see the code, which is
    // the failure mode this whole file exists to catch in the product.
    const endAt = body.indexOf("if (mode === 'obstruction'", treeAt);
    expect(endAt, 'the window has nothing to close on').toBeGreaterThan(treeAt);
    const treeBranch = body.slice(treeAt, endAt);
    expect(treeBranch, 'the window does not cover the branch').toMatch(/setStatusMsg/);
    expect(treeBranch, 'the tree tool still switches the mode away from itself')
      .not.toMatch(/onPlacementModeChange/);
  });

  it('…and it arms the tree TYPE, so the click knows what to build', () => {
    const body = activateToolBody();
    expect(body).toMatch(/obstructionPresetRef\.current = 'tree'/);
    expect(body).toMatch(/setObstructionPresetId\('tree'\)/);
  });

  it('a tree click goes through the CANONICAL placement, not the decorative one', () => {
    // `handleTreeClick` adds two Cesium entities and writes no record. Nothing
    // may route to it again.
    expect(ENGINE).toMatch(/else if \(mode === 'tree'\)\s+handleObstructionClick\(viewer, C, screenPos\)/);
    expect(ENGINE).not.toMatch(/else if \(mode === 'tree'\)\s+handleTreeClick/);
  });

  it('the placement panel and the status bar belong to BOTH modes', () => {
    // Arming Tree must not leave the user looking at a blank right-hand side.
    expect(ENGINE).toMatch(/placementMode === 'obstruction' \|\| placementMode === 'tree' \?/);
    expect((ENGINE.match(/placementMode === 'obstruction' \|\| placementMode === 'tree'/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('🚨 the panel names the ARMED OBJECT, not the category', () => {
    // "Add Obstruction" over a queued tree is the same lie the mode was telling.
    expect(ENGINE).toMatch(/Place \{presetFor\(obstructionPresetId\)\.label\}/);
    expect(ENGINE).not.toMatch(/>\s*Add Obstruction\s*</);
  });
});

describe('🚨 the two halves of "what is armed" move together', () => {
  it('picking a type in the panel moves the TOOL as well', () => {
    // Two places each holding half of "what is armed" is how the palette came
    // to show Obstruction while a tree was queued.
    expect(ENGINE).toMatch(/const wantMode: PlacementMode = pr\.id === 'tree' \? 'tree' : 'obstruction'/);
    expect(ENGINE).toMatch(/if \(placementMode !== wantMode\) onPlacementModeChange\(wantMode\)/);
  });

  it('…and returning to the generic Obstruction tool drops the tree TYPE', () => {
    // Otherwise the next click places a 6 m tree where a vent was wanted.
    const body = activateToolBody();
    expect(body).toMatch(/if \(mode === 'obstruction' && obstructionPresetRef\.current === 'tree'\)/);
    expect(body).toMatch(/obstructionPresetRef\.current = DEFAULT_OBSTRUCTION_PRESET/);
  });

  it('every preset is reachable and distinct — this is not a Tree-only patch', () => {
    // The owner asked explicitly: prove Vent, Chimney and Skylight each stay
    // armed too. They share one control, so what has to be distinct is the
    // TYPE each one arms and the object it builds.
    const ids = OBSTRUCTION_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['vent', 'vent_pipe', 'plumbing_stack', 'chimney', 'skylight', 'roof_hatch', 'hvac', 'tree']) {
      expect(ids, `${id} is not offered`).toContain(id);
      expect(presetFor(id).id).toBe(id);
    }
    // 🚨 THE CHIPS ARE GENERATED FROM THE LIST, which is why adding a type
    // cannot leave a control behind — and why this asserts the generator rather
    // than eight literals that would rot.
    expect(ENGINE).toMatch(/OBSTRUCTION_PRESETS\.map\(pr =>/);
    expect(ENGINE).toMatch(/data-testid=\{`obstruction-preset-\$\{pr\.id\}`\}/);
    // The record stamps the ARMED type, whatever it is.
    expect(ENGINE).toMatch(/const preset = presetFor\(obstructionPresetRef\.current\)/);
    expect(ENGINE).toMatch(/type:\s+preset\.id,/);
  });

  it('a tree and a roof object are built as different KINDS of thing', () => {
    // Shared machinery, distinct objects: one shades, the other occupies.
    expect(presetFor('tree').space).toBe('site');
    for (const id of ['vent', 'chimney', 'skylight', 'roof_hatch', 'hvac']) {
      expect(presetFor(id).space, `${id} is not a roof object`).toBe('roof');
    }
    expect(ENGINE).toMatch(/space:\s+preset\.space,/);
    expect(ENGINE).toMatch(/canopyRadiusM: preset\.space === 'site'/);
  });

  it('the default type is a roof object, so the generic tool is not a tree', () => {
    expect(presetFor(DEFAULT_OBSTRUCTION_PRESET).space).toBe('roof');
  });
});

describe('🚨 the tree that is placed is the tree Shade reads', () => {
  it('placement writes the canonical fields the shade scene consumes', () => {
    // Placement, persistence, deletion, undo and shade all read one record.
    // A green icon that feeds nothing is what the first Tree tool was.
    for (const field of ['canopyRadiusM', 'heightM', 'space']) {
      expect(ENGINE, `${field} is not written at placement`).toContain(field);
    }
    const scene = strip(read('lib/shade/canonicalShadeScene.ts'));
    expect(scene).toMatch(/o\.type === 'tree' \|\| o\.space === 'site'/);
    expect(scene).toMatch(/canopyRadiusM/);
  });
});
