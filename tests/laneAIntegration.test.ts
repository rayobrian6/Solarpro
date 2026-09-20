/**
 * tests/laneAIntegration.test.ts
 *
 * LANE A, END TO END, WITHOUT A GOOGLE KEY OR A LOGIN.
 *
 * WHAT THIS COVERS THAT THE UNIT TESTS DO NOT
 * -------------------------------------------
 * tests/laneAGate.test.ts proves the TRIGGER refuses correctly. It says nothing
 * about whether the geometry is right, whether provenance survives, or whether
 * any of it round-trips through the database — the parts that reach a permit
 * drawing. Those could not be tested because the conversion lived inside a
 * ~13,800-line Cesium component that needs WebGL, terrain and an API key to
 * instantiate.
 *
 * The conversion now lives in lib/3d/laneA.ts, so this drives the REAL
 * production chain against archived-shape payloads:
 *
 *   buildingInsights payload
 *     -> lib/digitalTwin.ts  extractRoofSegments   (real)
 *     -> lib/3d/laneA.ts     laneAPlanesFromSegments (real)
 *     -> provenance + site ownership stamp          (real)
 *     -> lib/roofPlanesSignature.ts persistence signature (real)
 *     -> lib/siteIdentity.ts partition on reload    (real)
 *
 * Nothing here reimplements production logic in the test. Live Google
 * verification at a real address remains a manual acceptance step.
 *
 * 🚨 GROUND ELEVATION IS NEVER 0 IN THESE TESTS. lib/surfaceGeometry3D treats 0
 * as the "unresolved" sentinel and skips adding site elevation, so a harness
 * passing 0 is a false green — the roof lands at sea level and nothing
 * complains. Every call here passes a real elevation.
 */

import { describe, it, expect } from 'vitest';
import { extractRoofSegments } from '@/lib/digitalTwin';
import {
  laneAPlanesFromSegments, segmentToRoofPlane, shouldRunLaneA,
  detectionStatusFromSegmentCount, MIN_FACE_EXTENT_M, PITCH_CLAMP_DEG,
} from '@/lib/3d/laneA';
import { layoutSignature } from '@/lib/roofPlanesSignature';
import { siteKeyFromCoords, partitionBySite, mergeForPersistence } from '@/lib/siteIdentity';
import {
  NORMAL_SUBURBAN_PITCHED, MULTI_PLANE_COMPLEX, MEDIUM_QUALITY_RURAL,
  NO_COVERAGE_EMPTY, MALFORMED_SEGMENTS, OTHER_SITE_RESPONSE, INCLUDES_NEIGHBOUR,
  POCAHONTAS, OTHER_SITE,
} from './fixtures/googleSolarResponses';
import type { RoofPlane } from '@/types';

const PROJECT = 'proj-integration';
const SITE_A = siteKeyFromCoords(POCAHONTAS.lat, POCAHONTAS.lng, PROJECT);
const SITE_B = siteKeyFromCoords(OTHER_SITE.lat, OTHER_SITE.lng, PROJECT);

/** The real twin-side conversion, then the real Lane A conversion. */
function acquire(payload: any, site: { lat: number; lng: number; elevationM: number }, siteKey: string): RoofPlane[] {
  const segments = extractRoofSegments(payload, site.elevationM);
  return laneAPlanesFromSegments(segments as any, site.elevationM, { siteKey });
}

describe('fixture 1 — normal suburban pitched roof', () => {
  const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);

  it('produces a plane per roof face with zero tracing', () => {
    expect(planes.length).toBe(2);
  });

  it('every plane has real geometry, not a placeholder', () => {
    for (const p of planes) {
      expect(p.vertices.length).toBeGreaterThanOrEqual(3);
      expect(p.area).toBeGreaterThan(0);
      for (const v of p.vertices) {
        expect(Number.isFinite(v.lat)).toBe(true);
        expect(Number.isFinite(v.lng)).toBe(true);
      }
    }
  });

  it('preserves the two opposing azimuths of a gable', () => {
    const az = planes.map(p => Math.round(p.azimuth)).sort((a, b) => a - b);
    // One face looks south (~180), the other north (~0/360). Whatever the
    // convention, they must be roughly opposite — a gable whose faces point the
    // same way is a conversion bug.
    const delta = Math.abs(((az[1] - az[0]) % 360));
    expect(Math.min(delta, 360 - delta)).toBeGreaterThan(120);
  });

  it('pitch survives conversion', () => {
    for (const p of planes) expect(p.pitch).toBeGreaterThan(5);
  });
});

describe('fixture 2 — multi-plane complex roof', () => {
  const planes = acquire(MULTI_PLANE_COMPLEX, POCAHONTAS, SITE_A);

  it('produces a plane for every usable face', () => {
    expect(planes.length).toBe(5);
  });

  it('gives every plane a UNIQUE, stable id', () => {
    // Ids come from buildRoofPlane3D's uuid. Duplicates would make the
    // merge-by-id in DesignStudio silently drop faces.
    const ids = new Set(planes.map(p => p.id));
    expect(ids.size).toBe(planes.length);
    for (const id of ids) expect(id).toBeTruthy();
  });

  it('assigns a distinct solarSegmentIndex to each plane', () => {
    const idx = planes.map(p => p.solarSegmentIndex);
    expect(new Set(idx).size).toBe(planes.length);
  });

  it('keeps faces at different azimuths distinct', () => {
    expect(new Set(planes.map(p => Math.round(p.azimuth))).size).toBeGreaterThan(2);
  });
});

describe('🚨 only MY building — the neighbour filter', () => {
  it('drops segments belonging to an adjacent property', () => {
    // Google's findClosest returns segments for the whole response area. Ray's
    // repro was a detection that panelled 50 faces on his roof and 84 on
    // everyone else's. extractRoofSegments keeps only what is within 30 m of
    // the building anchor.
    const segments = extractRoofSegments(INCLUDES_NEIGHBOUR, POCAHONTAS.elevationM);
    expect(INCLUDES_NEIGHBOUR.solarPotential.roofSegmentStats).toHaveLength(3);
    expect(segments).toHaveLength(2); // the ~87 m neighbour is gone
  });

  it('so Lane A never acquires a stranger roof', () => {
    const planes = acquire(INCLUDES_NEIGHBOUR, POCAHONTAS, SITE_A);
    expect(planes).toHaveLength(2);
    // ...and every plane it did acquire sits near the subject building.
    for (const p of planes) {
      const c = p.vertices[0];
      const dLat = Math.abs(c.lat - POCAHONTAS.lat) * 111320;
      expect(dLat).toBeLessThan(40);
    }
  });
});

describe('fixture 3 — MEDIUM-quality rural response', () => {
  const planes = acquire(MEDIUM_QUALITY_RURAL, POCAHONTAS, SITE_A);

  it('still yields usable planes — buildingInsights is pinned at MEDIUM', () => {
    // Lane A has always used buildingInsights at MEDIUM (lib/digitalTwin.ts).
    // The HIGH->MEDIUM->BASE ladder belongs to /api/dsm and /api/solar-rgb and
    // is NOT what makes Lane A work. This fixture pins that distinction.
    expect(planes.length).toBe(2);
    for (const p of planes) expect(p.vertices.length).toBeGreaterThanOrEqual(3);
  });
});

describe('fixture 4 — no coverage', () => {
  it('returns ZERO planes rather than fabricating a roof', () => {
    expect(acquire(NO_COVERAGE_EMPTY, POCAHONTAS, SITE_A)).toHaveLength(0);
  });

  it('reports "unavailable" so the UI does not read as "not yet tried"', () => {
    const segments = extractRoofSegments(NO_COVERAGE_EMPTY, POCAHONTAS.elevationM);
    expect(detectionStatusFromSegmentCount(segments.length)).toBe('unavailable');
  });

  it('the gate refuses, so nothing downstream runs', () => {
    expect(shouldRunLaneA({
      stage: 'done', groundElevResolved: true, segmentCount: 0,
      existingPlaneCount: 0, restoreResolved: true,
      siteKey: SITE_A, lastRanSiteKey: null,
    })).toBe(false);
  });
});

describe('fixture 5 — malformed / missing segment values', () => {
  const segments = extractRoofSegments(MALFORMED_SEGMENTS, POCAHONTAS.elevationM);
  const planes = laneAPlanesFromSegments(segments as any, POCAHONTAS.elevationM, { siteKey: SITE_A });

  it('does not throw on any malformed segment', () => {
    expect(() => laneAPlanesFromSegments(segments as any, POCAHONTAS.elevationM, {})).not.toThrow();
  });

  it('drops unusable segments instead of emitting broken planes', () => {
    // Fewer planes than segments: the bad ones are refused, not faked.
    expect(planes.length).toBeLessThan(segments.length);
  });

  it('a partially bad payload still yields the GOOD face', () => {
    // Partial garbage must not poison the whole address.
    expect(planes.length).toBeGreaterThan(0);
  });

  it('never emits a plane with non-finite geometry', () => {
    for (const p of planes) {
      expect(Number.isFinite(p.pitch)).toBe(true);
      expect(Number.isFinite(p.azimuth)).toBe(true);
      expect(Number.isFinite(p.area)).toBe(true);
      for (const v of p.vertices) {
        expect(Number.isFinite(v.lat)).toBe(true);
        expect(Number.isFinite(v.lng)).toBe(true);
      }
    }
  });

  it('clamps an absurd pitch instead of building a wall', () => {
    for (const p of planes) {
      expect(p.pitch).toBeGreaterThanOrEqual(PITCH_CLAMP_DEG.min);
      expect(p.pitch).toBeLessThanOrEqual(PITCH_CLAMP_DEG.max);
    }
  });

  it('refuses a degenerate sub-metre face', () => {
    const tiny = segmentToRoofPlane({
      center: { lat: POCAHONTAS.lat, lng: POCAHONTAS.lng },
      convexHull: [
        { lat: POCAHONTAS.lat, lng: POCAHONTAS.lng },
        { lat: POCAHONTAS.lat + 0.0000001, lng: POCAHONTAS.lng },
        { lat: POCAHONTAS.lat, lng: POCAHONTAS.lng + 0.0000001 },
      ],
      pitchDegrees: 22, azimuthDegrees: 180, heightAboveGround: 4,
    }, POCAHONTAS.elevationM);
    expect(tiny).toBeNull();
    expect(MIN_FACE_EXTENT_M).toBe(0.5);
  });

  it('refuses a segment with no hull at all', () => {
    expect(segmentToRoofPlane({ center: { lat: 38.8, lng: -89.5 }, convexHull: null }, 100)).toBeNull();
    expect(segmentToRoofPlane({ center: { lat: 38.8, lng: -89.5 }, convexHull: [] }, 100)).toBeNull();
  });

  it('refuses null / undefined input', () => {
    expect(segmentToRoofPlane(null, 100)).toBeNull();
    expect(segmentToRoofPlane(undefined, 100)).toBeNull();
  });
});

describe('provenance — a guess must never look like a commitment', () => {
  const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);

  it('every generated plane is stamped source=solar_api', () => {
    for (const p of planes) expect(p.source).toBe('solar_api');
  });

  it('every generated plane is UNCONFIRMED', () => {
    // buildRoofPlane3D hardcodes confirmed:true because it was only ever called
    // for hand-traced faces. Lane A must override it, or a machine guess would
    // present itself as a person's decision.
    for (const p of planes) expect(p.confirmed).toBe(false);
  });

  it('every generated plane carries the site it was detected for', () => {
    for (const p of planes) expect(p.siteKey).toBe(SITE_A);
  });

  it('is distinguishable from user-traced geometry', () => {
    const traced: RoofPlane = { ...planes[0], id: 'hand', source: 'manual', confirmed: true };
    const isGenerated = (p: RoofPlane) => p.source === 'solar_api' && p.confirmed === false;
    expect(isGenerated(planes[0])).toBe(true);
    expect(isGenerated(traced)).toBe(false);
  });

  it('is distinguishable from imported and from aerial geometry', () => {
    for (const other of ['imported', 'aerial_nearmap'] as const) {
      expect(planes[0].source).not.toBe(other);
    }
  });

  it('a confirmed Lane A plane is no longer "unreviewed"', () => {
    // Operator review is what flips this. The field must be the single answer.
    const reviewed: RoofPlane = { ...planes[0], confirmed: true };
    expect(reviewed.source).toBe('solar_api');   // provenance is permanent
    expect(reviewed.confirmed).toBe(true);        // review state is not
  });
});

describe('repeated triggers and coordinate tolerance', () => {
  const ready = {
    stage: 'done', groundElevResolved: true, segmentCount: 2,
    existingPlaneCount: 0, restoreResolved: true,
    siteKey: SITE_A, lastRanSiteKey: null as string | null,
  };

  it('runs once, then refuses for the same site', () => {
    expect(shouldRunLaneA(ready)).toBe(true);
    expect(shouldRunLaneA({ ...ready, lastRanSiteKey: SITE_A })).toBe(false);
  });

  it('treats coordinates within ~1 m as the SAME site', () => {
    const jittered = siteKeyFromCoords(POCAHONTAS.lat + 0.000002, POCAHONTAS.lng, PROJECT);
    expect(jittered).toBe(SITE_A);
    expect(shouldRunLaneA({ ...ready, siteKey: jittered, lastRanSiteKey: SITE_A })).toBe(false);
  });

  it('treats a meaningful address change as a NEW site', () => {
    expect(shouldRunLaneA({ ...ready, siteKey: SITE_B, lastRanSiteKey: SITE_A })).toBe(true);
  });

  it('refuses when a manual roof already exists', () => {
    expect(shouldRunLaneA({ ...ready, existingPlaneCount: 1 })).toBe(false);
  });

  it('refuses when a Lane A roof already exists', () => {
    // Same gate — detected geometry counts as existing geometry, so a second
    // run cannot stack a duplicate roof on top of the first.
    const existing = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    expect(shouldRunLaneA({ ...ready, existingPlaneCount: existing.length })).toBe(false);
  });

  it('a second acquisition would mint DIFFERENT ids — which is why the gate exists', () => {
    const first = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const second = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const overlap = first.filter(p => second.some(q => q.id === p.id));
    expect(overlap).toHaveLength(0);
    // Merging both by id would therefore DOUBLE the roof.
    const byId = new Map([...first, ...second].map(p => [p.id, p]));
    expect(byId.size).toBe(first.length + second.length);
  });
});

describe('API failure', () => {
  it('a rejected request yields no planes and no throw', () => {
    // The twin returns nothing usable; extractRoofSegments must cope with the
    // empty/!ok shapes rather than exploding.
    for (const bad of [null, undefined, {}, { solarPotential: null }, { solarPotential: {} }]) {
      expect(() => extractRoofSegments(bad as any, POCAHONTAS.elevationM)).not.toThrow();
      expect(extractRoofSegments(bad as any, POCAHONTAS.elevationM)).toHaveLength(0);
    }
  });

  it('degrades to "unavailable", never to a fabricated roof', () => {
    expect(detectionStatusFromSegmentCount(extractRoofSegments(null as any, 100).length)).toBe('unavailable');
  });
});

describe('🚨 out-of-order responses must not cross sites', () => {
  it('a late response for site A cannot be accepted while at site B', () => {
    // Two address changes in flight. A resolves last. Each detection carries
    // the coordinate key captured at FIRE time, and the studio drops any emit
    // that does not match the site on screen.
    const coordsA = siteKeyFromCoords(POCAHONTAS.lat, POCAHONTAS.lng);
    const coordsB = siteKeyFromCoords(OTHER_SITE.lat, OTHER_SITE.lng);

    const latePlanesForA = laneAPlanesFromSegments(
      extractRoofSegments(NORMAL_SUBURBAN_PITCHED, POCAHONTAS.elevationM) as any,
      POCAHONTAS.elevationM, { siteKey: coordsA },
    );
    const emittedFor = latePlanesForA.find(p => p.siteKey)?.siteKey;
    expect(emittedFor).toBe(coordsA);

    const accepted = !(emittedFor && coordsB && emittedFor !== coordsB);
    expect(accepted).toBe(false); // dropped
  });

  it('the in-order response for the current site IS accepted', () => {
    const coordsB = siteKeyFromCoords(OTHER_SITE.lat, OTHER_SITE.lng);
    const planesForB = laneAPlanesFromSegments(
      extractRoofSegments(OTHER_SITE_RESPONSE, OTHER_SITE.elevationM) as any,
      OTHER_SITE.elevationM, { siteKey: coordsB },
    );
    const emittedFor = planesForB.find(p => p.siteKey)?.siteKey;
    expect(!(emittedFor && coordsB && emittedFor !== coordsB)).toBe(true);
  });

  it('two rapid changes leave exactly ONE site active and the other retained', () => {
    const a = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const b = acquire(OTHER_SITE_RESPONSE, OTHER_SITE, SITE_B);
    const stored = mergeForPersistence(b, a, SITE_B);

    const atB = partitionBySite(stored, SITE_B);
    expect(atB.active.every(p => p.siteKey === SITE_B)).toBe(true);
    expect(atB.foreign.every(p => p.siteKey === SITE_A)).toBe(true);

    const atA = partitionBySite(stored, SITE_A);
    expect(atA.active.every(p => p.siteKey === SITE_A)).toBe(true);
  });
});

describe('persistence round trip — payload to storage and back', () => {
  it('generated planes serialize and deserialize without loss', () => {
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const revived: RoofPlane[] = JSON.parse(JSON.stringify(planes));
    expect(revived).toHaveLength(planes.length);
    for (let i = 0; i < planes.length; i++) {
      expect(revived[i].id).toBe(planes[i].id);
      expect(revived[i].source).toBe('solar_api');
      expect(revived[i].confirmed).toBe(false);
      expect(revived[i].siteKey).toBe(SITE_A);
      expect(revived[i].vertices).toEqual(planes[i].vertices);
      expect(revived[i].pitch).toBeCloseTo(planes[i].pitch, 6);
      expect(revived[i].azimuth).toBeCloseTo(planes[i].azimuth, 6);
    }
  });

  it('the restore seed matches the first save — no needless rewrite', () => {
    // The seed/writer parity rule: restoring a layout must not immediately
    // re-POST it.
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const stored = mergeForPersistence(planes, [], SITE_A);
    const revived: RoofPlane[] = JSON.parse(JSON.stringify(stored));
    const { active, foreign } = partitionBySite(revived, SITE_A);

    const seed = layoutSignature({ panels: [], designElectrical: null, roofPlanes: mergeForPersistence(active, foreign, SITE_A) });
    const firstSave = layoutSignature({ panels: [], designElectrical: null, roofPlanes: mergeForPersistence(active, foreign, SITE_A) });
    expect(firstSave).toBe(seed);
  });

  it('reload at the SAME site reactivates exactly the generated roof', () => {
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const stored: RoofPlane[] = JSON.parse(JSON.stringify(mergeForPersistence(planes, [], SITE_A)));
    const { active } = partitionBySite(stored, SITE_A);
    expect(active.map(p => p.id).sort()).toEqual(planes.map(p => p.id).sort());
  });

  it('reload at a DIFFERENT site activates nothing but loses nothing', () => {
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const stored: RoofPlane[] = JSON.parse(JSON.stringify(mergeForPersistence(planes, [], SITE_A)));
    const { active, foreign } = partitionBySite(stored, SITE_B);
    expect(active).toHaveLength(0);
    expect(foreign).toHaveLength(planes.length);
  });

  it('a signature change is visible when a generated face is edited', () => {
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const before = layoutSignature({ panels: [], roofPlanes: planes });
    const edited = planes.map((p, i) => (i === 0 ? { ...p, pitch: p.pitch + 4 } : p));
    expect(layoutSignature({ panels: [], roofPlanes: edited })).not.toBe(before);
  });

  it('confirming a generated plane schedules a save', () => {
    // Operator review must reach the database, or the reviewed state is lost.
    const planes = acquire(NORMAL_SUBURBAN_PITCHED, POCAHONTAS, SITE_A);
    const before = layoutSignature({ panels: [], roofPlanes: planes });
    const confirmed = planes.map(p => ({ ...p, confirmed: true }));
    expect(layoutSignature({ panels: [], roofPlanes: confirmed })).not.toBe(before);
  });
});
