/**
 * components/3d/help/helpText.ts
 *
 * Single source of truth for the context-aware INSTRUCTIONS text shown in
 * the left sidebar of the 3D design surface.
 *
 * Aurora parity: matches the INSTRUCTIONS panel from
 * `frame_0070.jpg` (and the contextual text changes documented in
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1).
 *
 * Rules for this table:
 *   1. Every key MUST be a real PlacementMode value (or one of the
 *      internal HelpMode values listed below) — the HelpPanel
 *      fallback handles unknowns.
 *   2. Every value MUST be 1–3 short sentences. No TODOs, no TBDs.
 *   3. Body text should answer "what should the user click next?"
 *
 * To add a new mode: add the key, add the text, add a test in
 * tests/helpPanel.test.ts. The completeness test will fail until
 * you do.
 */

// ─── Mode keys ──────────────────────────────────────────────────────────────
//
// We mirror SolarEngine3D's PlacementMode union for the modes that have a
// real user interaction, plus a few "logical" modes that don't yet exist
// as a PlacementMode (wizard_mark / wizard_analyze / wizard_adjust —
// those are step 1/2/3 of the future 3-step Roof Wizard).
//
// `idle` is the no-tool-active default and matches Aurora's "Draw the
// roof with a Site Model..." text.
//
// `unknown` is the runtime fallback — it MUST always be present so the
// panel never renders blank.

export type HelpMode =
  // Aurora-parity modes (from HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1)
  | 'idle'
  | 'block'
  | 'roof_gable'
  | 'roof_hip'
  | 'tree'
  | 'wizard_mark'
  | 'wizard_analyze'
  | 'wizard_adjust'
  // Solarpro PlacementMode values
  | 'select'
  | 'roof'
  | 'obstruction'
  | 'plane3d'
  | 'mark_plane'
  | 'auto_roof'
  | 'ground'
  | 'ground_array'
  | 'fence'
  | 'measure'
  | 'ruler'
  | 'pick_house'
  | 'surface_select'
  | 'extend_row'
  | 'add_row'
  | 'set_direction'
  | 'set_origin'
  | 'snap_panel'
  // Design-phase tools (right sidebar — when design-panel ships)
  | 'design_auto'
  | 'design_panels'
  | 'design_inverter'
  | 'design_bos'
  | 'design_string'
  | 'design_connect'
  | 'design_walkway'
  | 'design_faceinfo'
  // Runtime fallback
  | 'unknown';

// ─── The table ─────────────────────────────────────────────────────────────

export const HELP_TEXT_BY_MODE: Record<HelpMode, string> = {
  // ── Aurora parity (frame 70 + HANDOFF §1) ─────────────────────────────────
  idle:
    'Draw the roof with a Site Model, then click on this place to add a new system design.',
  block:
    'Click the corners of the building footprint. Right-click or press Enter to finish.',
  roof_gable:
    'Click the two eave corners. The ridge runs along the long edge.',
  roof_hip:
    'Click the four eave corners in order (counter-clockwise preferred).',
  tree:
    'Click to place a tree. The tree canopy is shown as a blue preview.',
  wizard_mark:
    'Click to add vertices. Press Enter to finish, or click the ✓ button.',
  wizard_analyze:
    'Click any yellow arrow to flip its ridge direction if it looks wrong.',
  wizard_adjust:
    'Drag the white handles to fine-tune vertex positions in 3D.',

  // ── Solarpro placement modes ─────────────────────────────────────────────
  select:
    'Click an object to select it. Shift-click to add to the selection. Esc clears.',
  roof:
    'Click roof vertices to outline a roof face. Right-click or press Enter to finish.',
  obstruction:
    'Click to place an obstruction (chimney, vent, dormer). Right-click to cancel.',
  plane3d:
    'Click to mark roof edges. Right-click to finalize the plane.',
  mark_plane:
    'Click to add vertices. Press Enter to finish, or click the ✓ button.',
  auto_roof:
    'Click a roof face to auto-fill it with panels using the selected layout.',
  ground:
    'Click along the ground to set the array boundary. Right-click to finish.',
  ground_array:
    'Click to add array rows. The engine spaces them to avoid inter-row shading.',
  fence:
    'Click along the fence line to set section breaks. Right-click to finish.',
  measure:
    'Click two points to measure distance. Press Esc to clear.',
  ruler:
    'Drag the ruler to reposition. Press R to rotate 90°.',
  pick_house:
    'Click the building you want to design for. We will crop to that footprint.',
  surface_select:
    'Click a roof surface to select it for editing.',
  extend_row:
    'Click an existing row endpoint to extend it in that direction.',
  add_row:
    'Click an existing row to add a parallel row above it.',
  set_direction:
    'Drag the arrow to set the panel array direction (azimuth).',
  set_origin:
    'Click the point where the array should start.',
  snap_panel:
    'Drag a panel to snap it to the nearest free slot on the selected roof face.',

  // ── Design-phase tools (future right-sidebar entries) ────────────────────
  design_auto:
    'Click anywhere on the roof to auto-place panels with the optimal layout.',
  design_panels:
    'Click to manually place a panel. Right-click to cancel.',
  design_inverter:
    'Click to place an inverter near the array. Right-click to cancel.',
  design_bos:
    'Click to place a BOS component (combiner, disconnect). Right-click to cancel.',
  design_string:
    'Click panels in order to group them into a string. Press Enter to finish.',
  design_connect:
    'Click panels to wire them to the inverter. Press Enter to finish.',
  design_walkway:
    'Click a flat roof face to add a code-required walkway path.',
  design_faceinfo:
    'Hover a roof face to see pitch, azimuth, and usable area.',

  // ── Fallback (must never be blank) ───────────────────────────────────────
  unknown:
    'Pick a tool from the sidebar to begin. Hover any tool to see what it does.',
};

// ─── Lookup helper ─────────────────────────────────────────────────────────
//
// Centralized so the HelpPanel and any future consumer (tooltips, command
// palette) use the SAME fallback. NEVER returns undefined.

export function helpTextFor(mode: string | null | undefined): string {
  if (mode && (mode in HELP_TEXT_BY_MODE)) {
    return HELP_TEXT_BY_MODE[mode as HelpMode];
  }
  return HELP_TEXT_BY_MODE.unknown;
}

// ─── Completeness audit (test-facing) ──────────────────────────────────────

export const ALL_HELP_MODES: readonly HelpMode[] = Object.freeze(
  Object.keys(HELP_TEXT_BY_MODE) as HelpMode[],
);

/** Modes that MUST have help text per the Aurora parity bar. */
export const REQUIRED_AURORA_PARITY_MODES: readonly HelpMode[] = Object.freeze([
  'idle',
  'block',
  'roof_gable',
  'roof_hip',
  'tree',
  'wizard_mark',
  'wizard_analyze',
  'wizard_adjust',
]);
