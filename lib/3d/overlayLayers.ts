/**
 * lib/3d/overlayLayers.ts
 *
 * ONE ORDER FOR EVERY FLOATING PANEL OVER THE 3D CANVAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Twenty overlay panels each chose their own z-index: 20, 25, 50, 51, 52, 53,
 * 60, 62. Eleven of them picked 50, where nothing decides the order but the
 * sequence they happen to be written in — so moving a JSX block changed which
 * controls worked.
 *
 * 🚨 AN AUDIT FOUND EIGHTEEN CONTROLS A CLICK COULD NOT REACH, and they were
 * not obscure ones:
 *
 *   - The tool spine's SELECT arrow — the default tool — sat under the LiDAR
 *     properties panel. Clicking it nudged that panel's offset steppers.
 *   - The top-left dock's "Building" toggle was 100% covered. `setShowBuilding3D`
 *     has exactly one call site in ~16k lines — that button — so the solid
 *     building view had no reachable entry point at all, and the "Aerial"
 *     button nested inside it was unreachable for ever.
 *   - The Gable/Hip ROOF PITCH slider was under the instructions text, so the
 *     roof was built at whatever pitch the state happened to hold. (The state
 *     had its own, separate bug — see tests/mountFrozenClosure.test.ts. Two
 *     independent faults on one control, each sufficient to break it.)
 *   - The obstruction inspector's DELETE button went under the placement panel.
 *
 * Every one of them looked normal: correct cursor, correct hover, no feedback of
 * any kind. The owner's report was "Chimney may also not be wired end-to-end" —
 * the wiring was perfect and the BUTTON could not be pressed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Layers are ordered by WHAT A PERSON IS DOING, not by when the panel was
 * added. Reading loses to working; working loses to deciding.
 *
 *   readouts  <  reference  <  persistent controls  <  the thing you armed
 *             <  the thing you selected  <  the menu you opened  <  a question
 *
 * Gaps of ten leave room to insert a layer without renumbering, and a panel must
 * take a name from this file rather than a number, so the next one cannot
 * quietly land on 50 again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 WHAT ORDERING CANNOT FIX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A re-check of this scale confirmed it makes 37 controls reachable — and found
 * that where two panels are anchored to the SAME corner, no ordering helps: it
 * only chooses which one dies. Those need the panel MOVED. Do not "fix" them by
 * shuffling layers here.
 *
 * Already moved for this reason:
 *   - `lidar-properties` was at top-left (12,12), the same corner as
 *     `top-left-dock`. With LiDAR above, the dock's "Building" toggle was dead
 *     and `setShowBuilding3D` has one call site. With the dock above, LiDAR's
 *     "×" unload went dead and `setDataset(null)` has one call site. Moved to
 *     top: 56, clear of the dock's 33 px band.
 *   - `undo-redo-toolbar` shared the bottom-left corner with DesignStudio's
 *     "Report a bug" button (`fixed bottom-4 left-4 z-[60]`). Same trade either
 *     way; the chip moved to bottom: 64.
 *
 * Known and still outstanding — each needs a layout change, not a layer:
 *   - `instructions-panel` vs `top-right-stack` and vs the inspectors: one
 *     right-hand column, several panels. The help panel's collapse toggle is
 *     the casualty, and REFERENCE must stay under DOCK or the obstruction type
 *     chips go back under the help text.
 *   - `map-source-picker` vs `top-left-dock` below ~1380 px wide.
 *   - `top-left-dock`'s "Stitch" vs the placement panel at ~1024 px wide.
 *   - a 48 px band of the sun-simulator's time slider under `canvas-controls`
 *     at ~1024 px wide. Note this one is invisible to a centre-point check:
 *     the slider's own centre still resolves to itself.
 */

export const OVERLAY_Z = {
  /** Text the user reads and never clicks: status, coordinates, last log, legends. */
  READOUT: 10,

  /** Reference material — help text, the string legend. Passive by definition. */
  REFERENCE: 20,

  /** Data inspectors that are read far more than they are used (LiDAR). */
  DATA: 30,

  /** The basemap / imagery source toolbar. */
  BASEMAP: 40,

  /** Always-on control docks: the tool spine at rest, layer toggles, the sun
   *  simulator, the top-left view toggles, the right-hand stack at rest. */
  DOCK: 50,

  /** Docks that must beat a neighbouring dock where the two overlap on a narrow
   *  window. Canvas controls over the sun simulator; nothing else. */
  DOCK_OVER: 52,

  /** Destructive or state-changing chrome that must stay reachable: undo/redo,
   *  save. Above the docks it sits beside. */
  ACTION: 55,

  /** The panel for the tool that is ARMED right now — object type, dimensions.
   *  Transient and focused, so it outranks every passive panel. */
  PLACEMENT: 60,

  /** The panel for the object that is SELECTED right now. Outranks PLACEMENT:
   *  you must be able to delete or resize the thing you picked even while
   *  another tool is armed, and that was a live P0. */
  INSPECTOR: 70,

  /** An OPEN tool flyout. It is a menu — it wins over everything except a
   *  question being asked. */
  MENU: 80,

  /** Confirm / error overlays that block the view on purpose. Pre-existing. */
  MODAL: 100,

  /** The hover tooltip, which must never be occluded. Pre-existing. */
  TOOLTIP: 99999,
} as const;

export type OverlayLayer = keyof typeof OVERLAY_Z;
