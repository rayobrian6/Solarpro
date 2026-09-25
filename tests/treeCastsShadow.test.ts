/**
 * tests/treeCastsShadow.test.ts
 *
 * THE TREE SHADED THE ARRAY IN THE ARITHMETIC AND NOT IN THE PICTURE.
 *
 * 🚨 REPORTED FROM LIVE USE, AFTER THE NUMBERS HAD ALREADY BEEN "PROVEN".
 *
 * A browser test had shown the full chain working numerically — clear roof
 * 1.000, a tall tree 10 m south dropping the nearest module to 0.894, removal
 * restoring 1.000. All true, and all beside the point: with Shade mode on, a
 * 14 m tree standing next to the house at 09:00 cast no visible shadow at all.
 * The user has no way to check a derate. What they can check is whether the
 * shadow falls on the roof, and there was nothing there to see.
 *
 * The cause was one absent key. Cesium's GeometryUpdater defaults entity
 * graphics to `ShadowMode.DISABLED`, so geometry that does not ASK to cast
 * silently does not — no warning, no visual difference except the missing
 * shadow. Every neighbouring piece of the system was already correct, which is
 * exactly what made it invisible:
 *
 *   - the shadow map is switched on with Shade mode
 *   - the clock is driven from the same solar-time slider the numbers use
 *   - the house walls, the roof and the panel frames all declare ENABLED and
 *     had been casting correctly the whole time
 *
 * So the tree was the ONLY thing in the scene that shaded the array
 * arithmetically while contributing nothing to the image.
 *
 * This file guards the repair and — more importantly — the property that makes
 * the repair honest: the shadow and the shade number come from ONE geometry.
 * A drawn shadow sourced from anything other than the canopy the analysis
 * occludes with would be a decoration that happens to look like evidence, and
 * that is worse than no shadow, because the user would believe it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { canopyRadiusFor } from '../lib/3d/obstructionGeometry';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(
  readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'),
);
const SHADE_SCENE = stripComments(
  readFileSync(join(ROOT, 'lib', 'shade', 'canonicalShadeScene.ts'), 'utf8'),
);

/** The body of drawObstructionEntity, where all three graphics are built. */
function drawBody(): string {
  const i = ENGINE.indexOf('function drawObstructionEntity(');
  expect(i, 'drawObstructionEntity is gone').toBeGreaterThan(-1);
  const end = ENGINE.indexOf('\n  }', i);
  expect(end).toBeGreaterThan(i);
  return ENGINE.slice(i, end);
}

describe('🚨 a placed object casts a shadow', () => {
  const B = drawBody();

  it('all three graphics kinds declare ENABLED', () => {
    // prism (chimney, vent, skylight), cylinder (trunk), ellipsoid (canopy).
    // Cesium's default is DISABLED, so the absence of this key IS the defect —
    // there is no "unset but working" state to fall back on.
    const n = (B.match(/shadows: C\.ShadowMode\.ENABLED/g) || []).length;
    expect(n, `only ${n} of the 3 object graphics ask to cast a shadow`).toBe(3);
  });

  it('and none of them opted out', () => {
    expect(B, 'an object was explicitly set not to cast')
      .not.toMatch(/shadows: C\.ShadowMode\.DISABLED/);
  });

  it('the shadow map follows Shade mode', () => {
    // Casting is necessary but not sufficient: with no shadow map there is
    // nothing to cast into. Both halves are required and either alone renders
    // nothing, which is why this is asserted next to the cast flags.
    expect(ENGINE).toMatch(/viewer\.scene\.shadowMap\.enabled = shadeOn;/);
  });

  it('the house still casts too — the repair must not have traded one for another', () => {
    const enabled = (ENGINE.match(/shadows:\s*C\.ShadowMode\.ENABLED/g) || []).length;
    expect(enabled, 'fewer casters than the walls + roof + panel frames + 3 object kinds')
      .toBeGreaterThanOrEqual(6);
  });
});

describe('🚨 the picture and the number come from ONE canopy', () => {
  it('the renderer takes the canopy radius from the shared authority', () => {
    expect(ENGINE).toMatch(/import \{ buildObstructionGeometry, canopyRadiusFor \} from '@\/lib\/3d\/obstructionGeometry'/);
  });

  it('the record is stamped with that same radius at placement', () => {
    expect(ENGINE).toMatch(/canopyRadiusM: preset\.space === 'site' \? canopyRadiusFor\(widthM, depthM\) : undefined/);
  });

  it('and the shade scene occludes with the radius off that record', () => {
    // 🚨 THE ARCHITECTURAL RULE. There must never be a shadow-only tree
    // dimension: if the analysis read its own canopy size, the shadow on screen
    // and the loss in the proposal would drift apart silently, and the drawing
    // would be the more convincing of the two.
    expect(SHADE_SCENE).toMatch(/canopyRadiusM/);
    expect(SHADE_SCENE).toMatch(/Number\.isFinite\(o\?\.canopyRadiusM\) && o\.canopyRadiusM > 0 \? o\.canopyRadiusM/);
  });

  it('the shared function is real arithmetic, not a constant', () => {
    // Guards against the authority being hollowed out into a fixed value, which
    // would make every tree the same size in both consumers and still pass the
    // structural assertions above.
    expect(canopyRadiusFor(6, 6)).toBeCloseTo(3, 6);
    expect(canopyRadiusFor(12, 12)).toBeCloseTo(6, 6);
    expect(canopyRadiusFor(12, 12)).toBeGreaterThan(canopyRadiusFor(6, 6));
  });
});

describe('🚨 the number keeps up with the tree', () => {
  it('shade re-runs when the objects change, not only when the layer is switched on', () => {
    // Before this, the analysis ran in exactly one place — the instant Shade
    // was toggled ON. Planting, resizing, moving or deleting a tree while Shade
    // was already on left the derate and the production estimate frozen at
    // whatever the last toggle produced, with nothing on screen saying so.
    const i = ENGINE.indexOf('if (!showShadeLocal) return;');
    expect(i, 'the obstruction-driven shade refresh is gone').toBeGreaterThan(-1);
    const region = ENGINE.slice(i, i + 400);
    expect(region).toMatch(/onRunShadeAnalysis\?\.\(\);/);
    expect(region, 'the effect must watch the obstructions')
      .toMatch(/\[obstructions, showShadeLocal, stage\]/);
  });

  it('it does NOT watch panels, or it would re-trigger on its own output', () => {
    // runShadeAnalysis writes annualShadeFactor back onto the panels. Watching
    // panels here would spin forever, and the loop would look like slowness
    // rather than like a bug.
    const i = ENGINE.indexOf('if (!showShadeLocal) return;');
    const region = ENGINE.slice(i, i + 400);
    expect(region).not.toMatch(/\bpanels\b/);
  });
});

describe('a live gesture owns the status line', () => {
  it('the hover readout yields while a tool owns the pointer', () => {
    // 🚨 THE SIZE FEEDBACK EXISTED AND WAS INVISIBLE. A second
    // ScreenSpaceEventHandler on the same canvas wrote a lat/lng readout on
    // every MOUSE_MOVE, overwriting "🌳 Tree — 9.2 m across. Release to place."
    // as fast as the drag could set it. The installer dragging a canopy out had
    // no number to check the gesture against — which is how "the dimensions do
    // not match the gesture" gets reported about code that computes them
    // correctly.
    const i = ENGINE.indexOf('setStatusMsg(`📍 ');
    expect(i, 'the coordinate readout is gone').toBeGreaterThan(-1);
    const start = ENGINE.lastIndexOf('handler.setInputAction((event: any) => {', i);
    const region = ENGINE.slice(start, i);
    expect(region, 'the passive readout no longer yields to a live gesture')
      .toMatch(/if \(pointerOwnerRef\.current\) return;/);
  });
});
