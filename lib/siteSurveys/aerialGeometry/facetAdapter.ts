// ============================================================================
// lib/siteSurveys/aerialGeometry/facetAdapter.ts
//
// Adapts vendor-neutral RoofFacets into the SAME world-space roof_plane
// UnifiedGeometryArtifacts the Google Solar pipeline produces, by reducing each
// facet to the RoofSegmentStat shape and reusing the proven
// adaptSolarRoofSegmentsToWorldArtifacts() adapter.
//
// This is a thin reuse layer: EagleView/Nearmap/mock facets ride the EXACT
// canonical-building-model path the Google Solar geometry already uses
// (approve-aerial → canonical → permit), so the planset draws a real multi-facet
// roof with no changes to that pipeline.
//
// POLYGON PRESERVATION: a provider facet already carries its REAL measured
// outline (RoofFacet.polygon — an N-vertex lat/lng ring, e.g. a triangular hip
// facet or an L-shaped plane). We map each facet STRAIGHT to a WorldRoofPlane,
// keeping that outline verbatim as the plane's worldPolygon — we do NOT reduce
// it to a bounding-box quad. (The Google SEGMENT path quad-reconstructs because
// the Solar API only gives a bbox + azimuth, not a polygon; facet providers give
// the polygon, so there is no reason to throw it away.) canonicalToPermit carries
// any polygon with >= 3 vertices through to the planset drawing, so the permit
// renders the true facet shapes — the whole point of using EagleView geometry.
// ============================================================================

import { adaptWorldRoofPlanesToArtifacts } from '@/lib/siteSurveys/googleSolarApi/adapter';
import type {
  RoofSegmentStat,
  LatLng,
  WorldRoofPlane,
  WorldRoofEdgeType,
} from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';
import type { UnifiedGeometryArtifact } from '@/lib/siteSurveys/unifiedGeometry/types';
import type { RoofFacet, AerialGeometrySourceName } from './types';

/** Centroid (simple average) of a lat/lng polygon. */
function centroidOf(polygon: LatLng[]): LatLng {
  const n = polygon.length || 1;
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / n;
  const lng = polygon.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

/** Axis-aligned lat/lng bounding box (sw = min, ne = max) of a polygon. */
function boundingBoxOf(polygon: LatLng[]): RoofSegmentStat['boundingBox'] {
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  return {
    sw: { latitude: Math.min(...lats), longitude: Math.min(...lngs) },
    ne: { latitude: Math.max(...lats), longitude: Math.max(...lngs) },
  };
}

/**
 * Map vendor-neutral RoofFacets STRAIGHT to WorldRoofPlanes, preserving each
 * facet's real measured polygon outline verbatim (no bbox-quad reduction).
 *
 * Pitch/azimuth/area are rounded to match the Google world-plane path; the
 * centroid is the polygon average; edge types are carried through if the
 * provider supplied them (left undefined otherwise — we never fabricate edge
 * labels for an N-gon, which would mis-colour ridges/eaves on the planset).
 * `source` is google_solar_api so the planes ride the existing aerial pipeline.
 */
export function roofFacetsToWorldRoofPlanes(
  facets: RoofFacet[],
  idPrefix = 'aerial-facet',
): WorldRoofPlane[] {
  return facets
    .filter((f) => Array.isArray(f.polygon) && f.polygon.length >= 3)
    .map((f, i) => {
      const c = centroidOf(f.polygon);
      return {
        id: `${idPrefix}-${i}`,
        vertices: f.polygon, // REAL measured outline, preserved exactly
        pitchDegrees: Math.round(f.pitchDegrees * 10) / 10,
        azimuthDegrees: Math.round(f.azimuthDegrees * 10) / 10,
        areaSqM: Math.round(f.areaSqM * 100) / 100,
        centroidLat: c.lat,
        centroidLng: c.lng,
        edgeTypes: (f.edgeTypes ?? []) as WorldRoofEdgeType[],
        planeHeightAtCenterMeters: f.heightAtCenterM,
        source: 'google_solar_api' as const,
      };
    });
}

/**
 * Reduce vendor-neutral RoofFacets to the Google-Solar RoofSegmentStat shape
 * (bounding box + centroid). Retained for callers that want the segment-stat
 * representation; the artifact path no longer uses it (it preserves the real
 * polygon instead — see roofFacetsToWorldRoofPlanes).
 */
export function roofFacetsToSegmentStats(facets: RoofFacet[]): RoofSegmentStat[] {
  return facets
    .filter((f) => Array.isArray(f.polygon) && f.polygon.length >= 3)
    .map((f) => ({
      center: (() => {
        const c = centroidOf(f.polygon);
        return { latitude: c.lat, longitude: c.lng };
      })(),
      boundingBox: boundingBoxOf(f.polygon),
      pitchDegrees: f.pitchDegrees,
      azimuthDegrees: f.azimuthDegrees,
      stats: { areaMeters2: f.areaSqM },
      planeHeightAtCenterMeters: f.heightAtCenterM,
    }));
}

/**
 * Adapt vendor-neutral roof facets into world-space roof_plane artifacts for a
 * survey. The artifacts are RAW_EVIDENCE authority (operator promotes via
 * approve-aerial before CAD use) and non-synthetic — identical handling to the
 * Google Solar aerial path.
 *
 * @param facets    Vendor-neutral roof facets (EagleView/Nearmap/mock/google).
 * @param surveyId  Survey to associate the artifacts with.
 * @param source    Which provider produced the facets (for the label/breadcrumb).
 * @param imageryDate Optional imagery date for provenance.
 */
export function adaptRoofFacetsToWorldArtifacts(
  facets: RoofFacet[],
  surveyId: string,
  source: AerialGeometrySourceName,
  imageryDate?: string,
): UnifiedGeometryArtifact[] {
  const worldPlanes = roofFacetsToWorldRoofPlanes(facets);
  if (worldPlanes.length === 0) return [];
  // Reuse the shared world-plane → artifact mapper, but feed it planes that
  // PRESERVE each facet's real polygon outline (not bbox quads). `buildingName`
  // becomes a provenance breadcrumb so the source is traceable even though the
  // artifacts ride the existing aerial (google_solar_api) sourcePipeline that
  // approve-aerial already promotes.
  return adaptWorldRoofPlanesToArtifacts(
    worldPlanes,
    surveyId,
    `aerial:${source}`,
    imageryDate,
  );
}
