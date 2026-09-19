/**
 * tests/detectedPlaneProvenance.test.ts
 *
 * v66 step 2: Auto Fill now hands its detected roof planes to DesignStudio
 * instead of discarding them. Those planes came from Google Solar, not from a
 * person, so they are stamped `source:'solar_api', confirmed:false` and must
 * route through the same operator review the Nearmap planes already use.
 *
 * THE RISK THIS COVERS: the stamping happens in SolarEngine3D, and DesignStudio
 * then runs the planes through enrichRoofPlaneWithLECS + enrichRoofPlaneWith3DFrame
 * before storing them. If either enrichment resets provenance — by spreading
 * defaults over it, or by rebuilding the object — a DETECTION would silently
 * present itself as a confirmed human decision and walk straight into a planset.
 * That is a quiet, high-consequence failure, so it gets a test of its own.
 *
 * buildRoofPlane3D hardcodes source:'manual', confirmed:true (lib/roofPlane3D.ts
 * ~582) because it was only ever called for hand-traced faces. These tests pin
 * the override surviving the rest of the pipeline.
 */

import { describe, it, expect } from 'vitest';
import { enrichRoofPlaneWithLECS } from '@/lib/roofGeometry';
import { enrichRoofPlaneWith3DFrame } from '@/lib/surfaceGeometry3D';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import type { RoofPlane } from '@/types';

const LAT = 38.83;
const LNG = -89.53;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

function rect(widthM: number, depthM: number) {
  const dLng = widthM / 2 / mPerDegLng;
  const dLat = depthM / 2 / M_PER_DEG_LAT;
  return [
    { lat: LAT - dLat, lng: LNG - dLng },
    { lat: LAT - dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG - dLng },
  ];
}

/**
 * A plane as segmentToRoofPlane3D produces it, then stamped the way
 * handleAutoRoof stamps it before emitting. Built through the real builder so
 * the defaults under test are the real defaults, not a fixture's.
 */
function detectedPlane(i = 0): RoofPlane {
  const built = roofPlaneFromFootprint(rect(12, 8), {
    pitchDeg: 23, azimuthDeg: 195, eaveHeightM: 3, groundElevM: 150,
  });
  const p = built!.plane;
  // Sanity: the builder really does default to a human-confirmed manual plane.
  expect(p.source).toBe('manual');
  expect(p.confirmed).toBe(true);
  // handleAutoRoof's stamping:
  p.source = 'solar_api';
  p.confirmed = false;
  p.solarSegmentIndex = i;
  return p;
}

describe('detected roof plane provenance survives the DesignStudio pipeline', () => {
  it('enrichRoofPlaneWithLECS preserves source and confirmed', () => {
    const out = enrichRoofPlaneWithLECS(detectedPlane());
    expect(out.source).toBe('solar_api');
    expect(out.confirmed).toBe(false);
  });

  it('enrichRoofPlaneWith3DFrame preserves source and confirmed', () => {
    const out = enrichRoofPlaneWith3DFrame(detectedPlane());
    expect(out.source).toBe('solar_api');
    expect(out.confirmed).toBe(false);
  });

  it('the full DesignStudio enrichment chain preserves provenance', () => {
    // Exactly what the onRoofPlanesDetected consumer does.
    const out = enrichRoofPlaneWith3DFrame(enrichRoofPlaneWithLECS(detectedPlane(2)));
    expect(out.source).toBe('solar_api');
    expect(out.confirmed).toBe(false);
    expect(out.solarSegmentIndex).toBe(2);
  });

  it('enrichment does not damage the geometry it is there to enrich', () => {
    const before = detectedPlane();
    const after = enrichRoofPlaneWith3DFrame(enrichRoofPlaneWithLECS(before));
    expect(after.pitch).toBe(before.pitch);
    expect(after.azimuth).toBe(before.azimuth);
    expect(after.vertices).toHaveLength(before.vertices.length);
    expect(after.area).toBeCloseTo(before.area, 6);
    // LECS fields the sidebar and CAD engine read.
    expect(after.centroidLat).toBeCloseTo(LAT, 3);
    expect(after.verticesLocal).toHaveLength(4);
    expect(after.roofEdgeAngleDeg).toBeGreaterThanOrEqual(0);
    expect(after.roofEdgeAngleDeg).toBeLessThan(180);
  });

  it('a HAND-TRACED plane stays distinguishable from a detected one', () => {
    // The whole point of the stamp: the sidebar and the planset must be able to
    // tell "a person drew this" from "Google guessed this".
    const traced = roofPlaneFromFootprint(rect(12, 8), {
      pitchDeg: 23, azimuthDeg: 195, eaveHeightM: 3, groundElevM: 150,
    })!.plane;
    // finalizePlane3D's flat-trace stamping:
    traced.source = 'manual';
    traced.confirmed = false;

    const detected = detectedPlane();

    expect(traced.source).toBe('manual');
    expect(detected.source).toBe('solar_api');
    // Both unconfirmed — a traced pitch is an estimate and a detection is a
    // guess, so neither asserts itself as reviewed fact.
    expect(traced.confirmed).toBe(false);
    expect(detected.confirmed).toBe(false);
  });

  it('every detected plane carries a distinct segment index', () => {
    const planes = [0, 1, 2, 3].map(i => detectedPlane(i));
    const idx = planes.map(p => p.solarSegmentIndex);
    expect(new Set(idx).size).toBe(4);
    expect(new Set(planes.map(p => p.id)).size).toBe(4);
  });
});
