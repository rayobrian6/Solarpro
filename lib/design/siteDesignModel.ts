/**
 * lib/design/siteDesignModel.ts
 *
 * THE ONE COHERENT SITE DESIGN MODEL.
 *
 * WHAT WENT WRONG, EXACTLY
 * ------------------------
 * Ray's first real acceptance test of Phase 2, on 3 Melvin Drive:
 *
 *   1. Melvin open with its panel layout on screen
 *   2. pick the house next door
 *   3. the app re-flies; Melvin's panels disappear
 *   4. pick Melvin again
 *   5. THE PANELS DO NOT COME BACK
 *
 * lib/siteIdentity.ts gave ROOF PLANES an owner and nothing else. `panels`,
 * `placedObstructions` and `measurements` were still cleared outright by
 * `handleLocationPick` (`setPanels([])`) and never restored, because the only
 * code that ever re-populates them is the mount-time DB restore — which does
 * not re-run when the address changes inside a live session.
 *
 * So a PROPERTY CHANGE — navigation — behaved as a DELETE for every site-bound
 * entity except the roof. The database escaped damage only by accident: the
 * `LAYOUT_SUBSYSTEM_WIPE` guard in lib/db/projects.ts refuses any single save
 * that makes a whole >=4-panel sub-system vanish, so the `panels: []` writes
 * were rejected with a 500. That guard is luck, not architecture — the moment
 * the user places one panel at the new property the guard passes and the first
 * property's layout is overwritten for real.
 *
 * THE MODEL
 * ---------
 * A site design is a BUNDLE, not a handful of loose arrays. Exactly one bundle
 * is ACTIVE; every other site the project has visited is ARCHIVED, whole, under
 * its own key. Switching properties MOVES bundles. It never empties one.
 *
 *     switchSite(state, toKey):
 *       archives[state.activeSiteKey] = state.active     // leaving, intact
 *       state.active = archives[toKey] ?? emptyBundle()  // arriving
 *       delete archives[toKey]
 *
 * 🚨 ARCHIVE, NEVER CLEAR. A coordinate change is not an instruction to delete.
 * This is the same doctrine as lib/siteIdentity.ts and the traced-garage
 * deletion before it: ABSENCE IS NOT INTENT.
 *
 * 🚨 ONLY THE ACTIVE BUNDLE IS PERSISTED IN THE LAYOUT COLUMNS. This is the
 * half the roof-plane implementation got wrong, and it is a permit-grade
 * defect, not a UI one. That implementation merged every site's planes into
 * `layouts.roof_planes`, and `rowToLayout()` hands that column to
 * lib/pvwatts.ts, lib/multiArrayEngine.ts, the production route, the sync
 * pipeline and the permit CAD path with no filter anywhere. Melvin's row held
 * 13 planes from THREE different properties; `layout.roofPlanes[0].pitch` —
 * which is how pvwatts picks the array tilt — was whichever property happened
 * to sort first. Archived sites therefore live in their OWN column
 * (`layouts.site_archives`, migration 123) that no downstream consumer reads,
 * so foreign-site data is unreachable BY CONSTRUCTION rather than by every
 * consumer remembering to filter.
 *
 * WHY THE SWITCH IS DRIVEN BY INTENT, NOT BY COORDINATES
 * ------------------------------------------------------
 * 🚨 The roof-plane implementation archived from a `useEffect` keyed on
 * `[mapCenter.lat, mapCenter.lng]`. `mapCenter` is also written by the 2D map's
 * PAN and mouse-wheel ZOOM handlers, on every pointer move. The site key has
 * ~1.1 m resolution, so a single drag of the map archived the user's whole roof
 * and activated an empty site — and then accumulated a junk archive entry per
 * gesture. Panning a map is not moving house.
 *
 * A site change is an EXPLICIT user act: Pick House, an address search, or an
 * address suggestion. `switchSite` is called from those three places and
 * nowhere else. Passive camera movement can no longer archive anything.
 */

import type { PlacedPanel, RoofPlane, PlacedObstruction, LayoutMeasurement, DesignElectrical } from '@/types';
import { siteKeyFromCoords, isSameSite, partitionBySite, UNRESOLVED_SITE_KEY, type SiteOwned } from '@/lib/siteIdentity';

export { siteKeyFromCoords, isSameSite, UNRESOLVED_SITE_KEY };

// ─────────────────────────────────────────────────────────────────────────────
// The bundle
// ─────────────────────────────────────────────────────────────────────────────

/** Scalar design parameters that describe THIS property's array, not the user's
 *  preferences. A ground-mount tilt or a fence line belongs to the site it was
 *  drawn at, exactly as the panels do. */
export interface SiteDesignScalars {
  groundTilt?: number;
  groundAzimuth?: number;
  rowSpacing?: number;
  groundHeight?: number;
  bifacialOptimized?: boolean;
  fenceLine?: { lat: number; lng: number }[];
  fenceHeight?: number;
}

/**
 * EVERY site-bound design entity, in one object.
 *
 * 🚨 ADDING A SITE-BOUND ENTITY MEANS ADDING IT HERE. If you store it beside
 * the bundle instead, it will survive an address change while everything around
 * it moves — which is the Melvin defect, one entity at a time.
 * `SITE_BOUND_ENTITY_KEYS` below is the machine-checkable form of this rule.
 */
export interface SiteDesignBundle {
  panels: PlacedPanel[];
  roofPlanes: RoofPlane[];
  /** Keep-out zones a person PLACED. They remove panels from the array, so
   *  losing them silently re-fills the roof over every vent (migration 122).
   *  NOT the same entity as the Nearmap AI detections, which are a per-site
   *  fetch result and are re-fetched rather than archived. */
  obstructions: PlacedObstruction[];
  measurements: LayoutMeasurement[];
  /** The electrical design derived from THIS site's array. Carried so that
   *  returning to a property restores its topology/string paint, not the
   *  other property's. */
  designElectrical?: DesignElectrical | null;
  scalars?: SiteDesignScalars;
  /** Provenance only — never used to decide ownership. */
  address?: string | null;
  mapCenter?: { lat: number; lng: number } | null;
}

/** The array-valued entities. Declared as data so a test can assert the bundle
 *  has not grown a site-bound entity that capture/apply forgot about. */
export const SITE_BOUND_ENTITY_KEYS = ['panels', 'roofPlanes', 'obstructions', 'measurements'] as const;

export function emptyBundle(): SiteDesignBundle {
  return { panels: [], roofPlanes: [], obstructions: [], measurements: [], designElectrical: null };
}

/** Does this bundle carry nothing a user would miss? Used only for reporting —
 *  an empty bundle is still archived, because "I deliberately cleared this
 *  property" must round-trip exactly like any other state. */
export function isEmptyBundle(b: SiteDesignBundle | null | undefined): boolean {
  if (!b) return true;
  return SITE_BOUND_ENTITY_KEYS.every(k => (b[k]?.length ?? 0) === 0);
}

/** Total entity count across the bundle — what the UI reports as "kept". */
export function bundleEntityCount(b: SiteDesignBundle | null | undefined): number {
  if (!b) return 0;
  return SITE_BOUND_ENTITY_KEYS.reduce((n, k) => n + (b[k]?.length ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The state
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_ARCHIVE_VERSION = 1 as const;

/**
 * The whole site-design state of one project.
 *
 * INVARIANT, enforced by every function here and pinned by the model tests:
 *   `archives` NEVER contains `activeSiteKey`. A site is active or archived,
 *   never both — two copies of one property's design is how they diverge.
 */
export interface SiteDesignState {
  version: typeof SITE_ARCHIVE_VERSION;
  /** The site the ACTIVE bundle belongs to. `UNRESOLVED_SITE_KEY` means
   *  ownership is not yet decided — nothing may be archived in that condition. */
  activeSiteKey: string;
  active: SiteDesignBundle;
  archives: Record<string, SiteDesignBundle>;
}

export function emptyState(activeSiteKey = UNRESOLVED_SITE_KEY): SiteDesignState {
  return { version: SITE_ARCHIVE_VERSION, activeSiteKey, active: emptyBundle(), archives: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// The switch — the operation the whole module exists for
// ─────────────────────────────────────────────────────────────────────────────

export interface SwitchResult {
  state: SiteDesignState;
  /** The bundle now on screen. The caller applies this to component state. */
  arriving: SiteDesignBundle;
  /** The bundle just put away, for logging/UI. */
  archived: SiteDesignBundle | null;
  /** False when the call was a no-op (same site, or an unresolved target). */
  changed: boolean;
  reason: 'switched' | 'same-site' | 'unresolved-target' | 'unresolved-source';
}

/**
 * Move to another property. Archives the site being left, whole, and activates
 * whatever was stored for the site being entered.
 *
 * Refuses to act — rather than guessing — in two conditions:
 *   • the target key is unresolved: we cannot name the property we are moving
 *     to, so we cannot file the one we are leaving under anything meaningful.
 *   • the source key is unresolved: ownership of what is on screen has not been
 *     decided yet (the DB restore has not resolved). Archiving then would file
 *     a design under a key it may not belong to.
 * Both return `changed: false` and leave the state untouched, which is the only
 * safe answer — the alternative is a silent misfile, which is a silent loss.
 */
export function switchSite(
  state: SiteDesignState,
  toKey: string,
  opts?: { address?: string | null; mapCenter?: { lat: number; lng: number } | null },
): SwitchResult {
  if (!toKey) {
    return { state, arriving: state.active, archived: null, changed: false, reason: 'unresolved-target' };
  }
  if (isSameSite(toKey, state.activeSiteKey)) {
    return { state, arriving: state.active, archived: null, changed: false, reason: 'same-site' };
  }
  if (!state.activeSiteKey) {
    // Nothing is provably owned yet. Adopt the target as the active key without
    // archiving anything — the active bundle simply becomes this site's.
    return {
      state: { ...state, activeSiteKey: toKey, active: { ...state.active, address: opts?.address ?? state.active.address, mapCenter: opts?.mapCenter ?? state.active.mapCenter } },
      arriving: state.active,
      archived: null,
      changed: false,
      reason: 'unresolved-source',
    };
  }

  const leaving: SiteDesignBundle = state.active;
  const archives: Record<string, SiteDesignBundle> = { ...state.archives };

  // File the site we are leaving under its own key. Always — an empty bundle is
  // archived too, so "I cleared this property on purpose" comes back cleared
  // instead of coming back full.
  archives[state.activeSiteKey] = leaving;

  // Take back whatever was stored for the site we are entering.
  const arriving: SiteDesignBundle = archives[toKey] ?? emptyBundle();
  delete archives[toKey];

  return {
    state: {
      version: SITE_ARCHIVE_VERSION,
      activeSiteKey: toKey,
      active: { ...arriving, address: opts?.address ?? arriving.address ?? null, mapCenter: opts?.mapCenter ?? arriving.mapCenter ?? null },
      archives,
    },
    arriving: { ...arriving, address: opts?.address ?? arriving.address ?? null, mapCenter: opts?.mapCenter ?? arriving.mapCenter ?? null },
    archived: leaving,
    changed: true,
    reason: 'switched',
  };
}

/** Replace the active bundle in place (the user edited the design). Never
 *  touches the archives — an edit at site B cannot reach site A. */
export function setActiveBundle(state: SiteDesignState, active: SiteDesignBundle): SiteDesignState {
  return { ...state, active };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

/** The shape stored in `layouts.site_archives` (migration 123).
 *
 *  🚨 NO TIMESTAMP LIVES IN HERE. `generatedAt` inside DesignElectrical made the
 *  autosave dedup check dead code once already (lib/roofPlanesSignature.ts).
 *  A field that changes when nothing changed turns every signature comparison
 *  into "always different" and every tick into a DB write. The row's own
 *  `updated_at` records when; this column records only what. */
export interface StoredSiteArchives {
  version: typeof SITE_ARCHIVE_VERSION;
  /** Which site the row's `panels` / `roof_planes` / `obstructions` /
   *  `measurements` columns belong to. Without this a reload cannot tell
   *  whether the active columns are this property's or the last one's. */
  activeSiteKey: string;
  sites: Record<string, SiteDesignBundle>;
}

/** What the client sends, and what the layout route persists. The active
 *  entities go in their normal columns — unchanged for every consumer — and
 *  only the archives go in the new one. */
export interface SitePersistencePayload {
  panels: PlacedPanel[];
  roofPlanes: RoofPlane[];
  obstructions: PlacedObstruction[];
  measurements: LayoutMeasurement[];
  siteArchives: StoredSiteArchives;
}

export function toPersistencePayload(state: SiteDesignState): SitePersistencePayload {
  return {
    panels: state.active.panels ?? [],
    roofPlanes: state.active.roofPlanes ?? [],
    obstructions: state.active.obstructions ?? [],
    measurements: state.active.measurements ?? [],
    siteArchives: {
      version: SITE_ARCHIVE_VERSION,
      activeSiteKey: state.activeSiteKey,
      sites: state.archives,
    },
  };
}

/** Coerce anything read from the database into a bundle. Never throws: a row
 *  written by an older build, or hand-edited, must degrade to "no archive"
 *  rather than break the studio. */
function coerceBundle(raw: unknown): SiteDesignBundle {
  const b = emptyBundle();
  if (!raw || typeof raw !== 'object') return b;
  const o = raw as Record<string, unknown>;
  for (const k of SITE_BOUND_ENTITY_KEYS) {
    const v = o[k];
    if (Array.isArray(v)) (b[k] as unknown[]) = v;
  }
  if (o.designElectrical && typeof o.designElectrical === 'object') {
    b.designElectrical = o.designElectrical as DesignElectrical;
  }
  if (o.scalars && typeof o.scalars === 'object') b.scalars = o.scalars as SiteDesignScalars;
  if (typeof o.address === 'string') b.address = o.address;
  const mc = o.mapCenter as { lat?: unknown; lng?: unknown } | undefined;
  if (mc && typeof mc.lat === 'number' && typeof mc.lng === 'number') b.mapCenter = { lat: mc.lat, lng: mc.lng };
  return b;
}

/** Tolerant parse of the stored column. Returns null when the row predates
 *  migration 123 or holds something unrecognisable — the caller then takes the
 *  legacy-adoption path rather than assuming an empty archive, which would
 *  quietly discard a second property's design. */
export function parseStoredArchives(raw: unknown): StoredSiteArchives | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.activeSiteKey !== 'string') return null;
  const sitesRaw = o.sites;
  const sites: Record<string, SiteDesignBundle> = {};
  if (sitesRaw && typeof sitesRaw === 'object' && !Array.isArray(sitesRaw)) {
    for (const [k, v] of Object.entries(sitesRaw as Record<string, unknown>)) {
      if (!k) continue;
      sites[k] = coerceBundle(v);
    }
  }
  return { version: SITE_ARCHIVE_VERSION, activeSiteKey: o.activeSiteKey, sites };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydration — turning a stored row back into state
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredLayoutForHydration {
  panels?: PlacedPanel[] | null;
  roofPlanes?: RoofPlane[] | null;
  obstructions?: PlacedObstruction[] | null;
  measurements?: LayoutMeasurement[] | null;
  designElectrical?: DesignElectrical | null;
  siteArchives?: unknown;
}

export interface HydrateResult {
  state: SiteDesignState;
  /** How ownership of the stored active columns was decided. Logged, and
   *  asserted by the tests — a silent change of branch here is a silent change
   *  of which property's design the user is looking at. */
  disposition: 'matched' | 'adopted-legacy' | 'reactivated-archive' | 'stored-active-archived' | 'unresolved';
  /** True when hydration had to rewrite ownership, so exactly ONE save is
   *  expected immediately afterwards to record it. */
  needsAdoptionSave: boolean;
}

/**
 * Rebuild the state from a stored layout row for the site now on screen.
 *
 * Cases, in order:
 *
 *  • `siteKeyNow` unresolved — coordinates are not known yet. Everything is
 *    active and nothing is archived; ownership is decided later. Hiding a
 *    design because we do not yet know where we are would be the worst answer.
 *
 *  • No stored archives (row predates migration 123) — LEGACY ADOPTION. The
 *    active columns belong to the site now on screen. Same doctrine as
 *    lib/siteIdentity.ts: treating unknown as foreign would make every existing
 *    user's design vanish on upgrade.
 *    One exception, and it is the Melvin row: if the stored `roofPlanes` carry
 *    siteKeys naming MORE THAN ONE property, that row was written by the
 *    merged-array build. Split it — the planes matching `siteKeyNow` stay
 *    active, the rest become archive entries — so the contamination is repaired
 *    on first open instead of reaching the permit.
 *
 *  • Stored `activeSiteKey` equals `siteKeyNow` — the normal path.
 *
 *  • Stored `activeSiteKey` names another property and we hold an archive for
 *    `siteKeyNow` — the user reloaded while standing at a different site than
 *    the columns describe. Archive the stored active set under ITS key and
 *    activate ours. Nothing is discarded.
 *
 *  • Stored `activeSiteKey` names another property and we hold nothing for
 *    `siteKeyNow` — same archival, then start empty.
 */
export function hydrate(stored: StoredLayoutForHydration | null | undefined, siteKeyNow: string): HydrateResult {
  const storedActive: SiteDesignBundle = {
    panels: stored?.panels ?? [],
    roofPlanes: stored?.roofPlanes ?? [],
    obstructions: stored?.obstructions ?? [],
    measurements: stored?.measurements ?? [],
    designElectrical: stored?.designElectrical ?? null,
  };

  if (!siteKeyNow) {
    return {
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: UNRESOLVED_SITE_KEY, active: storedActive, archives: parseStoredArchives(stored?.siteArchives)?.sites ?? {} },
      disposition: 'unresolved',
      needsAdoptionSave: false,
    };
  }

  const parsed = parseStoredArchives(stored?.siteArchives);

  if (!parsed) {
    // ── Legacy row ────────────────────────────────────────────────────────────
    // Repair a merged multi-site roof array if one is present (the Melvin row).
    // 🚨 ONE definition of "does this item belong to this site", including the
    // legacy-adoption rule for unstamped items. `partitionBySite` is that
    // definition; re-deciding it here with an inline `if` is how two answers to
    // one question get into a codebase.
    const planes = storedActive.roofPlanes ?? [];
    const { active: mine, foreign } = partitionBySite(planes as Array<RoofPlane & SiteOwned>, siteKeyNow);
    if (foreign.length === 0) {
      return {
        state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: siteKeyNow, active: storedActive, archives: {} },
        disposition: 'adopted-legacy',
        needsAdoptionSave: true,
      };
    }
    const archives: Record<string, SiteDesignBundle> = {};
    for (const p of foreign) {
      const k = p.siteKey as string; // partitionBySite only reports stamped items as foreign
      (archives[k] ??= emptyBundle()).roofPlanes.push(p);
    }
    return {
      state: {
        version: SITE_ARCHIVE_VERSION,
        activeSiteKey: siteKeyNow,
        active: { ...storedActive, roofPlanes: mine },
        archives,
      },
      disposition: 'adopted-legacy',
      needsAdoptionSave: true,
    };
  }

  if (isSameSite(parsed.activeSiteKey, siteKeyNow)) {
    return {
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: siteKeyNow, active: storedActive, archives: parsed.sites },
      disposition: 'matched',
      needsAdoptionSave: false,
    };
  }

  // The columns describe a different property than the one on screen.
  const archives = { ...parsed.sites };
  if (parsed.activeSiteKey) archives[parsed.activeSiteKey] = storedActive;
  const mine = archives[siteKeyNow];
  if (mine) {
    delete archives[siteKeyNow];
    return {
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: siteKeyNow, active: mine, archives },
      disposition: 'reactivated-archive',
      needsAdoptionSave: true,
    };
  }
  return {
    state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: siteKeyNow, active: emptyBundle(), archives },
    disposition: 'stored-active-archived',
    needsAdoptionSave: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Content signature of the archives, for the autosave dedup check.
 *
 * Signs the archived DESIGN only — never `address`/`mapCenter` provenance and
 * never any timestamp, so re-opening a project cannot make an unchanged archive
 * look changed and re-POST the whole layout every three seconds.
 *
 * `activeSiteKey` IS signed: moving house with no other edit must still reach
 * the database, or the row would keep claiming the previous property.
 */
export function archivesSignature(a: StoredSiteArchives | null | undefined): string {
  if (!a) return 'null';
  const keys = Object.keys(a.sites ?? {}).sort();
  return JSON.stringify([
    a.activeSiteKey ?? '',
    keys.map(k => [
      k,
      SITE_BOUND_ENTITY_KEYS.map(e => a.sites[k]?.[e] ?? []),
      a.sites[k]?.designElectrical ? signableElectrical(a.sites[k]!.designElectrical) : null,
      a.sites[k]?.scalars ?? null,
    ]),
  ]);
}

/** Same exclusion rule as lib/roofPlanesSignature.ts — a built-at timestamp
 *  describes when, never what. Duplicated shape, single reason: this module
 *  must not import the signature module's private helper, and the field list is
 *  asserted equal to `UNSIGNED_ELECTRICAL_FIELDS` by the model tests. */
function signableElectrical(de: unknown): unknown {
  if (de === null || de === undefined) return null;
  if (typeof de !== 'object') return de;
  const out: Record<string, unknown> = { ...(de as Record<string, unknown>) };
  delete out.generatedAt;
  return out;
}
