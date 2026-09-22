/**
 * tests/deletionAuthority.test.ts
 *
 * DELETE MEANS GONE, AND "GONE" NEEDED SOMEWHERE TO BE WRITTEN DOWN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "old roof/building geometry remains visible, failed/previous attempts
 *    remain in the scene, Save fails, starting another Building tool can pile
 *    new geometry on top of old geometry, previous work can reappear, and I do
 *    not have a trustworthy way to delete one bad piece or completely start
 *    over."
 *
 * Every clause was a separate defect and they shared one cause: nothing in the
 * data model could express INTENT. `roofPlanes.length === 0` was the same
 * integer whether a property had never been modelled or had just been emptied
 * on purpose, so the renderer, the acquisition gate and the save guard each
 * guessed, and the guesses disagreed.
 *
 * These are the unit-level proofs for `lib/design/deletionAuthority.ts`. The
 * wiring proofs — that every restore path, the gate and the server guard
 * actually consult it — are in tests/deletionNoResurrection.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyLedger, ledgerSite, withTombstones, withoutTombstones, withTombstonesRemoved,
  parseDeletionLedger, faceIsDeleted, obstructionIsDeleted, admitFaces, admitObstructions,
  lifecycleFor, acquisitionPermittedByLifecycle,
  makeAuthorization, parseAuthorization, authorizesSubsystemRemoval,
  planDeletion, tombstonesFor, authorizationFor, ceremonyFor, titleFor,
  type DeletionPlanInput,
} from '@/lib/design/deletionAuthority';

const KEY = 'site@38.70615,-90.04625';
const OTHER = 'site@38.70630,-90.04620';
const NOW = 1_758_000_000_000;

function face(id: string, extra: Record<string, unknown> = {}) {
  return { id, source: 'manual', ...extra } as never;
}

function plan(over: Partial<DeletionPlanInput> = {}) {
  const base: DeletionPlanInput = {
    scope: 'face', siteKey: KEY, targetId: 'f1',
    faces: [], panels: [], obstructions: [], measurementCount: 0, now: NOW,
  };
  return planDeletion({ ...base, ...over });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LEDGER
// ═══════════════════════════════════════════════════════════════════════════

describe('the ledger records intent, keyed by property', () => {
  it('an empty ledger says nothing was deleted anywhere', () => {
    const l = emptyLedger();
    expect(faceIsDeleted(l, KEY, face('f1'))).toBe(false);
    expect(ledgerSite(l, KEY)).toEqual({ faceIds: [], sectionIds: [], obstructionIds: [], clearedAt: 0 });
  });

  it('a tombstone is filed against ONE property and does not reach the neighbour', () => {
    const l = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'] });
    expect(faceIsDeleted(l, KEY, face('f1'))).toBe(true);
    // 🚨 THE WHOLE POINT OF THE KEY. 3 Melvin Drive geocodes ~17 m onto the
    // next house; a deletion that leaked across would remove a face from a
    // property the installer had never opened.
    expect(faceIsDeleted(l, OTHER, face('f1'))).toBe(false);
  });

  it("a section's tombstone covers every face it owns, including a rebuilt one", () => {
    const l = withTombstones(emptyLedger(), KEY, { sectionIds: ['sec-garage'] });
    // Face ids are `${sectionId}::${key}` and are DETERMINISTIC, so a rebuild
    // mints the same id. The section is the durable half of the identity.
    expect(faceIsDeleted(l, KEY, face('sec-garage::slopeA', { sectionId: 'sec-garage' }))).toBe(true);
    expect(faceIsDeleted(l, KEY, face('other::slopeA', { sectionId: 'other' }))).toBe(false);
    // …and via the carried record, not only the flat field.
    expect(faceIsDeleted(l, KEY, face('x', { section: { id: 'sec-garage' } }))).toBe(true);
  });

  it('🚨 a site with nothing recorded is DELETED from the map, not stored empty', () => {
    // Absence and "nothing was removed here" must be ONE state. Two spellings
    // of one fact is a way for two readers to disagree.
    const l = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'] });
    const back = withTombstonesRemoved(l, KEY, { faceIds: ['f1'] });
    expect(Object.keys(back.sites)).toEqual([]);
  });

  it('an unresolved site key records nothing rather than filing against ""', () => {
    const l = withTombstones(emptyLedger(), '', { faceIds: ['f1'] });
    expect(Object.keys(l.sites)).toEqual([]);
  });

  it('withoutTombstones forgets one property and leaves the others', () => {
    let l = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'] });
    l = withTombstones(l, OTHER, { faceIds: ['f9'] });
    const after = withoutTombstones(l, KEY);
    expect(faceIsDeleted(after, KEY, face('f1'))).toBe(false);
    expect(faceIsDeleted(after, OTHER, face('f9'))).toBe(true);
  });

  it('parses tolerantly: junk degrades to "nothing was deleted", never to "everything was"', () => {
    expect(parseDeletionLedger(null)).toEqual({ sites: {} });
    expect(parseDeletionLedger('nope')).toEqual({ sites: {} });
    expect(parseDeletionLedger({ sites: 'nope' })).toEqual({ sites: {} });
    expect(parseDeletionLedger({ sites: { [KEY]: { faceIds: ['a', 7, null], clearedAt: 'x' } } }))
      .toEqual({ sites: { [KEY]: { faceIds: ['a'], sectionIds: [], obstructionIds: [], clearedAt: 0 } } });
  });

  it('round-trips through JSON, which is how it is persisted', () => {
    const l = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'], clearedAt: NOW });
    expect(parseDeletionLedger(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });
});

describe('admit — the filter every reconstruction path runs through', () => {
  it('separates what may come back from what may not, and reports both', () => {
    const l = withTombstones(emptyLedger(), KEY, { faceIds: ['gone'] });
    const r = admitFaces(l, KEY, [face('keep'), face('gone')]);
    expect(r.admitted.map((f: { id: string }) => f.id)).toEqual(['keep']);
    expect(r.refused.map((f: { id: string }) => f.id)).toEqual(['gone']);
  });

  it('obstructions too', () => {
    const l = withTombstones(emptyLedger(), KEY, { obstructionIds: ['o2'] });
    expect(obstructionIsDeleted(l, KEY, 'o2')).toBe(true);
    const r = admitObstructions(l, KEY, [{ id: 'o1' }, { id: 'o2' }]);
    expect(r.admitted).toEqual([{ id: 'o1' }]);
  });

  it('a null/undefined input is an empty admit, not a crash', () => {
    expect(admitFaces(null, KEY, null).admitted).toEqual([]);
    expect(admitObstructions(emptyLedger(), '', undefined).admitted).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIFECYCLE — closing `existingPlaneCount`
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 lifecycle says what a plane count of zero cannot', () => {
  it('no geometry and no deletions is a first visit — acquisition MAY run', () => {
    expect(lifecycleFor(emptyLedger(), KEY, 0)).toBe('untouched');
    expect(acquisitionPermittedByLifecycle('untouched')).toBe(true);
  });

  it('geometry present refuses, exactly as the plane count always did', () => {
    expect(lifecycleFor(emptyLedger(), KEY, 3)).toBe('populated');
    expect(acquisitionPermittedByLifecycle('populated')).toBe(false);
  });

  it('🚨 THE CASE THE COUNT COULD NOT EXPRESS: emptied ON PURPOSE refuses', () => {
    // Identical plane count to the first test. Opposite answer. This is the
    // whole reason the lifecycle exists: deleting the bad faces IS how a person
    // says no, and reading zero as permission re-injected what they removed.
    const cleared = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'], clearedAt: NOW });
    expect(lifecycleFor(cleared, KEY, 0)).toBe('cleared');
    expect(acquisitionPermittedByLifecycle('cleared')).toBe(false);
  });

  it('one deleted face is enough — a person does not have to empty the roof', () => {
    const one = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'] });
    expect(lifecycleFor(one, KEY, 0)).toBe('cleared');
  });

  it('and a deletion at the NEIGHBOUR does not block acquisition here', () => {
    const elsewhere = withTombstones(emptyLedger(), OTHER, { faceIds: ['f1'], clearedAt: NOW });
    expect(lifecycleFor(elsewhere, KEY, 0)).toBe('untouched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ONE-SHOT AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the save guard can tell a decision from the data-loss bug', () => {
  const auth = makeAuthorization('panels', KEY, { panelSystemTypes: ['roof'] }, NOW);

  it('authorises the sub-system it names, at the property it names', () => {
    expect(authorizesSubsystemRemoval(auth, KEY, 'roof')).toBe(true);
  });

  it('🚨 AND NOTHING ELSE. A payload of zero panels is not authorization.', () => {
    // This is the exact signature of the July reload wipe (81 panels -> {} ->
    // 19 in three saves). It must still be refused, or the guard is gone.
    expect(authorizesSubsystemRemoval(null, KEY, 'roof')).toBe(false);
    expect(authorizesSubsystemRemoval(undefined, KEY, 'roof')).toBe(false);
  });

  it('does not travel to another property', () => {
    expect(authorizesSubsystemRemoval(auth, OTHER, 'roof')).toBe(false);
  });

  it('does not cover a sub-system it never mentioned', () => {
    // Clearing the roof array is not consent to lose the ground mount.
    expect(authorizesSubsystemRemoval(auth, KEY, 'ground')).toBe(false);
    expect(authorizesSubsystemRemoval(auth, KEY, 'fence')).toBe(false);
  });

  it('an unresolved key on either side refuses — the safe direction', () => {
    expect(authorizesSubsystemRemoval(makeAuthorization('panels', '', { panelSystemTypes: ['roof'] }, NOW), KEY, 'roof')).toBe(false);
    expect(authorizesSubsystemRemoval(auth, '', 'roof')).toBe(false);
  });

  it('an absent systemType is read as roof, matching the server census', () => {
    expect(authorizesSubsystemRemoval(auth, KEY, null)).toBe(true);
  });

  it('parses only a well-formed token; anything else is no authorization', () => {
    expect(parseAuthorization(null)).toBeNull();
    expect(parseAuthorization({ op: 'nonsense', siteKey: KEY })).toBeNull();
    expect(parseAuthorization({ op: 'panels' })).toBeNull();         // no siteKey
    expect(parseAuthorization({ op: 'panels', siteKey: KEY })).toMatchObject({ op: 'panels', panelSystemTypes: [] });
  });

  it('survives the JSON round trip it makes over the wire', () => {
    expect(parseAuthorization(JSON.parse(JSON.stringify(auth)))).toEqual(auth);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PLANNING — say what will go, before it goes
// ═══════════════════════════════════════════════════════════════════════════

describe('a plan walks the ownership graph, it does not splice an array', () => {
  const gable = [
    face('sec-1::slopeA', { sectionId: 'sec-1', section: { id: 'sec-1', kind: 'gable' } }),
    face('sec-1::slopeB', { sectionId: 'sec-1', section: { id: 'sec-1', kind: 'gable' } }),
  ];
  const panels = [
    { id: 'p1', planeId: 'sec-1::slopeA', systemType: 'roof' },
    { id: 'p2', planeId: 'sec-1::slopeB', systemType: 'roof' },
    { id: 'p3', planeId: 'standalone', systemType: 'roof' },
    { id: 'pf', planeId: '', systemType: 'fence' },
  ] as never[];

  it('deleting a section takes its faces AND the panels standing on them', () => {
    const r = plan({ scope: 'section', targetId: 'sec-1', faces: gable, panels });
    expect(r.ok).toBe(true);
    expect(r.faceIds.sort()).toEqual(['sec-1::slopeA', 'sec-1::slopeB']);
    expect(r.sectionIds).toEqual(['sec-1']);
    expect(r.panelIds.sort()).toEqual(['p1', 'p2']);
    // 🚨 AND NOT THE OTHERS. A panel on a different face, and a fence panel in
    // the yard, have nothing to do with this section.
    expect(r.panelIds).not.toContain('p3');
    expect(r.panelIds).not.toContain('pf');
  });

  it('…and says so in words before it happens', () => {
    const r = plan({ scope: 'section', targetId: 'sec-1', faces: gable, panels });
    expect(r.lines).toContain('2 roof faces');
    expect(r.lines.some(l => l.includes('1 building section') && l.includes('walls'))).toBe(true);
    expect(r.lines.some(l => l.startsWith('2 panels'))).toBe(true);
  });

  it('🚨 REFUSES to delete ONE face of a multi-face section, and explains', () => {
    // A gable's two slopes are DERIVED from one footprint and one ridge. There
    // is no such object as half a gable, so this cannot be expressed as a
    // smaller section — and rebuilding it into a shed would silently change the
    // house. Refusing with a remedy is the honest one of the four options.
    const r = plan({ scope: 'face', targetId: 'sec-1::slopeA', faces: gable, panels });
    expect(r.ok).toBe(false);
    expect(r.refusal).toMatch(/one of 2 .*gable/);
    expect(r.refusalRemedy).toMatch(/Delete the whole section instead/);
    // 🚨 UNIFORM SHAPE: a refusal still carries arrays, because this repo has
    // no strictNullChecks and `plan.faceIds.length` on a refusal would throw.
    expect(r.faceIds).toEqual([]);
    expect(r.panelIds).toEqual([]);
  });

  it('a ONE-face section IS its face — deleting it removes the section too', () => {
    const flat = [face('sec-2::deck', { sectionId: 'sec-2', section: { id: 'sec-2', kind: 'flat' } })];
    const r = plan({ scope: 'face', targetId: 'sec-2::deck', faces: flat });
    expect(r.ok).toBe(true);
    expect(r.sectionIds).toEqual(['sec-2']);
  });

  it('a standalone face deletes on its own, and owns no section', () => {
    const r = plan({ scope: 'face', targetId: 'solo', faces: [face('solo')], panels: [{ id: 'p', planeId: 'solo' }] as never[] });
    expect(r.ok).toBe(true);
    expect(r.faceIds).toEqual(['solo']);
    expect(r.sectionIds).toEqual([]);
    expect(r.panelIds).toEqual(['p']);
  });

  it('Clear Custom Building removes hand-built faces and LEAVES Google ones', () => {
    const mixed = [face('hand'), face('goog', { source: 'solar_api' })];
    const r = plan({ scope: 'customBuilding', faces: mixed });
    expect(r.ok).toBe(true);
    expect(r.faceIds).toEqual(['hand']);
    // Not a whole-property clear: a Google face still governs here, so
    // acquisition is not re-opened and the property is not marked cleared.
    expect(r.clearsProperty).toBe(false);
  });

  it('…and when nothing but hand-built work is present, it IS a property clear', () => {
    const r = plan({ scope: 'customBuilding', faces: [face('a'), face('b')] });
    expect(r.clearsProperty).toBe(true);
  });

  it('Start Over takes everything, including measurements', () => {
    const r = plan({
      scope: 'design',
      faces: [face('a'), face('goog', { source: 'solar_api' })],
      panels: [{ id: 'p1' }, { id: 'pf', systemType: 'fence' }] as never[],
      obstructions: [{ id: 'o1' }],
      measurementCount: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.faceIds.sort()).toEqual(['a', 'goog']);
    expect(r.obstructionIds).toEqual(['o1']);
    expect(r.panelIds.sort()).toEqual(['p1', 'pf']);
    expect(r.clearsProperty).toBe(true);
    expect(r.clearsMeasurements).toBe(true);
    expect(r.lines).toContain('2 measurements');
  });

  it('Clear Panels touches the geometry not at all', () => {
    const r = plan({ scope: 'panels', faces: [face('a')], panels: [{ id: 'p1' }] as never[] });
    expect(r.ok).toBe(true);
    expect(r.faceIds).toEqual([]);
    expect(r.sectionIds).toEqual([]);
    expect(r.panelIds).toEqual(['p1']);
    expect(r.clearsProperty).toBe(false);
  });

  it('refuses gracefully when the target is already gone', () => {
    expect(plan({ scope: 'face', targetId: 'ghost', faces: [] }).ok).toBe(false);
    expect(plan({ scope: 'section', targetId: 'ghost', faces: [] }).ok).toBe(false);
    expect(plan({ scope: 'obstruction', targetId: 'ghost' }).ok).toBe(false);
    expect(plan({ scope: 'panels' }).refusal).toMatch(/no panels/i);
    expect(plan({ scope: 'design' }).refusal).toMatch(/already empty/i);
  });
});

describe('ceremony — the small ones must stay cheap', () => {
  it('🚨 a single face is ONE CLICK AND AN UNDO, not a modal', () => {
    // The opposite failure is real: if deleting one traced face costs a dialog,
    // people stop trying things, and an editor you are afraid to experiment in
    // is not usable at any level of correctness.
    expect(ceremonyFor('face')).toBe('undoable');
    expect(ceremonyFor('section')).toBe('undoable');
    expect(ceremonyFor('obstruction')).toBe('undoable');
  });

  it('the three that cannot be a slip ask first', () => {
    expect(ceremonyFor('panels')).toBe('confirm');
    expect(ceremonyFor('customBuilding')).toBe('confirm');
    expect(ceremonyFor('design')).toBe('confirm');
  });

  it('every scope has a title in the user’s words, not a code', () => {
    for (const s of ['face', 'section', 'obstruction', 'panels', 'customBuilding', 'design'] as const) {
      expect(titleFor(s)).toMatch(/^[A-Z]/);
      expect(titleFor(s)).not.toMatch(/_/);
    }
  });
});

describe('a plan produces exactly the tombstones and the authorization it described', () => {
  it('the tombstones match the plan, and clearedAt is set only by a property clear', () => {
    const one = plan({ scope: 'face', targetId: 'solo', faces: [face('solo')] });
    expect(tombstonesFor(one, NOW)).toEqual({
      faceIds: ['solo'], sectionIds: [], obstructionIds: [], clearedAt: 0,
    });
    const all = plan({ scope: 'design', faces: [face('solo')] });
    expect(tombstonesFor(all, NOW).clearedAt).toBe(NOW);
  });

  it('the authorization names every sub-system the plan removes and no other', () => {
    const p = plan({
      scope: 'design',
      faces: [face('a')],
      panels: [{ id: 'p1', systemType: 'roof' }, { id: 'p2', systemType: 'fence' }] as never[],
    });
    const a = authorizationFor(p, KEY, NOW);
    expect(a.panelSystemTypes.sort()).toEqual(['fence', 'roof']);
    expect(authorizesSubsystemRemoval(a, KEY, 'fence')).toBe(true);
    expect(authorizesSubsystemRemoval(a, KEY, 'ground')).toBe(false);
  });
});
