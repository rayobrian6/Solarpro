// ============================================================================
// lib/siteSurveys/aerialGeometry/facetAdapter.ts
//
// Adapts vendor-neutral RoofFacets into the SAME world-space roof_plane
// UnifiedGeometryArtifacts the Google Solar pipeline produces, by reducing each
// facet to the RoofSegmentStat shape and reusing the proven
// adaptSolarRoofSegmentsToWorldArtifacts() adapter.
//
// This is deliberately a thin reuse layer (zero new artifact-construction code):
// EagleView/Nearmap/mock facets ride the EXACT canonical-building-model path the
// Google Solar geometry already uses (approve-aerial → canonical → permit), so
// the planset draws a real multi-facet roof with no changes to that pipeline.
//
// NOTE (future enhancement): adaptSolarRoofSegmentsToWorldArtifacts reconstructs
// each plane as a bbox-derived quad (same as the Google path). That is correct
// for the common case (most facets are quads) and already fixes the single-
// rectangle problem (many positioned, pitched facets = the real roof). Preserving
// a provider's exact non-quad polygon outline is a later refinement.
// ============================================================================

import { adaptSolarRoofSegmentsToWorldArtifacts } from '@/lib/siteSurveys/googleSolarApi/adapter';
import type { RoofSegmentStat, LatLng } from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';
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
 * Reduce vendor-neutral RoofFacets to the Google-Solar RoofSegmentStat shape so
 * they can reuse the existing world-roof-plane reconstruction + artifact adapter.
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
  const segments = roofFacetsToSegmentStats(facets);
  if (segments.length === 0) return [];
  // Reuse the proven Google-Solar world-artifact adapter. `buildingName` becomes
  // a provenance breadcrumb so the source is traceable even though the artifacts
  // ride the existing aerial (google_solar_api) sourcePipeline that approve-aerial
  // already promotes.
  return adaptSolarRoofSegmentsToWorldArtifacts(
    segments,
    surveyId,
    `aerial:${source}`,
    imageryDate,
  );
}
