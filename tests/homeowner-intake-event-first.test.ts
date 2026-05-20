import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetDbReady = vi.fn()
const mockRequireAdminApi = vi.fn()

vi.mock('@/lib/db-neon', () => ({ getDbReady: mockGetDbReady }))
vi.mock('@/lib/adminAuth', () => ({ requireAdminApi: mockRequireAdminApi }))

async function importHomeownerRoute() {
  return import('@/app/api/intake/homeowner/route')
}

async function importAdminFeedRoute() {
  return import('@/app/api/admin/network/intake/route')
}

function postReq(body: unknown, init: RequestInit = {}): any {
  return new Request('https://solarpro.test/api/intake/homeowner', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': `203.0.113.${Math.floor(Math.random() * 200) + 1}`, ...(init.headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function multipartHomeownerReq(payload: Record<string, unknown>, file: File): any {
  const formData = new FormData()
  formData.append('payload', JSON.stringify(payload))
  formData.append('utility_bill', file)
  return new Request('https://solarpro.test/api/intake/homeowner', {
    method: 'POST',
    headers: { 'x-real-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: formData,
  })
}

function pdfUploadFile(name = 'utility bill.pdf'): File {
  return new File([Buffer.from('%PDF-1.7\nmock utility bill\n%%EOF')], name, { type: 'application/pdf' })
}

function adminReq(url = 'https://solarpro.test/api/admin/network/intake?page=1&limit=25'): any {
  return new Request(url, { method: 'GET', headers: { cookie: 'solarpro_session=test' } })
}

function makeSql(opts: { failOn?: string; failError?: Error & { code?: string; column?: string; detail?: string } } = {}) {
  const queries: string[] = []
  const values: any[][] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
    const q = strings.join(' ')
    queries.push(q)
    values.push(vals)
    if (opts.failOn && q.includes(opts.failOn)) throw opts.failError ?? new Error('mock db failure')
    if (q.includes('FROM intake_funnels')) return [{ id: 'funnel-1', campaign_id: 'campaign-1', require_phone: true, require_address: true, is_active: true }]
    if (q.includes('INSERT INTO intake_events')) return []
    if (q.includes('SELECT *, COUNT(*) OVER() AS __total')) return [{
      id: 'evt_homeowner_test',
      intake_record_type: 'intake_event',
      event_id: 'evt_homeowner_test',
      opportunity_id: null,
      status: 'pending_review',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      phone: '+14155551212',
      address_line1: '123 Solar Way',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      source_system: 'homeowner_form',
      source_channel: 'web',
      monthly_bill_amount: 350,
      event_type: 'homeowner_intake',
      review_status: 'pending_operator_review',
      received_at: '2025-01-01T00:00:00Z',
      source_funnel: 'free-solar-estimate',
      ready_for_review: true,
      needs_missing_data: [],
      qualification_skipped: false,
      bill_attachment_metadata_only: true,
      validation_warning: [],
      enrichment_status: 'pending_review',
      qualification_event_id: 'qual_evt_homeowner_test',
      qualification_status: 'high_intent',
      lead_grade: 'A',
      finance_readiness: true,
      battery_readiness: true,
      estimated_income_band: '100k_150k',
      estimated_credit_band: '680_719',
      sunlight_confidence: 'full_sun',
      property_type: 'single_family',
      qualification_intelligence: {
        qualification_status: 'high_intent',
        lead_grade: 'A',
        finance_readiness: true,
        battery_readiness: true,
        contractor_summary: 'A-Grade Opportunity\n\n• $350 utility bill',
        normalized: {
          estimated_income_band: '100k_150k',
          estimated_credit_band: '680_719',
          sunlight_confidence: 'full_sun',
          property_type: 'single_family',
        },
      },
      qualification_payload: { original_event_id: 'evt_homeowner_test' },
      utility_provider: 'Austin Energy',
      battery_interest: 'yes',
      homeowner_status: 'own',
      preferred_contact_method: 'text',
      timeline: '1_3_months',
      roof_age: '8',
      bill_metadata: { filename: 'bill.pdf', size_bytes: 71524, content_type: 'application/pdf', storage_status: 'metadata_only_not_uploaded', accessible_url: null },
      intake_metadata: {
        utility_provider: 'Austin Energy',
        battery_interest: 'yes',
        homeowner_status: 'own',
        preferred_contact_method: 'text',
        timeline: '1_3_months',
        roof_age: '8',
        notes: 'Homeowner notes: wants backup power',
        bill_attachment_metadata_only: true,
      },
      created_at: '2025-01-01T00:00:00Z',
      __total: 1,
    }]
    if (q.includes('COUNT(*) FILTER')) return [{ today_count: 1, week_count: 1, month_count: 1, total_all_time: 1, debug_hidden_count: 0, pending_review_count: 1 }]
    if (q.includes('SELECT action, COUNT(*)')) return [{ action: 'pending_review', count: 1 }]
    if (q.includes('CONCAT(COALESCE(source_system')) return [{ source_system: 'homeowner_form', source_channel: 'web', source: 'homeowner_form/web', count: 1, clean_count: 1 }]
    if (q.includes('COUNT(*) AS total_events')) return [{ total_events: 1, validation_failures: 0, created: 1, blocked: 0, flagged: 0, malformed: 0, errors: 0 }]
    return []
  }) as any
  sql.queries = queries
  sql.values = values
  return sql
}

const validPayload = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone: '(415) 555-1212',
  email: 'Ada@Example.com',
  address_line1: '123 Solar Way',
  property_address: '123 Solar Way',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  monthly_bill_amount: '350',
  average_monthly_bill: '350',
  utility_provider: 'Austin Energy',
  battery_interest: 'yes',
  homeowner_status: 'own',
  home_ownership: 'own',
  preferred_contact_method: 'text',
  timeline: '1_3_months',
  roof_age: '8',
  uploaded_bill_filename: 'bill.pdf',
  uploaded_bill_size_bytes: 71524,
  uploaded_bill_content_type: 'application/pdf',
  source_channel: 'web',
  funnel_slug: 'free-solar-estimate',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'spring',
  utm_content: 'hero',
  utm_term: 'solar estimate',
  gclid: 'gclid-123',
  fbclid: 'fbclid-123',
  consent_given: true,
}

describe('homeowner intake event-first flow', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetDbReady.mockReset().mockResolvedValue(makeSql())
    mockRequireAdminApi.mockReset().mockResolvedValue({ id: 'admin-1', role: 'admin', email: 'admin@test.com' })
  })

  it('persists valid homeowner submissions only to canonical intake_events and returns an event reference', async () => {
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { POST } = await importHomeownerRoute()
    const res = await POST(postReq(validPayload))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, opportunity_id: null, review_status: 'pending_operator_review' })
    expect(json.event_id).toMatch(/^evt_homeowner_/)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO intake_events'))).toBe(true)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO network_opportunities'))).toBe(false)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO opportunity_sources'))).toBe(false)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO enrichment_queue'))).toBe(false)

    const insertIndex = sql.queries.findIndex((q: string) => q.includes('INSERT INTO intake_events'))
    const payloadJson = sql.values[insertIndex].find((v: unknown) => typeof v === 'string' && v.includes('canonical_review_flow')) as string
    expect(payloadJson).toContain('Austin Energy')
    const parsedPayload = JSON.parse(payloadJson)
    expect(parsedPayload.monthly_bill_amount).toBe(350)
    expect(parsedPayload.average_monthly_bill).toBe('350')
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: 'bill.pdf',
      size_bytes: 71524,
      content_type: 'application/pdf',
      storage_status: 'metadata_only_not_uploaded',
      accessible_url: null,
    })
    expect(parsedPayload.bill_attachment_metadata_only).toBe(true)
    expect(parsedPayload.monthly_bill_amount).not.toBe(parsedPayload.bill_metadata.size_bytes)
    expect(payloadJson).toContain('bill.pdf')
    expect(payloadJson).toContain('gclid-123')
    expect(sql.values[insertIndex]).toContain('pending_review')
    expect(sql.values[insertIndex]).toContain('google')
    expect(sql.values[insertIndex]).toContain('fbclid-123')
  })


  it('does not drop a homeowner intake when production bill storage is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { POST } = await importHomeownerRoute()

    const res = await POST(multipartHomeownerReq(validPayload, pdfUploadFile('Braidon Bill.pdf')))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, opportunity_id: null, review_status: 'pending_operator_review' })
    const insertIndex = sql.queries.findIndex((q: string) => q.includes('INSERT INTO intake_events'))
    expect(insertIndex).toBeGreaterThan(-1)
    const payloadJson = sql.values[insertIndex].find((v: unknown) => typeof v === 'string' && v.includes('canonical_review_flow')) as string
    const parsedPayload = JSON.parse(payloadJson)
    expect(parsedPayload.bill_attachment_metadata_only).toBe(true)
    expect(parsedPayload.bill_metadata).toMatchObject({
      filename: 'Braidon Bill.pdf',
      content_type: 'application/pdf',
      storage_status: 'metadata_only_not_uploaded',
      accessible_url: null,
      download_url: null,
    })
  })

  it('still blocks unsupported utility bill files instead of silently accepting bad uploads', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { POST } = await importHomeownerRoute()

    const res = await POST(multipartHomeownerReq(
      validPayload,
      new File(['not a supported bill'], 'Braidon Bill.fff', { type: 'application/octet-stream' }),
    ))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Unsupported utility bill file type/)
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO intake_events'))).toBe(false)
  })

  it('records invalid homeowner payloads as validation_failed intake_events with clear public details', async () => {
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { POST } = await importHomeownerRoute()
    const res = await POST(postReq({ ...validPayload, email: 'not-an-email', phone: '123' }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('Please check your information and try again.')
    expect(json.event_id).toMatch(/^evt_homeowner_/)
    expect(json.details.join(' ')).toMatch(/Invalid email format|Invalid phone format/)
    const insertIndex = sql.queries.findIndex((q: string) => q.includes('INSERT INTO intake_events'))
    expect(sql.values[insertIndex]).toContain('validation_failed')
    expect(sql.values[insertIndex]).toContain('VALIDATION_FAILED')
    expect(sql.queries.some((q: string) => q.includes('INSERT INTO network_opportunities'))).toBe(false)
  })

  it('admin intake feed is admin-gated and includes event-first rows in the existing feed response shape', async () => {
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { GET } = await importAdminFeedRoute()

    mockRequireAdminApi.mockResolvedValueOnce(null)
    const denied = await GET(adminReq())
    expect(denied.status).toBe(401)

    mockRequireAdminApi.mockResolvedValueOnce({ id: 'admin-1', role: 'admin', email: 'admin@test.com' })
    const res = await GET(adminReq('https://solarpro.test/api/admin/network/intake?debug=1&search=Austin&page=1&limit=25'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, total: 1 })
    expect(json.opportunities[0]).toMatchObject({
      intake_record_type: 'intake_event',
      opportunity_id: null,
      event_id: 'evt_homeowner_test',
      status: 'pending_review',
      utility_provider: 'Austin Energy',
      battery_interest: 'yes',
      homeowner_status: 'own',
      preferred_contact_method: 'text',
      timeline: '1_3_months',
      roof_age: '8',
      qualification_status: 'high_intent',
      lead_grade: 'A',
      finance_readiness: true,
      battery_readiness: true,
      estimated_income_band: '100k_150k',
      estimated_credit_band: '680_719',
      sunlight_confidence: 'full_sun',
      property_type: 'single_family',
      bill_metadata: { filename: 'bill.pdf', size_bytes: 71524, storage_status: 'metadata_only_not_uploaded' },
    })
    expect(json.opportunities[0].intake_metadata).toMatchObject({
      utility_provider: 'Austin Energy',
      battery_interest: 'yes',
    })
    expect(json.opportunities[0].intake_metadata.notes).toContain('Homeowner notes')
    expect(json.opportunities[0].qualification_intelligence).toMatchObject({
      qualification_status: 'high_intent',
      lead_grade: 'A',
      finance_readiness: true,
      battery_readiness: true,
    })

    const feedQuery = sql.queries.find((q: string) => q.includes('WITH opportunity_rows AS')) ?? ''
    expect(feedQuery).toContain('FROM network_opportunities no')
    expect(feedQuery).toContain('FROM intake_events ie')
    expect(feedQuery).toContain("ie.opportunity_id IS NULL")
    expect(feedQuery).toContain("ie.event_type = 'homeowner_intake'")
    expect(feedQuery).toContain("qie.event_type = 'homeowner_qualification'")
    expect(feedQuery).toContain('qie.original_event_id = ie.event_id')
    expect(feedQuery).toContain('qualification_intelligence')
    expect(feedQuery).toContain('debug_visible')
    expect(feedQuery).toContain('ready_for_review')
    expect(feedQuery).toContain('needs_missing_data')
    expect(feedQuery).toContain('qualification_skipped')
    expect(feedQuery).toContain('bill_attachment_metadata_only')
    expect(feedQuery).toContain('BETWEEN 0 AND 10000')
  })

  it('admin intake feed query uses canonical opportunity columns so event-first rows are not blocked by legacy schema names', async () => {
    const sql = makeSql()
    mockGetDbReady.mockResolvedValue(sql)
    const { GET } = await importAdminFeedRoute()

    const res = await GET(adminReq('https://solarpro.test/api/admin/network/intake?page=1&limit=25'))
    expect(res.status).toBe(200)

    const feedQuery = sql.queries.find((q: string) => q.includes('WITH opportunity_rows AS')) ?? ''
    const statsQuery = sql.queries.find((q: string) => q.includes('COUNT(*) FILTER')) ?? ''

    expect(feedQuery).toContain('no.location_city AS city')
    expect(feedQuery).toContain('no.location_state AS state')
    expect(feedQuery).toContain('COALESCE(no.location_zip, no.zip) AS zip')
    expect(feedQuery).toContain('no.duplicate_flag AS is_duplicate')
    expect(feedQuery).toContain('no.duplicate_flag AS is_duplicate_flagged')
    expect(feedQuery).toContain('no.utility_provider AS utility_name')
    expect(feedQuery).toContain('no.utility_rate_per_kwh AS electricity_rate_kwh')
    expect(feedQuery).not.toContain('no.city,')
    expect(feedQuery).not.toContain('no.state,')
    expect(feedQuery).not.toContain('no.is_duplicate_flagged')
    expect(feedQuery).not.toContain('no.utility_name')
    expect(statsQuery).toContain('no.duplicate_flag AS is_duplicate_flagged')
    expect(statsQuery).not.toContain('no.is_duplicate_flagged')
  })

  it('returns stage-aware admin intake feed diagnostics for deployed schema errors', async () => {
    const err = new Error('column no.city does not exist') as Error & { code?: string; column?: string; detail?: string }
    err.code = '42703'
    err.column = 'city'
    err.detail = 'Missing deployed column'
    mockGetDbReady.mockResolvedValue(makeSql({ failOn: 'WITH opportunity_rows AS', failError: err }))

    const { GET } = await importAdminFeedRoute()
    const res = await GET(adminReq('https://solarpro.test/api/admin/network/intake?page=1&limit=25'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toMatchObject({
      success: false,
      error: 'Intake Feed failed',
      stage: 'feed_query',
      code: '42703',
      message: 'column no.city does not exist',
      details: { column: 'city', detail: 'Missing deployed column' },
    })
    expect(JSON.stringify(json)).not.toMatch(/DATABASE_URL|JWT_SECRET|ghp_/)
  })

  it('admin Intake Feed UI surfaces API errors instead of silently rendering an empty feed', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    const section = source.slice(source.indexOf('function IntakeFeedSection()'), source.indexOf('// ── Enrichment Queue Section'))
    expect(section).toContain('const [error, setError] = useState<string | null>(null)')
    expect(section).toContain('if (!res.ok || !data.success)')
    expect(section).toContain('Intake Feed API error')
    expect(section).toContain('Unable to load Intake Feed. See the API error above.')
    expect(section).toContain('!loading && !error && leads.length === 0')
  })

  it('admin Intake Feed UI renders submitted form payload details instead of only sparse summary columns', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    const section = source.slice(source.indexOf('function IntakeFeedSection()'), source.indexOf('// ── Enrichment Queue Section'))
    expect(section).toContain('Submitted form payload')
    expect(section).toContain('formDetailsFor')
    expect(section).toContain("['Utility Provider', lead.utility_provider")
    expect(section).toContain("['Battery Interest', lead.battery_interest")
    expect(section).toContain("['Homeowner Status', lead.homeowner_status")
    expect(section).toContain("['Preferred Contact', lead.preferred_contact_method")
    expect(section).toContain("['Timeline', lead.timeline")
    expect(section).toContain("['Roof Age Years', lead.roof_age")
    expect(section).toContain('Operational Notes')
    expect(section).toContain("metadataText(lead, 'notes')")
    expect(section).toContain('bill_metadata')
    expect(section).toContain('Average Monthly Bill')
    expect(section).toContain('Utility Bill Evidence')
    expect(section).toContain('Metadata only — file was not uploaded/stored')
    expect(section).toContain('Stored attachment available')
    expect(section).toContain('Open Bill')
    expect(section).toContain('Download Bill')
    expect(section).toContain('No retrievable bill file is available for this intake')
    expect(section).toContain('BLOB_READ_WRITE_TOKEN')
    expect(section).toContain('future bill uploads create Open Bill / Download Bill links')
    expect(section).toContain('Utility Bill File Size Bytes')
    expect(section).not.toContain("['Bill Size'")
  })

  it('admin Intake Feed UI exposes operator workflow controls without bypassing immutable review events', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    const section = source.slice(source.indexOf('function IntakeFeedSection()'), source.indexOf('// ── Enrichment Queue Section'))
    expect(section).toContain('Operator workflow controls')
    expect(section).toContain('mark_contacted')
    expect(section).toContain('mark_no_answer')
    expect(section).toContain('mark_needs_follow_up')
    expect(section).toContain('mark_financing_ready')
    expect(section).toContain('mark_qualified')
    expect(section).toContain('approve_for_marketplace')
    expect(section).toContain('reject_lead')
    expect(section).toContain('archive_lead')
    expect(section).toContain("fetch('/api/admin/network/intake'")
  })

  it('admin Intake Feed UI labels event review relationship and readiness signals', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/network/page.tsx'), 'utf8')
    const section = source.slice(source.indexOf('function IntakeFeedSection()'), source.indexOf('// ── Enrichment Queue Section'))
    expect(section).toContain('Intake Event ID')
    expect(section).toContain('Event Type')
    expect(section).toContain('Review Status')
    expect(section).toContain('Opportunity ID')
    expect(section).toContain('Not converted')
    expect(section).toContain('Ready for Review')
    expect(section).toContain('Needs Missing Data')
    expect(section).toContain('Qualification Skipped')
    expect(section).toContain('Bill Attachment Metadata Only')
    expect(section).toContain('Validation Warning')
  })
})
