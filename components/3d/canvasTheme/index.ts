/**
 * components/3d/canvasTheme/index.ts
 *
 * Public surface for the dark-canvas theme (Aurora parity — see
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §6).
 *
 * Import from SolarEngine3D.tsx with:
 *   import { CanvasTheme, type CanvasPhase } from './canvasTheme';
 *
 * Design doc: ./DESIGN.md
 */

export { CanvasTheme } from './CanvasTheme';
export type { CanvasThemeProps } from './CanvasTheme';

export {
  // Phase enum
  CANVAS_PHASES,
  // Themes
  DARK_THEME,
  LIGHT_THEME,
  THEMES,
  // Theme constants (for testability + downstream override)
  DARK_BACKGROUND,
  DARK_GRID_BACKGROUND_IMAGE,
  DARK_GRID_BACKGROUND_SIZE,
  GRID_MAJOR_ALPHA,
  GRID_MAJOR_SPACING_PX,
  GRID_MINOR_ALPHA,
  GRID_MINOR_SPACING_PX,
  // Pure functions
  getThemeForPhase,
  phaseToThemeClass,
  shouldRenderOverlay,
  parseCssColor,
  type CanvasPhase,
} from './canvasTheme.constants';
