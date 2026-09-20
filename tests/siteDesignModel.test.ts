/**
 * tests/siteDesignModel.test.ts
 *
 * THE MELVIN REGRESSION, AT THE MODEL LAYER.
 *
 * Ray's first real acceptance test of Phase 2: open 3 Melvin Drive with its
 * panel layout, pick the house next door, pick Melvin again — the panels never
 * came back. tests/siteOwnership.test.ts was green throughout, because it
 * tested lib/siteIdentity.ts, a helper that only ever governed ROOF PLANES.
 * Proving the helper is not proving the product.
 *
 * These tests own the whole site-bound design state: panels, roof planes,
 * placed obstructions and measurements move together or the model is wrong.
 *
 * 🚨 IDENTITY, NOT COUNTS. Every round-trip assertion compares entity IDs.
 * "52 panels came back" is satisfied by 52 of the wrong property's panels.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyBundle, emptyState, isEmptyBundle, bundleEntityCount,
  switchSite, setActiveBundle, hydrate, parseStoredArchives,
  toPersistencePayload, archivesSignature,
  siteKeyFromCoords, SITE_BOUND_ENTITY_KEYS, SITE_ARCHIVE_VERSION,
  resolveSiteKey, coordsOfSiteKey, sitesAreSameProperty, SITE_MATCH_RADIUS_M,
  type SiteDesignBundle, type SiteDesignState,
} from '@/lib/design/siteDesignModel';
import { UNSIGNED_ELECTRICAL_FIELDS } from '@/lib/roofPlanesSignature';
import { coordKeyOf } from '@/lib/siteIdentity';
import type { PlacedPanel, RoofPlane, PlacedObstruction, LayoutMeasurement } from '@/types';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
// 3 Melvin Drive and the house next door — the exact coordinates from the row
// Ray's failing test wrote.
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };
const THIRD = { lat: 38.70640, lng: -90.04610 };

const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_B = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);
const KEY_C = siteKeyFromCoords(THIRD.lat, THIRD.lng, PROJECT);

// ── Fixtures ────────────────────────────────────────────────────────────────
const panel = (id: string): PlacedPanel => ({ id, lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400 } as unknown as PlacedPanel);
const plane = (id: string, siteKey?: string): RoofPlane =>
  ({ id, vertices: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }], pitch: 20, azimuth: 180, ...(siteKey ? { siteKey } : {}) } as unknown as RoofPlane);
const obstruction = (id: string): PlacedObstruction =>
  ({ id, lat: MELVIN.lat, lng: MELVIN.lng, height: 3, radiusM: 1, type: 'vent' });
const measurement = (id: string): LayoutMeasurement =>
  ({ id, a: { lat: 1, lng: 1 }, b: { lat: 1, lng: 2 }, horizDistM: 5, slopeDistM: 5.2 });

function bundle(prefix: string, n = 3): SiteDesignBundle {
  return {
    panels: Array.from({ length: n }, (_, i) => panel(`${prefix}-panel-${i}`)),
    roofPlanes: Array.from({ length: 2 }, (_, i) => plane(`${prefix}-plane-${i}`)),
    obstructions: [obstruction(`${prefix}-obs-0`)],
    measurements: [measurement(`${prefix}-meas-0`)],
    designElectrical: null,
  };
}

const ids = (b: SiteDesignBundle) => ({
  panels: b.panels.map(p => p.id),
  roofPlanes: b.roofPlanes.map(p => p.id),
  obstructions: b.obstructions.map(o => o.id),
  measurements: b.measurements.map(m => m.id),
});

function stateAt(key: string, b: SiteDesignBundle): SiteDesignState {
  return { version: SITE_ARCHIVE_VERSION, activeSiteKey: key, active: b, archives: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the bundle covers every site-bound entity', () => {
  it('an empty bundle has every declared entity as an empty array', () => {
    const b = emptyBundle();
    for (const k of SITE_BOUND_ENTITY_KEYS) expect(Array.isArray(b[k]), k).toBe(true);
    expect(isEmptyBundle(b)).toBe(true);
    expect(bundleEntityCount(b)).toBe(0);
  });

  it('🚨 panels are site-bound — the entity the Melvin failure lost', () => {
    // If this list ever loses 'panels' the Melvin defect is back by definition.
    expect(SITE_BOUND_ENTITY_KEYS).toContain('panels');
    expect(SITE_BOUND_ENTITY_KEYS).toContain('roofPlanes');
    expect(SITE_BOUND_ENTITY_KEYS).toContain('obstructions');
    expect(SITE_BOUND_ENTITY_KEYS).toContain('measurements');
  });

  it('a non-empty bundle reports its entity count across all four arrays', () => {
    expect(bundleEntityCount(bundle('a'))).toBe(3 + 2 + 1 + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A → B → A — the exact failure Ray reported', () => {
  const A = bundle('A', 52); // 52 panels: the real Melvin count

  it('EXACT state returns, by ID, for every entity', () => {
    let s = stateAt(KEY_A, A);
    const before = ids(s.active);

    const toB = switchSite(s, KEY_B);
    s = toB.state;
    expect(toB.changed).toBe(true);
    // B is a property with no design yet — the screen is empty…
    expect(isEmptyBundle(toB.arriving)).toBe(true);
    // …but A is intact in the archive, not gone.
    expect(ids(s.archives[KEY_A])).toEqual(before);

    const backToA = switchSite(s, KEY_A);
    s = backToA.state;
    expect(backToA.changed).toBe(true);
    expect(ids(backToA.arriving)).toEqual(before);
    expect(ids(s.active)).toEqual(before);
    expect(s.active.panels).toHaveLength(52);
  });

  it('the returning bundle is the SAME objects, not a reconstruction', () => {
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    const back = switchSite(s, KEY_A);
    expect(back.arriving.panels[0]).toBe(A.panels[0]);
    expect(back.arriving.roofPlanes[0]).toBe(A.roofPlanes[0]);
    expect(back.arriving.obstructions[0]).toBe(A.obstructions[0]);
    expect(back.arriving.measurements[0]).toBe(A.measurements[0]);
  });

  it('🚨 a site is NEVER both active and archived', () => {
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    expect(Object.keys(s.archives)).toEqual([KEY_A]);
    s = setActiveBundle(s, bundle('B', 4)); // design something at B so it is kept
    s = switchSite(s, KEY_A).state;
    expect(s.archives[KEY_A]).toBeUndefined();
    expect(Object.keys(s.archives)).toEqual([KEY_B]);
  });

  it('work done at B is kept when returning to A, and does not touch A', () => {
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    const B = bundle('B', 7);
    s = setActiveBundle(s, B);
    s = switchSite(s, KEY_A).state;
    expect(ids(s.active)).toEqual(ids(A));
    expect(ids(s.archives[KEY_B])).toEqual(ids(B));
    s = switchSite(s, KEY_B).state;
    expect(ids(s.active)).toEqual(ids(B));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A → B → C → A and rapid switching', () => {
  it('three properties each keep their own design', () => {
    const A = bundle('A', 5), B = bundle('B', 6), C = bundle('C', 7);
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state; s = setActiveBundle(s, B);
    s = switchSite(s, KEY_C).state; s = setActiveBundle(s, C);
    s = switchSite(s, KEY_A).state;
    expect(ids(s.active)).toEqual(ids(A));
    expect(Object.keys(s.archives).sort()).toEqual([KEY_B, KEY_C].sort());
    s = switchSite(s, KEY_C).state; expect(ids(s.active)).toEqual(ids(C));
    s = switchSite(s, KEY_B).state; expect(ids(s.active)).toEqual(ids(B));
  });

  it('A → B → A → B → A, twenty times, loses nothing and grows nothing', () => {
    const A = bundle('A', 52);
    const B = bundle('B', 4);
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    s = setActiveBundle(s, B);           // B has work of its own
    s = switchSite(s, KEY_A).state;
    for (let i = 0; i < 20; i++) {
      s = switchSite(s, KEY_B).state;
      s = switchSite(s, KEY_A).state;
    }
    expect(ids(s.active)).toEqual(ids(A));
    expect(ids(s.archives[KEY_B])).toEqual(ids(B));
    // One archive entry for B — not twenty.
    expect(Object.keys(s.archives)).toEqual([KEY_B]);
  });

  it('switching to the site already active is a no-op, not an archive', () => {
    const A = bundle('A');
    const s = stateAt(KEY_A, A);
    const r = switchSite(s, KEY_A);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('same-site');
    expect(r.state).toBe(s);
    expect(Object.keys(r.state.archives)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('refusals — the model will not guess', () => {
  it('an unresolved TARGET key changes nothing', () => {
    const s = stateAt(KEY_A, bundle('A'));
    const r = switchSite(s, '');
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('unresolved-target');
    expect(r.state).toBe(s);
    expect(ids(r.state.active)).toEqual(ids(s.active));
  });

  it('an unresolved SOURCE key adopts rather than archives', () => {
    // Ownership was never decided (the restore has not resolved). Archiving
    // here would file the design under a key it may not belong to.
    const A = bundle('A');
    const s = emptyState();
    const r = switchSite({ ...s, active: A }, KEY_A);
    expect(r.reason).toBe('unresolved-source');
    expect(r.state.activeSiteKey).toBe(KEY_A);
    expect(ids(r.state.active)).toEqual(ids(A));
    expect(Object.keys(r.state.archives)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the archive is bounded by properties DESIGNED at, not properties VISITED', () => {
  it('🚨 touring ten houses without designing does not grow the column', () => {
    // `site_archives` rides on EVERY autosave. An entry per property visited
    // would make a user who toured ten houses carry ten empty objects in every
    // request, for ever, with no way to shed them.
    let s = stateAt(KEY_A, emptyBundle());
    for (let i = 0; i < 10; i++) {
      s = switchSite(s, siteKeyFromCoords(38.7 + i * 0.001, -90.05, PROJECT)).state;
    }
    expect(Object.keys(s.archives)).toEqual([]);
  });

  it('…and a property that WAS designed at is still kept', () => {
    let s = stateAt(KEY_A, bundle('A', 52));
    s = switchSite(s, KEY_B).state;
    s = switchSite(s, KEY_C).state; // B was empty — pruned; A was not
    expect(Object.keys(s.archives)).toEqual([KEY_A]);
    s = switchSite(s, KEY_A).state;
    expect(s.active.panels).toHaveLength(52);
  });

  it('a bundle with no entities but a chosen electrical design is kept', () => {
    // "Nothing placed yet" is not "nothing done".
    let s = stateAt(KEY_A, { ...emptyBundle(), designElectrical: { topology: 'micro', modulesPerString: 1 } as never });
    s = switchSite(s, KEY_B).state;
    expect(Object.keys(s.archives)).toEqual([KEY_A]);
  });

  it('a bundle with only a fence line is kept — it is geometry', () => {
    let s = stateAt(KEY_A, { ...emptyBundle(), scalars: { fenceLine: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } });
    s = switchSite(s, KEY_B).state;
    expect(Object.keys(s.archives)).toEqual([KEY_A]);
    s = switchSite(s, KEY_A).state;
    expect(s.active.scalars?.fenceLine).toHaveLength(2);
  });

  it('address/mapCenter provenance alone does NOT count as content', () => {
    // They are stamped on every switch, so counting them would make every
    // bundle non-empty and defeat the pruning entirely.
    let s = stateAt(KEY_A, { ...emptyBundle(), address: 'somewhere', mapCenter: { lat: 1, lng: 2 } });
    s = switchSite(s, KEY_B).state;
    expect(Object.keys(s.archives)).toEqual([]);
  });

  it('an emptied property is REMOVED from the archive, not left as junk', () => {
    let s = stateAt(KEY_A, bundle('A'));
    s = switchSite(s, KEY_B).state;          // A archived
    s = switchSite(s, KEY_A).state;          // A active again
    s = setActiveBundle(s, emptyBundle());   // the user clears A on purpose
    s = switchSite(s, KEY_B).state;          // leave it
    expect(Object.keys(s.archives)).toEqual([]);
    s = switchSite(s, KEY_A).state;          // …and it comes back CLEARED
    expect(isEmptyBundle(s.active)).toBe(true);
  });
});

describe('deliberate deletion still works — hiding is not deleting', () => {
  it('a site cleared on purpose comes back CLEARED, not full', () => {
    const A = bundle('A');
    let s = stateAt(KEY_A, A);
    // The user deletes everything at A on purpose.
    s = setActiveBundle(s, emptyBundle());
    s = switchSite(s, KEY_B).state;
    s = switchSite(s, KEY_A).state;
    expect(isEmptyBundle(s.active)).toBe(true);
  });

  it('clearing site B cannot clear site A', () => {
    const A = bundle('A', 52);
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    s = setActiveBundle(s, bundle('B'));
    s = setActiveBundle(s, emptyBundle()); // clear B
    s = switchSite(s, KEY_A).state;
    expect(s.active.panels).toHaveLength(52);
    expect(ids(s.active)).toEqual(ids(A));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('persistence — only the active site reaches the layout columns', () => {
  it('🚨 foreign sites are NOT in panels/roofPlanes/obstructions/measurements', () => {
    const A = bundle('A', 52), B = bundle('B', 9);
    let s = stateAt(KEY_A, A);
    s = switchSite(s, KEY_B).state;
    s = setActiveBundle(s, B);
    const p = toPersistencePayload(s);
    expect(p.panels.map(x => x.id)).toEqual(B.panels.map(x => x.id));
    expect(p.roofPlanes.map(x => x.id)).toEqual(B.roofPlanes.map(x => x.id));
    expect(p.obstructions.map(x => x.id)).toEqual(B.obstructions.map(x => x.id));
    expect(p.measurements.map(x => x.id)).toEqual(B.measurements.map(x => x.id));
    // …and A is carried, whole, in the column nothing downstream reads.
    expect(p.siteArchives.activeSiteKey).toBe(KEY_B);
    expect(ids(p.siteArchives.sites[KEY_A])).toEqual(ids(A));
  });

  it('a project that never left one site stores an empty archive', () => {
    const p = toPersistencePayload(stateAt(KEY_A, bundle('A')));
    expect(p.siteArchives.sites).toEqual({});
    expect(p.siteArchives.activeSiteKey).toBe(KEY_A);
  });

  it('the stored shape round-trips through parseStoredArchives', () => {
    let s = stateAt(KEY_A, bundle('A', 52));
    s = switchSite(s, KEY_B).state;
    const stored = toPersistencePayload(s).siteArchives;
    const round = parseStoredArchives(JSON.parse(JSON.stringify(stored)));
    expect(round).not.toBeNull();
    expect(round!.activeSiteKey).toBe(KEY_B);
    expect(ids(round!.sites[KEY_A])).toEqual(ids(s.archives[KEY_A]));
  });

  it('a malformed or absent stored column degrades to null, never throws', () => {
    for (const bad of [null, undefined, 0, 'x', [], {}, { sites: 1 }]) {
      expect(() => parseStoredArchives(bad)).not.toThrow();
      expect(parseStoredArchives(bad)).toBeNull();
    }
    // A recognisable header with junk sites yields an empty archive, not a throw.
    const r = parseStoredArchives({ activeSiteKey: KEY_A, sites: { [KEY_B]: 'nonsense' } });
    expect(r!.activeSiteKey).toBe(KEY_A);
    expect(isEmptyBundle(r!.sites[KEY_B])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('hydration', () => {
  const storedOf = (s: SiteDesignState) => {
    const p = toPersistencePayload(s);
    return { panels: p.panels, roofPlanes: p.roofPlanes, obstructions: p.obstructions, measurements: p.measurements, siteArchives: p.siteArchives };
  };

  it('reload at the site the columns describe — normal path', () => {
    let s = stateAt(KEY_A, bundle('A', 52));
    s = switchSite(s, KEY_B).state;
    const r = hydrate(storedOf(s), KEY_B);
    expect(r.disposition).toBe('matched');
    expect(r.needsAdoptionSave).toBe(false);
    expect(isEmptyBundle(r.state.active)).toBe(true);
    expect(r.state.archives[KEY_A].panels).toHaveLength(52);
  });

  it('🚨 reload while standing at a site the archive holds — it comes back', () => {
    let s = stateAt(KEY_A, bundle('A', 52));
    s = switchSite(s, KEY_B).state;
    s = setActiveBundle(s, bundle('B', 9));
    const stored = storedOf(s);
    // The page reloads and the map resolves to A.
    const r = hydrate(stored, KEY_A);
    expect(r.disposition).toBe('reactivated-archive');
    expect(r.state.active.panels).toHaveLength(52);
    // B was the stored active set — archived, not discarded.
    expect(r.state.archives[KEY_B].panels).toHaveLength(9);
  });

  it('reload at a site nothing is stored for — empty, and nothing is lost', () => {
    const s = stateAt(KEY_A, bundle('A', 52));
    const r = hydrate(storedOf(s), KEY_C);
    expect(r.disposition).toBe('stored-active-archived');
    expect(isEmptyBundle(r.state.active)).toBe(true);
    expect(r.state.archives[KEY_A].panels).toHaveLength(52);
  });

  it('unresolved coordinates hide nothing', () => {
    const s = stateAt(KEY_A, bundle('A', 52));
    const r = hydrate(storedOf(s), '');
    expect(r.disposition).toBe('unresolved');
    expect(r.state.active.panels).toHaveLength(52);
  });

  describe('🚨 a row whose ownership was never decided', () => {
    // A project with no stored lat/lng resolves to UNRESOLVED_SITE_KEY at
    // restore time, so every save that follows writes `activeSiteKey: ""`.
    // This is the second open of that project, once the coordinates are known.
    const unknownCoords = () => hydrate(
      { panels: [panel('p1'), panel('p2')], roofPlanes: [plane('r1')], obstructions: [obstruction('o1')], measurements: [] },
      '',
    );

    it('the first open persists an EMPTY active key — that is the input', () => {
      const first = unknownCoords();
      expect(first.disposition).toBe('unresolved');
      expect(toPersistencePayload(first.state).siteArchives.activeSiteKey).toBe('');
    });

    it('🚨 the second open ADOPTS it — it is neither dropped nor archived away', () => {
      // Without this the design was neither active nor archived: `''` is not
      // the current site, and the archival step skipped it because `''` is
      // falsy. It was simply gone, on the second open of every project created
      // before its first geocode landed.
      const written = toPersistencePayload(unknownCoords().state);
      const second = hydrate(JSON.parse(JSON.stringify(written)), KEY_A);
      expect(second.disposition).toBe('adopted-legacy');
      expect(second.needsAdoptionSave).toBe(true);
      expect(second.state.activeSiteKey).toBe(KEY_A);
      expect(second.state.active.panels.map(p => p.id)).toEqual(['p1', 'p2']);
      expect(second.state.active.roofPlanes.map(p => p.id)).toEqual(['r1']);
      expect(second.state.active.obstructions.map(o => o.id)).toEqual(['o1']);
    });

    it('…and any archive it was already carrying is kept', () => {
      const stored = {
        panels: [panel('p1')], roofPlanes: [], obstructions: [], measurements: [],
        siteArchives: { version: 1, activeSiteKey: '', sites: { [KEY_B]: bundle('B', 4) } },
      };
      const r = hydrate(JSON.parse(JSON.stringify(stored)), KEY_A);
      expect(r.state.active.panels).toHaveLength(1);
      expect(r.state.archives[KEY_B].panels).toHaveLength(4);
    });

    it('the adoption settles — the third open needs no further save', () => {
      const written = toPersistencePayload(unknownCoords().state);
      const second = hydrate(JSON.parse(JSON.stringify(written)), KEY_A);
      const third = hydrate(JSON.parse(JSON.stringify(toPersistencePayload(second.state))), KEY_A);
      expect(third.disposition).toBe('matched');
      expect(third.needsAdoptionSave).toBe(false);
      expect(third.state.active.panels).toHaveLength(2);
    });

    it('🚨 NO hydration path can lose the stored active set', () => {
      // The invariant, stated directly. Whatever the row says, the columns end
      // up either on screen or in the archive — never nowhere.
      const stored = {
        panels: [panel('keep-me')], roofPlanes: [], obstructions: [], measurements: [],
      };
      for (const archiveHeader of [
        undefined,
        { version: 1, activeSiteKey: '', sites: {} },
        { version: 1, activeSiteKey: KEY_A, sites: {} },
        { version: 1, activeSiteKey: KEY_B, sites: {} },
        { version: 1, activeSiteKey: KEY_C, sites: { [KEY_B]: emptyBundle() } },
      ]) {
        for (const now of [KEY_A, KEY_B, '']) {
          const r = hydrate(JSON.parse(JSON.stringify({ ...stored, siteArchives: archiveHeader })), now);
          const everywhere = [
            ...r.state.active.panels,
            ...Object.values(r.state.archives).flatMap(b => b.panels),
          ].map(p => p.id);
          expect(everywhere, `lost with header=${JSON.stringify(archiveHeader)} at=${now || '<unresolved>'}`)
            .toContain('keep-me');
        }
      }
    });
  });

  describe('legacy rows', () => {
    it('a row with no archives column is ADOPTED onto the current site', () => {
      const legacy = { panels: [panel('p1'), panel('p2')], roofPlanes: [plane('r1')], obstructions: [], measurements: [] };
      const r = hydrate(legacy, KEY_A);
      expect(r.disposition).toBe('adopted-legacy');
      expect(r.needsAdoptionSave).toBe(true);
      expect(r.state.active.panels.map(p => p.id)).toEqual(['p1', 'p2']);
      expect(r.state.activeSiteKey).toBe(KEY_A);
    });

    it('🚨 THE MELVIN ROW — a merged multi-site roof array is SPLIT on open', () => {
      // The real row: 6 planes for Melvin, 4 for a second site, 3 for the
      // neighbour, all in one column, all reaching pvwatts and the permit.
      const legacy = {
        panels: Array.from({ length: 52 }, (_, i) => panel(`mp${i}`)),
        roofPlanes: [
          ...Array.from({ length: 6 }, (_, i) => plane(`a${i}`, KEY_A)),
          ...Array.from({ length: 4 }, (_, i) => plane(`b${i}`, KEY_B)),
          ...Array.from({ length: 3 }, (_, i) => plane(`c${i}`, KEY_C)),
        ],
        obstructions: [], measurements: [],
      };
      const r = hydrate(legacy, KEY_A);
      expect(r.disposition).toBe('adopted-legacy');
      expect(r.needsAdoptionSave).toBe(true);
      // Only Melvin's six planes stay active.
      expect(r.state.active.roofPlanes.map(p => p.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
      expect(r.state.archives[KEY_B].roofPlanes).toHaveLength(4);
      expect(r.state.archives[KEY_C].roofPlanes).toHaveLength(3);
      // Nothing was dropped.
      const total = r.state.active.roofPlanes.length
        + Object.values(r.state.archives).reduce((n, b) => n + b.roofPlanes.length, 0);
      expect(total).toBe(13);
      // The panels stay with the active site — they are Melvin's.
      expect(r.state.active.panels).toHaveLength(52);
      // And the very next persistence carries only Melvin's roof in the column.
      expect(toPersistencePayload(r.state).roofPlanes).toHaveLength(6);
    });

    it('unstamped planes in a mixed legacy row are adopted, not archived', () => {
      const legacy = {
        panels: [], obstructions: [], measurements: [],
        roofPlanes: [plane('old'), plane('b0', KEY_B)],
      };
      const r = hydrate(legacy, KEY_A);
      expect(r.state.active.roofPlanes.map(p => p.id)).toEqual(['old']);
      expect(r.state.archives[KEY_B].roofPlanes.map(p => p.id)).toEqual(['b0']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 picking the same house twice must not mint a second property', () => {
  // THE LIVE TRACE THIS EXISTS FOR — project 4030b664, 2026-09-20, from
  // project_versions. Three identities for ONE building in 43 seconds:
  //   v202 16:11:53  @38.70615,-90.04625
  //   v204 16:13:46  @38.70630,-90.04620   (~17 m)
  //   v205 16:13:57  @38.70613,-90.04627   (~19 m)
  // Nothing was lost — each was archived correctly — but the user picked their
  // own house again and got an empty roof, which is the original complaint.
  const CLICK_1 = { lat: 38.70615, lng: -90.04625 };
  const CLICK_2 = { lat: 38.70613, lng: -90.04627 }; // same roof, ~2.8 m away
  const FAR = { lat: 38.70890, lng: -90.14940 };      // a different property entirely

  it('a second click on the same roof reuses the first key', () => {
    const s = stateAt(siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT), bundle('A', 52));
    const r = resolveSiteKey(s, CLICK_2.lat, CLICK_2.lng, PROJECT);
    expect(r.matchedExisting).toBe(true);
    expect(r.key).toBe(s.activeSiteKey);
    expect(r.distanceM!).toBeLessThan(SITE_MATCH_RADIUS_M);
  });

  it('…so A → B → A returns the design even when the return click is metres off', () => {
    let s = stateAt(siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT), bundle('A', 52));
    const before = ids(s.active);
    s = switchSite(s, KEY_B).state;
    // The user clicks their own roof again — 2.8 m from where they clicked before.
    const back = resolveSiteKey(s, CLICK_2.lat, CLICK_2.lng, PROJECT);
    expect(back.matchedExisting).toBe(true);
    s = switchSite(s, back.key).state;
    expect(ids(s.active)).toEqual(before);
    expect(s.active.panels).toHaveLength(52);
  });

  it('an ARCHIVED property is matched too, not just the active one', () => {
    let s = stateAt(siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT), bundle('A', 52));
    s = switchSite(s, KEY_B).state;             // A is now archived
    s = setActiveBundle(s, bundle('B', 4));
    const r = resolveSiteKey(s, CLICK_2.lat, CLICK_2.lng, PROJECT);
    expect(r.matchedExisting).toBe(true);
    expect(r.key).toBe(siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT));
  });

  it('🚨 a genuinely different property is NOT absorbed', () => {
    const s = stateAt(siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT), bundle('A'));
    const r = resolveSiteKey(s, FAR.lat, FAR.lng, PROJECT);
    expect(r.matchedExisting).toBe(false);
    expect(r.key).toBe(siteKeyFromCoords(FAR.lat, FAR.lng, PROJECT));
  });

  it('🚨 the NEAREST known site wins — the neighbour still reaches the neighbour', () => {
    // 3 and 5 Melvin Drive are ~17 m apart, inside the match radius of each
    // other. Snapping to the FIRST match in range would make one unreachable;
    // snapping to the NEAREST keeps both addressable.
    const keyA = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
    const keyB = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);
    let s = stateAt(keyA, bundle('A'));
    s = switchSite(s, keyB).state;
    s = setActiveBundle(s, bundle('B'));
    // A click right on the neighbour resolves to the neighbour …
    expect(resolveSiteKey(s, NEIGHBOUR.lat + 0.00001, NEIGHBOUR.lng, PROJECT).key).toBe(keyB);
    // … and a click right on Melvin resolves to Melvin.
    expect(resolveSiteKey(s, MELVIN.lat + 0.00001, MELVIN.lng, PROJECT).key).toBe(keyA);
  });

  it('with nothing known yet it mints a fresh key', () => {
    const r = resolveSiteKey(emptyState(), MELVIN.lat, MELVIN.lng, PROJECT);
    expect(r.matchedExisting).toBe(false);
    expect(r.key).toBe(KEY_A);
  });

  it('unresolvable coordinates stay unresolved', () => {
    const s = stateAt(KEY_A, bundle('A'));
    expect(resolveSiteKey(s, null, null, PROJECT).key).toBe('');
    expect(resolveSiteKey(s, NaN, 1, PROJECT).key).toBe('');
  });

  describe('🚨 sitesAreSameProperty — ONE definition, or the snap fix breaks detection', () => {
    // Found by a second session reviewing the snap fix, not by this file.
    // SolarEngine3D has no access to the resolver: it stamps the RAW
    // coordinates it detected at. resolveSiteKey deliberately makes the active
    // key differ from the current click's coordinate after a snap — so
    // DesignStudio's stale-detection guard, which compared the two strings with
    // `!==`, dropped EVERY roof detection on returning to a house.
    const snappedActive = siteKeyFromCoords(CLICK_1.lat, CLICK_1.lng, PROJECT);
    const engineStamped = siteKeyFromCoords(CLICK_2.lat, CLICK_2.lng); // coords-only, as the engine emits

    it('a detection stamped 2.8 m from the snapped active key is NOT stale', () => {
      expect(snappedActive).not.toBe(engineStamped);              // the strings differ …
      expect(coordKeyOf(snappedActive)).not.toBe(engineStamped);  // … even scope-stripped
      expect(sitesAreSameProperty(coordKeyOf(snappedActive), engineStamped)).toBe(true);
    });

    it('a detection for the actual neighbour IS still stale', () => {
      const neighbourStamped = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng);
      expect(sitesAreSameProperty(coordKeyOf(snappedActive), neighbourStamped)).toBe(false);
    });

    it('it agrees with resolveSiteKey, which is the point', () => {
      // If these two ever disagree, the codebase holds two answers to "is this
      // the same property" — which is the defect, not the fix.
      const s = stateAt(snappedActive, bundle('A'));
      const r = resolveSiteKey(s, CLICK_2.lat, CLICK_2.lng, PROJECT);
      expect(r.matchedExisting).toBe(sitesAreSameProperty(coordKeyOf(snappedActive), engineStamped));
    });

    it('identical keys short-circuit, and nullish is never a match', () => {
      expect(sitesAreSameProperty(KEY_A, KEY_A)).toBe(true);
      expect(sitesAreSameProperty(null, KEY_A)).toBe(false);
      expect(sitesAreSameProperty(KEY_A, '')).toBe(false);
      expect(sitesAreSameProperty('nonsense', 'other')).toBe(false);
    });
  });

  it('coordsOfSiteKey round-trips, and survives an @ in the project id', () => {
    const c = coordsOfSiteKey(KEY_A)!;
    expect(c.lat).toBeCloseTo(38.70615, 5);
    expect(c.lng).toBeCloseTo(-90.04625, 5);
    expect(coordsOfSiteKey('a@b@38.70615,-90.04625')!.lat).toBeCloseTo(38.70615, 5);
    expect(coordsOfSiteKey('')).toBeNull();
    expect(coordsOfSiteKey('nonsense')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the archives signature', () => {
  it('identical content signs identically, any time apart', () => {
    let s = stateAt(KEY_A, bundle('A', 52));
    s = switchSite(s, KEY_B).state;
    const a1 = archivesSignature(toPersistencePayload(s).siteArchives);
    const a2 = archivesSignature(parseStoredArchives(JSON.parse(JSON.stringify(toPersistencePayload(s).siteArchives))));
    expect(a1).toBe(a2);
  });

  it('archive key ORDER does not change the signature', () => {
    const base = { version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, sites: { [KEY_B]: bundle('B'), [KEY_C]: bundle('C') } };
    const flipped = { version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, sites: { [KEY_C]: base.sites[KEY_C], [KEY_B]: base.sites[KEY_B] } };
    expect(archivesSignature(base)).toBe(archivesSignature(flipped));
  });

  it('🚨 provenance and timestamps do NOT move the signature', () => {
    // A field that changes when nothing changed makes the dedup dead and turns
    // every tick into a DB write — the `generatedAt` defect, again.
    const b1 = { ...bundle('B'), address: 'one', mapCenter: { lat: 1, lng: 2 } };
    const b2 = { ...b1, address: 'two', mapCenter: { lat: 9, lng: 9 } };
    const mk = (b: SiteDesignBundle) => ({ version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, sites: { [KEY_B]: b } });
    expect(archivesSignature(mk(b1))).toBe(archivesSignature(mk(b2)));

    const de1 = { topology: 'string', modulesPerString: 10, generatedAt: '2026-01-01T00:00:00Z' } as never;
    const de2 = { topology: 'string', modulesPerString: 10, generatedAt: '2026-09-20T14:18:35Z' } as never;
    expect(archivesSignature(mk({ ...bundle('B'), designElectrical: de1 })))
      .toBe(archivesSignature(mk({ ...bundle('B'), designElectrical: de2 })));
  });

  it('the unsigned-field rule matches lib/roofPlanesSignature.ts', () => {
    // Two modules must not disagree about which fields are content.
    expect([...UNSIGNED_ELECTRICAL_FIELDS]).toEqual(['generatedAt']);
  });

  it('archived CONTENT changing DOES move the signature', () => {
    const mk = (b: SiteDesignBundle) => ({ version: SITE_ARCHIVE_VERSION as 1, activeSiteKey: KEY_A, sites: { [KEY_B]: b } });
    expect(archivesSignature(mk(bundle('B', 3)))).not.toBe(archivesSignature(mk(bundle('B', 4))));
  });

  it('moving house with no other edit changes the signature', () => {
    // Otherwise the row keeps claiming the previous property forever.
    const sites = { [KEY_C]: bundle('C') };
    expect(archivesSignature({ version: 1, activeSiteKey: KEY_A, sites }))
      .not.toBe(archivesSignature({ version: 1, activeSiteKey: KEY_B, sites }));
  });

  it('a switch that archived an empty bundle still signs differently', () => {
    // "I left an empty property" is information: it must reach the database.
    let s = stateAt(KEY_A, emptyBundle());
    const before = archivesSignature(toPersistencePayload(s).siteArchives);
    s = switchSite(s, KEY_B).state;
    expect(archivesSignature(toPersistencePayload(s).siteArchives)).not.toBe(before);
  });
});
