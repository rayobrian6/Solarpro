/**
 * tests/persistenceWriterParity.test.ts
 *
 * EVERY WRITER TO THE LAYOUT ROW MUST PRESERVE EVERY SITE'S ROOF.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Site ownership keeps only the CURRENT property's planes in `roofPlanes`;
 * other sites are held aside and merged back at save time. That makes every
 * consumer correct by construction — but it puts a new obligation on every
 * WRITER: send the merge, not the active set.
 *
 * There are THREE writers, not one, and the third was missed on the first pass:
 *
 *   S1  the 3s debounced autosave      saveLayoutToDB  -> POST /api/projects/[id]/layout
 *   S2  the beforeunload beacon        handleBeforeUnload -> same route
 *   S3  the SAVE BUTTON                buildLayout -> POST /api/production
 *
 * S3 builds its payload from buildSystemDefinition(), which returns the ACTIVE
 * planes — correct for engineering, wrong for storage. Pressing Save after an
 * address change would have deleted the archived property's roof from the very
 * row the autosave path preserves.
 *
 * These are source-level assertions on purpose. The failure they prevent is
 * "someone adds a fourth writer and forgets", which no unit test of the merge
 * function itself can catch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeForPersistence, partitionBySite, siteKeyFromCoords } from '@/lib/siteIdentity';
import type { RoofPlane } from '@/types';

const SRC = readFileSync(join(process.cwd(), 'components/design/DesignStudio.tsx'), 'utf8');

function plane(over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id: 'p', vertices: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1 }, { lat: 1.001, lng: 1.001 }],
    pitch: 20, azimuth: 180, area: 40, usableArea: 34, ...over,
  } as RoofPlane;
}

const KEY_A = siteKeyFromCoords(38.8, -89.5, 'proj');
const KEY_B = siteKeyFromCoords(38.9, -90.1, 'proj');

describe('every layout writer merges archived sites', () => {
  it('S1 — the debounced autosave sends the merge, not the active set', () => {
    expect(SRC).toMatch(/const planesForPersistence = mergeForPersistence\(/);
    expect(SRC).toMatch(/roofPlanes: planesForPersistence/);
  });

  it('S2 — the beforeunload beacon sends the merge', () => {
    // Two occurrences of the merge call: one per writer on this route.
    const merges = SRC.match(/mergeForPersistence\(/g) ?? [];
    expect(merges.length).toBeGreaterThanOrEqual(3); // S1, S2, S3
  });

  it('🚨 S3 — the SAVE BUTTON merges before persisting', () => {
    // buildSystemDefinition returns the ACTIVE planes (right for engineering).
    // buildLayout must not persist that directly.
    expect(SRC).toMatch(/roofPlanes: roofPlanesForStorage/);
    expect(SRC).toMatch(/const roofPlanesForStorage =[\s\S]{0,400}mergeForPersistence\(/);
  });

  it('no writer persists the bare active ref any more', () => {
    // The old shape. If it comes back, an address change starts deleting the
    // other property's roof again.
    expect(SRC).not.toMatch(/roofPlanes: roofPlanesRef\.current\b/);
    expect(SRC).not.toMatch(/roofPlanes: sysDef\.roofPlanes\b/);
  });

  it('engineering still reads the ACTIVE set — storage and engineering differ deliberately', () => {
    // buildSystemDefinition must NOT merge: the production model, tilt and
    // azimuth must only ever see the property being designed.
    const sysDef = SRC.slice(SRC.indexOf('const buildSystemDefinition'), SRC.indexOf('const buildLayout'));
    expect(sysDef).not.toMatch(/mergeForPersistence/);
    expect(sysDef).toMatch(/const effectiveRoofPlanes = roofPlanes\.length > 0/);
  });
});

describe('the merge behaviour those writers depend on', () => {
  it('a Save after an address change keeps BOTH properties', () => {
    const active = [plane({ id: 'b1', siteKey: KEY_B })];
    const archived = [plane({ id: 'a1', siteKey: KEY_A })];
    const stored = mergeForPersistence(active, archived, KEY_B);
    expect(stored.map(p => p.id).sort()).toEqual(['a1', 'b1']);
  });

  it('...and reloading at the first property brings it back intact', () => {
    const stored = mergeForPersistence(
      [plane({ id: 'b1', siteKey: KEY_B })],
      [plane({ id: 'a1', siteKey: KEY_A, source: 'manual', confirmed: true })],
      KEY_B,
    );
    const { active } = partitionBySite(JSON.parse(JSON.stringify(stored)), KEY_A);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: 'a1', source: 'manual', confirmed: true });
  });

  it('persisting with nothing archived is unchanged', () => {
    const active = [plane({ id: 'a1', siteKey: KEY_A })];
    expect(mergeForPersistence(active, [], KEY_A)).toEqual(active);
  });
});

describe('the restore seed stays in parity with the writers', () => {
  it('seeds from the MERGED set, not the active set', () => {
    // Seeding from the active set alone mismatches on the first tick and
    // re-POSTs the whole layout — the seed/writer parity defect.
    expect(SRC).toMatch(/lastSavedPanelsRef\.current = layoutSignature\(\{[\s\S]{0,300}mergeForPersistence\(/);
  });
});

describe('the two writers on the layout route carry the SAME fields', () => {
  const beacon = SRC.slice(SRC.indexOf('const handleBeforeUnload'), SRC.indexOf('navigator.sendBeacon'));

  it('the beacon now carries fence geometry and the design parameters', () => {
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
});
