/**
 * tests/fixtures/googleSolarResponses.ts
 *
 * ARCHIVED-SHAPE GOOGLE SOLAR `buildingInsights` PAYLOADS.
 *
 * WHY THESE EXIST
 * ---------------
 * The roof-acquisition path cannot be exercised live without credentials AND an
 * interactive login, so every automated check of Lane A stopped at its trigger
 * predicate. The geometry, the provenance and the persistence round-trip — the
 * parts that actually reach a permit drawing — had no cover at all.
 *
 * These reproduce the SHAPE of real `buildingInsights` responses so the real
 * production conversion (lib/digitalTwin.ts extractRoofSegments -> lib/3d/laneA.ts)
 * can run against them in CI. They are hand-built to the documented schema, not
 * captured from the live API: no customer address, no API key and no quota is
 * involved, and nothing here is a substitute for Ray's one visual acceptance
 * pass against a real address.
 *
 * 🚨 THE UNITS THAT MATTER, because getting either wrong is silent:
 *   • `roofSegmentStats[].center` uses {latitude, longitude} — the LONG names.
 *     lib/digitalTwin.ts converts to {lat,lng}; Lane A consumes the short form.
 *   • `planeHeightAtCenterMeters` is SEA LEVEL. digitalTwin converts it to
 *     heightAboveGround by subtracting the site elevation. app/api/solar
 *     forwards it UNCONVERTED, which is one reason Lane A does not use that
 *     endpoint.
 *   • `boundingBox` is a BOX, not a polygon. The measured footprint comes from
 *     the `solarPanels[]` centres, which is why these carry panels.
 */

/** 1010 Franklin Street, Pocahontas IL — the project's standing test address.
 *  Rural Illinois: HIGH imagery does not cover it, MEDIUM does. */
export const POCAHONTAS = { lat: 38.89080, lng: -89.57079, elevationM: 138.5 };
/** A second, clearly different property, for site-isolation tests. */
export const OTHER_SITE = { lat: 38.70890, lng: -90.14940, elevationM: 142.0 };

const PANEL_W = 1.045;
const PANEL_H = 1.879;

/** Build a grid of Google-style pre-computed panel centres for one segment.
 *  digitalTwin derives the measured convexHull from these. */
function panelsFor(segmentIndex: number, centerLat: number, centerLng: number, cols: number, rows: number) {
  const out: any[] = [];
  const mLat = 111320;
  const mLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dE = (c - (cols - 1) / 2) * (PANEL_W + 0.02);
      const dN = (r - (rows - 1) / 2) * (PANEL_H + 0.02);
      out.push({
        segmentIndex,
        center: { latitude: centerLat + dN / mLat, longitude: centerLng + dE / mLng },
        orientation: 'PORTRAIT',
        yearlyEnergyDcKwh: 500,
      });
    }
  }
  return out;
}

function segment(
  i: number, lat: number, lng: number, pitch: number, azimuth: number,
  areaM2: number, heightSeaLevelM: number,
) {
  const d = 0.00012;
  return {
    pitchDegrees: pitch,
    azimuthDegrees: azimuth,
    stats: { areaMeters2: areaM2, groundAreaMeters2: areaM2 * Math.cos(pitch * Math.PI / 180), sunshineQuantiles: Array(11).fill(1100) },
    center: { latitude: lat, longitude: lng },
    boundingBox: { sw: { latitude: lat - d, longitude: lng - d }, ne: { latitude: lat + d, longitude: lng + d } },
    planeHeightAtCenterMeters: heightSeaLevelM,
    segmentIndex: i,
  };
}

function envelope(site: { lat: number; lng: number; elevationM: number }, segments: any[], panels: any[], quality = 'MEDIUM') {
  return {
    name: 'buildings/TEST',
    center: { latitude: site.lat, longitude: site.lng },
    imageryDate: { year: 2025, month: 6, day: 1 },
    imageryQuality: quality,
    solarPotential: {
      maxArrayPanelsCount: panels.length,
      panelWidthMeters: PANEL_W,
      panelHeightMeters: PANEL_H,
      panelCapacityWatts: 400,
      roofSegmentStats: segments,
      solarPanels: panels,
      // Defensive on purpose: the malformed fixture deliberately omits `stats`
      // on one segment, and the envelope must still build — a real response
      // with a partial segment does not fail to parse either.
      wholeRoofStats: { areaMeters2: segments.reduce((s, x) => s + (x?.stats?.areaMeters2 ?? 0), 0) },
    },
  };
}

/** FIXTURE 1 — NORMAL SUBURBAN PITCHED ROOF.
 *  Two faces of a simple gable: south (az 180) and north (az 0), same pitch. */
export const NORMAL_SUBURBAN_PITCHED = (() => {
  const { lat, lng, elevationM } = POCAHONTAS;
  const roofH = elevationM + 4.2; // ~4.2 m above grade, at sea-level datum
  const segs = [
    segment(0, lat + 0.00008, lng, 22, 180, 48, roofH),
    segment(1, lat - 0.00008, lng, 22, 0, 48, roofH),
  ];
  const panels = [
    ...panelsFor(0, lat + 0.00008, lng, 4, 3),
    ...panelsFor(1, lat - 0.00008, lng, 4, 3),
  ];
  return envelope(POCAHONTAS, segs, panels, 'HIGH');
})();

/** FIXTURE 2 — MULTI-PLANE / COMPLEX ROOF.
 *  Five faces at mixed pitch and azimuth: a hip with a cross-gable wing. */
export const MULTI_PLANE_COMPLEX = (() => {
  const { lat, lng, elevationM } = POCAHONTAS;
  const roofH = elevationM + 5.0;
  const segs = [
    segment(0, lat + 0.00010, lng + 0.00000, 26, 180, 40, roofH),
    segment(1, lat - 0.00010, lng + 0.00000, 26, 0, 40, roofH),
    segment(2, lat + 0.00000, lng + 0.00018, 26, 90, 22, roofH - 0.4),
    segment(3, lat + 0.00000, lng - 0.00018, 26, 270, 22, roofH - 0.4),
    // The cross-gable wing. Kept within 30 m of the building centre because it
    // is part of the SAME house — beyond that, extractRoofSegments correctly
    // treats a segment as a neighbour's roof and drops it.
    segment(4, lat + 0.00012, lng + 0.00012, 18, 135, 16, roofH - 1.1),
  ];
  const panels = segs.flatMap((s, i) =>
    panelsFor(i, s.center.latitude, s.center.longitude, i < 2 ? 4 : 2, i < 2 ? 3 : 2));
  return envelope(POCAHONTAS, segs, panels, 'HIGH');
})();

/** FIXTURE 2b — THE NEIGHBOUR'S ROOF.
 *  Google's findClosest returns segments for the whole response area, which
 *  includes adjacent houses. extractRoofSegments keeps only what is within 30 m
 *  of the building anchor — Ray's "only my building" fix, after a detection
 *  panelled 50 faces on his roof and 84 on everyone else's. */
export const INCLUDES_NEIGHBOUR = (() => {
  const { lat, lng, elevationM } = POCAHONTAS;
  const roofH = elevationM + 4.2;
  const segs = [
    segment(0, lat + 0.00008, lng, 22, 180, 48, roofH),          // mine
    segment(1, lat - 0.00008, lng, 22, 0, 48, roofH),            // mine
    segment(2, lat + 0.00060, lng + 0.00060, 30, 90, 55, roofH), // ~87 m away
  ];
  const panels = [
    ...panelsFor(0, lat + 0.00008, lng, 4, 3),
    ...panelsFor(1, lat - 0.00008, lng, 4, 3),
    ...panelsFor(2, lat + 0.00060, lng + 0.00060, 5, 4),
  ];
  return envelope(POCAHONTAS, segs, panels, 'HIGH');
})();

/** FIXTURE 3 — MEDIUM-QUALITY STYLE RESPONSE.
 *  What rural Illinois actually returns: coarser imagery, fewer segments,
 *  no fractional pitch precision. Lane A must still produce usable planes —
 *  buildingInsights has been pinned at MEDIUM all along. */
export const MEDIUM_QUALITY_RURAL = (() => {
  const { lat, lng, elevationM } = POCAHONTAS;
  const roofH = elevationM + 3.6;
  const segs = [
    segment(0, lat + 0.00007, lng, 20, 176, 52, roofH),
    segment(1, lat - 0.00007, lng, 20, 356, 52, roofH),
  ];
  const panels = [
    ...panelsFor(0, lat + 0.00007, lng, 5, 3),
    ...panelsFor(1, lat - 0.00007, lng, 5, 3),
  ];
  return envelope(POCAHONTAS, segs, panels, 'MEDIUM');
})();

/** FIXTURE 4 — NO COVERAGE / EMPTY RESULT.
 *  Google answered, and the answer is "nothing here". This must degrade to
 *  "auto-detect unavailable", NEVER to a fabricated roof. */
export const NO_COVERAGE_EMPTY = envelope(POCAHONTAS, [], [], 'BASE');

/** FIXTURE 5 — MALFORMED / MISSING SEGMENT VALUES.
 *  Every field Lane A reads, missing or wrong, in one payload:
 *    0: no center            3: null azimuth
 *    1: no stats             4: absurd pitch (must clamp, not produce a wall)
 *    2: missing pitch        5: degenerate — a "segment" 4 cm across
 *  A well-formed segment is included so the test can prove the good one still
 *  survives: partial garbage must not poison the whole address. */
export const MALFORMED_SEGMENTS = (() => {
  const { lat, lng, elevationM } = POCAHONTAS;
  const roofH = elevationM + 4.0;
  const good = segment(6, lat, lng, 24, 180, 45, roofH);
  const segs: any[] = [
    { ...segment(0, lat, lng, 22, 180, 40, roofH), center: undefined },
    { ...segment(1, lat, lng, 22, 180, 40, roofH), stats: undefined },
    { ...segment(2, lat, lng, 22, 180, 40, roofH), pitchDegrees: undefined },
    { ...segment(3, lat, lng, 22, 180, 40, roofH), azimuthDegrees: null },
    { ...segment(4, lat, lng, 999, 180, 40, roofH) },
    { ...segment(5, lat, lng, 22, 180, 0.0001, roofH) },
    good,
  ];
  const panels = [
    ...panelsFor(4, lat, lng, 3, 3),
    ...panelsFor(5, lat + 0.0000002, lng, 1, 1), // degenerate: sub-metre hull
    ...panelsFor(6, lat, lng, 4, 3),
  ];
  return envelope(POCAHONTAS, segs, panels, 'MEDIUM');
})();

/** FIXTURE 6 — A DIFFERENT PROPERTY, for site-isolation and out-of-order tests. */
export const OTHER_SITE_RESPONSE = (() => {
  const { lat, lng, elevationM } = OTHER_SITE;
  const roofH = elevationM + 4.0;
  const segs = [segment(0, lat, lng, 30, 200, 60, roofH)];
  return envelope(OTHER_SITE, segs, panelsFor(0, lat, lng, 5, 4), 'HIGH');
})();

export const ALL_FIXTURES = {
  NORMAL_SUBURBAN_PITCHED,
  MULTI_PLANE_COMPLEX,
  INCLUDES_NEIGHBOUR,
  MEDIUM_QUALITY_RURAL,
  NO_COVERAGE_EMPTY,
  MALFORMED_SEGMENTS,
  OTHER_SITE_RESPONSE,
};
