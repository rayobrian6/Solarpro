/**
 * components/3d/obstruction/index.ts
 *
 * Barrel re-export for the Aurora-parity "Add Obstruction" primitive.
 *
 * Consumers (SolarEngine3D.tsx) import from this file; the implementation
 * lives in `./dimensions` and is unit-tested in
 * `tests/obstruction.test.ts`. The Cesium side (PolygonGraphics +
 * per-position-height extrusion + label) stays in SolarEngine3D.tsx where
 * the viewer / state lives.
 */

export {
  // Defaults — single source of truth for the right-panel sliders.
  DEFAULT_OBSTRUCTION_FOOTPRINT_W_M,
  DEFAULT_OBSTRUCTION_FOOTPRINT_D_M,
  DEFAULT_OBSTRUCTION_HEIGHT_M,
  // Clamp range — exposed for the right-panel input min/max attributes.
  MIN_OBSTRUCTION_FOOTPRINT_M,
  MAX_OBSTRUCTION_FOOTPRINT_M,
  MIN_OBSTRUCTION_HEIGHT_M,
  MAX_OBSTRUCTION_HEIGHT_M,
  // Pure helpers.
  clampObstructionFootprint,
  clampObstructionHeight,
  buildObstructionFootprint,
  obstructionFootprintAreaM2,
  obstructionFootprintDiagonalM,
  pointInsideObstructionRectangle,
  // Types.
  type ObstructionFootprint,
  type ObstructionFootprintPoint,
} from './dimensions';
