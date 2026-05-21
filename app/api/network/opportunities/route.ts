export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError, isValidUUID } from "@/lib/db-neon";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { logMarketplaceGate } from "@/lib/network/marketplaceReleaseGate";
import { evaluateContractorEligibility } from "@/lib/network/contractorEligibility";
import { buildMarketplaceIntelligence } from "@/lib/network/marketplaceIntelligence";

// ---------------------------------------------------------------------------
// GET /api/network/opportunities
// Discovery feed — open opportunities matching caller's territory + capabilities.
// Falls back to showing all open opportunities in the caller's states
// if they have no profile yet.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"));
  const offset = (page - 1) * limit;
  const filterState = searchParams.get("state") || null;
  const filterBattery = searchParams.get("battery") === "1";
  const filterMinKw = parseFloat(searchParams.get("min_kw") || "0") || null;
  const filterMaxKw = parseFloat(searchParams.get("max_kw") || "0") || null;

  try {
    const sql = await getDbReady();

    // Get caller's profile for personalized feed
    const profileRows = await sql`
      SELECT service_states, equipment_ecosystems, battery_certified,
             min_project_kw, max_project_kw, network_active
        FROM contractor_profiles
       WHERE user_id = ${user.id}
       LIMIT 1
    `;
    const profile = profileRows[0] as Record<string, unknown> | undefined;

    // Build discovery query — exclude own opportunities
    const rows = await sql`
      SELECT
        o.id,
        o.source,
        o.status,
        o.site_name,
        -- Address only shown after claim — show city/state/zip in feed
        o.city,
        o.state_code,
        o.zip,
        o.system_size_kw,
        o.annual_kwh,
        o.monthly_kwh_avg,
        o.utility_name,
        o.utility_rate_per_kwh,
        o.estimated_system_cost,
        o.estimated_payback_yrs,
        o.roof_material,
        o.roof_pitch,
        o.roof_condition,
        o.roof_age_years,
        o.battery_candidate,
        o.steep_roof,
        o.complex_ahj,
        o.ahj_name,
        o.equipment_ecosystem,
        o.asking_price,
        o.listing_notes,
        o.expires_at,
        o.created_at,
        -- DO NOT expose: address, lat, lng, project_id, created_by_user_id (pre-claim)
        u.company AS creator_company
      FROM opportunities o
      JOIN users u ON u.id = o.created_by_user_id
      WHERE o.status = 'open'
        AND o.created_by_user_id != ${user.id}
        AND o.expires_at > NOW()
        AND (${filterState}::text IS NULL OR o.state_code = ${filterState})
        AND (${filterBattery} = FALSE OR o.battery_candidate = TRUE)
        AND (${filterMinKw}::numeric IS NULL OR o.system_size_kw >= ${filterMinKw})
        AND (${filterMaxKw}::numeric IS NULL OR o.system_size_kw <= ${filterMaxKw})
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const canonicalCandidateRows = await sql`
      SELECT
        no.id,
        no.source_type AS source,
        'open'::text AS status,
        NULL::text AS site_name,
        no.location_city AS city,
        no.location_state AS state_code,
        no.location_zip AS zip,
        no.estimated_system_size_kw AS system_size_kw,
        no.annual_usage_kwh AS annual_kwh,
        no.monthly_usage_avg_kwh AS monthly_kwh_avg,
        no.utility_provider AS utility_name,
        no.utility_rate_per_kwh,
        no.estimated_project_value AS estimated_system_cost,
        no.estimated_annual_savings,
        no.offset_percentage AS estimated_offset_pct,
        no.estimated_payback_yrs,
        no.monthly_bill_amount,
        no.homeowner_ownership AS homeowner_status,
        no.homeowner_timeline AS timeline,
        no.homeowner_financing_interest AS finance_readiness,
        no.opportunity_grade AS lead_grade,
        COALESCE(
          no.intake_metadata->'qualification'->>'qualification_status',
          no.intake_metadata->'qualification'->>'lead_grade'
        ) AS qualification_status,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'estimated_income_band',
          no.intake_metadata->'qualification'->>'estimated_income_band',
          no.intake_metadata->'qualification'->>'income_band'
        ) AS estimated_income_band,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'estimated_credit_band',
          no.intake_metadata->'qualification'->>'estimated_credit_band'
        ) AS estimated_credit_band,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'sunlight_confidence',
          no.intake_metadata->'qualification'->>'sunlight_confidence'
        ) AS sunlight_confidence,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'property_type',
          no.intake_metadata->'qualification'->>'property_type',
          no.raw_payload->>'property_type'
        ) AS property_type,
        COALESCE(
          no.raw_payload->>'battery_interest',
          no.intake_metadata->>'battery_interest',
          CASE WHEN no.battery_candidate THEN 'yes' ELSE NULL END
        ) AS battery_interest,
        COALESCE(
          no.raw_payload->>'preferred_contact_method',
          no.intake_metadata->>'preferred_contact_method'
        ) AS preferred_contact_method,
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
        COALESCE(no.listing_notes, no.screening_notes) AS listing_notes,
        no.expires_at,
        no.created_at,
        no.released_at,
        'SolarPro'::text AS creator_company,
        offer.id AS claim_id,
        offer.status AS claim_status,
        offer.contractor_id AS claimed_by_user_id,
        oi.enrichment_payload,
        oi.enrichment_completeness,
        oi.enrichment_warnings,
        oi.enriched_at,
        no.status AS marketplace_lifecycle_status,
        COALESCE(no.marketplace_status, no.status) AS marketplace_status,
        no.claim_mode,
        no.claim_count,
        no.max_claims,
        no.screening_status AS marketplace_screening_status,
        no.intake_metadata AS marketplace_intake_metadata,
        no.raw_payload AS marketplace_raw_payload,
        (
          SELECT osq.auto_decision
          FROM opportunity_screening_queue osq
          WHERE osq.opportunity_id = no.id
          LIMIT 1
        ) AS marketplace_auto_decision,
        (
          SELECT osq.override_decision
          FROM opportunity_screening_queue osq
          WHERE osq.opportunity_id = no.id
          LIMIT 1
        ) AS marketplace_override_decision
      FROM network_opportunities no
      LEFT JOIN opportunity_intelligence oi ON oi.opportunity_id = no.id
      LEFT JOIN opportunity_assignments offer
        ON offer.opportunity_id = no.id
       AND offer.contractor_id = ${user.id}
       AND offer.status IN ('offered','viewed')
       AND (offer.offer_expires_at IS NULL OR offer.offer_expires_at > NOW())
      WHERE no.status = 'live'
        AND COALESCE(no.marketplace_status, 'not_released') = 'live'
        AND COALESCE(no.claim_count, 0) < GREATEST(COALESCE(no.max_claims, 1), 1)
        AND no.intake_metadata->'operational'->>'approved_for_marketplace' = 'true'
        AND (
          no.screening_status = 'approved'
          OR EXISTS (
            SELECT 1 FROM opportunity_screening_queue osq
            WHERE osq.opportunity_id = no.id
              AND (osq.auto_decision = 'pass' OR osq.override_decision = 'pass')
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM opportunity_assignments claimed
          WHERE claimed.opportunity_id = no.id
            AND claimed.contractor_id = ${user.id}
            AND claimed.status IN ('claimed','contacted','appointment','proposal','won')
        )
        AND (${filterState}::text IS NULL OR no.location_state = ${filterState})
        AND (${filterBattery} = FALSE OR no.battery_candidate = TRUE)
        AND (${filterMinKw}::numeric IS NULL OR no.estimated_system_size_kw >= ${filterMinKw})
        AND (${filterMaxKw}::numeric IS NULL OR no.estimated_system_size_kw <= ${filterMaxKw})
      ORDER BY no.released_at DESC NULLS LAST, no.created_at DESC
      LIMIT ${Math.max(limit + offset, limit)}
    `;

    const countRows = await sql`
      SELECT COUNT(*) AS total
        FROM opportunities o
       WHERE o.status = 'open'
         AND o.created_by_user_id != ${user.id}
         AND o.expires_at > NOW()
         AND (${filterState}::text IS NULL OR o.state_code = ${filterState})
         AND (${filterBattery} = FALSE OR o.battery_candidate = TRUE)
         AND (${filterMinKw}::numeric IS NULL OR o.system_size_kw >= ${filterMinKw})
         AND (${filterMaxKw}::numeric IS NULL OR o.system_size_kw <= ${filterMaxKw})
    `;

    const legacyTotal = parseInt(String(countRows[0]?.total ?? "0"));

    const canonicalCandidateOpportunityRows = canonicalCandidateRows as Array<Record<string, unknown>>;
    const eligibleCanonicalRows: Array<Record<string, unknown>> = [];
    for (const row of canonicalCandidateOpportunityRows) {
      const eligibility = await evaluateContractorEligibility({
        sql,
        contractorId: user.id,
        opportunityId: String(row.id),
      });
      if (!eligibility.eligible) {
        console.info("[MARKETPLACE VISIBILITY DENIED]", {
          id: row.id,
          contractor_id: user.id,
          denials: eligibility.denials,
          reasons: eligibility.reasons,
          warnings: eligibility.warnings,
          claim_state: eligibility.claim_state,
          release_gate_result: eligibility.release_gate_result,
          status: row.marketplace_lifecycle_status,
          marketplace_status: row.marketplace_status,
          screening_status: row.marketplace_screening_status,
          auto_decision: row.marketplace_auto_decision,
          override_decision: row.marketplace_override_decision,
        });
        continue;
      }
      eligibleCanonicalRows.push({
        ...row,
        eligibility_summary: {
          reasons: eligibility.reasons,
          warnings: eligibility.warnings,
          claim_state: eligibility.claim_state,
        },
      });
    }

    eligibleCanonicalRows.slice(0, 5).forEach((row) => {
      logMarketplaceGate(
        "[MARKETPLACE VISIBILITY]",
        {
          id: row.id,
          status: row.marketplace_lifecycle_status,
          screening_status: row.marketplace_screening_status,
          auto_decision: row.marketplace_auto_decision,
          override_decision: row.marketplace_override_decision,
          intake_metadata: row.marketplace_intake_metadata,
          raw_payload: row.marketplace_raw_payload,
        },
        "contractor_discovery_feed",
      );
    });
    const visibleCanonicalRows = eligibleCanonicalRows
      .slice(offset, offset + limit)
      .map((candidateRow) => {
        const marketplace_intelligence = buildMarketplaceIntelligence(candidateRow);
        const {
          marketplace_lifecycle_status,
          marketplace_screening_status,
          marketplace_intake_metadata,
          marketplace_raw_payload,
          marketplace_auto_decision,
          marketplace_override_decision,
          ...row
        } = candidateRow;
        void marketplace_lifecycle_status;
        void marketplace_screening_status;
        void marketplace_intake_metadata;
        void marketplace_raw_payload;
        void marketplace_auto_decision;
        void marketplace_override_decision;
        return { ...row, marketplace_intelligence };
      });

    return NextResponse.json({
      success: true,
      opportunities: [...visibleCanonicalRows, ...rows],
      total: legacyTotal + eligibleCanonicalRows.length,
      page,
      limit,
      profile_states: (profile?.service_states as string[] | undefined) ?? [],
    });
  } catch (err: unknown) {
    return handleRouteDbError("[GET /api/network/opportunities]", err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/network/opportunities
// Share a project as an opportunity.
// Snapshots project intelligence at creation time.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit("standard", getClientIp(req));
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const body = await req.json();
    const { project_id, asking_price, listing_notes, expires_days } = body;

    if (!project_id || !isValidUUID(project_id)) {
      return NextResponse.json(
        { error: "project_id required" },
        { status: 400 },
      );
    }

    const sql = await getDbReady();

    // Verify the project belongs to this user
    const projectRows = await sql`
      SELECT
        p.id, p.name, p.address, p.lat, p.lng,
        p.system_size_kw, p.bill_data, p.status AS project_status,
        p.city, p.state, p.zip,
        pd.roof_material, pd.roof_pitch, pd.roof_condition,
        pd.roof_age_years, pd.stories, pd.structure_type, pd.usable_roof_pct
      FROM projects p
      LEFT JOIN project_physical_data pd ON pd.project_id = p.id
      WHERE p.id = ${project_id}
        AND p.user_id = ${user.id}
      LIMIT 1
    `;

    if (!projectRows.length) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const p = projectRows[0] as Record<string, unknown>;

    // Check not already listed
    const existing = await sql`
      SELECT id FROM opportunities
       WHERE project_id = ${project_id}
         AND status IN ('open', 'claimed')
       LIMIT 1
    `;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "This project is already listed as an active opportunity." },
        { status: 409 },
      );
    }

    // Extract intelligence from bill_data
    const billData = (p.bill_data as Record<string, unknown>) ?? {};
    const annualKwh = (billData._annualKwh ?? billData.annual_kwh ?? null) as
      | number
      | null;
    const monthlyKwhAvg = (billData._averageMonthlyKwh ??
      billData.average_monthly_kwh ??
      null) as number | null;
    const utilityName = (billData._utilityName ??
      billData.utility_name ??
      null) as string | null;
    const utilityRate = (billData._utilityRatePerKwh ??
      billData.utility_rate_per_kwh ??
      null) as number | null;

    // Derive fit tags
    const roofPitch = (p.roof_pitch as string | null) ?? null;
    const pitchNum = roofPitch
      ? parseInt(roofPitch.replace(/[^0-9].*/, ""))
      : 0;
    const steep_roof = !isNaN(pitchNum) && pitchNum >= 6;

    // Parse city/state/zip from address or dedicated columns
    const stateCode =
      (p.state as string | null)?.toUpperCase().slice(0, 2) || null;
    const expiryDays = Math.min(
      90,
      Math.max(7, parseInt(String(expires_days ?? 30))),
    );

    const [opp] = await sql`
      INSERT INTO opportunities (
        created_by_user_id, project_id, source,
        site_name, address, city, state_code, zip, lat, lng,
        system_size_kw, annual_kwh, monthly_kwh_avg,
        utility_name, utility_rate_per_kwh,
        roof_material, roof_pitch, roof_condition, roof_age_years,
        stories, structure_type, usable_roof_pct,
        battery_candidate, steep_roof,
        asking_price, listing_notes,
        expires_at
      ) VALUES (
        ${user.id}, ${project_id}, 'contractor_shared',
        ${(p.name as string) || null},
        ${(p.address as string) || null},
        ${(p.city as string) || null},
        ${stateCode},
        ${(p.zip as string) || null},
        ${p.lat as number | null},
        ${p.lng as number | null},
        ${p.system_size_kw as number | null},
        ${annualKwh},
        ${monthlyKwhAvg},
        ${utilityName},
        ${utilityRate},
        ${p.roof_material as string | null},
        ${roofPitch},
        ${p.roof_condition as string | null},
        ${p.roof_age_years as number | null},
        ${p.stories as string | null},
        ${p.structure_type as string | null},
        ${p.usable_roof_pct as number | null},
        FALSE,
        ${steep_roof},
        ${asking_price ?? null},
        ${listing_notes ?? null},
        NOW() + (${expiryDays} || ' days')::INTERVAL
      )
      RETURNING *
    `;

    return NextResponse.json(
      { success: true, opportunity: opp },
      { status: 201 },
    );
  } catch (err: unknown) {
    return handleRouteDbError("[POST /api/network/opportunities]", err);
  }
}
