/** @vitest-environment jsdom */
/**
 * tests/siteDesignIntegration.test.tsx
 *
 * THE MELVIN REGRESSION, THROUGH THE REAL HOOK.
 *
 * tests/siteDesignModel.test.ts proves the pure model. That is not enough, and
 * the Melvin failure is exactly why: tests/siteOwnership.test.ts proved
 * lib/siteIdentity.ts in the same way and stayed green while the product lost
 * a 52-panel layout on the first real click.
 *
 * These tests run `useSiteDesign` — the hook Design Studio actually uses, with
 * React's real state, real refs and real batching — through the sequence Ray
 * performed, plus every adversarial ordering around it: a save reading refs
 * mid-switch, a detection response landing after the user has moved on, a
 * reload at either property, a deliberate delete.
 *
 * 🚨 EVERY ASSERTION COMPARES IDS. "52 panels came back" is satisfied by 52 of
 * the neighbour's panels.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSiteDesign } from '@/components/design/useSiteDesign';
import { siteKeyFromCoords } from '@/lib/siteIdentity';
import { archivesSignature } from '@/lib/design/siteDesignModel';
import type { PlacedPanel, RoofPlane, PlacedObstruction, LayoutMeasurement } from '@/types';

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const MELVIN = { lat: 38.70615257709013, lng: -90.04625419301613 };
const NEIGHBOUR = { lat: 38.70629, lng: -90.04620 };
const THIRD = { lat: 38.70640, lng: -90.04610 };
const KEY_A = siteKeyFromCoords(MELVIN.lat, MELVIN.lng, PROJECT);
const KEY_B = siteKeyFromCoords(NEIGHBOUR.lat, NEIGHBOUR.lng, PROJECT);
const KEY_C = siteKeyFromCoords(THIRD.lat, THIRD.lng, PROJECT);

const panel = (id: string): PlacedPanel => ({ id, lat: MELVIN.lat, lng: MELVIN.lng, wattage: 400 } as unknown as PlacedPanel);
const plane = (id: string): RoofPlane =>
  ({ id, vertices: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }], pitch: 20, azimuth: 180 } as unknown as RoofPlane);
const obstruction = (id: string): PlacedObstruction => ({ id, lat: 1, lng: 1, height: 3, radiusM: 1, type: 'vent' });
const measurement = (id: string): LayoutMeasurement => ({ id, a: { lat: 1, lng: 1 }, b: { lat: 1, lng: 2 }, horizDistM: 5, slopeDistM: 5.2 });

type Hook = ReturnType<typeof useSiteDesign>;

/** Seed a site exactly as the studio does: through the public setters. */
function seed(r: { current: Hook }, prefix: string, panelCount: number) {
  act(() => {
    r.current.setPanels(Array.from({ length: panelCount }, (_, i) => panel(`${prefix}-p${i}`)));
    r.current.setRoofPlanes([plane(`${prefix}-r0`), plane(`${prefix}-r1`)]);
    r.current.setPlacedObstructions([obstruction(`${prefix}-o0`)]);
    r.current.setMeasurements([measurement(`${prefix}-m0`)]);
  });
}

const seen = (r: { current: Hook }) => ({
  panels: r.current.panels.map(p => p.id),
  roofPlanes: r.current.roofPlanes.map(p => p.id),
  obstructions: r.current.placedObstructions.map(o => o.id),
  measurements: r.current.measurements.map(m => m.id),
});

/** What a save path would read RIGHT NOW — refs, not rendered state. */
const refs = (r: { current: Hook }) => ({
  panels: r.current.panelsRef.current.map(p => p.id),
  roofPlanes: r.current.roofPlanesRef.current.map(p => p.id),
  obstructions: r.current.placedObstructionsRef.current.map(o => o.id),
  measurements: r.current.measurementsRef.current.map(m => m.id),
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 the exact sequence Ray ran on 3 Melvin Drive', () => {
  it('A → B → A returns every entity, by ID', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'melvin', 52);
    const before = seen(r.result);
    expect(before.panels).toHaveLength(52);

    // 2. pick the house next door
    act(() => { r.result.current.switchToSite(KEY_B); });
    // 3. Melvin's design leaves the screen …
    expect(seen(r.result)).toEqual({ panels: [], roofPlanes: [], obstructions: [], measurements: [] });
    // … and the refs every save path reads agree, immediately.
    expect(refs(r.result)).toEqual({ panels: [], roofPlanes: [], obstructions: [], measurements: [] });
    // … but it is KEPT, and the UI can say so.
    expect(r.result.current.archivedSiteCount).toBe(1);
    expect(r.result.current.archivedEntityCount).toBe(52 + 2 + 1 + 1);

    // 4. pick Melvin again
    act(() => { r.result.current.switchToSite(KEY_A); });
    // 5. THE PANELS COME BACK — this is the assertion that was failing.
    expect(seen(r.result)).toEqual(before);
    expect(refs(r.result)).toEqual(before);
    expect(r.result.current.archivedEntityCount).toBe(0);
  });

  it('the panels that come back are Melvin\'s, not the neighbour\'s', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'melvin', 52);
    act(() => { r.result.current.switchToSite(KEY_B); });
    seed(r.result, 'neighbour', 52); // same COUNT, different property
    act(() => { r.result.current.switchToSite(KEY_A); });
    expect(r.result.current.panels).toHaveLength(52);
    expect(r.result.current.panels.every(p => p.id.startsWith('melvin-'))).toBe(true);
  });

  it('A → B → C → A, then back round', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 5);
    const a = seen(r.result);
    act(() => { r.result.current.switchToSite(KEY_B); }); seed(r.result, 'B', 6);
    const b = seen(r.result);
    act(() => { r.result.current.switchToSite(KEY_C); }); seed(r.result, 'C', 7);
    const c = seen(r.result);
    act(() => { r.result.current.switchToSite(KEY_A); });
    expect(seen(r.result)).toEqual(a);
    act(() => { r.result.current.switchToSite(KEY_C); });
    expect(seen(r.result)).toEqual(c);
    act(() => { r.result.current.switchToSite(KEY_B); });
    expect(seen(r.result)).toEqual(b);
  });

  it('rapid A → B → A, twenty times, in one act()', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 52);
    const a = seen(r.result);
    act(() => {
      for (let i = 0; i < 20; i++) {
        r.result.current.switchToSite(KEY_B);
        r.result.current.switchToSite(KEY_A);
      }
    });
    expect(seen(r.result)).toEqual(a);
    expect(r.result.current.archivedSiteCount).toBe(1); // B, once — not twenty
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 the refs a save path reads never lag the state', () => {
  it('a setter updates the ref synchronously, before any re-render', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    // Deliberately OUTSIDE act(): this is the window a debounced save fires in.
    r.result.current.setPanels([panel('x'), panel('y')]);
    expect(r.result.current.panelsRef.current.map(p => p.id)).toEqual(['x', 'y']);
  });

  it('a switch updates every ref synchronously', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 3);
    r.result.current.switchToSite(KEY_B);
    // A save firing here must persist B's empty design, not A's three panels.
    expect(refs(r.result)).toEqual({ panels: [], roofPlanes: [], obstructions: [], measurements: [] });
  });

  it('functional updates compose correctly against the ref', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    act(() => {
      r.result.current.setPanels([panel('a')]);
      r.result.current.setPanels(prev => [...prev, panel('b')]);
      r.result.current.setPanels(prev => [...prev, panel('c')]);
    });
    expect(r.result.current.panels.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(r.result.current.panelsRef.current.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('an edit made between two switches is archived, not the pre-edit value', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 3);
    // Edit outside act(), then switch immediately — the archive must hold the
    // edited array. A ref maintained by useEffect would archive the old one.
    r.result.current.setPanels([panel('edited')]);
    r.result.current.switchToSite(KEY_B);
    act(() => { r.result.current.switchToSite(KEY_A); });
    expect(r.result.current.panels.map(p => p.id)).toEqual(['edited']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 stale async responses', () => {
  it('a response issued at A is not current after switching to B', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    const token = r.result.current.scope();          // detection requested at A
    expect(r.result.current.isCurrent(token)).toBe(true);
    act(() => { r.result.current.switchToSite(KEY_B); });
    expect(r.result.current.isCurrent(token)).toBe(false); // …lands at B: drop it
  });

  it('A → B → A within a request\'s lifetime still invalidates it', () => {
    // The key is the same again, but the design in between was replaced, so an
    // answer computed against the first visit is no longer about what is on
    // screen. The epoch catches what the key alone cannot.
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    const token = r.result.current.scope();
    act(() => {
      r.result.current.switchToSite(KEY_B);
      r.result.current.switchToSite(KEY_A);
    });
    expect(r.result.current.scope().siteKey).toBe(token.siteKey);
    expect(r.result.current.isCurrent(token)).toBe(false);
  });

  it('a request that resolves with no switch in between is applied', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    const token = r.result.current.scope();
    act(() => { r.result.current.setPanels([panel('p')]); }); // editing is not switching
    expect(r.result.current.isCurrent(token)).toBe(true);
  });

  it('a null/absent token is never current', () => {
    const r = renderHook(() => useSiteDesign());
    expect(r.result.current.isCurrent(null)).toBe(false);
    expect(r.result.current.isCurrent(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what reaches the database', () => {
  it('🚨 the layout columns carry ONE property; the archive carries the rest', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'melvin', 52);
    act(() => { r.result.current.switchToSite(KEY_B); });
    seed(r.result, 'neighbour', 9);

    const p = r.result.current.persistencePayload();
    expect(p.panels.map(x => x.id).every(id => id.startsWith('neighbour-'))).toBe(true);
    expect(p.panels).toHaveLength(9);
    expect(p.roofPlanes.every(x => x.id.startsWith('neighbour-'))).toBe(true);
    expect(p.siteArchives.activeSiteKey).toBe(KEY_B);
    expect(p.siteArchives.sites[KEY_A].panels).toHaveLength(52);
    // The active site is never ALSO in the archive.
    expect(p.siteArchives.sites[KEY_B]).toBeUndefined();
  });

  it('the payload reflects an edit made without a re-render', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    r.result.current.setPanels([panel('late')]);
    expect(r.result.current.persistencePayload().panels.map(p => p.id)).toEqual(['late']);
  });

  it('the archive signature is stable when nothing changed', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 5);
    act(() => { r.result.current.switchToSite(KEY_B); });
    const s1 = archivesSignature(r.result.current.storedArchives());
    const s2 = archivesSignature(r.result.current.storedArchives());
    expect(s1).toBe(s2);
  });

  it('the archive signature MOVES when a property is archived', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 5);
    const before = archivesSignature(r.result.current.storedArchives());
    act(() => { r.result.current.switchToSite(KEY_B); });
    expect(archivesSignature(r.result.current.storedArchives())).not.toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reload', () => {
  it('reload at B, then walk back to A — Melvin is intact', () => {
    const first = renderHook(() => useSiteDesign());
    act(() => { first.result.current.hydrateFromStored(null, KEY_A); });
    seed(first.result, 'melvin', 52);
    act(() => { first.result.current.switchToSite(KEY_B); });
    seed(first.result, 'neighbour', 9);
    const saved = first.result.current.persistencePayload();

    // Page reload: a brand-new hook, fed the row that was written.
    const second = renderHook(() => useSiteDesign());
    let disposition = '';
    act(() => {
      disposition = second.result.current.hydrateFromStored({
        panels: saved.panels, roofPlanes: saved.roofPlanes,
        obstructions: saved.obstructions, measurements: saved.measurements,
        siteArchives: JSON.parse(JSON.stringify(saved.siteArchives)),
      }, KEY_B).disposition;
    });
    expect(disposition).toBe('matched');
    expect(second.result.current.panels.every(p => p.id.startsWith('neighbour-'))).toBe(true);
    act(() => { second.result.current.switchToSite(KEY_A); });
    expect(second.result.current.panels).toHaveLength(52);
    expect(second.result.current.panels.every(p => p.id.startsWith('melvin-'))).toBe(true);
  });

  it('🚨 reload while standing at A, whose design is in the archive', () => {
    const first = renderHook(() => useSiteDesign());
    act(() => { first.result.current.hydrateFromStored(null, KEY_A); });
    seed(first.result, 'melvin', 52);
    act(() => { first.result.current.switchToSite(KEY_B); });
    seed(first.result, 'neighbour', 9);
    const saved = first.result.current.persistencePayload();

    const second = renderHook(() => useSiteDesign());
    let res!: ReturnType<Hook['hydrateFromStored']>;
    act(() => {
      res = second.result.current.hydrateFromStored({
        panels: saved.panels, roofPlanes: saved.roofPlanes,
        obstructions: saved.obstructions, measurements: saved.measurements,
        siteArchives: JSON.parse(JSON.stringify(saved.siteArchives)),
      }, KEY_A);
    });
    expect(res.disposition).toBe('reactivated-archive');
    expect(res.needsAdoptionSave).toBe(true);   // one save records the new ownership
    expect(second.result.current.panels).toHaveLength(52);
    expect(second.result.current.panels.every(p => p.id.startsWith('melvin-'))).toBe(true);
    // The neighbour was the stored active set — archived, never dropped.
    expect(second.result.current.archivedSiteCount).toBe(1);
    act(() => { second.result.current.switchToSite(KEY_B); });
    expect(second.result.current.panels).toHaveLength(9);
  });

  it('a legacy row (no archives column) is adopted and saves exactly once', () => {
    const r = renderHook(() => useSiteDesign());
    let res!: ReturnType<Hook['hydrateFromStored']>;
    act(() => {
      res = r.result.current.hydrateFromStored(
        { panels: [panel('p1')], roofPlanes: [plane('r1')], obstructions: [], measurements: [] }, KEY_A);
    });
    expect(res.disposition).toBe('adopted-legacy');
    expect(res.needsAdoptionSave).toBe(true);

    // What that adoption save writes …
    const written = r.result.current.persistencePayload();
    // … re-read on the NEXT load needs no further adoption.
    const next = renderHook(() => useSiteDesign());
    let res2!: ReturnType<Hook['hydrateFromStored']>;
    act(() => {
      res2 = next.result.current.hydrateFromStored({
        panels: written.panels, roofPlanes: written.roofPlanes,
        obstructions: written.obstructions, measurements: written.measurements,
        siteArchives: JSON.parse(JSON.stringify(written.siteArchives)),
      }, KEY_A);
    });
    expect(res2.disposition).toBe('matched');
    expect(res2.needsAdoptionSave).toBe(false);
  });

  it('a deliberate clear survives a reload — it does not come back', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 5);
    act(() => {
      r.result.current.setPanels([]);
      r.result.current.setRoofPlanes([]);
      r.result.current.setPlacedObstructions([]);
      r.result.current.setMeasurements([]);
    });
    const saved = r.result.current.persistencePayload();
    expect(saved.panels).toEqual([]);
    expect(saved.roofPlanes).toEqual([]);

    const next = renderHook(() => useSiteDesign());
    act(() => {
      next.result.current.hydrateFromStored({
        panels: saved.panels, roofPlanes: saved.roofPlanes,
        obstructions: saved.obstructions, measurements: saved.measurements,
        siteArchives: JSON.parse(JSON.stringify(saved.siteArchives)),
      }, KEY_A);
    });
    expect(next.result.current.panels).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🚨 panning the map is not moving house', () => {
  it('a coordinate inside the site-key tolerance is the SAME property', () => {
    // The previous implementation archived from a useEffect on
    // [mapCenter.lat, mapCenter.lng] — which the 2D pan and wheel-zoom handlers
    // write on every pointer move. A drag archived the whole design.
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 52);
    const nudged = siteKeyFromCoords(MELVIN.lat + 0.000002, MELVIN.lng, PROJECT);
    expect(nudged).toBe(KEY_A);
    let changed = true;
    act(() => { changed = r.result.current.switchToSite(nudged).changed; });
    expect(changed).toBe(false);
    expect(r.result.current.panels).toHaveLength(52);
    expect(r.result.current.archivedSiteCount).toBe(0);
  });

  it('an unresolved coordinate archives nothing', () => {
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.hydrateFromStored(null, KEY_A); });
    seed(r.result, 'A', 52);
    act(() => { r.result.current.switchToSite(siteKeyFromCoords(null, null, PROJECT)); });
    expect(r.result.current.panels).toHaveLength(52);
    expect(r.result.current.archivedSiteCount).toBe(0);
  });

  it('a switch before hydration adopts rather than archiving', () => {
    // The restore has not resolved: ownership of what is on screen is unknown,
    // so filing it under a key would be a guess.
    const r = renderHook(() => useSiteDesign());
    act(() => { r.result.current.setPanels([panel('pre')]); });
    act(() => { r.result.current.switchToSite(KEY_A); });
    expect(r.result.current.panels.map(p => p.id)).toEqual(['pre']);
    expect(r.result.current.archivedSiteCount).toBe(0);
    expect(r.result.current.activeSiteKey).toBe(KEY_A);
  });
});
