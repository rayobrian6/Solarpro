/**
 * lib/siteIdentity.ts
 *
 * WHICH PHYSICAL PROPERTY DOES THIS ROOF BELONG TO?
 *
 * THE DEFECT THIS EXISTS TO END
 * -----------------------------
 * Roof geometry had no notion of the site it was traced at. `handleLocationPick`
 * cleared panels, solarApiData and roofSegments on an address change but NOT
 * `roofPlanes`, so:
 *
 *   1. address A detects/traces a roof
 *   2. the user picks address B
 *   3. A's planes are still in state, drawn over B's building
 *   4. Lane A refuses to run (its gate requires zero existing planes)
 *   5. every downstream consumer — layout, racking, structural, shade, BOM,
 *      permit CAD — reads A's geometry while the project says B
 *
 * (5) is the serious one: a permit artifact combining one property's roof with
 * another property's jurisdiction is a permit-grade defect, not a UI glitch.
 *
 * THE FIX IS OWNERSHIP, NOT DELETION
 * ----------------------------------
 * 🚨 The obvious fix — clear `roofPlanes` when coordinates change — is WRONG and
 * is explicitly forbidden. It would silently destroy hand-traced work whenever
 * the address moved, which is the same class of defect as the traced-garage
 * deletion: never infer a delete from a coordinate change. ABSENCE IS NOT INTENT.
 *
 * Instead every plane carries the site it belongs to. Planes for other sites are
 * RETAINED and PERSISTED, but are not active: they do not render, do not reach
 * consumers, and do not block Lane A. Returning to a site reactivates its roof.
 *
 * WHY A COORDINATE KEY AND NOT THE PROJECT ID
 * -------------------------------------------
 * The project id is stable but WRONG for this: a single project's address can
 * change (Pick House, address search), and the whole defect is geometry
 * outliving that change. The site is the physical property, so the key is the
 * property's coordinates. `projectId` is carried alongside for provenance and
 * to keep keys from one project from ever matching another's.
 */

/** Decimal places for the coordinate component of a site key.
 *
 *  5 dp ≈ 1.1 m at the equator and less at latitude. That is deliberately
 *  coarse: a re-geocode of the same address, orbit jitter, or a map recentre
 *  must NOT read as a different property, or a user would lose their roof by
 *  nudging the map. It is still far finer than any two adjacent buildings.
 *
 *  🚨 This is the same tolerance the Lane A run-once gate uses, on purpose —
 *  "is this a new site?" must have ONE answer in this codebase. */
export const SITE_KEY_PRECISION_DP = 5;

/** The key of a site whose coordinates are not yet known/valid. Never matches
 *  anything, including itself, so nothing is ever mistakenly claimed by it. */
export const UNRESOLVED_SITE_KEY = '';

/** The hardcoded placeholder a project carries before it has been geocoded. */
export const PLACEHOLDER_LAT = 33.4484;
export const PLACEHOLDER_LNG = -112.0740;

/**
 * Is this the un-geocoded placeholder rather than a real location?
 *
 * 🚨 ONE DEFINITION OF "ARE THESE COORDINATES REAL".
 * DesignStudio has always rejected this pair (`hasValidCoords`), but
 * `siteKeyFromCoords` — the ONLY thing that decides ownership — had no
 * placeholder concept and happily minted `"<projectId>@33.44840,-112.07400"`.
 * The restore path resolves ownership from `mapCenterRef`, which is seeded with
 * exactly the value the same file had just declared untrustworthy, so a design
 * could be adopted under Phoenix and STAY owned by Phoenix for the whole
 * session: the active key is written in only two places and a later geocode
 * re-centres the map without ever re-keying. The real pick, ~2,400 km away,
 * could never reclaim it — `resolveSiteKey` only snaps within 8 m.
 *
 * Exact equality is deliberate: a real geocode of downtown Phoenix carries more
 * precision than the literal, and this is the same test the studio already made.
 */
export function isPlaceholderCoords(lat?: number | null, lng?: number | null): boolean {
  return lat === PLACEHOLDER_LAT && lng === PLACEHOLDER_LNG;
}

/**
 * The canonical identity of a physical site.
 *
 * Returns UNRESOLVED_SITE_KEY for non-finite, absent or PLACEHOLDER coordinates
 * — callers must treat that as "cannot decide ownership", never as a match.
 * An unresolved key is the safe answer: `hydrate` keeps the stored design active
 * and archives nothing, so nothing is hidden or moved on the strength of a
 * coordinate nobody trusts.
 */
export function siteKeyFromCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  projectId?: string | null,
): string {
  if (lat == null || lng == null) return UNRESOLVED_SITE_KEY;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return UNRESOLVED_SITE_KEY;
  if (isPlaceholderCoords(lat, lng)) return UNRESOLVED_SITE_KEY;
  const coord = `${lat.toFixed(SITE_KEY_PRECISION_DP)},${lng.toFixed(SITE_KEY_PRECISION_DP)}`;
  return projectId ? `${projectId}@${coord}` : coord;
}

/**
 * The COORDINATE half of a site key, without the project scope.
 *
 * SolarEngine3D stamps detections with a coords-only key (it has no project
 * id), so comparing an incoming detection against a project-scoped key would
 * always disagree and drop every detection. This is the one place the two
 * spellings are reconciled — there is no second way to strip the prefix.
 */
export function coordKeyOf(siteKey: string | null | undefined): string {
  if (!siteKey) return UNRESOLVED_SITE_KEY;
  const at = siteKey.lastIndexOf('@');
  return at >= 0 ? siteKey.slice(at + 1) : siteKey;
}

/** Do two site keys denote the same property? An unresolved key matches nothing. */
export function isSameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b;
}

/** Minimal shape this module needs. Kept structural so it works for RoofPlane
 *  and for anything else that grows a siteKey later (obstructions, trees…). */
export interface SiteOwned {
  siteKey?: string | null;
}

/**
 * Split a collection into the planes that belong to `currentSiteKey` and those
 * that belong to some other site.
 *
 * 🚨 LEGACY ADOPTION. An item with no siteKey predates this module — every roof
 * stored before it has none. Those are treated as belonging to the CURRENT site
 * and are adopted. The alternative (treat unknown as foreign) would make every
 * existing user's roof vanish on upgrade, which is precisely the silent
 * destruction this module exists to prevent. Adoption can be wrong if the
 * project's address moved before the upgrade; showing the roof and letting the
 * user replace it is strictly safer than hiding work they did.
 *
 * If `currentSiteKey` is unresolved, EVERYTHING is treated as active — we cannot
 * prove ownership, so we must not hide anything.
 */
export function partitionBySite<T extends SiteOwned>(
  items: readonly T[] | null | undefined,
  currentSiteKey: string,
): { active: T[]; foreign: T[] } {
  const all = items ?? [];
  if (!currentSiteKey) return { active: [...all], foreign: [] };
  const active: T[] = [];
  const foreign: T[] = [];
  for (const it of all) {
    const k = it?.siteKey;
    if (k == null || k === '' || k === currentSiteKey) active.push(it); // legacy adoption
    else foreign.push(it);
  }
  return { active, foreign };
}

/**
 * 🚨 `mergeForPersistence`, `stampSite` and `hasForeignSiteItems` WERE HERE AND
 * ARE DELETED ON PURPOSE. DO NOT BRING THEM BACK.
 *
 * They implemented the first answer to site ownership: keep every visited
 * property's roof planes in ONE array, stamped with a siteKey, and filter on
 * read. It preserved the data, and it was wrong — `layouts.roof_planes` is
 * handed unfiltered by `rowToLayout()` to lib/pvwatts.ts (where
 * `roofPlanes[0].pitch` becomes the array tilt), lib/multiArrayEngine.ts,
 * /api/production, lib/engineering/syncPipeline.ts and the permit CAD path.
 * One live row held 13 planes from three different properties. Correctness
 * cannot depend on ~40 consumers each remembering to filter.
 *
 * A property that is not the one being designed now lives in
 * `layouts.site_archives` (migration 123), a column nothing engineering-facing
 * reads, restored by lib/design/siteDesignModel.ts when the user returns to
 * that address. Merging archived geometry back into an active array is the
 * defect, not the fix.
 */
