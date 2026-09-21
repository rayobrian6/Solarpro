/**
 * tests/persistenceWriterParity.test.ts
 *
 * EVERY WRITER TO THE LAYOUT ROW MUST PRESERVE EVERY PROPERTY — WITHOUT
 * LETTING ANY OF THEM LEAK INTO THE ACTIVE COLUMNS.
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY IT CHANGED
 * -------------------------------------------------
 * The first site-ownership implementation kept archived roof planes by MERGING
 * them back into `roofPlanes` at save time, and this file asserted that every
 * writer performed that merge. It did preserve the data. It also put three
 * properties' geometry into the one column `rowToLayout()` hands unfiltered to
 * lib/pvwatts.ts (`roofPlanes[0].pitch` IS the array tilt),
 * lib/multiArrayEngine.ts, /api/production, lib/engineering/syncPipeline.ts and
 * the permit CAD path. One live row — 3 Melvin Drive — carried 13 planes from
 * three properties. A permit combining one property's roof with another's
 * jurisdiction is a permit-grade defect, so the merge had to go.
 *
 * THE OBLIGATION NOW
 * ------------------
 * Every writer sends the ACTIVE property in the normal columns and every other
 * property in `siteArchives` (migration 123). Both halves are required:
 *   • omit the archive and an address change deletes the other property;
 *   • merge the archive in and a permit engineers against the wrong roof.
 *
 * There are THREE writers, not one, and the third was missed on the first pass:
 *
 *   S1  the 3s debounced autosave      saveLayoutToDB     -> POST /api/projects/[id]/layout
 *   S2  the beforeunload beacon        handleBeforeUnload -> same route
 *   S3  the SAVE BUTTON                buildLayout        -> POST /api/production
 *
 * These are source-level assertions on purpose. The failure they prevent is
 * "someone adds a fourth writer and forgets", which no unit test of the model
 * itself can catch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import { switchSite, setActiveBundle, hydrate, toPersistencePayload, emptyBundle, SITE_ARCHIVE_VERSION } from '@/lib/design/siteDesignModel';
import type { RoofPlane } from '@/types';

const SRC = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');
const ROUTE_LAYOUT = readFileSync(join(process.cwd(), 'app/api/projects/[id]/layout/route.ts'), 'utf8');
const ROUTE_PROD = readFileSync(join(process.cwd(), 'app/api/production/route.ts'), 'utf8');
const DB = readFileSync(join(process.cwd(), 'lib/db/projects.ts'), 'utf8');

function plane(over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id: 'p', vertices: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1 }, { lat: 1.001, lng: 1.001 }],
    pitch: 20, azimuth: 180, area: 40, usableArea: 34, ...over,
  } as RoofPlane;
}

const KEY_A = siteKeyFromCoords(38.8, -89.5, 'proj');
const KEY_B = siteKeyFromCoords(38.9, -90.1, 'proj');

// ─────────────────────────────────────────────────────────────────────────────
describe('every layout writer sends the archive — and only the active site inline', () => {
  it('S1 — the debounced autosave sends siteArchives', () => {
    const save = SRC.slice(SRC.indexOf('const saveLayoutToDB'), SRC.indexOf('// Trigger auto-save 3 seconds'));
    expect(save).toMatch(/site\.persistencePayload\(/);
    expect(save).toMatch(/siteArchives: sitePayload\.siteArchives/);
    expect(save).toMatch(/roofPlanes: planesForPersistence/);
  });

  it('S2 — the beforeunload beacon sends siteArchives', () => {
    const beacon = SRC.slice(SRC.indexOf('const handleBeforeUnload'), SRC.indexOf('navigator.sendBeacon'));
    expect(beacon).toMatch(/site\.persistencePayload\(/);
    expect(beacon).toMatch(/siteArchives: sitePayload\.siteArchives/);
  });

  it('🚨 S3 — the SAVE BUTTON sends siteArchives too', () => {
    // It used to merge the archive INTO roofPlanes. Now it sends the active
    // set (what buildSystemDefinition returns, which is right for engineering)
    // and the archive separately.
    const build = SRC.slice(SRC.indexOf('const buildLayout'), SRC.indexOf('const handleSave'));
    expect(build).toMatch(/siteArchives: archives/);
    expect(build).toMatch(/const archives = site\.storedArchives\(\)/);
    expect(build).toMatch(/obstructions: placedObstructionsRef\.current/);
    expect(build).toMatch(/measurements: measurementsRef\.current/);
  });

  it('🚨 NO writer merges a foreign property into roofPlanes any more', () => {
    // The shape that put three properties into pvwatts' input.
    expect(SRC).not.toMatch(/mergeForPersistence/);
    expect(SRC).not.toMatch(/foreignRoofPlanesRef/);
  });

  it('every writer derives its payload from the ONE model, not by hand', () => {
    // Three call sites, one function: the drift between them is what made the
    // beacon and the autosave disagree in the first place.
    const uses = SRC.match(/site\.(persistencePayload|storedArchives)\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(4); // S1, S2, S3, restore seed
  });

  it('engineering still reads the ACTIVE set — storage and engineering agree now', () => {
    // buildSystemDefinition must see only the property being designed. It
    // always did; the difference is that storage no longer differs from it.
    const sysDef = SRC.slice(SRC.indexOf('const buildSystemDefinition'), SRC.indexOf('const buildLayout'));
    expect(sysDef).not.toMatch(/siteArchives/);
    expect(sysDef).toMatch(/const effectiveRoofPlanes = roofPlanes\.length > 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the routes and the DB layer carry the field through', () => {
  it('the layout route destructures siteArchives from the body', () => {
    // 🚨 A field missing from THAT destructure is dropped with no error, which
    // is how a persisted field can look wired and never arrive.
    expect(ROUTE_LAYOUT).toMatch(/\bsiteArchives,/);
    expect(ROUTE_LAYOUT).toMatch(/siteArchives:\s+siteArchives\s+\?\? existingLayout\?\.siteArchives/);
  });

  it('🚨 the production route — the THIRD writer — carries it too', () => {
    // The Save button lands here, not on the layout route. These three were
    // silently dropped: `undefined` reads as KEEP STORED in upsertLayout, so
    // the row kept the older value while the user was told it saved.
    expect(ROUTE_PROD).toMatch(/siteArchives:\s+rawLayout\.siteArchives/);
    expect(ROUTE_PROD).toMatch(/obstructions:\s+rawLayout\.obstructions/);
    expect(ROUTE_PROD).toMatch(/measurements:\s+rawLayout\.measurements/);
  });

  it('upsertLayout writes site_archives, tolerating a pre-123 deployment', () => {
    expect(DB).toMatch(/SET site_archives = \$\{JSON\.stringify\(data\.siteArchives\)\}::jsonb/);
    expect(DB).toMatch(/run migration 123/);
  });

  it('🚨 the subsystem-wipe guard counts ARCHIVED panels as present', () => {
    // Otherwise it refuses every legitimate address change — and refusing the
    // save is worse than the bug it guards, because the archive would then
    // never reach the database at all.
    const guard = DB.slice(DB.indexOf('Subsystem-wipe guard'), DB.indexOf('// UPDATE existing layout'));
    expect(guard).toMatch(/archivedPanels/);
    expect(guard).toMatch(/data\.siteArchives/);
    // 🚨 THIS PINNED THE LINE VERBATIM, DOWN TO `data.panels || []`.
    // Changing that `||` to `??` — which is the fix for "an omitted panel list
    // is not a wipe" — broke a test whose own stated subject is archived
    // panels. A test that pins an expression cannot tell a repair from a
    // regression; it only reports that the text moved. It asserts the two
    // properties it actually means now.
    expect(guard, 'the incoming set must include the archived panels')
      .toMatch(/new Set\(\[[\s\S]{0,80}?data\.panels[\s\S]{0,80}?archivedPanels\]/);
    expect(guard, 'an OMITTED panel list is not a wipe — absence must reach the writer')
      .toMatch(/data\.panels == null \? \[\] :/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the model behaviour those writers depend on', () => {
  it('a Save after an address change keeps BOTH properties', () => {
    let s = { version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, active: { ...emptyBundle(), roofPlanes: [plane({ id: 'a1' })] }, archives: {} };
    s = switchSite(s, KEY_B).state;
    s = setActiveBundle(s, { ...emptyBundle(), roofPlanes: [plane({ id: 'b1' })] });
    const p = toPersistencePayload(s);
    // The active column holds ONE property …
    expect(p.roofPlanes.map(x => x.id)).toEqual(['b1']);
    // … and the other is kept where nothing downstream reads it.
    expect(p.siteArchives.sites[KEY_A].roofPlanes.map(x => x.id)).toEqual(['a1']);
  });

  it('...and reloading at the first property brings it back intact', () => {
    let s = { version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, active: { ...emptyBundle(), roofPlanes: [plane({ id: 'a1', source: 'manual', confirmed: true })] }, archives: {} };
    s = switchSite(s, KEY_B).state;
    const stored = toPersistencePayload(s);
    const reloaded = hydrate(JSON.parse(JSON.stringify(stored)), KEY_A);
    expect(reloaded.state.active.roofPlanes).toHaveLength(1);
    expect(reloaded.state.active.roofPlanes[0]).toMatchObject({ id: 'a1', source: 'manual', confirmed: true });
  });

  it('persisting with nothing archived stores an empty archive, not undefined', () => {
    // `undefined` reads as KEEP STORED in the route, so the last archived site
    // could never be released.
    const p = toPersistencePayload({ version: SITE_ARCHIVE_VERSION, activeSiteKey: KEY_A, active: { ...emptyBundle(), roofPlanes: [plane({ id: 'a1' })] }, archives: {} });
    expect(p.siteArchives).toBeDefined();
    expect(p.siteArchives.sites).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the restore seed stays in parity with the writers', () => {
  it('the seed signs the archive exactly as the writers do', () => {
    // NB: slice from the hydrate call, not from a `restoreStateRef` string —
    // that phrase also appears in a comment ABOVE the seed, which would
    // truncate the window and make this assertion pass vacuously.
    const restore = SRC.slice(
      SRC.indexOf('const hydrated = site.hydrateFromStored'),
      SRC.indexOf('setRoofRestoreResolved(true);'),
    );
    expect(restore).toMatch(/lastSavedPanelsRef\.current = hydrated\.needsAdoptionSave \? ''/);
    expect(restore).toMatch(/archivesSignature\(site\.storedArchives\(/);
  });

  it('a hydration that rewrote ownership forces exactly one save', () => {
    // '' can never equal a real signature, so the next tick always writes; the
    // load after that reads a row that agrees and does not repeat.
    const legacy = { panels: [], roofPlanes: [plane({ id: 'x' })], obstructions: [], measurements: [] };
    const first = hydrate(legacy, KEY_A);
    expect(first.needsAdoptionSave).toBe(true);
    const written = toPersistencePayload(first.state);
    const second = hydrate(JSON.parse(JSON.stringify(written)), KEY_A);
    expect(second.needsAdoptionSave).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two writers on the layout route carry the SAME fields', () => {
  const beacon = SRC.slice(SRC.indexOf('const handleBeforeUnload'), SRC.indexOf('navigator.sendBeacon'));

  it('the beacon carries fence geometry and the design parameters', () => {
    // It used to omit them, so closing the tab inside the 3s debounce lost a
    // fence line or a row spacing while closing it later did not — a bug whose
    // reproduction depended on how fast the user clicked.
    expect(beacon).toMatch(/fenceLine:/);
    expect(beacon).toMatch(/fenceHeight:/);
    expect(beacon).toMatch(/groundTilt:/);
    expect(beacon).toMatch(/rowSpacing:/);
    expect(beacon).toMatch(/bifacialOptimized:/);
  });

  it('the beacon spreads the same designParams object the debounced save signs', () => {
    expect(beacon).toMatch(/const designParams = \{/);
    expect(SRC.slice(SRC.indexOf('const handleBeforeUnload'))).toMatch(/\.\.\.designParams/);
  });

  it('both sign the archive, so neither can drift from the other', () => {
    const save = SRC.slice(SRC.indexOf('const saveLayoutToDB'), SRC.indexOf('// Trigger auto-save 3 seconds'));
    for (const w of [save, beacon]) {
      expect(w).toMatch(/\+ '\|' \+ archivesSignature\(sitePayload\.siteArchives\)/);
    }
  });
});
