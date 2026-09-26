/**
 * /api/admin/network/screening
 *
 * Screening queue management for the Admin Control Center.
 *
 * GET  /api/admin/network/screening  — list screening queue
 * POST /api/admin/network/screening  — trigger screening for an opportunity
 * PATCH /api/admin/network/screening — override screening decision
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";
import { runScreeningPipeline } from "@/lib/network/screeningPipeline";
import { logNetworkEvent } from "@/lib/network/attributionTracker";
import { logMarketplaceGate } from "@/lib/network/marketplaceReleaseGate";
import {
  scoreOpportunity,
  scoreToListingPrice,
} from "@/lib/network/opportunityScorer";
import { enrichAndPersistOpportunity } from "@/lib/network/opportunityEnrichment";
import { rateLimitGuard } from '@/lib/rateLimitGuard';

function toPostgresTextArray(values: string[]) {
  return `{${values.map((value) => `\"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\"`).join(",")}}`;
}

// ── GET: Screening queue ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sql = await getDbReady();

    const { searchParams } = new URL(req.url);
    const pipelineStatus = searchParams.get("status"); // pending | running | completed | failed
    const autoDecision = searchParams.get("decision"); // pass | fail | needs_review
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "25"), 100);
    const offset = (page - 1) * limit;

    // 🚨 CANONICAL COLUMNS, ALIASED TO THE RESPONSE KEYS THE UI ALREADY BINDS TO.
    // This SELECT used to name no.homeowner_first_name / no.city / no.state,
    // none of which the governed migration chain creates, so it threw 42703 and
    // the handler's single try/catch returned 500 — which
    // app/admin/network/page.tsx renders as "Queue is empty". An operational
    // backlog and a clean desk looked identical, and the clean desk is the one
    // nobody investigates.
    //
    // The aliases matter as much as the columns: the response shape is a
    // contract with the queue table, which reads row.state,
    // row.homeowner_first_name and row.homeowner_last_name. Renaming the payload
    // keys would trade a 500 for silently blank cells.
    //
    // 🚨 AND BOTH NAME WRITERS ARE LIVE. The intake pipeline and the admin
    // opportunities route write first_name/last_name; the simulator and the
    // contractor-shared path write the single homeowner_name. Reading only one
    // of them blanks half the queue. The COALESCE/SPLIT_PART pair is the same
    // expression /api/admin/network/intake already uses for this.
    const rows = await sql`
      SELECT
        osq.*,
        COALESCE(no.first_name, NULLIF(SPLIT_PART(COALESCE(no.homeowner_name, ''), ' ', 1), '')) AS homeowner_first_name,
        COALESCE(no.last_name, NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(no.homeowner_name, ''), '^[^[:space:]]+[[:space:]]*', '')), '')) AS homeowner_last_name,
        no.homeowner_name,
        COALESCE(no.homeowner_phone, no.phone) AS homeowner_phone,
        COALESCE(no.address, no.address_line1) AS address,
        no.location_city  AS city,
        no.location_state AS state,
        COALESCE(no.location_zip, no.zip) AS zip,
        no.source_type,
        no.status AS opportunity_status,
        no.created_at AS opportunity_created_at,
        oi.enrichment_payload,
        oi.enrichment_completeness,
        oi.enrichment_warnings,
        oi.enriched_at
      FROM opportunity_screening_queue osq
      JOIN network_opportunities no ON no.id = osq.opportunity_id
      LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = osq.opportunity_id
      WHERE
      -- ::text IS LOAD-BEARING. A bare parameter in "$1 IS NULL" gives Postgres
      -- no context to infer a type from, so it refuses the whole statement with
      -- 42P18 (could not determine data type of parameter $1) — a SECOND cause
      -- of this endpoint's 500, independent of the phantom columns above and
      -- hidden behind them because Postgres reports only the first failure.
      -- /api/admin/network/intake already casts for exactly this reason.
        (${pipelineStatus ?? null}::text IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ""})
        AND (${autoDecision ?? null}::text IS NULL OR osq.auto_decision = ${autoDecision ?? ""})
      ORDER BY osq.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*)::int as total
      FROM opportunity_screening_queue osq
      WHERE
        (${pipelineStatus ?? null}::text IS NULL OR osq.pipeline_status = ${pipelineStatus ?? ""})
        AND (${autoDecision ?? null}::text IS NULL OR osq.auto_decision = ${autoDecision ?? ""})
    `;
    const countResult = countRows[0] as Record<string, unknown>;

    // 🚨 ONE VOCABULARY FOR THE QUEUE, SHARED WITH /api/admin/network/health.
    // These four counters used to be aliased `pending` / `running` / `completed`
    // / `failed`, while the Screening Queue tiles read stats.pending_screening
    // and stats.running_screening. Two of five tiles therefore displayed a bold
    // 0 forever beside three that showed real numbers — and an operator reading
    // a drained queue stops checking it.
    //
    // The endpoint is renamed rather than the page, for two reasons: the
    // *_screening names are already the published vocabulary of
    // /api/admin/network/health (pending_screening, running_screening,
    // failed_screening), so this makes both endpoints describe the same queue
    // with the same words; and the page is this endpoint's only consumer, so
    // the rename needs no change there at all. All four move together — leaving
    // two of them on the old names is how the mismatch happens again.
    const statsRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE pipeline_status = 'pending')      AS pending_screening,
        COUNT(*) FILTER (WHERE pipeline_status = 'running')      AS running_screening,
        COUNT(*) FILTER (WHERE pipeline_status = 'completed')    AS completed_screening,
        COUNT(*) FILTER (WHERE pipeline_status = 'failed')       AS failed_screening,
        COUNT(*) FILTER (WHERE auto_decision = 'pass')           AS auto_passed,
        COUNT(*) FILTER (WHERE auto_decision = 'fail')           AS auto_failed,
        COUNT(*) FILTER (WHERE auto_decision = 'needs_review')   AS needs_review,
        COUNT(*) FILTER (WHERE override_decision IS NOT NULL)    AS overridden,
        AVG(duration_ms)                                         AS avg_duration_ms
      FROM opportunity_screening_queue
    `;
    const stats = statsRows[0] as Record<string, unknown>;

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
    });
  } catch (error) {
    console.error("[GET /api/admin/network/screening]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST: Trigger screening ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { opportunity_id } = body;

    if (!opportunity_id) {
      return NextResponse.json(
        { error: "opportunity_id is required" },
        { status: 400 },
      );
    }

    // Run the pipeline
    const result = await runScreeningPipeline(opportunity_id);

    await logNetworkEvent({
      event_type: "opportunity.screening_started",
      event_category: "opportunity",
      opportunity_id,
      admin_user_id: admin.id,
      data: { triggered_by_admin: true, decision: result.auto_decision },
      triggered_by: "admin",
    });

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
    });
  } catch (error) {
    console.error("[POST /api/admin/network/screening]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function scoreAndPersistOpportunity(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  opportunity_id: string,
  adminId: string,
) {
  const rows =
    await sql`SELECT * FROM network_opportunities WHERE id = ${opportunity_id} LIMIT 1`;
  const opp = rows[0] as Record<string, unknown> | undefined;
  if (!opp) throw new Error("Opportunity not found");

  const scored = scoreOpportunity({
    monthly_bill: (opp.monthly_bill_amount ?? opp.monthly_usage_avg_kwh) as number,
    state: (opp.state ?? opp.location_state) as string,
    roof_age_years: opp.roof_age_years as number,
    structure_type: opp.structure_type as string,
    usable_roof_pct: (opp.usable_roof_pct ?? opp.roof_usable_pct) as number,
    stories: opp.stories as number,
    source_type: opp.source_type as string,
    peak_sun_hours: opp.peak_sun_hours_annual as number,
    estimated_system_size_kw: opp.estimated_system_size_kw as number,
    annual_usage_kwh: opp.annual_usage_kwh as number,
    battery_interest: (opp.battery_interest ??
      opp.battery_candidate) as boolean,
    avg_rate_kwh: opp.utility_rate_per_kwh as number,
    net_metering: opp.net_metering_type ? true : null,
  });
  const pricing = scoreToListingPrice(
    scored.overall_score,
    scored.overall_grade,
  );
  const networkOpportunityGrade = ["A+", "A", "B", "C"].includes(
    scored.overall_grade,
  )
    ? scored.overall_grade
    : null;
  const networkScore = Math.round(scored.overall_score);

  // 🚨 CANONICAL COLUMNS ONLY. This UPDATE used to name two columns that the
  // governed migration chain has never created — they exist only in the
  // secret-gated inline DDL at app/api/migrate/route.ts, which no migration
  // file mirrors. Postgres stops at the first one (42703), so this statement
  // always threw, and because it runs on the way to the marketplace release it
  // took the ONLY production writer of the visibility gate down with it.
  //
  //   listing_price — never existed. Every reader already gets its number from
  //                   asking_price; /api/admin/network/marketplace literally
  //                   selects `no.asking_price AS listing_price`, so the phantom
  //                   write was never the source of the figure anyone saw.
  //   scoring_data  — never existed either. The full breakdown is persisted
  //                   canonically by the opportunity_intelligence upsert
  //                   immediately below (sub-scores, price band, rationale,
  //                   risk flags, executive summary), so nothing is lost by
  //                   dropping it; it had no reader anywhere in app/ or lib/.
  await sql`
    UPDATE network_opportunities SET
      opportunity_score = ${networkScore},
      opportunity_grade = ${networkOpportunityGrade},
      asking_price = COALESCE(asking_price, ${pricing.price}),
      scored_at = COALESCE(scored_at, NOW()),
      updated_at = NOW()
    WHERE id = ${opportunity_id}
  `;

  await sql`
    INSERT INTO opportunity_intelligence (
      opportunity_id, overall_score, overall_grade,
      property_score, solar_score, financial_score, market_score, intent_score,
      market_price, price_min, price_max, pricing_rationale,
      risk_flags, opportunity_highlights, executive_summary
    ) VALUES (
      ${opportunity_id}, ${scored.overall_score}, ${scored.overall_grade},
      ${scored.property.score}, ${scored.solar.score},
      ${scored.financial.score}, ${scored.market.score}, ${scored.intent.score},
      ${pricing.price}, ${pricing.min}, ${pricing.max}, ${pricing.rationale},
      CAST(${toPostgresTextArray(scored.risk_flags)} AS text[]), CAST(${toPostgresTextArray(scored.opportunity_highlights)} AS text[]),
      ${scored.executive_summary}
    )
    ON CONFLICT (opportunity_id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score,
      overall_grade = EXCLUDED.overall_grade,
      property_score = EXCLUDED.property_score,
      solar_score = EXCLUDED.solar_score,
      financial_score = EXCLUDED.financial_score,
      market_score = EXCLUDED.market_score,
      intent_score = EXCLUDED.intent_score,
      market_price = EXCLUDED.market_price,
      price_min = EXCLUDED.price_min,
      price_max = EXCLUDED.price_max,
      pricing_rationale = EXCLUDED.pricing_rationale,
      risk_flags = EXCLUDED.risk_flags,
      opportunity_highlights = EXCLUDED.opportunity_highlights,
      executive_summary = EXCLUDED.executive_summary,
      updated_at = NOW()
  `;

  const enrichment = await enrichAndPersistOpportunity(sql, opportunity_id, {
    adminUserId: adminId,
    triggeredBy: "admin",
  });

  return { scored, pricing, enrichment };
}

// ── PATCH: Override screening decision ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'admin');
  if (rlGuard.blocked) return rlGuard.response;

  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sql = await getDbReady();

    const body = await req.json();
    const { opportunity_id, action, decision, reason } = body as {
      opportunity_id: string;
      action?:
        | "approve"
        | "reject"
        | "request_more_info"
        | "release_to_marketplace";
      decision?: "pass" | "fail" | "hold";
      reason?: string;
    };

    if (!opportunity_id) {
      return NextResponse.json(
        { error: "opportunity_id is required" },
        { status: 400 },
      );
    }

    const normalizedAction =
      action ??
      (decision === "pass"
        ? "approve"
        : decision === "fail"
          ? "reject"
          : decision === "hold"
            ? "request_more_info"
            : undefined);

    if (!normalizedAction) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 },
      );
    }

    const oppRows = await sql`
      SELECT no.id, no.status, no.screening_status, no.intake_metadata, no.raw_payload, osq.auto_decision, osq.override_decision
      FROM network_opportunities no
      LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
      WHERE no.id = ${opportunity_id}
      LIMIT 1
    `;
    const opp = oppRows[0] as Record<string, unknown> | undefined;
    if (!opp)
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );

    let newStatus = String(opp.status ?? "screening");
    let screeningStatus = String(opp.screening_status ?? "pending");
    let overrideDecision: "pass" | "fail" | "hold" | null = null;
    let eventType = "screening.override";
    let responsePayload: Record<string, unknown> = {};
    // 🚨 SCORING IS DEFERRED PAST THE DECISION WRITES ON PURPOSE.
    // It used to be awaited HERE, in front of them. Scoring reaches the
    // opportunity_intelligence upsert and the whole enrichment pipeline, so any
    // failure in any of that — an outage, a bad row, a phantom column — threw
    // before the operator's decision was recorded, and a 500 came back. A
    // scoring problem and a refusal became indistinguishable, and the operator's
    // ruling was silently discarded. The decision is the operator's; the score
    // is an enrichment of it and must never be able to veto it.
    let needsScoring = false;
    let scoringError: string | null = null;

    if (normalizedAction === "approve") {
      overrideDecision = "pass";
      screeningStatus = "approved";
      newStatus = "scored";
      needsScoring = true;
      responsePayload = {
        action: normalizedAction,
        screening_status: screeningStatus,
        new_status: newStatus,
      };
    } else if (normalizedAction === "reject") {
      overrideDecision = "fail";
      screeningStatus = "rejected";
      newStatus = "rejected";
      responsePayload = {
        action: normalizedAction,
        screening_status: screeningStatus,
        new_status: newStatus,
      };
    } else if (normalizedAction === "request_more_info") {
      overrideDecision = "hold";
      screeningStatus = "escalated";
      newStatus = "screening";
      responsePayload = {
        action: normalizedAction,
        screening_status: "needs_more_info",
        stored_screening_status: screeningStatus,
        new_status: newStatus,
      };
    } else if (normalizedAction === "release_to_marketplace") {
      const releaseGate = logMarketplaceGate(
        "[MARKETPLACE RELEASE GATE]",
        opp,
        "release_to_marketplace",
      );
      if (!releaseGate.approvedScreening) {
        return NextResponse.json(
          {
            error:
              "Opportunity must be approved by screening before marketplace release",
          },
          { status: 409 },
        );
      }
      if (!releaseGate.releaseReadiness.ready) {
        return NextResponse.json(
          {
            error:
              "Opportunity must pass operational marketplace release readiness before marketplace release",
            missing: releaseGate.missing,
          },
          { status: 409 },
        );
      }
      overrideDecision = "pass";
      screeningStatus = "approved";
      newStatus = "live";
      eventType = "opportunity.published";
      needsScoring = true;
      responsePayload = {
        action: normalizedAction,
        screening_status: screeningStatus,
        new_status: newStatus,
      };
    }

    await sql`
      UPDATE opportunity_screening_queue SET
        override_decision = ${overrideDecision},
        override_by       = ${admin.id},
        override_reason   = ${reason ?? null},
        override_at       = NOW(),
        updated_at        = NOW()
      WHERE opportunity_id = ${opportunity_id}
    `;

    await sql`
      UPDATE network_opportunities SET
        status = ${newStatus},
        screening_status = ${screeningStatus},
        screened_by_admin_id = ${admin.id},
        screening_notes = ${reason ?? null},
        screened_at = COALESCE(screened_at, NOW()),
        live_at = CASE WHEN ${newStatus} = 'live' THEN COALESCE(live_at, NOW()) ELSE live_at END,
        expires_at = CASE WHEN ${newStatus} = 'live' THEN GREATEST(expires_at, NOW() + INTERVAL '30 days') ELSE expires_at END,
        updated_at = NOW()
      WHERE id = ${opportunity_id}
    `;

    // ── Scoring + enrichment, AFTER the decision is durable and in its own
    //    try/catch. Two independent guards, deliberately: the ordering means a
    //    failure cannot reach back and undo the decision, and the catch means it
    //    cannot turn a recorded decision into a 500 the operator reads as "it
    //    did not work" and retries.
    //
    // 🚨 AND THE FAILURE IS REPORTED, NOT SWALLOWED. A silently-absent score is
    //    the same defect in a new costume: the operator would see success and a
    //    blank grade and have no way to tell an unscorable lead from a broken
    //    scorer. `scoring_error` on the response says which.
    if (needsScoring) {
      try {
        const { scored, pricing, enrichment } = await scoreAndPersistOpportunity(
          sql,
          opportunity_id,
          admin.id,
        );
        responsePayload = {
          ...responsePayload,
          score: scored.overall_score,
          grade: scored.overall_grade,
          market_price: pricing.price,
          enrichment_completeness: enrichment.completeness,
          enrichment_warnings: enrichment.warnings,
        };
      } catch (scoreErr) {
        scoringError = (scoreErr as Error).message;
        console.error(
          "[PATCH /api/admin/network/screening] scoring/enrichment failed after the decision was recorded",
          scoreErr,
        );
        responsePayload = { ...responsePayload, scoring_error: scoringError };
      }
    }

    await logNetworkEvent({
      event_type: eventType,
      event_category:
        normalizedAction === "release_to_marketplace"
          ? "opportunity"
          : "screening",
      opportunity_id,
      admin_user_id: admin.id,
      data: { action: normalizedAction, reason, ...responsePayload },
      from_status: String(opp.status ?? ""),
      to_status: newStatus,
      triggered_by: "admin",
    });

    return NextResponse.json({ success: true, ...responsePayload });
  } catch (error) {
    console.error("[PATCH /api/admin/network/screening]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
