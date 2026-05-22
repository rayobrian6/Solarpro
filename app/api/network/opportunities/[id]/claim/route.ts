export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError, isValidUUID } from "@/lib/db-neon";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { evaluateContractorEligibility } from "@/lib/network/contractorEligibility";
import { logNetworkEvent } from "@/lib/network/attributionTracker";

type Params = { params: { id: string } };

// ---------------------------------------------------------------------------
// POST /api/network/opportunities/[id]/claim
// Exclusively claim an opportunity.
// DB-level UNIQUE index prevents race conditions — two contractors hitting
// this simultaneously will result in one 409 and one 201.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit("standard", getClientIp(req));
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { id } = params;
  if (!isValidUUID(id))
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const sql = await getDbReady();

    // Load the opportunity
    const oppRows = await sql`
      SELECT id, status, created_by_user_id, asking_price, site_name, state_code, system_size_kw
        FROM opportunities
       WHERE id = ${id}
       LIMIT 1
    `;

    if (!oppRows.length) {
      const networkRows = await sql`
        SELECT
          no.id,
          no.status,
          COALESCE(no.marketplace_status, 'live') AS marketplace_status,
          no.claim_mode,
          no.max_claims,
          no.claim_count,
          no.asking_price
        FROM network_opportunities no
        WHERE no.id = ${id}
        LIMIT 1
      `;

      if (!networkRows.length) {
        return NextResponse.json(
          { error: "Opportunity not found" },
          { status: 404 },
        );
      }

      const networkOpportunity = networkRows[0] as Record<string, unknown>;
      const eligibility = await evaluateContractorEligibility({
        sql,
        contractorId: user.id,
        opportunityId: id,
      });

      if (!eligibility.eligible) {
        await logNetworkEvent({
          event_type: "assignment.claim_blocked",
          event_category: "assignment",
          opportunity_id: id,
          contractor_id: user.id,
          data: { source: "contractor_claim_flow_v1", eligibility },
          triggered_by: "contractor",
        });
        return NextResponse.json(
          {
            error: "Contractor is not eligible to claim this marketplace opportunity.",
            eligibility,
          },
          { status: 409 },
        );
      }

      const claimMode = typeof networkOpportunity.claim_mode === "string" && networkOpportunity.claim_mode === "shared" ? "shared" : "exclusive";
      const maxClaims = Math.max(1, Math.floor(Number(networkOpportunity.max_claims ?? 1)));

      let updated = await sql`
        UPDATE opportunity_assignments
           SET status = 'claimed',
               claimed_at = NOW(),
               claim_amount = ${networkOpportunity.asking_price as number | null},
               updated_at = NOW()
         WHERE opportunity_id = ${id}
           AND contractor_id = ${user.id}
           AND status IN ('offered','viewed')
           AND (offer_expires_at IS NULL OR offer_expires_at > NOW())
        RETURNING *
      `;

      if (!updated.length) {
        try {
          updated = await sql`
            INSERT INTO opportunity_assignments (
              opportunity_id,
              contractor_id,
              status,
              assignment_type,
              assignment_rank,
              match_score,
              match_factors,
              offered_at,
              claimed_at,
              claim_amount
            ) VALUES (
              ${id},
              ${user.id},
              'claimed',
              'marketplace',
              NULL,
              NULL,
              ${JSON.stringify({ source: "contractor_claim_flow_v1", eligibility })},
              NOW(),
              NOW(),
              ${networkOpportunity.asking_price as number | null}
            )
            ON CONFLICT DO NOTHING
            RETURNING *
          `;
        } catch (insertErr: unknown) {
          const msg = (insertErr as Error)?.message ?? "";
          if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505")) {
            return NextResponse.json({ error: "This marketplace opportunity was just claimed." }, { status: 409 });
          }
          throw insertErr;
        }
      }

      if (!updated.length) {
        return NextResponse.json({ error: "This opportunity is no longer available." }, { status: 409 });
      }

      const updatedOpportunity = await sql`
        UPDATE network_opportunities
           SET status = CASE WHEN ${claimMode} = 'exclusive' THEN 'claimed' ELSE status END,
               marketplace_status = CASE WHEN ${claimMode} = 'exclusive' THEN 'claimed' ELSE marketplace_status END,
               claimed_at = COALESCE(claimed_at, NOW()),
               claim_count = LEAST(COALESCE(claim_count, 0) + 1, ${maxClaims}),
               updated_at = NOW()
         WHERE id = ${id}
           AND status = 'live'
           AND COALESCE(marketplace_status, 'live') = 'live'
           AND (
             (${claimMode} = 'exclusive' AND COALESCE(claim_count, 0) = 0)
             OR (${claimMode} = 'shared' AND COALESCE(claim_count, 0) < ${maxClaims})
           )
        RETURNING id, status, marketplace_status, claim_count
      `;

      if (!updatedOpportunity.length) {
        await logNetworkEvent({
          event_type: "assignment.claim_blocked",
          event_category: "assignment",
          opportunity_id: id,
          assignment_id: (updated[0] as Record<string, unknown>).id as string,
          contractor_id: user.id,
          data: {
            source: "contractor_claim_flow_v1",
            reason: "claim_capacity_or_status_changed",
            claim_mode: claimMode,
            max_claims: maxClaims,
            eligibility,
          },
          triggered_by: "contractor",
        });
        await sql`
          UPDATE opportunity_assignments
             SET status = 'released', updated_at = NOW()
           WHERE id = ${(updated[0] as Record<string, unknown>).id as string}
             AND status = 'claimed'
        `;
        return NextResponse.json({ error: "This opportunity is no longer available." }, { status: 409 });
      }

      await logNetworkEvent({
        event_type: "assignment.claimed",
        event_category: "assignment",
        opportunity_id: id,
        assignment_id: (updated[0] as Record<string, unknown>).id as string,
        contractor_id: user.id,
        from_status: "live",
        to_status: claimMode === "exclusive" ? "claimed" : "live",
        data: { source: "contractor_claim_flow_v1", claim_mode: claimMode, max_claims: maxClaims, eligibility },
        triggered_by: "contractor",
      });

      const fullOpp = await sql`
        SELECT
          no.id,
          no.source_type AS source,
          no.status,
          NULL::text AS site_name,
          no.address,
          no.location_city AS city,
          no.location_state AS state_code,
          no.location_zip AS zip,
          no.estimated_system_size_kw AS system_size_kw,
          no.annual_usage_kwh AS annual_kwh,
          no.monthly_usage_avg_kwh AS monthly_kwh_avg,
          no.utility_provider AS utility_name,
          no.utility_rate_per_kwh,
          no.estimated_project_value AS estimated_system_cost,
          no.estimated_payback_yrs,
          no.roof_material,
          no.roof_pitch,
          no.roof_condition,
          no.roof_age_years,
          no.stories,
          no.structure_type,
          no.roof_usable_pct AS usable_roof_pct,
          no.battery_candidate,
          no.steep_roof_flag AS steep_roof,
          (COALESCE(no.ahj_complexity_score, 0) >= 70) AS complex_ahj,
          no.ahj_name,
          NULL::text AS equipment_ecosystem,
          no.asking_price,
          no.screening_notes AS listing_notes,
          no.expires_at,
          no.created_at,
          'SolarPro'::text AS creator_company,
          oa.id AS claim_id,
          oa.status AS claim_status,
          oa.contractor_id AS claimed_by_user_id
        FROM network_opportunities no
        JOIN opportunity_assignments oa
          ON oa.opportunity_id = no.id
         AND oa.contractor_id = ${user.id}
         AND oa.status IN ('claimed','contacted','appointment','proposal','won')
        WHERE no.id = ${id}
        LIMIT 1
      `;

      return NextResponse.json(
        {
          success: true,
          claim: updated[0],
          opportunity: fullOpp[0],
          eligibility,
          message: claimMode === "exclusive"
            ? "You have exclusively claimed this SolarPro Network opportunity. The homeowner's full address is now visible."
            : "You have claimed this shared SolarPro Network opportunity. The homeowner's full address is now visible.",
        },
        { status: 201 },
      );
    }

    const opp = oppRows[0] as Record<string, unknown>;

    if (opp.created_by_user_id === user.id) {
      return NextResponse.json(
        { error: "You cannot claim your own opportunity." },
        { status: 400 },
      );
    }

    if (opp.status !== "open") {
      return NextResponse.json(
        {
          error:
            opp.status === "claimed"
              ? "This opportunity has already been claimed by another contractor."
              : `This opportunity is ${opp.status} and no longer available.`,
        },
        { status: 409 },
      );
    }

    // Attempt exclusive claim — UNIQUE index will reject a concurrent claim
    let claim: Record<string, unknown>;
    try {
      const claimRows = await sql`
        INSERT INTO opportunity_claims (
          opportunity_id, claimed_by_user_id, price_paid,
          claim_expires_at
        ) VALUES (
          ${id},
          ${user.id},
          ${opp.asking_price as number | null},
          NOW() + INTERVAL '7 days'
        )
        RETURNING *
      `;
      claim = claimRows[0] as Record<string, unknown>;
    } catch (insertErr: unknown) {
      // Unique constraint violation = race condition, someone beat us
      const msg = (insertErr as Error)?.message ?? "";
      if (
        msg.includes("unique") ||
        msg.includes("duplicate") ||
        msg.includes("23505")
      ) {
        return NextResponse.json(
          {
            error: "This opportunity was just claimed by another contractor.",
          },
          { status: 409 },
        );
      }
      throw insertErr;
    }

    // Mark opportunity as claimed
    await sql`
      UPDATE opportunities
         SET status = 'claimed', updated_at = NOW()
       WHERE id = ${id}
    `;

    // Return claim with full opportunity details (including address — they've claimed it)
    const fullOpp = await sql`
      SELECT * FROM opportunities WHERE id = ${id} LIMIT 1
    `;

    return NextResponse.json(
      {
        success: true,
        claim,
        opportunity: fullOpp[0],
        message: `You have exclusively claimed this opportunity. The homeowner's full address is now visible.`,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    return handleRouteDbError(
      "[POST /api/network/opportunities/:id/claim]",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/network/opportunities/[id]/claim
// Release a claim — puts the opportunity back to open.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  if (!isValidUUID(id))
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const sql = await getDbReady();

    const updated = await sql`
      UPDATE opportunity_claims
         SET status = 'released', updated_at = NOW()
       WHERE opportunity_id = ${id}
         AND claimed_by_user_id = ${user.id}
         AND status = 'pending'
       RETURNING id
    `;

    if (!updated.length) {
      return NextResponse.json(
        { error: "No active claim found for this opportunity." },
        { status: 404 },
      );
    }

    // Reopen the opportunity
    await sql`
      UPDATE opportunities
         SET status = 'open', updated_at = NOW()
       WHERE id = ${id}
    `;

    return NextResponse.json({
      success: true,
      message: "Claim released. Opportunity is now available again.",
    });
  } catch (err: unknown) {
    return handleRouteDbError(
      "[DELETE /api/network/opportunities/:id/claim]",
      err,
    );
  }
}
