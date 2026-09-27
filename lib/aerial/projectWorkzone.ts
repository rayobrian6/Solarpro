// ═══════════════════════════════════════════════════════════════════════════
// THE PROJECT'S NEARMAP WORKZONE — ADDRESS-GATED, BOUNDED, ACQUIRED ONCE.
//
// 🚨 WHAT THIS EXISTS TO STOP.
//
// Ray: "I do not want users opening Design Studio and freely browsing Nearmap across a city.
// Nearmap is expensive... The principle is: address → bounded project workzone → imagery
// acquisition, not: Design Studio → unlimited Nearmap map browser."
//
// And the live defect it exists to fix: "I still have to enter the old 2D environment first and
// select Nearmap before I can effectively get Nearmap into the 3D workflow." The only paths to
// Nearmap imagery were the 2D canvas's tile fetcher and the permit generator. Neither belongs to
// the project, so the 3D studio could not acquire anything on its own.
//
// 🚨 IT ADDS NO ACQUISITION CODE. `fetchNearmapStaticAerial` is the one Nearmap imagery fetcher in
// this codebase — the permit site plan has always called it at 1440x810 — and it already carries
// every cost repair: the remembered-refusal short circuit, the zoom ladder that stops rather than
// escalating on a 401/403/429, and a single stitched crop rather than a live tile stream. This
// file decides WHEN it may be called and makes sure the answer is kept.
//
// THE GATE, in order:
//   1. the project must exist and belong to the caller        (entitlement)
//   2. the project must have a resolved lat/lng               (the ADDRESS gate)
//   3. the project must be storable                           (or a toggle would re-buy forever)
//   4. nothing already acquired for it                        (acquire once)
//
// THE BOUND: one 1440x810 frame centred on the project. At z21 that is about 84 m by 47 m of
// ground — a property and its immediate context, which is the extent the permit site plan has
// always used and the extent `nearmapImageBounds` already georeferences. Panning does not extend
// it: the reference photo is a fixed rectangle, so a user cannot walk paid acquisition across a
// city by dragging.
// ═══════════════════════════════════════════════════════════════════════════

/** The frame the permit site plan has always acquired. One property, not a neighbourhood. */
export const WORKZONE_WIDTH_PX = 1440;
export const WORKZONE_HEIGHT_PX = 810;

/** The file name the project's acquired workzone is stored under, in `project_files`. */
export const WORKZONE_FILE_NAME = 'aerial_workzone.json';

export interface WorkzoneLocation {
  lat: number;
  lng: number;
}

export type WorkzoneRefusalCode = 'no-project' | 'no-address' | 'not-storable';

/**
 * ONE SHAPE, NOT A DISCRIMINATED UNION.
 *
 * `tsconfig` runs with `strict: false`, under which narrowing a union on a boolean literal is not
 * reliable — the route read `gate.code` after `if (!gate.ok)` and failed to compile. A single
 * shape with optional fields is read the same way by both consumers and cannot be narrowed wrong.
 */
export interface WorkzoneGate {
  ok: boolean;
  /** Present when `ok`. */
  location?: WorkzoneLocation;
  /** Present when not `ok`. */
  code?: WorkzoneRefusalCode;
  /** Present when not `ok` — the exact copy the control shows. */
  reason?: string;
}

/**
 * May this project acquire Nearmap imagery?
 *
 * Pure, so the rule can be proved without a database or a network, and so the same answer can be
 * given to the UI (which disables the control and prints the reason) and to the route (which
 * refuses). One rule, two consumers — not a client-side check and a server-side check that can
 * drift apart.
 *
 * @param project   the project row, or null when there is none
 * @param storable  whether an acquired image can actually be persisted for this project. A Quick
 *                  Design has no row to store against, and acquiring something that cannot be
 *                  kept means every toggle buys it again.
 */
export function workzoneGate(
  project: { id?: string | null; lat?: number | null; lng?: number | null } | null | undefined,
  storable: boolean,
): WorkzoneGate {
  if (!project || !project.id) {
    return {
      ok: false, code: 'no-project',
      reason: 'Open a saved project to load Nearmap imagery.',
    };
  }
  const lat = Number(project.lat), lng = Number(project.lng);
  const resolved = Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) > 1e-6 && Math.abs(lng) > 1e-6
    && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
  if (!resolved) {
    return {
      ok: false, code: 'no-address',
      // Ray's own copy.
      reason: 'Select a project address to load Nearmap imagery.',
    };
  }
  if (!storable) {
    return {
      ok: false, code: 'not-storable',
      reason: 'This design has nowhere to keep imagery, so buying it would mean buying it again '
        + 'on every switch. Save the project first.',
    };
  }
  return { ok: true, location: { lat, lng } };
}

/** What a stored workzone record holds. Nothing here is invented — see the route. */
export interface StoredWorkzone {
  /** Which provider actually answered. Never the one that was asked for. */
  imageSource: 'nearmap';
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  /** The zoom that actually returned tiles, which is what the resolution is computed from. */
  zoom: number;
  lat: number;
  lng: number;
  /** When SolarPro acquired it. NOT the imagery's capture date, which Nearmap's tile API does
   *  not supply — see R19. Recorded so a stale workzone can be reasoned about later. */
  acquiredAt: string;
}

/** Is this object a usable stored workzone? Guards a JSON column, so it checks rather than casts. */
export function isStoredWorkzone(v: unknown): v is StoredWorkzone {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return w.imageSource === 'nearmap'
    && typeof w.imageBase64 === 'string' && w.imageBase64.startsWith('data:image/')
    && Number.isFinite(w.imageWidth) && Number.isFinite(w.imageHeight)
    && Number.isFinite(w.zoom) && Number.isFinite(w.lat) && Number.isFinite(w.lng);
}
