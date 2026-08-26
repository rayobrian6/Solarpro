/**
 * components/3d/tree/index.ts
 *
 * Barrel export for the tree-cursor slice. SolarEngine3D.tsx imports from
 * this path; keeping it as a thin re-export means the public surface of
 * the slice is one import, and we can split/move internals without
 * touching the consumer.
 */

export {
  DEFAULT_TREE_CANOPY_RADIUS_M,
  MIN_TREE_CANOPY_RADIUS_M,
  MAX_TREE_CANOPY_RADIUS_M,
  canopyDiameterM,
  canopyRadiusInFeet,
  canopyFootprintAreaM2,
  canopyRadiusToEllipseAxes,
  type CanopyEllipseAxes,
} from './canopy';

export { TreeCursor, type TreeCursorProps } from './TreeCursor';
export { default } from './TreeCursor';
