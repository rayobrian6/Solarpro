/**
 * /api/admin/network/health
 *
 * Marketplace Health Metrics for the Admin Control Center.
 * Returns a snapshot of the overall marketplace health.
 *
 * GET /api/admin/network/health
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    // ── Opportunity Pipeline Health ─────────────────────────────────────────
    const pipelineRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'intake')      AS intake_queue,
        COUNT(*) FILTER (WHERE status = 'screening')   AS screening_queue,
        COUNT(*) FILTER (WHERE status = 'scored')      AS scored_queue,
        COUNT(*) FILTER (WHERE status = 'live')        AS live_count,
        COUNT(*) FILTER (WHERE status = 'claimed')     AS claimed_count,
        COUNT(*) FILTER (WHERE status = 'rejected')    AS rejected_count,
        COUNT(*) FILTER (WHERE status = 'live'
          AND expires_at < NOW() + INTERVAL '3 days')  AS expiring_soon,
        COUNT(*) FILTER (WHERE status = 'live'
          AND claim_count = 0
          AND live_at < NOW() - INTERVAL '48 hours') AS stale_unclaimed,
        AVG(opportunity_score) FILTER (
          WHERE status = 'live' AND opportunity_score IS NOT NULL
        )                                              AS avg_live_score
      FROM network_opportunities
    `
    const pipelineHealth = pipelineRows[0] as Record<string, unknown>

    // ── Contractor Network Health ───────────────────────────────────────────
    const contractorRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE is_active = true)                AS active_contractors,
        COUNT(*) FILTER (WHERE is_active = false)               AS inactive_contractors,
        COUNT(*) FILTER (WHERE is_verified = true)              AS verified_contractors,
        COUNT(*) FILTER (WHERE tier = 'elite')                  AS elite_contractors,
        COUNT(*) FILTER (WHERE tier = 'preferred')              AS preferred_contractors,
        AVG(avg_rating) FILTER (WHERE avg_rating IS NOT NULL)   AS avg_rating,
        AVG(avg_close_rate) FILTER (WHERE avg_close_rate IS NOT NULL) AS avg_close_rate,
        COUNT(*) FILTER (
          WHERE is_active = true AND array_length(service_states, 1) > 0
        )                                                       AS contractors_with_states
      FROM contractor_profiles
    `
    const contractorHealth = contractorRows[0] as Record<string, unknown>

    // ── Screening Health ────────────────────────────────────────────────────
    const screeningRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE pipeline_status = 'pending')     AS pending_screening,
        COUNT(*) FILTER (WHERE pipeline_status = 'running')     AS running_screening,
        COUNT(*) FILTER (WHERE pipeline_status = 'failed')      AS failed_screening,
        COUNT(*) FILTER (WHERE auto_decision = 'pass'
          AND created_at > NOW() - INTERVAL '7 days')           AS passed_last_7d,
        COUNT(*) FILTER (WHERE auto_decision = 'fail'
          AND created_at > NOW() - INTERVAL '7 days')           AS failed_last_7d,
        COUNT(*) FILTER (WHERE auto_decision = 'needs_review'
          AND override_decision IS NULL)                        AS pending_review,
        AVG(duration_ms) FILTER (
          WHERE pipeline_status = 'completed'
          AND created_at > NOW() - INTERVAL '24 hours'
        )                                                       AS avg_screening_ms_24h,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE auto_decision = 'pass')
          / NULLIF(COUNT(*) FILTER (WHERE pipeline_status = 'completed'), 0)
        , 1)                                                    AS pass_rate_pct
      FROM opportunity_screening_queue
    `
    const screeningHealth = screeningRows[0] as Record<string, unknown>

    // ── Assignment / Claims Health ──────────────────────────────────────────
    const claimsRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'offered')              AS open_offers,
        COUNT(*) FILTER (WHERE status = 'offered'
          AND offer_expires_at < NOW() + INTERVAL '24 hours')   AS offers_expiring_24h,
        COUNT(*) FILTER (WHERE status = 'claimed'
          AND claimed_at > NOW() - INTERVAL '24 hours')         AS claims_last_24h,
        COUNT(*) FILTER (WHERE status = 'claimed'
          AND claimed_at > NOW() - INTERVAL '7 days')           AS claims_last_7d,
        COUNT(*) FILTER (WHERE status = 'won')                  AS total_won,
        COUNT(*) FILTER (WHERE status IN ('disputed'))          AS open_disputes,
        COUNT(*) FILTER (WHERE status = 'refunded'
          AND refund_at > NOW() - INTERVAL '30 days')           AS refunds_30d,
        AVG(EXTRACT(EPOCH FROM (claimed_at - offered_at)) / 3600)
          FILTER (WHERE claimed_at IS NOT NULL)                 AS avg_hours_to_claim
      FROM opportunity_assignments
    `
    const claimsHealth = claimsRows[0] as Record<string, unknown>

    // ── Event Log Health (errors in last hour) ──────────────────────────────
    const eventRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '1 hour') AS events_last_hour,
        COUNT(*) FILTER (WHERE is_error = true
          AND occurred_at > NOW() - INTERVAL '1 hour')         AS errors_last_hour,
        COUNT(*) FILTER (WHERE is_error = true
          AND occurred_at > NOW() - INTERVAL '24 hours')       AS errors_last_24h,
        MAX(occurred_at)                                        AS last_event_at
      FROM network_events
    `
    const eventHealth = eventRows[0] as Record<string, unknown>

    // ── Recent Events Feed ──────────────────────────────────────────────────
    const recentEvents = await sql`
      SELECT
        ne.event_type,
        ne.event_category,
        ne.occurred_at,
        ne.triggered_by,
        ne.is_error,
        no.first_name AS homeowner_first_name,
        no.last_name  AS homeowner_last_name,
        no.location_state AS state,
        no.opportunity_grade
      FROM network_events ne
      LEFT JOIN network_opportunities no ON no.id = ne.opportunity_id
      ORDER BY ne.occurred_at DESC
      LIMIT 20
    `

    // ── Compute overall health score ────────────────────────────────────────
    let healthScore = 100
    const healthIssues: string[] = []
    const healthWarnings: string[] = []

    const intakeQ          = parseInt(pipelineHealth.intake_queue as string)     || 0
    const pendingScreening = parseInt(screeningHealth.pending_screening as string) || 0
    const pendingReview    = parseInt(screeningHealth.pending_review as string)    || 0
    const failedScreening  = parseInt(screeningHealth.failed_screening as string)  || 0
    const openDisputes     = parseInt(claimsHealth.open_disputes as string)        || 0
    const errorsLastHour   = parseInt(eventHealth.errors_last_hour as string)      || 0
    const staleUnclaimed   = parseInt(pipelineHealth.stale_unclaimed as string)    || 0

    if (intakeQ > 50)          { healthScore -= 10; healthWarnings.push(`${intakeQ} leads stuck in intake`) }
    if (pendingScreening > 20) { healthScore -= 5;  healthWarnings.push(`${pendingScreening} leads pending screening`) }
    if (pendingReview > 10)    { healthScore -= 8;  healthWarnings.push(`${pendingReview} leads need manual review`) }
    if (failedScreening > 5)   { healthScore -= 5;  healthWarnings.push(`${failedScreening} screening failures`) }
    if (openDisputes > 0)      { healthScore -= openDisputes * 3; healthIssues.push(`${openDisputes} open disputes`) }
    if (errorsLastHour > 5)    { healthScore -= 15; healthIssues.push(`${errorsLastHour} system errors in last hour`) }
    if (staleUnclaimed > 10)   { healthScore -= 8;  healthWarnings.push(`${staleUnclaimed} stale unclaimed leads`) }

    healthScore = Math.max(0, Math.min(100, healthScore))
    const healthStatus = healthScore >= 90 ? 'excellent' :
                         healthScore >= 75 ? 'good' :
                         healthScore >= 60 ? 'degraded' : 'critical'

    return NextResponse.json({
      success: true,
      health: {
        score: healthScore,
        status: healthStatus,
        issues: healthIssues,
        warnings: healthWarnings,
      },
      pipeline: pipelineHealth,
      contractors: contractorHealth,
      screening: screeningHealth,
      claims: claimsHealth,
      events: eventHealth,
      recent_events: recentEvents,
      computed_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[GET /api/admin/network/health]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
