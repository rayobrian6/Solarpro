/**
 * components/3d/canvasTheme/canvasTheme.constants.ts
 *
 * Pure data + pure functions for the dark-canvas theme (Aurora parity).
 *
 * No React, no DOM, no Cesium. The whole point of this file is to be
 * trivially testable from `tests/canvasTheme.test.ts` without jsdom.
 *
 * See ./DESIGN.md for the Aurora parity bar, the visual spec, and the
 * handoffs to other agents.
 *
 * Source of truth for the palette is HANDOFF_2026-08-25_AURORA_ANALYSIS.md
 * §6 + aurora_frames/frame_0147.jpg.
 */

// ── Phase enum ──────────────────────────────────────────────────────────────

/**
 * The two visual phases the 3D design surface can be in.
 *
 * - `'site_model'` — drawing the roof, the building footprint, obstructions.
 *   The current 3D viewer is the same Cesium scene with full Google
 *   satellite imagery as the backdrop. No dark overlay, no grid.
 *
 * - `'design'` — the user has saved the site model and is now placing
 *   panels, inverters, BOS, and stringing. Aurora's frame 147 shows this
 *   phase with a dark navy background + a subtle white grid, visually
 *   distinct from the Site Model view.
 */
export const CANVAS_PHASES = ['site_model', 'design'] as const;

export type CanvasPhase = (typeof CANVAS_PHASES)[number];

// ── Grid spec ───────────────────────────────────────────────────────────────

/**
 * Spacing for the two-tier grid overlay. Aurora's frame 147 has a fine
 * subdivision (~10px) and a brighter major grid (~50px). Confirmed by
 * the HANDOFF analysis ("maybe 50px grid").
 */
export const GRID_MAJOR_SPACING_PX = 50;
export const GRID_MINOR_SPACING_PX = 10;

/**
 * Alpha values for the two grid tiers. Both are white but the major
 * grid is ~2.5x brighter so the eye can latch onto it.
 */
export const GRID_MAJOR_ALPHA = 0.10;
export const GRID_MINOR_ALPHA = 0.04;

// ── Dark theme (Design phase) ───────────────────────────────────────────────

/**
 * Aurora parity: dark navy background. Per the agent.md target, the
 * dark color is `#1a1a2e` (RGB 26, 26, 46). We use 75% alpha so the
 * Cesium entities (roof outlines, trees, panels) remain visible
 * underneath while the satellite imagery is fully muted.
 */
export const DARK_BACKGROUND = 'rgba(26, 26, 46, 0.75)';

/**
 * Stacked linear-gradient grid. Two pairs of gradients: the first pair
 * draws vertical + horizontal lines at the major spacing (50px) at
 * 10% alpha, the second pair draws vertical + horizontal lines at the
 * minor spacing (10px) at 4% alpha. The browser composites them on top
 * of the background color.
 *
 * This is exactly the pattern the agent.md suggests: "The grid can be
 * a CSS background-image (linear-gradient grid)".
 */
export const DARK_GRID_BACKGROUND_IMAGE = [
  // Major grid: vertical + horizontal lines every 50px
  `linear-gradient(rgba(255, 255, 255, ${GRID_MAJOR_ALPHA}) 1px, transparent 1px)`,
  `linear-gradient(90deg, rgba(255, 255, 255, ${GRID_MAJOR_ALPHA}) 1px, transparent 1px)`,
  // Minor grid: vertical + horizontal lines every 10px
  `linear-gradient(rgba(255, 255, 255, ${GRID_MINOR_ALPHA}) 1px, transparent 1px)`,
  `linear-gradient(90deg, rgba(255, 255, 255, ${GRID_MINOR_ALPHA}) 1px, transparent 1px)`,
].join(', ');

/**
 * Background-size for the stacked linear-gradients above. The first two
 * gradients (major) repeat every 50px, the second two (minor) repeat
 * every 10px. Order must match the gradients in
 * `DARK_GRID_BACKGROUND_IMAGE`.
 */
export const DARK_GRID_BACKGROUND_SIZE = [
  `${GRID_MAJOR_SPACING_PX}px ${GRID_MAJOR_SPACING_PX}`,
  `${GRID_MAJOR_SPACING_PX}px ${GRID_MAJOR_SPACING_PX}`,
  `${GRID_MINOR_SPACING_PX}px ${GRID_MINOR_SPACING_PX}`,
  `${GRID_MINOR_SPACING_PX}px ${GRID_MINOR_SPACING_PX}`,
].join(', ');

export const DARK_THEME = {
  /** The dark overlay background (color + alpha). */
  background: DARK_BACKGROUND,
  /** Stacked linear-gradient grid as a CSS background-image string. */
  gridBackgroundImage: DARK_GRID_BACKGROUND_IMAGE,
  /** background-size for the grid. */
  gridBackgroundSize: DARK_GRID_BACKGROUND_SIZE,
  /** CSS class for downstream selectors (E2E, storybook, map-sources). */
  className: 'solarpro-canvas--design',
  /** Stable hook for other agents to read the phase from a DOM attribute. */
  dataAttribute: 'design',
} as const;

// ── Light theme (Site Model phase — no overlay) ────────────────────────────

/**
 * Site Model: the current Cesium scene with full satellite imagery is
 * the background. No overlay, no grid. `CanvasTheme` returns `null` in
 * this phase, but the theme object is exported so callers (e.g. E2E
 * tests) can assert the no-op behavior without rendering React.
 */
export const LIGHT_THEME = {
  background: 'transparent',
  gridBackgroundImage: 'none',
  gridBackgroundSize: 'auto',
  className: 'solarpro-canvas--site-model',
  dataAttribute: 'site_model',
} as const;

// ── Phase → theme map ──────────────────────────────────────────────────────

export const THEMES = {
  site_model: LIGHT_THEME,
  design: DARK_THEME,
} as const;

/**
 * Returns the theme object for a given phase. Pure: same phase → same
 * theme reference. Safe to call from React render or from a test.
 */
export function getThemeForPhase(phase: CanvasPhase) {
  return THEMES[phase];
}

/**
 * Returns the CSS class name for the given phase. The class is set on
 * the overlay div alongside the inline styles, as a stable hook for
 * downstream agents (e.g. `map-sources` can read
 * `.solarpro-canvas--design` to dim the Cesium globe) and for E2E
 * selectors.
 */
export function phaseToThemeClass(phase: CanvasPhase): string {
  return THEMES[phase].className;
}

/**
 * Whether the overlay should be rendered for the given phase.
 *
 * - `'design'` → `true` (dark + grid overlay paints over the canvas)
 * - `'site_model'` → `false` (return `null`; the satellite imagery is
 *   the background)
 *
 * This is the single decision point the `CanvasTheme` React component
 * uses. Factoring it out makes the policy testable without React.
 */
export function shouldRenderOverlay(phase: CanvasPhase): boolean {
  return phase === 'design';
}

// ── Palette validation helpers (for tests) ─────────────────────────────────

/**
 * Parses a CSS color string and returns its RGBA components, or `null`
 * if the string is not a recognized CSS color. Supports the `rgb(...)`
 * and `rgba(...)` forms we actually use; the full CSS color grammar
 * is intentionally not implemented (we only round-trip our own
 * constants).
 */
export function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const m = input.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}
