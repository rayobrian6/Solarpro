/**
 * tests/panelPickResolvesGlass.test.ts
 *
 * A CLICK ON A MODULE IS A CLICK ON THAT MODULE — INCLUDING ITS GLASS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, AND WHY THE FIRST FIX MISSED IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Measured, twice, by e2e/roof-face-selection.spec.ts:
 *
 *     "a panel click still selected the roof face behind the module"
 *
 * The first repair raised the drill-pick depth from 10 to 32, on the reasoning
 * that in Building mode a screen point sits over a roof polygon, its texture,
 * its outline, its glow, a wall and the module — so the module could fall past
 * the tenth hit. That reasoning was plausible and the failure survived it,
 * because DEPTH WAS NEVER THE CAUSE.
 *
 * A module is drawn as THREE entity families:
 *
 *     [PANEL] <id>          the frame box    -> panelMapRef key `<id>`
 *     [PANEL-GLASS] <id>    the glass        -> key `<id>__glass`
 *     [PANEL-GRID] <id> …   the cell lines   -> key `<id>__grid__<n>`
 *
 * and the matcher was `const isPanelId = (id) => !id.includes('__')`. The glass
 * is the TOP SURFACE — it is what a click in the middle of a module actually
 * hits — and its key contains `__`, so it was discarded. The hit was in the
 * drill list the whole time and was being thrown away; walking further only
 * threw away more of them, and the roof polygon behind eventually answered.
 *
 * Consequence, with Building on: every module was unselectable, undeletable and
 * unmovable, and WHICH OBJECT A CLICK REACHED DEPENDED ON A VIEW TOGGLE.
 *
 * 🚨 WHY THIS IS A SOURCE GUARD. The pick needs a live Cesium scene, which no
 * unit test here has. What CAN be pinned without one is the correspondence
 * between the names the renderer writes and the pattern the picker reads —
 * which is exactly where the two had drifted apart. The behavioural proof is
 * the E2E above; this is what stops the two halves silently parting again.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ENGINE = fs.readFileSync(
  path.join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');

/** Strip comments so a guard cannot be satisfied by prose describing itself. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const CODE = strip(ENGINE);

/** The body of a named function declaration, up to the next one. */
function bodyOf(src: string, decl: string): string {
  const i = src.indexOf(decl);
  if (i < 0) return '';
  const next = src.indexOf('\n  function ', i + decl.length);
  return src.slice(i, next > 0 ? next : i + 6000);
}

// The pattern the picker uses, lifted from the source so the test cannot drift
// from it silently — if someone edits the regex, this test reads the new one
// and the naming assertions below re-check it against the real names.
const PATTERN_SRC = (() => {
  const m = /const PANEL_NAME = (\/[^\n]+\/);/.exec(CODE);
  expect(m, 'the picker no longer declares PANEL_NAME').toBeTruthy();
  return m![1];
})();
// eslint-disable-next-line no-eval
const PANEL_NAME: RegExp = eval(PATTERN_SRC);

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the renderer draws three families, and all three are one module', () => {
  it('the names the renderer writes are what this test believes they are', () => {
    // Positive controls: if the renderer renames a family, these fail FIRST and
    // point at the rename, instead of the pattern quietly stopping to match.
    expect(CODE).toContain('name: `[PANEL] ${panel.id}`');
    expect(CODE).toContain('name: `[PANEL-GLASS] ${panel.id}`');
    expect(CODE).toMatch(/name: `\[PANEL-GRID\] \$\{panel\.id\}/);
  });

  it('…and the three keys they are stored under are what they were', () => {
    expect(CODE).toContain('panelMapRef.current.set(panel.id, frameEntity)');
    expect(CODE).toContain('panelMapRef.current.set(`${panel.id}__glass`, glassEntity)');
    expect(CODE).toMatch(/panelMapRef\.current\.set\(`\$\{panel\.id\}__grid__\$\{i\}`/);
  });

  it('🚨 the picker resolves EVERY one of them to the same module id', () => {
    const id = 'c0ffee00-1111-4222-8333-444444444444';
    for (const name of [
      `[PANEL] ${id}`,
      `[PANEL-GLASS] ${id}`,
      `[PANEL-GRID] ${id} v3`,
      `[PANEL-GRID] ${id} h7`,
    ]) {
      const m = PANEL_NAME.exec(name);
      expect(m, `the picker does not recognise "${name}"`).toBeTruthy();
      expect(m![1], `"${name}" resolved to the wrong module`).toBe(id);
    }
  });

  it('🚨 MUTATION PROOF — the OLD rule discards the glass and the grid', () => {
    // This is the discarded rule, restored, so the defect is demonstrated
    // rather than described. The frame survives it; the two surfaces a person
    // actually clicks do not.
    const oldIsPanelId = (key: string) => !key.includes('__');
    const id = 'c0ffee00-1111-4222-8333-444444444444';
    expect(oldIsPanelId(id)).toBe(true);                      // the frame, behind
    expect(oldIsPanelId(`${id}__glass`)).toBe(false);         // the top surface
    expect(oldIsPanelId(`${id}__grid__0`)).toBe(false);       // the cell lines
  });

  it('it does NOT claim the fence furniture, which is not a module', () => {
    // These keys start with the separator and belong to no panel. They carry
    // their own names and are not in the [PANEL*] families at all — which is
    // why matching on the NAME is a statement of the rule, not a loosening.
    for (const name of [
      '[BUILD3D-ROOF] plane-7',
      '[BUILD3D-WALL] plane-7#2',
      '[PLANE3D-FILL] plane-7',
      'Building Block',
      '',
    ]) {
      expect(PANEL_NAME.exec(name), `"${name}" was mistaken for a module`).toBeNull();
    }
    expect(CODE).toMatch(/__fencepost__/);   // positive control: they do exist
    expect(CODE).toMatch(/__gate__/);
  });
});

describe('🚨 the picker uses it, and hands back the FRAME', () => {
  const fn = bodyOf(CODE, 'function pickPanelAtScreen(');

  it('the name match runs on every drilled hit', () => {
    expect(fn).toMatch(/const named = panelIdFromEntity\(entity\)/);
    expect(fn).toMatch(/drillPick\(screenPos, 32\)/);
  });

  it('…and on the single-pick fallback too, or the catch branch keeps the bug', () => {
    expect(fn).toMatch(/const named = panelIdFromEntity\(picked\.id\)/);
  });

  it('🚨 the entity returned is the module`s FRAME, not whichever surface was hit', () => {
    // Callers highlight and MOVE `foundEntity`. Handing back the glass would
    // leave the frame standing where it was.
    expect((fn.match(/foundEntity = panelMapRef\.current\.get\(named\) \?\? /g) ?? []).length)
      .toBe(2);
  });

  it('the map remains the authority on what exists', () => {
    // A name is a claim. An entity whose id is not in the map is not a module
    // this engine is tracking, and selecting it would hand a caller an id that
    // resolves to nothing.
    expect(fn).toMatch(/panelMapRef\.current\.has\(id\) \? id : null/);
  });
});
