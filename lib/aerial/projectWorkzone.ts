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
// THE BOUND lives in `lib/aerial/workzonePlan.ts`, which decides WHAT to buy in metres of ground
// and prices it in paid tile GETs with a hard per-layer ceiling. This file decides WHETHER anything
// may be bought at all, and what a bought workzone looks like once it is stored.
//
// 🚨 THE BOUND USED TO BE ONE 1440x810 FRAME — about 84 m x 47 m at z21 — and Ray rejected it
// live: "Conceptually this is approximately project property + nearby neighborhood context rather
// than one tiny 1440x810 card." Panning still does not extend it. The reference imagery is a fixed
// set of rectangles, so a user cannot walk paid acquisition across a city by dragging; crossing the
// edge shows SolarPro's own neutral design surface, and widening the paid area is an explicit
// action (see `missingWorkzoneRoles`).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The frame the permit site plan acquires, and the shape of every workzone bought before the
 * core/context split. Kept because those workzones are paid for and must still be read back —
 * NOT because it is the extent a new workzone gets. That is `WORKZONE_TARGETS`.
 */
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

/**
 * One acquired image inside a workzone.
 *
 * 🚨 WHY A WORKZONE HAS LAYERS NOW. The single 1440x810 frame above was rejected live: "A
 * rectangular Nearmap orthophoto is effectively being placed into that fallback world... once the
 * camera moves, it becomes obvious that this is not a coherent design environment." A coherent
 * neighbourhood at design resolution costs 425 tiles; the same neighbourhood one zoom band down
 * costs 35. So a workzone is a high-resolution CORE to author on plus a lower-resolution CONTEXT
 * ring for coherence — see `lib/aerial/workzonePlan.ts` for the measured arithmetic.
 */
export interface StoredWorkzoneLayer {
  role: 'core' | 'context';
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  /** The zoom that actually returned tiles, which is what the resolution is computed from. */
  zoom: number;
  /** Paid tile GETs this layer cost. Recorded so the spend is auditable after the fact. */
  tilesFetched?: number;
}

/** What a stored workzone record holds. Nothing here is invented — see the route. */
export interface StoredWorkzone {
  /** Which provider actually answered. Never the one that was asked for. */
  imageSource: 'nearmap';
  lat: number;
  lng: number;
  /** When SolarPro acquired it. NOT the imagery's capture date, which Nearmap's tile API does
   *  not supply — see R19. Recorded so a stale workzone can be reasoned about later. */
  acquiredAt: string;
  /** Every layer this project owns, core first. Absent on a workzone bought before layers existed. */
  layers?: StoredWorkzoneLayer[];

  // ── LEGACY SINGLE-IMAGE FIELDS ─────────────────────────────────────────────
  // 🚨 A PROJECT THAT ALREADY BOUGHT ITS WORKZONE MUST NEVER BUY IT AGAIN. These four fields are
  // the shape written before the core/context split, and they are still a complete, paid-for,
  // georeferenced workzone. They are read, honoured, and never silently topped up — adding the
  // context ring to one of these is an explicit "Expand imagery area", never an automatic purchase.
  imageBase64?: string;
  imageWidth?: number;
  imageHeight?: number;
  zoom?: number;
}

/** Does this object describe one usable acquired image? */
function isLayerish(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  return typeof l.imageBase64 === 'string' && l.imageBase64.startsWith('data:image/')
    && Number.isFinite(l.imageWidth) && Number.isFinite(l.imageHeight) && Number.isFinite(l.zoom);
}

/**
 * Is this object a usable stored workzone? Guards a JSON column, so it checks rather than casts.
 *
 * Accepts BOTH shapes on purpose: a layered record, or the legacy single-image one. A stricter
 * check would have made every previously-acquired workzone read as absent, which is the one
 * outcome the cost invariant forbids — it would re-buy imagery the project already owns.
 */
export function isStoredWorkzone(v: unknown): v is StoredWorkzone {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  if (w.imageSource !== 'nearmap') return false;
  if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) return false;
  if (Array.isArray(w.layers) && w.layers.length > 0) return w.layers.every(isLayerish);
  return isLayerish(w);
}

/**
 * The layers of a stored workzone, whichever shape it was written in.
 *
 * A legacy record becomes a single `core` layer: it is a high-resolution frame centred on the
 * project, which is exactly what a core is. It gets no context ring, because it never paid for one.
 */
export function workzoneLayers(stored: StoredWorkzone | null | undefined): StoredWorkzoneLayer[] {
  if (!stored) return [];
  if (Array.isArray(stored.layers) && stored.layers.length > 0) {
    const order = { core: 0, context: 1 } as Record<string, number>;
    return [...stored.layers].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  }
  if (!isLayerish(stored)) return [];
  return [{
    role: 'core',
    imageBase64: stored.imageBase64!,
    imageWidth: stored.imageWidth!,
    imageHeight: stored.imageHeight!,
    zoom: stored.zoom!,
  }];
}

/**
 * Which planned roles this project has NOT bought yet.
 *
 * 🚨 THE ONLY INPUT TO AN EXPANSION. Ray: "Never silently extend the paid workzone merely because
 * the camera crosses its edge... If extension is supported, require an explicit Expand imagery area
 * action." So expansion is driven by this — the difference between what is planned and what is
 * owned — and never by a camera position, a zoom level or a cache miss.
 */
export function missingWorkzoneRoles(
  stored: StoredWorkzone | null | undefined,
  planned: readonly ('core' | 'context')[],
): Array<'core' | 'context'> {
  const have = new Set(workzoneLayers(stored).map(l => l.role));
  return planned.filter(r => !have.has(r));
}
