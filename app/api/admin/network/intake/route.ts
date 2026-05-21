/**
 * /api/admin/network/intake/route.ts
 *
 * Admin API — Intake Feed Dashboard
 *
 * GET — Intake feed with filters + aggregate stats:
 *   ?status=           filter by opportunity/event review status
 *   ?source_system=    filter by source system
 *   ?source_channel=   filter by source channel
 *   ?from=             ISO date range start
 *   ?to=               ISO date range end
 *   ?search=           search name/email/phone/address/operational fields
 *   ?debug=1           include hidden/failed/malformed event rows for admins
 *   ?page=             pagination (default 1)
 *   ?limit=            page size (default 25, max 100)
 *
 * Returns one canonical Intake Feed composed from:
 *   - network_opportunities that already came through canonical intake, and
 *   - review-first intake_events rows with opportunity_id IS NULL.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import { requireAdminApi } from "@/lib/adminAuth";
import { randomUUID } from "crypto";
import {
  applyOperatorReviewAction,
  deriveLeadOpsSummary,
  deriveReleaseReadiness,
  isOperatorReviewAction,
  operationalIntelligence,
  safeOperationalLog,
  stateFromPipelineResult,
} from "@/lib/intake/operationalLifecycle";

type IntakeFeedStage =
  | "auth"
  | "db_connect"
  | "request_parse"
  | "feed_query"
  | "stats_query"
  | "today_events_query"
  | "top_sources_query"
  | "validation_stats_query"
  | "review_event_lookup"
  | "review_event_insert"
  | "review_projection_update";

function intakeFeedError(stage: IntakeFeedStage, error: unknown) {
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
      error: "Intake Feed failed",
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

function bodyString(
  body: Record<string, unknown>,
  key: string,
  max = 2000,
): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function bodyBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = body[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "yes", "1", "on"].includes(normalized)) return true;
    if (["false", "no", "0", "off"].includes(normalized)) return false;
  }
  return null;
}

function sanitizeOperatorDetails(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    contact_method: bodyString(body, "contact_method", 80),
    reached_homeowner: bodyBoolean(body, "reached_homeowner"),
    voicemail_left: bodyBoolean(body, "voicemail_left"),
    next_step: bodyString(body, "next_step", 500),
    follow_up_at: bodyString(body, "follow_up_at", 80),
    callback_at: bodyString(body, "callback_at", 80),
    requested_callback_at: bodyString(body, "requested_callback_at", 80),
    callback_reason: bodyString(body, "callback_reason", 500),
    workflow_reason: bodyString(body, "workflow_reason", 1000),
    dormant_until: bodyString(body, "dormant_until", 80),
    dormant_reason: bodyString(body, "dormant_reason", 1000),
    financing_path: bodyString(body, "financing_path", 120),
    credit_band: bodyString(body, "credit_band", 120),
    income_band: bodyString(body, "income_band", 120),
    financing_notes: bodyString(body, "financing_notes", 2000),
    qualification_reason: bodyString(body, "qualification_reason", 1000),
    operator_confidence: bodyString(body, "operator_confidence", 80),
    missing_items_resolved: bodyBoolean(body, "missing_items_resolved"),
    final_approval_note: bodyString(body, "final_approval_note", 2000),
    contractor_facing_notes: bodyString(body, "contractor_facing_notes", 2000),
    rejection_reason: bodyString(body, "rejection_reason", 500),
    archive_reason: bodyString(body, "archive_reason", 500),
    is_test_lead: bodyBoolean(body, "is_test_lead"),
    utility_bill_review: bodyString(body, "utility_bill_review", 120),
    assigned_operator_id: bodyString(body, "assigned_operator_id", 120),
    assigned_operator_name: bodyString(body, "assigned_operator_name", 160),
    follow_up_reason: bodyString(body, "follow_up_reason", 500),
    follow_up_priority: bodyString(body, "follow_up_priority", 80),
    follow_up_channel: bodyString(body, "follow_up_channel", 80),
    follow_up_completed_at: bodyString(body, "follow_up_completed_at", 80),
    snooze_until: bodyString(body, "snooze_until", 80),
    note_type: bodyString(body, "note_type", 80),
    contact_result: bodyString(body, "contact_result", 80),
    contact_duration_seconds: bodyString(body, "contact_duration_seconds", 40),
    task_id: bodyString(body, "task_id", 160),
    task_title: bodyString(body, "task_title", 240),
    task_owner_id: bodyString(body, "task_owner_id", 120),
    task_owner_name: bodyString(body, "task_owner_name", 160),
    task_due_at: bodyString(body, "task_due_at", 80),
    task_priority: bodyString(body, "task_priority", 80),
    financing_stage: bodyString(body, "financing_stage", 120),
    proposal_stage: bodyString(body, "proposal_stage", 120),
    release_checklist:
      body.release_checklist && typeof body.release_checklist === "object"
        ? body.release_checklist
        : null,
  };
}

function requiredOperatorFields(
  action: unknown,
  details: Record<string, unknown>,
  notes: string | null,
): string[] {
  const missing: string[] = [];
  const has = (key: string) =>
    typeof details[key] === "string" && !!String(details[key]).trim();
  if (action === "mark_no_answer") {
    if (!has("contact_method")) missing.push("contact_method");
    if (!has("follow_up_at") && !has("requested_callback_at"))
      missing.push("follow_up_at");
  }
  if (action === "mark_needs_follow_up") {
    if (
      !has("follow_up_at") &&
      !has("callback_at") &&
      !has("requested_callback_at")
    )
      missing.push("requested_callback_at");
    if (!has("callback_reason")) missing.push("callback_reason");
  }
  if (action === "reopen_callback") {
    if (
      !has("callback_at") &&
      !has("follow_up_at") &&
      !has("requested_callback_at")
    )
      missing.push("callback_at");
    if (!has("callback_reason") && !has("workflow_reason") && !notes)
      missing.push("callback_reason");
  }
  if (
    action === "reopen_qualification" ||
    action === "reopen_financing" ||
    action === "reopen_documents"
  ) {
    if (!has("workflow_reason") && !notes) missing.push("workflow_reason");
  }
  if (action === "mark_dormant") {
    if (!has("dormant_reason") && !notes) missing.push("dormant_reason");
  }
  if (action === "mark_financing_ready") {
    if (!has("financing_path")) missing.push("financing_path");
  }
  if (action === "mark_qualified") {
    if (!has("qualification_reason")) missing.push("qualification_reason");
    if (!has("operator_confidence")) missing.push("operator_confidence");
  }
  if (action === "approve_for_marketplace") {
    if (!has("final_approval_note") && !notes)
      missing.push("final_approval_note");
  }
  if (action === "reject_lead") {
    if (!has("rejection_reason")) missing.push("rejection_reason");
  }
  if (action === "archive_lead") {
    if (!has("archive_reason")) missing.push("archive_reason");
  }
  if (action === "assign_operator" || action === "transfer_operator") {
    if (!has("assigned_operator_id")) missing.push("assigned_operator_id");
    if (!has("assigned_operator_name")) missing.push("assigned_operator_name");
  }
  if (action === "add_internal_note") {
    if (!notes) missing.push("notes");
  }
  if (action === "log_contact_attempt") {
    if (!has("contact_method")) missing.push("contact_method");
    if (!has("contact_result")) missing.push("contact_result");
  }
  if (action === "create_follow_up_task") {
    if (!has("task_title")) missing.push("task_title");
    if (!has("task_due_at") && !has("follow_up_at"))
      missing.push("task_due_at");
  }
  if (action === "complete_follow_up_task") {
    if (!has("task_id")) missing.push("task_id");
  }
  if (action === "update_financing_stage") {
    if (!has("financing_stage")) missing.push("financing_stage");
  }
  if (action === "update_proposal_stage") {
    if (!has("proposal_stage")) missing.push("proposal_stage");
  }
  return missing;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let stage: IntakeFeedStage = "auth";

  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    stage = "db_connect";
    const sql = await getDbReady();

    stage = "request_parse";
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") || null;
    const source_system = searchParams.get("source_system") || null;
    const source_channel = searchParams.get("source_channel") || null;
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;
    const search = searchParams.get("search") || null;
    const includeDebug = ["1", "true", "yes"].includes(
      (searchParams.get("debug") || "").toLowerCase(),
    );
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "25")),
    );
    const offset = (page - 1) * limit;

    stage = "feed_query";
    const feedRows = await sql`
      WITH opportunity_rows AS (
        SELECT
          no.id::text AS id,
          'opportunity'::text AS intake_record_type,
          no.id::text AS opportunity_id,
          NULL::text AS event_id,
          NULL::text AS event_type,
          CASE WHEN no.status = 'live' AND COALESCE(no.marketplace_status, 'not_released') = 'live' THEN 'marketplace_live' ELSE 'converted_opportunity' END AS review_status,
          no.created_at AS received_at,
          COALESCE(no.source_system, no.source_type)::text AS source_funnel,
          true AS ready_for_review,
          '[]'::jsonb AS needs_missing_data,
          false AS qualification_skipped,
          false AS bill_attachment_metadata_only,
          '[]'::jsonb AS validation_warning,
          no.status::text AS status,
          COALESCE(no.first_name, SPLIT_PART(no.homeowner_name, ' ', 1)) AS first_name,
          COALESCE(no.last_name, NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(no.homeowner_name, ''), '^[^[:space:]]+[[:space:]]*', '')), '')) AS last_name,
          COALESCE(no.email, no.homeowner_email) AS email,
          COALESCE(no.phone, no.homeowner_phone) AS phone,
          COALESCE(no.address_line1, no.address) AS address_line1,
          no.location_city AS city,
          no.location_state AS state,
          COALESCE(no.location_zip, no.zip) AS zip,
          no.source_system,
          no.source_channel,
          COALESCE(
            no.monthly_bill_amount,
            CASE
              WHEN COALESCE(no.raw_payload->>'monthly_bill_amount', no.raw_payload->>'monthly_bill', '') ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN COALESCE(no.raw_payload->>'monthly_bill_amount', no.raw_payload->>'monthly_bill')::numeric
              ELSE NULL
            END
          ) AS monthly_bill_amount,
          no.utm_source,
          no.utm_medium,
          no.utm_campaign,
          no.utm_content,
          no.utm_term,
          no.gclid,
          no.fbclid,
          no.duplicate_flag AS is_duplicate,
          no.duplicate_flag AS is_duplicate_flagged,
          no.duplicate_score,
          no.duplicate_of_id::text AS duplicate_of_id,
          no.opportunity_score,
          no.opportunity_grade,
          false AS consent_given,
          no.created_at,
          no.updated_at,
          eq.status AS enrichment_status,
          eq.property_status,
          eq.solar_status,
          eq.utility_status,
          eq.completed_at AS enrichment_completed_at,
          eq.duration_ms AS enrichment_duration_ms,
          CASE WHEN no.peak_sun_hours_annual IS NOT NULL THEN ROUND((no.peak_sun_hours_annual / 365.0)::numeric, 2) ELSE NULL::numeric END AS peak_sun_hours_daily,
          no.estimated_system_size_kw AS recommended_system_kw,
          no.estimated_annual_savings AS annual_savings_year1,
          no.estimated_project_value AS estimated_system_cost_net,
          no.estimated_payback_yrs AS payback_period_years,
          no.utility_provider AS utility_name,
          no.utility_rate_per_kwh AS electricity_rate_kwh,
          NULL::boolean AS net_metering_available,
          (SELECT action FROM intake_events WHERE opportunity_id = no.id ORDER BY occurred_at DESC LIMIT 1) AS last_event_action,
          (SELECT occurred_at FROM intake_events WHERE opportunity_id = no.id ORDER BY occurred_at DESC LIMIT 1) AS last_event_at,
          NULL::text AS error_code,
          NULL::text AS error_message,
          '{}'::jsonb AS validation_result,
          '{}'::jsonb AS duplicate_result,
          jsonb_build_object(
            'review_status', CASE WHEN no.status = 'live' AND COALESCE(no.marketplace_status, 'not_released') = 'live' THEN 'marketplace_live' ELSE 'converted_opportunity' END,
            'operational', COALESCE(no.intake_metadata->'operational', '{}'::jsonb)
          ) AS pipeline_result,
          COALESCE(no.intake_metadata, '{}'::jsonb) AS intake_metadata,
          COALESCE(no.intake_metadata->'qualification', '{}'::jsonb) AS qualification_payload,
          COALESCE(no.intake_metadata->'qualification', '{}'::jsonb) AS qualification_intelligence,
          COALESCE(no.intake_metadata->>'source_event_id', no.intake_event_id::text) AS qualification_event_id,
          COALESCE(no.intake_metadata->'qualification'->>'qualification_status', no.intake_metadata->'qualification'->>'lead_grade') AS qualification_status,
          COALESCE(no.opportunity_grade, no.intake_metadata->'qualification'->>'lead_grade') AS lead_grade,
          COALESCE(
            no.homeowner_financing_interest,
            CASE WHEN LOWER(COALESCE(no.intake_metadata->'qualification'->>'finance_readiness', '')) IN ('true', '1', 'yes', 'y') THEN true ELSE NULL END
          ) AS finance_readiness,
          COALESCE(
            no.battery_candidate,
            CASE WHEN LOWER(COALESCE(no.intake_metadata->'qualification'->>'battery_readiness', '')) IN ('true', '1', 'yes', 'y') THEN true ELSE NULL END
          ) AS battery_readiness,
          COALESCE(no.intake_metadata->'qualification'->'normalized'->>'estimated_income_band', no.intake_metadata->'qualification'->>'estimated_income_band') AS estimated_income_band,
          COALESCE(no.intake_metadata->'qualification'->'normalized'->>'estimated_credit_band', no.intake_metadata->'qualification'->>'estimated_credit_band') AS estimated_credit_band,
          COALESCE(no.intake_metadata->'qualification'->'normalized'->>'sunlight_confidence', no.intake_metadata->'qualification'->>'sunlight_confidence') AS sunlight_confidence,
          COALESCE(no.intake_metadata->'qualification'->'normalized'->>'property_type', no.intake_metadata->'qualification'->>'property_type') AS property_type,
          no.utility_provider::text AS utility_provider,
          COALESCE(no.raw_payload->>'battery_interest', no.intake_metadata->>'battery_interest', CASE WHEN no.battery_candidate THEN 'yes' ELSE NULL END) AS battery_interest,
          COALESCE(no.home_ownership, no.homeowner_ownership)::text AS homeowner_status,
          COALESCE(no.raw_payload->>'preferred_contact_method', no.intake_metadata->>'preferred_contact_method') AS preferred_contact_method,
          COALESCE(no.homeowner_timeline, no.raw_payload->>'timeline', no.intake_metadata->>'timeline') AS timeline,
          no.roof_age_years::text AS roof_age,
          '{}'::jsonb AS bill_metadata,
          COALESCE(no.intake_metadata->'bill_intelligence', '{}'::jsonb) AS bill_intelligence,
          COALESCE(no.raw_payload->'bill_marketplace_projection', no.intake_metadata->'bill_marketplace_projection', '{}'::jsonb) AS bill_marketplace_projection,
          false AS debug_visible
        FROM network_opportunities no
        LEFT JOIN enrichment_queue eq ON eq.opportunity_id = no.id
        WHERE (no.source_system IS NOT NULL OR no.source_type IS NOT NULL)
      ),
      event_rows AS (
        SELECT
          ie.event_id AS id,
          'intake_event'::text AS intake_record_type,
          NULL::text AS opportunity_id,
          ie.event_id,
          ie.event_type::text AS event_type,
          COALESCE(ie.pipeline_result->>'review_status', CASE WHEN ie.action = 'pending_review' THEN 'pending_operator_review' ELSE 'not_reviewable' END) AS review_status,
          ie.occurred_at AS received_at,
          COALESCE(ie.payload->>'funnel_slug', ie.event_source, ie.source_system)::text AS source_funnel,
          (
            ie.action = 'pending_review'
            AND COALESCE(ie.payload->>'consent_given', 'false') = 'true'
            AND COALESCE(ie.payload->>'phone', ie.payload->>'email', '') <> ''
            AND COALESCE(ie.payload->>'address_line1', ie.payload->>'property_address', '') <> ''
            AND COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill', '') <> ''
          ) AS ready_for_review,
          to_jsonb(array_remove(ARRAY[
            CASE WHEN COALESCE(ie.payload->>'phone', ie.payload->>'email', '') = '' THEN 'contact' END,
            CASE WHEN COALESCE(ie.payload->>'address_line1', ie.payload->>'property_address', '') = '' THEN 'property_address' END,
            CASE WHEN COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill', '') = '' THEN 'average_monthly_bill' END,
            CASE WHEN COALESCE(ie.payload->>'consent_given', 'false') <> 'true' THEN 'consent' END
          ]::text[], NULL)) AS needs_missing_data,
          (q.event_id IS NULL) AS qualification_skipped,
          COALESCE((ie.payload->>'bill_attachment_metadata_only')::boolean, false) AS bill_attachment_metadata_only,
          COALESCE(ie.validation_result->'warnings', '[]'::jsonb) AS validation_warning,
          CASE
            WHEN ie.action = 'pending_review' THEN 'pending_review'
            WHEN ie.action IN ('validation_failed', 'malformed', 'error') THEN ie.action
            ELSE COALESCE(ie.action, 'pending_review')
          END AS status,
          ie.payload->>'first_name' AS first_name,
          ie.payload->>'last_name' AS last_name,
          ie.payload->>'email' AS email,
          ie.payload->>'phone' AS phone,
          COALESCE(ie.payload->>'address_line1', ie.payload->>'property_address') AS address_line1,
          ie.payload->>'city' AS city,
          ie.payload->>'state' AS state,
          ie.payload->>'zip' AS zip,
          ie.source_system,
          ie.source_channel,
          CASE
            WHEN COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              AND COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill')::numeric BETWEEN 0 AND 10000
              THEN COALESCE(ie.payload->>'monthly_bill_amount', ie.payload->>'average_monthly_bill')::numeric
            ELSE NULL
          END AS monthly_bill_amount,
          ie.utm_source,
          ie.utm_medium,
          ie.utm_campaign,
          ie.utm_content,
          ie.utm_term,
          ie.gclid,
          ie.fbclid,
          false AS is_duplicate,
          false AS is_duplicate_flagged,
          CASE
            WHEN COALESCE(ie.duplicate_result->>'score', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (ie.duplicate_result->>'score')::numeric
            ELSE NULL
          END AS duplicate_score,
          ie.duplicate_result->>'match_id' AS duplicate_of_id,
          NULL::numeric AS opportunity_score,
          NULL::text AS opportunity_grade,
          COALESCE((ie.payload->>'consent_given')::boolean, false) AS consent_given,
          ie.occurred_at AS created_at,
          ie.created_at AS updated_at,
          'pending_review'::text AS enrichment_status,
          NULL::text AS property_status,
          NULL::text AS solar_status,
          NULL::text AS utility_status,
          NULL::timestamptz AS enrichment_completed_at,
          NULL::integer AS enrichment_duration_ms,
          NULL::numeric AS peak_sun_hours_daily,
          NULL::numeric AS recommended_system_kw,
          NULL::numeric AS annual_savings_year1,
          NULL::numeric AS estimated_system_cost_net,
          NULL::numeric AS payback_period_years,
          ie.payload->>'utility_provider' AS utility_name,
          NULL::numeric AS electricity_rate_kwh,
          NULL::boolean AS net_metering_available,
          ie.action AS last_event_action,
          ie.occurred_at AS last_event_at,
          ie.error_code,
          ie.error_message,
          ie.validation_result,
          ie.duplicate_result,
          ie.pipeline_result,
          ie.payload AS intake_metadata,
          COALESCE(q.payload, '{}'::jsonb) AS qualification_payload,
          COALESCE(q.payload->'intelligence', '{}'::jsonb) AS qualification_intelligence,
          q.event_id AS qualification_event_id,
          COALESCE(q.payload->'intelligence'->>'qualification_status', q.payload->>'qualification_status') AS qualification_status,
          COALESCE(q.payload->'intelligence'->>'lead_grade', q.payload->>'lead_grade') AS lead_grade,
          CASE
            WHEN q.payload->'intelligence' ? 'finance_readiness'
              THEN (q.payload->'intelligence'->>'finance_readiness')::boolean
            WHEN q.payload ? 'finance_readiness'
              THEN (q.payload->>'finance_readiness')::boolean
            ELSE NULL
          END AS finance_readiness,
          CASE
            WHEN q.payload->'intelligence' ? 'battery_readiness'
              THEN (q.payload->'intelligence'->>'battery_readiness')::boolean
            WHEN q.payload ? 'battery_readiness'
              THEN (q.payload->>'battery_readiness')::boolean
            ELSE NULL
          END AS battery_readiness,
          COALESCE(q.payload->'intelligence'->'normalized'->>'estimated_income_band', q.payload->>'estimated_income_band', q.payload->'qualification'->>'estimated_income_band') AS estimated_income_band,
          COALESCE(q.payload->'intelligence'->'normalized'->>'estimated_credit_band', q.payload->>'estimated_credit_band', q.payload->'qualification'->>'estimated_credit_band') AS estimated_credit_band,
          COALESCE(q.payload->'intelligence'->'normalized'->>'sunlight_confidence', q.payload->>'sunlight_confidence', q.payload->'qualification'->>'sunlight_confidence') AS sunlight_confidence,
          COALESCE(q.payload->'intelligence'->'normalized'->>'property_type', q.payload->>'property_type', q.payload->'qualification'->>'property_type') AS property_type,
          ie.payload->>'utility_provider' AS utility_provider,
          ie.payload->>'battery_interest' AS battery_interest,
          COALESCE(ie.payload->>'homeowner_status', ie.payload->>'home_ownership') AS homeowner_status,
          ie.payload->>'preferred_contact_method' AS preferred_contact_method,
          ie.payload->>'timeline' AS timeline,
          COALESCE(ie.payload->>'roof_age', ie.payload->>'roof_age_years') AS roof_age,
          COALESCE(ie.payload->'bill_metadata', '{}'::jsonb) AS bill_metadata,
          COALESCE(ie.payload->'bill_intelligence', '{}'::jsonb) AS bill_intelligence,
          COALESCE(ie.payload->'bill_marketplace_projection', '{}'::jsonb) AS bill_marketplace_projection,
          (
            ie.action IN ('validation_failed', 'malformed', 'error', 'archived', 'rejected', 'bad_lead')
            OR COALESCE((ie.pipeline_result->'operational'->>'archived')::boolean, false) = true
            OR COALESCE((ie.pipeline_result->'operational'->>'rejected')::boolean, false) = true
            OR COALESCE((ie.payload->>'is_test')::boolean, false) = true
            OR COALESCE((ie.payload->>'is_simulated')::boolean, false) = true
          ) AS debug_visible
        FROM intake_events ie
        LEFT JOIN LATERAL (
          SELECT qie.event_id, qie.payload, qie.occurred_at
          FROM intake_events qie
          WHERE qie.event_type = 'homeowner_qualification'
            AND (
              qie.original_event_id = ie.event_id OR
              qie.payload->>'original_event_id' = ie.event_id
            )
          ORDER BY qie.occurred_at DESC
          LIMIT 1
        ) q ON true
        WHERE ie.opportunity_id IS NULL
          AND ie.event_type = 'homeowner_intake'
      ),
      combined AS (
        SELECT * FROM opportunity_rows
        UNION ALL
        SELECT * FROM event_rows
      ),
      filtered AS (
        SELECT * FROM combined c
        WHERE (${includeDebug}::boolean OR COALESCE(c.debug_visible, false) = false)
          AND (${status}::text IS NULL OR c.status = ${status})
          AND (${source_system}::text IS NULL OR c.source_system = ${source_system})
          AND (${source_channel}::text IS NULL OR c.source_channel = ${source_channel})
          AND (${from}::text IS NULL OR c.created_at >= ${from}::timestamptz)
          AND (${to}::text IS NULL OR c.created_at <= (${to}::text || 'T23:59:59Z')::timestamptz)
          AND (${search}::text IS NULL OR (
            c.first_name ILIKE ('%' || ${search} || '%') OR
            c.last_name ILIKE ('%' || ${search} || '%') OR
            c.email ILIKE ('%' || ${search} || '%') OR
            c.phone ILIKE ('%' || ${search} || '%') OR
            c.address_line1 ILIKE ('%' || ${search} || '%') OR
            c.city ILIKE ('%' || ${search} || '%') OR
            c.utility_provider ILIKE ('%' || ${search} || '%') OR
            c.battery_interest ILIKE ('%' || ${search} || '%') OR
            c.timeline ILIKE ('%' || ${search} || '%')
          ))
      )
      SELECT *, COUNT(*) OVER() AS __total
      FROM filtered
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = Number(feedRows[0]?.__total) || 0;
    const opportunities = feedRows.map((row: Record<string, unknown>) => {
      const { __total, ...rest } = row;
      const operational = stateFromPipelineResult(rest.pipeline_result);
      const intelligence = operationalIntelligence({
        operational,
        intake: rest.intake_metadata,
        qualification: rest.qualification_intelligence,
        validation: rest.validation_result,
        receivedAt: rest.received_at ?? rest.created_at,
      });
      const billMetadata =
        rest.bill_metadata && typeof rest.bill_metadata === "object"
          ? (rest.bill_metadata as Record<string, unknown>)
          : {};
      const qualificationPayload =
        rest.qualification_payload &&
        typeof rest.qualification_payload === "object"
          ? (rest.qualification_payload as Record<string, unknown>)
          : {};
      const attachmentCompleteness =
        billMetadata.storage_status === "stored"
          ? "complete"
          : billMetadata.filename
            ? "metadata_only"
            : "missing";
      const qualificationCompleteness =
        Object.keys(qualificationPayload).length > 0 ? "complete" : "missing";
      const leadOpsSummary = deriveLeadOpsSummary({
        operational,
        reviewStatus: rest.review_status,
        readyForReview: rest.ready_for_review,
        qualificationCompleteness,
        attachmentCompleteness,
        releaseReadiness: intelligence.release_readiness as any,
        receivedAt: rest.received_at ?? rest.created_at,
      });
      return {
        ...rest,
        operational_lifecycle_status: operational.lifecycle_status,
        operational_state: operational,
        review_priority: intelligence.review_priority,
        qualification_confidence: intelligence.qualification_confidence,
        financing_readiness_reviewed: intelligence.financing_readiness,
        estimated_close_quality: intelligence.estimated_close_quality,
        follow_up_urgency: intelligence.follow_up_urgency,
        stale_lead_hours: intelligence.stale_lead_hours,
        operator_notes: intelligence.operator_notes,
        last_contact_timestamp: intelligence.last_contact_timestamp,
        release_readiness: intelligence.release_readiness,
        attachment_completeness: attachmentCompleteness,
        qualification_completeness: qualificationCompleteness,
        contact_attempts: operational.no_answer_count ?? 0,
        operator_action_history: operational.action_history ?? [],
        current_queue: leadOpsSummary.current_queue,
        next_action: leadOpsSummary.next_action,
        next_follow_up_at: leadOpsSummary.next_follow_up_at,
        callback_at: leadOpsSummary.callback_at,
        dormant_until: leadOpsSummary.dormant_until,
        dormant_reason: leadOpsSummary.dormant_reason,
        workflow_timeline: leadOpsSummary.workflow_timeline,
        reopen_history: leadOpsSummary.reopen_history,
        callback_history: leadOpsSummary.callback_history,
        financing_reopen_history: leadOpsSummary.financing_reopen_history,
        dormant_history: leadOpsSummary.dormant_history,
        reactivation_history: leadOpsSummary.reactivation_history,
        assigned_operator: leadOpsSummary.assigned_operator,
        last_contacted_at: leadOpsSummary.last_contacted_at,
        contact_attempt_count: leadOpsSummary.contact_attempt_count,
        last_operator_action: leadOpsSummary.last_operator_action,
        financing_status: leadOpsSummary.financing_status,
        qualification_summary_status: leadOpsSummary.qualification_status,
        assigned_operator_id: leadOpsSummary.assigned_operator_id,
        assigned_operator_name: leadOpsSummary.assigned_operator_name,
        assigned_at: leadOpsSummary.assigned_at,
        ownership_age_hours: leadOpsSummary.ownership_age_hours,
        last_touched_by: leadOpsSummary.last_touched_by,
        follow_up_reason: leadOpsSummary.follow_up_reason,
        follow_up_priority: leadOpsSummary.follow_up_priority,
        follow_up_channel: leadOpsSummary.follow_up_channel,
        follow_up_completed_at: leadOpsSummary.follow_up_completed_at,
        snooze_until: leadOpsSummary.snooze_until,
        callback_bucket: leadOpsSummary.callback_bucket,
        callback_countdown: leadOpsSummary.callback_countdown,
        overdue: leadOpsSummary.overdue,
        latest_note: leadOpsSummary.latest_note,
        last_contact_result: leadOpsSummary.last_contact_result,
        successful_contact_count: leadOpsSummary.successful_contact_count,
        days_since_last_contact: leadOpsSummary.days_since_last_contact,
        open_task_count: leadOpsSummary.open_task_count,
        overdue_task_count: leadOpsSummary.overdue_task_count,
        financing_stage: leadOpsSummary.financing_stage,
        proposal_stage: leadOpsSummary.proposal_stage,
        proposal_readiness: leadOpsSummary.proposal_readiness,
        contractor_readiness: leadOpsSummary.contractor_readiness,
        lead_health: leadOpsSummary.lead_health,
        lead_health_reasons: leadOpsSummary.lead_health_reasons,
        time_since_intake_hours: leadOpsSummary.time_since_intake_hours,
        time_since_last_contact_hours:
          leadOpsSummary.time_since_last_contact_hours,
        time_waiting_on_follow_up_hours:
          leadOpsSummary.time_waiting_on_follow_up_hours,
        last_updated_timestamp:
          operational.last_reviewed_at ?? rest.updated_at ?? rest.created_at,
      };
    });

    const dashboard = opportunities.reduce(
      (acc: Record<string, number | null>, row: Record<string, unknown>) => {
        if (row.assigned_operator_id) acc.leads_assigned += 1;
        if (row.callback_bucket === "today") acc.callbacks_today += 1;
        if (row.overdue === true) acc.overdue_callbacks += 1;
        if (row.current_queue === "financing_review")
          acc.financing_reviews_pending += 1;
        if (row.current_queue === "marketplace_ready")
          acc.marketplace_ready_leads += 1;
        if (
          row.current_queue === "stale_leads" ||
          row.current_queue === "dormant_leads"
        )
          acc.stale_leads += 1;
        if (
          typeof row.proposal_stage === "string" &&
          !["not_started", "proposal_accepted"].includes(row.proposal_stage)
        )
          acc.proposal_follow_ups += 1;
        if ((Number(row.contact_attempt_count) || 0) > 0)
          acc.contact_attempts += Number(row.contact_attempt_count) || 0;
        if ((Number(row.successful_contact_count) || 0) > 0)
          acc.successful_contacts += Number(row.successful_contact_count) || 0;
        const responseHours = Number(row.time_since_intake_hours);
        if (Number.isFinite(responseHours) && row.last_contacted_at) {
          acc.response_hour_total += responseHours;
          acc.response_hour_count += 1;
        }
        return acc;
      },
      {
        leads_assigned: 0,
        callbacks_today: 0,
        overdue_callbacks: 0,
        financing_reviews_pending: 0,
        marketplace_ready_leads: 0,
        stale_leads: 0,
        proposal_follow_ups: 0,
        contact_attempts: 0,
        successful_contacts: 0,
        response_hour_total: 0,
        response_hour_count: 0,
      },
    );

    console.info("[ADMIN INTAKE PROJECTION]", {
      count: opportunities.length,
      sample: opportunities.slice(0, 3).map((row: Record<string, unknown>) => ({
        id: row.id,
        event_id: row.event_id,
        event_type: row.event_type,
        review_status: row.review_status,
        opportunity_id: row.opportunity_id ?? "Not converted",
        monthly_bill_amount: row.monthly_bill_amount,
        bill_attachment_metadata_only: row.bill_attachment_metadata_only,
        qualification_skipped: row.qualification_skipped,
        ready_for_review: row.ready_for_review,
      })),
    });

    stage = "stats_query";
    const statsResult = await sql`
      WITH combined AS (
        SELECT
          no.source_system,
          no.source_channel,
          no.created_at,
          no.duplicate_flag AS is_duplicate_flagged,
          no.duplicate_score,
          'created'::text AS action,
          false AS debug_visible
        FROM network_opportunities no
        WHERE (no.source_system IS NOT NULL OR no.source_type IS NOT NULL)
        UNION ALL
        SELECT
          ie.source_system,
          ie.source_channel,
          ie.occurred_at AS created_at,
          false AS is_duplicate_flagged,
          CASE
            WHEN COALESCE(ie.duplicate_result->>'score', '') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN (ie.duplicate_result->>'score')::numeric
            ELSE NULL
          END AS duplicate_score,
          ie.action,
          (
            ie.action IN ('validation_failed', 'malformed', 'error', 'archived', 'rejected', 'bad_lead')
            OR COALESCE((ie.pipeline_result->'operational'->>'archived')::boolean, false) = true
            OR COALESCE((ie.pipeline_result->'operational'->>'rejected')::boolean, false) = true
            OR COALESCE((ie.payload->>'is_test')::boolean, false) = true
            OR COALESCE((ie.payload->>'is_simulated')::boolean, false) = true
          ) AS debug_visible
        FROM intake_events ie
        WHERE ie.opportunity_id IS NULL
          AND ie.event_type = 'homeowner_intake'
      )
      SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND (${includeDebug}::boolean OR debug_visible = false)) AS today_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', NOW()) AND (${includeDebug}::boolean OR debug_visible = false)) AS week_count,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) AND (${includeDebug}::boolean OR debug_visible = false)) AS month_count,
        COUNT(*) FILTER (WHERE is_duplicate_flagged = true AND (${includeDebug}::boolean OR debug_visible = false)) AS flagged_duplicates,
        COUNT(*) FILTER (WHERE duplicate_score >= 0.90 AND (${includeDebug}::boolean OR debug_visible = false)) AS blocked_duplicates,
        COUNT(*) FILTER (WHERE ${includeDebug}::boolean OR debug_visible = false) AS total_all_time,
        COUNT(*) FILTER (WHERE debug_visible = true) AS debug_hidden_count,
        COUNT(*) FILTER (WHERE action = 'pending_review') AS pending_review_count
      FROM combined
    `;

    stage = "today_events_query";
    const todayEvents = await sql`
      SELECT action, COUNT(*) AS count
      FROM intake_events
      WHERE occurred_at >= CURRENT_DATE
      GROUP BY action
      ORDER BY count DESC
    `;

    stage = "top_sources_query";
    const topSources = await sql`
      WITH combined AS (
        SELECT source_system, source_channel, created_at, false AS debug_visible
        FROM network_opportunities
        WHERE source_system IS NOT NULL
        UNION ALL
        SELECT source_system, source_channel, occurred_at AS created_at, action IN ('validation_failed', 'malformed', 'error') AS debug_visible
        FROM intake_events
        WHERE opportunity_id IS NULL
          AND event_type = 'homeowner_intake'
      )
      SELECT
        source_system,
        source_channel,
        CONCAT(COALESCE(source_system, 'unknown'), '/', COALESCE(source_channel, 'unknown')) AS source,
        COUNT(*) AS count,
        COUNT(*) AS clean_count
      FROM combined
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND (${includeDebug}::boolean OR debug_visible = false)
      GROUP BY source_system, source_channel
      ORDER BY count DESC
      LIMIT 10
    `;

    stage = "validation_stats_query";
    const validationStats = await sql`
      SELECT
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE action = 'validation_failed') AS validation_failures,
        COUNT(*) FILTER (WHERE action IN ('created', 'pending_review')) AS created,
        COUNT(*) FILTER (WHERE action = 'duplicate_blocked') AS blocked,
        COUNT(*) FILTER (WHERE action = 'duplicate_flagged') AS flagged,
        COUNT(*) FILTER (WHERE action = 'malformed') AS malformed,
        COUNT(*) FILTER (WHERE action = 'error') AS errors
      FROM intake_events
      WHERE occurred_at >= NOW() - INTERVAL '7 days'
    `;

    const vs = validationStats[0] || {};
    const totalEvents = Number(vs.total_events) || 0;

    return NextResponse.json({
      success: true,
      opportunities,
      total,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        has_next: offset + limit < total,
        has_prev: page > 1,
      },
      stats: {
        ...(statsResult[0] || {}),
        total,
        today_events: todayEvents,
        top_sources: topSources,
        validation_failure_rate:
          totalEvents > 0
            ? Math.round((Number(vs.validation_failures) / totalEvents) * 100) /
              100
            : 0,
        conversion_rate:
          totalEvents > 0
            ? Math.round((Number(vs.created) / totalEvents) * 100) / 100
            : 0,
        operator_dashboard: {
          leads_assigned_to_me: dashboard.leads_assigned,
          callbacks_today: dashboard.callbacks_today,
          overdue_callbacks: dashboard.overdue_callbacks,
          financing_reviews_pending: dashboard.financing_reviews_pending,
          marketplace_ready_leads: dashboard.marketplace_ready_leads,
          stale_leads: dashboard.stale_leads,
          proposal_follow_ups: dashboard.proposal_follow_ups,
          average_response_time_hours:
            dashboard.response_hour_count && dashboard.response_hour_count > 0
              ? Math.round(
                  (Number(dashboard.response_hour_total) /
                    Number(dashboard.response_hour_count)) *
                    10,
                ) / 10
              : null,
          contact_conversion_rate:
            dashboard.contact_attempts && dashboard.contact_attempts > 0
              ? Math.round(
                  (Number(dashboard.successful_contacts) /
                    Number(dashboard.contact_attempts)) *
                    100,
                ) / 100
              : 0,
        },
        ...vs,
      },
    });
  } catch (err) {
    console.error(`[GET /api/admin/network/intake] stage=${stage} Error:`, err);
    return intakeFeedError(stage, err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let stage: IntakeFeedStage = "auth";

  try {
    const admin = await requireAdminApi(req);
    if (!admin)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    stage = "request_parse";
    const body = await req.json().catch(() => ({}));
    const requestBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const eventId =
      typeof requestBody.event_id === "string"
        ? requestBody.event_id.trim()
        : "";
    const action = requestBody.action;
    const notes = bodyString(requestBody, "notes");
    const operatorDetails = sanitizeOperatorDetails(requestBody);

    if (!eventId) {
      return NextResponse.json(
        { error: "event_id is required" },
        { status: 400 },
      );
    }
    if (!isOperatorReviewAction(action)) {
      return NextResponse.json(
        { error: "Unsupported operator review action" },
        { status: 400 },
      );
    }
    const missingFields = requiredOperatorFields(
      action,
      operatorDetails,
      notes,
    );
    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: "Missing required operator review fields",
          missing_fields: missingFields,
        },
        { status: 400 },
      );
    }

    stage = "db_connect";
    const sql = await getDbReady();

    stage = "review_event_lookup";
    const originalRows = await sql`
      SELECT event_id, event_type, payload, validation_result, duplicate_result, pipeline_result, action, occurred_at
      FROM intake_events
      WHERE event_id = ${eventId}
        AND event_type = 'homeowner_intake'
      LIMIT 1
    `;
    const original = originalRows[0] as Record<string, unknown> | undefined;
    if (!original)
      return NextResponse.json(
        { error: "Intake event not found" },
        { status: 404 },
      );

    const currentState = stateFromPipelineResult(original.pipeline_result);
    if (
      (currentState.archived || currentState.rejected) &&
      action !== "reactivate_lead"
    ) {
      return NextResponse.json(
        {
          error:
            "Archived or rejected leads must be reactivated before ordinary workflow actions",
        },
        { status: 409 },
      );
    }

    const nextState = applyOperatorReviewAction(currentState, action, {
      adminId: admin.id,
      notes,
      details: operatorDetails,
    });
    const qualificationRows = await sql`
      SELECT payload
      FROM intake_events
      WHERE event_type = 'homeowner_qualification'
        AND (original_event_id = ${eventId} OR payload->>'original_event_id' = ${eventId})
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const qualification = (
      qualificationRows[0] as Record<string, unknown> | undefined
    )?.payload;
    const releaseReadiness = deriveReleaseReadiness({
      operational: nextState,
      intake: original.payload,
      qualification:
        qualification && typeof qualification === "object"
          ? ((qualification as Record<string, unknown>).intelligence ??
            qualification)
          : qualification,
      validation: original.validation_result,
    });
    nextState.release_readiness = releaseReadiness;
    if (action === "approve_for_marketplace" && !releaseReadiness.ready) {
      return NextResponse.json(
        {
          error: "Marketplace release readiness is incomplete",
          release_readiness: releaseReadiness,
        },
        { status: 409 },
      );
    }

    const reviewEventId = `review_${randomUUID()}`;
    const pipelineResult = {
      ...(typeof original.pipeline_result === "object" &&
      original.pipeline_result !== null
        ? (original.pipeline_result as Record<string, unknown>)
        : {}),
      review_status: nextState.review_status,
      operational: nextState,
      marketplace_auto_release: false,
    };
    const eventPayload = {
      original_event_id: eventId,
      action,
      notes,
      details: operatorDetails,
      operational: nextState,
      release_readiness: releaseReadiness,
    };

    stage = "review_event_insert";
    await sql`
      INSERT INTO intake_events (
        event_id, opportunity_id, event_type, event_source,
        source_system, source_channel,
        payload, validation_result, duplicate_result, pipeline_result,
        action, original_event_id,
        occurred_at
      ) VALUES (
        ${reviewEventId}, ${null}, 'operator_review', 'admin_intake_feed',
        'admin', 'operator_review',
        ${JSON.stringify(eventPayload)}, ${JSON.stringify({ skipped: true, reason: "operator_review_event" })}, ${JSON.stringify({ skipped: true })}, ${JSON.stringify(pipelineResult)},
        ${action}, ${eventId},
        NOW()
      )
    `;

    stage = "review_projection_update";
    await sql`
      UPDATE intake_events
      SET pipeline_result = ${JSON.stringify(pipelineResult)},
          action = CASE
            WHEN ${action} = 'reject_lead' THEN 'rejected'
            WHEN ${action} = 'archive_lead' THEN 'archived'
            WHEN ${action} = 'mark_bad_lead' THEN 'bad_lead'
            ELSE action
          END
      WHERE event_id = ${eventId}
    `;

    console.info(
      "[OPERATOR ACTION]",
      safeOperationalLog({
        eventId,
        action,
        fromStatus: currentState.review_status,
        toStatus: nextState.review_status,
        releaseReadiness,
      }),
    );

    console.info(
      "[REVIEW STATUS TRANSITION]",
      safeOperationalLog({
        eventId,
        action,
        fromStatus: currentState.review_status,
        toStatus: nextState.review_status,
        releaseReadiness,
      }),
    );

    return NextResponse.json({
      success: true,
      event_id: eventId,
      review_event_id: reviewEventId,
      review_status: nextState.review_status,
      operational_state: nextState,
      release_readiness: releaseReadiness,
    });
  } catch (err) {
    console.error(
      `[POST /api/admin/network/intake] stage=${stage} Error:`,
      err,
    );
    return intakeFeedError(stage, err);
  }
}
