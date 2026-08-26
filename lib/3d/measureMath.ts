/**
 * lib/3d/measureMath.ts
 *
 * Pure math for the v66 Measurements + Ruler tools. Extracted so it can be
 * unit-tested without Cesium, React, or a browser environment. Mirrors the
 * pattern set by lib/3d/blockMath.ts.
 *
 * Coordinate convention:
 *   - Inputs are { lat, lng, h } in WGS84, h in meters above ellipsoid
 *   - Distance is great-circle on a sphere of radius EARTH_RADIUS_M
 *   - Display unit is feet (1 m = 3.28084 ft) per the Aurora parity bar
 *
 * No side effects, no DOM, no Cesium. Renderer code in
 * components/3d/measure/measurements.tsx converts these results to entities.
 *
 * Notes on the model:
 *   - We use the WGS84 mean radius (6_371_000 m). This is the same constant
 *     the pre-existing handleMeasureClick used. Precision is ~0.5% on
 *     short distances (<1 km) which is well under a foot at typical roof
 *     spans. A full WGS84-ellipsoid inverse (Vincenty) would buy <0.1%
 *     and is not worth the complexity for a click-measure tool.
 *   - Vertical distance is plain Euclidean |Δh|. We don't model gravity
 *     or geoid undulation; the click pick gives us ellipsoid height.
 */

export const EARTH_RADIUS_M = 6_371_000;
export const METER_TO_FEET = 3.28084;

export interface LngLatH {
  lat: number;
  lng: number;
  h: number;
}

export interface Measurement {
  id: string;
  a: LngLatH;
  b: LngLatH;
  horizDistM: number;
  slopeDistM: number;
}

export function haversineMeters(a: LngLatH, b: LngLatH): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function slopeMeters(a: LngLatH, b: LngLatH): number {
  const horiz = haversineMeters(a, b);
  const vert = Math.abs(b.h - a.h);
  return Math.sqrt(horiz * horiz + vert * vert);
}

export function midpoint(a: LngLatH, b: LngLatH, liftM = 0.3): LngLatH {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
    h: (a.h + b.h) / 2 + liftM,
  };
}

export function metersToFeet(m: number): number {
  return m * METER_TO_FEET;
}

export function formatFeetLabel(m: number, decimals = 1): string {
  const ft = metersToFeet(m);
  if (ft >= 10) {
    return `${ft.toFixed(0)}'`;
  }
  return `${ft.toFixed(decimals)}'`;
}

export function formatMeasurementLabel(m: Measurement): string {
  const slopeFt = formatFeetLabel(m.slopeDistM);
  const horizFt = formatFeetLabel(m.horizDistM);
  const vertFt = metersToFeet(Math.abs(m.b.h - m.a.h));
  if (vertFt < 0.1) {
    return slopeFt;
  }
  return `${slopeFt}\n(horiz ${horizFt})`;
}

export function buildMeasurement(id: string, a: LngLatH, b: LngLatH): Measurement {
  return {
    id,
    a,
    b,
    horizDistM: haversineMeters(a, b),
    slopeDistM: slopeMeters(a, b),
  };
}
