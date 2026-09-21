/**
 * lib/roofMountDatum.ts — THE ROOF MOUNTING DATUM
 *
 * ONE QUESTION, ONE ANSWER: how far above a roof plane does a module sit?
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * It did not, and so five placement paths answered it five different ways. A
 * roof carrying both auto-filled and hand-placed modules showed them at
 * different heights on the same plane, and one path was not even idempotent —
 * it measured from a module and then added the mount stack again, so every
 * hand-placed module after a reload floated one stack height above its
 * neighbours.
 *
 *   buildSurfaceGridECEF / placeSinglePanel / addRow / extendRow
 *                             origin3D + n * 0.05   (PANEL_OFFSET_ECEF)
 *   panelPositionFromCAD      deck     + n * 0.18   (PANEL_OFFSET_LEGACY)
 *   Google-segment fill       deck     + n * 0.14   (getRoofPanelOffset)
 *   grid fill                 deck     + n * 0.14   (getRoofPanelOffset)
 *   single panel on a plane   MODULE   + n * 0.14   (getRoofPanelOffset)  ← ratchet
 *
 * None of those numbers was reachable from another; `getRoofPanelOffset` and
 * `getRailSpec` lived inside a 12,000-line React component, and the rail
 * dimensions they hardcoded already existed, cited, in the mounting-hardware
 * database.
 *
 * THE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * The fitted roof plane IS the deck. A module's underside sits
 * `moduleStackHeightM(mountId)` above it, along the plane normal. A rail hangs
 * underneath, its top face meeting the module's underside.
 *
 * `SURFACE_OFFSET_M` (roofPlane3D) lifts the fitted plane above the
 * photogrammetry mesh so the two do not z-fight. That lift translates the WHOLE
 * roof assembly — deck, modules, rails — by the same vector, so it cancels out
 * of every relative measurement and MUST NOT appear in this file. Treating it
 * as part of the mount stack is exactly what `PANEL_OFFSET_ECEF = 0.05` did:
 * "origin3D already lifted 0.12m" is a rendering fact, and it was being
 * subtracted from a physical one.
 *
 * WHAT IS CITED AND WHAT IS ESTIMATED
 * ─────────────────────────────────────────────────────────────────────────────
 * Rail heights are manufacturer facts and are read from
 * `lib/mounting-hardware-db.ts`, which carries `engineeringDataSource` for each
 * record (XR100: 1.66", XR1000: 2.00", SolarMount: 1.75"). They are not
 * repeated here.
 *
 * Standoff heights are NOT published in that database. The values below are
 * VISUAL ESTIMATES and are labelled as such. That is defensible only because
 * nothing structural reads them:
 *
 *   🚨 NOTHING IN THIS FILE REACHES AN ENGINEERING OUTPUT.
 *   `PlacedPanel.height` is consumed by the 3D renderer and by the ground-mount
 *   reality engine. No permit sheet, structural calculation, PVWatts call or BOM
 *   line reads it. Should that ever change, these estimates must be replaced by
 *   published dimensions first — a rendering estimate must never become an
 *   engineering input.
 */

import {
  getMountingSystemById,
  type MountingSystemSpec,
} from './mounting-hardware-db';

const IN_TO_M = 0.0254;

/**
 * Conservative clearance for a mounting system this build does not know.
 * Deliberately the same value the previous `getRoofPanelOffset` default used,
 * so an unknown system renders exactly as it did before.
 */
export const DEFAULT_MODULE_STACK_M = 0.12;

/**
 * Deck → module underside, per system, as the viewport drew it before this file
 * existed. PRESERVED EXACTLY: these are the values a human has already looked
 * at, and this change is about having ONE datum, not about choosing new numbers.
 * Anything not listed is derived from the mounting-hardware database below.
 */
const PINNED_STACK_M: Readonly<Record<string, number>> = {
  'rooftech-mini':       0.14, // RT-MINI standoff + XR100-class rail
  'rt-mini':             0.14,
  'ironridge-xr100':     0.14, // 102 mm standoff + 42 mm rail
  'ironridge-xr1000':    0.16, // 102 mm standoff + 51 mm rail + margin
  'rooftech-mini-s':     0.10, // rail-less: standoff only
  'rooftech-mini-t':     0.10,
  'rooftech-hook':       0.10,
  'rooftech-mini-m':     0.12,
  'ironridge-flat-roof': 0.10, // ballasted tray — low profile
};

/**
 * Standoff / attachment height by system type — VISUAL ESTIMATE (see header).
 * Used only for systems absent from PINNED_STACK_M, which previously all
 * collapsed to a single 0.12 regardless of how they attach.
 */
const STANDOFF_ESTIMATE_M: Readonly<Record<string, number>> = {
  rail_based:     0.102, // L-foot / pad standoff above the deck
  standing_seam:  0.050, // seam clamp — no penetration, sits on the rib
  rail_less:      0.100, // module clamps directly to the attachment
  ballasted_flat: 0.100, // ballast tray
};

/**
 * Rail cross-section for a mounting system, in metres, or null when the system
 * carries no rail (rail-less / ballasted) or publishes no dimensions.
 *
 * Read from the mounting-hardware database rather than restated, so a rail
 * dimension has exactly one home. The renderer used to hardcode three systems
 * and draw nothing at all for the other 16 that publish a rail height.
 */
export function railCrossSectionM(
  mountingSystemId: string,
): { heightM: number; widthM: number } | null {
  // The companion table is consulted first because it also covers ids that are
  // aliases rather than catalogue records — `rt-mini` is what the renderer has
  // always been handed, and it is not an id in the mounting-hardware database.
  const companion = COMPANION_RAIL_IN[mountingSystemId];
  if (companion) return { heightM: companion.heightIn * IN_TO_M, widthM: companion.widthIn * IN_TO_M };

  const spec = getMountingSystemById(mountingSystemId);
  if (!isRailed(spec)) return null;

  const rail = spec?.rail;
  if (rail && Number.isFinite(rail.heightIn) && rail.heightIn > 0) {
    const widthIn = Number.isFinite(rail.widthIn) && rail.widthIn > 0 ? rail.widthIn : 1.0;
    return { heightM: rail.heightIn * IN_TO_M, widthM: widthIn * IN_TO_M };
  }

  return null;
}

/**
 * Viewport-only companion rail for rail-based systems that publish no rail
 * section of their own. RT-MINI is a standoff sold to pair with an XR100-class
 * rail, and the renderer has always drawn one for it; reading the database and
 * stopping there would have silently removed rails a person is used to seeing.
 *
 * This is a stated VIEWPORT assumption about the companion rail, not a claim
 * about the manufacturer's record — which is why it is a named constant with
 * this note rather than a quiet default.
 */
const COMPANION_RAIL_IN: Readonly<Record<string, { heightIn: number; widthIn: number }>> = {
  'rooftech-mini': { heightIn: 1.66, widthIn: 1.0 },  // XR100-class, as drawn before
  'rt-mini':       { heightIn: 1.66, widthIn: 1.0 },
};

function isRailed(spec: MountingSystemSpec | undefined): boolean {
  return spec?.systemType === 'rail_based' || spec?.systemType === 'standing_seam';
}

/**
 * THE DATUM. Metres from the roof deck to a module's underside, along the plane
 * normal, for the given mounting system.
 *
 * Every roof placement path must use this and nothing else. A module is at
 *     planeOrigin3D + normal * moduleStackHeightM(mountId)
 * and a rail's top face is at the same height.
 */
export function moduleStackHeightM(mountingSystemId: string | null | undefined): number {
  if (!mountingSystemId) return DEFAULT_MODULE_STACK_M;

  const pinned = PINNED_STACK_M[mountingSystemId];
  if (pinned !== undefined) return pinned;

  const spec = getMountingSystemById(mountingSystemId);
  if (!spec) return DEFAULT_MODULE_STACK_M;

  const standoffM = STANDOFF_ESTIMATE_M[spec.systemType];
  if (standoffM === undefined) return DEFAULT_MODULE_STACK_M; // ground / tracker / fence

  const rail = railCrossSectionM(mountingSystemId);
  return standoffM + (rail?.heightM ?? 0);
}

// ─── The datum, and its inverse ──────────────────────────────────────────────
//
// These exist as a PAIR because the bug they close was an unpaired application:
// a plane restored from the database keeps no frame of its own, so the renderer
// rebuilt one from a module sitting on it — and then treated that module's
// position as the deck. Adding the stack to it placed the next module a stack
// height too high, and the reload after that used the new module as the origin.
// A ratchet, one stack height per hand-placed module.
//
// Anything that recovers a plane from a module must call `deckPointFromModule`.
// Anything that places a module on a plane must call `modulePointFromDeck`.
// Round-tripping them is the identity, and `tests/roofMountDatum.test.ts` proves
// it — including that applying the forward step twice drifts by exactly the
// amount the ratchet drifted.

export interface Vec3 { x: number; y: number; z: number }

/** Where a module's underside sits, given the deck point beneath it. */
export function modulePointFromDeck(
  deck: Vec3, normal: Vec3, mountingSystemId: string | null | undefined,
): Vec3 {
  const d = moduleStackHeightM(mountingSystemId);
  return { x: deck.x + normal.x * d, y: deck.y + normal.y * d, z: deck.z + normal.z * d };
}

/** The deck point beneath a module. The inverse of `modulePointFromDeck`. */
export function deckPointFromModule(
  modulePos: Vec3, normal: Vec3, mountingSystemId: string | null | undefined,
): Vec3 {
  const d = moduleStackHeightM(mountingSystemId);
  return { x: modulePos.x - normal.x * d, y: modulePos.y - normal.y * d, z: modulePos.z - normal.z * d };
}

/**
 * How tall the RAIL IS DRAWN, in metres — exaggerated for visibility, but never
 * through the deck it is bolted to.
 *
 * `renderRoofRails` draws the rail at three times its real cross-section so a
 * 42 mm extrusion is visible at design zoom, and hangs it from the module
 * underside. Nothing checked the product of those two decisions against the
 * space between the module and the deck. Measured across all 45 catalogue
 * systems, four drive the drawn rail straight through the roof:
 *
 *     s5-pvkit           stack 0.088   3x rail 0.1143   -26 mm
 *     dpw-powerrail      stack 0.159   3x rail 0.1714   -12 mm
 *     renusol-vs-plus    stack 0.170   3x rail 0.2042   -34 mm
 *     mse-rapid-rail     stack 0.170   3x rail 0.2042   -34 mm
 *
 * and k2-crossrail and schletter-classic clear it by 0.4 mm, which renders as
 * z-fighting rather than clearance.
 *
 * 🚨 THIS LIVES HERE, NOT IN THE RENDERER, BECAUSE A TEST THAT RE-DERIVES THE
 * CLAMP PROVES NOTHING. The first guard for this recomputed
 * `min(railH * 3, max(railH, stack - gap))` inside the test file and asserted
 * on its own arithmetic — so deleting the clamp from `renderRoofRails` left it
 * green. A rule the renderer must obey has to be a function the renderer calls
 * and the test calls.
 *
 * Returns null when the system draws no rail at all.
 */
export const RAIL_DRAW_SCALE = 3;
/** Deck left visible under the rail, so "just touching" cannot read as z-fighting. */
export const RAIL_DECK_GAP_M = 0.005;

export function drawnRailHeightM(mountingSystemId: string | null | undefined): number | null {
  const rail = railCrossSectionM(mountingSystemId);
  if (!rail) return null;
  const stack = moduleStackHeightM(mountingSystemId);
  // The floor keeps the rail at least its true size if a stack were ever
  // smaller than the rail itself — a negative drawn height is not a smaller
  // rail, it is an inside-out box.
  const maxDrawn = Math.max(rail.heightM, stack - RAIL_DECK_GAP_M);
  return Math.min(rail.heightM * RAIL_DRAW_SCALE, maxDrawn);
}

/** Where the drawn rail's underside sits above the deck, in metres. */
export function drawnRailClearanceM(mountingSystemId: string | null | undefined): number | null {
  const drawn = drawnRailHeightM(mountingSystemId);
  if (drawn === null) return null;
  return moduleStackHeightM(mountingSystemId) - drawn;
}
