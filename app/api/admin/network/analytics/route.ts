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

    // 🚨 PER-SECTION ISOLATION. This handler had ONE try/catch around all six
    // sections, so the geography block's phantom `no.state` column turned a single
    // 42703 into a 500 for the whole endpoint — and the page renders a 500 as a
    // permanent "Loading analytics…". Five working SQL blocks were invisible because
    // the sixth named a column that has never existed.
    //
    // A section that fails now costs ONLY that section. The failure is REPORTED, not
    // swallowed: `sectionErrors` rides on the response so the page can say "this panel
    // is unavailable" instead of showing a spinner forever or, worse, an empty chart
    // that reads as "no data". An outage rendered as an all-clear is the defect class
    // this whole audit kept finding.
    const sectionErrors: Record<string, string> = {}
    const runSection = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch (e: unknown) {
        console.error(`[admin/network/analytics] section '${name}' failed:`, e)
        sectionErrors[name] = (e as Error)?.message ?? 'unknown error'
        return null
      }
    }

    // ── Funnel Overview ──────────────────────────────────────────────────────
    if (section === 'all' || section === 'funnel') {
      const funnelRows = await runSection('funnel', () => sql`
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
      `)
      const funnel = (funnelRows?.[0] ?? null) as Record<string, unknown> | null
      if (funnel) {

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
    }

    // ── Source Performance ───────────────────────────────────────────────────
    if (section === 'all' || section === 'sources') {
      const sources = await runSection('sources', () => sql`
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
      `)
      if (sources) results.sources = sources
    }

    // ── Campaign Attribution ─────────────────────────────────────────────────
    if (section === 'all' || section === 'campaigns') {
      const campaigns = await runSection('campaigns', () => getCampaignPerformance({ days }))
      if (campaigns) results.campaigns = campaigns
    }

    // ── Geography ───────────────────────────────────────────────────────────
    if (section === 'all' || section === 'geography') {
      // 🚨 THIS BLOCK BLACKED OUT THE WHOLE TAB. `network_opportunities` has no
      // `state` column — the canonical schema (migrations 047+054+062+072+088) calls it
      // `location_state`, and `state` exists only in the secret-gated inline DDL at
      // app/api/migrate/route.ts, which no migration file reproduces. So this SELECT
      // raised 42703, the handler's single try/catch turned it into a 500, and the
      // Campaign Intel tab sat on "Loading analytics…" indefinitely for every admin,
      // on every load — no error, no empty state. Five perfectly good SQL blocks were
      // invisible because the sixth named a column that has never existed.
      //
      // Aliased AS state so the response key stays stable for the page.
      const geo = await runSection('geography', () => sql`
        SELECT
          no.location_state AS state,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE no.status NOT IN ('intake','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE no.status IN ('claimed','closed_won','closed_lost')) AS claimed,
          AVG(oi.overall_score) AS avg_score
        FROM network_opportunities no
        LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
        WHERE no.created_at > NOW() - (${days} || ' days')::INTERVAL
          AND no.location_state IS NOT NULL
        GROUP BY no.location_state
        ORDER BY total DESC
        LIMIT 20
      `)
      if (geo) results.geography = geo
    }

    // ── Lead Quality Distribution ────────────────────────────────────────────
    if (section === 'all' || section === 'quality') {
      const quality = await runSection('quality', () => sql`
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
      `)

      const screening = await runSection('quality_screening', () => sql`
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
      `)

      // Either half may be null; report what resolved rather than dropping both.
      if (quality || screening) results.quality = { grades: quality ?? [], screening: screening ?? [] }
    }

    // ── Volume Trend (daily) ─────────────────────────────────────────────────
    if (section === 'all' || section === 'trend') {
      const trend = await runSection('trend', () => sql`
        SELECT
          DATE_TRUNC('day', created_at)::date AS date,
          COUNT(*) AS leads,
          COUNT(*) FILTER (WHERE status NOT IN ('intake','rejected')) AS qualified,
          COUNT(*) FILTER (WHERE status IN ('claimed','closed_won')) AS claimed
        FROM network_opportunities
        WHERE created_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date ASC
      `)
      if (trend) results.trend = trend
    }

    // `sectionErrors` is present only when something actually failed, so the page can
    // distinguish "this panel is unavailable" from "this panel has no data" — the
    // distinction the permanent spinner destroyed.
    return NextResponse.json({
      success: true,
      days,
      ...results,
      ...(Object.keys(sectionErrors).length ? { sectionErrors } : {}),
    })
  } catch (error) {
    console.error('[GET /api/admin/network/analytics]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
