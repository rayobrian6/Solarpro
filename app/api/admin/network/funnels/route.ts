/**
 * /api/admin/network/funnels/route.ts
 *
 * Admin API — Intake Funnels operational listing.
 * Reuses canonical intake_funnels + acquisition_campaigns infrastructure.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { buildFunnelUrls, canonicalFunnelPath, normalizeBaseUrl } from '@/lib/intake/funnelUrls'

interface FunnelRow {
  id: string
  slug: string
  name: string
  description: string | null
  funnel_type: string
  source_channel: string
  is_active: boolean
  require_phone: boolean
  require_address: boolean
  require_monthly_bill: boolean
  require_roof_type: boolean
  campaign_id: string | null
  thank_you_url: string | null
  webhook_notify_url: string | null
  custom_fields: unknown
  validation_rules: unknown
  rate_limit_per_hour: number | null
  created_at: string | null
  updated_at: string | null
  campaign_count: string | number | null
  active_campaign_count: string | number | null
  campaign_names: string[] | null
  campaign_utm_source: string | null
  campaign_utm_medium: string | null
  campaign_utm_campaign: string | null
  recent_intake_count: string | number | null
}

function publicPathForFunnel(slug: string, customFields: unknown): string | null {
  if (customFields && typeof customFields === 'object' && 'canonical_path' in customFields) {
    const path = (customFields as { canonical_path?: unknown }).canonical_path
    if (typeof path === 'string') return canonicalFunnelPath(slug, path)
  }

  return canonicalFunnelPath(slug)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = await getDbReady()
  const { searchParams } = new URL(req.url)
  const includeInactive = searchParams.get('include_inactive') === 'true'
  const baseUrl = normalizeBaseUrl(searchParams.get('base_url'))

  try {
    const rows = await sql`
      SELECT
        inf.id,
        inf.slug,
        inf.name,
        inf.description,
        inf.funnel_type,
        inf.source_channel,
        inf.is_active,
        inf.require_phone,
        inf.require_address,
        inf.require_monthly_bill,
        inf.require_roof_type,
        inf.campaign_id,
        inf.thank_you_url,
        inf.webhook_notify_url,
        inf.custom_fields,
        inf.validation_rules,
        inf.rate_limit_per_hour,
        inf.created_at,
        inf.updated_at,
        COUNT(ac.id) AS campaign_count,
        COUNT(ac.id) FILTER (WHERE ac.status = 'active') AS active_campaign_count,
        COALESCE(ARRAY_REMOVE(ARRAY_AGG(ac.name ORDER BY ac.created_at DESC), NULL), ARRAY[]::TEXT[]) AS campaign_names,
        (ARRAY_REMOVE(ARRAY_AGG(ac.utm_source ORDER BY CASE WHEN ac.status = 'active' THEN 0 ELSE 1 END, ac.updated_at DESC), NULL))[1] AS campaign_utm_source,
        (ARRAY_REMOVE(ARRAY_AGG(ac.utm_medium ORDER BY CASE WHEN ac.status = 'active' THEN 0 ELSE 1 END, ac.updated_at DESC), NULL))[1] AS campaign_utm_medium,
        (ARRAY_REMOVE(ARRAY_AGG(ac.utm_campaign ORDER BY CASE WHEN ac.status = 'active' THEN 0 ELSE 1 END, ac.updated_at DESC), NULL))[1] AS campaign_utm_campaign,
        (
          SELECT COUNT(*)
          FROM intake_events ie
          WHERE ie.funnel_id = inf.id
            AND ie.occurred_at >= NOW() - INTERVAL '30 days'
        ) AS recent_intake_count
      FROM intake_funnels inf
      LEFT JOIN acquisition_campaigns ac ON ac.funnel_id = inf.id AND ac.status <> 'archived'
      WHERE (${includeInactive} = true OR inf.is_active = true)
      GROUP BY inf.id
      ORDER BY inf.is_active DESC, inf.created_at DESC, inf.name ASC
    `

    const funnels = (rows as FunnelRow[]).map(row => {
      const canonicalPath = publicPathForFunnel(row.slug, row.custom_fields)
      const urls = buildFunnelUrls({
        slug: row.slug,
        canonical_path: canonicalPath,
        utm_source: row.campaign_utm_source || row.source_channel || null,
        utm_medium: row.campaign_utm_medium || null,
        utm_campaign: row.campaign_utm_campaign || row.slug,
      }, baseUrl)

      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        funnel_type: row.funnel_type,
        source_channel: row.source_channel,
        status: row.is_active ? 'active' : 'inactive',
        is_active: row.is_active,
        canonical_path: canonicalPath,
        canonicalPath,
        canonical_url: urls.canonicalUrl || null,
        canonicalUrl: urls.canonicalUrl || null,
        embed_url: urls.embedUrl,
        embedUrl: urls.embedUrl,
        utm_ready_url: urls.utmReadyUrl || null,
        utmReadyUrl: urls.utmReadyUrl || null,
        require_phone: row.require_phone,
        require_address: row.require_address,
        require_monthly_bill: row.require_monthly_bill,
        require_roof_type: row.require_roof_type,
        campaign_id: row.campaign_id,
        campaign_count: Number(row.campaign_count ?? 0),
        active_campaign_count: Number(row.active_campaign_count ?? 0),
        campaign_names: row.campaign_names ?? [],
        default_utm: {
          utm_source: row.campaign_utm_source || row.source_channel || '',
          utm_medium: row.campaign_utm_medium || '',
          utm_campaign: row.campaign_utm_campaign || row.slug,
        },
        source_campaign_support: Boolean(row.campaign_id || Number(row.campaign_count ?? 0) > 0),
        recent_intake_count: Number(row.recent_intake_count ?? 0),
        rate_limit_per_hour: row.rate_limit_per_hour,
        thank_you_url: row.thank_you_url,
        webhook_notify_url: row.webhook_notify_url,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    })

    return NextResponse.json({ success: true, funnels, base_url: baseUrl })
  } catch (err) {
    console.error('[GET /api/admin/network/funnels]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
