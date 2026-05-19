import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

const routeSource = readFileSync('app/api/admin/network/screening/route.ts', 'utf8')

describe('/api/admin/network/screening enrichment projection', () => {
  it('surfaces the canonical opportunity_intelligence enrichment fields in the screening queue GET', () => {
    expect(routeSource).toContain('LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = osq.opportunity_id')
    expect(routeSource).toContain('oi.enrichment_payload')
    expect(routeSource).toContain('oi.enrichment_completeness')
    expect(routeSource).toContain('oi.enrichment_warnings')
    expect(routeSource).toContain('oi.enriched_at')
  })

  it('does not create duplicate enrichment infrastructure in the route', () => {
    expect(routeSource).not.toContain('CREATE TABLE')
    expect(routeSource).not.toContain('opportunity_enrichment')
    expect(routeSource).not.toContain('enrichment_jobs')
  })
})
