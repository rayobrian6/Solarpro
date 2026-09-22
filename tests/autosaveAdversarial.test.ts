/**
 * tests/autosaveAdversarial.test.ts
 *
 * AUTOSAVE, BEYOND HAPPY-PATH PITCH EDITING.
 *
 * Every case here is a way the layout autosave has actually failed, or a way it
 * could fail silently. "Silently" is the theme: none of these announce
 * themselves — the payload looks right, the request succeeds, and the design is
 * wrong on reload.
 *
 * 🚨 THE CLASS OF DEFECT THIS FILE EXISTS FOR
 *   • the dedup signature was defeated by a timestamp, so every tick POSTed
 *   • the restore seed signed a different shape than the writers, so a restored
 *     layout re-POSTed itself immediately
 *   • `undefined` means KEEP STORED in the route's `??` merge, so clearing was
 *     unsaveable
 *   • a coordinate change left another property's roof in state
 *   • a "reconcile deletions" effect inferred a delete from prop timing and
 *     removed a user's traced garage — ABSENCE IS NOT INTENT
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSignature, SIGNED_DESIGN_PARAMS, SIGNED_FIELDS } from '@/lib/roofPlanesSignature';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
// 🚨 The persistence round trip goes through the REAL model, not a two-line
// simulation of it. See tests/helpers/siteRoundTrip.ts for why.
import { persistAndReload } from './helpers/siteRoundTrip';
import { SITE_BOUND_ENTITY_KEYS } from '@/lib/design/siteDesignModel';
import type { RoofPlane } from '@/types';

const SRC = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');
const KEY = siteKeyFromCoords(38.89080, -89.57079, 'proj');
const KEY_B = siteKeyFromCoords(38.70890, -90.14940, 'proj');

function plane(id: string, over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id,
    vertices: [{ lat: 38.8, lng: -89.5 }, { lat: 38.8001, lng: -89.5 }, { lat: 38.8001, lng: -89.4999 }],
    pitch: 22, azimuth: 180, area: 60, usableArea: 52, siteKey: KEY, ...over,
  } as RoofPlane;
}

/** What the writers compute. */
const sig = (planes: RoofPlane[], params: any = null, panels: unknown[] = []) =>
  layoutSignature({ panels, designElectrical: null, roofPlanes: planes, designParams: params });

/** A round trip through JSON, as the database does it. */
const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── CREATE / EDIT / DELETE ──────────────────────────────────────────────────

describe('roof create / edit / delete round trips', () => {
  it('create roof → save → reload restores it', () => {
    expect(persistAndReload({ planes: [plane('a')], at: KEY }).active.map(p => p.id)).toEqual(['a']);
  });

  it('edit roof → the edit schedules a save', () => {
    const before = sig([plane('a', { pitch: 22 })]);
    expect(sig([plane('a', { pitch: 26 })])).not.toBe(before);
  });

  it('edit roof → save → reload restores the EDITED value', () => {
    expect(persistAndReload({ planes: [plane('a', { pitch: 26 })], at: KEY }).active[0].pitch).toBe(26);
  });

  it('delete ONE plane of several → schedules a save and reloads without it', () => {
    const before = sig([plane('a'), plane('b')]);
    const after = [plane('a')];
    expect(sig(after)).not.toBe(before);
    expect(persistAndReload({ planes: after, at: KEY }).active.map(p => p.id)).toEqual(['a']);
  });

  it('🚨 delete ALL planes → reload stays empty', () => {
    // The `undefined` vs `[]` defect. The route merges
    // `roofPlanes ?? existingLayout?.roofPlanes`, so sending `undefined` meant
    // KEEP STORED: "Draw Manually Instead" and deleting the last face both
    // reported saved and came back on reload.
    const before = sig([plane('a')]);
    expect(sig([])).not.toBe(before);            // clearing is a change
    const cleared = persistAndReload({ planes: [], at: KEY });
    expect(cleared.storedRoofPlanes).toEqual([]); // [] is persisted, not dropped
    expect(cleared.active).toEqual([]);           // ...and stays cleared on reload
  });

  it('the payload sends the array itself, never undefined', () => {
    expect(SRC).not.toMatch(/roofPlanes:\s*\w+\.length > 0 \? [^:]+ : undefined/);
  });
});

// ── DEDUP CANNOT BE DEFEATED ────────────────────────────────────────────────

describe('the dedup survives the things that used to defeat it', () => {
  it('a timestamp cannot make identical content look changed', () => {
    const a = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T1' }, roofPlanes: [] });
    const b = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T2' }, roofPlanes: [] });
    expect(b).toBe(a);
  });

  it('but a real electrical change still registers', () => {
    const a = layoutSignature({ panels: [], designElectrical: { topology: 'string', generatedAt: 'T' }, roofPlanes: [] });
    const b = layoutSignature({ panels: [], designElectrical: { topology: 'micro', generatedAt: 'T' }, roofPlanes: [] });
    expect(b).not.toBe(a);
  });

  it('floating-point noise in derived 3D fields does not churn a save', () => {
    const a = plane('a'); (a as any).polygon3D = [{ x: 1.00000001, y: 2, z: 3 }];
    const b = plane('a'); (b as any).polygon3D = [{ x: 1.00000002, y: 2, z: 3 }];
    expect(sig([b])).toBe(sig([a]));
  });

  it('restoring a saved layout does not immediately rewrite it', () => {
    // Seed/writer parity. The seed must sign the same shape the writers do.
    const planes = [plane('a')];
    const params = { fenceHeight: 2, groundTilt: 20, rowSpacing: 1.5, groundHeight: 0.6, bifacialOptimized: true };
    const reloaded = persistAndReload({ planes, at: KEY });
    const seed = sig(reloaded.active, params);
    const firstTick = sig(reloaded.active, params);
    expect(firstTick).toBe(seed);
    expect(reloaded.disposition).toBe('matched'); // no ownership rewrite, so no forced save
  });
});

// ── DESIGN PARAMETERS ───────────────────────────────────────────────────────

describe('scalar design parameters can trigger a save', () => {
  const base = { fenceHeight: 2, groundTilt: 20, groundAzimuth: 180, rowSpacing: 1.5, groundHeight: 0.6, bifacialOptimized: true };

  for (const field of SIGNED_DESIGN_PARAMS) {
    it(`a change to ${field} changes the signature`, () => {
      const before = sig([], base);
      const changed: any = { ...base };
      changed[field] = field === 'bifacialOptimized' ? false
        : field === 'fenceLine' ? [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]
        : 99;
      expect(sig([], changed)).not.toBe(before);
    });
  }

  it('a fence line edit alone schedules a save', () => {
    // On a fence or ground-mount design the panels may never move, so without
    // this the edit was simply lost.
    const before = sig([], { ...base, fenceLine: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] });
    const after = sig([], { ...base, fenceLine: [{ lat: 1, lng: 1 }, { lat: 3, lng: 3 }] });
    expect(after).not.toBe(before);
  });

  it('both writers sign the design parameters', () => {
    const matches = SRC.match(/const designParams = \{/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // debounced save + beacon
  });

  it('the restore reads every signed parameter back', () => {
    for (const f of SIGNED_DESIGN_PARAMS) {
      if (f === 'fenceAzimuth') continue; // derived from fenceLine, not restored
      expect(SRC, `restore does not read ${f}`).toMatch(new RegExp(`data\\.data\\?\\.${f}`));
    }
  });
});

// ── RACES AND FAILURES ──────────────────────────────────────────────────────

describe('concurrency and failure', () => {
  it('rapid consecutive edits collapse to the LAST state', () => {
    // The debounce is re-armed on every change, so only the final content is
    // signed and sent.
    const states = [22, 24, 26, 28].map(p => [plane('a', { pitch: p })]);
    const sigs = states.map(s => sig(s));
    expect(new Set(sigs).size).toBe(4);            // each is distinguishable
    expect(sigs[3]).toBe(sig([plane('a', { pitch: 28 })])); // last wins
  });

  it('a save in flight does not mask a newer edit', () => {
    // lastSavedPanelsRef is set to the signature of what was SENT. A newer edit
    // produces a different signature, so the next tick still fires.
    let lastSaved = sig([plane('a', { pitch: 22 })]);
    const newer = sig([plane('a', { pitch: 30 })]);
    expect(newer === lastSaved).toBe(false);
    lastSaved = newer;
    expect(sig([plane('a', { pitch: 30 })]) === lastSaved).toBe(true); // then settles
  });

  it('a failed save can be retried — the signature is recomputed, not cached elsewhere', () => {
    // There is exactly one place the "already saved" fact lives.
    const assignments = SRC.match(/lastSavedPanelsRef\.current\s*=/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    expect(SRC).toMatch(/if \(sig === lastSavedPanelsRef\.current\) return/);
  });

  it('🚨 a restore FAILURE disables saving permanently', () => {
    // If we could not READ the layout we must not risk WRITING over it.
    expect(SRC).toMatch(/restoreStateRef\.current = 'failed'/);
    expect(SRC).toMatch(/if \(restoreStateRef\.current !== 'done'\) return/);
  });

  it('a non-ok response is a failure, not a green light', () => {
    // Only a THROWN error used to reach the catch, so a 400/401/404 returned as
    // JSON fell through to 'done' and enabled saves against a layout never read.
    expect(SRC).toMatch(/if \(!res\.ok \|\| !data\?\.success\)/);
  });

  it('the fence re-arms before the await on a project switch', () => {
    const restoreFn = SRC.slice(SRC.indexOf('const restorePanels = async'), SRC.indexOf('restorePanels();'));
    const pendingIdx = restoreFn.indexOf("restoreStateRef.current = 'pending'");
    const fetchIdx = restoreFn.indexOf('await fetch(');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(pendingIdx).toBeLessThan(fetchIdx);
  });
});

// ── STALE STATE CANNOT WIN ──────────────────────────────────────────────────

describe('stale responses cannot overwrite newer client state', () => {
  it('a detection for another site is dropped, not merged', () => {
    expect(SRC).toMatch(/dropped \$\{planes\.length\} detected plane\(s\) for/);
  });

  it('an archived site cannot reappear as the active one', () => {
    const r = persistAndReload({ planes: [plane('b1', { siteKey: KEY_B })], at: KEY_B, archives: { [KEY]: [plane('a1')] } });
    expect(r.active.map(p => p.id)).toEqual(['b1']);
    // 🚨 …and the archived property is NOT in the column engineering reads.
    expect(r.storedRoofPlanes.map(p => p.id)).toEqual(['b1']);
  });

  it('...and the archived site is still there when you go back', () => {
    const r = persistAndReload({ planes: [plane('b1', { siteKey: KEY_B })], at: KEY_B, archives: { [KEY]: [plane('a1')] }, reloadAt: KEY });
    expect(r.active.map(p => p.id)).toEqual(['a1']);
  });
});

// ── THE GARAGE ──────────────────────────────────────────────────────────────

describe('🚨 the traced-garage deletion class', () => {
  it('the reconcile-deletions block is gone and pinned gone', () => {
    // A "reconcile deletions" effect removed entities for any plane id absent
    // from the roofPlanes prop. Traced faces live in plane3DEntityMap and the
    // prop does not always list them when that effect runs, so it deleted a
    // user's traced garage. ABSENCE IS NOT INTENT.
    const engine = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
    expect(engine).not.toMatch(/plane3DEntityMap\.current\.(delete|clear)\(/);
  });

  it('the engine has no persistence writer of its own', () => {
    // A second writer would have to serialise the roofPlanes prop, which lags
    // plane3DEntityMap by a commit — the garage, through a different door.
    const engine = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');
    expect(engine).not.toMatch(/sendBeacon/);
    expect(engine).not.toMatch(/fetch\(\s*`?\/api\/projects/);
  });

  it('an address change ARCHIVES rather than clears — EVERY entity', () => {
    // 🚨 THIS IS WHAT MELVIN FAILED ON. The roof was archived; the panels,
    // placed obstructions and measurements were cleared outright and nothing
    // ever put them back, because the only code that repopulates them is the
    // mount-time DB restore and an address change does not remount.
    expect(SRC).toMatch(/archived \$\{res\.archivedCount\} entit/);
    // The three explicit-intent entry points all go through the one archiving
    // path, and none of them clears anything.
    // 🚨 Strip comment lines first. These functions carry a comment QUOTING the
    // old `setPanels([])` so the defect is documented where it happened — and
    // a source-grep assertion that reads its own documentation as code is a
    // false failure today and a false PASS the day someone deletes the comment.
    const code = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const fn of ['const handleLocationPick', 'const handleSelectAddressSuggestion']) {
      const body = code(SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 2500));
      expect(body, `${fn} must not clear roof planes`).not.toMatch(/setRoofPlanes\(\[\]\)/);
      expect(body, `${fn} must not clear panels`).not.toMatch(/setPanels\(\[\]\)/);
      expect(body, `${fn} must archive through changeSite`).toMatch(/changeSite\(/);
    }
    // The geocode search resolves BEFORE it switches — a search that fails, is
    // cancelled, or lands on the same property must change nothing.
    const geo = code(SRC.slice(SRC.indexOf('const geocodeAddress = async'), SRC.indexOf('const geocodeAddress = async') + 2500));
    expect(geo).not.toMatch(/setPanels\(\[\]\)/);
    expect(geo.indexOf('changeSite(')).toBeGreaterThan(geo.indexOf('await fetch(`/api/geocode'));
  });

  it('🚨 PANNING THE MAP CANNOT ARCHIVE ANYTHING', () => {
    // The archive used to run from a `useEffect` keyed on
    // [mapCenter.lat, mapCenter.lng]. `mapCenter` is also written by the 2D
    // map's PAN and mouse-wheel ZOOM handlers, on every pointer move, and the
    // site key resolves to about 1.1 m — so one drag of the map archived the
    // whole design and activated an empty site. A site change is now an
    // explicit act, never a coordinate observation.
    expect(SRC).not.toMatch(/\}, \[mapCenter\?\.lat, mapCenter\?\.lng, project\.id\]\);/);
    const changeSite = SRC.slice(SRC.indexOf('const changeSite = useCallback'), SRC.indexOf('// Load hardware'));
    expect(changeSite).toMatch(/site\.switchToSite\(/);
    // It is a callback the intent handlers invoke, not an effect the map fires.
    expect(changeSite).not.toMatch(/useEffect\(/);
  });

  it('manual provenance survives every transition', () => {
    const traced = plane('hand', { source: 'manual', confirmed: true });
    const back = persistAndReload({ planes: [], at: KEY_B, archives: { [KEY]: [traced] }, reloadAt: KEY }).active[0];
    expect(back).toMatchObject({ id: 'hand', source: 'manual', confirmed: true });
  });
});

// ── KNOWN GAPS, RECORDED ────────────────────────────────────────────────────

describe('entities that are NOT persisted — classified, not merely listed', () => {
  // 🚨 A LIST OF NAMES IS NOT A CLASSIFICATION. The previous version of this
  // block asserted three strings were absent from the signature, which is true
  // of every string. What matters about an unpersisted entity is whether
  // ANYTHING READS IT: an entity nothing reads is a UX gap, and an entity
  // something reads is a silent wrong answer in a permit.
  //
  // Each entry below is asserted against the engine source, so the day one of
  // these grows a consumer or an outbound callback, this fails.
  const ENGINE = readFileSync(join(process.cwd(), 'components/3d/SolarEngine3D.tsx'), 'utf8');

  it('vertexSpecs / trees / blocks have NO outbound callback to the studio', () => {
    // They live entirely inside SolarEngine3D and die on unmount. That is a
    // real gap for the user, and it is NOT a correctness defect: with no
    // callback there is no path by which they can reach a layout, a BOM, a
    // production model or a permit. They cannot be silently wrong because they
    // cannot be read at all.
    expect(ENGINE).not.toMatch(/onVertexSpecsChange/);
    expect(ENGINE).not.toMatch(/onTreesChange/);
    expect(ENGINE).not.toMatch(/onBlocksChange/);
  });

  it('🚨 the GABLE and HIP tools now EMIT — and this test is what gated that', () => {
    // WHAT THIS USED TO SAY, and why it mattered: both tools drew real roof
    // FACES with a pitch and an eave height, and both stopped at Cesium entities
    // plus a vertexSpec. `onRoofPlaneCreated` was called from exactly ONE place —
    // finalizePlane3D — so a gable somebody placed never reached the Roof Planes
    // sidebar, the panel layout, the BOM or the planset, and was gone on reload.
    //
    // The old assertion was `expect(emits).toHaveLength(1)` with this note:
    //
    //   "If a gable/hip path ever starts emitting, this count moves and this
    //    test fails — at which point the emitted faces MUST be given a site key
    //    and a persistence path, like every other roof plane."
    //
    // That has now happened, so this test asserts the CONDITIONS it named rather
    // than the count it was holding the line with. Emitting is no longer the
    // thing to prevent; emitting WITHOUT ownership and persistence is.
    const emits = ENGINE.match(/onRoofPlaneCreated\?\.\(/g) ?? [];
    expect(emits, 'finalizePlane3D and finalizeRoofSection').toHaveLength(2);

    // 1. The section emitter exists and goes through the shared domain, not
    //    through geometry of its own.
    expect(ENGINE).toMatch(/function finalizeRoofSection\(/);
    expect(ENGINE).toMatch(/buildSectionRoofPlanes\(\{/);

    // 2. A SITE KEY. The engine deliberately does NOT stamp one — DesignStudio's
    //    onRoofPlaneCreated handler stamps every plane it receives, from one
    //    line, so a section face is owned by exactly the same rule as a traced
    //    face. Asserted where it actually happens.
    const STUDIO = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');
    const handler = STUDIO.slice(
      STUDIO.indexOf('onRoofPlaneCreated={(plane) => {'),
      STUDIO.indexOf('onRoofPlanesDetected={(planes) => {'),
    );
    expect(handler.length, 'the scan did not find the handler').toBeGreaterThan(300);
    expect(handler).toMatch(/enrichedPlane\.siteKey = activeSiteKeyRef\.current/);
    // …and the section's own record is stamped with it too, or a reconstituted
    // section would not know which property it stands on.
    expect(handler).toMatch(/enrichedPlane\.section\.siteKey = enrichedPlane\.siteKey/);
    expect(handler).toMatch(/setRoofPlanes\(prev => \[\.\.\.prev, enrichedPlane\]\)/);

    // 3. A PERSISTENCE PATH. Section faces are ordinary roof planes, so they
    //    ride `layouts.roof_planes` — and the two fields that carry the section
    //    are signed, so a section edit that moves no geometry still saves.
    expect(SIGNED_FIELDS as readonly string[]).toContain('sectionId');
    expect(SIGNED_FIELDS as readonly string[]).toContain('section');
  });

  it('🚨 markOnly is DERIVED from the panels — and it used to be LATCHED', () => {
    // The reasoning here was always right: a face renders as outline-only when
    // it carries no panels, panels are persisted, so the state round-trips by
    // construction and storing it would create a second source of truth.
    //
    // 🚨 AND THE ASSERTION WAS `expect(ENGINE).toMatch(/const isMarkOnly = !planeHasPanels;/)`,
    // WHICH THE DEFECT SATISFIED. Two lines below that expression sat
    //
    //     if (isMarkOnly) markOnlyPlaneIdsRef.current.add(plane.id);
    //
    // and nothing ever removed from that set. The restore path runs BEFORE Auto
    // Layout places anything, so every face arriving from state — a reload, a
    // restored design, every face Google detects — was recorded as "no panels"
    // permanently. Filling it with fifty-five panels did not change the answer,
    // and `renderPlane3DEntity`'s outline branch returns before drawing the
    // opaque base coat that exists to "suppress wavy mesh waviness beneath
    // panels". Measured in the browser: 55 [PANEL] entities, one
    // [PLANE3D-OUTLINE], zero [PLANE3D-BASE] — no roof under the array, the
    // photogrammetry mesh showing through, and a panel placed above a FITTED
    // plane swallowed wherever the mesh rises above it.
    //
    // The test checked for the derivation and could not see the latch beside
    // it. So it now asserts the property instead of the token.

    // 1. There is a derivation, and it reads the CURRENT panel set.
    const fn = ENGINE.match(/function planeRendersOutlineOnly[\s\S]{0,800}?panelsRef\.current\.some\(/);
    expect(fn, 'the derived predicate must exist').toBeTruthy();
    expect(fn![0], 'it must read the current panels, not a cached answer')
      .toMatch(/panelsRef\.current\.some\(/);

    // 2. Every face is drawn through it — no render site reads a latched set.
    const renders = ENGINE.match(/renderPlane3DEntity\(/g) ?? [];
    expect(renders.length, 'the scan found no render sites').toBeGreaterThanOrEqual(5);
    expect(ENGINE, 'no render site may ask a cached answer whether a face has panels')
      .not.toMatch(/markOnlyPlaneIdsRef\.current\.has\(/);


    // 3. 🚨 AND THE LATCH IS GONE ENTIRELY, because keeping it left the hole open.
    //    `handleAutoRoof` does NOT skip Mark Plane faces, so Auto Layout fills
    //    them — and a marked face carrying fifty-five panels would still have
    //    been drawn as a bare outline, which is the whole defect again. The two
    //    facts never disagree except in that case, and there the panels win: a
    //    face with modules on it needs a deck under them whatever was intended
    //    when it was traced.
    expect(ENGINE, 'no latched mark-only set may exist')
      .not.toMatch(/markOnlyPlaneIdsRef\s*=\s*useRef/);
    expect(ENGINE, 'and nothing may write to one')
      .not.toMatch(/markOnlyPlaneIdsRef\.current\.add\(/);

    // 4. And the redraw has to be able to notice a face gaining panels, or the
    //    derivation is correct and never re-evaluated.
    // Pinned on the REQUIREMENT (panelPlaneKey is a trigger), not on the exact
    // literal text of the array. The sibling dependency changed name when the
    // two rival selection states were collapsed into one, and this assertion
    // failed for a reason that had nothing to do with what it is protecting —
    // which is what a source-text matcher costs if it over-specifies.
    expect(ENGINE, 'the plane redraw must key on which faces carry panels')
      .toMatch(/\}, \[[^\]]*panelPlaneKey[^\]]*\]\);/);
  });

  it('the layout signature does not claim to cover any of them', () => {
    for (const e of ['trees', 'blocks', 'vertexSpecs', 'markOnly']) {
      expect(SIGNED_DESIGN_PARAMS as readonly string[]).not.toContain(e);
      expect(SIGNED_FIELDS as readonly string[]).not.toContain(e);
    }
  });

  it('obstructions and measurements DO persist now (migration 122)', () => {
    // Obstructions are keep-out zones: removeObstructedPanels runs against
    // them, so losing them silently re-filled panels over every vent placed.
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).toContain('obstructions');
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).toContain('measurements');
  });

  it('…and they are SITE-BOUND, so they move with the property (migration 123)', () => {
    expect(SITE_BOUND_ENTITY_KEYS as readonly string[]).toContain('obstructions');
    expect(SITE_BOUND_ENTITY_KEYS as readonly string[]).toContain('measurements');
  });

  it('camera pose is deliberately absent — it is per-viewer, not design data', () => {
    // Putting it on the shared layout row would make one user's camera move
    // every other user's view, and every pose nudge a database write.
    expect(SIGNED_DESIGN_PARAMS as readonly string[]).not.toContain('camera');
  });
});
