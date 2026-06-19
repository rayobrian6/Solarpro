// ============================================================================
// lib/siteSurveys/aerialGeometry/types.ts
//
// Provider-agnostic aerial roof geometry.
//
// WHY: roof facets can come from several aerial sources — Google Solar (free,
// covered addresses), EagleView (paid per-report, any address incl. rural),
// Nearmap, or a mock. They all describe the same thing: a set of roof planes,
// each with a pitch, an azimuth, an area, and a real lat/lng polygon outline.
//
// This module defines that neutral shape (RoofFacet) + a provider interface so
// the rest of the pipeline never cares WHICH vendor produced the geometry. The
// facets are adapted into the existing UnifiedGeometryArtifact world-space
// roof_plane shape (see ./facetAdapter) and flow through the SAME
// approve-aerial → canonical → permit path the Google Solar pipeline uses.
// ============================================================================

import type { LatLng, WorldRoofEdgeType } from '@/lib/siteSurveys/googleSolarApi/worldRoofPlanes';

/** Which aerial source produced a facet (for provenance / cost tracking). */
export type AerialGeometrySourceName = 'google_solar' | 'eagleview' | 'nearmap' | 'mock';

/**
 * One roof plane, vendor-neutral. The polygon is the REAL measured outline in
 * WGS84 lat/lng (not a bounding box) — this is what makes a planset draw the
 * actual multi-facet roof instead of a single rectangle.
 */
export interface RoofFacet {
  /** Roof slope in degrees from horizontal (0 = flat). */
  pitchDegrees: number;
  /** Azimuth in degrees, clockwise from true north (down-slope direction). */
  azimuthDegrees: number;
  /** Plane area in square metres. */
  areaSqM: number;
  /** Real measured outline of this facet, WGS84 lat/lng, >= 3 vertices. */
  polygon: LatLng[];
  /** Optional per-edge classification (ridge/eave/rake/hip/valley), 1 per polygon edge. */
  edgeTypes?: WorldRoofEdgeType[];
  /** Optional plane height at centre (metres) — improves ridge/valley inference. */
  heightAtCenterM?: number;
}

/** Input identifying the building to fetch geometry for. */
export interface AerialGeometryRequest {
  lat: number;
  lng: number;
  /** Street address line — required by order-based providers (EagleView). */
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/** What a provider returns: the facets plus light metadata. */
export interface AerialRoofResult {
  source: AerialGeometrySourceName;
  facets: RoofFacet[];
  /** Optional vendor report id / order id, for audit + re-fetch. */
  reportId?: string;
  /** ISO date of the underlying imagery, when the provider reports it. */
  imageryDate?: string;
}

/**
 * A pluggable aerial geometry provider. Google Solar (free) is tried first;
 * paid per-report providers (EagleView, Nearmap) are the fallback for addresses
 * Google doesn't cover. Implementations live alongside this file.
 */
export interface AerialGeometryProvider {
  readonly name: AerialGeometrySourceName;
  /** True if this provider is usable in the current env (e.g. creds present). */
  isConfigured(): boolean;
  /** Fetch roof facets for a building. Returns null when the provider has no coverage. */
  getRoofFacets(req: AerialGeometryRequest): Promise<AerialRoofResult | null>;
}
