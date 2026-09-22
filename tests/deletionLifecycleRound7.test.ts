/**
 * tests/deletionLifecycleRound7.test.ts
 *
 * FIVE WAYS DELETED WORK CAME BACK, OR AUTHORED WORK WENT AWAY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THESE CAME FROM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each of these was found by an independent adversary worker with a runnable
 * probe, and each was verified here before being treated as architecture. They
 * are grouped because they are one theme in five places: an operation that
 * changes what belongs to the design without going through the authority that
 * owns that question.
 *
 *   1. `redoGeometry` re-applied a deletion and minted no authorization, so
 *      every subsequent save was refused — permanently — and the geometry came
 *      back on reload.
 *   2. `undoGeometry` left the authorization for the undone deletion armed.
 *   3. A restored obstruction was never DRAWN, so a reloaded design carried
 *      invisible keep-outs that still removed panels.
 *   4. `createPanel` never stamped `layoutSource`, so Auto Layout destroyed
 *      every panel placed with the Roof tool.
 *   5. "Draw Manually Instead" and the aerial "Detect roof" door each bypassed
 *      the authority — one wiping without tombstones, the other writing a
 *      machine roof onto a property the owner had just emptied.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  authorizationForLedgerDelta,
  narrowAuthorizationToLedger,
  makeAuthorization,
  withTombstones,
  emptyLedger,
  type DeletionLedger,
} from '@/lib/design/deletionAuthority';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ENGINE = strip(read('components/3d/SolarEngine3D.tsx'));
const STUDIO = strip(read('components/design/DesignStudio.tsx'));
const HOOK = strip(read('components/design/useSiteDesign.ts'));

const KEY = 'site-abc';

/** A ledger with the given faces tombstoned at KEY. */
function ledgerWith(faceIds: string[], clearedAt = 0): DeletionLedger {
  return {
    sites: { [KEY]: { faceIds, sectionIds: [], obstructionIds: [], clearedAt } },
  };
}

const panels = [
  { id: 'p1', systemType: 'roof', planeId: 'f1' },
  { id: 'p2', systemType: 'roof', planeId: 'f1' },
  { id: 'p3', systemType: 'roof', planeId: 'f2' },
  { id: 'p4', systemType: 'fence' },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a redo is a deletion, and it must say so', () => {
  it('the delta names exactly what the step removed', () => {
    const auth = authorizationForLedgerDelta(
      ledgerWith([]), ledgerWith(['f1']), KEY, panels, 1000,
    );
    expect(auth).not.toBeNull();
    expect(auth!.faceIds).toEqual(['f1']);
    expect(auth!.siteKey).toBe(KEY);
    // 🚨 AND THE PANELS THAT STOOD ON IT. The save guard checks
    // `panelSystemTypes`, not face ids, so an authorization naming the face but
    // not its modules would still read as an unexplained loss of those modules.
    expect(auth!.panelIds.sort()).toEqual(['p1', 'p2']);
    expect(auth!.panelSystemTypes).toEqual(['roof']);
  });

  it('a face that was ALREADY tombstoned is not re-authorised', () => {
    // The delta, not the whole ledger: re-authorising an old deletion would let
    // a step grant permission far wider than the step actually took.
    const auth = authorizationForLedgerDelta(
      ledgerWith(['f1']), ledgerWith(['f1', 'f2']), KEY, panels, 1000,
    );
    expect(auth!.faceIds).toEqual(['f2']);
    expect(auth!.panelIds).toEqual(['p3']);
  });

  it('a step that removed nothing mints nothing', () => {
    // An ordinary undo of a MOVE must not hand out permission to lose anything.
    expect(authorizationForLedgerDelta(ledgerWith(['f1']), ledgerWith(['f1']), KEY, panels, 1)).toBeNull();
    expect(authorizationForLedgerDelta(emptyLedger(), emptyLedger(), KEY, panels, 1)).toBeNull();
    // An UNDO shrinks the ledger — also nothing to authorise.
    expect(authorizationForLedgerDelta(ledgerWith(['f1']), ledgerWith([]), KEY, panels, 1)).toBeNull();
  });

  it('a newly cleared property authorises every panel, including the ones with no face', () => {
    // 🚨 THE BUG THE ORIGINAL `planDeletion` HAD, IN A NEW PLACE. Filtering by
    // planeId drops every fence and ground panel, because they have none.
    const auth = authorizationForLedgerDelta(
      ledgerWith([]), ledgerWith([], 5_000), KEY, panels, 1000,
    );
    expect(auth).not.toBeNull();
    expect(auth!.op).toBe('design');
    expect(auth!.panelIds.sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(auth!.panelSystemTypes.sort()).toEqual(['fence', 'roof']);
  });

  it('an authorization does not travel to another property', () => {
    const auth = authorizationForLedgerDelta(
      ledgerWith([]), ledgerWith(['f1']), 'somewhere-else', panels, 1000,
    );
    // Nothing was tombstoned at that key, so nothing is authorised there.
    expect(auth).toBeNull();
  });

  it('null and missing ledgers are handled, not thrown on', () => {
    expect(authorizationForLedgerDelta(null, null, KEY, panels, 1)).toBeNull();
    expect(authorizationForLedgerDelta(null, ledgerWith(['f1']), KEY, [], 1)!.faceIds).toEqual(['f1']);
    expect(authorizationForLedgerDelta(undefined, ledgerWith(['f1']), KEY, null as any, 1)).not.toBeNull();
  });
});

describe('🚨 an undo takes the permission back', () => {
  it('an id the ledger no longer tombstones is dropped', () => {
    const auth = makeAuthorization('face', KEY, { faceIds: ['f1', 'f2'] }, 1);
    const narrowed = narrowAuthorizationToLedger(auth, ledgerWith(['f2']), KEY);
    expect(narrowed!.faceIds).toEqual(['f2']);
  });

  it('an authorization with nothing left is discarded entirely', () => {
    const auth = makeAuthorization('face', KEY, { faceIds: ['f1'] }, 1);
    expect(narrowAuthorizationToLedger(auth, ledgerWith([]), KEY)).toBeNull();
    expect(narrowAuthorizationToLedger(auth, emptyLedger(), KEY)).toBeNull();
  });

  it('a panel-scope authorization is left alone', () => {
    // Panels carry no ledger representation, so the ledger cannot speak for them
    // and must not be allowed to silently revoke them.
    const auth = makeAuthorization('panels', KEY, { panelIds: ['p1'], panelSystemTypes: ['roof'] }, 1);
    expect(narrowAuthorizationToLedger(auth, emptyLedger(), KEY)).toBe(auth);
  });

  it('a whole-design clear that is still recorded keeps its authorization', () => {
    // It names no ids because it removed everything; narrowing by ids would
    // throw away the one authorization that matters most.
    const auth = makeAuthorization('design', KEY, {}, 1);
    expect(narrowAuthorizationToLedger(auth, ledgerWith([], 9_000), KEY)).toBe(auth);
  });

  it('null in, null out', () => {
    expect(narrowAuthorizationToLedger(null, ledgerWith(['f1']), KEY)).toBeNull();
    expect(narrowAuthorizationToLedger(undefined, null, KEY)).toBeNull();
  });

  it('🚨 delete → undo → redo ends with a usable authorization', () => {
    // The full journey, which is what deadlocked. Redo must re-authorise what
    // the ledger now says is gone.
    const afterDelete = withTombstones(emptyLedger(), KEY, { faceIds: ['f1'], sectionIds: [], obstructionIds: [], clearedAt: 0 });
    let auth = makeAuthorization('face', KEY, { faceIds: ['f1'], panelIds: ['p1', 'p2'], panelSystemTypes: ['roof'] }, 1);

    // Undo: the ledger loses the tombstone and the permission goes with it.
    const afterUndo = emptyLedger();
    auth = narrowAuthorizationToLedger(auth, afterUndo, KEY);
    expect(auth).toBeNull();

    // Redo: the tombstone returns, and so must the permission.
    const redoAuth = authorizationForLedgerDelta(afterUndo, afterDelete, KEY, panels, 2);
    expect(redoAuth, 'the redo minted no authorization — this is the 409 deadlock').not.toBeNull();
    expect(redoAuth!.faceIds).toEqual(['f1']);
    expect(redoAuth!.panelSystemTypes).toContain('roof');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 undo and redo are wired to it', () => {
  it('redoGeometry mints from the ledger delta', () => {
    expect(HOOK).toMatch(/const beforeLedger = deletionLedgerRef\.current;/);
    expect(HOOK).toMatch(/authorizationForLedgerDelta\(\s*beforeLedger, step\.deletions/);
    // Merged, never assigned — two deletions in one debounce window.
    expect(HOOK).toMatch(/mergeAuthorization\(pendingDestructiveRef\.current, redoAuth\)/);
  });

  it('undoGeometry narrows what is armed', () => {
    expect(HOOK).toMatch(/narrowAuthorizationToLedger\(\s*pendingDestructiveRef\.current, step\.deletions/);
  });
});

describe('🚨 a restored obstruction is DRAWN, not merely remembered', () => {
  it('the restore effect draws every incoming object', () => {
    // `drawObstructionEntity` had two callers — placement and the inspector — so
    // an obstruction existed visually only in the session that created it.
    // Reload, and every vent, chimney and tree became an invisible keep-out:
    // still fed to placePanelsControlled, so still removing panels, while being
    // impossible to see, select, resize or delete.
    const at = ENGINE.indexOf('const incoming = initialObstructions ?? [];');
    expect(at, 'the obstruction restore effect is gone').toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('}, [initialObstructions]);', at));
    expect(body.length, 'the effect window collapsed').toBeGreaterThan(400);
    expect(body, 'the restore adopts the record and draws nothing')
      .toMatch(/drawObstructionEntity\(v, C, o\)/);
    // …and clears what belonged to another property.
    expect(body).toMatch(/removeObstructionEntities\(v, stale\)/);
  });

  it('which also makes Undo visually true for an obstruction', () => {
    // `restoreSiteEntities` writes `placedObstructions`, DesignStudio passes it
    // as `initialObstructions`, and the effect above now redraws — so the same
    // fix covers reload, undo and redo. One path, which is the point.
    expect(STUDIO).toMatch(/initialObstructions=\{placedObstructions\}/);
    expect(HOOK).toMatch(/restoreSiteEntities\(step\.obstructions, step\.measurements\)/);
  });
});

describe('🚨 Auto Layout does not destroy hand-placed panels', () => {
  it('createPanel stamps who placed it, defaulting to MANUAL', () => {
    // `panelsAutoRoofOwns` replaces a roof panel unless it is MANUAL, so an
    // unstamped panel was auto-owned and deleted. Every panel from the Roof tool
    // was unstamped; the Snap tool's were not — so the product destroyed
    // hand-placed work inconsistently, which is worse than always.
    expect(ENGINE).toMatch(/layoutSource\?: 'MANUAL' \| 'AUTO';/);
    expect(ENGINE).toMatch(/layoutSource: opts\.layoutSource \?\? 'MANUAL',/);
  });

  it('🚨 the DEFAULT is the safe one', () => {
    // A call site that forgets to say should cost a stale panel, never a
    // destroyed one. `?? 'AUTO'` would invert that.
    expect(ENGINE, 'an unstamped panel is auto-owned again')
      .not.toMatch(/layoutSource: opts\.layoutSource \?\? 'AUTO'/);
  });

  it('…and the automatic fill says AUTO explicitly', () => {
    const at = ENGINE.indexOf('function fillRoofSegmentWithPanels');
    expect(at).toBeGreaterThan(-1);
    const body = ENGINE.slice(at, ENGINE.indexOf('\n  function ', at + 40));
    expect(body.length).toBeGreaterThan(2000);
    expect((body.match(/layoutSource: 'AUTO'/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
});

describe('🚨 the two machine-write doors', () => {
  it('"Draw Manually Instead" routes through the deletion authority', () => {
    // A raw setRoofPlanes([]) emptied the array and nothing else: no tombstones,
    // so a provider retry put the faces back; no authorization, so the next
    // autosave looked like an unexplained wipe; no history, so no undo.
    const at = STUDIO.indexOf('Draw Manually Instead');
    expect(at, 'the button is gone').toBeGreaterThan(-1);
    const window = STUDIO.slice(Math.max(0, at - 1600), at);
    expect(window.length).toBeGreaterThan(1000);
    expect(window, 'the raw wipe is back').not.toMatch(/setRoofPlanes\(\[\]\);/);
    expect(window).toMatch(/requestDeletion\('design'\)/);
  });

  it('the aerial detect door checks the LIFECYCLE, not just the disposition', () => {
    // After Start Over the disposition is untouched — 'accepted' or 'undecided'
    // for any Google property — so this door said yes and wrote a machine roof
    // back onto the design the owner had just emptied. The ledger cannot catch
    // it: an aerial detection mints fresh UUIDs, so there is no id to refuse.
    const at = STUDIO.indexOf('if (!nativeAcquisitionPermitted(site.nativeDisposition))');
    expect(at, 'the disposition gate is gone').toBeGreaterThan(-1);
    const after = STUDIO.slice(at, at + 1400);
    expect(after).toMatch(/geometryLifecycleRef\?\.current === 'cleared' \|\| site\.geometryLifecycle === 'cleared'/);
    // The lifecycle check must come BEFORE the adoption runs.
    const gateAt = after.indexOf("=== 'cleared'");
    const adoptAt = after.indexOf('planAerialAdoption');
    expect(gateAt).toBeGreaterThan(-1);
    expect(adoptAt).toBeGreaterThan(-1);
    expect(gateAt, 'the roof is adopted before the lifecycle is consulted').toBeLessThan(adoptAt);
  });
});
