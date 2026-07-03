/**
 * /api/admin/network/contractor-match/[id]
 *
 * Contractor matching for a specific opportunity.
 *
 * GET  /api/admin/network/contractor-match/[id]  — get match results
 * POST /api/admin/network/contractor-match/[id]  — run/re-run matching
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";
import { matchContractors } from "@/lib/network/contractorMatcher";
import { logNetworkEvent } from "@/lib/network/attributionTracker";
import { logMarketplaceGate } from "@/lib/network/marketplaceReleaseGate";
import { rateLimitGuard } from '@/lib/rateLimitGuard';

type Params = { params: { id: string } };

// ── GET: Retrieve existing match results ─────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sql = await getDbReady();

    const { id } = params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "10"), 25);

    // Get opportunity
    const oppRows = await sql`
      SELECT
        id,
        location_state AS state,
        source_type,
        status,
        opportunity_score,
        opportunity_grade,
        homeowner_name,
        address,
        location_city AS city
      FROM network_opportunities WHERE id = ${id} LIMIT 1
    `;
    const opp = oppRows[0] as Record<string, unknown> | undefined;
    if (!opp)
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );

    // Get stored intelligence
    const intelRows = await sql`
      SELECT total_eligible_contractors, top_match_contractor_id, top_match_score,
             match_summary, scored_at
      FROM opportunity_intelligence WHERE opportunity_id = ${id} LIMIT 1
    `;
    const intel = (intelRows[0] as Record<string, unknown> | undefined) ?? null;

    // Get existing assignments
    const assignments = await sql`
      SELECT
        oa.*,
        COALESCE(NULLIF(u.company, ''), NULLIF(u.name, ''), NULLIF(u.email, ''), 'Unknown Contractor') AS company_name,
        NULL::numeric AS avg_rating,
        CASE WHEN cp.profile_complete THEN 'preferred' ELSE 'standard' END AS tier
      FROM opportunity_assignments oa
      JOIN contractor_profiles cp ON cp.user_id = oa.contractor_id
      JOIN users u ON u.id = oa.contractor_id
      WHERE oa.opportunity_id = ${id}
      ORDER BY oa.match_score DESC NULLS LAST
      LIMIT ${limit}
    `;

    return NextResponse.json({
      success: true,
      opportunity: opp,
      intelligence: intel,
      assignments,
    });
  } catch (error) {
    console.error("[GET /api/admin/network/contractor-match/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST: Run matching ───────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sql = await getDbReady();

    const { id } = params;
    const body = await req.json().catch(() => ({}));
    const { limit = 10, min_score = 30, create_assignments = false } = body;

    if (create_assignments) {
      const gateRows = await sql`
        SELECT no.id, no.status, no.screening_status, no.intake_metadata, no.raw_payload, osq.auto_decision, osq.override_decision
        FROM network_opportunities no
        LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
        WHERE no.id = ${id}
        LIMIT 1
      `;
      const gate = gateRows[0] as Record<string, unknown> | undefined;
      const releaseGate = gate
        ? logMarketplaceGate(
            "[MARKETPLACE RELEASE GATE]",
            gate,
            "create_assignments",
          )
        : null;
      if (
        !gate ||
        gate.status !== "live" ||
        !releaseGate?.approvedScreening ||
        !releaseGate.releaseReadiness.ready
      ) {
        return NextResponse.json(
          {
            error:
              "Assignments require a live opportunity with approved/passed screening and operational marketplace readiness",
          },
          { status: 409 },
        );
      }
    }

    // Run matching engine
    const result = await matchContractors(id, { limit, minScore: min_score });

    // Optionally create assignment records for top matches
    let created = 0;
    if (create_assignments && result.matches.length > 0) {
      for (let i = 0; i < Math.min(result.matches.length, 5); i++) {
        const match = result.matches[i];
        const inserted = await sql`
          INSERT INTO opportunity_assignments (
            opportunity_id, contractor_id, status,
            assignment_rank, match_score, match_factors,
            offered_at, offer_expires_at
          ) VALUES (
            ${id}, ${match.contractor_id}, 'offered',
            ${i + 1}, ${match.overall_score},
            ${JSON.stringify({
              source: "contractor_match",
              geo_score: match.geo_score,
              size_fit_score: match.size_fit_score,
              service_score: match.service_score,
              performance_score: match.performance_score,
              capacity_score: match.capacity_score,
              reasons: match.match_reasons,
              concerns: match.match_concerns,
            })},
            NOW(), NOW() + INTERVAL '72 hours'
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (inserted.length) created++;
      }

      if (created === 0) {
        await logNetworkEvent({
          event_type: "assignment.offer_insert_skipped",
          event_category: "assignment",
          opportunity_id: id,
          admin_user_id: admin.id,
          data: {
            source: "contractor_match",
            total_eligible: result.total_eligible,
            matches_returned: result.matches.length,
          },
          triggered_by: "admin",
        });
        return NextResponse.json(
          {
            success: false,
            error:
              "Matched contractors were found, but no assignment offers were created",
            details: {
              total_eligible: result.total_eligible,
              matches_returned: result.matches.length,
              assignments_created: created,
            },
          },
          { status: 409 },
        );
      }

      await logNetworkEvent({
        event_type: "assignment.offered",
        event_category: "assignment",
        opportunity_id: id,
        admin_user_id: admin.id,
        data: {
          source: "contractor_match",
          total_eligible: result.total_eligible,
          assignments_created: created,
        },
        triggered_by: "admin",
      });
    }

    return NextResponse.json({
      success: true,
      opportunity_id: id,
      total_eligible: result.total_eligible,
      top_match: result.top_match,
      matches: result.matches,
      assignments_created: create_assignments ? created : 0,
    });
  } catch (error) {
    console.error("[POST /api/admin/network/contractor-match/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
