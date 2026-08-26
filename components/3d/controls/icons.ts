/**
 * components/3d/controls/icons.ts
 *
 * Small inline SVG path strings (24×24 viewBox) used by the
 * CanvasControls layer-toggle buttons. Kept in this module so the
 * parent (SolarEngine3D) doesn't need to inline them and so the
 * icon set lives next to the component that uses it.
 *
 * Path style: stroke-based, 1.5px stroke-width, fill: none. Painted
 * in the accent color (`#ff8c00`) when the layer is ON, and in
 * muted white (`rgba(255,255,255,0.55)`) when it's OFF.
 *
 * All paths are valid 24×24 SVG, single-path, single-segment.
 */

export const ICON_PARCEL =
  // A 5-sided polygon outline (lot shape) — M3,7 L12,3 L21,7 L19,20 L5,20 Z
  'M3 7 L12 3 L21 7 L19 20 L5 20 Z';

export const ICON_ROOF =
  // A house with a peaked roof — M3,12 L12,3 L21,12 L21,21 L3,21 Z
  'M3 12 L12 3 L21 12 L21 21 L3 21 Z';

export const ICON_SHADE =
  // A sun-behind-cloud shape — half-circle (the sun) with three
  // cloud arcs beneath it. Path is fill-based since stroke doesn't
  // render the half-fill visually.
  'M7 14 a5 5 0 0 1 10 0 H19 a2 2 0 0 1 0 4 H5 a2 2 0 0 1 0 -4 H7 Z';
