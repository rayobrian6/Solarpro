/**
 * tests/liveEdgeDimensions.test.ts
 *
 * THE LENGTH, DRAWN ON THE EDGE IT MEASURES.
 *
 * Aurora prints every edge length on the geometry itself while a structure is
 * selected — 36.0 ft, 17.6 ft, drawn along the edge — and drops them the
 * instant it is deselected, so the canvas declutters itself and nobody has to
 * find a "show dimensions" preference. SolarPro drew no dimension anywhere:
 * the lengths existed, but only as a number in a panel, for ONE edge at a
 * time, after clicking that edge.
 *
 * Two invariants this file exists for:
 *
 * 1. 🚨 THE NUMBER HAS ONE SOURCE. `measureWall` (lib/3d/sectionEditing.ts)
 *    already owns "how long is that edge", including rake and which pad the
 *    face stands on. A length computed in the renderer or in the sync function
 *    would be a SECOND answer, and the inspector and the canvas would
 *    eventually disagree in front of a customer.
 *
 * 2. 🚨 IT IS TIED TO SELECTION. Drawing every edge of every face all the time
 *    is unreadable on a fourteen-face roof, and it is the viewport clutter
 *    that was explicitly ruled out.
 *
 * And one hazard: the labels must be REBUILT when the geometry changes. A
 * label still reading the pre-edit length is worse than no label — it is a
 * measurement the user will believe.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const ENGINE = stripComments(readFileSync(join(ROOT, 'components', '3d', 'SolarEngine3D.tsx'), 'utf8'));
const RENDERER = stripComments(readFileSync(join(ROOT, 'components', '3d', 'measure', 'measurements.tsx'), 'utf8'));

function fn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  expect(i, `${name} was not found`).toBeGreaterThan(-1);
  // To the next top-level function declaration, which is enough scope here.
  const next = src.indexOf('\n  function ', i + 10);
  return src.slice(i, next > i ? next : i + 4_000);
}

describe('the renderer draws, it does not measure', () => {
  it('renderEdgeDimension exists and takes a finished string', () => {
    expect(RENDERER).toMatch(/export function renderEdgeDimension\(/);
    const f = RENDERER.slice(RENDERER.indexOf('export function renderEdgeDimension('));
    expect(f, 'the caller supplies the text').toMatch(/text: string/);
  });

  it('🚨 it computes no length of its own', () => {
    const i = RENDERER.indexOf('export function renderEdgeDimension(');
    const f = RENDERER.slice(i);
    // Distance maths in a renderer is a second measurement authority.
    expect(f).not.toMatch(/Math\.hypot/);
    expect(f).not.toMatch(/Cartesian3\.distance/);
    expect(f).not.toMatch(/mPerDeg/);
  });

  it('it reuses this module\'s teardown shape, so nothing is orphaned', () => {
    const i = RENDERER.indexOf('export function renderEdgeDimension(');
    const f = RENDERER.slice(i);
    expect(f, 'it must return the shared bundle shape').toMatch(/MeasurementEntityBundle \| null/);
    expect(f, 'and clean up after itself on failure').toMatch(/removeMeasurementBundle\(viewer,/);
    // removeMeasurementBundle iterates polyline/dotA/dotB/label, so the bundle
    // must name all four keys or the extras leak.
    expect(f).toMatch(/dotA: null, dotB: null/);
  });

  it('it tags its entities so they are identifiable in the scene', () => {
    const i = RENDERER.indexOf('export function renderEdgeDimension(');
    const f = RENDERER.slice(i);
    expect(f).toMatch(/name: `\[DIM\] \$\{tag\}`/);
  });
});

describe('the engine feeds it from the canonical measurement', () => {
  const sync = fn(ENGINE, 'syncFaceDimensions');

  it('🚨 every label comes from measureWall, not from local arithmetic', () => {
    expect(sync).toMatch(/measureWall\(planes, wallId\(faceId, i\)/);
    expect(sync, 'the display rounding is the inspector\'s, not a new one')
      .toMatch(/ftStr1\(w\.lengthM\)/);
    expect(sync, 'no second length computation').not.toMatch(/Math\.hypot/);
  });

  it('it refuses an edge the authority could not measure', () => {
    expect(sync).toMatch(/if \(!w\.found \|\| !isFinite\(w\.lengthM\)/);
  });

  it('it drops degenerate slivers rather than printing 0.0 ft on them', () => {
    expect(sync).toMatch(/w\.lengthM < 0\.3/);
  });

  it('it reads the LIVE planes ref, not a frozen render value', () => {
    // syncFaceDimensions is called from an effect, but the roof planes it
    // measures must be the current ones.
    expect(sync).toMatch(/roofPlanesRef\.current/);
  });

  it('it clears the previous labels before drawing, every time', () => {
    expect(sync).toMatch(/clearFaceDimensions\(\)/);
    const clear = fn(ENGINE, 'clearFaceDimensions');
    expect(clear).toMatch(/removeMeasurementBundle\(viewer, b\)/);
    expect(clear, 'the ref must be emptied or the bundles leak')
      .toMatch(/faceDimensionsRef\.current = \[\]/);
  });

  it('a null face clears and draws nothing — deselect means gone', () => {
    expect(sync).toMatch(/if \(!viewer \|\| !C \|\| !faceId\)/);
    // The clear happens BEFORE that early return, or deselecting would leave
    // the last face's labels on screen for ever.
    const clearAt = sync.indexOf('clearFaceDimensions()');
    const guardAt = sync.indexOf('if (!viewer || !C || !faceId)');
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt, 'clear must run before the early return').toBeLessThan(guardAt);
  });
});

describe('the labels follow the selection AND the geometry', () => {
  it('the effect is keyed on the selected face', () => {
    expect(ENGINE).toMatch(/syncFaceDimensions\(activeFaceId\);/);
  });

  it('🚨 and on roofPlanes, or an edited edge keeps its old number', () => {
    const i = ENGINE.indexOf('syncFaceDimensions(activeFaceId);');
    expect(i).toBeGreaterThan(-1);
    const deps = ENGINE.slice(i, i + 220);
    expect(deps, 'a label reading the pre-edit length is a measurement the user will believe')
      .toMatch(/\}, \[activeFaceId, roofPlanes, stage\]\)/);
  });

  it('it does not run before the viewer exists', () => {
    const i = ENGINE.indexOf('syncFaceDimensions(activeFaceId);');
    const before = ENGINE.slice(Math.max(0, i - 160), i);
    expect(before).toMatch(/if \(stage !== 'done'\) return;/);
  });
});
