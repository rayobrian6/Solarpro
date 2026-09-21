/**
 * tests/planeLifecycleAuthority.test.ts
 *
 * ONE ANSWER TO "IS THIS FACE PART OF THE DESIGN".
 *
 * SolarEngine3D keeps three maps keyed by plane id — `plane3DEntityMap`,
 * `plane3DFrameMap`, `plane3DCesiumPtsMap`. They are a RENDER CACHE and they
 * are never pruned: no `.delete()`, no `.clear()`, anywhere in the file. That
 * is deliberate and the reasoning is sound — a reconcile-deletions block once
 * removed entities for every id missing from the `roofPlanes` prop and
 * destroyed a user's traced garage, because absence from a prop is not intent.
 *
 * What does not follow is that a ghost is harmless. Three places ENUMERATE
 * those maps and treat whatever they find as the design:
 *
 *     collectRoofRenderables   building extrusion, setback zones, roof model
 *     stitchRoofVertices       clusters corners and MUTATES stored geometry
 *     selectableRoofFaces      what a click resolves to
 *
 * So a deleted plane still shaped the building, still dragged the faces the
 * user kept toward its corners on Stitch, and was still clickable — and since
 * these maps are not reset on an address change, all three were true of a face
 * traced at a DIFFERENT PROPERTY.
 *
 * This file guards the shape of the fix rather than any one symptom: the maps
 * may be enumerated in exactly one place, `liveRenderedFaces`, which applies
 * the design-membership rule. A fourth consumer added later fails here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCommentsAndStrings, stripComments } from './support/stripSource';

const ENGINE_PATH = join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx');
const ENGINE_RAW = readFileSync(ENGINE_PATH, 'utf8');

const ENGINE = stripCommentsAndStrings(ENGINE_RAW);

/** Every way the code could walk a whole plane map rather than look one up. */
const ENUMERATIONS = [
  /plane3DCesiumPtsMap\.current\.forEach\(/g,
  /plane3DCesiumPtsMap\.current\.entries\(\)/g,
  /plane3DCesiumPtsMap\.current\.keys\(\)/g,
  /plane3DCesiumPtsMap\.current\.values\(\)/g,
  /plane3DFrameMap\.current\.forEach\(/g,
  /plane3DFrameMap\.current\.entries\(\)/g,
];

describe('the comment stripper this guard stands on', () => {
  it('removes line comments, block comments and string bodies, keeping offsets', () => {
    const src = [
      'const a = 1; // plane3DCesiumPtsMap.current.forEach(x)',
      '/* plane3DCesiumPtsMap.current.entries() */',
      "const s = 'plane3DCesiumPtsMap.current.forEach(';",
      'const t = `plane3DCesiumPtsMap.current.entries()`;',
      'plane3DCesiumPtsMap.current.forEach(real);',
    ].join('\n');
    const stripped = stripCommentsAndStrings(src);

    expect(stripped.length, 'offsets must be preserved').toBe(src.length);
    // Only the last line — the real code — survives.
    expect((stripped.match(/plane3DCesiumPtsMap\.current\.forEach\(/g) ?? []).length).toBe(1);
    expect(stripped).not.toMatch(/entries\(\)/);
    expect(stripped).toContain('const a = 1;');
  });

  it('does not mistake a division for a comment, or an escaped quote for a terminator', () => {
    const src = "const r = a / b; const q = 'it\\'s fine'; const z = 2;";
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).toContain('const r = a / b;');
    expect(stripped).toContain('const z = 2;');
  });

  it('actually has something to strip in the engine — the scan is not reading an empty file', () => {
    expect(ENGINE_RAW.length).toBeGreaterThan(400_000);
    expect(ENGINE.length).toBe(ENGINE_RAW.length);
    // The comment block documenting this very fix names the map in prose.
    expect(ENGINE_RAW).toContain('are a RENDER CACHE');
    expect(ENGINE).not.toContain('are a RENDER CACHE');
    // And the map name really does appear in prose, which is why stripping matters.
    expect(ENGINE_RAW.split('plane3DCesiumPtsMap').length - 1)
      .toBeGreaterThan(ENGINE.split('plane3DCesiumPtsMap').length - 1);
  });
});

describe('plane lifecycle — the render cache may hold a ghost, it may not decide anything', () => {
  it('the design-membership authority exists and reads roofPlanes', () => {
    const fn = ENGINE.match(/function liveRenderedFaces\(\)[\s\S]{0,900}?\n  \}/);
    expect(fn, 'liveRenderedFaces must exist').toBeTruthy();
    expect(fn![0], 'it must take membership from the DESIGN, not the cache')
      .toMatch(/roofPlanesRef\.current/);
    expect(fn![0], 'and it must actually reject non-members')
      .toMatch(/inDesign\.has\(/);
  });

  it('EVERY enumeration of a plane map happens inside that one function', () => {
    const total = ENUMERATIONS.reduce(
      (n, re) => n + (ENGINE.match(re) ?? []).length, 0,
    );
    // The scan must find something, or it is guarding nothing.
    expect(total, 'no plane-map enumeration found at all — the scan is broken').toBeGreaterThan(0);

    const fn = ENGINE.match(/function liveRenderedFaces\(\)[\s\S]{0,900}?\n  \}/);
    const insideAuthority = ENUMERATIONS.reduce(
      (n, re) => n + (fn![0].match(re) ?? []).length, 0,
    );

    expect(total).toBe(insideAuthority);
  });

  it('the three authority consumers all go through it', () => {
    for (const consumer of ['collectRoofRenderables', 'stitchRoofVertices', 'selectableRoofFaces']) {
      const body = ENGINE.match(new RegExp(`function ${consumer}\\([\\s\\S]{0,2600}`));
      expect(body, `${consumer} not found`).toBeTruthy();
      expect(body![0], `${consumer} must ask the design which faces are live`)
        .toMatch(/liveRenderedFaces\(\)/);
    }
  });

  it('and nothing deletes from the maps — the garage rule still holds', () => {
    // The fix must never have become "prune the cache". Losing traced work is
    // worse than drawing a ghost, which is why the reconcile block was removed.
    for (const map of ['plane3DEntityMap', 'plane3DFrameMap', 'plane3DCesiumPtsMap']) {
      expect(ENGINE, `${map} must not be pruned`)
        .not.toMatch(new RegExp(`${map}\\.current\\.delete\\(`));
      expect(ENGINE, `${map} must not be cleared`)
        .not.toMatch(new RegExp(`${map}\\.current\\.clear\\(`));
    }
  });
});
