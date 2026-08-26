/**
 * lib/3d/lidar/types.ts
 *
 * Pure data types for the LiDAR integration. No Cesium, no DOM.
 * Mirrors the Aurora "LiDAR Properties" panel model.
 */

/**
 * A single LiDAR return.
 *
 * Coordinates are in METERS in a local tangent plane (east-north-up relative
 * to the dataset centroid). The dataset bounds describe the same frame, so
 * downstream code can build a Cesium `Cartesian3` from any point by:
 *
 *     Cesium.Cartesian3.fromDegrees(
 *       centroidLat + p.y / METERS_PER_DEG_LAT,
 *       centroidLng + p.x / metersPerDegLng(centroidLat),
 *       p.z,
 *     );
 *
 * This keeps the render path simple and avoids per-point projection cost.
 */
export interface LiDARPoint {
  /** Easting in meters (positive = east of centroid) */
  x: number;
  /** Northing in meters (positive = north of centroid) */
  y: number;
  /** Elevation in meters above WGS84 ellipsoid */
  z: number;
  /** LAS point classification (0 = never classified, 2 = ground, 6 = building, etc.) */
  classification?: number;
  /** Optional RGB 0–255 from LAS point formats 2/3 */
  r?: number;
  g?: number;
  b?: number;
}

export interface LiDARBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * A loaded LiDAR dataset. Immutable from the caller's perspective — any
 * transform (offset, sub-sampling) returns a new dataset.
 */
export interface LiDARDataset {
  /** Source file name for display ("site.las") */
  source: string;
  /** Centroid of the dataset in WGS84 (degrees). Used to convert to/from lat/lng. */
  centroidLat: number;
  centroidLng: number;
  /** All point returns, in the local ENU frame (meters) */
  points: LiDARPoint[];
  /** Pre-computed bounds of `points` (meters) */
  bounds: LiDARBounds;
  /** Convenience: number of points */
  count: number;
  /**
   * Coordinate Reference System hint. For v1 we always use a local tangent
   * ENU frame, so this is constant. Future stages may carry WGS84 UTM zones
   * for proper survey-grade reprojection.
   */
  crs: 'local-enu';
}

/** Aurora's "Style" dropdown options */
export type LiDARStyle = 'mesh' | 'pointCloud';

/** X/Y/Z offset in FEET (Aurora UI unit). Applied to the dataset at render time. */
export interface LiDAROffset {
  x: number;
  y: number;
  z: number;
}

/** Full UI state of the LiDAR feature. */
export interface LiDARState {
  dataset: LiDARDataset | null;
  style: LiDARStyle;
  textured: boolean;
  offset: LiDAROffset;
  isLoading: boolean;
  error: string | null;
}

/** Default state used by `useLiDARState`. */
export const DEFAULT_LIDAR_STATE: LiDARState = {
  dataset: null,
  style: 'mesh',
  textured: true,
  offset: { x: 0, y: 0, z: 0 },
  isLoading: false,
  error: null,
};

/** Conversion: 1 foot = 0.3048 meters (NIST, exact). */
export const FEET_PER_METER = 1 / 0.3048;
export const METERS_PER_FOOT = 0.3048;
