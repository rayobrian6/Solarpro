import { describe, expect, it, vi } from 'vitest'
import {
  OPPORTUNITY_ENRICHMENT_VERSION,
  buildOpportunityEnrichment,
  enrichAndPersistOpportunity,
  type EnrichedField,
} from './opportunityEnrichment'
import { logNetworkEvent } from '@/lib/network/attributionTracker'

vi.mock('@/lib/network/attributionTracker', () => ({
  logNetworkEvent: vi.fn().mockResolvedValue(undefined),
}))

function eachEnrichedField(payload: ReturnType<typeof buildOpportunityEnrichment>): EnrichedField[] {
  return [
    ...Object.values(payload.core),
    ...Object.values(payload.homeowner_sales),
    ...Object.values(payload.roof_install),
    ...Object.values(payload.territory_utility),
    ...Object.values(payload.marketplace),
    ...Object.values(payload.risk),
  ]
}

function makeSql() {
  const queries: string[] = []
  const values: unknown[][] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...queryValues: unknown[]) => {
    const q = strings.join(' ')
    queries.push(q)
    values.push(queryValues)

    if (q.includes('SELECT * FROM network_opportunities')) {
      return [{
        id: 'sim-opp-1',
        estimated_system_size_kw: 9.25,
        estimated_project_value: 34250,
        location_state: 'TX',
        location_zip: '78701',
        location_city: 'Austin',
        utility_rate_per_kwh: 0.19,
        monthly_usage_avg_kwh: 1450,
        source_type: 'simulator',
        homeowner_timeline: '30_days',
        homeowner_financing_interest: 'monthly loan',
        battery_candidate: true,
        battery_reason: 'backup interest',
        opportunity_score: 88,
        opportunity_grade: 'A',
        roof_material: 'composition shingle',
        roof_age_years: 7,
        usable_roof_pct: 82,
        shading_score: 76,
        ahj_complexity_score: 38,
        utility_complexity_score: 34,
        main_panel_amps: 200,
      }]
    }

    if (q.includes('SELECT * FROM opportunity_intelligence')) {
      return [{
        opportunity_id: 'sim-opp-1',
        overall_score: 88.33,
        overall_grade: 'A',
        top_match_score: 91,
        total_eligible_contractors: 4,
        intent_score: 82,
      }]
    }

    if (q.includes('FROM opportunity_assignments')) {
      return [{ id: 'assign-1', status: 'offered', match_score: 91 }]
    }

    if (q.includes('FROM opportunity_screening_queue')) {
      return [{ auto_decision: 'pass', confidence_score: 0.82, step10_fail_reasons: [] }]
    }

    return []
  }) as any

  sql.queries = queries
  sql.values = values
  return sql
}

describe('canonical opportunity enrichment', () => {
  it('generates rich contractor-facing intelligence with confidence, factors, and conservative precision', () => {
    const payload = buildOpportunityEnrichment({
      observed_at: '2025-01-01T00:00:00.000Z',
      opportunity: {
        estimated_system_size_kw: 8.4,
        estimated_project_value: 31500,
        peak_sun_hours_annual: 5.1,
        location_state: 'TX',
        location_zip: '78701',
        utility_provider: 'Austin Energy',
        utility_rate_per_kwh: 0.18,
        monthly_usage_avg_kwh: 1325,
        homeowner_timeline: 'asap',
        homeowner_financing_interest: 'yes - monthly payment',
        battery_candidate: true,
        battery_reason: 'homeowner selected backup interest',
        roof_material: 'standing seam metal',
        roof_age_years: 14,
        usable_roof_pct: 68,
        roof_pitch: 'steep',
        shading_score: 58,
        ahj_complexity_score: 62,
        utility_complexity_score: 44,
        main_panel_amps: 125,
        opportunity_score: 86,
        source_type: 'homeowner_direct',
      },
      intelligence: {
        overall_score: 86,
        overall_grade: 'A',
        top_match_score: 90,
        total_eligible_contractors: 5,
        intent_score: 84,
      },
      assignments: [{ status: 'offered', match_score: 90 }],
      screening: { auto_decision: 'pass', step10_fail_reasons: [] },
    })

    expect(payload.schema_version).toBe(OPPORTUNITY_ENRICHMENT_VERSION)
    expect(payload.generated_at).toBe('2025-01-01T00:00:00.000Z')
    expect(payload.derivation.method).toContain('rules_based_projection')
    expect(payload.derivation.inputs).toContain('network_opportunities')
    expect(payload.derivation.inputs).toContain('opportunity_intelligence')

    expect(payload.core.estimated_system_size_kw.value).toBe(8.4)
    expect(payload.core.estimated_annual_production_kwh.value).toBe(Math.round(8.4 * 5.1 * 365 * 0.78))
    expect(payload.core.estimated_epc_cost.value).toBe(18900)
    expect(payload.core.estimated_margin.value).toBe(12600)
    expect(payload.core.estimated_margin.warnings).toContain('Margin is directional and not a bid-level estimate')

    expect(payload.homeowner_sales.battery_likelihood.value).toBeGreaterThanOrEqual(0.8)
    expect(payload.homeowner_sales.battery_likelihood.factors).toEqual(expect.arrayContaining([
      'battery candidate flag',
      'homeowner selected backup interest',
      'high utility rates',
      'TX market',
      'high monthly usage',
    ]))
    expect(payload.homeowner_sales.financing_probability.value).toBeGreaterThan(0.6)
    expect(payload.homeowner_sales.urgency_score.value).toBeGreaterThan(0.8)
    expect(payload.homeowner_sales.close_probability.warnings).toContain('Probability is rules-based until enough marketplace outcomes exist')

    expect(payload.roof_install.roof_complexity.value).toBe('high')
    expect(payload.roof_install.install_difficulty.factors).toEqual(expect.arrayContaining(['roof complexity', 'AHJ complexity', 'shading risk']))
    expect(payload.roof_install.electrical_upgrade_likelihood.value).toBeGreaterThan(0.6)

    expect(payload.territory_utility.service_area_confidence.value).toBeGreaterThan(0)
    expect(payload.marketplace.contractor_fit_score.value).toBe(90)
    expect(payload.marketplace.lead_liquidity_score.value).toBeGreaterThan(60)
    expect(payload.marketplace.marketplace_priority.value).toMatch(/high|urgent/)
    expect(payload.marketplace.exclusivity_recommendation.value).toBe('exclusive_offer')
    expect(payload.risk.fraud_risk.value).toBeLessThan(0.3)

    for (const enriched of eachEnrichedField(payload)) {
      expect(enriched.confidence).toBeGreaterThanOrEqual(0)
      expect(enriched.confidence).toBeLessThanOrEqual(1)
      expect(enriched.confidence).toBe(Number(enriched.confidence.toFixed(4)))
      expect(Array.isArray(enriched.factors)).toBe(true)
    }
  })

  it('handles missing data with lower confidence, warnings, and missing-data explainability', () => {
    const payload = buildOpportunityEnrichment({
      observed_at: '2025-01-02T00:00:00.000Z',
      opportunity: {
        id: 'opp-low-data',
        opportunity_score: 38,
        duplicate_flag: true,
        spam_flag: true,
        invalid_utility_flag: true,
      },
      intelligence: null,
      assignments: [],
      screening: {
        auto_decision: 'fail',
        step10_fail_reasons: ['missing utility', 'invalid phone'],
      },
    })

    expect(payload.core.estimated_system_size_kw.value).toBeNull()
    expect(payload.core.estimated_system_size_kw.missing_data).toEqual(['estimated_system_size_kw'])
    expect(payload.core.estimated_annual_production_kwh.value).toBeNull()
    expect(payload.core.estimated_annual_production_kwh.confidence).toBeLessThan(0.6)
    expect(payload.core.estimated_annual_production_kwh.missing_data).toEqual(expect.arrayContaining(['estimated_system_size_kw', 'peak_sun_hours_annual']))
    expect(payload.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Missing data reduced enrichment confidence'),
      'Screening failure reasons are present',
      'Risk flags are present on canonical opportunity',
    ]))
    expect(payload.risk.fraud_risk.value).toBeGreaterThan(0.8)
    expect(payload.risk.invalid_data_risk.value).toBeGreaterThan(0.6)
    expect(payload.risk.low_quality_reason.value).toContain('spam flag')
    expect(payload.risk.screening_failure_reasons.value).toEqual(['missing utility', 'invalid phone'])
    expect(payload.completeness).toBeLessThan(0.85)
  })

  it('supports simulator opportunities and marketplace-ready enriched payloads', () => {
    const payload = buildOpportunityEnrichment({
      opportunity: {
        source_channel: 'simulator',
        source_type: 'simulator',
        location_state: 'TX',
        location_zip: '78701',
        estimated_system_size_kw: 7.5,
        estimated_project_value: 29000,
        battery_candidate: true,
        homeowner_timeline: '30_days',
        homeowner_financing_interest: 'loan',
        opportunity_score: 82,
      },
      intelligence: { top_match_score: 87, total_eligible_contractors: 3, overall_score: 82 },
      assignments: [{ status: 'offered', match_score: 87 }],
      screening: { auto_decision: 'pass' },
    })

    expect(payload.core.estimated_system_size_kw.value).toBe(7.5)
    expect(payload.homeowner_sales.battery_likelihood.value).toBeGreaterThan(0.7)
    expect(payload.marketplace.contractor_fit_score.value).toBe(87)
    expect(payload.marketplace.assignment_priority.value).toMatch(/standard|high|urgent/)
    expect(payload.marketplace.exclusivity_recommendation.value).toMatch(/exclusive_offer|limited_marketplace|standard_marketplace/)
    expect(payload.completeness).toBeGreaterThan(0.6)
  })

  it('persists enrichment into opportunity_intelligence with one canonical upsert and logs a network event', async () => {
    const sql = makeSql()
    const payload = await enrichAndPersistOpportunity(sql, 'sim-opp-1', { adminUserId: 'admin-1', triggeredBy: 'admin' })

    const upsertIndex = sql.queries.findIndex((q: string) => q.includes('INSERT INTO opportunity_intelligence') && q.includes('ON CONFLICT (opportunity_id) DO UPDATE SET'))
    expect(upsertIndex).toBeGreaterThanOrEqual(0)
    expect(sql.queries[upsertIndex]).toContain('enrichment_payload')
    expect(sql.queries[upsertIndex]).toContain('enrichment_completeness')
    expect(sql.queries[upsertIndex]).not.toMatch(/CREATE TABLE/i)

    expect(sql.values[upsertIndex]).toContain('sim-opp-1')
    expect(sql.values[upsertIndex]).toContain(OPPORTUNITY_ENRICHMENT_VERSION)
    expect(sql.values[upsertIndex]).toContain(payload.completeness)

    const serializedPayload = sql.values[upsertIndex].find((value) => typeof value === 'string' && value.includes('"schema_version"')) as string
    expect(JSON.parse(serializedPayload)).toMatchObject({
      schema_version: OPPORTUNITY_ENRICHMENT_VERSION,
      marketplace: { contractor_fit_score: { value: 91 } },
    })

    expect(logNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'opportunity.enriched',
      event_category: 'opportunity',
      opportunity_id: 'sim-opp-1',
      admin_user_id: 'admin-1',
      triggered_by: 'admin',
      data: expect.objectContaining({
        enrichment_version: OPPORTUNITY_ENRICHMENT_VERSION,
        completeness: payload.completeness,
        missing_data_count: payload.missing_data.length,
      }),
    }))
  })
})
