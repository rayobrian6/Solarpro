/**
 * utilityEnricher.ts
 *
 * SolarPro Enrichment Engine — Utility & Policy Data
 *
 * Provider chain (in order):
 *   1. NREL Utility Rates API  (NREL_API_KEY)   — rates by location
 *   2. OpenEI                  (OPENEI_API_KEY)  — detailed tariff data
 *   3. Static state lookup     (always available) — net metering, SREC markets
 *
 * Output: utility_name, eiaid, electricity_rate_kwh, net_metering_available,
 *         net_metering_policy, ahj_name, interconnection_complexity (1-5),
 *         state_incentives_available, srec_market_active
 *
 * Uses neon() directly.
 */

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface UtilityEnrichmentInput {
  opportunity_id: string
  zip?: string | null
  state?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
  monthly_bill_amount?: number | null
}

export interface UtilityEnrichmentResult {
  provider_used: string
  utility_name: string | null
  utility_eiaid: string | null
  electricity_rate_kwh: number | null
  net_metering_available: boolean | null
  net_metering_policy: string | null
  ahj_name: string | null
  interconnection_complexity: number | null  // 1 (easy) to 5 (hard)
  state_incentives_available: boolean | null
  srec_market_active: boolean | null
}

// ────────────────────────────────────────────────────────────────────────────
// Static state-level policy data
// ────────────────────────────────────────────────────────────────────────────

interface StatePolicy {
  net_metering: boolean
  net_metering_policy: string
  interconnection_complexity: number  // 1-5
  state_incentives: boolean
  srec_market: boolean
  avg_rate_kwh: number
}

const STATE_POLICY: Record<string, StatePolicy> = {
  AZ: { net_metering: true,  net_metering_policy: 'Export Credit',      interconnection_complexity: 3, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.127 },
  CA: { net_metering: true,  net_metering_policy: 'NEM 3.0',            interconnection_complexity: 3, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.231 },
  CO: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.125 },
  CT: { net_metering: true,  net_metering_policy: 'Excess Generation',  interconnection_complexity: 3, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.233 },
  DC: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 3, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.157 },
  DE: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.145 },
  FL: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: false, srec_market: false, avg_rate_kwh: 0.135 },
  GA: { net_metering: true,  net_metering_policy: 'Avoided Cost',       interconnection_complexity: 3, state_incentives: false, srec_market: false, avg_rate_kwh: 0.125 },
  HI: { net_metering: false, net_metering_policy: 'Customer Grid Supply', interconnection_complexity: 4, state_incentives: true, srec_market: false, avg_rate_kwh: 0.382 },
  IA: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.122 },
  IL: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.128 },
  IN: { net_metering: true,  net_metering_policy: 'Avoided Cost',       interconnection_complexity: 3, state_incentives: false, srec_market: false, avg_rate_kwh: 0.128 },
  MA: { net_metering: true,  net_metering_policy: 'Solar SMART / NEM',  interconnection_complexity: 3, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.226 },
  MD: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.148 },
  MI: { net_metering: true,  net_metering_policy: 'Inflow/Outflow',     interconnection_complexity: 3, state_incentives: false, srec_market: false, avg_rate_kwh: 0.177 },
  MN: { net_metering: true,  net_metering_policy: 'Value of Solar',     interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.130 },
  NC: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.125 },
  NJ: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.186 },
  NM: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.132 },
  NV: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 3, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.132 },
  NY: { net_metering: true,  net_metering_policy: 'Net Billing',        interconnection_complexity: 3, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.215 },
  OH: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: false, srec_market: true,  avg_rate_kwh: 0.122 },
  OR: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.120 },
  PA: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: true,  avg_rate_kwh: 0.170 },
  RI: { net_metering: true,  net_metering_policy: 'Net Metering',       interconnection_complexity: 3, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.230 },
  SC: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.138 },
  TX: { net_metering: false, net_metering_policy: 'None (deregulated)', interconnection_complexity: 3, state_incentives: false, srec_market: false, avg_rate_kwh: 0.128 },
  UT: { net_metering: true,  net_metering_policy: 'Export Credit',      interconnection_complexity: 3, state_incentives: false, srec_market: false, avg_rate_kwh: 0.107 },
  VA: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.137 },
  VT: { net_metering: true,  net_metering_policy: 'Group Net Metering', interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.235 },
  WA: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: true,  srec_market: false, avg_rate_kwh: 0.104 },
  WI: { net_metering: true,  net_metering_policy: 'Retail Rate NEM',    interconnection_complexity: 2, state_incentives: false, srec_market: false, avg_rate_kwh: 0.178 },
}

const DEFAULT_POLICY: StatePolicy = {
  net_metering: true,
  net_metering_policy: 'Retail Rate NEM',
  interconnection_complexity: 3,
  state_incentives: false,
  srec_market: false,
  avg_rate_kwh: 0.150,
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 1: NREL Utility Rates API
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromNREL(input: UtilityEnrichmentInput): Promise<UtilityEnrichmentResult | null> {
  const apiKey = process.env.NREL_API_KEY
  if (!apiKey) return null

  try {
    const address = input.zip
      ? encodeURIComponent(input.zip)
      : input.latitude && input.longitude
        ? null
        : null

    if (!address && !(input.latitude && input.longitude)) return null

    const url = input.latitude && input.longitude
      ? `https://developer.nrel.gov/api/utility_rates/v3.json?api_key=${apiKey}&lat=${input.latitude}&lon=${input.longitude}`
      : `https://developer.nrel.gov/api/utility_rates/v3.json?api_key=${apiKey}&address=${address}`

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null

    const data = await res.json()
    const outputs = data?.outputs
    if (!outputs) return null

    const statPolicy = STATE_POLICY[input.state || ''] || DEFAULT_POLICY

    return {
      provider_used: 'nrel_utility_rates',
      utility_name: outputs.utility_name || null,
      utility_eiaid: String(outputs.eiaid || ''),
      electricity_rate_kwh: outputs.residential ? parseFloat(outputs.residential) / 100 : statPolicy.avg_rate_kwh,
      net_metering_available: statPolicy.net_metering,
      net_metering_policy: statPolicy.net_metering_policy,
      ahj_name: null,
      interconnection_complexity: statPolicy.interconnection_complexity,
      state_incentives_available: statPolicy.state_incentives,
      srec_market_active: statPolicy.srec_market,
    }
  } catch (err) {
    console.warn('[utilityEnricher] NREL error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 2: OpenEI
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromOpenEI(input: UtilityEnrichmentInput): Promise<UtilityEnrichmentResult | null> {
  const apiKey = process.env.OPENEI_API_KEY
  if (!apiKey || !input.zip) return null

  try {
    const url = `https://api.openei.org/utility_rates?version=7&format=json&api_key=${apiKey}&address=${input.zip}&sector=Residential&limit=5`

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null

    const data = await res.json()
    const items = data?.items
    if (!items || items.length === 0) return null

    const item = items[0]
    const statPolicy = STATE_POLICY[input.state || ''] || DEFAULT_POLICY

    return {
      provider_used: 'openei',
      utility_name: item.utility || null,
      utility_eiaid: String(item.eiaid || ''),
      electricity_rate_kwh: item.rates?.[0]?.rate || statPolicy.avg_rate_kwh,
      net_metering_available: statPolicy.net_metering,
      net_metering_policy: statPolicy.net_metering_policy,
      ahj_name: null,
      interconnection_complexity: statPolicy.interconnection_complexity,
      state_incentives_available: statPolicy.state_incentives,
      srec_market_active: statPolicy.srec_market,
    }
  } catch (err) {
    console.warn('[utilityEnricher] OpenEI error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 3: Static state-level lookup (always available)
// ────────────────────────────────────────────────────────────────────────────

function enrichFromStaticLookup(input: UtilityEnrichmentInput): UtilityEnrichmentResult {
  const policy = (input.state && STATE_POLICY[input.state]) || DEFAULT_POLICY

  return {
    provider_used: 'static_state_lookup',
    utility_name: null,
    utility_eiaid: null,
    electricity_rate_kwh: policy.avg_rate_kwh,
    net_metering_available: policy.net_metering,
    net_metering_policy: policy.net_metering_policy,
    ahj_name: null,
    interconnection_complexity: policy.interconnection_complexity,
    state_incentives_available: policy.state_incentives,
    srec_market_active: policy.srec_market,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Persist
// ────────────────────────────────────────────────────────────────────────────

export async function persistUtilityEnrichment(
  opportunityId: string,
  result: UtilityEnrichmentResult
): Promise<void> {
  try {
    await sql`
      UPDATE network_opportunities
      SET
        utility_name                = COALESCE(${result.utility_name}, utility_name),
        utility_eiaid               = ${result.utility_eiaid},
        electricity_rate_kwh        = COALESCE(${result.electricity_rate_kwh}, electricity_rate_kwh),
        net_metering_available      = ${result.net_metering_available},
        net_metering_policy         = ${result.net_metering_policy},
        ahj_name                    = ${result.ahj_name},
        interconnection_complexity  = ${result.interconnection_complexity},
        state_incentives_available  = ${result.state_incentives_available},
        srec_market_active          = ${result.srec_market_active},
        utility_enriched_at         = NOW(),
        updated_at                  = NOW()
      WHERE id = ${opportunityId}
    `

    await sql`
      UPDATE enrichment_queue
      SET
        utility_status       = 'completed',
        utility_provider_used = ${result.provider_used},
        utility_enriched_at  = NOW(),
        updated_at           = NOW()
      WHERE opportunity_id = ${opportunityId}
    `
  } catch (err) {
    console.error('[utilityEnricher.persist] Error:', err)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main enricher
// ────────────────────────────────────────────────────────────────────────────

export async function enrichUtility(input: UtilityEnrichmentInput): Promise<UtilityEnrichmentResult> {
  // Provider 1: NREL
  const nrel = await enrichFromNREL(input)
  if (nrel) return nrel

  // Provider 2: OpenEI
  const openei = await enrichFromOpenEI(input)
  if (openei) return openei

  // Provider 3: Static (always available)
  return enrichFromStaticLookup(input)
}
