import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  scoreOpportunity: () => ({ overall_score: 88, overall_grade: 'A', property: { score: 80 }, solar: { score: 90 }, financial: { score: 80 }, market: { score: 85 }, intent: { score: 90 }, risk_flags: [], opportunity_highlights: ['high_bill'], executive_summary: 'Strong simulated opportunity.' }),
  scoreToListingPrice: () => ({ price: 500, min: 350, max: 700, rationale: 'test pricing' }),
}))

async function importRoute() { return import('@/app/api/admin/network/simulator/route') }
function req(body?: unknown, method = 'POST'): any { return new Request('https://solarpro.test/api/admin/network/simulator', { method, headers: { 'content-type': 'application/json', cookie: 'solarpro_session=test' }, body: body === undefined ? undefined : JSON.stringify(body) }) }

function makeSql() {
  const queries: string[] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join(' ')
    queries.push(q)
    if (q.includes('INSERT INTO network_opportunities')) return [{ id: 'sim-opp-1' }]
    if (q.includes('SELECT * FROM network_opportunities')) return [{ id: 'sim-opp-1', state: 'TX', monthly_bill: 300, source_type: 'homeowner_direct' }]
    if (q.includes('SELECT no.id, no.status')) return [{ id: 'sim-opp-1', status: 'intake', raw_payload: { simulated: true } }]
    return []
  }) as any
  sql.queries = queries
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
    const res = await POST(req({ action: 'create', opportunity_type: 'solar', lead_quality: 'high', run_screening: false }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, opportunity_id: 'sim-opp-1' })
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO network_opportunities'))).toBe(true)
    expect(sql.queries.some((q: string) => q.includes('raw_payload'))).toBe(true)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO intake_events'))).toBe(true)
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'opportunity.created', data: expect.objectContaining({ simulated: true }) }))
  })

  it('can trigger screening, scoring, release, and matching through existing modules', async () => {
    const { POST } = await importRoute()
    await POST(req({ action: 'screen', opportunity_id: 'sim-opp-1' }))
    expect(mockRunScreening).toHaveBeenCalledWith('sim-opp-1')
    const score = await POST(req({ action: 'score', opportunity_id: 'sim-opp-1' }))
    expect(score.status).toBe(200)
    const release = await POST(req({ action: 'release', opportunity_id: 'sim-opp-1' }))
    expect(release.status).toBe(200)
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
  })
})
