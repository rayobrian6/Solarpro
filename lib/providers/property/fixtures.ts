// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — DETERMINISTIC PROPERTY-IDENTITY FIXTURES
// ───────────────────────────────────────────────────────────────────────────
// CAPTURED FROM A REAL LIVE CALL on 2026-07-27, not invented:
//
//   GET https://geocoding.geo.census.gov/geocoder/geographies/address
//        ?street=3+MELVIN+DR&city=GRANITE+CITY&state=IL&zip=62040
//        &benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json
//   → result.addressMatches[0]:
//       matchedAddress : "3 MELVIN DR, GRANITE CITY, IL, 62040"
//       coordinates    : { x: -90.046048484755, y: 38.705964282006 }
//       geographies:
//         Counties            → "Madison County"  STATE 17  COUNTY 119  GEOID 17119
//         Census Tracts       → "Census Tract 4009.03"  TRACT 400903
//         County Subdivisions → "Nameoki township"      GEOID 1711951583
//         Incorporated Places → ABSENT
//
// The ABSENT place layer on a MATCHED address is the finding: the parcel is
// outside the Granite City municipal limits, so the county — not the mailing
// city — is the building AHJ. Exactly one match, so there is no boundary
// conflict to escalate.
//
// ATTOM was NOT queried (no ATTOM_API_KEY in this environment), so the APN is
// honestly null here and PROJECT-AUTHORITY-UNVERIFIED's apn field stays
// 'unknown' rather than being fabricated.
// ═══════════════════════════════════════════════════════════════════════════

import { retrievalOk, retrievalFailure, type RetrievalResult, type RetrievalFailureKind } from '../types';
import type { PropertyIdentityProvider, PropertyIdentityQuery, RetrievedPropertyIdentity } from './types';

const CAPTURED_AT = '2026-07-27T20:31:00.000Z';
const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/address';

export const BRAIDON_PROPERTY_FIXTURE: RetrievedPropertyIdentity = {
  providerUsed: 'census_geocoder',
  normalizedAddress: '3 MELVIN DR, GRANITE CITY, IL, 62040',
  lat: 38.705964282006,
  lng: -90.046048484755,
  county: 'Madison County',
  stateFips: '17',
  countyFips: '119',
  censusTract: '400903',
  parcelId: null,
  ownerName: null,
  incorporatedPlace: null,
  countySubdivision: 'Nameoki township',
  placeFips: null,
  boundaryLayersResolved: true,
  boundaryEvidence:
    'US Census Geocoder matched the address and returned NO incorporated place, only the minor civil division '
    + '"Nameoki township" — the parcel is UNINCORPORATED and the COUNTY is the building AHJ of record, regardless '
    + 'of the mailing city on the address.',
  unincorporated: true,
  retrievedAtIso: CAPTURED_AT,
  sourcesQueried: [CENSUS_ENDPOINT],
  chainFailures: [
    'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail: ATTOM_API_KEY not set — parcel/APN + owner of record NOT retrieved (chain fell through to the Census Geocoder).',
  ],
  proof: 'fixture',
  fixtureProvenance:
    `captured from a real live US Census Geocoder call at ${CAPTURED_AT}. FIXTURE PROOF, not live proof.`,
};

export interface FixturePropertyProviderOptions {
  record?: RetrievedPropertyIdentity;
  failWith?: { kind: RetrievalFailureKind; failure: string; operatorAction?: string | null };
  configured?: boolean;
  nowIso?: string;
  calls?: PropertyIdentityQuery[];
}

export function createFixturePropertyProvider(opts?: FixturePropertyProviderOptions): PropertyIdentityProvider {
  const configured = opts?.configured !== false;
  return {
    name: 'property-identity fixture (replay of a documented live capture)',
    metered: false,
    isConfigured: () => configured,
    async getPropertyIdentity(q: PropertyIdentityQuery): Promise<RetrievalResult<RetrievedPropertyIdentity>> {
      opts?.calls?.push(q);
      const retrievedAtIso = opts?.nowIso ?? CAPTURED_AT;
      if (!configured) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'NOT_CONFIGURED',
          failure: 'property-identity fixture is configured OFF — no official source was queried.',
          operatorAction: null,
        });
      }
      if (opts?.failWith) {
        return retrievalFailure({
          sourcesQueried: [CENSUS_ENDPOINT], retrievedAtIso,
          failureKind: opts.failWith.kind, failure: opts.failWith.failure,
          operatorAction: opts.failWith.operatorAction ?? null,
        });
      }
      const base = opts?.record ?? BRAIDON_PROPERTY_FIXTURE;
      return retrievalOk({
        value: { ...base, proof: 'fixture', retrievedAtIso },
        sourcesQueried: base.sourcesQueried, retrievedAtIso,
        confidence: base.providerUsed === 'attom' ? 0.95 : base.boundaryLayersResolved ? 0.9 : 0.6,
      });
    },
  };
}
