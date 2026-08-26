/**
 * lib/3d/blockMath.ts
 *
 * Pure math for the 3D Block + Gable + Hip primitives (v64). Extracted from
 * SolarEngine3D.tsx so it can be unit-tested without Cesium, React, or a
 * browser environment.
 *
 * All functions are deterministic: same input → same output. No side effects,
 * no DOM, no Cesium. The caller converts the resulting arrays of {lat, lng,
 * heightM} into Cesium Cartesian3 instances when rendering.
 *
 * Coordinate convention:
 *   - Footprint corners are lat/lng in WGS84
 *   - 1° lat ≈ 111_320 m, 1° lng ≈ 111_320 * cos(lat) m
 *   - Heights are meters above the WGS84 ellipsoid (not above ground level)
 *
 * This file is intentionally small and pure. The integration with Cesium
 * (entity creation, color, outline) lives in SolarEngine3D.tsx — this file
 * is the math.
 */

export const METERS_PER_DEG_LAT = 111_320;

export function metersPerDegLng(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** Compute the rectangle dimensions and centroid from 2 user-clicked corners. */
export interface BlockDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
  centroidLat: number;
  centroidLng: number;
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export function computeBlockDimensions(
  sw_in: { lat: number; lng: number },
  ne_in: { lat: number; lng: number },
  heightM: number,
): BlockDimensions {
  const sw = { lat: Math.min(sw_in.lat, ne_in.lat), lng: Math.min(sw_in.lng, ne_in.lng) };
  const ne = { lat: Math.max(sw_in.lat, ne_in.lat), lng: Math.max(sw_in.lng, ne_in.lng) };
  const midLat = (sw.lat + ne.lat) / 2;
  const widthM = Math.abs(ne.lng - sw.lng) * metersPerDegLng(midLat);
  const depthM = Math.abs(ne.lat - sw.lat) * METERS_PER_DEG_LAT;
  return {
    widthM,
    depthM,
    heightM,
    centroidLat: midLat,
    centroidLng: (sw.lng + ne.lng) / 2,
    sw,
    ne,
  };
}

/** Result of a gable roof computation. Caller maps to Cesium polygons. */
export interface GableGeometry {
  /** 4 corner positions of the eave (in 3D, heightM=eave height). */
  eaveSW: { lat: number; lng: number; h: number };
  eaveSE: { lat: number; lng: number; h: number };
  eaveNW: { lat: number; lng: number; h: number };
  eaveNE: { lat: number; lng: number; h: number };
  /** 2 ridge endpoints (in 3D, heightM=ridge height). */
  ridgeA: { lat: number; lng: number; h: number };
  ridgeB: { lat: number; lng: number; h: number };
  /** Slope rise (ridge height - eave height) in meters. */
  ridgeRiseM: number;
  /** True if the long edge is the east-west (lng) axis. */
  longIsLng: boolean;
  /** Normalized eave corners (SW = min lat/lng, NE = max lat/lng). */
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export function computeGableGeometry(
  sw_in: { lat: number; lng: number },
  ne_in: { lat: number; lng: number },
  eaveHeightM: number,
  pitchDeg: number,
): GableGeometry {
  const dims = computeBlockDimensions(sw_in, ne_in, eaveHeightM);
  const longIsLng = dims.widthM >= dims.depthM;
  const shortEdgeM = longIsLng ? dims.depthM : dims.widthM;
  const ridgeRiseM = (shortEdgeM / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const ridgeHeightM = eaveHeightM + ridgeRiseM;
  // Ridge runs along the long edge at the centroid
  const longEdgeM = longIsLng ? dims.widthM : dims.depthM;
  const halfLongDeg = (longEdgeM / 2) / (longIsLng ? metersPerDegLng(dims.centroidLat) : METERS_PER_DEG_LAT);
  const ridgeA = longIsLng
    ? { lat: dims.centroidLat, lng: dims.centroidLng - halfLongDeg, h: ridgeHeightM }
    : { lat: dims.centroidLat - halfLongDeg, lng: dims.centroidLng, h: ridgeHeightM };
  const ridgeB = longIsLng
    ? { lat: dims.centroidLat, lng: dims.centroidLng + halfLongDeg, h: ridgeHeightM }
    : { lat: dims.centroidLat + halfLongDeg, lng: dims.centroidLng, h: ridgeHeightM };
  return {
    eaveSW: { ...dims.sw, h: eaveHeightM },
    eaveSE: { lat: dims.sw.lat, lng: dims.ne.lng, h: eaveHeightM },
    eaveNW: { lat: dims.ne.lat, lng: dims.sw.lng, h: eaveHeightM },
    eaveNE: { ...dims.ne, h: eaveHeightM },
    ridgeA,
    ridgeB,
    ridgeRiseM,
    longIsLng,
    sw: dims.sw,
    ne: dims.ne,
  };
}

/** Result of a hip roof computation. Ridge is shorter than the eave. */
export interface HipGeometry extends GableGeometry {
  hipSetbackM: number;
  ridgeLengthM: number;
}

export function computeHipGeometry(
  sw_in: { lat: number; lng: number },
  ne_in: { lat: number; lng: number },
  eaveHeightM: number,
  pitchDeg: number,
  hipSetbackFrac = 1 / 3,
): HipGeometry {
  const dims = computeBlockDimensions(sw_in, ne_in, eaveHeightM);
  const longIsLng = dims.widthM >= dims.depthM;
  const longEdgeM = longIsLng ? dims.widthM : dims.depthM;
  const shortEdgeM = longIsLng ? dims.depthM : dims.widthM;
  const hipSetbackM = shortEdgeM * hipSetbackFrac;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const ridgeRiseM = (shortEdgeM / 2) * Math.tan(pitchRad);
  const ridgeHeightM = eaveHeightM + ridgeRiseM;
  // Ridge length is longEdge minus 2*hipSetback (set back from both short ends)
  const ridgeLengthM = Math.max(0, longEdgeM - 2 * hipSetbackM);
  const halfRidgeLongDeg = (ridgeLengthM / 2) / (longIsLng ? metersPerDegLng(dims.centroidLat) : METERS_PER_DEG_LAT);
  const ridgeA = longIsLng
    ? { lat: dims.centroidLat, lng: dims.centroidLng - halfRidgeLongDeg, h: ridgeHeightM }
    : { lat: dims.centroidLat - halfRidgeLongDeg, lng: dims.centroidLng, h: ridgeHeightM };
  const ridgeB = longIsLng
    ? { lat: dims.centroidLat, lng: dims.centroidLng + halfRidgeLongDeg, h: ridgeHeightM }
    : { lat: dims.centroidLat + halfRidgeLongDeg, lng: dims.centroidLng, h: ridgeHeightM };
  return {
    eaveSW: { ...dims.sw, h: eaveHeightM },
    eaveSE: { lat: dims.sw.lat, lng: dims.ne.lng, h: eaveHeightM },
    eaveNW: { lat: dims.ne.lat, lng: dims.sw.lng, h: eaveHeightM },
    eaveNE: { ...dims.ne, h: eaveHeightM },
    ridgeA,
    ridgeB,
    ridgeRiseM,
    longIsLng,
    hipSetbackM,
    ridgeLengthM,
    sw: dims.sw,
    ne: dims.ne,
  };
}

/** Clamp a block height to a safe range (1.0m to 30.0m). */
export function clampBlockHeight(heightM: number): number {
  return Math.max(1.0, Math.min(30.0, heightM));
}
