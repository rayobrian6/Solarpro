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

    return {
      provider_used: 'census_geocoder',
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

export async function enrichProperty(
  input: PropertyEnrichmentInput
): Promise<PropertyEnrichmentResult | null> {
  // Provider 1: ATTOM
  const attom = await enrichFromATTOM(input)
  if (attom) return attom

  // Provider 2: Census Geocoder
  const census = await enrichFromCensus(input)
  if (census) return census

  // Provider 3: Nominatim
  const nominatim = await enrichFromNominatim(input)
  if (nominatim) return nominatim

  return null
}
