import { describe, it, expect } from 'vitest';
import { adaptSolarRoofSegmentsToWorldArtifacts } from '../adapter';
import type { RoofSegmentStat } from '../worldRoofPlanes';

const CLAT = 38.7061678;
const CLNG = -90.0461651;

function seg(
  clat: number,
  clng: number,
  opts: Partial<{ pitch: number; azimuth: number; area: number }> = {},
): RoofSegmentStat {
  const dLat = 2 / 111320;
  const dLng = 3 / (111320 * Math.cos((clat * Math.PI) / 180));
  return {
    center: { latitude: clat, longitude: clng },
    boundingBox: {
      sw: { latitude: clat - dLat, longitude: clng - dLng },
      ne: { latitude: clat + dLat, longitude: clng + dLng },
    },
    pitchDegrees: opts.pitch ?? 25,
    azimuthDegrees: opts.azimuth ?? 180,
    stats: { areaMeters2: opts.area ?? 30 },
    planeHeightAtCenterMeters: 5,
  };
}

const SURVEY = '55841d15-2d1e-42ae-af5f-02211fea6f34';

describe('adaptSolarRoofSegmentsToWorldArtifacts', () => {
  it('builds authoritative, promotable roof_plane artifacts with worldPolygon', () => {
    const arts = adaptSolarRoofSegmentsToWorldArtifacts(
      [seg(CLAT, CLNG, { pitch: 25, azimuth: 180, area: 30.13 }), seg(CLAT + 0.01, CLNG + 0.01, { pitch: 18, azimuth: 90, area: 22.5 })],
      SURVEY,
      'buildings/123',
      '2024-06',
    );

    expect(arts).toHaveLength(2);
    const a = arts[0];
    expect(a.geometryClass).toBe('roof_plane');
    expect(a.surveyId).toBe(SURVEY);
    expect(a.pitchDegrees).toBe(25);
    expect(a.azimuthDegrees).toBe(180);
    expect(a.areaSqM).toBe(30.13);

    // Authoritative world geometry present (lat/lng), image polygon absent
    expect(a.worldPolygon?.vertices).toHaveLength(4);
    for (const v of a.worldPolygon!.vertices) {
      expect(Number.isFinite(v.lat)).toBe(true);
      expect(Number.isFinite(v.lng)).toBe(true);
    }
    expect(a.polygon).toBeNull();

    // Promotable: raw_evidence, NOT synthetic, real google_solar_api provenance
    expect(a.authority.state).toBe('raw_evidence');
    expect(a.isSynthetic).toBe(false);
    expect(a.provenance.sourcePipeline).toBe('google_solar_api');
    expect(a.confidence).toBe(92);

    expect(arts[1].pitchDegrees).toBe(18);
    expect(arts[1].azimuthDegrees).toBe(90);
  });

  it('returns [] for empty or missing segment lists', () => {
    expect(adaptSolarRoofSegmentsToWorldArtifacts([], SURVEY)).toEqual([]);
    expect(
      adaptSolarRoofSegmentsToWorldArtifacts(undefined as unknown as RoofSegmentStat[], SURVEY),
    ).toEqual([]);
  });
});
