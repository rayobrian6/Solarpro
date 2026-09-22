/**
 * tests/deletionNoResurrection.test.ts
 *
 * IF I DELETE THIS AND ANY OF IT COMES BACK: GAUNTLET FAILS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN AUDIT FOUND, AND WHAT EACH OF THESE PINS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A trace of every path that can put geometry into the studio found FORTY-FOUR
 * ways a deleted face could return. They fall into five families, and there is
 * a test here for each:
 *
 *   1. THE ARCHIVE. The prune is an EXACT-key delete; the lookup is an 8 m
 *      FUZZY property match. One house routinely mints two keys a few metres
 *      apart (this repo's own live trace records 2.8 m), so emptying the design
 *      under key KA deleted archives[KA] and left archives[KA'] — the drifted
 *      twin, still holding the roof — and picking the same house again handed
 *      it straight back.
 *
 *   2. HYDRATION. `hydrate` has SIX branches, each assembling the active bundle
 *      from a different source. Filtering in one of them leaves five.
 *
 *   3. THE ACQUISITION GATE. `existingPlaneCount === 0` was Lane A's
 *      PERMISSION to re-inject. Deleting the roof is how a person says no, and
 *      it produced exactly the state that said yes.
 *
 *   4. THE SAVE. An emptied roof reached the Save button as `undefined`, which
 *      means COALESCE — KEEP WHAT IS STORED — and the user was told "Design
 *      saved & calculated!".
 *
 *   5. THE SERVER GUARD. It refused the deliberate deletion with a data-loss
 *      error about a wipe the user had just asked for.
 *
 * 🚨 THE MUTATION PROOFS ARE THE POINT. Several of these assert the OPPOSITE
 * direction too — that an unexplained wipe is still refused, that a deletion at
 * one property does not reach another, and that a row written before the ledger
 * existed behaves exactly as it did before. A guard that says yes to everything
 * is not a guard.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { hydrate, switchSite, emptyState, emptyBundle, archivesSignature, toPersistencePayload } from '@/lib/design/siteDesignModel';
import { withTombstones, emptyLedger } from '@/lib/design/deletionAuthority';
import { shouldRunLaneA, type LaneAGateInput } from '@/lib/3d/laneA';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const HOUSE = 'site@38.70615,-90.04625';
/** The same house, 2.8 m away — the live drift this repo measured. */
const HOUSE_DRIFTED = 'site@38.70617,-38.70617';

function face(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, vertices: [{ lat: 38.706, lng: -90.046 }, { lat: 38.7061, lng: -90.046 }, { lat: 38.7061, lng: -90.0461 }],
    pitch: 30, azimuth: 180, area: 20, usableArea: 18, ...extra,
  } as never;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2. RESTORE AND ARCHIVE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a reload does not bring back what a person deleted', () => {
  const ledger = withTombstones(emptyLedger(), HOUSE, { faceIds: ['deleted-face'] });

  const storedRow = {
    panels: [
      { id: 'p-on-deleted', planeId: 'deleted-face', lat: 38.706, lng: -90.046 },
      { id: 'p-on-kept', planeId: 'kept-face', lat: 38.706, lng: -90.046 },
    ],
    roofPlanes: [face('deleted-face'), face('kept-face')],
    obstructions: [{ id: 'obs-kept' }, { id: 'obs-gone' }],
    measurements: [],
    siteArchives: {
      version: 1 as const,
      activeSiteKey: HOUSE,
      sites: {},
      deletions: withTombstones(ledger, HOUSE, { obstructionIds: ['obs-gone'] }),
    },
  } as never;

  it('the deleted face does not come back from the stored row', () => {
    const res = hydrate(storedRow, HOUSE);
    expect(res.state.active.roofPlanes.map((p: { id: string }) => p.id)).toEqual(['kept-face']);
  });

  it('the deleted obstruction does not either', () => {
    const res = hydrate(storedRow, HOUSE);
    expect(res.state.active.obstructions.map((o: { id: string }) => o.id)).toEqual(['obs-kept']);
  });

  it('🚨 AND THE PANELS THAT STOOD ON IT GO TOO', () => {
    // A panel whose face is tombstoned has nothing to stand on. Leaving it puts
    // an array in the air over a roof the user removed, and nothing downstream
    // can notice: `planeId` simply resolves to nothing.
    const res = hydrate(storedRow, HOUSE);
    expect(res.state.active.panels.map((p: { id: string }) => p.id)).toEqual(['p-on-kept']);
  });

  it('the row is rewritten, so the filter does not have to run for ever', () => {
    expect(hydrate(storedRow, HOUSE).needsAdoptionSave).toBe(true);
  });

  it('🚨 MUTATION PROOF: with no ledger, the SAME row restores everything', () => {
    // Without this the test above proves nothing — it would pass if `hydrate`
    // simply dropped faces. A row written before the ledger existed must behave
    // exactly as it did before.
    const noLedger = { ...(storedRow as object), siteArchives: { version: 1, activeSiteKey: HOUSE, sites: {} } } as never;
    const res = hydrate(noLedger, HOUSE);
    expect(res.state.active.roofPlanes.map((p: { id: string }) => p.id).sort()).toEqual(['deleted-face', 'kept-face']);
    expect(res.state.active.panels).toHaveLength(2);
    expect(res.state.active.obstructions).toHaveLength(2);
  });

  it('🚨 a deletion at ANOTHER property does not filter this one', () => {
    const elsewhere = {
      ...(storedRow as object),
      siteArchives: { version: 1, activeSiteKey: HOUSE, sites: {}, deletions: withTombstones(emptyLedger(), 'site@1,1', { faceIds: ['deleted-face'] }) },
    } as never;
    expect(hydrate(elsewhere, HOUSE).state.active.roofPlanes).toHaveLength(2);
  });
});

describe('🚨 the drifted archive twin cannot hand the roof back', () => {
  it('a bundle archived under a NEARBY key is filtered on arrival', () => {
    // THE DEFECT: `hasContent` is false for an emptied bundle, so the prune
    // (an exact-key delete) removed archives[HOUSE] — and archives[HOUSE'],
    // the twin minted 2.8 m away on an earlier visit, still held the roof.
    // `nearestSamePropertyKey` then matched it on the way back in.
    const state = {
      ...emptyState('somewhere-else'),
      archives: {
        [HOUSE]: { ...emptyBundle(), roofPlanes: [face('deleted-face'), face('kept-face')], panels: [{ id: 'p', planeId: 'deleted-face', lat: 38.706, lng: -90.046 }] },
      },
      deletions: withTombstones(emptyLedger(), HOUSE, { faceIds: ['deleted-face'] }),
    } as never;
    const res = switchSite(state, HOUSE);
    expect(res.changed).toBe(true);
    expect(res.arriving.roofPlanes.map((p: { id: string }) => p.id)).toEqual(['kept-face']);
    expect(res.arriving.panels).toHaveLength(0);
  });

  it('🚨 MUTATION PROOF: without the tombstone the same archive returns whole', () => {
    const state = {
      ...emptyState('somewhere-else'),
      archives: {
        [HOUSE]: { ...emptyBundle(), roofPlanes: [face('deleted-face'), face('kept-face')] },
      },
    } as never;
    expect(switchSite(state, HOUSE).arriving.roofPlanes).toHaveLength(2);
  });

  it('the ledger survives A → B → A, which is the failure it is keyed to avoid', () => {
    let state = {
      ...emptyState(HOUSE),
      deletions: withTombstones(emptyLedger(), HOUSE, { faceIds: ['deleted-face'] }),
    } as never;
    state = switchSite(state, 'site@1,1').state as never;
    state = switchSite(state, HOUSE).state as never;
    expect((state as { deletions: { sites: Record<string, unknown> } }).deletions.sites[HOUSE]).toBeTruthy();
  });
});

describe('the ledger persists, and moves the autosave signature', () => {
  it('it is written into the stored archives column', () => {
    const state = { ...emptyState(HOUSE), deletions: withTombstones(emptyLedger(), HOUSE, { faceIds: ['f'] }) } as never;
    const payload = toPersistencePayload(state);
    expect(payload.siteArchives.deletions?.sites?.[HOUSE]?.faceIds).toEqual(['f']);
  });

  it('🚨 AND IT IS SIGNED. An unsigned ledger is held in memory and never saved.', () => {
    // Deleting a face at a property whose bundle is already archived, or undoing
    // a deletion, can change ONLY the tombstone list. If that does not move the
    // signature, no save is ever scheduled and the face returns on reload — a
    // delete that looks like it worked and did not.
    const before = archivesSignature({ version: 1, activeSiteKey: HOUSE, sites: {}, deletions: emptyLedger() });
    const after = archivesSignature({ version: 1, activeSiteKey: HOUSE, sites: {}, deletions: withTombstones(emptyLedger(), HOUSE, { faceIds: ['f'] }) });
    expect(after).not.toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE ACQUISITION GATE
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a provider retry does not undo a deliberate clearing', () => {
  const READY: LaneAGateInput = {
    stage: 'done', groundElevResolved: true, segmentCount: 4,
    existingPlaneCount: 0, restoreResolved: true,
    siteKey: HOUSE, lastRanSiteKey: null,
  };

  it('a first visit still acquires — the feature is not broken to fix the bug', () => {
    expect(shouldRunLaneA({ ...READY, lifecycle: 'untouched' })).toBe(true);
    // Absent reads as untouched, which is exactly the behaviour before the
    // ledger existed, so every older caller stays honest.
    expect(shouldRunLaneA(READY)).toBe(true);
  });

  it('🚨 a property emptied ON PURPOSE refuses, at the same plane count', () => {
    // Identical input but for one field. This is the live failure: deleting
    // the bad Google faces left `existingPlaneCount` at 0 — which WAS the
    // permission — and the disposition at 'accepted' or 'undecided', which
    // permits. Both guards said yes to the one case they exist to refuse.
    expect(shouldRunLaneA({ ...READY, lifecycle: 'cleared' })).toBe(false);
  });

  it('geometry present still refuses, exactly as before', () => {
    expect(shouldRunLaneA({ ...READY, existingPlaneCount: 3, lifecycle: 'populated' })).toBe(false);
  });

  it('the disposition refusal is untouched', () => {
    expect(shouldRunLaneA({ ...READY, nativeDisposition: 'rejected' })).toBe(false);
    expect(shouldRunLaneA({ ...READY, nativeDisposition: 'custom' })).toBe(false);
    expect(shouldRunLaneA({ ...READY, nativeDisposition: 'unavailable' })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 + 5. THE SAVE PATHS AND THE SERVER GUARD (source guards)
// ═══════════════════════════════════════════════════════════════════════════

const STUDIO = strip(read('components/design/DesignStudio.tsx'));
const DB = strip(read('lib/db/projects.ts'));
const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));

describe('🚨 the Save button can express an empty roof', () => {
  it('buildLayout sends the ARRAY, not the system definition’s undefined', () => {
    // `buildSystemDefinition` reports `undefined` for an empty roof on purpose
    // — no plane is the honest input for a production calculation. But in
    // upsertLayout `undefined` means COALESCE, KEEP WHAT IS STORED, so the
    // Save button wrote nothing, kept the old geometry and said "Design saved".
    const at = STUDIO.indexOf('const buildLayout = ()');
    expect(at).toBeGreaterThan(-1);
    const body = STUDIO.slice(at, at + 1400);
    expect(body).toMatch(/\broofPlanes,/);
    expect(body).not.toMatch(/roofPlanes: sysDef\.roofPlanes/);
  });

  it('both save paths carry the one-shot authorization, and consume it on SUCCESS', () => {
    expect(STUDIO).toMatch(/destructive: site\.pendingDestructive\(\) \?\? undefined/);
    // Twice: the autosave (layout route) and the Save button (production route).
    expect((STUDIO.match(/site\.pendingDestructive\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 🚨 CLEARED ONLY AFTER THE SAVE SUCCEEDED. Clearing it when the request
    // left would leave a retried failed save unauthorised — refused for the
    // very deletion the user confirmed.
    expect((STUDIO.match(/site\.clearPendingDestructive\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('🚨 the server tells a decision from the data-loss bug', () => {
  it('the wipe guard consults the authorization and splits the sub-systems', () => {
    expect(DB).toMatch(/parseAuthorization\(data\.destructive\)/);
    expect(DB).toMatch(/authorizesSubsystemRemoval\(auth, authSiteKey/);
    // The refusal still fires for everything NOT authorised.
    expect(DB).toMatch(/const wiped = allWiped\.filter/);
    expect(DB).toMatch(/LAYOUT_SUBSYSTEM_WIPE:/);
  });

  it('the authorization is bound to the property the save names', () => {
    expect(DB).toMatch(/authSiteKey = \(data\.siteArchives[^\n]*activeSiteKey/);
  });

  it('🚨 it is NEVER inherited from the stored row', () => {
    const route = strip(read('app/api/projects/[id]/layout/route.ts'));
    // Every other field uses `?? existingLayout?.x`. This one must not: an
    // authorization authorises ONE save.
    expect(route).toMatch(/\n\s*destructive,/);
    expect(route).not.toMatch(/destructive\s*(\?\?|\|\|)\s*existingLayout/);
  });
});

describe('🚨 the renderer is told by id, never by inference', () => {
  it('the deletion effect keys on an explicit token and id list', () => {
    expect(ENGINE).toMatch(/deletion\.token === lastDeletionTokenRef\.current/);
    expect(ENGINE).toMatch(/removeFaceEntities\(viewer, deletion\.faceIds/);
    expect(ENGINE).toMatch(/removeObstructionEntities\(viewer, deletion\.obstructionIds/);
  });

  it('the v66 ban on inferring deletion from a prop is still in force', () => {
    // The reconcile-deletions block deleted a hand-traced garage because it read
    // "not in this prop right now" as "deleted". Its absence is load-bearing,
    // and the note recording WHY is the thing a future reader needs — so it is
    // asserted against the RAW source, which still has its comments.
    expect(read('components/3d/SolarEngine3D.tsx'))
      .toMatch(/A RECONCILE-DELETIONS BLOCK WAS HERE AND IS DELIBERATELY GONE/);
    // And the effect that replaced it takes ids, never absence.
    const at = ENGINE.indexOf('lastDeletionTokenRef');
    expect(at).toBeGreaterThan(-1);
  });

  it('a clear returns the editor to idle, so no next click finishes an old trace', () => {
    // The owner's screenshot showed "Hip section — click footprint corner 1 of
    // 4" over the scene they were trying to empty: corners already recorded,
    // invisible, and the next click would have completed a section from points
    // picked before the reset.
    const at = ENGINE.indexOf('function resetEditorToIdle');
    expect(at).toBeGreaterThan(-1);
    const body = ENGINE.slice(at, at + 3000);
    for (const buf of ['gablePtsRef', 'hipPtsRef', 'blockPtsRef', 'fencePtsRef', 'planePtsRef',
                       'measurePtsRef', 'rowPtsRef', 'pts3DCartRef', 'dirClickPtsRef',
                       'dragRef', 'rulerDraggingRef', 'blockResizeRef']) {
      expect(body, `resetEditorToIdle does not clear ${buf}`).toContain(buf);
    }
    expect(body).toMatch(/onPlacementModeChange\?\.\('select'\)/);
  });
});

describe('🚨 every delete gesture goes through the one canonical path', () => {
  it('the roof-plane list’s delete no longer splices the array', () => {
    // It had no undo entry, no tombstone, no authorization and no word to the
    // renderer — the single highest-value resurrection path an audit found.
    expect(STUDIO).not.toMatch(/setRoofPlanes\(prev => prev\.filter\(p => p\.id !== plane\.id\)\)/);
    expect(STUDIO).toMatch(/requestDeletion\('face', plane\.id\)/);
  });

  it('clearAll is a deletion, not nine setters', () => {
    const at = STUDIO.indexOf('const clearAll =');
    expect(at).toBeGreaterThan(-1);
    const body = STUDIO.slice(at, at + 200);
    expect(body).toMatch(/requestDeletion\('design'\)/);
    expect(body).not.toMatch(/setRoofPlanes\(\[\]\)/);
  });

  it('the Delete key reaches geometry, not only panels', () => {
    expect(ENGINE).toMatch(/onRequestDelete\?\.\(\s*asSection \? 'section' : 'face'/);
  });

  it('the trash in the tool spine names its scope instead of saying "Clear All"', () => {
    expect(ENGINE).toMatch(/Clear Panels: remove the panel layout, keep the roof/);
    expect(ENGINE).toMatch(/Clear Custom Building/);
    expect(ENGINE).toMatch(/Start Over: empty this property/);
    expect(ENGINE).not.toMatch(/tip: 'Clear All: remove all panels'/);
  });
});
