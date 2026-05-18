import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequireAdminApi = vi.fn()
const mockRun = vi.fn()
const mockLog = vi.fn()
const mockGetDbReady = vi.fn()

vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: mockRequireAdminApi }))
vi.mock('@/lib/adminActivityLog', () => ({ logAdminAction: mockLog }))
vi.mock('@/lib/intelligence/runner', () => ({ runIntelligenceProducers: mockRun }))
vi.mock('@/lib/intelligence/observations', () => ({ NeonObservationWriter: class MockWriter {} }))
vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }))

async function importRoute() {
  return import('@/app/api/admin/network/intelligence/runner/route')
}

function req(body: unknown): any {
  return new Request('https://solarpro.test/api/admin/network/intelligence/runner', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'solarpro_session=test' },
    body: JSON.stringify(body),
  })
}

function defaultSummary(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'run-1', dry_run: true, started_at: '2025-01-01T00:00:00Z', finished_at: '2025-01-01T00:00:00Z', duration_ms: 0,
    replay_boundary: 'entity:opportunity:opp-1', producers_requested: ['opportunity_lifecycle'], producers_executed: ['opportunity_lifecycle'],
    entities_processed: [{ entity_type: 'opportunity', entity_id: 'opp-1' }], observations_generated: 1, observations_validated: 1,
    observations_written: 0, observations_skipped: 1, idempotent_collisions: 0, validation_failures: [], producer_failures: [], write_failures: [],
    ...overrides,
  }
}

function mockSql() {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join(' ')
    if (q.includes('FROM network_opportunities')) return [{ id: 'opp-1', status: 'live', updated_at: '2025-01-01T00:00:00Z', opportunity_score: 80 }]
    if (q.includes('FROM opportunity_assignments')) return []
    if (q.includes('FROM project_activity')) return []
    return []
  })
}

describe('POST /api/admin/network/intelligence/runner', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireAdminApi.mockReset().mockResolvedValue({ id: 'admin-1', role: 'super_admin', name: 'Admin', email: 'a@test.com' })
    mockRun.mockReset().mockResolvedValue({ summary: defaultSummary(), observations: [{ entity_type: 'opportunity', entity_id: 'opp-1', observation_type: 'x', confidence: 0.8, observed_at: '2025-01-01T00:00:00Z', idempotency_key: 'k' }] })
    mockLog.mockReset().mockResolvedValue(undefined)
    mockGetDbReady.mockReset().mockResolvedValue(mockSql())
  })

  it('returns 401 for unauthorized access', async () => {
    mockRequireAdminApi.mockResolvedValueOnce(null)
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1' }))
    expect(res.status).toBe(401)
  })

  it('rejects unknown producers', async () => {
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['nope'], opportunity_id: 'opp-1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, error: 'Unknown producer_names supplied' })
  })

  it('rejects missing bounded scope', async () => {
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Bounded scope is required/)
  })

  it('validates replay window and max 31 days', async () => {
    const { POST } = await importRoute()
    const bad = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', window: { start: 'bad', end: '2025-01-01' } }))
    expect(bad.status).toBe(400)
    const tooBroad = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', window: { start: '2025-01-01', end: '2025-03-05' } }))
    expect(tooBroad.status).toBe(400)
    expect((await tooBroad.json()).error).toMatch(/31 days/)
  })

  it('defaults to dry-run and does not pass a writer', async () => {
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', preview_limit: 1 }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dry_run).toBe(true)
    expect(json.observations_preview).toHaveLength(1)
    expect(mockRun.mock.calls[0][0].dry_run).toBe(true)
    expect(mockRun.mock.calls[0][0].writer).toBeUndefined()
  })

  it('restricts non-dry-run to super_admin', async () => {
    mockRequireAdminApi.mockResolvedValueOnce({ id: 'admin-2', role: 'admin', name: 'Admin', email: 'a@test.com' })
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', dry_run: false }))
    expect(res.status).toBe(403)
  })

  it('passes writer and logs admin action for non-dry-run super_admin', async () => {
    mockRun.mockResolvedValueOnce({ summary: defaultSummary({ dry_run: false, observations_written: 1, observations_skipped: 0 }), observations: [] })
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', dry_run: false }))
    expect(res.status).toBe(200)
    expect(mockRun.mock.calls[0][0].dry_run).toBe(false)
    expect(mockRun.mock.calls[0][0].writer).toBeTruthy()
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'admin-1', action: 'run_intelligence_producers' }))
  })

  it('returns structured runner failures and bounded preview', async () => {
    mockRun.mockResolvedValueOnce({
      summary: defaultSummary({ producer_failures: [{ producer_name: 'opportunity_lifecycle', message: 'boom' }] }),
      observations: [
        { entity_type: 'opportunity', entity_id: 'opp-1', observation_type: 'a', confidence: 0.5, observed_at: '2025-01-01', idempotency_key: '1' },
        { entity_type: 'opportunity', entity_id: 'opp-1', observation_type: 'b', confidence: 0.5, observed_at: '2025-01-01', idempotency_key: '2' },
      ],
    })
    const { POST } = await importRoute()
    const res = await POST(req({ producer_names: ['opportunity_lifecycle'], opportunity_id: 'opp-1', preview_limit: 1 }))
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.observations_preview).toHaveLength(1)
    expect(json.observations_preview[0]).not.toHaveProperty('payload')
  })
})
