/**
 * localProjection.ts — Local Engineering Coordinate System (LECS)  v47.99
 *
 * Implements a flat-earth equirectangular projection anchored at a project
 * origin point.  All CAD geometry is stored in FEET relative to that origin.
 *
 * Why feet?
 *   • US construction documents (permit plansets, AHJ submittals) use feet.
 *   • Fire setbacks specified in inches / feet by NEC / IFC / NFPA 855.
 *   • Panel dimensions specified in inches by manufacturers.
 *   • Avoids unit-mismatch bugs between metric CAD engine and imperial specs.
 *
 * Projection accuracy:
 *   Equirectangular error < 0.05 % for polygons < 300 ft (all residential roofs).
 *   The cosLat correction handles E-W compression correctly.
 *
 * Units:
 *   All public functions accept / return FEET unless the name includes "Meters"
 *   or "LatLng".  Internal intermediate values are in meters (clearly labeled).
 *
 * Coordinate frame:
 *   +X = East  (feet)
 *   +Y = North (feet)
 *   Origin = project origin lat/lng = (0, 0)
 */

// ─── Unit Conversion Constants ───────────────────────────────────────────────

/** Feet per meter — exact by definition */
export const FEET_PER_METER  = 3.28084;
/** Meters per foot — exact by definition */
export const METERS_PER_FOOT = 0.3048;

// ─── Earth Constants ─────────────────────────────────────────────────────────

const METERS_PER_DEG_LAT = 111_320;          // meters per degree of latitude
const DEG_TO_RAD         = Math.PI / 180;

// ─── Local Coordinate Type ───────────────────────────────────────────────────

/** A point in the local engineering coordinate system (feet, origin = project origin). */
export interface LocalFeetPoint {
  xFeet: number;   // east of project origin  (feet, +east)
  yFeet: number;   // north of project origin (feet, +north)
}

/** Geographic coordinate pair. */
export interface LatLngPoint {
  lat: number;
  lng: number;
}

// ─── Projection Functions ────────────────────────────────────────────────────

/**
 * Convert a geographic coordinate to local engineering feet.
 *
 * @param lat        - latitude of the point to project
 * @param lng        - longitude of the point to project
 * @param originLat  - latitude of the project origin (0,0)
 * @param originLng  - longitude of the project origin (0,0)
 * @returns LocalFeetPoint { xFeet, yFeet }
 */
export function latLngToLocalFeet(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number
): LocalFeetPoint {
  const cosLat        = Math.cos(originLat * DEG_TO_RAD);
  const metersPerDegLng = METERS_PER_DEG_LAT * cosLat;

  const xMeters = (lng - originLng) * metersPerDegLng;
  const yMeters = (lat - originLat) * METERS_PER_DEG_LAT;

  return {
    xFeet: xMeters * FEET_PER_METER,
    yFeet: yMeters * FEET_PER_METER,
  };
}

/**
 * Convert local engineering feet back to geographic coordinates.
 *
 * @param xFeet     - east offset from project origin (feet)
 * @param yFeet     - north offset from project origin (feet)
 * @param originLat - latitude of the project origin
 * @param originLng - longitude of the project origin
 * @returns LatLngPoint { lat, lng }
 */
export function localFeetToLatLng(
  xFeet: number,
  yFeet: number,
  originLat: number,
  originLng: number
): LatLngPoint {
  const cosLat          = Math.cos(originLat * DEG_TO_RAD);
  const metersPerDegLng = METERS_PER_DEG_LAT * cosLat;

  const xMeters = xFeet * METERS_PER_FOOT;
  const yMeters = yFeet * METERS_PER_FOOT;

  return {
    lat: originLat + yMeters / METERS_PER_DEG_LAT,
    lng: originLng + xMeters / metersPerDegLng,
  };
}

// ─── Polygon Helpers ─────────────────────────────────────────────────────────

/**
 * Convert an array of lat/lng vertices to local feet coordinates.
 * The origin is typically the polygon centroid or the project origin.
 */
export function latLngArrayToLocalFeet(
  vertices: LatLngPoint[],
  originLat: number,
  originLng: number
): LocalFeetPoint[] {
  return vertices.map(v => latLngToLocalFeet(v.lat, v.lng, originLat, originLng));
}

/**
 * Convert an array of local feet points back to lat/lng.
 */
export function localFeetArrayToLatLng(
  points: LocalFeetPoint[],
  originLat: number,
  originLng: number
): LatLngPoint[] {
  return points.map(p => localFeetToLatLng(p.xFeet, p.yFeet, originLat, originLng));
}

/**
 * Compute the centroid of a lat/lng polygon.
 * Returns both the centroid lat/lng and its local feet representation (always 0,0
 * when origin IS the centroid — useful for verification).
 */
export function polygonCentroidLatLng(vertices: LatLngPoint[]): LatLngPoint {
  const n = vertices.length;
  if (n === 0) return { lat: 0, lng: 0 };
  let latSum = 0, lngSum = 0;
  for (const v of vertices) { latSum += v.lat; lngSum += v.lng; }
  return { lat: latSum / n, lng: lngSum / n };
}

// ─── Unit Conversion Helpers ─────────────────────────────────────────────────

/** Convert feet to meters. */
export function feetToMeters(feet: number): number {
  return feet * METERS_PER_FOOT;
}

/** Convert meters to feet. */
export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

/** Convert inches to feet. */
export function inchesToFeet(inches: number): number {
  return inches / 12;
}

/** Convert feet to inches. */
export function feetToInches(feet: number): number {
  return feet * 12;
}

// ─── Standard Module Dimensions ──────────────────────────────────────────────

/**
 * Standard 440W solar module dimensions in feet.
 *   Width:  3.72 ft = 44.6 in = 1.134 m
 *   Height: 5.79 ft = 69.5 in = 1.764 m
 *
 * These are the canonical LECS dimensions for all panel calculations.
 * Convert to meters only for Cesium/map rendering.
 */
export const STANDARD_PANEL_WIDTH_FEET  = 3.72;   // ft (44.6 in)
export const STANDARD_PANEL_HEIGHT_FEET = 5.79;   // ft (69.5 in)

/** Default mid-clamp gap between panels (≈ ¼ inch = 0.02 ft). */
export const DEFAULT_PANEL_SPACING_FEET = 0.02;   // ft (0.24 in)

/** Default row gap for flush roof mount (same as panel spacing). */
export const DEFAULT_ROW_SPACING_FEET   = 0.066;  // ft (0.79 in ≈ 20mm)

// ─── Fire Setback Constants ───────────────────────────────────────────────────

/** AHJ standard edge setback: 18 inches = 1.5 feet. */
export const FIRE_SETBACK_EDGE_FEET     = 1.5;    // ft (18 in)
/** AHJ ridge setback: 18 inches = 1.5 feet. */
export const FIRE_SETBACK_RIDGE_FEET    = 1.5;    // ft (18 in)
/** AHJ fire pathway width: 36 inches = 3.0 feet. */
export const FIRE_PATHWAY_WIDTH_FEET    = 3.0;    // ft (36 in)