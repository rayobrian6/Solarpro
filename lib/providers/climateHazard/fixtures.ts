// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-4 — DETERMINISTIC CLIMATE-HAZARD FIXTURES
// ───────────────────────────────────────────────────────────────────────────
// The directive: "Providers unavailable in test env → dependency injection +
// deterministic fixtures, clearly distinguishing fixture proof from live
// retrieval proof" and "NEVER fabricate values — fixture data must come from a
// real documented source".
//
// EVERY NUMBER BELOW WAS CAPTURED FROM A REAL LIVE CALL, not invented. The
// capture command, endpoint and timestamp are recorded on each record, and the
// record carries `proof: 'fixture'` with `fixtureProvenance` naming the live
// retrieval it was taken from — so a test can never be mistaken for live proof.
//
// The BRAIDON capture (2026-07-27T20:47Z, project 4030b664-…, 3 MELVIN DR,
// GRANITE CITY, IL 62040, coordinates from the project's own canonical site
// model: 38.706118, -90.046165):
//
//   GET https://gis.asce.org/arcgis/rest/services/ASCE722/w2022_mri700/ImageServer/identify
//         ?geometry={"x":-90.046165,"y":38.706118,"spatialReference":{"wkid":4326}}
//         &geometryType=esriGeometryPoint&returnGeometry=false&f=json
//     → {"objectId":0,"name":"Pixel","value":"107.533", …}
//
//   GET https://gis.asce.org/arcgis/rest/services/ASCE722/s2022_RiskCategory2/ImageServer/identify (same geometry)
//     → {"objectId":0,"name":"Pixel","value":"23.2836", …}
//
//   GET https://earthquake.usgs.gov/ws/designmaps/asce7-22.json
//         ?latitude=38.706118&longitude=-90.046165&riskCategory=II&siteClass=D
//     → response.data { ss: 0.61, s1: 0.18, sds: 0.43, sd1: 0.25, sdc: "D", tl: 12 }
//
//   GET https://epqs.nationalmap.gov/v1/json?x=-90.046165&y=38.706118&units=Feet&wkid=4326
//     → {"value":411.9058175116944, …}
//
// CROSS-CHECK (why these are believable, not just believed): the ASCE 7-16
// 700-yr raster at the same point returns 107.512 mph — 0.02 mph from the 7-22
// value, as expected for a region where the 2022 revision did not move the
// contour. The ASCE snow DEM (s2022_Elevation) returns 125.996 m = 413.4 ft,
// 1.5 ft from the independent USGS 3DEP value. Two independent services agree on
// elevation and two editions agree on wind.
//
// WHAT THIS PROVES ABOUT THE CURRENT PLANSET: Braidon prints 115 mph
// "code-minimum default" and 0 psf ground snow, and the static AHJ table would
// have forced 110 mph / 20 psf / SDC 'B'. The retrieved truth is 107.5 mph,
// 23.3 psf and SDC 'D'. The snow load was not merely unverified — it was WRONG,
// and the seismic design category was wrong by two steps.
// ═══════════════════════════════════════════════════════════════════════════

import { retrievalOk, retrievalFailure, type RetrievalResult, type RetrievalFailureKind } from '../types';
import type { ClimateHazardProvider, HazardQuery, RetrievedHazards } from './types';
import { WIND_MRI_BY_RISK } from './types';

const CAPTURED_AT = '2026-07-27T20:47:16.000Z';
const G = 'https://gis.asce.org/arcgis/rest/services';

/** The live-captured Braidon hazard record (ASCE 7-22, Risk Category II). */
export const BRAIDON_HAZARD_FIXTURE: RetrievedHazards = {
  asceEdition: '7-22',
  riskCategory: 'II',
  windMriYears: WIND_MRI_BY_RISK.II,
  windSpeedMph: 107.533,
  groundSnowLoadPsf: 23.2836,
  seismic: {
    referenceDocument: 'ASCE 7-22',
    siteClass: 'D',
    ss: 0.61, s1: 0.18, sds: 0.43, sd1: 0.25, sdc: 'D',
  },
  elevationFt: 411.9058175116944,
  coordinates: { lat: 38.706118, lng: -90.046165 },
  addressUsed: '3 MELVIN DR APT A, GRANITE CITY, IL 62040',
  data: [
    {
      label: 'basic wind speed V (700-yr MRI, Risk Category II)',
      value: 107.533, unit: 'mph',
      sourceUrl: `${G}/ASCE722/w2022_mri700/ImageServer`,
      dataset: 'ASCE 7-22 basic wind speed raster (w2022_mri700)',
    },
    {
      label: 'ground snow load pg (Risk Category II)',
      value: 23.2836, unit: 'psf',
      sourceUrl: `${G}/ASCE722/s2022_RiskCategory2/ImageServer`,
      dataset: 'ASCE 7-22 ground snow load raster (s2022_RiskCategory2)',
    },
    {
      label: 'seismic Ss / S1 / SDS / SD1 / SDC (site class D)',
      value: 'D', unit: 'SDC',
      sourceUrl: 'https://earthquake.usgs.gov/ws/designmaps/asce7-22.json',
      dataset: 'USGS ASCE 7-22 design maps web service',
    },
    {
      label: 'site elevation',
      value: 411.9058175116944, unit: 'ft',
      sourceUrl: 'https://epqs.nationalmap.gov/v1/json',
      dataset: 'USGS 3DEP Elevation Point Query Service',
    },
  ],
  proof: 'fixture',
  fixtureProvenance:
    `captured from a real live retrieval at ${CAPTURED_AT} — `
    + 'gis.asce.org/ASCE722/w2022_mri700 + s2022_RiskCategory2 ImageServer identify, '
    + 'earthquake.usgs.gov/ws/designmaps/asce7-22.json, epqs.nationalmap.gov/v1/json. '
    + 'FIXTURE PROOF, not live proof: this record replays a capture, it does not query.',
};

export interface FixtureHazardProviderOptions {
  /** the record to return for any in-coverage query. */
  record?: RetrievedHazards;
  /** force a failure instead (the failure-mode cases). */
  failWith?: { kind: RetrievalFailureKind; failure: string; operatorAction?: string | null };
  /** pretend the provider has no credential / is switched off. */
  configured?: boolean;
  nowIso?: string;
  /** record every query the resolver made (coordinate-invalidation test). */
  calls?: HazardQuery[];
}

/**
 * The DI fixture provider. Returns the injected record for ANY coordinate but
 * REWRITES the record's coordinates to the queried ones, so a coordinate change
 * genuinely produces a different record (the mandated invalidation test cannot
 * pass by accident).
 */
export function createFixtureHazardProvider(opts?: FixtureHazardProviderOptions): ClimateHazardProvider {
  const configured = opts?.configured !== false;
  return {
    name: 'climate-hazard fixture (replay of a documented live capture)',
    metered: false,
    isConfigured: () => configured,
    async getHazards(q: HazardQuery): Promise<RetrievalResult<RetrievedHazards>> {
      opts?.calls?.push(q);
      const retrievedAtIso = opts?.nowIso ?? CAPTURED_AT;
      if (!configured) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'NOT_CONFIGURED',
          failure: 'fixture provider is configured OFF — no hazard service was queried.',
          operatorAction: 'Enable the climate-hazard provider.',
        });
      }
      if (opts?.failWith) {
        return retrievalFailure({
          sourcesQueried: [`${G}/ASCE722/w2022_mri${WIND_MRI_BY_RISK[q.riskCategory]}/ImageServer`],
          retrievedAtIso, failureKind: opts.failWith.kind, failure: opts.failWith.failure,
          operatorAction: opts.failWith.operatorAction ?? null,
        });
      }
      const base = opts?.record ?? BRAIDON_HAZARD_FIXTURE;
      const value: RetrievedHazards = {
        ...base,
        asceEdition: q.asceEdition,
        riskCategory: q.riskCategory,
        windMriYears: WIND_MRI_BY_RISK[q.riskCategory],
        coordinates: { lat: q.lat, lng: q.lng },
        addressUsed: q.addressUsed ?? base.addressUsed,
        proof: 'fixture',
      };
      return retrievalOk({
        value,
        sourcesQueried: value.data.map(d => d.sourceUrl),
        retrievedAtIso,
        confidence: 1,
      });
    },
  };
}
