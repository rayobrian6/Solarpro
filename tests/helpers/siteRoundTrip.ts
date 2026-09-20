/**
 * tests/helpers/siteRoundTrip.ts
 *
 * PERSIST A DESIGN AND READ IT BACK — THROUGH THE REAL MODEL.
 *
 * 🚨 WHY THIS EXISTS RATHER THAN A LOCAL SIMULATION.
 * Several suites used to express "save it and reload it" as
 * `partitionBySite(roundTrip(mergeForPersistence(active, foreign, key)), key)`
 * — a hand-rolled two-line model of the persistence path. It was green the
 * whole time the product was losing a 52-panel layout on 3 Melvin Drive,
 * because it proved the two helpers rather than the path. One suite went
 * further and reimplemented the entire site-change transition inside a
 * `describe` block.
 *
 * These helpers call the SAME functions the studio calls
 * (lib/design/siteDesignModel.ts), with a JSON round trip in the middle
 * because that is what the database does. If the product's persistence breaks,
 * every test built on this breaks with it — which is the only property that
 * makes a test worth having.
 */

import {
  emptyBundle, hydrate, toPersistencePayload, SITE_ARCHIVE_VERSION,
  type SiteDesignBundle, type SiteDesignState,
} from '@/lib/design/siteDesignModel';
import type { RoofPlane } from '@/types';

/** A JSON round trip, as the database performs it. */
export const throughDb = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function bundleOf(planes: RoofPlane[] = [], over: Partial<SiteDesignBundle> = {}): SiteDesignBundle {
  return { ...emptyBundle(), roofPlanes: planes, ...over };
}

export function stateOf(activeSiteKey: string, active: SiteDesignBundle, archives: Record<string, SiteDesignBundle> = {}): SiteDesignState {
  return { version: SITE_ARCHIVE_VERSION, activeSiteKey, active, archives };
}

/**
 * Save the design at `at`, then reload standing at `reloadAt` (default: the
 * same property). Returns what the studio would show and what it would still
 * be holding for other properties.
 */
export function persistAndReload(opts: {
  planes?: RoofPlane[];
  at: string;
  /** Other properties this project is already carrying. */
  archives?: Record<string, RoofPlane[]>;
  reloadAt?: string;
}): {
  /** The roof now on screen. */
  active: RoofPlane[];
  /** Every plane still held for other properties — nothing may be lost. */
  foreign: RoofPlane[];
  /** What the layout COLUMNS received: one property only. */
  storedRoofPlanes: RoofPlane[];
  disposition: ReturnType<typeof hydrate>['disposition'];
} {
  const archives: Record<string, SiteDesignBundle> = {};
  for (const [k, planes] of Object.entries(opts.archives ?? {})) archives[k] = bundleOf(planes);
  const payload = toPersistencePayload(stateOf(opts.at, bundleOf(opts.planes ?? []), archives));
  const row = throughDb({
    panels: payload.panels,
    roofPlanes: payload.roofPlanes,
    obstructions: payload.obstructions,
    measurements: payload.measurements,
    siteArchives: payload.siteArchives,
  });
  const res = hydrate(row, opts.reloadAt ?? opts.at);
  return {
    active: res.state.active.roofPlanes,
    foreign: Object.values(res.state.archives).flatMap(b => b.roofPlanes),
    storedRoofPlanes: row.roofPlanes,
    disposition: res.disposition,
  };
}
