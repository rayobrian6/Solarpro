/**
 * solarEnricher.ts
 *
 * SolarPro Enrichment Engine — Solar Potential Data
 *
 * Provider chain (in order):
 *   1. Google Solar API    (GOOGLE_SOLAR_API_KEY) — best rooftop data
 *   2. NREL PVWatts v8     (NREL_API_KEY)          — location-based
 *   3. Statistical fallback — state-level lookup, always available
 *
 * Output: peak_sun_hours, system_kw, annual_kwh, savings, ITC, payback,
 *         offset_percentage, co2_offset
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

export interface SolarEnrichmentInput {
  opportunity_id: string
  latitude?: number | null
  longitude?: number | null
  state?: string | null
  zip?: string | null
  square_feet_living?: number | null
  monthly_bill_amount?: number | null
  current_electricity_rate?: number | null
  roof_type?: string | null
  roof_shade?: string | null
}

export interface SolarEnrichmentResult {
  provider_used: string
  peak_sun_hours_daily: number | null
  recommended_system_kw: number | null
  annual_kwh_production: number | null
  annual_savings_year1: number | null
  savings_25_year: number | null
  estimated_system_cost_gross: number | null
  federal_itc_amount: number | null
  estimated_system_cost_net: number | null
  payback_period_years: number | null
  offset_percentage: number | null
  co2_offset_lbs_year: number | null
}

// ────────────────────────────────────────────────────────────────────────────
// State-level statistical fallback data
// ────────────────────────────────────────────────────────────────────────────

const STATE_SOLAR_STATS: Record<string, { peak_sun_hours: number; avg_rate_kwh: number }> = {
  AZ: { peak_sun_hours: 6.57, avg_rate_kwh: 0.127 },
  CA: { peak_sun_hours: 5.82, avg_rate_kwh: 0.231 },
  CO: { peak_sun_hours: 5.50, avg_rate_kwh: 0.125 },
  CT: { peak_sun_hours: 4.12, avg_rate_kwh: 0.233 },
  DE: { peak_sun_hours: 4.45, avg_rate_kwh: 0.145 },
  FL: { peak_sun_hours: 5.26, avg_rate_kwh: 0.135 },
  GA: { peak_sun_hours: 5.08, avg_rate_kwh: 0.125 },
  HI: { peak_sun_hours: 5.59, avg_rate_kwh: 0.382 },
  IA: { peak_sun_hours: 4.55, avg_rate_kwh: 0.122 },
  ID: { peak_sun_hours: 5.23, avg_rate_kwh: 0.100 },
  IL: { peak_sun_hours: 4.20, avg_rate_kwh: 0.128 },
  IN: { peak_sun_hours: 4.21, avg_rate_kwh: 0.128 },
  KS: { peak_sun_hours: 5.12, avg_rate_kwh: 0.128 },
  KY: { peak_sun_hours: 4.18, avg_rate_kwh: 0.115 },
  LA: { peak_sun_hours: 5.08, avg_rate_kwh: 0.118 },
  MA: { peak_sun_hours: 4.28, avg_rate_kwh: 0.226 },
  MD: { peak_sun_hours: 4.56, avg_rate_kwh: 0.148 },
  ME: { peak_sun_hours: 4.10, avg_rate_kwh: 0.198 },
  MI: { peak_sun_hours: 4.01, avg_rate_kwh: 0.177 },
  MN: { peak_sun_hours: 4.53, avg_rate_kwh: 0.130 },
  MO: { peak_sun_hours: 4.73, avg_rate_kwh: 0.122 },
  MS: { peak_sun_hours: 5.00, avg_rate_kwh: 0.128 },
  MT: { peak_sun_hours: 5.10, avg_rate_kwh: 0.110 },
  NC: { peak_sun_hours: 4.95, avg_rate_kwh: 0.125 },
  ND: { peak_sun_hours: 4.75, avg_rate_kwh: 0.110 },
  NE: { peak_sun_hours: 5.00, avg_rate_kwh: 0.110 },
  NH: { peak_sun_hours: 4.15, avg_rate_kwh: 0.228 },
  NJ: { peak_sun_hours: 4.55, avg_rate_kwh: 0.186 },
  NM: { peak_sun_hours: 6.77, avg_rate_kwh: 0.132 },
  NV: { peak_sun_hours: 6.41, avg_rate_kwh: 0.132 },
  NY: { peak_sun_hours: 4.16, avg_rate_kwh: 0.215 },
  OH: { peak_sun_hours: 4.15, avg_rate_kwh: 0.122 },
  OK: { peak_sun_hours: 5.50, avg_rate_kwh: 0.114 },
  OR: { peak_sun_hours: 4.40, avg_rate_kwh: 0.120 },
  PA: { peak_sun_hours: 4.34, avg_rate_kwh: 0.170 },
  RI: { peak_sun_hours: 4.28, avg_rate_kwh: 0.230 },
  SC: { peak_sun_hours: 5.04, avg_rate_kwh: 0.138 },
  SD: { peak_sun_hours: 5.00, avg_rate_kwh: 0.122 },
  TN: { peak_sun_hours: 4.79, avg_rate_kwh: 0.118 },
  TX: { peak_sun_hours: 5.79, avg_rate_kwh: 0.128 },
  UT: { peak_sun_hours: 5.96, avg_rate_kwh: 0.107 },
  VA: { peak_sun_hours: 4.72, avg_rate_kwh: 0.137 },
  VT: { peak_sun_hours: 4.08, avg_rate_kwh: 0.235 },
  WA: { peak_sun_hours: 4.00, avg_rate_kwh: 0.104 },
  WI: { peak_sun_hours: 4.29, avg_rate_kwh: 0.178 },
  WV: { peak_sun_hours: 4.20, avg_rate_kwh: 0.115 },
  WY: { peak_sun_hours: 5.40, avg_rate_kwh: 0.110 },
}

const DEFAULT_SOLAR_STATS = { peak_sun_hours: 4.80, avg_rate_kwh: 0.150 }
const COST_PER_WATT = 3.00  // $/W installed (2024 avg)
const ITC_RATE = 0.30       // 30% federal ITC
const ELECTRICITY_INFLATION = 0.025  // 2.5% annual escalation

// ────────────────────────────────────────────────────────────────────────────
// Calculation helpers
// ────────────────────────────────────────────────────────────────────────────

function calculateSolarFromParams(
  peakSunHours: number,
  systemKw: number,
  elecRate: number
): Omit<SolarEnrichmentResult, 'provider_used' | 'peak_sun_hours_daily' | 'recommended_system_kw'> {
  const systemEfficiency = 0.80  // system losses (heat, wiring, inverter)
  const annualKwh = systemKw * peakSunHours * 365 * systemEfficiency

  const annualSavingsY1 = annualKwh * elecRate
  let savings25 = 0
  let rate = elecRate
  for (let yr = 0; yr < 25; yr++) {
    savings25 += annualKwh * rate
    rate *= (1 + ELECTRICITY_INFLATION)
  }

  const grossCost = systemKw * 1000 * COST_PER_WATT
  const itcAmount = grossCost * ITC_RATE
  const netCost = grossCost - itcAmount
  const payback = netCost / annualSavingsY1

  // Average US home uses ~10,500 kWh/year
  const avgUsageKwh = 10500
  const offset = Math.min(100, Math.round((annualKwh / avgUsageKwh) * 100))

  // CO2: 0.386 kg/kWh (US avg grid) → lbs
  const co2LbsYear = annualKwh * 0.386 * 2.205

  return {
    annual_kwh_production: Math.round(annualKwh),
    annual_savings_year1: Math.round(annualSavingsY1 * 100) / 100,
    savings_25_year: Math.round(savings25 * 100) / 100,
    estimated_system_cost_gross: Math.round(grossCost),
    federal_itc_amount: Math.round(itcAmount),
    estimated_system_cost_net: Math.round(netCost),
    payback_period_years: Math.round(payback * 10) / 10,
    offset_percentage: offset,
    co2_offset_lbs_year: Math.round(co2LbsYear),
  }
}

function recommendSystemKw(monthlyBill: number, elecRate: number, peakSunHours: number): number {
  // Estimate kWh from monthly bill, size to offset 90%
  const monthlyKwh = monthlyBill / elecRate
  const annualKwh = monthlyKwh * 12 * 0.90  // target 90% offset
  const systemKw = annualKwh / (peakSunHours * 365 * 0.80)
  // Clamp to reasonable residential range: 3–25 kW
  return Math.min(25, Math.max(3, Math.round(systemKw * 10) / 10))
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 1: Google Solar API
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromGoogleSolar(input: SolarEnrichmentInput): Promise<SolarEnrichmentResult | null> {
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY
  if (!apiKey || !input.latitude || !input.longitude) return null

  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${input.latitude}&location.longitude=${input.longitude}&requiredQuality=LOW&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null

    const data = await res.json()
    const solarPotential = data?.solarPotential
    if (!solarPotential) return null

    const peakSunHours = solarPotential.maxSunshineHoursPerYear / 365
    const panels = solarPotential.solarPanels?.length || 0
    const wPerPanel = 400  // standard panel wattage
    const systemKw = Math.min(25, (panels * wPerPanel) / 1000)
    const elecRate = input.current_electricity_rate || STATE_SOLAR_STATS[input.state || '']?.avg_rate_kwh || DEFAULT_SOLAR_STATS.avg_rate_kwh

    const calculations = calculateSolarFromParams(peakSunHours, systemKw, elecRate)

    return {
      provider_used: 'google_solar',
      peak_sun_hours_daily: Math.round(peakSunHours * 100) / 100,
      recommended_system_kw: Math.round(systemKw * 10) / 10,
      ...calculations,
    }
  } catch (err) {
    console.warn('[solarEnricher] Google Solar error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 2: NREL PVWatts v8
// ────────────────────────────────────────────────────────────────────────────

async function enrichFromNREL(input: SolarEnrichmentInput): Promise<SolarEnrichmentResult | null> {
  const apiKey = process.env.NREL_API_KEY
  if (!apiKey || !input.latitude || !input.longitude) return null

  try {
    const statStats = STATE_SOLAR_STATS[input.state || ''] || DEFAULT_SOLAR_STATS
    const elecRate = input.current_electricity_rate || statStats.avg_rate_kwh

    // Estimate system size from bill or default 8 kW
    const systemKw = input.monthly_bill_amount
      ? recommendSystemKw(input.monthly_bill_amount, elecRate, statStats.peak_sun_hours)
      : 8.0

    const url = `https://developer.nrel.gov/api/pvwatts/v8.json?api_key=${apiKey}&lat=${input.latitude}&lon=${input.longitude}&system_capacity=${systemKw}&azimuth=180&tilt=20&array_type=1&module_type=0&losses=14&timeframe=annual`

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null

    const data = await res.json()
    const outputs = data?.outputs
    if (!outputs) return null

    const annualKwh = outputs.ac_annual || 0
    const peakSunHours = annualKwh / (systemKw * 365 * 0.80)

    const calculations = calculateSolarFromParams(peakSunHours, systemKw, elecRate)

    return {
      provider_used: 'nrel_pvwatts',
      peak_sun_hours_daily: Math.round(peakSunHours * 100) / 100,
      recommended_system_kw: systemKw,
      ...calculations,
      annual_kwh_production: Math.round(annualKwh),
    }
  } catch (err) {
    console.warn('[solarEnricher] NREL error:', (err as Error).message)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Provider 3: Statistical state-level fallback
// ────────────────────────────────────────────────────────────────────────────

function enrichFromStatistical(input: SolarEnrichmentInput): SolarEnrichmentResult {
  const stats = (input.state && STATE_SOLAR_STATS[input.state]) || DEFAULT_SOLAR_STATS
  const elecRate = input.current_electricity_rate || stats.avg_rate_kwh
  const peakSunHours = stats.peak_sun_hours

  const systemKw = input.monthly_bill_amount
    ? recommendSystemKw(input.monthly_bill_amount, elecRate, peakSunHours)
    : 8.0

  const calculations = calculateSolarFromParams(peakSunHours, systemKw, elecRate)

  return {
    provider_used: 'statistical_fallback',
    peak_sun_hours_daily: peakSunHours,
    recommended_system_kw: systemKw,
    ...calculations,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Persist
// ────────────────────────────────────────────────────────────────────────────

export async function persistSolarEnrichment(
  opportunityId: string,
  result: SolarEnrichmentResult
): Promise<void> {
  try {
    await sql`
      UPDATE network_opportunities
      SET
        peak_sun_hours_daily         = ${result.peak_sun_hours_daily},
        recommended_system_kw        = ${result.recommended_system_kw},
        annual_kwh_production        = ${result.annual_kwh_production},
        annual_savings_year1         = ${result.annual_savings_year1},
        savings_25_year              = ${result.savings_25_year},
        estimated_system_cost_gross  = ${result.estimated_system_cost_gross},
        federal_itc_amount           = ${result.federal_itc_amount},
        estimated_system_cost_net    = ${result.estimated_system_cost_net},
        payback_period_years         = ${result.payback_period_years},
        offset_percentage            = ${result.offset_percentage},
        co2_offset_lbs_year          = ${result.co2_offset_lbs_year},
        solar_enriched_at            = NOW(),
        updated_at                   = NOW()
      WHERE id = ${opportunityId}
    `

    await sql`
      UPDATE enrichment_queue
      SET
        solar_status       = 'completed',
        solar_provider_used = ${result.provider_used},
        solar_enriched_at  = NOW(),
        updated_at         = NOW()
      WHERE opportunity_id = ${opportunityId}
    `
  } catch (err) {
    console.error('[solarEnricher.persist] Error:', err)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main enricher
// ────────────────────────────────────────────────────────────────────────────

export async function enrichSolar(input: SolarEnrichmentInput): Promise<SolarEnrichmentResult> {
  // Provider 1: Google Solar
  const google = await enrichFromGoogleSolar(input)
  if (google) return google

  // Provider 2: NREL PVWatts
  const nrel = await enrichFromNREL(input)
  if (nrel) return nrel

  // Provider 3: Statistical fallback (always available)
  return enrichFromStatistical(input)
}
