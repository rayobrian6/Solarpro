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

/**
 * The non-entity design values that belong to a PROPERTY rather than to the
 * designer.
 *
 * 🚨 THE FENCE LINE IS GEOMETRY. It is a list of lat/lng points, so carrying it
 * to another property draws a fence at the old address — the same contamination
 * as a roof plane, with the same consequences for the BOM and the planset. It
 * is site-bound for exactly that reason.
 *
 * 🚨 THE NUMBERS ARE DELIBERATELY NOT HERE. `groundTilt`, `groundAzimuth`,
 * `rowSpacing`, `groundHeight` and `bifacialOptimized` are an installer's
 * PREFERENCES about how they build arrays, not facts about a parcel. Moving to
 * a different address is no reason to reset a 20° tilt to the component
 * default, and resetting it silently would be its own quiet data loss. They
 * stay on the layout row, project-wide, which is where they already were.
 */
export interface SiteDesignScalars {
  /** Fence geometry — lat/lng, therefore site-bound. */
  fenceLine?: { lat: number; lng: number }[];
  /** Carried with the line it belongs to. */
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

/** Is there anything here worth carrying to the database?
 *
 *  Broader than `isEmptyBundle`: a property with no entities but a chosen
 *  topology or a ground tilt has still been worked on, and that work must
 *  survive. `address`/`mapCenter` are provenance ONLY and deliberately do not
 *  count — they are set on every switch, so counting them would make every
 *  bundle non-empty and defeat the pruning entirely. */
export function hasContent(b: SiteDesignBundle | null | undefined): boolean {
  if (!b) return false;
  if (!isEmptyBundle(b)) return true;
  if (b.designElectrical) return true;
  if (b.scalars && Object.values(b.scalars).some(v => v !== undefined && v !== null)) return true;
  return false;
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
// Which property did the user just click on?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How close a picked point must be to a property this project already knows
 * about for it to BE that property.
 *
 * 🚨 THIS EXISTS BECAUSE THE SITE KEY IS FAR TOO PRECISE FOR A MOUSE.
 * `siteKeyFromCoords` rounds to 5 decimal places — about 1.1 m. Clicking the
 * same roof twice in Pick House mode lands metres apart, so every click minted
 * a NEW property. The live trace from 3 Melvin Drive, 2026-09-20, is three
 * identities for one house inside 43 seconds:
 *
 *   v202 16:11:53  …@38.70615,-90.04625
 *   v204 16:13:46  …@38.70630,-90.04620   (~17 m)
 *   v205 16:13:57  …@38.70613,-90.04627   (~19 m)
 *
 * Nothing was lost — each identity's design was archived, correctly — but the
 * user picked their own house again and got an empty roof, which is the
 * complaint this whole model was built to answer, wearing a different hat.
 *
 * 🚨 8 m, AND THE NUMBER IS MEASURED, NOT GUESSED. The same live trace gives
 * both bounds, and they are closer together than is comfortable:
 *
 *   accidental duplicate of one house   2.8 m   ← must be absorbed
 *   3 Melvin Drive → 5 Melvin Drive    17.3 m   ← must NOT be absorbed
 *
 * The first radius tried here was 25 m, which swallowed the real neighbour and
 * made it impossible to pick for the first time — caught by
 * tests/designStudioSiteSwitch.component.test.tsx, whose fixture uses the
 * genuine 17 m separation. 8 m clears the observed duplicate three times over
 * and leaves better than a 2× margin to the neighbour.
 *
 * WHAT THIS DOES NOT FIX. If Pick House returns the clicked POINT rather than
 * the building's centre, two clicks on opposite ends of a long roof can exceed
 * 8 m and will still mint two properties. Nothing is lost when that happens —
 * the design is archived and the banner says so — but the user has to pick
 * closer to where they picked before. The real fix is to key the site on the
 * building footprint instead of a coordinate; that is roof-UX work, and this
 * radius is the honest interim.
 *
 * Matching the NEAREST known site rather than the first in range is what keeps
 * both properties addressable once each has a key of its own.
 */
export const SITE_MATCH_RADIUS_M = 8;

/** Metres between two lat/lng points. Equirectangular — exact enough at the
 *  scale of one parcel, and it avoids a trig-heavy haversine on every pick. */
function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const latMid = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos(latMid);
  return Math.hypot(dLat, dLng);
}

/** The coordinate a site key names, or null if it cannot be parsed. */
export function coordsOfSiteKey(siteKey: string | null | undefined): { lat: number; lng: number } | null {
  if (!siteKey) return null;
  const at = siteKey.lastIndexOf('@');
  const coord = at >= 0 ? siteKey.slice(at + 1) : siteKey;
  const [latS, lngS] = coord.split(',');
  const lat = Number(latS), lng = Number(lngS);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Do two site keys name the SAME physical property?
 *
 * 🚨 THIS IS THE ONLY DEFINITION. `resolveSiteKey` decided that a pick within
 * `SITE_MATCH_RADIUS_M` of a known property IS that property — so anything else
 * asking "same site?" must agree, or the codebase holds two answers to one
 * question and they drift.
 *
 * It drifted immediately. DesignStudio's stale-detection guard compared the
 * active key to the key SolarEngine3D stamps on a detection using `!==` on the
 * strings. The engine has no access to the resolver: it stamps the raw
 * coordinates it detected at. So after a snapped re-pick the active key is the
 * ORIGINAL click's coordinate and the detection carries the NEW one, they are
 * never equal, and EVERY roof detection after returning to a house was
 * discarded as stale. Found by a second session reviewing the snap fix.
 *
 * Exact-equal first, so an unsnapped comparison costs nothing; distance second,
 * using the same radius and the same metric the resolver uses.
 */
export function sitesAreSameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = coordsOfSiteKey(a), cb = coordsOfSiteKey(b);
  if (!ca || !cb) return false;
  return metresBetween(ca, cb) <= SITE_MATCH_RADIUS_M;
}

/**
 * Which of `candidates` is the same property as `key` — the NEAREST one, or null.
 *
 * 🚨 AN ARCHIVE LOOKUP IS A PROPERTY QUESTION, NOT A STRING LOOKUP.
 * `archives[someKey]` is exact, and on the restore path the key being looked up
 * was re-derived from a coordinate that drifts (see the note in `hydrate`). So a
 * user returning to a property the archive genuinely holds missed it, and got an
 * empty design plus `needsAdoptionSave` — the destructive branch — for a design
 * that was sitting right there under a neighbouring key.
 *
 * NEAREST, not first-match: two real houses can both be inside the radius of a
 * point between them, and snapping to whichever happened to be enumerated first
 * would make one of them permanently unreachable. Same rule as `resolveSiteKey`.
 */
export function nearestSamePropertyKey(
  candidates: readonly string[],
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  if (candidates.includes(key)) return key; // exact wins, and costs nothing
  const target = coordsOfSiteKey(key);
  if (!target) return null;
  let best: { key: string; d: number } | null = null;
  for (const c of candidates) {
    const cc = coordsOfSiteKey(c);
    if (!cc) continue;
    const d = metresBetween(target, cc);
    if (d <= SITE_MATCH_RADIUS_M && (!best || d < best.d)) best = { key: c, d };
  }
  return best ? best.key : null;
}

export interface ResolvedSite {
  key: string;
  /** True when this reused a property the project already knows about. */
  matchedExisting: boolean;
  /** Distance to the matched site, for logging. */
  distanceM: number | null;
}

/**
 * Name the property the user just picked.
 *
 * Returns an EXISTING key — the active site, or any archived one — when the
 * picked point is within `SITE_MATCH_RADIUS_M` of it, choosing the nearest.
 * Otherwise mints a fresh key from the coordinates.
 *
 * Snapping to the nearest known site is what makes "pick my house again" work:
 * the user gets back the design they left there instead of an empty roof beside
 * it. It cannot merge two genuinely different properties, because a click on
 * the neighbour is nearer to the neighbour's own key than to this one.
 */
export function resolveSiteKey(
  state: SiteDesignState,
  lat: number | null | undefined,
  lng: number | null | undefined,
  projectId?: string | null,
): ResolvedSite {
  const fresh = siteKeyFromCoords(lat, lng, projectId);
  if (!fresh || lat == null || lng == null) return { key: fresh, matchedExisting: false, distanceM: null };
  const here = { lat, lng };

  let best: { key: string; d: number } | null = null;
  const candidates = [state.activeSiteKey, ...Object.keys(state.archives ?? {})].filter(Boolean);
  for (const key of candidates) {
    const c = coordsOfSiteKey(key);
    if (!c) continue;
    const d = metresBetween(here, c);
    if (d <= SITE_MATCH_RADIUS_M && (!best || d < best.d)) best = { key, d };
  }
  if (best) return { key: best.key, matchedExisting: true, distanceM: best.d };
  return { key: fresh, matchedExisting: false, distanceM: null };
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
  // 🚨 THE SAME PROPERTY QUESTION AGAIN — completing the set. This was
  // `isSameSite`, exact string equality, and the codebase now has exactly one
  // definition of "same property", so this must use it too.
  //
  // Today's caller resolves first, so a same-property key normally arrives
  // byte-identical and the exact branch inside `sitesAreSameProperty` takes it.
  // With a RAW key for the property already active, exact equality said "no"
  // and the function archived the live bundle and then immediately took it back
  // out again (the arriving lookup below is property-based), reporting
  // `changed: true` for a move that never happened — churn on every write path
  // that watches this result. Asking the right question makes it a no-op.
  if (sitesAreSameProperty(toKey, state.activeSiteKey)) {
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

  // File the site we are leaving under its own key.
  //
  // 🚨 EXCEPT WHEN THERE IS NOTHING TO FILE. `site_archives` is sent on EVERY
  // autosave, so an entry per property visited would make a user who toured
  // twenty houses carry twenty empty objects in every request, for ever, with
  // no way to shed them. An entry with no entities, no electrical design and no
  // scalars is indistinguishable on the way back from never having visited:
  // both produce `emptyBundle()`. So dropping it changes no behaviour and
  // bounds the column by the number of properties actually DESIGNED at.
  //
  // "I cleared this property on purpose" still round-trips cleared, for the
  // same reason — an empty archive and an absent archive both come back empty.
  if (hasContent(leaving)) archives[state.activeSiteKey] = leaving;
  else delete archives[state.activeSiteKey];

  // Take back whatever was stored for the site we are entering.
  //
  // 🚨 BY PROPERTY, NOT BY STRING — even though today's only caller already
  // resolved the key. `changeSite` runs `resolveKeyFor` first, so `toKey` is
  // normally an existing key and the exact branch inside
  // `nearestSamePropertyKey` takes it at no cost. But that made correctness here
  // depend on a caller remembering to resolve, and this function is exported.
  // A raw key from any future caller would have silently missed a stored bundle
  // and handed back an empty one — the same class of defect the restore path
  // just had. The lookup now answers the property question itself.
  const arrivingKey = nearestSamePropertyKey(Object.keys(archives), toKey);
  const arriving: SiteDesignBundle = (arrivingKey ? archives[arrivingKey] : undefined) ?? emptyBundle();
  if (arrivingKey) delete archives[arrivingKey];

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

  // 🚨 SAME PROPERTY, NOT SAME STRING — AND KEEP THE KEY THE ROW ALREADY HAS.
  //
  // This was `isSameSite`, i.e. exact string equality, and that is the wrong
  // question on the RESTORE path. The key the row stores was minted from the
  // point the user CLICKED. `siteKeyNow` is re-derived on mount from
  // `projects.lat/lng` — which the mount effect OVERWRITES with a fresh geocode
  // ("street-level geocode always wins over stored coords", true of every picked
  // address). A 3D roof-click point and a geocoder's rooftop point essentially
  // never agree to the 1.1 m the key quantises to, so the two keys differed on
  // reload for a design that had never left its property.
  //
  // The consequence was not a cosmetic mismatch. Falling through here reaches
  // `stored-active-archived`, which activates an EMPTY bundle and sets
  // `needsAdoptionSave`, forcing a save of `panels: []` — and the
  // LAYOUT_SUBSYSTEM_WIPE guard relaxes precisely when the incoming key differs
  // from the stored one, so that write is permitted. The design was destroyed by
  // the mechanism built to protect it, on reload, with no user action at all.
  //
  // `sitesAreSameProperty` is the SAME predicate `resolveSiteKey` and the
  // detection staleness guard use — one definition of "same property" in this
  // codebase, not a third.
  //
  // And the key that survives is `parsed.activeSiteKey`, NOT `siteKeyNow`: the
  // archives are filed under the stored key and roof planes are stamped with it,
  // so adopting the drifted coordinate's key would orphan both.
  if (sitesAreSameProperty(parsed.activeSiteKey, siteKeyNow)) {
    return {
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: parsed.activeSiteKey, active: storedActive, archives: parsed.sites },
      disposition: 'matched',
      needsAdoptionSave: false,
    };
  }

  // 🚨 THE ROW NEVER DECIDED WHOSE THE ACTIVE COLUMNS ARE — ADOPT, NEVER DROP.
  //
  // A project with no stored lat/lng resolves to UNRESOLVED_SITE_KEY at restore
  // time, so the saves that follow write `activeSiteKey: ""`. On the NEXT load
  // the coordinates ARE known, `isSameSite('', key)` is false (an unresolved key
  // matches nothing, deliberately), and without this branch the design fell
  // through to "the columns describe another property" — where the archival step
  // is `if (parsed.activeSiteKey)`, which `''` fails. The design was neither
  // active nor archived. It was simply gone, on the second open of every project
  // created before its first geocode landed.
  //
  // An unresolved stored key is not a claim that the columns belong to somewhere
  // else; it is the absence of a claim. Same doctrine as a legacy row: adopt.
  if (!parsed.activeSiteKey) {
    return {
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: siteKeyNow, active: storedActive, archives: parsed.sites },
      disposition: 'adopted-legacy',
      needsAdoptionSave: true,
    };
  }

  // The columns describe a different property than the one on screen.
  // `parsed.activeSiteKey` is non-empty here — the branch above handles the
  // unresolved case — so the stored active set always has a key to be filed
  // under. It is never dropped.
  const archives = { ...parsed.sites };
  archives[parsed.activeSiteKey] = storedActive;
  // 🚨 PROPERTY LOOKUP, NOT STRING LOOKUP — the sibling of the comparison above.
  // This was `archives[siteKeyNow]`, and it drifts for exactly the same reason:
  // `siteKeyNow` comes from a re-geocoded coordinate, while the archive is filed
  // under the key minted from the original click. Returning to a property the
  // archive genuinely held therefore missed it and fell through to the empty,
  // `needsAdoptionSave` branch — the destructive one.
  const mineKey = nearestSamePropertyKey(Object.keys(archives), siteKeyNow);
  const mine = mineKey ? archives[mineKey] : undefined;
  if (mine && mineKey) {
    delete archives[mineKey];
    return {
      // Keep the key the archive was filed under, for the same reason the
      // matched branch does: plane stamps and archive keys must stay in step.
      state: { version: SITE_ARCHIVE_VERSION, activeSiteKey: mineKey, active: mine, archives },
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
