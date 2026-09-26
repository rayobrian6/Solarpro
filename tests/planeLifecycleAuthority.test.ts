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
import { stripCommentsAndStrings } from './support/stripSource';

const ENGINE_PATH = join(__dirname, '..', 'components', '3d', 'SolarEngine3D.tsx');
const ENGINE_RAW = readFileSync(ENGINE_PATH, 'utf8');

const ENGINE = stripCommentsAndStrings(ENGINE_RAW);

/**
 * The body of a top-level helper inside the component: from its declaration to
 * its own closing brace at the component's indentation.
 *
 * 🚨 NEVER `[\s\S]{0,<n>}`. This used to take 2600 characters after the
 * declaration and hope that was the function. Measured on this very file: the
 * 2600-character window opened at `liveRenderedFaces` contains TWO
 * `liveRenderedFaces()` occurrences, the second belonging to the NEXT function —
 * so "this consumer calls the authority" could be satisfied by a NEIGHBOUR
 * calling it. `\n  }` is a real end token (inner blocks are indented further), so
 * the span stops where the function does however much it grows, and the density
 * check below proves the span is code rather than blanked whitespace.
 */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`function ${name}\\(`));
  if (at < 0) return '';
  const end = src.indexOf('\n  }', at);
  return src.slice(at, end < 0 ? src.length : end + 4);
}

/** Share of non-whitespace bytes. A blanked span reads as a pass; this catches it. */
const density = (s: string): number => (s.length === 0 ? 0 : s.replace(/\s/g, '').length / s.length);

/**
 * A call to the authority, and not to something whose name merely ENDS with it.
 *
 * 🚨 MEASURED, NOT THEORETICAL. A mutation that replaced the call in
 * `selectableRoofFaces` with `MUTATION_liveRenderedFaces()` did not fail this
 * file: the bare substring matched inside the longer identifier, so "this
 * consumer asks the design which faces are live" was satisfied by a function that
 * was not the authority. Substring matching on identifiers is a known defect class
 * in this repo's guards; a lookbehind costs nothing.
 */
const CALLS_AUTHORITY = /(?<![\w$])liveRenderedFaces\(\)/;

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

  it('🚨 and an apostrophe in JSX TEXT does not blank the code after it', () => {
    // THE HOLE THIS FILE SAT OVER. The file being scanned is .tsx, and the
    // previous hand-rolled stripper treated a possessive in a user-facing
    // sentence as a string opener: everything to the next apostrophe was blanked,
    // so a NEGATIVE assertion below would have passed against source that still
    // contained the call it forbids. The full audit lives in
    // tests/stripSourceIsJsxSafe.test.ts; this is the local canary.
    const src = [
      'const a = (',
      "  <div>This is the homeowner's roof, and the array sits on it.</div>",
      ');',
      'const b = <SomeEngine plane3DFrameMap={x} />;',
      'plane3DEntityMap.current.delete(goneId);',
    ].join('\n');
    const stripped = stripCommentsAndStrings(src);
    expect(stripped, 'a JSX element after a possessive was blanked').toContain('<SomeEngine');
    expect(stripped, 'a JSX prop after a possessive was blanked').toContain('plane3DFrameMap={');
    expect(stripped, 'a real pruning call after a possessive was blanked — the ban below would be vacuous')
      .toContain('plane3DEntityMap.current.delete(');
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

  it('🚨 and what is left is still CODE, not a field of blanked whitespace', () => {
    // The whole hazard in one number. Measured: 0.739 raw, 0.369 stripped. The
    // floor is set well below that, because this is a catastrophe detector rather
    // than a style rule — a stripper that mis-parsed a quote and blanked its way
    // to the end of the file drives it toward zero, and every scan below would
    // then pass while reading nothing. It must not fail merely because someone
    // adds a long string.
    expect(density(ENGINE), 'the stripped engine is mostly whitespace — the scans below prove nothing')
      .toBeGreaterThan(0.25);
  });
});

describe('plane lifecycle — the render cache may hold a ghost, it may not decide anything', () => {
  it('the design-membership authority exists and reads roofPlanes', () => {
    const fn = fnBody(ENGINE, 'liveRenderedFaces');
    expect(fn, 'liveRenderedFaces must exist').toBeTruthy();
    expect(density(fn), 'the authority body came back as whitespace').toBeGreaterThan(0.4);
    expect(fn, 'it must take membership from the DESIGN, not the cache')
      .toMatch(/roofPlanesRef\.current/);
    expect(fn, 'and it must actually reject non-members')
      .toMatch(/inDesign\.has\(/);
  });

  it('EVERY enumeration of a plane map happens inside that one function', () => {
    const total = ENUMERATIONS.reduce(
      (n, re) => n + (ENGINE.match(re) ?? []).length, 0,
    );
    // The scan must find something, or it is guarding nothing.
    expect(total, 'no plane-map enumeration found at all — the scan is broken').toBeGreaterThan(0);

    const fn = fnBody(ENGINE, 'liveRenderedFaces');
    const insideAuthority = ENUMERATIONS.reduce(
      (n, re) => n + (fn.match(re) ?? []).length, 0,
    );

    expect(total).toBe(insideAuthority);
  });

  it('the three authority consumers all go through it', () => {
    for (const consumer of ['collectRoofRenderables', 'stitchRoofVertices', 'selectableRoofFaces']) {
      const body = fnBody(ENGINE, consumer);
      expect(body, `${consumer} not found`).toBeTruthy();
      // The span must end where the function does. A window that overshoots can
      // be satisfied by the NEXT function calling the authority — measured on
      // this file, the old 2600-character window did exactly that.
      expect(body.endsWith('\n  }'), `${consumer} span does not end at the function's own brace`).toBe(true);
      // Measured: 0.392 / 0.316 / 0.278 for the three consumers. The floor is set
      // far below the smallest of those ON PURPOSE — comments in this file are
      // long and are blanked to whitespace, so a tight floor would fail on correct
      // code every time somebody documents something. A body that came back fully
      // blanked reads near zero, which is the only case this is here to catch.
      expect(density(body), `${consumer} came back as whitespace`).toBeGreaterThan(0.1);
      expect(body, `${consumer} must ask the design which faces are live`)
        .toMatch(CALLS_AUTHORITY);
    }
  });

  it('and nothing deletes from the maps — the garage rule still holds', () => {
    // The fix must never have become "prune the cache". Losing traced work is
    // worse than drawing a ghost, which is why the reconcile block was removed.
    //
    // 🚨 POSITIVE CONTROL FIRST. These are the only NEGATIVE assertions in the
    // file, so they are the ones a blanked scan turns into decoration. The engine
    // really does call both methods on other collections, which proves the
    // stripped text can still show them — without this line, "no pruning call
    // found" and "the stripper ate the pruning call" look identical.
    expect(ENGINE, 'the scan cannot see a deletion call at all — the ban below is vacuous')
      .toMatch(/\.delete\(/);
    expect(ENGINE, 'the scan cannot see a clear call at all — the ban below is vacuous')
      .toMatch(/\.clear\(/);

    for (const map of ['plane3DEntityMap', 'plane3DFrameMap', 'plane3DCesiumPtsMap']) {
      // The map is named in prose in this file, so the guard must ALSO prove it
      // can see the map's own name in code — otherwise a stripper that blanked
      // the whole region would satisfy the ban.
      expect(ENGINE, `${map} is not visible in the stripped source at all`)
        .toMatch(new RegExp(`${map}\\.current`));
      expect(ENGINE, `${map} must not be pruned`)
        .not.toMatch(new RegExp(`${map}\\.current\\.delete\\(`));
      expect(ENGINE, `${map} must not be cleared`)
        .not.toMatch(new RegExp(`${map}\\.current\\.clear\\(`));
    }
  });
});
