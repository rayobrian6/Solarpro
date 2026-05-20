import { getDbReady } from "@/lib/db-neon";
import { logNetworkEvent } from "@/lib/network/attributionTracker";
import {
  evaluateMarketplaceReleaseGate,
  type MarketplaceGateRow,
} from "@/lib/network/marketplaceReleaseGate";

type SqlClient = Awaited<ReturnType<typeof getDbReady>>;

export type MarketplaceInventoryAction =
  | "release"
  | "pause"
  | "unrelease"
  | "archive";

export interface MarketplaceInventoryTransitionInput {
  sql: SqlClient;
  opportunityId: string;
  adminUserId: string;
  reason?: string | null;
}

export interface MarketplaceInventoryReleaseFromIntakeInput {
  sql: SqlClient;
  intakeEventId: string;
  adminUserId: string;
  askingPrice?: number | null;
  listingNotes?: string | null;
  expiresDays?: number | null;
  claimMode?: "exclusive" | "shared";
  maxClaims?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "yes", "1", "y"].includes(value.toLowerCase());
  return false;
}

function sourceTypeFromIntake(row: Record<string, unknown>): string {
  const sourceSystem = str(row.source_system)?.toLowerCase() ?? "";
  const sourceChannel = str(row.source_channel)?.toLowerCase() ?? "";
  if (sourceSystem.includes("google") || sourceChannel.includes("google")) return "google_ads";
  if (sourceSystem.includes("facebook") || sourceSystem.includes("meta") || sourceChannel.includes("facebook") || sourceChannel.includes("meta")) return "facebook_ads";
  if (sourceSystem.includes("tiktok") || sourceChannel.includes("tiktok")) return "tiktok";
  if (sourceSystem.includes("seo") || sourceChannel.includes("seo")) return "seo";
  if (sourceSystem.includes("referral") || sourceChannel.includes("referral")) return "referral";
  if (sourceSystem.includes("partner") || sourceChannel.includes("partner")) return "partner";
  return "homeowner_direct";
}

function nameFromPayload(payload: Record<string, unknown>): string | null {
  const first = str(payload.first_name);
  const last = str(payload.last_name);
  const full = str(payload.homeowner_name) ?? str(payload.name);
  return full ?? ([first, last].filter(Boolean).join(" ") || null);
}

function timelineFromPayload(payload: Record<string, unknown>): string {
  const value = str(payload.timeline) ?? str(payload.homeowner_timeline);
  if (!value) return "unknown";
  if (["asap", "3_months", "6_months", "1_year", "just_researching", "unknown"].includes(value)) return value;
  if (["0_1_month", "1_3_months", "now"].includes(value)) return "asap";
  if (["3_6_months"].includes(value)) return "6_months";
  if (["6_12_months", "12_months"].includes(value)) return "1_year";
  return "unknown";
}

function ownershipFromPayload(payload: Record<string, unknown>): string {
  const value = str(payload.homeowner_status) ?? str(payload.home_ownership) ?? str(payload.homeowner_ownership);
  if (value === "own" || value === "rent") return value;
  return "unknown";
}

function mergedIntakeMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const payload = isRecord(row.payload) ? row.payload : {};
  const pipeline = isRecord(row.pipeline_result) ? row.pipeline_result : {};
  const validation = isRecord(row.validation_result) ? row.validation_result : {};
  const metadata = isRecord(payload.intake_metadata) ? payload.intake_metadata : {};
  const qualification = isRecord(pipeline.qualification)
    ? pipeline.qualification
    : isRecord(payload.qualification)
      ? payload.qualification
      : {};
  const operational = isRecord(pipeline.operational) ? pipeline.operational : {};

  return {
    ...metadata,
    source_event_id: row.event_id,
    intake_event_id: row.id,
    event_type: row.event_type,
    action: row.action,
    source_system: row.source_system,
    source_channel: row.source_channel,
    funnel_id: row.funnel_id,
    campaign_id: row.campaign_id,
    qualification,
    operational,
    validation,
  };
}

export async function releaseMarketplaceInventoryFromIntake({
  sql,
  intakeEventId,
  adminUserId,
  askingPrice = null,
  listingNotes = null,
  expiresDays = 30,
  claimMode = "exclusive",
  maxClaims = null,
}: MarketplaceInventoryReleaseFromIntakeInput) {
  const intakeRows = await sql`
    SELECT *
    FROM intake_events
    WHERE id = ${intakeEventId}
    LIMIT 1
  `;
  const intake = intakeRows[0] as Record<string, unknown> | undefined;
  if (!intake) {
    return { ok: false as const, status: 404, error: "Intake event not found" };
  }

  const payload = isRecord(intake.payload) ? intake.payload : {};
  const pipeline = isRecord(intake.pipeline_result) ? intake.pipeline_result : {};
  const qualification = isRecord(pipeline.qualification)
    ? pipeline.qualification
    : isRecord(payload.qualification)
      ? payload.qualification
      : {};
  const operational = isRecord(pipeline.operational) ? pipeline.operational : {};
  const intakeMetadata = mergedIntakeMetadata(intake);
  const releaseGateRow: MarketplaceGateRow = {
    id: intake.id,
    status: "scored",
    screening_status: "approved",
    auto_decision: "pass",
    intake_metadata: intakeMetadata,
    raw_payload: payload,
    qualification_intelligence: qualification,
  };
  const releaseGate = evaluateMarketplaceReleaseGate(releaseGateRow);

  if (!releaseGate.ok) {
    await logNetworkEvent({
      event_type: "opportunity.release_blocked",
      event_category: "opportunity",
      admin_user_id: adminUserId,
      data: {
        source: "marketplace_inventory_v1",
        intake_event_id: intakeEventId,
        missing: releaseGate.missing,
        release_gate_result: releaseGate,
      },
      triggered_by: "admin",
    });
    return {
      ok: false as const,
      status: 409,
      error: "Marketplace release gate blocked this intake event",
      missing: releaseGate.missing,
      release_gate_result: releaseGate,
    };
  }

  const existing = await sql`
    SELECT id, status, marketplace_status
    FROM network_opportunities
    WHERE intake_event_id = ${intakeEventId}
    LIMIT 1
  `;
  if (existing.length) {
    return transitionMarketplaceInventory({
      sql,
      opportunityId: (existing[0] as Record<string, unknown>).id as string,
      adminUserId,
      action: "release",
      reason: "release_existing_intake_inventory",
      releaseGate,
    });
  }

  const expiryDays = Math.min(90, Math.max(1, Math.floor(expiresDays ?? 30)));
  const effectiveClaimMode = claimMode === "shared" ? "shared" : "exclusive";
  const effectiveMaxClaims = effectiveClaimMode === "shared" ? Math.max(2, Math.min(10, Math.floor(maxClaims ?? 3))) : 1;
  const locationState = str(payload.state)?.toUpperCase().slice(0, 2) ?? null;
  const locationZip = str(payload.zip) ?? str(payload.postal_code);
  const addressLine1 = str(payload.address_line1) ?? str(payload.property_address);

  const rows = await sql`
    INSERT INTO network_opportunities (
      intake_event_id,
      source_type,
      status,
      marketplace_status,
      intake_at,
      screened_at,
      scored_at,
      live_at,
      released_at,
      released_by,
      expires_at,
      release_gate_result,
      homeowner_name,
      homeowner_email,
      homeowner_phone,
      homeowner_ownership,
      homeowner_timeline,
      homeowner_financing_interest,
      address,
      location_city,
      location_state,
      location_zip,
      utility_provider,
      monthly_usage_avg_kwh,
      utility_rate_per_kwh,
      estimated_system_size_kw,
      roof_age_years,
      battery_candidate,
      opportunity_score,
      opportunity_grade,
      screening_status,
      asking_price,
      listing_notes,
      source_channel,
      funnel_id,
      campaign_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      gclid,
      fbclid,
      raw_payload,
      intake_metadata,
      claim_mode,
      max_claims,
      claim_count
    ) VALUES (
      ${intakeEventId},
      ${sourceTypeFromIntake(intake)},
      'live',
      'live',
      ${intake.occurred_at as string | null},
      NOW(),
      NOW(),
      NOW(),
      NOW(),
      ${adminUserId},
      NOW() + (${expiryDays} || ' days')::INTERVAL,
      ${JSON.stringify(releaseGate)},
      ${nameFromPayload(payload)},
      ${str(payload.email)},
      ${str(payload.phone)},
      ${ownershipFromPayload(payload)},
      ${timelineFromPayload(payload)},
      ${bool(payload.financing_interest) || bool(payload.homeowner_financing_interest) || bool(qualification.finance_readiness)},
      ${addressLine1},
      ${str(payload.city)},
      ${locationState},
      ${locationZip},
      ${str(payload.utility_provider)},
      ${num(payload.monthly_usage_avg_kwh) ?? num(payload.average_monthly_kwh) ?? num(payload.monthly_bill_amount)},
      ${num(payload.utility_rate_per_kwh) ?? num(payload.current_electricity_rate)},
      ${num(payload.estimated_system_size_kw)},
      ${num(payload.roof_age)},
      ${bool(payload.battery_interest) || bool(qualification.battery_readiness)},
      ${num(qualification.lead_score)},
      ${str(qualification.lead_grade) ?? null},
      'approved',
      ${askingPrice},
      ${listingNotes},
      ${str(intake.source_channel)},
      ${str(intake.funnel_id)},
      ${str(intake.campaign_id)},
      ${str(intake.utm_source)},
      ${str(intake.utm_medium)},
      ${str(intake.utm_campaign)},
      ${str(intake.utm_content)},
      ${str(intake.utm_term)},
      ${str(intake.gclid)},
      ${str(intake.fbclid)},
      ${JSON.stringify({ ...payload, operational })},
      ${JSON.stringify(intakeMetadata)},
      ${effectiveClaimMode},
      ${effectiveMaxClaims},
      0
    )
    RETURNING *
  `;
  const opportunity = rows[0] as Record<string, unknown>;

  await sql`
    UPDATE intake_events
    SET opportunity_id = ${opportunity.id as string}
    WHERE id = ${intakeEventId}
  `;

  await logNetworkEvent({
    event_type: "opportunity.published",
    event_category: "opportunity",
    opportunity_id: opportunity.id as string,
    admin_user_id: adminUserId,
    from_status: "intake_event",
    to_status: "live",
    data: {
      source: "marketplace_inventory_v1",
      intake_event_id: intakeEventId,
      release_gate_result: releaseGate,
      marketplace_status: "live",
      claim_mode: effectiveClaimMode,
      max_claims: effectiveMaxClaims,
    },
    triggered_by: "admin",
  });

  return {
    ok: true as const,
    status: 201,
    action: "release",
    opportunity,
    release_gate_result: releaseGate,
  };
}

export async function transitionMarketplaceInventory({
  sql,
  opportunityId,
  adminUserId,
  action,
  reason = null,
  releaseGate,
}: MarketplaceInventoryTransitionInput & {
  action: MarketplaceInventoryAction;
  releaseGate?: ReturnType<typeof evaluateMarketplaceReleaseGate>;
}) {
  const rows = await sql`
    SELECT no.id, no.status, no.marketplace_status, no.screening_status, no.intake_metadata, no.raw_payload, osq.auto_decision, osq.override_decision
    FROM network_opportunities no
    LEFT JOIN opportunity_screening_queue osq ON osq.opportunity_id = no.id
    WHERE no.id = ${opportunityId}
    LIMIT 1
  `;
  const current = rows[0] as Record<string, unknown> | undefined;
  if (!current) return { ok: false as const, status: 404, error: "Opportunity not found" };

  const gate = releaseGate ?? evaluateMarketplaceReleaseGate(current);
  const fromStatus = str(current.status) ?? "unknown";
  const fromMarketplaceStatus = str(current.marketplace_status) ?? "not_released";

  if (action === "release" && !gate.ok) {
    await logNetworkEvent({
      event_type: "opportunity.release_blocked",
      event_category: "opportunity",
      opportunity_id: opportunityId,
      admin_user_id: adminUserId,
      from_status: fromStatus,
      to_status: fromStatus,
      data: {
        source: "marketplace_inventory_v1",
        missing: gate.missing,
        release_gate_result: gate,
        reason,
      },
      triggered_by: "admin",
    });
    return { ok: false as const, status: 409, error: "Marketplace release gate blocked this opportunity", missing: gate.missing, release_gate_result: gate };
  }

  const updateRows =
    action === "release"
      ? await sql`
          UPDATE network_opportunities
          SET status = 'live', marketplace_status = 'live', live_at = COALESCE(live_at, NOW()), released_at = COALESCE(released_at, NOW()), released_by = COALESCE(released_by, ${adminUserId}), release_gate_result = ${JSON.stringify(gate)}, inventory_transition_reason = ${reason}, updated_at = NOW()
          WHERE id = ${opportunityId}
          RETURNING *
        `
      : action === "pause"
        ? await sql`
            UPDATE network_opportunities
            SET status = 'scored', marketplace_status = 'paused', paused_at = NOW(), paused_by = ${adminUserId}, inventory_transition_reason = ${reason}, updated_at = NOW()
            WHERE id = ${opportunityId}
              AND status = 'live'
            RETURNING *
          `
        : action === "unrelease"
          ? await sql`
              UPDATE network_opportunities
              SET status = 'scored', marketplace_status = 'unreleased', live_at = NULL, unreleased_at = NOW(), unreleased_by = ${adminUserId}, inventory_transition_reason = ${reason}, updated_at = NOW()
              WHERE id = ${opportunityId}
                AND status IN ('live','scored','routed')
              RETURNING *
            `
          : await sql`
              UPDATE network_opportunities
              SET status = 'withdrawn', marketplace_status = 'archived', live_at = NULL, archived_at = NOW(), archived_by = ${adminUserId}, inventory_transition_reason = ${reason}, updated_at = NOW()
              WHERE id = ${opportunityId}
                AND status NOT IN ('claimed','closed_won','closed_lost')
              RETURNING *
            `;

  if (!updateRows.length) {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot ${action} opportunity from its current state`,
    };
  }

  const updated = updateRows[0] as Record<string, unknown>;
  const toStatus = str(updated.status) ?? fromStatus;
  const eventType: Record<MarketplaceInventoryAction, string> = {
    release: "opportunity.published",
    pause: "opportunity.paused",
    unrelease: "opportunity.unpublished",
    archive: "opportunity.archived",
  };

  await logNetworkEvent({
    event_type: eventType[action],
    event_category: "opportunity",
    opportunity_id: opportunityId,
    admin_user_id: adminUserId,
    from_status: fromStatus,
    to_status: toStatus,
    data: {
      source: "marketplace_inventory_v1",
      action,
      reason,
      from_marketplace_status: fromMarketplaceStatus,
      to_marketplace_status: updated.marketplace_status,
      release_gate_result: gate,
    },
    triggered_by: "admin",
  });

  return {
    ok: true as const,
    status: 200,
    action,
    opportunity: updated,
    release_gate_result: gate,
  };
}
