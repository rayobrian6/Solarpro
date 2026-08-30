// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — THE LIVE PROPERTY / LEGAL-IDENTITY PROVIDER
// ───────────────────────────────────────────────────────────────────────────
// Chain (the EXISTING lib/enrichment/propertyEnricher chain, reused, not
// re-implemented):
//   1. ATTOM              (ATTOM_API_KEY, metered)  — the only APN source
//   2. US Census Geocoder (free, unmetered)         — official address match,
//                                                     county + tract + FIPS +
//                                                     incorporated-place layer
//   3. Nominatim / OSM    (free)                    — last-resort county only
//
// VERIFIED BY LIVE CALL 2026-07-27 for Braidon (3 MELVIN DR, GRANITE CITY, IL
// 62040): the Census Geocoder matched the address, returned
// (-90.046048, 38.705964), Counties → "Madison County" (STATE 17 / COUNTY 119),
// Census Tracts → 4009.03, County Subdivisions → "Nameoki township", and
// **no Incorporated Places entry** — i.e. the parcel is OUTSIDE the Granite City
// municipal limits. That is a real, official boundary determination, and it
// CORROBORATES the AHJ the snapshot already names (Madison County Building &
// Zoning) rather than the City of Granite City record that shares the mailing
// address. It is exactly the incorporated/unincorporated question WS-3 calls out.
//
// The chain never throws: propertyEnricher's three providers each catch and
// return null. This adapter records WHICH ones failed so a degraded answer is
// visible rather than silent.
// ═══════════════════════════════════════════════════════════════════════════

import { enrichProperty, type PropertyEnrichmentResult } from '@/lib/enrichment/propertyEnricher';
import { retrievalOk, retrievalFailure, type RetrievalResult } from '../types';
import type {
  IdentityFieldSource, PropertyIdentityProvider, PropertyIdentityQuery, RetrievedPropertyIdentity,
} from './types';

const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/address';
const ATTOM_ENDPOINT = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail';
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const ENDPOINT_BY_PROVIDER: Record<string, string> = {
  attom: ATTOM_ENDPOINT,
  census_geocoder: CENSUS_ENDPOINT,
  nominatim: NOMINATIM_ENDPOINT,
};

/** Turn the enrichment result into the authority-grade identity record. PURE —
 *  exported so the boundary logic is testable without any network. */
export function toPropertyIdentity(
  r: PropertyEnrichmentResult,
  args: { retrievedAtIso: string; chainFailures?: string[] },
): RetrievedPropertyIdentity {
  const provider = (r.provider_used as IdentityFieldSource) ?? 'none';
  // The leg that actually made each determination. A record can be assembled
  // from several legs now, so "who resolved the boundary" and "who published the
  // parcel id" are separate questions from "which provider is this record from".
  const boundaryProvider = (r.boundary_source as IdentityFieldSource) ?? provider;
  const parcelSource = r.parcel_id
    ? ((r.parcel_source as IdentityFieldSource) ?? provider)
    : null;
  const resolved = r.boundary_layers_resolved === true;
  const place = r.incorporated_place ?? null;
  const cousub = r.county_subdivision ?? null;
  // The boundary determination, stated as evidence, never as an assumption.
  const unincorporated = resolved ? place == null : null;
  const boundaryEvidence = !resolved
    ? `${boundaryProvider} did not resolve the municipal-boundary layer — whether this parcel is inside an incorporated `
      + 'municipality is UNDETERMINED; the AHJ may not be inferred from the mailing city.'
    : place
      ? `US Census Geocoder matched the address inside the incorporated place "${place}"`
        + `${cousub ? ` (${cousub})` : ''} — the municipality is the building AHJ of record.`
      : `US Census Geocoder matched the address and returned NO incorporated place`
        + `${cousub ? `, only the minor civil division "${cousub}"` : ''} — the parcel is UNINCORPORATED and the `
        + 'COUNTY is the building AHJ of record, regardless of the mailing city on the address.';
  return {
    providerUsed: provider,
    normalizedAddress: r.formatted_address ?? null,
    lat: r.latitude ?? null,
    lng: r.longitude ?? null,
    county: r.county ?? null,
    stateFips: r.state_fips ?? (r.fips_code ? String(r.fips_code).slice(0, 2) : null),
    countyFips: r.county_fips ?? (r.fips_code ? String(r.fips_code).slice(2, 5) : null),
    censusTract: r.census_tract ?? null,
    parcelId: r.parcel_id ?? null,
    parcelSource,
    ownerName: r.owner_name ?? null,
    incorporatedPlace: place,
    countySubdivision: cousub,
    placeFips: r.place_fips ?? null,
    boundaryLayersResolved: resolved,
    boundaryEvidence,
    unincorporated,
    retrievedAtIso: args.retrievedAtIso,
    sourcesQueried: [ENDPOINT_BY_PROVIDER[provider] ?? provider],
    chainFailures: args.chainFailures ?? [],
    proof: 'live-retrieval',
  };
}

export interface CensusPropertyProviderOptions {
  nowIso?: string;
  /** DI for the enrichment chain (tests inject a scripted chain). */
  enrich?: typeof enrichProperty;
}

export const ATTOM_KEY_ACTION =
  'Set ATTOM_API_KEY to retrieve the parcel/APN and owner of record — the free US Census Geocoder normalises the '
  + 'address and establishes the county + municipal boundary, but only ATTOM publishes an APN. Until then the APN '
  + 'field stays UNKNOWN rather than being inferred.';

export function createCensusPropertyProvider(opts?: CensusPropertyProviderOptions): PropertyIdentityProvider {
  const enrich = opts?.enrich ?? enrichProperty;
  return {
    // The chain, not a single source — named so the evidence says which ran.
    name: 'property-identity chain (ATTOM → US Census Geocoder → Nominatim)',
    // ATTOM is metered but it is a leading, key-gated, fail-through step of an
    // otherwise unmetered chain; the chain itself never depends on a metered call.
    metered: false,
    isConfigured: () => true,   // the Census leg needs no credential
    async getPropertyIdentity(q: PropertyIdentityQuery): Promise<RetrievalResult<RetrievedPropertyIdentity>> {
      const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
      const haveAddress = !!(q.addressLine1 && q.addressLine1.trim());
      if (!haveAddress) {
        return retrievalFailure({
          sourcesQueried: [], retrievedAtIso, failureKind: 'INSUFFICIENT_QUERY',
          failure: 'no installation street address on the project record — no official source can be queried for the legal identity.',
          operatorAction: 'Enter the installation street address on the project.',
        });
      }
      const chainFailures: string[] = [];
      if (!process.env.ATTOM_API_KEY) {
        chainFailures.push(`${ATTOM_ENDPOINT}: ATTOM_API_KEY not set — parcel/APN + owner of record NOT retrieved (chain fell through to the Census Geocoder).`);
      }
      let result: PropertyEnrichmentResult | null = null;
      try {
        result = await enrich({
          // the enrichment input's opportunity_id is a lead-side key the property
          // chain itself never reads; the permit path has no opportunity.
          opportunity_id: '',
          address_line1: q.addressLine1,
          city: q.city, state: q.state, zip: q.zip,
          latitude: q.lat ?? null, longitude: q.lng ?? null,
        });
      } catch (err: unknown) {
        return retrievalFailure({
          sourcesQueried: [CENSUS_ENDPOINT], retrievedAtIso, failureKind: 'TRANSPORT',
          failure: `property-identity chain threw: ${(err as Error)?.message ?? String(err)}`,
          operatorAction: null,
        });
      }
      if (!result) {
        return retrievalFailure({
          sourcesQueried: [ATTOM_ENDPOINT, CENSUS_ENDPOINT, NOMINATIM_ENDPOINT], retrievedAtIso, failureKind: 'NO_COVERAGE',
          failure: `no provider in the chain matched "${[q.addressLine1, q.city, q.state, q.zip].filter(Boolean).join(', ')}" `
            + `(ATTOM${process.env.ATTOM_API_KEY ? '' : ' [no key]'} → US Census Geocoder → Nominatim all returned no match).`,
          operatorAction: 'Correct the installation address — no official source recognises it as written.',
        });
      }
      const value = toPropertyIdentity(result, { retrievedAtIso, chainFailures });
      // Confidence: an official Census/ATTOM address match with a resolved
      // boundary is the strong case; a Nominatim fallback is weak and says so.
      const confidence =
        value.providerUsed === 'attom' ? 0.95
          : value.providerUsed === 'census_geocoder' ? (value.boundaryLayersResolved ? 0.9 : 0.6)
            : 0.4;
      return retrievalOk({ value, sourcesQueried: value.sourcesQueried, retrievedAtIso, confidence });
    },
  };
}
