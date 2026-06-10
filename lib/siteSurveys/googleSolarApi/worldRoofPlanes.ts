// ============================================================================
// lib/siteSurveys/googleSolarApi/worldRoofPlanes.ts
//
// Authoritative WORLD-COORDINATE roof geometry from the Google Solar API.
//
// WHY THIS EXISTS (Roadmap Phase 1 — survey→canonical→planset spine):
//   Pipeline C's adapter (adapter.ts) intentionally produces PIXEL-space
//   polygons for photo overlays — it discards the lat/lng. But the permit
//   planset needs roof planes in real-world lat/lng (pitch/azimuth/area/
//   vertices). That authoritative geometry lives in the raw Google response's
//   `solarPotential.roofSegmentStats[]` (lat/lng per segment), which today is
//   only parsed by app/api/solar/route.ts (the 3D design pipeline).
//
//   This module re-implements that proven lat/lng reconstruction as a small,
//   dependency-free, unit-testable helper so the Solar→CanonicalBuildingModel
//   path can produce world-space roof planes WITHOUT importing or refactoring
//   the design route (zero regression risk to that pipeline). The math here is
//   a faithful port of app/api/solar/route.ts (reconstructPolygon /
//   detectAdjacencies / refineEdgeTypes / buildRoofPlanes).
//
// This is the FIRST step of the authoritative geometry spine. The rural
// operator-trace path (Phase 2) will emit the same WorldRoofPlane shape.
// ============================================================================

/** Roof-edge classification used on plane perimeters. */
export type WorldRoofEdgeType = 'ridge' | 'eave' | 'rake' | 'hip' | 'valley';

/** A lat/lng vertex (WGS84). */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Minimal subset of a Google Solar API `roofSegmentStats[]` entry that we need
 * to reconstruct world-space roof geometry. (The full entry has more fields.)
 */
export interface RoofSegmentStat {
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  pitchDegrees: number;
  azimuthDegrees: number;
  stats: { areaMeters2: number; sunshineQuantiles?: number[] };
  planeHeightAtCenterMeters?: number;
}

/**
 * Authoritative roof plane in world (lat/lng) coordinates. This is the shape
 * the CanonicalBuildingModel (worldPolygon) and the permit planset consume.
 */
export interface WorldRoofPlane {
  id: string;
  /** 4-vertex polygon outline in WGS84 lat/lng. Order: ridge-L, ridge-R, eave-R, eave-L. */
  vertices: LatLng[];
  pitchDegrees: number;
  azimuthDegrees: number;
  areaSqM: number;
  centroidLat: number;
  centroidLng: number;
  edgeTypes: WorldRoofEdgeType[];
  adjacentPlaneIds?: string[];
  planeHeightAtCenterMeters?: number;
  source: 'google_solar_api';
}

// ─── Geometry helpers (ported verbatim from app/api/solar/route.ts) ──────────

const rad = (d: number) => (d * Math.PI) / 180;

function offsetLatLng(lat: number, lng: number, dxE: number, dyN: number): LatLng {
  return {
    lat: lat + dyN / 111320,
    lng: lng + dxE / (111320 * Math.cos(rad(lat))),
  };
}

function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Reconstruct a 4-vertex polygon for a roof segment from its center, bounding
 * box, and azimuth. Vertex order (clockwise from up-slope):
 *   [0] ridge-left  [1] ridge-right  [2] eave-right  [3] eave-left
 * The "eave" side faces the azimuth (down-slope); "ridge" is opposite.
 */
function reconstructPolygon(seg: RoofSegmentStat): LatLng[] {
  const clat = seg.center.latitude;
  const clng = seg.center.longitude;

  const bbW =
    distanceM(
      { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.sw.longitude },
      { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.ne.longitude },
    ) / 2;
  const bbH =
    distanceM(
      { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.sw.longitude },
      { lat: seg.boundingBox.ne.latitude, lng: seg.boundingBox.sw.longitude },
    ) / 2;

  const hw = bbW * 1.02;
  const hd = bbH * 1.02;

  const az = rad(seg.azimuthDegrees);
  const perpAz = az + Math.PI / 2;

  const downE = Math.sin(az);
  const downN = Math.cos(az);
  const rightE = Math.sin(perpAz);
  const rightN = Math.cos(perpAz);

  return [
    offsetLatLng(clat, clng, -rightE * hw - downE * hd, -rightN * hw - downN * hd), // ridge-left
    offsetLatLng(clat, clng, rightE * hw - downE * hd, rightN * hw - downN * hd),   // ridge-right
    offsetLatLng(clat, clng, rightE * hw + downE * hd, rightN * hw + downN * hd),   // eave-right
    offsetLatLng(clat, clng, -rightE * hw + downE * hd, -rightN * hw + downN * hd), // eave-left
  ];
}

/** Default edge types for a 4-vertex polygon: ridge / rake / eave / rake. */
function defaultEdgeTypes(): WorldRoofEdgeType[] {
  return ['ridge', 'rake', 'eave', 'rake'];
}

/**
 * Detect shared edges between all pairs of polygons (edge midpoints within
 * 2.5m). Returns a map of segment index → adjacency records.
 */
function detectAdjacencies(
  polygons: LatLng[][],
): Map<number, { neighborIdx: number; edgeIdx: number }[]> {
  const result = new Map<number, { neighborIdx: number; edgeIdx: number }[]>();
  for (let i = 0; i < polygons.length; i++) result.set(i, []);

  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const polyI = polygons[i];
      const polyJ = polygons[j];
      for (let ei = 0; ei < polyI.length; ei++) {
        const mI = {
          lat: (polyI[ei].lat + polyI[(ei + 1) % polyI.length].lat) / 2,
          lng: (polyI[ei].lng + polyI[(ei + 1) % polyI.length].lng) / 2,
        };
        for (let ej = 0; ej < polyJ.length; ej++) {
          const mJ = {
            lat: (polyJ[ej].lat + polyJ[(ej + 1) % polyJ.length].lat) / 2,
            lng: (polyJ[ej].lng + polyJ[(ej + 1) % polyJ.length].lng) / 2,
          };
          if (distanceM(mI, mJ) < 2.5) {
            result.get(i)!.push({ neighborIdx: j, edgeIdx: ei });
            result.get(j)!.push({ neighborIdx: i, edgeIdx: ej });
          }
        }
      }
    }
  }
  return result;
}

/** Refine edge types using adjacency + plane heights (ridge/hip/valley/eave). */
function refineEdgeTypes(
  baseTypes: WorldRoofEdgeType[],
  segIdx: number,
  adjacencies: { neighborIdx: number; edgeIdx: number }[],
  segments: RoofSegmentStat[],
): WorldRoofEdgeType[] {
  const types = [...baseTypes];
  const selfHeight = segments[segIdx].planeHeightAtCenterMeters ?? 0;

  for (const { neighborIdx, edgeIdx } of adjacencies) {
    const neighborHeight = segments[neighborIdx].planeHeightAtCenterMeters ?? 0;
    const neighborAz = segments[neighborIdx].azimuthDegrees;
    const selfAz = segments[segIdx].azimuthDegrees;

    if (edgeIdx === 0) {
      const azDiff = Math.abs(((neighborAz - selfAz + 540) % 360) - 180);
      types[0] = azDiff > 120 ? 'ridge' : 'hip';
    } else if (edgeIdx === 2) {
      types[2] = neighborHeight > selfHeight ? 'valley' : 'eave';
    } else {
      types[edgeIdx] = neighborHeight > selfHeight ? 'valley' : 'hip';
    }
  }
  return types;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Build authoritative world-space roof planes from Google Solar API
 * `roofSegmentStats`. Faithful port of app/api/solar/route.ts `buildRoofPlanes`,
 * emitting the source-agnostic WorldRoofPlane shape used by the canonical spine.
 *
 * @param segments  Google `solarPotential.roofSegmentStats[]` (already filtered
 *                  to the target building by the caller, if desired).
 * @param idPrefix  Optional id prefix (default 'solar-segment').
 */
export function buildWorldRoofPlanes(
  segments: RoofSegmentStat[],
  idPrefix = 'solar-segment',
): WorldRoofPlane[] {
  const polygons = segments.map((seg) => reconstructPolygon(seg));
  const adjacencies = detectAdjacencies(polygons);

  return segments.map((seg, i) => {
    const adj = adjacencies.get(i) ?? [];
    const edgeTypes = refineEdgeTypes(defaultEdgeTypes(), i, adj, segments);
    const adjacentPlaneIds = [...new Set(adj.map((a) => `${idPrefix}-${a.neighborIdx}`))];

    return {
      id: `${idPrefix}-${i}`,
      vertices: polygons[i],
      pitchDegrees: Math.round(seg.pitchDegrees * 10) / 10,
      azimuthDegrees: Math.round(seg.azimuthDegrees * 10) / 10,
      areaSqM: Math.round(seg.stats.areaMeters2 * 100) / 100,
      centroidLat: seg.center.latitude,
      centroidLng: seg.center.longitude,
      edgeTypes,
      adjacentPlaneIds: adjacentPlaneIds.length > 0 ? adjacentPlaneIds : undefined,
      planeHeightAtCenterMeters: seg.planeHeightAtCenterMeters,
      source: 'google_solar_api',
    };
  });
}
