/**
 * /api/admin/network/screening
 *
 * Screening queue management for the Admin Control Center.
 *
 * GET  /api/admin/network/screening  — list screening queue
 * POST /api/admin/network/screening  — trigger screening for an opportunity
 * PATCH /api/admin/network/screening — override screening decision
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { runScreeningPipeline } from '@/lib/network/screeningPipeline'
import { logNetworkEvent } from '@/lib/network/attributionTracker'

// ── GET: Screening queue ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const { searchParams } = new URL(req.url)
    const pipelineStatus = searchParams.get('status')   // pending | running | completed | failed
    const autoDecision   = searchParams.get('decision') // pass | fail | needs_review
    const page  = parseInt(searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '25'), 100)
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        osq.*,
        no.homeowner_first_name,
        no.homeowner_last_name,
        no.homeowner_phone,
        no.address,
        no.city,
        no.state,
        no.source_type,
        no.status AS opportunity_status,
        no.created_at AS opportunity_created_at
      FROM opportunity_screening_queue osq
      JOIN network_opportunities no ON no.id = osq.opportunity_id
      WHERE
        (${pipelineStatus ?? null} IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ''})
        AND (${autoDecision ?? null} IS NULL OR osq.auto_decision = ${autoDecision ?? ''})
      ORDER BY osq.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const countRows = await sql`
      SELECT COUNT(*)::int as total
      FROM opportunity_screening_queue osq
      WHERE
        (${pipelineStatus ?? null} IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ''})
        AND (${autoDecision ?? null} IS NULL OR osq.auto_decision = ${autoDecision ?? ''})
    `
    const countResult = countRows[0] as Record<string, unknown>

    const statsRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE pipeline_status = 'pending')      AS pending,
        COUNT(*) FILTER (WHERE pipeline_status = 'running')      AS running,
        COUNT(*) FILTER (WHERE pipeline_status = 'completed')    AS completed,
        COUNT(*) FILTER (WHERE pipeline_status = 'failed')       AS failed,
        COUNT(*) FILTER (WHERE auto_decision = 'pass')           AS auto_passed,
        COUNT(*) FILTER (WHERE auto_decision = 'fail')           AS auto_failed,
        COUNT(*) FILTER (WHERE auto_decision = 'needs_review')   AS needs_review,
        COUNT(*) FILTER (WHERE override_decision IS NOT NULL)    AS overridden,
        AVG(duration_ms)                                         AS avg_duration_ms
      FROM opportunity_screening_queue
    `
    const stats = statsRows[0] as Record<string, unknown>

    return NextResponse.json({
      success: true,
      queue: rows,
      pagination: {
        page,
        limit,
        total: countResult.total,
        pages: Math.ceil((countResult.total as number) / limit),
      },
      stats,
    })
  } catch (error) {
    console.error('[GET /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST: Trigger screening ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { opportunity_id } = body

    if (!opportunity_id) {
      return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 })
    }

    // Run the pipeline
    const result = await runScreeningPipeline(opportunity_id)

    await logNetworkEvent({
      event_type: 'opportunity.screening_started',
      event_category: 'opportunity',
      opportunity_id,
      admin_user_id: admin.id,
      data: { triggered_by_admin: true, decision: result.auto_decision },
      triggered_by: 'admin',
    })

    return NextResponse.json({
      success: true,
      result: {
        opportunity_id: result.opportunity_id,
        decision: result.auto_decision,
        decision_reason: result.auto_decision_reason,
        confidence: result.confidence_score,
        duration_ms: result.duration_ms,
        fail_reasons: result.fail_reasons,
        review_flags: result.review_flags,
      },
    })
  } catch (error) {
    console.error('[POST /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH: Override screening decision ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const body = await req.json()
    const { opportunity_id, decision, reason } = body as {
      opportunity_id: string
      decision: 'pass' | 'fail' | 'hold'
      reason: string
    }

    if (!opportunity_id || !decision) {
      return NextResponse.json({ error: 'opportunity_id and decision are required' }, { status: 400 })
    }

    // Update screening queue
    await sql`
      UPDATE opportunity_screening_queue SET
        override_decision = ${decision},
        override_by       = ${admin.id},
        override_reason   = ${reason ?? null},
        override_at       = NOW(),
        updated_at        = NOW()
      WHERE opportunity_id = ${opportunity_id}
    `

    // Update opportunity status based on override
    const newStatus = decision === 'pass' ? 'scored' :
                      decision === 'fail' ? 'rejected' : 'screening'

    await sql`
      UPDATE network_opportunities SET status = ${newStatus}, updated_at = NOW()
      WHERE id = ${opportunity_id}
    `

    await logNetworkEvent({
      event_type: 'screening.override',
      event_category: 'screening',
      opportunity_id,
      admin_user_id: admin.id,
      data: { decision, reason, new_status: newStatus },
      to_status: newStatus,
      triggered_by: 'admin',
    })

    return NextResponse.json({ success: true, decision, new_status: newStatus })
  } catch (error) {
    console.error('[PATCH /api/admin/network/screening]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
