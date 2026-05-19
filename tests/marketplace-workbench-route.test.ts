import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireAdminApi = vi.fn()
const mockGetDbReady = vi.fn()
const mockMatchContractors = vi.fn()
const mockLogNetworkEvent = vi.fn()

vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: mockRequireAdminApi }))
vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }))
vi.mock('@/lib/network/contractorMatcher', () => ({ matchContractors: mockMatchContractors }))
vi.mock('@/lib/network/attributionTracker', () => ({ logNetworkEvent: mockLogNetworkEvent }))

async function importRoute() {
  return import('@/app/api/admin/network/marketplace/route')
}

function req(body?: unknown, method = 'POST'): any {
  return new Request('https://solarpro.test/api/admin/network/marketplace', {
    method,
    headers: { 'content-type': 'application/json', cookie: 'solarpro_session=test' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeSql(opts: { gate?: Record<string, unknown> | null; existingAssignments?: any[]; listRows?: any[]; insertRows?: any[] } = {}) {
  const calls: string[] = []
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(' ')
    calls.push(q)
    if (q.includes('WITH assignment_summary')) return opts.listRows ?? [{ id: 'live-1', status: 'live', screening_status: 'approved', overall_score: 88 }]
    if (q.includes('SELECT COUNT(*)::int AS total')) return [{ total: (opts.listRows ?? [1]).length }]
    if (q.includes('SELECT no.id, no.status, no.screening_status')) return opts.gate === undefined ? [{ id: 'live-1', status: 'live', screening_status: 'approved', auto_decision: 'pass' }] : (opts.gate ? [opts.gate] : [])
    if (q.includes('FROM opportunity_assignments') && q.includes("status IN ('offered'")) return opts.existingAssignments ?? []
    if (q.includes('INSERT INTO opportunity_assignments')) return opts.insertRows ?? [{ id: 'assignment-1' }]
    return []
  }) as any
  sql.calls = calls
  return sql
}

describe('/api/admin/network/marketplace', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireAdminApi.mockReset().mockResolvedValue({ id: 'admin-1', role: 'admin', name: 'Admin', email: 'admin@test.com' })
    mockGetDbReady.mockReset().mockResolvedValue(makeSql())
    mockMatchContractors.mockReset().mockResolvedValue({
      opportunity_id: 'live-1',
      total_eligible: 1,
      top_match: { contractor_id: 'contractor-1', overall_score: 91 },
      matches: [{ contractor_id: 'contractor-1', company_name: 'A Solar', overall_score: 91, geo_score: 100, size_fit_score: 90, service_score: 90, performance_score: 90, capacity_score: 90, match_reasons: ['serves_CA'], match_concerns: [] }],
      matched_at: '2025-01-01T00:00:00Z',
    })
    mockLogNetworkEvent.mockReset().mockResolvedValue(undefined)
  })

  it('rejects unauthenticated callers', async () => {
    mockRequireAdminApi.mockResolvedValueOnce(null)
    const { GET } = await importRoute()
    const res = await GET(req(undefined, 'GET'))
    expect(res.status).toBe(403)
  })

  it('lists only live screening-approved opportunities in the query guard', async () => {
    const sql = makeSql({ listRows: [{ id: 'live-1', status: 'live', screening_status: 'approved' }] })
    mockGetDbReady.mockResolvedValueOnce(sql)
    const { GET } = await importRoute()
    const res = await GET(req(undefined, 'GET'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, opportunities: [{ id: 'live-1' }] })
    const listQuery = sql.calls.find((q: string) => q.includes('WITH assignment_summary')) ?? ''
    expect(listQuery).toContain("WHERE no.status = 'live'")
    expect(listQuery).toContain("no.screening_status = 'approved'")
    expect(listQuery).toContain('no.location_city AS city')
    expect(listQuery).toContain('no.location_state AS state')
    expect(listQuery).toContain('no.asking_price AS listing_price')
    expect(listQuery).not.toContain('no.city')
    expect(listQuery).not.toContain('no.state')
    expect(listQuery).not.toContain('no.listing_price')
    expect(listQuery).not.toContain('homeowner_first_name')
  })

  it('blocks assignment actions for non-live or unapproved opportunities', async () => {
    mockGetDbReady.mockResolvedValueOnce(makeSql({ gate: { id: 'opp-1', status: 'scored', screening_status: 'approved' } }))
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create_assignments', opportunity_id: 'opp-1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Only live opportunities/)
    expect(mockMatchContractors).not.toHaveBeenCalled()
  })

  it('blocks duplicate active assignment creation', async () => {
    mockGetDbReady.mockResolvedValueOnce(makeSql({ existingAssignments: [{ id: 'assignment-existing', status: 'offered', contractor_id: 'c1' }] }))
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create_assignments', opportunity_id: 'live-1' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already has active assignments/)
  })

  it('creates assignments through matcher output and logs network event', async () => {
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create_assignments', opportunity_id: 'live-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, assignments_created: 1, total_eligible: 1 })
    expect(mockMatchContractors).toHaveBeenCalledWith('live-1', { limit: 10, minScore: 30 })
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'assignment.offered', event_category: 'assignment', opportunity_id: 'live-1' }))
  })

  it('returns a visible conflict when matched contractors do not create assignment rows', async () => {
    mockGetDbReady.mockResolvedValueOnce(makeSql({ insertRows: [] }))
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create_assignments', opportunity_id: 'live-1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      success: false,
      error: 'Matched contractors were found, but no assignment offers were created',
      details: { total_eligible: 1, matches_returned: 1, assignments_created: 0 },
    })
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'assignment.offer_insert_skipped' }))
  })

  it('logs no eligible contractors when matcher returns no matches', async () => {
    mockMatchContractors.mockResolvedValueOnce({ opportunity_id: 'live-1', total_eligible: 0, top_match: null, matches: [], matched_at: '2025-01-01T00:00:00Z' })
    const { POST } = await importRoute()
    const res = await POST(req({ action: 'create_assignments', opportunity_id: 'live-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, assignments_created: 0 })
    expect(mockLogNetworkEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'assignment.no_eligible_contractors' }))
  })
})
