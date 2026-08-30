/**
 * propertyEnricher.ts
 *
 * SolarPro Enrichment Engine — Property Data
 *
 * Provider chain (in order):
 *   1. ATTOM API            (ATTOM_API_KEY) — paid, best data
 *   2. Census Geocoder      (free)          — lat/lng + FIPS
 *   3. Nominatim / OSM      (free)          — lat/lng + formatted address
 *
 * Output: lat/lng, formatted_address, county, fips_code, census_tract,
 *         parcel_id, property_type, year_built, sqft_living, sqft_lot,
 *         beds, baths, owner_name, owner_occupied, assessed/market value,
 *         last_sale_date, last_sale_price
 *
 * Uses neon() directly.
 */

import { getDbReady } from '@/lib/db-neon'

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady()
  return (db as any)(strings, ...values)
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface PropertyEnrichmentInput {
  opportunity_id: string
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface PropertyEnrichmentResult {
  provider_used: string
  latitude: number | null
  longitude: number | null
  formatted_address: string | null
  county: string | null
  fips_code: string | null
  census_tract: string | null
  parcel_id: string | null
  property_type: string | null
  year_built: number | null
  square_feet_living: number | null
  square_feet_lot: number | null
  bedrooms: number | null
  bathrooms: number | null
  owner_name: string | null
  owner_occupied: boolean | null
  assessed_value: number | null
  market_value: number | null
  last_sale_date: string | null
  last_sale_price: number | null
  // ── AAC WS-3 (2026-07-27) — MUNICIPAL BOUNDARY EVIDENCE ────────────────────
  // The permit path needs to know WHICH jurisdiction the parcel sits in, not just
  // which county. The Census geographies response already carries an
  // "Incorporated Places" layer; the ABSENCE of that layer for a matched address
  // is positive evidence that the site is UNINCORPORATED (and therefore that the
  // COUNTY, not the nearest city, is the AHJ). These fields were being dropped.
  // Optional so every existing construction site of this interface still compiles.
  /** the incorporated municipality the parcel is inside, or null when the
   *  geocoder matched the address and returned NO place ⇒ unincorporated. */
  incorporated_place?: string | null
  /** minor civil division / township (Census "County Subdivisions"). */
  county_subdivision?: string | null
  state_fips?: string | null
  county_fips?: string | null
  place_fips?: string | null
  /** true only when the provider actually resolved the place layer, so "no place"
   *  (unincorporated) is distinguishable from "the layer was never queried". */
  boundary_layers_resolved?: boolean
  // ── PER-FACET PROVENANCE ───────────────────────────────────────────────────
  // A record may now be assembled from more than one leg (see enrichProperty),
  // so one `provider_used` can no longer describe where every facet came from.
  // Crediting the boundary provider with an ATTOM parcel id would print "parcel
  // identifier published by census_geocoder", and the Census geocoder publishes
  // no parcel identifiers. These say who established what.
  /** the leg that published `parcel_id` (only ATTOM does). */
  parcel_source?: string | null
  /** the leg that resolved the municipal-boundary layers (only Census does). */
  boundary_source?: string | null
  /** every leg that contributed a facet, in the order they ran. */
  provider_contributors?: string[]
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 1: ATTOM API
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromATTOM(input: PropertyEnrichmentInput): Promise<PropertyEnrichmentResult | null> {
  const apiKey = process.env.ATTOM_API_KEY
  if (!apiKey) return null

  try {
    const address = encodeURIComponent(`${input.address_line1 || ''} ${input.city || ''} ${input.state || ''} ${input.zip || ''}`.trim())
    const res = await fetch(
      `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?address=${address}`,
      {
        headers: {
          'apikey': apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      }
    )

    if (!res.ok) return null

    const data = await res.json()
    const prop = data?.property?.[0]
    if (!prop) return null

    const building = prop.building || {}
    const lot = prop.lot || {}
    const assessment = prop.assessment || {}
    const saleHistory = prop.saleHistory?.[0] || {}
    const geo = prop.location || {}
    const owner = prop.owner || {}

    return {
      provider_used: 'attom',
      latitude: parseFloat(geo.latitude) || null,
      longitude: parseFloat(geo.longitude) || null,
      formatted_address: prop.address?.oneLine || null,
      county: prop.address?.county || null,
      fips_code: prop.location?.geoIdV4?.CO || null,
      census_tract: prop.location?.censusTracts?.[0]?.tractCode || null,
      parcel_id: prop.identifier?.apn || null,
      property_type: building.useCode?.description || null,
      year_built: parseInt(building.yearBuilt) || null,
      square_feet_living: parseInt(building.size?.livingSize) || null,
      square_feet_lot: parseInt(lot.lotSize2) || null,
      bedrooms: parseInt(building.rooms?.beds) || null,
      bathrooms: parseFloat(building.rooms?.bathsFull) || null,
      owner_name: owner.owner1?.fullName || null,
      owner_occupied: owner.ownerOccupied === 'Y' ? true : owner.ownerOccupied === 'N' ? false : null,
      assessed_value: parseFloat(assessment.assessed?.assdTtlValue) || null,
      market_value: parseFloat(assessment.market?.mktTtlValue) || null,
      last_sale_date: saleHistory.saleTransDate || null,
      last_sale_price: parseFloat(saleHistory.amount?.saleAmt) || null,
    }
  } catch (err) {
    console.warn('[propertyEnricher] ATTOM error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 2: Census Geocoder (free)
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromCensus(input: PropertyEnrichmentInput): Promise<PropertyEnrichmentResult | null> {
  try {
    const address = encodeURIComponent(`${input.address_line1 || ''}`)
    const city = encodeURIComponent(input.city || '')
    const state = encodeURIComponent(input.state || '')
    const zip = encodeURIComponent(input.zip || '')

    const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?street=${address}&city=${city}&state=${state}&zip=${zip}&benchmark=Public_AR_Current&vintage=Current_Current&format=json&layers=all`

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null

    const data = await res.json()
    const match = data?.result?.addressMatches?.[0]
    if (!match) return null

    const coords = match.coordinates
    const geo = match.geographies
    const tract = geo?.['Census Tracts']?.[0]
    const county = geo?.['Counties']?.[0]
    // AAC WS-3 — the boundary layers the response already contained and this
    // function used to discard. A matched address with NO "Incorporated Places"
    // entry is UNINCORPORATED; that is evidence, not an absence of evidence.
    const place = geo?.['Incorporated Places']?.[0] ?? geo?.['Census Designated Places']?.[0]
    const cousub = geo?.['County Subdivisions']?.[0]

    return {
      provider_used: 'census_geocoder',
      incorporated_place: place?.NAME ?? null,
      county_subdivision: cousub?.NAME ?? null,
      state_fips: county?.STATE ?? null,
      county_fips: county?.COUNTY ?? null,
      place_fips: place?.GEOID ?? null,
      boundary_layers_resolved: true,
      latitude: coords?.y || null,
      longitude: coords?.x || null,
      formatted_address: match.matchedAddress || null,
      county: county?.NAME || null,
      fips_code: county?.STATE ? `${county.STATE}${county.COUNTY}` : null,
      census_tract: tract?.TRACT || null,
      parcel_id: null,
      property_type: null,
      year_built: null,
      square_feet_living: null,
      square_feet_lot: null,
      bedrooms: null,
      bathrooms: null,
      owner_name: null,
      owner_occupied: null,
      assessed_value: null,
      market_value: null,
      last_sale_date: null,
      last_sale_price: null,
    }
  } catch (err) {
    console.warn('[propertyEnricher] Census error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 3: Nominatim / OpenStreetMap (free)
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromNominatim(input: PropertyEnrichmentInput): Promise<PropertyEnrichmentResult | null> {
  try {
    const q = encodeURIComponent(
      [input.address_line1, input.city, input.state, input.zip].filter(Boolean).join(', ')
    )
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&addressdetails=1&limit=1&countrycodes=us`

    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolarPro/1.0 (solarpro.solutions)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const data = await res.json()
    const item = data?.[0]
    if (!item) return null

    const addr = item.address || {}

    return {
      provider_used: 'nominatim',
      latitude: parseFloat(item.lat) || null,
      longitude: parseFloat(item.lon) || null,
      formatted_address: item.display_name || null,
      county: addr.county || null,
      fips_code: null,
      census_tract: null,
      parcel_id: null,
      property_type: item.type || null,
      year_built: null,
      square_feet_living: null,
      square_feet_lot: null,
      bedrooms: null,
      bathrooms: null,
      owner_name: null,
      owner_occupied: null,
      assessed_value: null,
      market_value: null,
      last_sale_date: null,
      last_sale_price: null,
    }
  } catch (err) {
    console.warn('[propertyEnricher] Nominatim error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Persist
// ────────────────────────────────────────────────────────────────────────────

export async function persistPropertyEnrichment(
  opportunityId: string,
  result: PropertyEnrichmentResult
): Promise<void> {
  try {
    // Update network_opportunities
    await sql`
      UPDATE network_opportunities
      SET
        latitude            = COALESCE(${result.latitude}, latitude),
        longitude           = COALESCE(${result.longitude}, longitude),
        county              = COALESCE(${result.county}, county),
        fips_code           = ${result.fips_code},
        census_tract        = ${result.census_tract},
        parcel_id           = ${result.parcel_id},
        property_type       = COALESCE(${result.property_type}, property_type),
        year_built          = ${result.year_built},
        square_feet_living  = COALESCE(${result.square_feet_living}, square_feet_living),
        square_feet_lot     = ${result.square_feet_lot},
        bedrooms            = ${result.bedrooms},
        bathrooms           = ${result.bathrooms},
        owner_name          = ${result.owner_name},
        owner_occupied      = ${result.owner_occupied},
        assessed_value      = ${result.assessed_value},
        market_value        = ${result.market_value},
        last_sale_date      = ${result.last_sale_date},
        last_sale_price     = ${result.last_sale_price},
        property_enriched_at = NOW(),
        updated_at          = NOW()
      WHERE id = ${opportunityId}
    `

    // Update enrichment_queue
    await sql`
      UPDATE enrichment_queue
      SET
        property_status       = 'completed',
        property_provider_used = ${result.provider_used},
        property_enriched_at   = NOW(),
        updated_at             = NOW()
      WHERE opportunity_id = ${opportunityId}
    `
  } catch (err) {
    console.error('[propertyEnricher.persist] Error:', err)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main enricher
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fill the facets an earlier leg left null, without ever overwriting one it
 * established. Later legs SUPPLEMENT, they do not correct — a provider that ran
 * second because the first was incomplete has no standing to overrule it.
 */
function supplement(
  base: PropertyEnrichmentResult, extra: PropertyEnrichmentResult,
): PropertyEnrichmentResult {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'provider_used' || k === 'provider_contributors') continue
    if (v === null || v === undefined) continue
    const cur = out[k]
    if (cur === null || cur === undefined || cur === '') out[k] = v
  }
  return out as unknown as PropertyEnrichmentResult
}

/**
 * THE CHAIN RUNS UNTIL THE FACETS ARE ESTABLISHED, NOT UNTIL A LEG ANSWERS.
 *
 * This used to be `if (attom) return attom` — first success wins, whole record.
 * But the three legs do not answer the same question. ATTOM establishes parcel
 * and assessment facts and knows nothing about legal boundaries; the Census
 * geocoder is the ONLY leg that resolves which incorporated place contains the
 * parcel, and it is the only source of state/county/place FIPS. Six facets have
 * exactly one provider and that provider was the second leg of a chain that
 * stopped at the first.
 *
 * So on any project where ATTOM answered — the ordinary case wherever an ATTOM
 * key is configured — `boundary_layers_resolved` stayed undefined, the boundary
 * was recorded as UNDETERMINED, and downstream the municipalBoundary field was
 * filled with the mailing city. The registry gap and the AHJ substitution
 * both trace back to this one `return`.
 *
 * The chain now continues while a REQUIRED facet is still missing, and merges.
 * Nothing is overwritten: a later leg may only fill blanks.
 */
export async function enrichProperty(
  input: PropertyEnrichmentInput
): Promise<PropertyEnrichmentResult | null> {
  const contributors: string[] = []
  let merged: PropertyEnrichmentResult | null = null

  // Provider 1: ATTOM — parcel / assessment facts. Never legal boundary.
  const attom = await enrichFromATTOM(input)
  if (attom) {
    contributors.push('attom')
    merged = { ...attom, parcel_source: attom.parcel_id ? 'attom' : null }
  }

  // Provider 2: Census Geocoder — the ONLY leg that establishes legal geography.
  // Run it whenever the boundary is still unresolved, INCLUDING when ATTOM has
  // already answered. This is the fix: a successful earlier leg is not evidence
  // about a facet it never had.
  if (!merged || merged.boundary_layers_resolved !== true) {
    const census = await enrichFromCensus(input)
    if (census) {
      contributors.push('census_geocoder')
      const withSource = { ...census, boundary_source: 'census_geocoder' }
      merged = merged ? supplement(merged, withSource) : withSource
      // The boundary determination is the authority-relevant one, so the record
      // is attributed to the leg that made it. Facet-level provenance below
      // keeps the ATTOM contribution visible and correctly credited.
      merged = { ...merged, provider_used: 'census_geocoder' }
    }
  }

  // Provider 3: Nominatim — coordinate fallback only. No FIPS, no boundary.
  if (!merged) {
    const nominatim = await enrichFromNominatim(input)
    if (nominatim) {
      contributors.push('nominatim')
      merged = nominatim
    }
  }

  if (!merged) return null
  return { ...merged, provider_contributors: contributors }
}
