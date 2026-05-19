/**
 * /api/admin/network/analytics
 *
 * Campaign intelligence and performance analytics.
 *
 * GET /api/admin/network/analytics — returns multi-section analytics data
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { getCampaignPerformance } from '@/lib/network/attributionTracker'

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const { searchParams } = new URL(req.url)
    const days    = parseInt(searchParams.get('days') ?? '30')
    const section = searchParams.get('section') ?? 'all'
    // section: all | funnel | sources | campaigns | geography | quality | trend

    const results: Record<string, unknown> = {}

    // ── Funnel Overview ──────────────────────────────────────────────────────
    if (section === 'all' || section === 'funnel') {
      const funnelRows = await sql`
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE status != 'intake')                          AS screened,
          COUNT(*) FILTER (WHERE status NOT IN ('intake','screening','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE status IN ('live','claimed','closed_won','closed_lost')) AS published,
          COUNT(*) FILTER (WHERE status IN ('claimed','closed_won','closed_lost'))         AS claimed,
          COUNT(*) FILTER (WHERE status = 'closed_won')                        AS won,
          COUNT(*) FILTER (WHERE status = 'closed_lost')                       AS lost,
          COUNT(*) FILTER (WHERE status = 'rejected')                          AS rejected,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')     AS last_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')       AS last_7d,
          AVG(opportunity_score) FILTER (WHERE opportunity_score IS NOT NULL)  AS avg_score,
          COUNT(*) FILTER (WHERE opportunity_grade IN ('A+','A'))               AS a_grade_count,
          COUNT(*) FILTER (WHERE opportunity_grade = 'B')                      AS b_grade_count,
          COUNT(*) FILTER (WHERE opportunity_grade = 'C')                      AS c_grade_count
        FROM network_opportunities
        WHERE created_at > NOW() - (${days} || ' days')::INTERVAL
      `
      const funnel = funnelRows[0] as Record<string, unknown>

      // Conversion rates
      const total     = parseInt(funnel.total_leads as string) || 1
      const qualified = parseInt(funnel.qualified  as string) || 0
      const published = parseInt(funnel.published  as string) || 0
      const claimed   = parseInt(funnel.claimed    as string) || 0
      const won       = parseInt(funnel.won        as string) || 0

      results.funnel = {
        ...funnel,
        screen_rate:  ((parseInt(funnel.screened as string) || 0) / total).toFixed(3),
        qualify_rate: (qualified / total).toFixed(3),
        publish_rate: (published / Math.max(qualified, 1)).toFixed(3),
        claim_rate:   (claimed / Math.max(published, 1)).toFixed(3),
        win_rate:     (won / Math.max(claimed, 1)).toFixed(3),
        overall_cvr:  (won / total).toFixed(3),
      }
    }

    // ── Source Performance ───────────────────────────────────────────────────
    if (section === 'all' || section === 'sources') {
      const sources = await sql`
        SELECT
          no.source_type,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE no.status NOT IN ('intake','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE no.status IN ('claimed','closed_won','closed_lost')) AS claimed,
          COUNT(*) FILTER (WHERE no.status = 'closed_won') AS won,
          AVG(oi.overall_score) AS avg_score,
          AVG(os.cost_per_lead) AS avg_cpl
        FROM network_opportunities no
        LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
        LEFT JOIN opportunity_sources      os ON os.opportunity_id = no.id
        WHERE no.created_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY no.source_type
        ORDER BY total DESC
      `
      results.sources = sources
    }

    // ── Campaign Attribution ─────────────────────────────────────────────────
    if (section === 'all' || section === 'campaigns') {
      const campaigns = await getCampaignPerformance({ days })
      results.campaigns = campaigns
    }

    // ── Geography ───────────────────────────────────────────────────────────
    if (section === 'all' || section === 'geography') {
      const geo = await sql`
        SELECT
          no.state,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE no.status NOT IN ('intake','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE no.status IN ('claimed','closed_won','closed_lost')) AS claimed,
          AVG(oi.overall_score) AS avg_score
        FROM network_opportunities no
        LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
        WHERE no.created_at > NOW() - (${days} || ' days')::INTERVAL
          AND no.state IS NOT NULL
        GROUP BY no.state
        ORDER BY total DESC
        LIMIT 20
      `
      results.geography = geo
    }

    // ── Lead Quality Distribution ────────────────────────────────────────────
    if (section === 'all' || section === 'quality') {
      const quality = await sql`
        SELECT
          oi.overall_grade,
          COUNT(*) AS count,
          AVG(oi.overall_score) AS avg_score,
          AVG(oi.market_price) AS avg_price,
          COUNT(*) FILTER (WHERE no.status IN ('claimed','closed_won')) AS claimed_count
        FROM opportunity_intelligence oi
        JOIN network_opportunities no ON no.id = oi.opportunity_id
        WHERE no.created_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY oi.overall_grade
        ORDER BY
          CASE oi.overall_grade
            WHEN 'A+' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3
            WHEN 'C' THEN 4 WHEN 'D' THEN 5 ELSE 6
          END
      `

      const screening = await sql`
        SELECT
          osq.auto_decision,
          COUNT(*) AS count,
          AVG(osq.confidence_score) AS avg_confidence,
          AVG(osq.duration_ms) AS avg_duration_ms,
          COUNT(*) FILTER (WHERE osq.override_decision IS NOT NULL) AS overridden
        FROM opportunity_screening_queue osq
        JOIN network_opportunities no ON no.id = osq.opportunity_id
        WHERE no.created_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY osq.auto_decision
      `

      results.quality = { grades: quality, screening }
    }

    // ── Volume Trend (daily) ─────────────────────────────────────────────────
    if (section === 'all' || section === 'trend') {
      const trend = await sql`
        SELECT
          DATE_TRUNC('day', created_at)::date AS date,
          COUNT(*) AS leads,
          COUNT(*) FILTER (WHERE status NOT IN ('intake','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE status IN ('claimed','closed_won')) AS claimed
        FROM network_opportunities
        WHERE created_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date ASC
      `
      results.trend = trend
    }

    return NextResponse.json({ success: true, days, ...results })
  } catch (error) {
    console.error('[GET /api/admin/network/analytics]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
