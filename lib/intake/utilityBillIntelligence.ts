import { getDbReady } from "@/lib/db-neon";
import { mapAiResultToBillExtractResult, parseUtilityBill } from "@/lib/billPipeline";
import { extractBillWithClaude } from "@/lib/billClaudeExtractor";
import { enrichBillData, type BillEnrichmentInput } from "@/lib/billEnrichment";
import { confidenceFromBillExtractResult } from "@/lib/billConfidence";
import { estimateSystemSize } from "@/lib/billParser";
import { computeBillInsights } from "@/lib/billInsights";
import { enrichAndPersistOpportunity } from "@/lib/network/opportunityEnrichment";
import type { BillExtractResult } from "@/lib/billOcr";

type SqlClient = Awaited<ReturnType<typeof getDbReady>>;
type StoredBillMetadata = Record<string, unknown>;

export const UTILITY_BILL_INTELLIGENCE_VERSION = "utility-bill-intelligence.v1";

export interface UtilityBillIntelligenceInput {
  eventId: string;
  billMetadata?: StoredBillMetadata | null;
  trigger?: "homeowner_intake" | "operator_review" | "system";
}

interface IntakeRow {
  id: string;
  event_id: string;
  opportunity_id: string | null;
  payload: Record<string, unknown> | null;
  pipeline_result: Record<string, unknown> | null;
  source_system: string | null;
  source_channel: string | null;
  funnel_id: string | null;
  campaign_id: string | null;
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

function average(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function round2(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function safeRawTextSample(text: string | undefined): string | null {
  if (!text || !text.trim()) return null;
  return text.replace(/\s+/g, " ").trim().slice(0, 1200);
}

function isImageMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/");
}

function safeObjectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function extractedFieldCount(parsed: BillExtractResult | null | undefined): number {
  return parsed?.extractedFields?.length ?? 0;
}

function monthsFound(parsed: BillExtractResult | null | undefined): number {
  return parsed?.monthlyUsageHistory?.filter((value) => Number.isFinite(value) && value > 0).length ?? 0;
}

function logAdminBillAudit(label: string, payload: Record<string, unknown>): void {
  console.info(label, payload);
}

function hasUsefulBillData(parsed: BillExtractResult): boolean {
  return (
    (parsed.extractedFields?.length ?? 0) >= 2 ||
    ((parsed.monthlyKwh ?? 0) > 0) ||
    (parsed.monthlyUsageHistory?.length ?? 0) >= 3
  );
}

function buildExtractionEvidence(input: {
  parsed: BillExtractResult;
  source: "claude-image" | "pipeline";
  extractionMethod: string | null;
  claudeStatus?: string | null;
  claudeValidationFlags?: unknown;
}) {
  const parsed = input.parsed;
  return {
    monthlySource: input.source,
    monthlyConfidence:
      input.source === "claude-image"
        ? input.claudeStatus === "complete"
          ? 95
          : 65
        : parsed.confidence === "high"
          ? 90
          : parsed.confidence === "medium"
            ? 60
            : 30,
    monthsFound: parsed.monthlyUsageHistory?.length ?? 0,
    monthlyEvidence:
      input.source === "claude-image"
        ? `Claude image parser: ${(parsed.extractedFields ?? []).join(", ")}`
        : `AI pipeline: ${(parsed.extractedFields ?? []).join(", ")}`,
    annualSource: parsed.annualKwh || parsed.estimatedAnnualKwh ? (input.source === "claude-image" ? "claude" : "ai") : "derived",
    annualSourceText: null,
    utilitySource: parsed.utilityProvider ? (input.source === "claude-image" ? "claude" : "ai") : "none",
    rateSource: parsed.electricityRate ? (input.source === "claude-image" ? "claude" : "ai") : "none",
    debugLog: [
      input.source === "claude-image"
        ? `[claude-image] status=${input.claudeStatus ?? "unknown"} validationFlags=${JSON.stringify(input.claudeValidationFlags ?? {})}`
        : `[pipeline] method=${input.extractionMethod ?? "pipeline"} fields=${(parsed.extractedFields ?? []).join(",")}`,
    ],
  };
}

function buildDashboardParserResult(input: {
  parsed: BillExtractResult;
  extractionMethod: string | null;
  extractionEvidence: Record<string, unknown>;
  durationMs: number;
  parserPath: "claude-image" | "pipeline";
  claude?: {
    status: string | null;
    model: string | null;
    inputType: string | null;
    validationFlags: unknown;
  } | null;
}) {
  const { rawText: _rawText, ...safeBillData } = input.parsed;
  return {
    success: true,
    billData: {
      ...safeBillData,
      rawTextSample: safeRawTextSample(input.parsed.rawText),
    },
    extractionEvidence: input.extractionEvidence,
    extractionMethod: input.extractionMethod,
    parserPath: input.parserPath,
    elapsedMs: input.durationMs,
    claude: input.claude ?? null,
    locationData: null,
    utilityData: null,
    matchedUtility: null,
    systemSizing: null,
    rateValidation: null,
    validation: { valid: true, warnings: [], errors: [] },
  };
}

type IntakeBillParseResult = {
  success: boolean;
  data?: BillExtractResult;
  rawText?: string;
  extractionMethod?: string;
  error?: string;
  parserPath?: "claude-image" | "pipeline";
  extractionEvidence?: Record<string, unknown>;
  claude?: {
    status: string | null;
    model: string | null;
    inputType: string | null;
    validationFlags: unknown;
  } | null;
};

async function parseStoredBillWithDashboardParity(buffer: Buffer, mimeType: string, eventId: string): Promise<IntakeBillParseResult> {
  const imageMimeType = isImageMimeType(mimeType);
  const anthropicKeyPresent = !!process.env.ANTHROPIC_API_KEY;
  logAdminBillAudit("[ADMIN_BILL_PARSER_SELECTED]", {
    intake_event_id: eventId,
    mime_type: mimeType,
    buffer_byte_length: buffer.length,
    is_image_mime_type: imageMimeType,
    anthropic_key_present: anthropicKeyPresent,
    selected_parser_path: imageMimeType && anthropicKeyPresent ? "claude-image" : "pipeline",
  });

  if (imageMimeType && anthropicKeyPresent) {
    try {
      logAdminBillAudit("[ADMIN_BILL_CLAUDE_START]", {
        intake_event_id: eventId,
        mime_type: mimeType,
        buffer_byte_length: buffer.length,
      });
      const claudeResult = await extractBillWithClaude({ imageBuffer: buffer, mimeType }, { timeoutMs: 40000 });
      if (claudeResult && claudeResult.status !== "failed") {
        const parsed = mapAiResultToBillExtractResult(
          claudeResult.data,
          `[claude-image] status=${claudeResult.status}`,
          "claude-3-5-sonnet",
        );
        const useful = hasUsefulBillData(parsed);
        logAdminBillAudit("[ADMIN_BILL_CLAUDE_RESULT]", {
          intake_event_id: eventId,
          claude_executed: true,
          claude_status: claudeResult.status,
          claude_model: claudeResult.model,
          claude_input_type: claudeResult.inputType,
          extracted_field_count: extractedFieldCount(parsed),
          months_found: monthsFound(parsed),
          has_useful_bill_data: useful,
          validation_flag_keys: safeObjectKeys(claudeResult.validationFlags),
        });
        if (useful) {
          const extractionEvidence = buildExtractionEvidence({
            parsed,
            source: "claude-image",
            extractionMethod: "claude-3-5-sonnet",
            claudeStatus: claudeResult.status,
            claudeValidationFlags: claudeResult.validationFlags,
          });
          return {
            success: true,
            data: parsed,
            rawText: parsed.rawText,
            extractionMethod: "claude-3-5-sonnet",
            parserPath: "claude-image",
            extractionEvidence,
            claude: {
              status: claudeResult.status,
              model: claudeResult.model,
              inputType: claudeResult.inputType,
              validationFlags: claudeResult.validationFlags,
            },
          };
        }
      }
    } catch (err) {
      console.warn("[ADMIN_BILL_CLAUDE_RESULT]", {
        intake_event_id: eventId,
        claude_executed: true,
        claude_status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      console.warn("[UTILITY BILL INTELLIGENCE] claude_image_failed_falling_back", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logAdminBillAudit("[ADMIN_BILL_CLAUDE_RESULT]", {
      intake_event_id: eventId,
      claude_executed: false,
      skip_reason: imageMimeType ? "anthropic_key_missing" : "non_image_mime_type",
    });
  }

  const pipelineResult = await parseUtilityBill(buffer, mimeType);
  const extractionEvidence = pipelineResult.data
    ? buildExtractionEvidence({
        parsed: pipelineResult.data,
        source: "pipeline",
        extractionMethod: pipelineResult.extractionMethod ?? "pipeline",
      })
    : undefined;

  logAdminBillAudit("[ADMIN_BILL_FALLBACK_RESULT]", {
    intake_event_id: eventId,
    fallback_executed: true,
    success: pipelineResult.success,
    extraction_method: pipelineResult.extractionMethod ?? null,
    error: pipelineResult.error ?? null,
    extracted_field_count: extractedFieldCount(pipelineResult.data),
    months_found: monthsFound(pipelineResult.data),
  });

  return {
    ...pipelineResult,
    parserPath: "pipeline",
    extractionEvidence,
    claude: null,
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function eventSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveBillMetadata(input: UtilityBillIntelligenceInput, row: IntakeRow | null): StoredBillMetadata | null {
  if (isRecord(input.billMetadata)) return input.billMetadata;
  const payload = isRecord(row?.payload) ? row?.payload : null;
  return isRecord(payload?.bill_metadata) ? payload.bill_metadata : null;
}

function downloadUrlFromMetadata(metadata: StoredBillMetadata | null): string | null {
  const status = str(metadata?.storage_status);
  if (status !== "stored") return null;
  return str(metadata?.download_url) ?? str(metadata?.accessible_url);
}

function contentTypeFromMetadata(metadata: StoredBillMetadata | null, response: Response): string {
  return (
    str(metadata?.content_type) ??
    response.headers.get("content-type")?.split(";")[0]?.trim() ??
    "application/octet-stream"
  );
}

async function fetchStoredBill(metadata: StoredBillMetadata): Promise<{ buffer: Buffer; mimeType: string; url: string }> {
  const url = downloadUrlFromMetadata(metadata);
  if (!url) throw new Error("Stored utility bill metadata does not include a downloadable URL.");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Utility bill download failed with HTTP ${response.status}.`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentTypeFromMetadata(metadata, response),
    url,
  };
}

function buildProjection(parsed: BillExtractResult, enrichment: Awaited<ReturnType<typeof enrichBillData>> | null) {
  const monthlyHistory = Array.isArray(parsed.monthlyUsageHistory)
    ? parsed.monthlyUsageHistory.filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const monthlyUsageAvg = average(monthlyHistory) ?? num(parsed.monthlyKwh);
  const annualUsage =
    num(parsed.annualKwh) ??
    num(parsed.estimatedAnnualKwh) ??
    (monthlyHistory.length >= 10 ? monthlyHistory.reduce((sum, value) => sum + value, 0) : null) ??
    (monthlyUsageAvg != null ? monthlyUsageAvg * 12 : null);
  const effectiveRate = num(enrichment?.effectiveRate) ?? num(parsed.electricityRate);
  const systemEstimate = annualUsage != null ? estimateSystemSize(annualUsage) : null;
  const estimatedSystemSizeKw = systemEstimate?.systemSizeKw ?? null;
  const annualProductionKwh = estimatedSystemSizeKw != null ? Math.round(estimatedSystemSizeKw * 4.5 * 365 * 0.78) : null;
  const offsetPercentage = annualUsage && annualProductionKwh ? Math.min(100, Math.round((annualProductionKwh / annualUsage) * 100)) : null;
  const estimatedAnnualSavings = annualProductionKwh != null && effectiveRate != null ? round2(annualProductionKwh * effectiveRate) : null;
  const estimatedProjectValue = estimatedSystemSizeKw != null ? round2(estimatedSystemSizeKw * 1000 * 3.15) : null;
  const estimatedPaybackYears = estimatedProjectValue != null && estimatedAnnualSavings != null && estimatedAnnualSavings > 0 ? round2(estimatedProjectValue / estimatedAnnualSavings) : null;
  const highUsage = (monthlyUsageAvg ?? 0) >= 900 || (annualUsage ?? 0) >= 10800;
  const highRate = (effectiveRate ?? 0) >= 0.18;
  const batteryCandidate = highUsage || highRate || bool(enrichment?.netMetering) === false;

  return {
    utility_provider: enrichment?.canonicalName ?? parsed.utilityProvider ?? null,
    utility_canonical_id: enrichment?.canonicalId ?? null,
    monthly_usage_avg_kwh: monthlyUsageAvg,
    annual_usage_kwh: annualUsage,
    utility_rate_per_kwh: effectiveRate,
    estimated_system_size_kw: estimatedSystemSizeKw,
    estimated_annual_production_kwh: annualProductionKwh,
    offset_percentage: offsetPercentage,
    estimated_annual_savings: estimatedAnnualSavings,
    estimated_project_value: estimatedProjectValue,
    estimated_payback_yrs: estimatedPaybackYears,
    battery_candidate: batteryCandidate,
    battery_reason: batteryCandidate
      ? [
          highUsage ? "high_usage" : null,
          highRate ? "high_utility_rate" : null,
          bool(enrichment?.netMetering) === false ? "net_metering_unavailable" : null,
        ]
          .filter(Boolean)
          .join(",")
      : null,
  };
}

function buildIntelligencePayload(input: {
  parsed: BillExtractResult;
  extractionMethod: string | null;
  extractionEvidence: Record<string, unknown> | null;
  parserPath: "claude-image" | "pipeline";
  parserResult: Record<string, unknown>;
  enrichment: Awaited<ReturnType<typeof enrichBillData>> | null;
  projection: ReturnType<typeof buildProjection>;
  billMetadata: StoredBillMetadata | null;
}) {
  const confidence = confidenceFromBillExtractResult(input.parsed, input.enrichment?.rateSource ?? "none");
  const insights =
    input.parsed.billInsights ??
    computeBillInsights(
      input.parsed.rawText ?? "",
      input.parsed.totalAmount,
      input.parsed.monthlyKwh,
      input.parsed.electricityRate,
    );

  return {
    schema_version: UTILITY_BILL_INTELLIGENCE_VERSION,
    generated_at: new Date().toISOString(),
    extraction: {
      success: input.parsed.success,
      method: input.extractionMethod,
      confidence_label: input.parsed.confidence,
      confidence,
      extracted_fields: input.parsed.extractedFields,
      used_llm_fallback: input.parsed.usedLlmFallback ?? false,
      raw_text_sample: safeRawTextSample(input.parsed.rawText),
      evidence: input.extractionEvidence,
      parser_path: input.parserPath,
    },
    parser_result: input.parserResult,
    bill: {
      utility_provider: input.parsed.utilityProvider ?? null,
      customer_name_present: !!input.parsed.customerName,
      service_address_present: !!input.parsed.serviceAddress,
      account_number_present: !!input.parsed.accountNumber,
      billing_period_start: input.parsed.billingPeriodStart ?? null,
      billing_period_end: input.parsed.billingPeriodEnd ?? null,
      monthly_kwh: input.parsed.monthlyKwh ?? null,
      annual_kwh: input.parsed.annualKwh ?? input.parsed.estimatedAnnualKwh ?? null,
      monthly_usage_history: input.parsed.monthlyUsageHistory ?? null,
      total_amount: input.parsed.totalAmount ?? null,
      electricity_rate: input.parsed.electricityRate ?? null,
      bill_type: input.parsed.billType ?? null,
      insights,
    },
    enrichment: input.enrichment,
    marketplace_projection: input.projection,
    source_attachment: input.billMetadata
      ? {
          filename: str(input.billMetadata.filename),
          content_type: str(input.billMetadata.content_type),
          size_bytes: num(input.billMetadata.size_bytes),
          storage_provider: str(input.billMetadata.storage_provider),
          storage_key: str(input.billMetadata.storage_key),
        }
      : null,
  };
}

async function loadIntakeRow(sql: SqlClient, eventId: string): Promise<IntakeRow | null> {
  const rows = await sql`
    SELECT id::text, event_id, opportunity_id::text, payload, pipeline_result, source_system, source_channel, funnel_id::text, campaign_id::text
    FROM intake_events
    WHERE id::text = ${eventId}
       OR event_id = ${eventId}
    LIMIT 1
  `;
  return (rows[0] as IntakeRow | undefined) ?? null;
}

async function persistIntakeBillIntelligence(input: {
  sql: SqlClient;
  row: IntakeRow;
  billMetadata: StoredBillMetadata | null;
  intelligence: Record<string, unknown>;
  projection: ReturnType<typeof buildProjection>;
  trigger: string;
  durationMs: number;
}) {
  const projection = input.projection;
  const intelligenceJson = JSON.stringify(input.intelligence);
  const projectionJson = JSON.stringify(projection);
  const eventId = `billintel_${input.row.event_id}_${eventSuffix()}`;

  await input.sql`
    WITH base AS (
      SELECT id, event_id,
        jsonb_set(
          jsonb_set(COALESCE(payload, '{}'::jsonb), '{bill_intelligence}', ${intelligenceJson}::jsonb, true),
          '{bill_marketplace_projection}', ${projectionJson}::jsonb, true
        ) AS next_payload
      FROM intake_events
      WHERE id::text = ${input.row.id}
         OR event_id = ${input.row.event_id}
      LIMIT 1
    ), projected AS (
      SELECT id, event_id,
        CASE WHEN next_payload ? 'utility_provider' OR ${projection.utility_provider}::text IS NULL THEN next_payload ELSE jsonb_set(next_payload, '{utility_provider}', to_jsonb(${projection.utility_provider}::text), true) END AS p1
      FROM base
    ), p2 AS (
      SELECT id, event_id,
        CASE WHEN p1 ? 'monthly_usage_avg_kwh' OR ${projection.monthly_usage_avg_kwh}::numeric IS NULL THEN p1 ELSE jsonb_set(p1, '{monthly_usage_avg_kwh}', to_jsonb(${projection.monthly_usage_avg_kwh}::numeric), true) END AS p
      FROM projected
    ), p3 AS (
      SELECT id, event_id,
        CASE WHEN p ? 'annual_usage_kwh' OR ${projection.annual_usage_kwh}::numeric IS NULL THEN p ELSE jsonb_set(p, '{annual_usage_kwh}', to_jsonb(${projection.annual_usage_kwh}::numeric), true) END AS p
      FROM p2
    ), p4 AS (
      SELECT id, event_id,
        CASE WHEN p ? 'utility_rate_per_kwh' OR ${projection.utility_rate_per_kwh}::numeric IS NULL THEN p ELSE jsonb_set(p, '{utility_rate_per_kwh}', to_jsonb(${projection.utility_rate_per_kwh}::numeric), true) END AS p
      FROM p3
    ), p5 AS (
      SELECT id, event_id,
        CASE WHEN p ? 'estimated_system_size_kw' OR ${projection.estimated_system_size_kw}::numeric IS NULL THEN p ELSE jsonb_set(p, '{estimated_system_size_kw}', to_jsonb(${projection.estimated_system_size_kw}::numeric), true) END AS p
      FROM p4
    ), p6 AS (
      SELECT id, event_id,
        CASE WHEN p ? 'estimated_project_value' OR ${projection.estimated_project_value}::numeric IS NULL THEN p ELSE jsonb_set(p, '{estimated_project_value}', to_jsonb(${projection.estimated_project_value}::numeric), true) END AS p
      FROM p5
    ), p7 AS (
      SELECT id, event_id,
        CASE WHEN p ? 'battery_candidate' THEN p ELSE jsonb_set(p, '{battery_candidate}', to_jsonb(${projection.battery_candidate}::boolean), true) END AS p
      FROM p6
    )
    UPDATE intake_events
    SET payload = jsonb_strip_nulls(p7.p),
        pipeline_result = jsonb_set(
          COALESCE(pipeline_result, '{}'::jsonb),
          '{bill_intelligence}',
          jsonb_build_object(
            'status', 'completed',
            'schema_version', ${UTILITY_BILL_INTELLIGENCE_VERSION},
            'completed_at', NOW(),
            'duration_ms', ${input.durationMs},
            'trigger', ${input.trigger}
          ),
          true
        )
    FROM p7
    WHERE intake_events.id = p7.id
  `;

  await input.sql`
    INSERT INTO intake_events (
      event_id, opportunity_id, event_type, event_source,
      source_system, source_channel,
      funnel_id, campaign_id,
      payload, validation_result, duplicate_result, pipeline_result,
      action, original_event_id, processing_duration_ms, occurred_at
    ) VALUES (
      ${eventId}, ${input.row.opportunity_id}, 'utility_bill_intelligence', 'homeowner_intake_bill_adapter',
      ${input.row.source_system}, ${input.row.source_channel},
      ${input.row.funnel_id}, ${input.row.campaign_id},
      ${JSON.stringify({
        original_event_id: input.row.event_id,
        bill_metadata: input.billMetadata,
        bill_intelligence: input.intelligence,
        bill_marketplace_projection: projection,
      })},
      ${JSON.stringify({ skipped: true, reason: "derived_bill_intelligence_event" })},
      ${JSON.stringify({ skipped: true })},
      ${JSON.stringify({
        action: "utility_bill_intelligence_completed",
        schema_version: UTILITY_BILL_INTELLIGENCE_VERSION,
        duration_ms: input.durationMs,
        trigger: input.trigger,
      })},
      'utility_bill_intelligence_completed', ${input.row.event_id}, ${input.durationMs}, NOW()
    )
    ON CONFLICT (event_id) DO NOTHING
  `;
}

async function projectExistingOpportunity(sql: SqlClient, opportunityId: string, projection: ReturnType<typeof buildProjection>) {
  await sql`
    UPDATE network_opportunities
    SET
      utility_provider = COALESCE(utility_provider, ${projection.utility_provider}),
      monthly_usage_avg_kwh = COALESCE(monthly_usage_avg_kwh, ${projection.monthly_usage_avg_kwh}),
      annual_usage_kwh = COALESCE(annual_usage_kwh, ${projection.annual_usage_kwh}),
      utility_rate_per_kwh = COALESCE(utility_rate_per_kwh, ${projection.utility_rate_per_kwh}),
      estimated_system_size_kw = COALESCE(estimated_system_size_kw, ${projection.estimated_system_size_kw}),
      estimated_project_value = COALESCE(estimated_project_value, ${projection.estimated_project_value}),
      estimated_annual_savings = COALESCE(estimated_annual_savings, ${projection.estimated_annual_savings}),
      estimated_payback_yrs = COALESCE(estimated_payback_yrs, ${projection.estimated_payback_yrs}),
      battery_candidate = COALESCE(battery_candidate, ${projection.battery_candidate}),
      battery_reason = COALESCE(battery_reason, ${projection.battery_reason}),
      raw_payload = jsonb_set(COALESCE(raw_payload, '{}'::jsonb), '{bill_marketplace_projection}', ${JSON.stringify(projection)}::jsonb, true),
      updated_at = NOW()
    WHERE id = ${opportunityId}
  `;

  await enrichAndPersistOpportunity(sql, opportunityId, {
    triggeredBy: "system",
    logEvent: true,
  });
}

export async function ingestUtilityBillIntelligence(input: UtilityBillIntelligenceInput): Promise<
  | {
      ok: true;
      projected: ReturnType<typeof buildProjection>;
      opportunity_id: string | null;
      intelligence: Record<string, unknown>;
      parser_result: Record<string, unknown>;
    }
  | { ok: false; reason: string }
> {
  const startedAt = Date.now();
  const trigger = input.trigger ?? "system";

  console.info("[UTILITY BILL INTELLIGENCE] ingest_start", { event_id: input.eventId, trigger });

  try {
    const sql = await getDbReady();
    const row = await loadIntakeRow(sql, input.eventId);
    if (!row) {
      console.warn("[UTILITY BILL INTELLIGENCE] intake_not_found", { event_id: input.eventId });
      return { ok: false, reason: "intake_not_found" };
    }

    const billMetadata = resolveBillMetadata(input, row);
    const downloadUrl = downloadUrlFromMetadata(billMetadata);
    logAdminBillAudit("[ADMIN_BILL_ATTACHMENT_LOOKUP]", {
      intake_event_id: row.event_id,
      row_found: true,
      attachment_exists: !!billMetadata,
      has_download_url: !!downloadUrl,
      storage_status: str(billMetadata?.storage_status),
      storage_provider: str(billMetadata?.storage_provider),
      content_type: str(billMetadata?.content_type),
      size_bytes: num(billMetadata?.size_bytes),
      metadata_keys: safeObjectKeys(billMetadata),
    });
    if (!billMetadata || !downloadUrl) {
      console.info("[UTILITY BILL INTELLIGENCE] skipped_no_stored_bill", {
        event_id: row.event_id,
        storage_status: str(billMetadata?.storage_status),
      });
      return { ok: false, reason: "no_stored_bill" };
    }

    console.info("[UTILITY BILL INTELLIGENCE] bill_download_start", {
      event_id: row.event_id,
      filename: str(billMetadata.filename),
      content_type: str(billMetadata.content_type),
      storage_provider: str(billMetadata.storage_provider),
    });

    const downloaded = await fetchStoredBill(billMetadata);
    logAdminBillAudit("[ADMIN_BILL_BLOB_DOWNLOAD]", {
      intake_event_id: row.event_id,
      storage_provider: str(billMetadata.storage_provider),
      download_succeeded: true,
      response_mime_type: downloaded.mimeType,
      buffer_byte_length: downloaded.buffer.length,
    });
    logAdminBillAudit("[ADMIN_BILL_BUFFER_READY]", {
      intake_event_id: row.event_id,
      mime_type: downloaded.mimeType,
      buffer_byte_length: downloaded.buffer.length,
      non_empty: downloaded.buffer.length > 0,
    });
    console.info("[UTILITY BILL INTELLIGENCE] parser_start", {
      event_id: row.event_id,
      mime_type: downloaded.mimeType,
      bytes: downloaded.buffer.length,
    });

    const parsedResult = await parseStoredBillWithDashboardParity(downloaded.buffer, downloaded.mimeType, row.event_id);
    if (!parsedResult.success || !parsedResult.data) {
      console.warn("[UTILITY BILL INTELLIGENCE] parser_failed", {
        event_id: row.event_id,
        extraction_method: parsedResult.extractionMethod,
        error: parsedResult.error,
      });
      return { ok: false, reason: parsedResult.error ?? "parse_failed" };
    }

    const parsed = parsedResult.data;
    logAdminBillAudit("[ADMIN_BILL_NORMALIZED_RESULT]", {
      intake_event_id: row.event_id,
      success: parsedResult.success,
      parser_path: parsedResult.parserPath ?? null,
      extraction_method: parsedResult.extractionMethod ?? null,
      claude_metadata_keys: safeObjectKeys(parsedResult.claude),
      extracted_field_count: extractedFieldCount(parsed),
      extracted_fields: parsed.extractedFields ?? [],
      months_found: monthsFound(parsed),
      confidence_label: parsed.confidence ?? null,
      has_utility_provider: !!parsed.utilityProvider,
      has_monthly_kwh: parsed.monthlyKwh != null,
      has_annual_kwh: parsed.annualKwh != null || parsed.estimatedAnnualKwh != null,
    });

    const enrichmentInput: BillEnrichmentInput = {
      utilityName: parsed.utilityProvider ?? null,
      state: str(row.payload?.state) ?? str(row.payload?.location_state),
      parsedRate: parsed.electricityRate ?? null,
      monthlyKwh: parsed.monthlyKwh ?? null,
      annualKwh: parsed.annualKwh ?? parsed.estimatedAnnualKwh ?? null,
      monthlyHistory: parsed.monthlyUsageHistory ?? null,
      billingPeriodStart: parsed.billingPeriodStart ?? null,
      billingPeriodEnd: parsed.billingPeriodEnd ?? null,
    };

    let enrichment: Awaited<ReturnType<typeof enrichBillData>> | null = null;
    try {
      enrichment = await enrichBillData(enrichmentInput);
    } catch (err) {
      console.warn("[UTILITY BILL INTELLIGENCE] enrichment_failed_non_fatal", {
        event_id: row.event_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const projection = buildProjection(parsed, enrichment);
    const intelligence = buildIntelligencePayload({
      parsed,
      extractionMethod: parsedResult.extractionMethod ?? null,
      extractionEvidence: parsedResult.extractionEvidence ?? null,
      parserPath: parsedResult.parserPath ?? "pipeline",
      parserResult: buildDashboardParserResult({
        parsed,
        extractionMethod: parsedResult.extractionMethod ?? null,
        extractionEvidence: parsedResult.extractionEvidence ?? {},
        durationMs: Date.now() - startedAt,
        parserPath: parsedResult.parserPath ?? "pipeline",
        claude: parsedResult.claude ?? null,
      }),
      enrichment,
      projection,
      billMetadata,
    });
    const durationMs = Date.now() - startedAt;

    console.info("[UTILITY BILL INTELLIGENCE] extraction_confidence", {
      event_id: row.event_id,
      confidence_label: parsed.confidence,
      confidence: (intelligence.extraction as Record<string, unknown>).confidence,
      fields: parsed.extractedFields,
      annual_usage_kwh: projection.annual_usage_kwh,
      monthly_usage_avg_kwh: projection.monthly_usage_avg_kwh,
      utility_rate_per_kwh: projection.utility_rate_per_kwh,
    });

    await persistIntakeBillIntelligence({
      sql,
      row,
      billMetadata,
      intelligence,
      projection,
      trigger,
      durationMs,
    });

    const persistedRows = await sql`
      SELECT
        payload->'bill_intelligence' AS bill_intelligence,
        payload->'bill_marketplace_projection' AS bill_marketplace_projection,
        pipeline_result->'bill_intelligence' AS pipeline_bill_intelligence
      FROM intake_events
      WHERE id::text = ${row.id}
         OR event_id = ${row.event_id}
      LIMIT 1
    `;
    const persisted = persistedRows[0] as Record<string, unknown> | undefined;
    const persistedIntelligence = recordFromUnknown(persisted?.bill_intelligence);
    const persistedParserResult = recordFromUnknown(persistedIntelligence.parser_result);
    const persistedParserBillData = recordFromUnknown(persistedParserResult.billData);
    const persistedExtraction = recordFromUnknown(persistedIntelligence.extraction);
    const persistedPipelineStatus = recordFromUnknown(persisted?.pipeline_bill_intelligence);

    logAdminBillAudit("[ADMIN_BILL_PERSISTED]", {
      intake_event_id: row.event_id,
      persisted_row_found: !!persisted,
      db_payload_key: "payload.bill_intelligence",
      db_projection_key: "payload.bill_marketplace_projection",
      db_status_key: "pipeline_result.bill_intelligence",
      has_bill_intelligence: safeObjectKeys(persistedIntelligence).length > 0,
      has_bill_marketplace_projection: safeObjectKeys(persisted?.bill_marketplace_projection).length > 0,
      has_pipeline_bill_status: safeObjectKeys(persistedPipelineStatus).length > 0,
      intelligence_keys: safeObjectKeys(persistedIntelligence),
      parser_result_keys: safeObjectKeys(persistedParserResult),
      extraction_keys: safeObjectKeys(persistedExtraction),
      parser_bill_data_keys: safeObjectKeys(persistedParserBillData),
      pipeline_status_keys: safeObjectKeys(persistedPipelineStatus),
      extracted_field_count: Array.isArray(persistedParserBillData.extractedFields)
        ? persistedParserBillData.extractedFields.length
        : Array.isArray(persistedExtraction.extracted_fields)
          ? persistedExtraction.extracted_fields.length
          : 0,
      months_found: Array.isArray(persistedParserBillData.monthlyUsageHistory)
        ? persistedParserBillData.monthlyUsageHistory.filter((value) => Number.isFinite(value) && value > 0).length
        : 0,
      duration_ms: durationMs,
    });

    if (row.opportunity_id) {
      await projectExistingOpportunity(sql, row.opportunity_id, projection);
    }

    console.info("[UTILITY BILL INTELLIGENCE] enrichment_projection_complete", {
      event_id: row.event_id,
      opportunity_id: row.opportunity_id,
      duration_ms: durationMs,
      projected_fields: Object.entries(projection)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key]) => key),
    });

    return {
      ok: true,
      projected: projection,
      opportunity_id: row.opportunity_id,
      intelligence,
      parser_result: recordFromUnknown(intelligence.parser_result),
    };
  } catch (err) {
    console.warn("[UTILITY BILL INTELLIGENCE] ingest_failed_non_fatal", {
      event_id: input.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: err instanceof Error ? err.message : "ingest_failed" };
  }
}

export function runUtilityBillIntelligenceAsync(input: UtilityBillIntelligenceInput): void {
  ingestUtilityBillIntelligence(input).catch((err) => {
    console.warn("[UTILITY BILL INTELLIGENCE] async_unhandled_non_fatal", {
      event_id: input.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
