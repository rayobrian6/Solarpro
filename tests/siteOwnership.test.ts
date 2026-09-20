/**
 * tests/siteOwnership.test.ts
 *
 * WHICH PROPERTY DOES THIS ROOF BELONG TO?
 *
 * THE DEFECT
 * ----------
 * Roof geometry had no site identity. `handleLocationPick` cleared panels,
 * solarApiData and roofSegments on an address change but NOT roofPlanes, so:
 *
 *   address A detects a roof -> user picks address B -> A's planes remain in
 *   state, drawn over B's building, fed to panel layout / racking / structural /
 *   shade / BOM / permit CAD, and blocking Lane A (whose gate requires zero
 *   existing planes).
 *
 * The serious half is not the drawing: it is that a permit artifact could
 * combine one property's ROOF with another property's JURISDICTION.
 *
 * THE FIX IS OWNERSHIP, NOT DELETION
 * ----------------------------------
 * 🚨 The obvious fix — clear roofPlanes when the coordinates change — is
 * forbidden. It would silently destroy hand-traced work whenever the address
 * moved: the same class of defect as the traced-garage deletion. A coordinate
 * change is not an instruction to delete. These tests pin BOTH halves: foreign
 * geometry must never be active, AND it must never be lost.
 */

import { describe, it, expect } from 'vitest';
import {
  siteKeyFromCoords,
  isSameSite,
  partitionBySite,
  stampSite,
  mergeForPersistence,
  hasForeignSiteItems,
  SITE_KEY_PRECISION_DP,
  UNRESOLVED_SITE_KEY,
} from '@/lib/siteIdentity';
import type { RoofPlane } from '@/types';

const SITE_A = { lat: 38.89080, lng: -89.57079 }; // 1010 Franklin St, Pocahontas IL
const SITE_B = { lat: 38.70890, lng: -90.14940 }; // a different property entirely
const PROJECT = 'proj-1';

const keyA = siteKeyFromCoords(SITE_A.lat, SITE_A.lng, PROJECT);
const keyB = siteKeyFromCoords(SITE_B.lat, SITE_B.lng, PROJECT);

function plane(over: Partial<RoofPlane> = {}): RoofPlane {
  return {
    id: 'p1',
    vertices: [
      { lat: 38.8, lng: -89.5 }, { lat: 38.8001, lng: -89.5 },
      { lat: 38.8001, lng: -89.4999 }, { lat: 38.8, lng: -89.4999 },
    ],
    pitch: 22, azimuth: 180, area: 60, usableArea: 52,
    ...over,
  } as RoofPlane;
}

describe('siteKeyFromCoords', () => {
  it('is stable for the same property', () => {
    expect(siteKeyFromCoords(SITE_A.lat, SITE_A.lng, PROJECT)).toBe(keyA);
  });

  it('ignores sub-metre jitter — a re-geocode must not orphan a roof', () => {
    // 5dp is ~1.1m. Nudging the map must never read as a different building,
    // or a user loses their roof by panning.
    expect(siteKeyFromCoords(SITE_A.lat + 0.000001, SITE_A.lng - 0.000001, PROJECT)).toBe(keyA);
    expect(SITE_KEY_PRECISION_DP).toBe(5);
  });

  it('distinguishes genuinely different properties', () => {
    expect(keyB).not.toBe(keyA);
  });

  it('scopes by project — one project cannot claim another project geometry', () => {
    expect(siteKeyFromCoords(SITE_A.lat, SITE_A.lng, 'proj-1'))
      .not.toBe(siteKeyFromCoords(SITE_A.lat, SITE_A.lng, 'proj-2'));
  });

  it('returns an unresolved key for coordinates it cannot trust', () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(siteKeyFromCoords(bad as number, SITE_A.lng, PROJECT)).toBe(UNRESOLVED_SITE_KEY);
    }
  });

  it('an unresolved key matches nothing, including itself', () => {
    // Otherwise a site whose coords have not loaded would "own" every plane.
    expect(isSameSite(UNRESOLVED_SITE_KEY, UNRESOLVED_SITE_KEY)).toBe(false);
    expect(isSameSite(UNRESOLVED_SITE_KEY, keyA)).toBe(false);
  });
});

describe('partitionBySite — the stale-roof defect itself', () => {
  it('THE DEFECT: site B must not activate site A geometry', () => {
    const stored = [plane({ id: 'a1', siteKey: keyA }), plane({ id: 'a2', siteKey: keyA })];
    const { active, foreign } = partitionBySite(stored, keyB);
    expect(active).toHaveLength(0);          // nothing of A's is engineered against B
    expect(foreign).toHaveLength(2);          // ...and nothing of A's is lost
  });

  it('keeps the current site geometry active', () => {
    const stored = [plane({ id: 'a1', siteKey: keyA }), plane({ id: 'b1', siteKey: keyB })];
    const { active, foreign } = partitionBySite(stored, keyA);
    expect(active.map(p => p.id)).toEqual(['a1']);
    expect(foreign.map(p => p.id)).toEqual(['b1']);
  });

  it('ADOPTS legacy planes that predate ownership', () => {
    // Every roof traced before siteKey existed has none. Treating those as
    // foreign would make every existing user's roof vanish on upgrade — the
    // silent destruction this model exists to prevent.
    const legacy = [plane({ id: 'old' })];
    const { active, foreign } = partitionBySite(legacy, keyA);
    expect(active.map(p => p.id)).toEqual(['old']);
    expect(foreign).toHaveLength(0);
  });

  it('treats everything as active when the current site is unresolved', () => {
    // We cannot prove ownership, so we must not hide anyone's work.
    const stored = [plane({ id: 'a1', siteKey: keyA }), plane({ id: 'b1', siteKey: keyB })];
    expect(partitionBySite(stored, UNRESOLVED_SITE_KEY).active).toHaveLength(2);
  });

  it('handles empty and nullish input', () => {
    expect(partitionBySite([], keyA).active).toEqual([]);
    expect(partitionBySite(null, keyA).active).toEqual([]);
    expect(partitionBySite(undefined, keyA).foreign).toEqual([]);
  });
});

describe('stampSite — never transfers one property geometry to another', () => {
  it('stamps unowned planes', () => {
    expect(stampSite([plane({ id: 'x' })], keyA)[0].siteKey).toBe(keyA);
  });

  it('leaves a plane that already names a DIFFERENT site alone', () => {
    // Re-stamping would silently move B's roof onto A — the defect, not the fix.
    const out = stampSite([plane({ id: 'b1', siteKey: keyB })], keyA);
    expect(out[0].siteKey).toBe(keyB);
  });

  it('is a no-op for planes already owned by this site (identity preserved)', () => {
    const p = plane({ id: 'a1', siteKey: keyA });
    expect(stampSite([p], keyA)[0]).toBe(p);
  });

  it('does not stamp when the site is unresolved', () => {
    expect(stampSite([plane({ id: 'x' })], UNRESOLVED_SITE_KEY)[0].siteKey).toBeUndefined();
  });
});

describe('mergeForPersistence — nothing is ever silently deleted', () => {
  it('persists BOTH sites, not just the active one', () => {
    // Saving the active set alone would delete the other property roof from
    // the database on the next autosave tick.
    const active = [plane({ id: 'b1', siteKey: keyB })];
    const foreign = [plane({ id: 'a1', siteKey: keyA })];
    const merged = mergeForPersistence(active, foreign, keyB);
    expect(merged.map(p => p.id).sort()).toEqual(['a1', 'b1']);
  });

  it('adopts legacy active planes onto the current site on the way out', () => {
    const merged = mergeForPersistence([plane({ id: 'old' })], [], keyA);
    expect(merged[0].siteKey).toBe(keyA);
  });

  it('round-trips: save then reload then save is stable', () => {
    // The adoption write must happen ONCE. After planes carry a siteKey, a
    // reload must not keep rewriting the layout.
    const first = mergeForPersistence([plane({ id: 'old' })], [], keyA);
    const { active, foreign } = partitionBySite(first, keyA);
    const second = mergeForPersistence(active, foreign, keyA);
    expect(second).toEqual(first);
  });

  it('an empty active set still persists the other site geometry', () => {
    // Clearing THIS site roof must not clear the other one.
    const merged = mergeForPersistence([], [plane({ id: 'a1', siteKey: keyA })], keyB);
    expect(merged.map(p => p.id)).toEqual(['a1']);
  });
});

describe('the full site-change state machine', () => {
  /** Mirrors the DesignStudio effect: archive the leaving site, activate the
   *  arriving one. Kept as a pure reduction so the transition is testable
   *  without React. */
  function changeSite(
    active: RoofPlane[], foreign: RoofPlane[], fromKey: string, toKey: string,
  ): { active: RoofPlane[]; foreign: RoofPlane[] } {
    const retained = [
      ...foreign.filter(p => !isSameSite(p.siteKey, toKey)),
      ...active.map(p => (p.siteKey ? p : { ...p, siteKey: fromKey })),
    ];
    const arriving = foreign.filter(p => isSameSite(p.siteKey, toKey));
    return { active: arriving, foreign: retained };
  }

  it('A -> B archives A and leaves B empty, so Lane A may run for B', () => {
    const s0 = { active: [plane({ id: 'a1', siteKey: keyA })], foreign: [] as RoofPlane[] };
    const s1 = changeSite(s0.active, s0.foreign, keyA, keyB);
    expect(s1.active).toHaveLength(0);                    // Lane A gate sees zero -> may run
    expect(s1.foreign.map(p => p.id)).toEqual(['a1']);    // A is kept
  });

  it('A -> B -> A restores A exactly', () => {
    const s0 = { active: [plane({ id: 'a1', siteKey: keyA })], foreign: [] as RoofPlane[] };
    const s1 = changeSite(s0.active, s0.foreign, keyA, keyB);
    const s2 = changeSite(s1.active, s1.foreign, keyB, keyA);
    expect(s2.active.map(p => p.id)).toEqual(['a1']);
    expect(s2.foreign).toHaveLength(0);
  });

  it('hand-traced work survives a round trip through another site', () => {
    const traced = plane({ id: 'hand', siteKey: keyA, source: 'manual', confirmed: true });
    const s1 = changeSite([traced], [], keyA, keyB);
    const s2 = changeSite(s1.active, s1.foreign, keyB, keyA);
    expect(s2.active[0]).toMatchObject({ id: 'hand', source: 'manual', confirmed: true });
  });

  it('stamps unowned planes with the site they are LEAVING, not arriving', () => {
    // Legacy planes belong to where they were made. Stamping them with the
    // destination would transfer one property geometry to another.
    const s1 = changeSite([plane({ id: 'legacy' })], [], keyA, keyB);
    expect(s1.foreign[0].siteKey).toBe(keyA);
  });

  it('both sites survive persistence across the change', () => {
    const s0 = { active: [plane({ id: 'a1', siteKey: keyA })], foreign: [] as RoofPlane[] };
    const s1 = changeSite(s0.active, s0.foreign, keyA, keyB);
    const withB = { active: [plane({ id: 'b1', siteKey: keyB })], foreign: s1.foreign };
    const merged = mergeForPersistence(withB.active, withB.foreign, keyB);
    expect(merged.map(p => p.id).sort()).toEqual(['a1', 'b1']);
    // ...and reloading at A activates only A
    expect(partitionBySite(merged, keyA).active.map(p => p.id)).toEqual(['a1']);
  });

  it('never duplicates when the same site is re-entered twice', () => {
    const s0 = { active: [plane({ id: 'a1', siteKey: keyA })], foreign: [] as RoofPlane[] };
    const s1 = changeSite(s0.active, s0.foreign, keyA, keyB);
    const s2 = changeSite(s1.active, s1.foreign, keyB, keyA);
    const s3 = changeSite(s2.active, s2.foreign, keyA, keyB);
    const s4 = changeSite(s3.active, s3.foreign, keyB, keyA);
    expect(s4.active.map(p => p.id)).toEqual(['a1']);
    expect(mergeForPersistence(s4.active, s4.foreign, keyA)).toHaveLength(1);
  });
});

describe('hasForeignSiteItems — drives the "your other roof is kept" affordance', () => {
  it('is true when another site has geometry', () => {
    expect(hasForeignSiteItems([plane({ siteKey: keyA })], keyB)).toBe(true);
  });
  it('is false when everything belongs here', () => {
    expect(hasForeignSiteItems([plane({ siteKey: keyA })], keyA)).toBe(false);
  });
  it('is false for legacy planes (they are adopted, not foreign)', () => {
    expect(hasForeignSiteItems([plane({})], keyA)).toBe(false);
  });
});

describe('stale async responses cannot cross sites', () => {
  it('a detection stamped for A is rejected while the user is at B', () => {
    // Mirrors the DesignStudio guard: the engine stamps each detected plane
    // with the coordinate key captured at fire time; the studio drops the emit
    // if it does not match the site on screen.
    const coordsA = siteKeyFromCoords(SITE_A.lat, SITE_A.lng);
    const coordsB = siteKeyFromCoords(SITE_B.lat, SITE_B.lng);
    const emitted = [plane({ id: 'det', siteKey: coordsA })];
    const emittedFor = emitted.find(p => p.siteKey)?.siteKey;
    const shouldDrop = !!(emittedFor && coordsB && emittedFor !== coordsB);
    expect(shouldDrop).toBe(true);
  });

  it('a detection for the current site is accepted', () => {
    const coordsA = siteKeyFromCoords(SITE_A.lat, SITE_A.lng);
    const emitted = [plane({ id: 'det', siteKey: coordsA })];
    const emittedFor = emitted.find(p => p.siteKey)?.siteKey;
    const shouldDrop = !!(emittedFor && coordsA && emittedFor !== coordsA);
    expect(shouldDrop).toBe(false);
  });
});
