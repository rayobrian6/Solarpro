// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — PROPERTY / LEGAL-IDENTITY RETRIEVAL PROVIDER (the contract)
// ───────────────────────────────────────────────────────────────────────────
// Audit §2.2 / Path 13: `lib/enrichment/propertyEnricher.ts` (ATTOM → US Census
// Geocoder → Nominatim) ALREADY EXISTS and returns parcel_id, county, fips_code,
// census_tract, formatted_address and owner_name. Its only caller is the LEAD
// enrichment orchestrator — the permit path never called it, so
// PROJECT-AUTHORITY-UNVERIFIED fired from the literal `false` at build.ts:1024.
//
// This is the permit-path adapter. It is a THIN wrapper over the existing chain
// (no second implementation) that adds what an AUTHORITY record needs and a lead
// record does not:
//   • an explicit per-field verification state with the provider that supplied it
//   • municipal BOUNDARY evidence (incorporated place vs unincorporated township)
//   • an exact failure per provider, never a collapsed null
//   • a confidence, and an AMBIGUOUS signal when the boundary is genuinely unclear
//
// POSTAL INFERENCE IS NOT VERIFICATION (the standing rule, projectAuthority.ts
// §14). A field is `verified` ONLY when an official source returned it for this
// exact address: the US Census Geocoder is the Census Bureau's own address
// matcher and its county / tract / place assignment for a MATCHED address is an
// official determination. A value that merely rode in on the posted project
// record stays `unverified-derived`, exactly as before.
// ═══════════════════════════════════════════════════════════════════════════

import type { RetrievalProvider, RetrievalResult } from '../types';

export interface PropertyIdentityQuery {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Which provider established one field. */
export type IdentityFieldSource = 'attom' | 'census_geocoder' | 'nominatim' | 'project-record' | 'none';

export interface RetrievedPropertyIdentity {
  /** the provider that answered (the chain stops at the first success). */
  providerUsed: IdentityFieldSource;
  /** the OFFICIAL normalized address string the source returned. */
  normalizedAddress: string | null;
  lat: number | null;
  lng: number | null;
  county: string | null;
  stateFips: string | null;
  countyFips: string | null;
  censusTract: string | null;
  /** APN / parcel id — only ATTOM supplies one. */
  parcelId: string | null;
  /** WHICH leg published `parcelId`. The record can now be assembled from more
   *  than one provider (the chain continues past a leg that cannot establish the
   *  legal boundary), so `providerUsed` describes the boundary determination and
   *  no longer implies the parcel came from the same place. Null when no leg
   *  published a parcel id. */
  parcelSource: IdentityFieldSource | null;
  ownerName: string | null;
  // ── boundary evidence ────────────────────────────────────────────────────
  /** the incorporated municipality, or null. */
  incorporatedPlace: string | null;
  /** minor civil division / township. */
  countySubdivision: string | null;
  placeFips: string | null;
  /** true ⇒ the place layer was actually resolved, so a null place MEANS
   *  unincorporated. false ⇒ unknown (the layer was never queried). */
  boundaryLayersResolved: boolean;
  /** the single sentence a reviewer reads: what jurisdiction this parcel is in
   *  and on what evidence. */
  boundaryEvidence: string;
  /** true when the site is positively determined to be OUTSIDE any incorporated
   *  municipality ⇒ the COUNTY is the building AHJ. null when undetermined. */
  unincorporated: boolean | null;
  retrievedAtIso: string;
  /** the endpoints actually queried, in order. */
  sourcesQueried: string[];
  /** per-provider failures along the chain — recorded even when a later provider
   *  succeeded, so a degraded answer is visible. */
  chainFailures: string[];
  proof: 'live-retrieval' | 'fixture';
  fixtureProvenance?: string | null;
}

export interface PropertyIdentityProvider extends RetrievalProvider {
  getPropertyIdentity(q: PropertyIdentityQuery): Promise<RetrievalResult<RetrievedPropertyIdentity>>;
}
