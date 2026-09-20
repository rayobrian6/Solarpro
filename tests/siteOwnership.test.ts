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
 *
 * WHAT THIS FILE NO LONGER COVERS, AND WHERE IT WENT
 * -------------------------------------------------
 * 🚨 This file was GREEN throughout the failure Ray hit on 3 Melvin Drive. It
 * proved lib/siteIdentity.ts — a helper that only ever governed ROOF PLANES —
 * while the product lost a 52-panel layout on the first real click. Worse, its
 * `describe('the full site-change state machine')` block contained a local
 * `changeSite()` that REIMPLEMENTED the transition inside the test. A test that
 * rebuilds the feature proves the test, not the product.
 *
 * That block and the `stampSite` / `mergeForPersistence` / `hasForeignSiteItems`
 * blocks are deleted. Those three functions no longer exist: merging every
 * property's planes back into one array was the permit-grade half of the defect
 * (see lib/siteIdentity.ts for why). The site-change machine is now
 * lib/design/siteDesignModel.ts, covered by:
 *
 *   tests/siteDesignModel.test.ts        the model, exhaustively
 *   tests/siteDesignIntegration.test.tsx the REAL hook, through React
 *
 * What remains here is the identity layer those two build on: naming a
 * property, comparing two names, and splitting a set by owner.
 */

import { describe, it, expect } from 'vitest';
import {
  siteKeyFromCoords,
  isSameSite,
  partitionBySite,
  coordKeyOf,
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

describe('coordKeyOf — the two spellings of a site key are reconciled once', () => {
  // SolarEngine3D has no project id, so it stamps detections with a COORDS-ONLY
  // key. DesignStudio holds the PROJECT-SCOPED key. Comparing them raw makes
  // every detection look foreign and drops all of them; there must be exactly
  // one place that strips the scope, and this is it.
  it('strips the project scope', () => {
    expect(coordKeyOf(keyA)).toBe(siteKeyFromCoords(SITE_A.lat, SITE_A.lng));
  });

  it('is idempotent on a key that was already coords-only', () => {
    const coordsA = siteKeyFromCoords(SITE_A.lat, SITE_A.lng);
    expect(coordKeyOf(coordsA)).toBe(coordsA);
  });

  it('🚨 a detection for THIS property survives the comparison', () => {
    // This is the half that fails silently: get it wrong and roof detection
    // simply stops working, with a console warning nobody reads.
    expect(coordKeyOf(keyA)).toBe(coordKeyOf(siteKeyFromCoords(SITE_A.lat, SITE_A.lng)));
  });

  it('a detection for ANOTHER property still does not', () => {
    expect(coordKeyOf(keyA)).not.toBe(coordKeyOf(keyB));
  });

  it('an unresolved key stays unresolved', () => {
    expect(coordKeyOf(UNRESOLVED_SITE_KEY)).toBe(UNRESOLVED_SITE_KEY);
    expect(coordKeyOf(null)).toBe(UNRESOLVED_SITE_KEY);
    expect(coordKeyOf(undefined)).toBe(UNRESOLVED_SITE_KEY);
  });

  it('a project id containing @ does not break the split', () => {
    // lastIndexOf, not indexOf: the coordinate half is always the tail.
    expect(coordKeyOf('a@b@38.89080,-89.57079')).toBe('38.89080,-89.57079');
  });
});
