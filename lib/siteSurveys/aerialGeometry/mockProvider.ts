// ============================================================================
// lib/siteSurveys/aerialGeometry/mockProvider.ts
//
// A deterministic mock aerial provider that returns a known 4-facet hip roof.
// Lets us verify the whole facets → canonical → permit pipeline end-to-end with
// zero spend and no external API, and serves as the reference fixture for tests.
//
// The roof is a simple pyramidal hip centred in the EagleView sandbox area
// (Omaha, NE) so the same coordinates can later be used against the real
// EagleView sandbox once the response mapping is wired.
// ============================================================================

import type {
  AerialGeometryProvider,
  AerialGeometryRequest,
  AerialRoofResult,
  RoofFacet,
} from './types';

// Centre of the building (inside the EagleView Omaha sandbox bbox).
const C_LAT = 41.2490;
const C_LNG = -95.9906;
// ~6.7 m half-footprint in latitude degrees; longitude scaled by cos(lat).
const D_LAT = 0.00006;
const D_LNG = 0.00006 / Math.cos((C_LAT * Math.PI) / 180);

const SW = { lat: C_LAT - D_LAT, lng: C_LNG - D_LNG };
const SE = { lat: C_LAT - D_LAT, lng: C_LNG + D_LNG };
const NE = { lat: C_LAT + D_LAT, lng: C_LNG + D_LNG };
const NW = { lat: C_LAT + D_LAT, lng: C_LNG - D_LNG };
const APEX = { lat: C_LAT, lng: C_LNG };

/**
 * A pyramidal hip roof: 4 triangular facets meeting at a central apex, each
 * facing a cardinal direction. Pitch 22°, ~48 m² slope area each.
 */
export const MOCK_HIP_ROOF_FACETS: RoofFacet[] = [
  { pitchDegrees: 22, azimuthDegrees: 180, areaSqM: 48, polygon: [SW, SE, APEX] }, // south-facing
  { pitchDegrees: 22, azimuthDegrees: 90, areaSqM: 48, polygon: [SE, NE, APEX] }, // east-facing
  { pitchDegrees: 22, azimuthDegrees: 0, areaSqM: 48, polygon: [NE, NW, APEX] }, // north-facing
  { pitchDegrees: 22, azimuthDegrees: 270, areaSqM: 48, polygon: [NW, SW, APEX] }, // west-facing
];

export class MockAerialProvider implements AerialGeometryProvider {
  readonly name = 'mock' as const;

  isConfigured(): boolean {
    return true;
  }

  async getRoofFacets(_req: AerialGeometryRequest): Promise<AerialRoofResult | null> {
    return {
      source: 'mock',
      facets: MOCK_HIP_ROOF_FACETS,
      reportId: 'mock-hip-roof',
      imageryDate: '2026-01-01',
    };
  }
}
