/**
 * tests/fixtures/multiSectionHouse.ts
 *
 * THE GAUNTLET FIXTURE — the class of house the acceptance test is about.
 *
 * The live acceptance failure was not "the math returns the wrong normal". It
 * was "I cannot model my house". The house in question is not a single box:
 *
 *      main volume        a gable running east-west, the tallest mass
 *      attached volume    a lower hip garage on the east wall, on a lower pad
 *      offset volume      a cross-gable wing projecting north, ridge ACROSS
 *                         the main ridge, on a higher pad
 *
 * Three sections, eight roof faces, three different ground elevations and three
 * different eave heights — so every test written against it has to distinguish
 * "this section" from "the building", and any control that silently means
 * "all faces" shows up immediately.
 *
 * 🚨 THE DIMENSIONS ARE TRUE METRES. The corners are placed through the WGS84
 * meridian and prime-vertical radii of curvature, not the round 111320 m/deg.
 * A fixture built on a 0.3% approximation cannot be used to assert that a span
 * is 14.0 m, and a span across a ridge is exactly how a pitch is realised.
 *
 * 🚨 NOTHING HERE IS DERIVED FROM THE CODE UNDER TEST. The footprints are
 * stated in local east/north metres and converted here. A test may therefore
 * assert that a face is 14 m long without asking the geometry engine whether
 * it agrees with itself.
 */

import type { BuildingSection } from '@/lib/3d/buildingSection';

const DEG = Math.PI / 180;
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

/** Metres per degree of latitude — the meridian radius of curvature. */
function mPerDegLat(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A * (1 - WGS84_E2) / Math.pow(w, 1.5)) * DEG;
}

/** Metres per degree of longitude — the prime-vertical radius of curvature. */
function mPerDegLng(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A / Math.sqrt(w)) * Math.cos(latDeg * DEG) * DEG;
}

/** 3 Melvin Drive — the property the live traces come from. */
export const SITE_LAT = 38.70615;
export const SITE_LNG = -90.04625;

const M_LAT = mPerDegLat(SITE_LAT);
const M_LNG = mPerDegLng(SITE_LAT);

/** A point given in local metres east/north of the site origin. */
export function enu(eastM: number, northM: number): { lat: number; lng: number } {
  return { lat: SITE_LAT + northM / M_LAT, lng: SITE_LNG + eastM / M_LNG };
}

/** The inverse, so a test can state a result in metres rather than degrees. */
export function toEnu(p: { lat: number; lng: number }): { e: number; n: number } {
  return { e: (p.lng - SITE_LNG) * M_LNG, n: (p.lat - SITE_LAT) * M_LAT };
}

/** A closed rectangle in local metres, counter-clockwise from the SW corner. */
function rect(e0: number, n0: number, e1: number, n1: number) {
  return [enu(e0, n0), enu(e1, n0), enu(e1, n1), enu(e0, n1)];
}

/**
 * Ground elevations. THREE DIFFERENT PADS, deliberately.
 *
 * A single ground elevation lets a bug that confuses "height above ground" with
 * "elevation above the ellipsoid" pass every test, because the two differ by a
 * constant the test never varies. These differ by 30 and 60 cm — small enough
 * to be a real lot, large enough that a confusion is visible.
 */
export const GROUND_MAIN_M = 150.0;
export const GROUND_GARAGE_M = 149.4; // the driveway falls away to the east
export const GROUND_WING_M = 150.3;   // the rear of the lot rises

/** The main mass: 14 m east-west by 9 m north-south, gable, ridge east-west. */
export function mainSection(): BuildingSection {
  return {
    id: 'sec-main',
    kind: 'gable',
    footprint: rect(-7, -4.5, 7, 4.5),
    eaveHeightM: 2.9,
    pitchDeg: 30,
    groundElevM: GROUND_MAIN_M,
    ridgeAxis: 'long', // 14 m is the long pair, so the ridge runs east-west
    label: 'House',
    createdAtIso: '2026-09-22T00:00:00.000Z',
    source: 'user-traced',
  };
}

/**
 * The attached garage: 7 m x 6 m hipped, on the east wall, on a lower pad with
 * a lower eave. Four faces, so a "select the section" test has something that
 * is genuinely more than a pair.
 */
export function garageSection(): BuildingSection {
  return {
    id: 'sec-garage',
    kind: 'hip',
    footprint: rect(7, -3, 14, 3),
    eaveHeightM: 2.4,
    pitchDeg: 25,
    groundElevM: GROUND_GARAGE_M,
    ridgeAxis: 'long',
    label: 'Garage',
    createdAtIso: '2026-09-22T00:00:00.000Z',
    source: 'user-traced',
  };
}

/**
 * The cross-gable wing: 8 m east-west by 5 m north-south, projecting north out
 * of the main mass and OVERLAPPING it by half a metre, with its ridge running
 * north-south — across the main ridge.
 *
 * 🚨 ITS RIDGE IS ON THE SHORT AXIS. 8 m is the long pair here, so 'auto' and
 * 'long' would both run the ridge east-west, parallel to the main ridge, which
 * is not a cross-gable at all. `ridgeAxis: 'short'` is the whole point of the
 * field, and a round-trip that drops it rotates this wing 90 degrees.
 */
export function wingSection(): BuildingSection {
  return {
    id: 'sec-wing',
    kind: 'gable',
    footprint: rect(-4, 4.0, 4, 9.0),
    eaveHeightM: 2.6,
    pitchDeg: 30,
    groundElevM: GROUND_WING_M,
    ridgeAxis: 'short',
    label: 'Rear addition',
    createdAtIso: '2026-09-22T00:00:00.000Z',
    source: 'user-traced',
  };
}

/** All three, in the order an installer would place them. */
export function multiSectionHouse(): BuildingSection[] {
  return [mainSection(), garageSection(), wingSection()];
}

/**
 * What each section SHOULD measure, stated independently of the geometry code.
 * A test asserting "the inspector shows the truth" needs a truth that did not
 * come from the thing being inspected.
 */
export const EXPECTED = {
  'sec-main': {
    label: 'House',
    faces: 2,
    widthM: 14,
    depthM: 9,
    eaveHeightM: 2.9,
    groundElevM: GROUND_MAIN_M,
    eaveElevM: GROUND_MAIN_M + 2.9,
    pitchDeg: 30,
    // A gable's ridge sits half the across-ridge span up the slope. The ridge
    // runs east-west, so the span is the 9 m north-south depth.
    ridgeHeightM: 2.9 + (9 / 2) * Math.tan(30 * DEG),
    ridgeElevM: GROUND_MAIN_M + 2.9 + (9 / 2) * Math.tan(30 * DEG),
  },
  'sec-garage': {
    label: 'Garage',
    faces: 4,
    widthM: 7,
    depthM: 6,
    eaveHeightM: 2.4,
    groundElevM: GROUND_GARAGE_M,
    eaveElevM: GROUND_GARAGE_M + 2.4,
    pitchDeg: 25,
    // Hip: the ridge runs along the 7 m axis, so the span is the 6 m axis.
    ridgeHeightM: 2.4 + (6 / 2) * Math.tan(25 * DEG),
    ridgeElevM: GROUND_GARAGE_M + 2.4 + (6 / 2) * Math.tan(25 * DEG),
  },
  'sec-wing': {
    label: 'Rear addition',
    faces: 2,
    widthM: 8,
    depthM: 5,
    eaveHeightM: 2.6,
    groundElevM: GROUND_WING_M,
    eaveElevM: GROUND_WING_M + 2.6,
    pitchDeg: 30,
    // Ridge on the SHORT (5 m north-south) axis, so the span is the 8 m axis.
    ridgeHeightM: 2.6 + (8 / 2) * Math.tan(30 * DEG),
    ridgeElevM: GROUND_WING_M + 2.6 + (8 / 2) * Math.tan(30 * DEG),
  },
} as const;
