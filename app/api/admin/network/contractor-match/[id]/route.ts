/**
 * /api/admin/network/contractor-match/[id]
 *
 * Contractor matching for a specific opportunity.
 *
 * GET  /api/admin/network/contractor-match/[id]  — get match results
 * POST /api/admin/network/contractor-match/[id]  — run/re-run matching
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getDbReady } from '@/lib/db-neon'
import { requireAdminApi } from '@/lib/adminAuth'
import { matchContractors } from '@/lib/network/contractorMatcher'
import { logNetworkEvent } from '@/lib/network/attributionTracker'

type Params = { params: { id: string } }

// ── GET: Retrieve existing match results ─────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const { id } = params
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10'), 25)

    // Get opportunity
    const oppRows = await sql`
      SELECT id, state, source_type, status, opportunity_score, opportunity_grade,
             homeowner_first_name, homeowner_last_name, address, city
      FROM network_opportunities WHERE id = ${id} LIMIT 1
    `
    const opp = oppRows[0] as Record<string, unknown> | undefined
    if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    // Get stored intelligence
    const intelRows = await sql`
      SELECT total_eligible_contractors, top_match_contractor_id, top_match_score,
             match_summary, scored_at
      FROM opportunity_intelligence WHERE opportunity_id = ${id} LIMIT 1
    `
    const intel = (intelRows[0] as Record<string, unknown> | undefined) ?? null

    // Get existing assignments
    const assignments = await sql`
      SELECT
        oa.*,
        cp.company_name,
        cp.avg_rating,
        cp.tier
      FROM opportunity_assignments oa
      JOIN contractor_profiles cp ON cp.user_id = oa.contractor_id
      WHERE oa.opportunity_id = ${id}
      ORDER BY oa.match_score DESC NULLS LAST
      LIMIT ${limit}
    `

    return NextResponse.json({
      success: true,
      opportunity: opp,
      intelligence: intel,
      assignments,
    })
  } catch (error) {
    console.error('[GET /api/admin/network/contractor-match/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST: Run matching ───────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminApi(req)
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sql = await getDbReady()

    const { id } = params
    const body = await req.json().catch(() => ({}))
    const { limit = 10, min_score = 30, create_assignments = false } = body

    // Run matching engine
    const result = await matchContractors(id, { limit, minScore: min_score })

    // Optionally create assignment records for top matches
    if (create_assignments && result.matches.length > 0) {
      for (let i = 0; i < Math.min(result.matches.length, 5); i++) {
        const match = result.matches[i]
        await sql`
          INSERT INTO opportunity_assignments (
            opportunity_id, contractor_id, status,
            assignment_rank, match_score, match_factors,
            offered_at, offer_expires_at
          ) VALUES (
            ${id}, ${match.contractor_id}, 'offered',
            ${i + 1}, ${match.overall_score},
            ${JSON.stringify({
              geo_score: match.geo_score,
              size_fit_score: match.size_fit_score,
              service_score: match.service_score,
              performance_score: match.performance_score,
              capacity_score: match.capacity_score,
              reasons: match.match_reasons,
            })},
            NOW(), NOW() + INTERVAL '72 hours'
          )
          ON CONFLICT DO NOTHING
        `
      }

      await logNetworkEvent({
        event_type: 'assignment.offered',
        event_category: 'assignment',
        opportunity_id: id,
        admin_user_id: admin.id,
        data: {
          total_eligible: result.total_eligible,
          assignments_created: Math.min(result.matches.length, 5),
        },
        triggered_by: 'admin',
      })
    }

    return NextResponse.json({
      success: true,
      opportunity_id: id,
      total_eligible: result.total_eligible,
      top_match: result.top_match,
      matches: result.matches,
      assignments_created: create_assignments ? Math.min(result.matches.length, 5) : 0,
    })
  } catch (error) {
    console.error('[POST /api/admin/network/contractor-match/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
