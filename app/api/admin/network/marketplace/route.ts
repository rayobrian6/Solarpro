/** Canonical admin Marketplace Workbench v1. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";
import { matchContractors } from "@/lib/network/contractorMatcher";
import { logNetworkEvent } from "@/lib/network/attributionTracker";
import { logMarketplaceGate } from "@/lib/network/marketplaceReleaseGate";
import {
  releaseMarketplaceInventoryFromIntake,
  transitionMarketplaceInventory,
  type MarketplaceInventoryAction,
} from "@/lib/network/marketplaceInventory";

function jsonError(error: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error, details }, { status });
}

type MarketplaceStage =
  | "auth"
  | "db_connect"
  | "request_parse"
  | "list_query"
  | "count_query"
  | "gate_query"
  | "inventory_release"
  | "inventory_transition"
  | "assignment_query"
  | "matching_call"
  | "assignment_insert"
  | "intelligence_update"
  | "event_log";

function marketplaceError(stage: MarketplaceStage, error: unknown) {
  const err = error as {
    message?: string;
    code?: string;
    detail?: string;
    constraint?: string;
    column?: string;
  };
  return NextResponse.json(
    {
      success: false,
      error: "Marketplace Workbench failed",
      stage,
      message: err?.message ?? String(error),
      code: err?.code,
      details: {
        detail: err?.detail,
        constraint: err?.constraint,
        column: err?.column,
      },
    },
    { status: 500 },
  );
}

async function assertLiveApprovedOpportunity(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  opportunityId: string,
) {
  const rows = await sql`
    SELECT no.id, no.status, no.screening_status, no.intake_metadata, no.raw_payload, osq.auto_decision, osq.override_decision
    FROM network_opportunities no
    LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
    WHERE no.id = ${opportunityId}
    LIMIT 1
  `;
  const opp = rows[0] as Record<string, unknown> | undefined;
  if (!opp)
    return { ok: false as const, status: 404, error: "Opportunity not found" };
  const gate = logMarketplaceGate(
    "[MARKETPLACE RELEASE GATE]",
    opp,
    "marketplace_workbench_access",
  );
  if (opp.status !== "live")
    return {
      ok: false as const,
      status: 409,
      error:
        "Only live opportunities can be managed in the marketplace workbench",
    };
  if (!gate.approvedScreening)
    return {
      ok: false as const,
      status: 409,
      error: "Opportunity must have passed or approved screening",
    };
  if (!gate.releaseReadiness.ready)
    return {
      ok: false as const,
      status: 409,
      error:
        "Opportunity must be operator reviewed, qualified, financing-ready, homeowner-intent verified, and approved for marketplace before workbench actions",
      details: gate.missing,
    };
  return { ok: true as const, opportunity: opp };
}

export async function GET(req: NextRequest) {
  let stage: MarketplaceStage = "auth";
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return jsonError("Forbidden", 403);

    stage = "db_connect";
    const sql = await getDbReady();
    stage = "request_parse";
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "25")),
      100,
    );
    const offset = (page - 1) * limit;

    stage = "list_query";
    const rows = await sql`
      WITH assignment_summary AS (
        SELECT
          opportunity_id,
          COUNT(*)::int AS assignment_count,
          COUNT(*) FILTER (WHERE status IN ('offered','viewed'))::int AS active_offer_count,
          COUNT(*) FILTER (WHERE status IN ('claimed','contacted','appointment','proposal','won'))::int AS claimed_or_active_count,
          MAX(status) FILTER (WHERE status IN ('claimed','contacted','appointment','proposal','won')) AS current_assignment_status,
          MAX(offered_at) AS last_offered_at
        FROM opportunity_assignments
        GROUP BY opportunity_id
      )
      SELECT
        no.id, no.homeowner_name,
        no.address, no.location_city AS city, no.location_state AS state, no.location_city, no.location_state, no.location_zip,
        no.source_type, no.status, no.screening_status, no.live_at, no.created_at,
        no.estimated_project_value, no.asking_price, no.asking_price AS listing_price,
        no.opportunity_score, no.opportunity_grade,
        oi.overall_score, oi.overall_grade, oi.market_price, oi.executive_summary,
        oi.enrichment_payload, oi.enrichment_completeness, oi.enrichment_warnings, oi.enriched_at,
        oi.risk_flags, oi.opportunity_highlights, oi.total_eligible_contractors, oi.top_match_score,
        osq.auto_decision, osq.override_decision, osq.confidence_score,
        COALESCE(asg.assignment_count, 0) AS assignment_count,
        COALESCE(asg.active_offer_count, 0) AS active_offer_count,
        COALESCE(asg.claimed_or_active_count, 0) AS claimed_or_active_count,
        asg.current_assignment_status, asg.last_offered_at
      FROM network_opportunities no
      LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
      LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
      LEFT JOIN assignment_summary asg ON asg.opportunity_id = no.id
      WHERE no.status = 'live'
        AND (no.screening_status = 'approved' OR osq.auto_decision = 'pass' OR osq.override_decision = 'pass')
        AND no.intake_metadata->'operational'->>'approved_for_marketplace' = 'true'
      ORDER BY no.live_at DESC NULLS LAST, no.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    stage = "count_query";
    const countRows = await sql`
      SELECT COUNT(*)::int AS total
      FROM network_opportunities no
      LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
      WHERE no.status = 'live'
        AND (no.screening_status = 'approved' OR osq.auto_decision = 'pass' OR osq.override_decision = 'pass')
        AND no.intake_metadata->'operational'->>'approved_for_marketplace' = 'true'
    `;
    const total = Number(
      (countRows[0] as Record<string, unknown> | undefined)?.total ?? 0,
    );

    return NextResponse.json({
      success: true,
      opportunities: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[GET /api/admin/network/marketplace]", { stage, error });
    return marketplaceError(stage, error);
  }
}

export async function POST(req: NextRequest) {
  let stage: MarketplaceStage = "auth";
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return jsonError("Forbidden", 403);

    stage = "db_connect";
    const sql = await getDbReady();
    stage = "request_parse";
    const body = await req.json();
    const {
      action,
      opportunity_id,
      intake_event_id,
      reason = null,
      asking_price = null,
      listing_notes = null,
      expires_days = 30,
      claim_mode = "exclusive",
      max_claims = null,
      limit = 10,
      min_score = 30,
    } = body as {
      action:
        | "release_from_intake"
        | MarketplaceInventoryAction
        | "match_contractors"
        | "create_assignments";
      opportunity_id?: string;
      intake_event_id?: string;
      reason?: string | null;
      asking_price?: number | null;
      listing_notes?: string | null;
      expires_days?: number | null;
      claim_mode?: "exclusive" | "shared";
      max_claims?: number | null;
      limit?: number;
      min_score?: number;
    };
    if (!action) return jsonError("action is required", 400);

    if (action === "release_from_intake") {
      if (!intake_event_id)
        return jsonError("intake_event_id is required for release_from_intake", 400);
      stage = "inventory_release";
      const result = await releaseMarketplaceInventoryFromIntake({
        sql,
        intakeEventId: intake_event_id,
        adminUserId: admin.id,
        askingPrice: asking_price,
        listingNotes: listing_notes,
        expiresDays: expires_days,
        claimMode: claim_mode,
        maxClaims: max_claims,
      });
      if (!result.ok) return jsonError(result.error, result.status, result);
      return NextResponse.json(
        { success: true, ...result, opportunity_id: result.opportunity.id },
        { status: result.status },
      );
    }

    const inventoryActions: MarketplaceInventoryAction[] = [
      "release",
      "pause",
      "unrelease",
      "archive",
    ];
    if (inventoryActions.includes(action as MarketplaceInventoryAction)) {
      if (!opportunity_id)
        return jsonError("opportunity_id is required for inventory actions", 400);
      stage = "inventory_transition";
      const result = await transitionMarketplaceInventory({
        sql,
        opportunityId: opportunity_id,
        adminUserId: admin.id,
        action: action as MarketplaceInventoryAction,
        reason,
      });
      if (!result.ok) return jsonError(result.error, result.status, result);
      return NextResponse.json(
        { success: true, ...result, opportunity_id: result.opportunity.id },
        { status: result.status },
      );
    }

    if (!opportunity_id)
      return jsonError("opportunity_id is required for assignment actions", 400);

    stage = "gate_query";
    const gate = await assertLiveApprovedOpportunity(sql, opportunity_id);
    if (!gate.ok) return jsonError(gate.error, gate.status, gate);

    stage = "assignment_query";
    const existingAssignments = await sql`
      SELECT id, status, contractor_id
      FROM opportunity_assignments
      WHERE opportunity_id = ${opportunity_id}
        AND status IN ('offered','viewed','claimed','contacted','appointment','proposal','won')
      ORDER BY offered_at DESC NULLS LAST
    `;

    stage = "matching_call";
    const result = await matchContractors(opportunity_id, {
      limit,
      minScore: min_score,
    });

    if (action === "match_contractors") {
      await logNetworkEvent({
        event_type: "assignment.match_previewed",
        event_category: "assignment",
        opportunity_id,
        admin_user_id: admin.id,
        data: {
          source: "marketplace_workbench",
          total_eligible: result.total_eligible,
          returned: result.matches.length,
        },
        triggered_by: "admin",
      });
      return NextResponse.json({
        success: true,
        action,
        opportunity_id,
        already_assigned: existingAssignments.length > 0,
        existing_assignments: existingAssignments,
        total_eligible: result.total_eligible,
        top_match: result.top_match,
        matches: result.matches,
      });
    }

    if (existingAssignments.length > 0)
      return jsonError("Opportunity already has active assignments", 409, {
        existing_assignments: existingAssignments,
      });

    if (result.matches.length === 0) {
      await logNetworkEvent({
        event_type: "assignment.no_eligible_contractors",
        event_category: "assignment",
        opportunity_id,
        admin_user_id: admin.id,
        data: { source: "marketplace_workbench", min_score },
        triggered_by: "admin",
      });
      return NextResponse.json({
        success: true,
        action,
        opportunity_id,
        total_eligible: 0,
        assignments_created: 0,
        matches: [],
      });
    }

    let created = 0;
    for (let i = 0; i < Math.min(result.matches.length, 5); i++) {
      const match = result.matches[i];
      stage = "assignment_insert";
      const inserted = await sql`
        INSERT INTO opportunity_assignments (opportunity_id, contractor_id, status, assignment_rank, match_score, match_factors, offered_at, offer_expires_at)
        VALUES (${opportunity_id}, ${match.contractor_id}, 'offered', ${i + 1}, ${match.overall_score}, ${JSON.stringify({ source: "marketplace_workbench", geo_score: match.geo_score, size_fit_score: match.size_fit_score, service_score: match.service_score, performance_score: match.performance_score, capacity_score: match.capacity_score, reasons: match.match_reasons, concerns: match.match_concerns })}, NOW(), NOW() + INTERVAL '72 hours')
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (inserted.length) created++;
    }

    stage = "intelligence_update";
    await sql`
      UPDATE opportunity_intelligence
      SET total_eligible_contractors = ${result.total_eligible},
          top_match_contractor_id = ${result.top_match?.contractor_id ?? null},
          top_match_score = ${result.top_match?.overall_score ?? null},
          match_summary = ${JSON.stringify(result.matches.slice(0, 5))},
          updated_at = NOW()
      WHERE opportunity_id = ${opportunity_id}
    `;

    if (created === 0) {
      await logNetworkEvent({
        event_type: "assignment.offer_insert_skipped",
        event_category: "assignment",
        opportunity_id,
        admin_user_id: admin.id,
        data: {
          source: "marketplace_workbench",
          total_eligible: result.total_eligible,
          matches_returned: result.matches.length,
        },
        triggered_by: "admin",
      });
      return jsonError(
        "Matched contractors were found, but no assignment offers were created",
        409,
        {
          total_eligible: result.total_eligible,
          matches_returned: result.matches.length,
          assignments_created: created,
        },
      );
    }

    stage = "event_log";
    await logNetworkEvent({
      event_type: "assignment.offered",
      event_category: "assignment",
      opportunity_id,
      admin_user_id: admin.id,
      data: {
        source: "marketplace_workbench",
        total_eligible: result.total_eligible,
        assignments_created: created,
      },
      triggered_by: "admin",
    });

    return NextResponse.json({
      success: true,
      action,
      opportunity_id,
      total_eligible: result.total_eligible,
      assignments_created: created,
      top_match: result.top_match,
      matches: result.matches,
    });
  } catch (error) {
    console.error("[POST /api/admin/network/marketplace]", { stage, error });
    return marketplaceError(stage, error);
  }
}
