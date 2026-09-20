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

/**
 * The canonical identity of a physical site.
 *
 * Returns UNRESOLVED_SITE_KEY for non-finite or absent coordinates — callers
 * must treat that as "cannot decide ownership", never as a match.
 */
export function siteKeyFromCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  projectId?: string | null,
): string {
  if (lat == null || lng == null) return UNRESOLVED_SITE_KEY;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return UNRESOLVED_SITE_KEY;
  const coord = `${lat.toFixed(SITE_KEY_PRECISION_DP)},${lng.toFixed(SITE_KEY_PRECISION_DP)}`;
  return projectId ? `${projectId}@${coord}` : coord;
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

/** Stamp ownership onto items that do not yet declare it. Never re-stamps an
 *  item that already names a DIFFERENT site — that would silently transfer one
 *  property's geometry to another, which is the defect, not the fix. */
export function stampSite<T extends SiteOwned>(items: readonly T[] | null | undefined, siteKey: string): T[] {
  if (!items || items.length === 0) return [];
  if (!siteKey) return [...items];
  return items.map(it => {
    const k = it?.siteKey;
    if (k === siteKey) return it;
    if (k == null || k === '') return { ...it, siteKey };
    return it; // belongs to another site — leave it alone
  });
}

/** Are there items owned by a site other than the current one? Drives the UI
 *  affordance that tells a user their other roof is kept, not lost. */
export function hasForeignSiteItems<T extends SiteOwned>(
  items: readonly T[] | null | undefined,
  currentSiteKey: string,
): boolean {
  return partitionBySite(items, currentSiteKey).foreign.length > 0;
}

/** Merge an active set back with retained foreign items for persistence.
 *  Active items are stamped with the current site on the way out, so a plane
 *  created before ownership existed acquires it the first time it is saved. */
export function mergeForPersistence<T extends SiteOwned>(
  active: readonly T[] | null | undefined,
  foreign: readonly T[] | null | undefined,
  currentSiteKey: string,
): T[] {
  return [...stampSite(active, currentSiteKey), ...(foreign ?? [])];
}
