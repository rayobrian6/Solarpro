/**
 * tests/restoreIdentityDrift.test.ts
 *
 * A RELOAD MUST NOT LOSE THE HOUSE YOU ARE STANDING ON.
 *
 * THE DEFECT
 * ----------
 * Site identity is MINTED from the point the user clicked in 3D, and
 * RE-DERIVED on reload from `projects.lat/lng`. Those are two different
 * coordinates, and the mount effect makes sure of it: it is documented
 * "street-level geocode always wins over stored coords" and re-geocodes any
 * address beginning with a digit — which is every address Pick House produces.
 * It then writes the geocoder's point over `projects.lat/lng` and never calls
 * changeSite.
 *
 * A 3D roof-click point and a geocoder's rooftop point essentially never agree
 * to the 1.1 m the site key quantises to. So on reload `hydrate` compared two
 * keys for ONE property, found them unequal, and took the "the columns describe
 * a different property" branch: active bundle EMPTIED, `needsAdoptionSave` set.
 *
 * 🚨 That flag is what made it destructive rather than merely confusing. It
 * forces a save of `panels: []`, and the LAYOUT_SUBSYSTEM_WIPE guard relaxes
 * precisely when the incoming activeSiteKey differs from the stored one — which
 * is exactly this condition. The design was destroyed by the mechanism built to
 * protect it, on reload, with no user action at all.
 *
 * THE FIX
 * -------
 * `hydrate` asks "is this the same PROPERTY" (`sitesAreSameProperty`, the same
 * predicate resolveSiteKey and the detection staleness guard use) instead of "is
 * this the same STRING", and keeps the key the row already stores — the archives
 * are filed under it and roof planes are stamped with it.
 */

import { describe, it, expect } from 'vitest';
import {
  hydrate, switchSite, setActiveBundle, emptyState,
  siteKeyFromCoords, sitesAreSameProperty, SITE_MATCH_RADIUS_M, isEmptyBundle,
  type SiteDesignState, type SiteDesignBundle,
} from '@/lib/design/siteDesignModel';
import type { PlacedPanel } from '@/types';

const PROJECT = 'proj-1';

// 3 Melvin Drive. CLICK is where the user clicked the roof in 3D; GEOCODE is
// where the geocoder puts the same address on reload. ~4.4 m apart — well inside
// one property and well outside the 1.1 m the key quantises to.
const CLICK = { lat: 38.70615, lng: -90.04625 };
const GEOCODE = { lat: 38.70618, lng: -90.04629 };
const NEIGHBOUR = { lat: 38.70630, lng: -90.04790 }; // a genuinely different house

const KEY_CLICK = siteKeyFromCoords(CLICK.lat, CLICK.lng, PROJECT);
const KEY_GEOCODE = siteKeyFromCoords(GEOCODE.lat, GEOCODE.lng, PROJECT);
const KEY_NEIGHBOUR = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);

function panels(tag: string, n: number): PlacedPanel[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, lat: 0, lng: 0 } as unknown as PlacedPanel));
}

function bundle(tag: string, n = 52): SiteDesignBundle {
  return {
    panels: panels(tag, n),
    roofPlanes: [], obstructions: [], measurements: [],
    designElectrical: null,
  } as unknown as SiteDesignBundle;
}

function stateAt(key: string, b: SiteDesignBundle): SiteDesignState {
  return setActiveBundle({ ...emptyState(key) }, b);
}

function storedOf(s: SiteDesignState) {
  // Exactly the shape DesignStudio hands hydrate() on mount.
  const payload = {
    panels: s.active.panels,
    roofPlanes: s.active.roofPlanes,
    obstructions: s.active.obstructions,
    measurements: s.active.measurements,
    siteArchives: { version: 1, activeSiteKey: s.activeSiteKey, sites: s.archives },
  };
  return payload as Parameters<typeof hydrate>[0];
}

describe('the fixture is honest', () => {
  it('the click and the geocode are the same property but NOT the same key', () => {
    expect(KEY_CLICK).not.toBe(KEY_GEOCODE);                  // the keys really differ
    expect(sitesAreSameProperty(KEY_CLICK, KEY_GEOCODE)).toBe(true);
  });

  it('the neighbour is genuinely a different property', () => {
    expect(sitesAreSameProperty(KEY_CLICK, KEY_NEIGHBOUR)).toBe(false);
  });

  it('the drift is realistic — metres, not centimetres, and inside the match radius', () => {
    const dLat = (GEOCODE.lat - CLICK.lat) * 111_320;
    const dLng = (GEOCODE.lng - CLICK.lng) * 111_320 * Math.cos(CLICK.lat * Math.PI / 180);
    const d = Math.hypot(dLat, dLng);
    expect(d).toBeGreaterThan(1.2);              // bigger than the key's own quantum
    expect(d).toBeLessThan(SITE_MATCH_RADIUS_M); // still one house
  });
});

describe('reload after the geocode drifts the project coordinate', () => {
  it('🚨 POSITIVE — the design stays ACTIVE and no adoption save is forced', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = hydrate(storedOf(s), KEY_GEOCODE);

    expect(r.disposition).toBe('matched');
    expect(r.state.active.panels).toHaveLength(52);
    expect(isEmptyBundle(r.state.active)).toBe(false);
    // needsAdoptionSave is what forced `panels: []` into the destructive path.
    expect(r.needsAdoptionSave).toBe(false);
  });

  it('🚨 the key that survives is the one the ROW stores, not the drifted one', () => {
    // The archives are filed under the stored key and roof planes are stamped
    // with it. Adopting the geocoder's key would orphan both.
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = hydrate(storedOf(s), KEY_GEOCODE);
    expect(r.state.activeSiteKey).toBe(KEY_CLICK);
  });

  it('the panels that come back are the SAME panels, by id', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const before = s.active.panels.map(p => p.id);
    const r = hydrate(storedOf(s), KEY_GEOCODE);
    expect(r.state.active.panels.map(p => p.id)).toEqual(before);
  });

  it('archives are carried through untouched', () => {
    let s = stateAt(KEY_NEIGHBOUR, bundle('neighbour', 9));
    s = switchSite(s, KEY_CLICK).state;
    s = setActiveBundle(s, bundle('melvin', 52));
    const r = hydrate(storedOf(s), KEY_GEOCODE);
    expect(r.disposition).toBe('matched');
    expect(r.state.active.panels).toHaveLength(52);
    expect(r.state.archives[KEY_NEIGHBOUR].panels).toHaveLength(9);
  });
});

describe('🚨 ADVERSARIAL — the old exact-string behaviour, reproduced', () => {
  it('exact equality would have emptied the active design and forced the save', () => {
    // This is what `isSameSite(parsed.activeSiteKey, siteKeyNow)` decided, and
    // it is asserted here rather than described so the regression cannot return
    // quietly: with exact matching these two keys are different, so hydrate fell
    // to `stored-active-archived`.
    expect(KEY_CLICK === KEY_GEOCODE).toBe(false);

    // And prove the destructive branch is the one that used to be taken, by
    // driving hydrate to a key that is genuinely far away.
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const far = hydrate(storedOf(s), KEY_NEIGHBOUR);
    expect(far.disposition).toBe('stored-active-archived');
    expect(isEmptyBundle(far.state.active)).toBe(true);
    expect(far.needsAdoptionSave).toBe(true);           // the destructive flag
    expect(far.state.archives[KEY_CLICK].panels).toHaveLength(52); // still not dropped
  });
});

describe('switchSite answers the property question too, not just hydrate', () => {
  // The restore path was not the only exact-string comparison. `switchSite` had
  // two: the "already here, do nothing" early return, and the lookup of the
  // bundle being entered. Both are reached with a RAW key by any caller that has
  // not resolved one, and the function is exported.

  it('a drifted key for the property already active is a NO-OP, not a move', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = switchSite(s, KEY_GEOCODE);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('same-site');
    expect(r.state.activeSiteKey).toBe(KEY_CLICK);
    expect(r.state.active.panels).toHaveLength(52);
    expect(r.archived).toBeNull();
  });

  it('a drifted key for an ARCHIVED property still finds it', () => {
    let s = stateAt(KEY_CLICK, bundle('melvin', 52));
    s = switchSite(s, KEY_NEIGHBOUR).state;
    s = setActiveBundle(s, bundle('neighbour', 9));
    // Come back with a key a few metres off the one it was filed under.
    const r = switchSite(s, KEY_GEOCODE);
    expect(r.changed).toBe(true);
    expect(r.arriving.panels).toHaveLength(52);
    expect(r.arriving.panels.map(p => p.id)).toEqual(
      Array.from({ length: 52 }, (_, i) => `melvin-${i}`),
    );
    // And the property we left is filed, not dropped.
    expect(r.state.archives[KEY_NEIGHBOUR].panels).toHaveLength(9);
  });

  it('a genuinely different property is still entered as empty', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = switchSite(s, KEY_NEIGHBOUR);
    expect(r.changed).toBe(true);
    expect(isEmptyBundle(r.arriving)).toBe(true);
    expect(r.state.archives[KEY_CLICK].panels).toHaveLength(52);
  });
});

describe('a genuinely different property is still a different property', () => {
  it('picking the neighbour archives this design rather than keeping it active', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = hydrate(storedOf(s), KEY_NEIGHBOUR);
    expect(r.disposition).toBe('stored-active-archived');
    expect(isEmptyBundle(r.state.active)).toBe(true);
    expect(r.state.archives[KEY_CLICK].panels).toHaveLength(52);
  });

  it('returning to a property the archive holds still reactivates it', () => {
    let s = stateAt(KEY_CLICK, bundle('melvin', 52));
    s = switchSite(s, KEY_NEIGHBOUR).state;
    s = setActiveBundle(s, bundle('neighbour', 9));
    // Reload, and the map resolves near — but not exactly on — the Melvin click.
    const r = hydrate(storedOf(s), KEY_GEOCODE);
    expect(r.disposition).toBe('reactivated-archive');
    expect(r.state.active.panels).toHaveLength(52);
    expect(r.state.archives[KEY_NEIGHBOUR].panels).toHaveLength(9);
  });

  it('unresolved coordinates still hide nothing', () => {
    const s = stateAt(KEY_CLICK, bundle('melvin', 52));
    const r = hydrate(storedOf(s), '');
    expect(r.disposition).toBe('unresolved');
    expect(r.state.active.panels).toHaveLength(52);
  });
});
