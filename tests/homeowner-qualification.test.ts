import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  HOMEOWNER_QUALIFICATION_EVENT_TYPE,
  deriveQualificationIntelligence,
} from '@/lib/intake/homeownerQualification'
import { scoreOpportunity } from '@/lib/network/opportunityScorer'
import { buildOpportunityEnrichment } from '@/lib/network/opportunityEnrichment'

const { mockGetDbReady } = vi.hoisted(() => ({
  mockGetDbReady: vi.fn(),
}))

vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }))

function req(body: unknown): any {
  return new Request('https://solarpro.test/api/intake/homeowner/qualification', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  })
}

function makeQualificationSql() {
  const queries: string[] = []
  const values: unknown[][] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...queryValues: unknown[]) => {
    const q = strings.join(' ')
    queries.push(q)
    values.push(queryValues)
    if (q.includes('FROM intake_events') && q.includes("event_type = 'homeowner_intake'")) {
      return [{
        event_id: 'evt_homeowner_test',
        opportunity_id: '11111111-1111-1111-1111-111111111111',
        source_system: 'homeowner_form',
        source_channel: 'web',
        payload: {
          monthly_bill_amount: 350,
          homeowner_status: 'own',
          battery_interest: 'yes',
          timeline: '1_3_months',
          utility_provider: 'Austin Energy',
          roof_age: '8',
        },
      }]
    }
    return []
  }) as any
  sql.queries = queries
  sql.values = values
  return sql
}

describe('homeowner post-submit qualification intelligence', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetDbReady.mockReset()
  })

  it('derives qualification status, lead grade, readiness flags, and contractor summary', () => {
    const intelligence = deriveQualificationIntelligence({
      purchase_intent: 'financing',
      estimated_credit_band: '680_719',
      estimated_income_band: '100k_150k',
      property_type: 'single_family',
      electrical_panel_size: '200a_plus',
      sunlight_confidence: 'full_sun',
      prior_quotes: 'yes',
    }, {
      monthly_bill_amount: 350,
      homeowner_status: 'own',
      battery_interest: 'yes',
      timeline: '1_3_months',
    }, '2025-01-01T00:00:00Z')

    expect(intelligence.lead_grade).toBe('A')
    expect(intelligence.qualification_status).toBe('high_intent')
    expect(intelligence.qualification_statuses).toEqual(expect.arrayContaining(['finance_qualified', 'battery_ready', 'high_intent', 'lightly_qualified']))
    expect(intelligence.finance_readiness).toBe(true)
    expect(intelligence.battery_readiness).toBe(true)
    expect(intelligence.contractor_summary).toContain('A-Grade Opportunity')
    expect(intelligence.contractor_summary).toContain('$350 utility bill')
    expect(intelligence.contractor_summary).toContain('680–719 estimated credit')
    expect(intelligence.scoring_input).toMatchObject({ credit_tier: 'good', median_income: 125000, finance_eligible: true, financing_preference: 'financing' })
    expect(intelligence.matcher_input).toMatchObject({ battery_interest: true, structure_type: 'single_family', lead_grade: 'A' })
  })

  it('normalizes invasive or invalid exact financial answers into safe qualification bands', () => {
    const intelligence = deriveQualificationIntelligence({
      purchase_intent: 'exact_score_742',
      estimated_credit_band: '742',
      estimated_income_band: '123456',
      property_type: 'single_family',
      electrical_panel_size: 'unsure',
      sunlight_confidence: 'unsure',
      prior_quotes: 'no',
    })
    expect(intelligence.normalized).toMatchObject({
      purchase_intent: 'not_sure',
      estimated_credit_band: 'unsure',
      estimated_income_band: 'prefer_not_to_say',
    })
  })

  it('persists qualification as a second intake_events lifecycle event and projects canonical intelligence', async () => {
    const sql = makeQualificationSql()
    mockGetDbReady.mockResolvedValueOnce(sql)
    const { POST } = await import('@/app/api/intake/homeowner/qualification/route')
    const res = await POST(req({
      original_event_id: 'evt_homeowner_test',
      purchase_intent: 'financing',
      estimated_credit_band: '680_719',
      estimated_income_band: '100k_150k',
      property_type: 'single_family',
      electrical_panel_size: '200a_plus',
      sunlight_confidence: 'full_sun',
      prior_quotes: 'yes',
    }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, original_event_id: 'evt_homeowner_test', action: 'qualified' })
    expect(json.intelligence).toMatchObject({ lead_grade: 'A', finance_readiness: true, battery_readiness: true })

    const insertEvent = sql.queries.find((q: string) => q.includes('INSERT INTO intake_events')) ?? ''
    expect(insertEvent).toContain('event_type')
    expect(sql.values.flat()).toContain(HOMEOWNER_QUALIFICATION_EVENT_TYPE)
    expect(sql.values.flat()).toContain('evt_homeowner_test')

    const intelligenceProjection = sql.queries.find((q: string) => q.includes('INSERT INTO opportunity_intelligence')) ?? ''
    expect(intelligenceProjection).toContain('enrichment_payload')
    expect(intelligenceProjection).toContain("'{qualification}'")
  })

  it('feeds qualification intelligence into opportunity scoring dimensions', () => {
    const intelligence = deriveQualificationIntelligence({
      purchase_intent: 'financing',
      estimated_credit_band: '720_plus',
      estimated_income_band: '150k_plus',
      property_type: 'single_family',
      electrical_panel_size: '200a_plus',
      sunlight_confidence: 'full_sun',
      prior_quotes: 'yes',
    }, { monthly_bill_amount: 360, homeowner_status: 'own', battery_interest: 'yes', timeline: '1_3_months' })

    const scored = scoreOpportunity({ monthly_bill: 360, state: 'TX', source_type: 'homeowner_direct', qualification_intelligence: intelligence })
    expect(scored.financial.factors).toMatchObject({ credit_tier_raw: 'excellent', eligible: true, median_income: 175000 })
    expect(scored.intent.factors).toMatchObject({ nlp_intent: intelligence.lead_score })
    expect(scored.opportunity_highlights).toContain('battery_add_on_opportunity')
  })

  it('adds qualification intelligence into marketplace enrichment projections', () => {
    const payload = buildOpportunityEnrichment({
      opportunity: { id: 'opp-1', opportunity_score: 82, battery_candidate: true, utility_rate_per_kwh: 0.18, location_state: 'TX' },
      intelligence: {
        enrichment_payload: {
          qualification: {
            qualification_status: 'high_intent',
            lead_grade: 'A',
            lead_score: 86,
            finance_readiness: true,
            battery_readiness: true,
            contractor_summary: 'A-Grade Opportunity\n\n• $350 utility bill',
          },
        },
      },
      assignments: [],
      screening: {},
      observed_at: '2025-01-01T00:00:00Z',
    })

    expect(payload.marketplace.qualification_status.value).toBe('high_intent')
    expect(payload.marketplace.lead_grade.value).toBe('A')
    expect(payload.marketplace.contractor_summary.value).toContain('A-Grade Opportunity')
    expect(payload.homeowner_sales.financing_probability.factors).toContain('qualification finance readiness')
    expect(payload.roof_install.battery_readiness.factors).toContain('qualification battery readiness')
  })

  it('surfaces qualification intelligence in Admin Intake Feed API and UI source', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/network/intake/route.ts'), 'utf8')
    expect(routeSource).toContain("qie.event_type = 'homeowner_qualification'")
    expect(routeSource).toContain('qie.original_event_id = ie.event_id')
    expect(routeSource).toContain('qualification_intelligence')
    expect(routeSource).toContain('finance_readiness')
    expect(routeSource).toContain('battery_readiness')
    expect(routeSource).toContain('estimated_income_band')
    expect(routeSource).toContain('estimated_credit_band')
    expect(routeSource).toContain('sunlight_confidence')
    expect(routeSource).toContain('property_type')

    const uiSource = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    expect(uiSource).toContain('Qualification intelligence')
    expect(uiSource).toContain('qualificationDetailsFor')
    expect(uiSource).toContain("['Qualification Status'")
    expect(uiSource).toContain("['Lead Grade'")
    expect(uiSource).toContain("['Finance Ready'")
    expect(uiSource).toContain("['Battery Ready'")
    expect(uiSource).toContain('Contractor Summary')
  })

  it('contractor matcher reads canonical qualification projection without duplicate opportunity systems', () => {
    const matcherSource = fs.readFileSync(path.join(process.cwd(), 'lib/network/contractorMatcher.ts'), 'utf8')
    expect(matcherSource).toContain('LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id')
    expect(matcherSource).toContain("oi.enrichment_payload->'qualification'")
    expect(matcherSource).toContain('qualification_status')
    expect(matcherSource).toContain('lead_grade')
    expect(matcherSource).toContain('battery_candidate')
    expect(matcherSource).not.toContain('FROM homeowner_qualifications')
  })
})
