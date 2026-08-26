/**
 * components/3d/segments/index.ts
 *
 * Public exports for the segment-arrows feature. Other agents
 * (segment-colors, roof-wizard) and SolarEngine3D.tsx import from
 * here, not from individual files.
 */

export {
  createSegmentArrowOverlay,
  buildSegmentsFromPoints,
  defaultOutwardNormal,
  bearingOf,
  flipNormalDir,
  midpoint,
  type SegmentDescriptor,
  type SegmentArrowOverlay,
  type SegmentArrowUpdateOpts,
} from './SegmentArrowOverlay';
