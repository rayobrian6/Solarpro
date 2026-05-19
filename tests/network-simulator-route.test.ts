import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const mockRequireAdminApi = vi.fn()
const mockGetDbReady = vi.fn()
const mockRunScreening = vi.fn()
const mockMatchContractors = vi.fn()
const mockLogNetworkEvent = vi.fn()

vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: mockRequireAdminApi }))
vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }))
vi.mock('@/lib/network/screeningPipeline', () => ({ runScreeningPipeline: mockRunScreening }))
vi.mock('@/lib/network/contractorMatcher', () => ({ matchContractors: mockMatchContractors }))
vi.mock('@/lib/network/attributionTracker', () => ({ logNetworkEvent: mockLogNetworkEvent }))
vi.mock('@/lib/network/opportunityScorer', () => ({
  scoreOpportunity: () => ({ overall_score: 88.33, overall_grade: 'A', property: { score: 80.25 }, solar: { score: 90.75 }, financial: { score: 80 }, market: { score: 85 }, intent: { score: 90 }, risk_flags: [], opportunity_highlights: ['high_bill'], executive_summary: 'Strong simulated opportunity.' }),
  scoreToListingPrice: () => ({ price: 500, min: 350, max: 700, rationale: 'test pricing' }),
}))

async function importRoute() { return import('@/app/api/admin/network/simulator/route') }
function req(body?: unknown, method = 'POST'): any { return new Request('https://solarpro.test/api/admin/network/simulator', { method, headers: { 'content-type': 'application/json', cookie: 'solarpro_session=test' }, body: body === undefined ? undefined : JSON.stringify(body) }) }

function makeSql() {
  const queries: string[] = []
  const queryValues: any[][] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join(' ')
    queries.push(q)
    queryValues.push(values)
    if (q.includes('INSERT INTO network_opportunities')) return [{ id: 'sim-opp-1' }]
    if (q.includes('SELECT * FROM network_opportunities')) return [{ id: 'sim-opp-1', location_state: 'TX', monthly_usage_avg_kwh: 300, source_type: 'homeowner_direct', battery_candidate: true }]
    if (q.includes('AS marketplace_ready')) return [{ id: 'sim-opp-1', status: 'live', screening_status: 'approved', marketplace_ready: true, city: 'Austin', state: 'TX', overall_score: 88.33, overall_grade: 'A', market_price: 500 }]
    if (q.includes('SELECT no.id, no.status')) return [{ id: 'sim-opp-1', status: 'intake', raw_payload: { simulated: true } }]
    return []
  }) as any
  sql.queries = queries
  sql.queryValues = queryValues
  return sql
}

describe('/api/admin/network/simulator', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireAdminApi.mockReset().mockResolvedValue({ id: 'admin-1', role: 'super_admin', name: 'Admin', email: 'a@test.com' })
    mockGetDbReady.mockReset().mockResolvedValue(makeSql())
    mockRunScreening.mockReset().mockResolvedValue({ auto_decision: 'pass' })
    mockMatchContractors.mockReset().mockResolvedValue({ total_eligible: 1, matches: [{ contractor_id: 'c1' }] })
    mockLogNetworkEvent.mockReset().mockResolvedValue(undefined)
  })

  it('requires super_admin', async () => {
    mockRequireAdminApi.mockResolvedValueOnce({ id: 'admin-2', role: 'admin', name: 'A', email: 'a@test.com' })
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create' }))
    expect(res.status).toBe(403)
  })

  it('creates a simulated opportunity with canonical marker and intake event', async () => {
    const sql = makeSql(); mockGetDbReady.mockResolvedValueOnce(sql)
    const { POST } = await importRoute()
    const res = await POST(req({
      action: 'create',
      opportunity_type: 'solar',
      lead_kind: 'homeowner',
      lead_quality: 'medium',
      urgency: '30_days',
      city: 'Austin',
      state: 'TX',
      source_type: 'facebook_ads',
      estimated_value: 48000,
      run_screening: true,
      run_scoring: true,
      release_to_marketplace: false,
      generate_matches: false,
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, opportunity_id: 'sim-opp-1' })
    const insertQuery = sql.queries.find((q: string) => q.includes('INSERT INTO network_opportunities')) ?? ''
    expect(insertQuery).toContain('homeowner_name')
    expect(insertQuery).toContain('location_city')
    expect(insertQuery).toContain('monthly_usage_avg_kwh')
    expect(insertQuery).toContain('utility_provider')
    expect(insertQuery).toContain('raw_payload')
    expect(insertQuery).not.toContain('homeowner_first_name')
    expect(insertQuery).not.toContain('monthly_bill,')
    expect(insertQuery).not.toContain('battery_interest')
    const scoreUpdateIndex = sql.queries.findIndex((q: string) => q.includes('UPDATE network_opportunities SET') && q.includes('opportunity_score'))
    expect(scoreUpdateIndex).toBeGreaterThanOrEqual(0)
    expect(sql.queryValues[scoreUpdateIndex]).toContain(88)
    expect(sql.queryValues[scoreUpdateIndex]).not.toContain(88.33)
    const intelligenceInsertIndex = sql.queries.findIndex((q: string) => q.includes('INSERT INTO opportunity_intelligence'))
    expect(intelligenceInsertIndex).toBeGreaterThanOrEqual(0)
    expect(sql.queryValues[intelligenceInsertIndex]).toContain(88.33)
    expect(sql.queries[intelligenceInsertIndex]).toContain('CAST(')
    expect(sql.queries[intelligenceInsertIndex]).toContain('AS text[]')
    const releaseCreate = await POST(req({ action: 'create', release_to_marketplace: true }))
    expect(releaseCreate.status).toBe(200)
    expect(await releaseCreate.json()).toMatchObject({ marketplace_ready: { marketplace_ready: true } })
    expect(sql.queryValues[intelligenceInsertIndex]).toContain('{}')
    expect(sql.queryValues[intelligenceInsertIndex]).toContain('{"high_bill"}')
    expect(sql.queryValues[intelligenceInsertIndex]).not.toContain('[]')
    expect(sql.queryValues[intelligenceInsertIndex]).not.toContain('["high_bill"]')
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO intake_events'))).toBe(true)
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'opportunity.created', data: expect.objectContaining({ simulated: true }) }))
  })

  it('can trigger screening, scoring, release, and matching through existing modules', async () => {
    const { POST } = await importRoute()
    await POST(req({ action: 'screen', opportunity_id: 'sim-opp-1' }))
    expect(mockRunScreening).toHaveBeenCalledWith('sim-opp-1')
    const sql = makeSql(); mockGetDbReady.mockResolvedValue(sql)
    const score = await POST(req({ action: 'score', opportunity_id: 'sim-opp-1' }))
    expect(score.status).toBe(200)
    const release = await POST(req({ action: 'release', opportunity_id: 'sim-opp-1' }))
    expect(release.status).toBe(200)
    expect(await release.json()).toMatchObject({ success: true, action: 'release', marketplace_ready: { marketplace_ready: true, status: 'live', screening_status: 'approved' } })
    const releaseRead = sql.queries.find((q: string) => q.includes('AS marketplace_ready')) ?? ''
    expect(releaseRead).toContain('oi.enrichment_payload')
    expect(releaseRead).toContain('oi.enrichment_completeness')
    const releaseUpdate = sql.queries.find((q: string) => q.includes('UPDATE network_opportunities') && q.includes("status = 'live'")) ?? ''
    expect(releaseUpdate).toContain("screening_status = 'approved'")
    expect(releaseUpdate).toContain('screened_at = COALESCE(screened_at, NOW())')
    expect(releaseUpdate).toContain('live_at = COALESCE(live_at, NOW())')
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'opportunity.released_to_marketplace', to_status: 'live' }))
    const match = await POST(req({ action: 'match', opportunity_id: 'sim-opp-1' }))
    expect(match.status).toBe(200)
    expect(mockMatchContractors).toHaveBeenCalledWith('sim-opp-1', { limit: 10, minScore: 30 })
  })

  it('lists only simulated opportunities using canonical marker filter', async () => {
    const sql = makeSql(); mockGetDbReady.mockResolvedValueOnce(sql)
    const { GET } = await importRoute()
    const res = await GET(req(undefined, 'GET'))
    expect(res.status).toBe(200)
    const query = sql.queries.find((q: string) => q.includes('FROM network_opportunities no')) ?? ''
    expect(query).toContain("raw_payload->>'simulated' = 'true'")
    expect(query).toContain("source_channel = 'simulator'")
    expect(query).toContain("no.status <> 'withdrawn'")
    expect(query).toContain('auto_decision_reason')
    expect(query).toContain('step10_fail_reasons')
    expect(query).toContain('oi.enrichment_payload')
    expect(query).toContain('oi.enrichment_completeness')
    expect(query).toContain('oi.enrichment_warnings')
  })

  it('deletes only simulator-marked opportunities and refreshes the list', async () => {
    const sql = makeSql(); mockGetDbReady.mockResolvedValueOnce(sql)
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'delete', opportunity_id: 'sim-opp-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, action: 'delete' })
    const deleteOpportunity = sql.queries.find((q: string) => q.includes('DELETE FROM network_opportunities')) ?? ''
    expect(deleteOpportunity).toContain("raw_payload->>'simulated' = 'true'")
    expect(deleteOpportunity).toContain('RETURNING id')
    const deleteEvents = sql.queries.find((q: string) => q.includes('DELETE FROM network_events')) ?? ''
    expect(deleteEvents).toContain('USING network_opportunities')
    expect(deleteEvents).toContain("source_channel = 'simulator'")
  })


  it('persists screening failures to the canonical step10_fail_reasons column and never queries fail_reasons', () => {
    const pipelineSource = fs.readFileSync(path.join(process.cwd(), 'lib/network/screeningPipeline.ts'), 'utf8')
    const enrichmentSource = fs.readFileSync(path.join(process.cwd(), 'lib/network/opportunityEnrichment.ts'), 'utf8')
    expect(pipelineSource).toContain('step10_fail_reasons   = ${failReasons}')
    expect(pipelineSource).not.toMatch(/UPDATE opportunity_screening_queue SET[\s\S]*\bfail_reasons\s*=/)
    expect(enrichmentSource).toContain('step10_fail_reasons, review_flags FROM opportunity_screening_queue')
    expect(enrichmentSource).not.toContain('step10_fail_reasons, fail_reasons')
  })

  it('refreshes simulator UI state after successful create/actions instead of waiting for manual reload', () => {
    const adminPageSource = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    expect(adminPageSource).toContain('if (data.success !== false) {')
    expect(adminPageSource).toContain('if (Array.isArray(data.opportunities)) setItems(data.opportunities as SimulatedOpportunity[]);')
    expect(adminPageSource).toContain('await loadSimulated();')
  })

  it('shows the canonical public homeowner intake link in the Seed / Simulate Intake tab', () => {
    const adminPageSource = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    expect(adminPageSource).toContain('Seed / Simulate Intake')
    expect(adminPageSource).toContain('https://018hr.app.super.myninja.ai/free-solar-estimate')
    expect(adminPageSource).toContain('Real intake test form')
    expect(adminPageSource).toContain('rel="noopener noreferrer"')
  })

  it('returns stage-aware simulator create failure details without leaking secrets', async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const q = strings.join(' ')
      if (q.includes('INSERT INTO network_opportunities')) {
        const err = new Error('column "homeowner_first_name" of relation "network_opportunities" does not exist') as Error & { code?: string }
        err.code = '42703'
        throw err
      }
      return []
    })
    mockGetDbReady.mockResolvedValueOnce(sql)
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create', opportunity_type: 'solar', lead_quality: 'medium' }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toMatchObject({ success: false, error: 'Simulator create failed', stage: 'opportunity_insert', code: '42703' })
    expect(JSON.stringify(json)).not.toMatch(/DATABASE_URL|JWT_SECRET|ghp_/)
  })

})
