// ============================================================================
// lib/siteSurveys/aerialGeometry/designPlaneAdapter.ts
//
// Converts vendor-neutral RoofFacets into the RoofPlane[] shape the 3D design
// engine already consumes (the same type /api/solar returns from Google Solar).
//
// THIS DOES NOT TOUCH THE 3D ENGINE. It only produces data in the engine's
// existing input shape, so wiring EagleView in later is a tiny, opt-in, additive
// change: feed these planes where Google's are fed. The Google-Solar path stays
// exactly as-is; EagleView is just an alternative source of the same RoofPlane[].
// ============================================================================

import type { RoofPlane, RoofEdgeType } from '@/types';
import type { RoofFacet } from './types';
import type { LatLng } from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';

function centroid(poly: LatLng[]): LatLng {
  const n = poly.length || 1;
  return {
    lat: poly.reduce((s, p) => s + p.lat, 0) / n,
    lng: poly.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/**
 * Map RoofFacets → RoofPlane[] (the 3D design engine's input shape). Preserves
 * the real measured facet polygons, pitch, azimuth, area and edge types.
 *
 * @param facets   Vendor-neutral facets (e.g. from EagleView).
 * @param idPrefix Plane id prefix (default 'eagleview').
 */
export function roofFacetsToDesignPlanes(facets: RoofFacet[], idPrefix = 'eagleview'): RoofPlane[] {
  return facets
    .filter((f) => Array.isArray(f.polygon) && f.polygon.length >= 3)
    .map((f, i) => {
      const c = centroid(f.polygon);
      const plane: RoofPlane = {
        id: `${idPrefix}-${i}`,
        vertices: f.polygon.map((v) => ({ lat: v.lat, lng: v.lng })),
        pitch: f.pitchDegrees,
        azimuth: f.azimuthDegrees,
        area: f.areaSqM,
        usableArea: Math.round(f.areaSqM * 0.75 * 100) / 100,
        centroidLat: c.lat,
        centroidLng: c.lng,
        // WorldRoofEdgeType ⊆ RoofEdgeType — direct, only when 1 type per edge.
        edgeTypes: f.edgeTypes as RoofEdgeType[] | undefined,
        source: 'imported',
        confirmed: false,
      };
      return plane;
    });
}
