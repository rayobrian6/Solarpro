import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

const routeSource = read('app/api/admin/network/funnels/route.ts')
const adminPageSource = read('app/admin/network/page.tsx')
const migrationSource = read('lib/migrations/071_canonical_homeowner_intake_funnel.sql')
const homeownerPageSource = read('app/free-solar-estimate/page.tsx')

describe('admin intake funnels infrastructure', () => {
  it('guards the admin funnels API with existing admin auth', () => {
    expect(routeSource).toContain("import { requireAdminApi } from '@/lib/adminAuth'")
    expect(routeSource).toContain('const admin = await requireAdminApi(req)')
    expect(routeSource).toContain("NextResponse.json({ error: 'Unauthorized' }, { status: 401 })")
  })

  it('lists canonical funnels using existing intake, campaign, and event infrastructure', () => {
    expect(routeSource).toContain('FROM intake_funnels inf')
    expect(routeSource).toContain('LEFT JOIN acquisition_campaigns ac')
    expect(routeSource).toContain('FROM intake_events ie')
    expect(routeSource).toContain('recent_intake_count')
    expect(routeSource).toContain('campaign_names')
    expect(routeSource).toContain('default_utm')
    expect(routeSource).not.toMatch(/CREATE\s+TABLE/i)
    expect(routeSource).not.toContain('INSERT INTO network_opportunities')
  })

  it('aligns the public homeowner slug, canonical path, and existing intake funnel seed', () => {
    expect(homeownerPageSource).toContain("funnel_slug: 'free-solar-estimate'")
    expect(migrationSource).toContain("'free-solar-estimate'")
    expect(migrationSource).toContain("'Canonical Homeowner Intake'")
    expect(migrationSource).toContain('"canonical_path":"/free-solar-estimate"')
    expect(migrationSource).toContain('INSERT INTO intake_funnels')
    expect(migrationSource).toContain('ON CONFLICT (slug) DO UPDATE')
    expect(migrationSource).not.toMatch(/CREATE\s+TABLE/i)
  })




  it('keeps migration 071 compatible with the admin SQL splitter', () => {
    const statements = migrationSource
      .split(';')
      .map((statement) => statement.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
      .filter(Boolean)

    expect(statements.some((statement) => /^does\b/i.test(statement))).toBe(false)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('INSERT INTO intake_funnels')
    expect(statements[0]).toContain('ON CONFLICT (slug) DO UPDATE')
  })

  it('returns camelCase URL fields for the canonical homeowner funnel API contract', () => {
    expect(routeSource).toContain('canonicalPath')
    expect(routeSource).toContain('canonicalUrl: urls.canonicalUrl || null')
    expect(routeSource).toContain('embedUrl: urls.embedUrl')
    expect(routeSource).toContain('utmReadyUrl: urls.utmReadyUrl || null')
    expect(routeSource).toContain('canonical_url: urls.canonicalUrl || null')
    expect(routeSource).toContain('utm_ready_url: urls.utmReadyUrl || null')
  })

  it('enables Open/Copy/UTM funnel actions from canonicalUrl without requiring campaigns or events', () => {
    expect(adminPageSource).toContain('const canonicalUrl = funnel.canonicalUrl || funnel.canonical_url || null')
    expect(adminPageSource).toContain('const generatedUtmUrl = canonicalUrl ? appendClientUtm(canonicalUrl, utm) : null')
    expect(adminPageSource).toContain('const hasPublicUrl = Boolean(canonicalUrl)')
    expect(adminPageSource).toContain("href={canonicalUrl || '#'}")
    expect(adminPageSource).toContain('disabled={!canonicalUrl}')
    expect(adminPageSource).not.toContain('disabled={!funnel.source_campaign_support')
    expect(adminPageSource).not.toContain('disabled={!funnel.campaign_id')
    expect(adminPageSource).not.toContain('disabled={!funnel.recent_intake_count')
    expect(adminPageSource).not.toContain('disabled={funnel.recent_intake_count')
  })

  it('surfaces an operational Intake Funnels tab with required copy/open actions', () => {
    expect(adminPageSource).toContain("{ id: 'funnels'")
    expect(adminPageSource).toContain("{activeTab === 'funnels' && <IntakeFunnelsSection />}")
    expect(adminPageSource).toContain("fetch('/api/admin/network/funnels?include_inactive=true'")
    expect(adminPageSource).toContain('Operational Funnel Infrastructure')
    expect(adminPageSource).toContain('Open Funnel')
    expect(adminPageSource).toContain('Copy Link')
    expect(adminPageSource).toContain('Copy Embed URL')
    expect(adminPageSource).toContain('Copy UTM-ready URL')
    expect(adminPageSource).toContain('Campaign metadata')
    expect(adminPageSource).toContain('navigator.clipboard.writeText')
  })

  it('generates attribution params in the admin UI without bypassing canonical intake routes', () => {
    expect(adminPageSource).toContain("params.set('utm_source'")
    expect(adminPageSource).toContain("params.set('utm_medium'")
    expect(adminPageSource).toContain("params.set('utm_campaign'")
    expect(adminPageSource).not.toContain('/api/network/opportunities')
    expect(adminPageSource).not.toContain('INSERT INTO intake_funnels')
  })
})
