/**
 * /api/intake/homeowner/qualification
 *
 * Post-submit homeowner qualification step.
 *
 * This endpoint intentionally does not replace the public low-friction intake.
 * It appends a second lifecycle event to intake_events with derived
 * qualification intelligence for admin review, scoring, matching, and
 * marketplace enrichment.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

import { NextRequest, NextResponse } from "next/server";
import { getDbReady } from "@/lib/db-neon";
import {
  HOMEOWNER_QUALIFICATION_EVENT_TYPE,
  HOMEOWNER_QUALIFICATION_SCHEMA_VERSION,
  deriveQualificationIntelligence,
  normalizeQualificationInput,
  type HomeownerQualificationContext,
} from "@/lib/intake/homeownerQualification";

type QualificationStage =
  | "request_parse"
  | "db_connect"
  | "original_event_lookup"
  | "qualification_insert";

function qualificationError(
  stage: QualificationStage,
  error: unknown,
  status = 500,
) {
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
      error: "Homeowner qualification failed",
      stage,
      message: err?.message ?? String(error),
      code: err?.code,
      details: {
        detail: err?.detail,
        constraint: err?.constraint,
        column: err?.column,
      },
    },
    { status },
  );
}

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function makeEventId(originalEventId: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `qual_${originalEventId}_${Date.now()}_${random}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 180);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let stage: QualificationStage = "request_parse";

  try {
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return qualificationError(stage, new Error("Invalid JSON body"), 400);
    }

    const originalEventId =
      str(body.original_event_id) ??
      str(body.event_id) ??
      str(body.intake_event_id);
    if (!originalEventId) {
      return qualificationError(
        stage,
        new Error("original_event_id is required"),
        400,
      );
    }

    const submittedQualification =
      body.qualification && typeof body.qualification === "object"
        ? (body.qualification as Record<string, unknown>)
        : body;
    const qualification = normalizeQualificationInput(submittedQualification);

    stage = "db_connect";
    const sql = await getDbReady();

    stage = "original_event_lookup";
    const originalRows = await sql`
      SELECT
        event_id,
        opportunity_id,
        source_system,
        source_channel,
        funnel_id::text AS funnel_id,
        campaign_id::text AS campaign_id,
        payload,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        gclid,
        fbclid
      FROM intake_events
      WHERE event_id = ${originalEventId}
        AND event_type = 'homeowner_intake'
      LIMIT 1
    `;

    const original = originalRows[0] as Record<string, unknown> | undefined;
    if (!original) {
      return qualificationError(
        stage,
        new Error("Original homeowner intake event not found"),
        404,
      );
    }

    const originalPayload =
      original.payload && typeof original.payload === "object"
        ? (original.payload as Record<string, unknown>)
        : {};
    const context: HomeownerQualificationContext = {
      monthly_bill_amount:
        num(originalPayload.monthly_bill_amount) ??
        num(originalPayload.average_monthly_bill),
      homeowner_status:
        str(originalPayload.homeowner_status) ??
        str(originalPayload.home_ownership),
      battery_interest: str(originalPayload.battery_interest),
      timeline: str(originalPayload.timeline),
      utility_provider: str(originalPayload.utility_provider),
      roof_age:
        str(originalPayload.roof_age) ?? str(originalPayload.roof_age_years),
    };
    const intelligence = deriveQualificationIntelligence(
      qualification,
      context,
    );
    const opportunityId = original.opportunity_id ?? null;
    const eventId = makeEventId(originalEventId);
    const idempotencyKey =
      str(body.idempotency_key) ??
      `${HOMEOWNER_QUALIFICATION_EVENT_TYPE}:${originalEventId}`;
    const payload = {
      schema_version: HOMEOWNER_QUALIFICATION_SCHEMA_VERSION,
      original_event_id: originalEventId,
      opportunity_id: opportunityId,
      qualification,
      qualification_status: intelligence.qualification_status,
      qualification_statuses: intelligence.qualification_statuses,
      lead_grade: intelligence.lead_grade,
      lead_score: intelligence.lead_score,
      finance_readiness: intelligence.finance_readiness,
      battery_readiness: intelligence.battery_readiness,
      estimated_income_band: intelligence.normalized.estimated_income_band,
      estimated_credit_band: intelligence.normalized.estimated_credit_band,
      sunlight_confidence: intelligence.normalized.sunlight_confidence,
      property_type: intelligence.normalized.property_type,
      electrical_panel_size: intelligence.normalized.electrical_panel_size,
      prior_quotes: intelligence.normalized.prior_quotes,
      context,
      intelligence,
    };

    stage = "qualification_insert";

    await sql`
      INSERT INTO intake_events (
        event_id,
        opportunity_id,
        event_type,
        event_source,
        source_system,
        source_channel,
        funnel_id,
        campaign_id,
        idempotency_key,
        payload,
        validation_result,
        duplicate_result,
        pipeline_result,
        action,
        ip_address,
        user_agent,
        referer,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        gclid,
        fbclid,
        original_event_id
      ) VALUES (
        ${eventId},
        ${opportunityId},
        ${HOMEOWNER_QUALIFICATION_EVENT_TYPE},
        'post_submit_qualification',
        ${original.source_system ?? "homeowner_form"},
        ${original.source_channel ?? "web"},
        ${original.funnel_id ?? null},
        ${original.campaign_id ?? null},
        ${idempotencyKey},
        ${JSON.stringify(payload)},
        ${JSON.stringify({ valid: true, schema_version: HOMEOWNER_QUALIFICATION_SCHEMA_VERSION })},
        ${JSON.stringify({ skipped: true, reason: "qualification_event" })},
        ${JSON.stringify({ qualification_status: intelligence.qualification_status, lead_grade: intelligence.lead_grade })},
        'qualified',
        ${clientIp(req)},
        ${req.headers.get("user-agent") ?? null},
        ${req.headers.get("referer") ?? null},
        ${original.utm_source ?? null},
        ${original.utm_medium ?? null},
        ${original.utm_campaign ?? null},
        ${original.utm_content ?? null},
        ${original.utm_term ?? null},
        ${original.gclid ?? null},
        ${original.fbclid ?? null},
        ${originalEventId}
      )
      ON CONFLICT (event_id) DO NOTHING
    `;

    if (opportunityId) {
      const qualificationProjection = {
        ...intelligence.enrichment,
        matcher_input: intelligence.matcher_input,
        scoring_input: intelligence.scoring_input,
        normalized: intelligence.normalized,
        labels: intelligence.labels,
      };

      await sql`
        INSERT INTO opportunity_intelligence (
          opportunity_id,
          overall_score,
          overall_grade,
          enrichment_payload
        ) VALUES (
          ${opportunityId},
          0,
          ${intelligence.lead_grade},
          ${JSON.stringify({ qualification: qualificationProjection })}
        )
        ON CONFLICT (opportunity_id) DO UPDATE SET
          enrichment_payload = jsonb_set(
            COALESCE(opportunity_intelligence.enrichment_payload, '{}'::jsonb),
            '{qualification}',
            ${JSON.stringify(qualificationProjection)}::jsonb,
            true
          ),
          updated_at = NOW()
      `;
    }

    return NextResponse.json({
      success: true,
      event_id: eventId,
      original_event_id: originalEventId,
      action: "qualified",
      message: "Qualification details saved for SolarPro review.",
    });
  } catch (err) {
    console.error(
      `[POST /api/intake/homeowner/qualification] stage=${stage} Error:`,
      err,
    );
    return qualificationError(stage, err);
  }
}
