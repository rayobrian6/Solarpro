/**
 * components/3d/controls/index.ts
 *
 * Public surface for the Canvas Control Strip (Aurora parity — bottom-left
 * floating dock with compass + zoom +/-, layer toggles).
 *
 * Import from SolarEngine3D.tsx with:
 *   import { CanvasControls, type LayerToggle } from './controls';
 *
 * See ./CanvasControls.tsx for the React component,
 * ./heading.ts for the compass rotation math, and
 * ./zoom.ts for the zoom step math. Design doc: ./DESIGN.md.
 */

export { CanvasControls } from './CanvasControls';
export type { CanvasControlsProps, LayerToggle } from './CanvasControls';

export {
  headingToCompassRotationDeg,
  headingToCardinal,
  normalizeHeadingRad,
  normalizeHeadingDeg,
  type Cardinal,
} from './heading';

export {
  computeZoomedRadius,
  ZOOM_STEP_FACTOR,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
  type ZoomDirection,
} from './zoom';

export {
  ICON_PARCEL,
  ICON_ROOF,
  ICON_SHADE,
} from './icons';
