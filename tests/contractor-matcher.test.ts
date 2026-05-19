import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSql = vi.fn()
const mockNeon = vi.fn(() => mockSql)

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }))

async function importMatcher() {
  return import('@/lib/network/contractorMatcher')
}

describe('contractorMatcher canonical opportunity fields', () => {
  beforeEach(() => {
    vi.resetModules()
    mockSql.mockReset()
    mockNeon.mockClear()
    process.env.DATABASE_URL = 'postgres://test/test'
  })

  it('matches contractors using canonical location, battery, and system size columns', async () => {
    const queries: string[] = []
    mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = strings.join(' ')
      queries.push(q)
      if (q.includes('FROM network_opportunities')) {
        return [{ id: 'opp-1', state: 'TX', battery_interest: true, structure_type: 'single_family', opportunity_score: 88, estimated_system_size_kw: 8 }]
      }
      if (q.includes('FROM contractor_profiles')) {
        return [{ user_id: 'contractor-1', company_name: 'Texas Solar', service_states: ['TX'], min_system_size_kw: 3, max_system_size_kw: 15, services_offered: ['residential_solar', 'battery_storage'], avg_close_rate: 0.6, avg_response_hours: 2, avg_rating: 4.8, total_claims: 10, active_claims: 1, max_active_claims: 5, is_active: true, is_verified: true, tier: 'preferred' }]
      }
      if (q.includes('INSERT INTO opportunity_intelligence')) return []
      return []
    })

    const { matchContractors } = await importMatcher()
    const result = await matchContractors('opp-1', { limit: 10, minScore: 30 })

    expect(result.total_eligible).toBe(1)
    expect(result.matches[0]).toMatchObject({ contractor_id: 'contractor-1', geo_score: 100 })
    const opportunityQuery = queries.find(q => q.includes('FROM network_opportunities')) ?? ''
    expect(opportunityQuery).toContain('UPPER(location_state) AS state')
    expect(opportunityQuery).toContain('battery_candidate AS battery_interest')
    expect(opportunityQuery).toContain('estimated_system_size_kw')
    expect(opportunityQuery).not.toContain('scoring_data')
  })

  it('eligibility checks use canonical location_state', async () => {
    const queries: string[] = []
    mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const q = strings.join(' ')
      queries.push(q)
      if (q.includes('FROM contractor_profiles')) return [{ service_states: ['CA'], is_active: true }]
      if (q.includes('FROM network_opportunities')) return [{ state: 'CA' }]
      return []
    })

    const { isContractorEligible } = await importMatcher()
    await expect(isContractorEligible('contractor-1', 'opp-1')).resolves.toEqual({ eligible: true })
    const opportunityQuery = queries.find(q => q.includes('FROM network_opportunities')) ?? ''
    expect(opportunityQuery).toContain('UPPER(location_state) AS state')
  })
})
