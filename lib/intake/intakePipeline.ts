/**
 * intakePipeline.ts
 *
 * SolarPro Intake & Acquisition Infrastructure — Main Intake Orchestrator
 *
 * Orchestrates the full intake flow:
 *   1. Validate & normalize payload
 *   2. Duplicate detection (6 tiers)
 *   3. Create/update network_opportunity + opportunity_sources
 *   4. Update webhook_ingestion_log if provided
 *   5. Enqueue for enrichment
 *   6. Log intake_event
 *   7. Return structured result
 *
 * Actions:
 *   created           — new opportunity created
 *   duplicate_blocked — exact or near-exact duplicate, blocked
 *   duplicate_flagged — possible duplicate, created but flagged
 *   validation_failed — payload did not pass validation
 *   error             — unexpected error
 *
 * Uses neon() directly.
 */

import { getDbReady } from '@/lib/db-neon'
import { validateIntakePayload, type RawIntakePayload } from './intakeValidator'
import { checkForDuplicates } from './duplicateDetector'
import { enqueueEnrichment, type EnqueueOptions } from './enrichmentQueue'
import { generateIdempotencyKey } from './webhookVerifier'

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady()
  return (db as any)(strings, ...values)
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type PipelineAction = 'created' | 'duplicate_blocked' | 'duplicate_flagged' | 'validation_failed' | 'error'

export interface PipelineOptions {
  source_system?: string
  source_channel?: string
  funnel_id?: string
  campaign_id?: string
  webhook_log_id?: string
  idempotency_key?: string
  ip_address?: string
  user_agent?: string
  referer?: string
  require_email?: boolean
  require_phone?: boolean
  require_address?: boolean
  enrichment?: EnqueueOptions
  skip_enrichment?: boolean
}

export interface PipelineResult {
  action: PipelineAction
  opportunity_id: string | null
  idempotency_key: string | null
  duplicate_score: number
  duplicate_match_id: string | null
  validation_errors: string[]
  validation_warnings: string[]
  event_id: string | null
  duration_ms: number
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeEventId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `evt_${ts}_${rand}`
}

// ────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────────────────

export async function runIntakePipeline(
  rawPayload: RawIntakePayload,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startedAt = Date.now()

  // ── Step 1: Validate
  const validationResult = validateIntakePayload(rawPayload, {
    source_system: options.source_system,
    require_email: options.require_email,
    require_phone: options.require_phone,
    require_address: options.require_address,
  })

  if (!validationResult.valid || !validationResult.payload) {
    await logIntakeEvent({
      event_id: makeEventId(),
      opportunity_id: null,
      action: 'validation_failed',
      source_system: options.source_system || 'unknown',
      source_channel: options.source_channel || 'unknown',
      funnel_id: options.funnel_id || null,
      campaign_id: options.campaign_id || null,
      idempotency_key: options.idempotency_key || null,
      payload: rawPayload,
      validation_result: { errors: validationResult.errors, warnings: validationResult.warnings },
      duplicate_result: {},
      pipeline_result: { action: 'validation_failed' },
      error_code: 'VALIDATION_FAILED',
      error_message: validationResult.errors.join('; '),
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
    })
    return {
      action: 'validation_failed',
      opportunity_id: null,
      idempotency_key: options.idempotency_key || null,
      duplicate_score: 0,
      duplicate_match_id: null,
      validation_errors: validationResult.errors,
      validation_warnings: validationResult.warnings,
      event_id: null,
      duration_ms: Date.now() - startedAt,
    }
  }

  const payload = validationResult.payload

  // ── Step 2: Duplicate detection
  const dupResult = await checkForDuplicates(payload)

  if (dupResult.is_blocked) {
    const eventId = makeEventId()
    await logIntakeEvent({
      event_id: eventId,
      opportunity_id: dupResult.best_match?.opportunity_id || null,
      action: 'duplicate_blocked',
      source_system: payload.source_system,
      source_channel: payload.source_channel,
      funnel_id: options.funnel_id || payload.funnel_id,
      campaign_id: options.campaign_id || payload.campaign_id,
      idempotency_key: options.idempotency_key || null,
      payload: rawPayload,
      validation_result: { errors: [], warnings: validationResult.warnings },
      duplicate_result: {
        score: dupResult.score,
        tier: dupResult.best_match?.tier,
        tier_name: dupResult.best_match?.tier_name,
        match_id: dupResult.best_match?.opportunity_id,
      },
      pipeline_result: { action: 'duplicate_blocked' },
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
    })
    return {
      action: 'duplicate_blocked',
      opportunity_id: dupResult.best_match?.opportunity_id || null,
      idempotency_key: options.idempotency_key || null,
      duplicate_score: dupResult.score,
      duplicate_match_id: dupResult.best_match?.opportunity_id || null,
      validation_errors: [],
      validation_warnings: validationResult.warnings,
      event_id: eventId,
      duration_ms: Date.now() - startedAt,
    }
  }

  // ── Step 2.5: Idempotency pre-check — if this exact delivery was already
  // processed (same idempotency key, e.g. a webhook the provider retried),
  // return the existing lead instead of creating a duplicate. Best-effort:
  // degrades silently if the intake_idempotency_key column isn't present yet
  // (migration 089 pending), so it can never break lead intake.
  if (options.idempotency_key) {
    try {
      const prior = await sql`
        SELECT id FROM network_opportunities
        WHERE intake_idempotency_key = ${options.idempotency_key}
        LIMIT 1
      `
      const priorId = (prior[0]?.id as string) || null
      if (priorId) {
        return {
          action: 'duplicate_blocked',
          opportunity_id: priorId,
          idempotency_key: options.idempotency_key,
          duplicate_score: 100,
          duplicate_match_id: priorId,
          validation_errors: [],
          validation_warnings: validationResult.warnings,
          event_id: makeEventId(),
          duration_ms: Date.now() - startedAt,
        }
      }
    } catch (e) {
      console.warn('[intakePipeline] idempotency pre-check skipped:', (e as Error).message)
    }
  }

  // ── Step 3: Create opportunity
  let opportunityId: string | null = null
  try {
    const isDupFlagged = dupResult.is_flagged
    const idemKey = options.idempotency_key ?? null

    // RACE-SAFE INSERT: write the idempotency key INSIDE the insert with
    // ON CONFLICT DO NOTHING, so the unique index (migration 089) is what
    // serializes concurrent re-deliveries — not a non-transactional pre-check
    // plus a post-insert UPDATE (which left a duplicate row already inserted).
    // A NULL key never conflicts (Postgres treats NULLs as distinct), so plain
    // keyless submissions are unaffected. Falls back to a keyless insert if the
    // column isn't present yet (migration 089 pending) so intake never breaks.
    let rows: Array<{ id?: string }>
    try {
      rows = await sql`
        INSERT INTO network_opportunities (
          first_name, last_name, email, phone,
          address_line1, address_line2, city, state, zip, county,
          latitude, longitude,
          monthly_bill_amount, current_electricity_rate,
          property_type, home_ownership, roof_type, roof_shade,
          roof_age_years, square_feet_living,
          source_system, source_channel,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          gclid, fbclid,
          is_duplicate_flagged, duplicate_score, duplicate_of_id,
          consent_given,
          notes,
          intake_idempotency_key,
          status
        )
        VALUES (
          ${payload.first_name}, ${payload.last_name},
          ${payload.email}, ${payload.phone},
          ${payload.address_line1}, ${payload.address_line2},
          ${payload.city}, ${payload.state}, ${payload.zip}, ${payload.county},
          ${payload.latitude}, ${payload.longitude},
          ${payload.monthly_bill_amount}, ${payload.current_electricity_rate},
          ${payload.property_type}, ${payload.home_ownership},
          ${payload.roof_type}, ${payload.roof_shade},
          ${payload.roof_age_years}, ${payload.square_feet},
          ${payload.source_system}, ${payload.source_channel},
          ${payload.utm_source}, ${payload.utm_medium},
          ${payload.utm_campaign}, ${payload.utm_content}, ${payload.utm_term},
          ${payload.gclid}, ${payload.fbclid},
          ${isDupFlagged}, ${dupResult.score},
          ${dupResult.best_match?.opportunity_id || null},
          ${payload.consent_given},
          ${payload.notes},
          ${idemKey},
          'new'
        )
        ON CONFLICT (intake_idempotency_key) DO NOTHING
        RETURNING id
      `
    } catch (colErr) {
      // intake_idempotency_key column/index not present yet (migration 089
      // pending) — fall back to a plain keyless insert so intake never breaks.
      console.warn('[intakePipeline] idempotency column missing, plain insert:', (colErr as Error).message)
      rows = await sql`
        INSERT INTO network_opportunities (
          first_name, last_name, email, phone,
          address_line1, address_line2, city, state, zip, county,
          latitude, longitude,
          monthly_bill_amount, current_electricity_rate,
          property_type, home_ownership, roof_type, roof_shade,
          roof_age_years, square_feet_living,
          source_system, source_channel,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          gclid, fbclid,
          is_duplicate_flagged, duplicate_score, duplicate_of_id,
          consent_given,
          notes,
          status
        )
        VALUES (
          ${payload.first_name}, ${payload.last_name},
          ${payload.email}, ${payload.phone},
          ${payload.address_line1}, ${payload.address_line2},
          ${payload.city}, ${payload.state}, ${payload.zip}, ${payload.county},
          ${payload.latitude}, ${payload.longitude},
          ${payload.monthly_bill_amount}, ${payload.current_electricity_rate},
          ${payload.property_type}, ${payload.home_ownership},
          ${payload.roof_type}, ${payload.roof_shade},
          ${payload.roof_age_years}, ${payload.square_feet},
          ${payload.source_system}, ${payload.source_channel},
          ${payload.utm_source}, ${payload.utm_medium},
          ${payload.utm_campaign}, ${payload.utm_content}, ${payload.utm_term},
          ${payload.gclid}, ${payload.fbclid},
          ${isDupFlagged}, ${dupResult.score},
          ${dupResult.best_match?.opportunity_id || null},
          ${payload.consent_given},
          ${payload.notes},
          'new'
        )
        RETURNING id
      `
    }
    opportunityId = rows[0]?.id as string || null

    // ON CONFLICT DO NOTHING returned no row → a concurrent/duplicate delivery
    // with the same key already created the opportunity. Return that one as a
    // duplicate instead of falling through and erroring on a null id.
    if (!opportunityId && idemKey) {
      const existing = await sql`
        SELECT id FROM network_opportunities
        WHERE intake_idempotency_key = ${idemKey}
        LIMIT 1
      `
      const existingId = (existing[0]?.id as string) || null
      if (existingId) {
        return {
          action: 'duplicate_blocked',
          opportunity_id: existingId,
          idempotency_key: idemKey,
          duplicate_score: 100,
          duplicate_match_id: existingId,
          validation_errors: [],
          validation_warnings: validationResult.warnings,
          event_id: makeEventId(),
          duration_ms: Date.now() - startedAt,
        }
      }
    }
  } catch (err) {
    console.error('[intakePipeline] Failed to create opportunity:', err)
    const eventId = makeEventId()
    await logIntakeEvent({
      event_id: eventId,
      opportunity_id: null,
      action: 'error',
      source_system: payload.source_system,
      source_channel: payload.source_channel,
      funnel_id: options.funnel_id || payload.funnel_id,
      campaign_id: options.campaign_id || payload.campaign_id,
      idempotency_key: options.idempotency_key || null,
      payload: rawPayload,
      validation_result: {},
      duplicate_result: {},
      pipeline_result: { action: 'error' },
      error_code: 'DB_INSERT_FAILED',
      error_message: (err as Error).message,
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
    })
    return {
      action: 'error',
      opportunity_id: null,
      idempotency_key: options.idempotency_key || null,
      duplicate_score: dupResult.score,
      duplicate_match_id: null,
      validation_errors: [],
      validation_warnings: validationResult.warnings,
      event_id: eventId,
      duration_ms: Date.now() - startedAt,
    }
  }

  if (!opportunityId) {
    return {
      action: 'error',
      opportunity_id: null,
      idempotency_key: options.idempotency_key || null,
      duplicate_score: 0,
      duplicate_match_id: null,
      validation_errors: ['Failed to create opportunity record'],
      validation_warnings: [],
      event_id: null,
      duration_ms: Date.now() - startedAt,
    }
  }

  // ── Step 4: Create opportunity_sources record
  try {
    await sql`
      INSERT INTO opportunity_sources (
        opportunity_id, source_system, source_channel, source_name,
        funnel_id, campaign_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        gclid, fbclid, ttclid,
        ip_address, user_agent, referer
      )
      VALUES (
        ${opportunityId},
        ${payload.source_system}, ${payload.source_channel},
        ${payload.source_name},
        ${options.funnel_id || payload.funnel_id || null},
        ${options.campaign_id || payload.campaign_id || null},
        ${payload.utm_source}, ${payload.utm_medium},
        ${payload.utm_campaign}, ${payload.utm_content}, ${payload.utm_term},
        ${payload.gclid}, ${payload.fbclid}, ${payload.ttclid},
        ${options.ip_address || payload.ip_address || null},
        ${options.user_agent || payload.user_agent || null},
        ${options.referer || payload.referer || null}
      )
      ON CONFLICT DO NOTHING
    `
  } catch (err) {
    // Non-fatal: opportunity already created
    console.warn('[intakePipeline] opportunity_sources insert failed (non-fatal):', (err as Error).message)
  }

  // ── Step 5: Update webhook_ingestion_log if provided
  if (options.webhook_log_id) {
    try {
      await sql`
        UPDATE webhook_ingestion_log
        SET
          opportunity_id = ${opportunityId},
          status         = 'processed',
          processed_at   = NOW()
        WHERE id = ${options.webhook_log_id}
      `
    } catch (err) {
      console.warn('[intakePipeline] webhook_log update failed (non-fatal):', (err as Error).message)
    }
  }

  // ── Step 6: Enqueue enrichment
  if (!options.skip_enrichment) {
    await enqueueEnrichment(opportunityId, {
      providers: ['property', 'solar', 'utility'],
      priority: 5,
      triggered_by: payload.source_system,
      ...options.enrichment,
    })
  }

  // ── Step 7: Log intake event
  const action: PipelineAction = dupResult.is_flagged ? 'duplicate_flagged' : 'created'
  const eventId = makeEventId()
  await logIntakeEvent({
    event_id: eventId,
    opportunity_id: opportunityId,
    action,
    source_system: payload.source_system,
    source_channel: payload.source_channel,
    funnel_id: options.funnel_id || payload.funnel_id,
    campaign_id: options.campaign_id || payload.campaign_id,
    idempotency_key: options.idempotency_key || null,
    payload: rawPayload,
    validation_result: { warnings: validationResult.warnings },
    duplicate_result: dupResult.is_flagged ? {
      score: dupResult.score,
      tier: dupResult.best_match?.tier,
      match_id: dupResult.best_match?.opportunity_id,
    } : {},
    pipeline_result: { action, opportunity_id: opportunityId },
    ip_address: options.ip_address || null,
    user_agent: options.user_agent || null,
    referer: options.referer || null,
  })

  return {
    action,
    opportunity_id: opportunityId,
    idempotency_key: options.idempotency_key || null,
    duplicate_score: dupResult.score,
    duplicate_match_id: dupResult.best_match?.opportunity_id || null,
    validation_errors: [],
    validation_warnings: validationResult.warnings,
    event_id: eventId,
    duration_ms: Date.now() - startedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Internal event logger
// ────────────────────────────────────────────────────────────────────────────

interface IntakeEventData {
  event_id: string
  opportunity_id: string | null
  action: string
  source_system: string
  source_channel: string
  funnel_id?: string | null
  campaign_id?: string | null
  idempotency_key?: string | null
  payload: unknown
  validation_result: unknown
  duplicate_result: unknown
  pipeline_result: unknown
  error_code?: string | null
  error_message?: string | null
  ip_address?: string | null
  user_agent?: string | null
  referer?: string | null
}

async function logIntakeEvent(data: IntakeEventData): Promise<void> {
  try {
    await sql`
      INSERT INTO intake_events (
        event_id, opportunity_id, event_type, event_source,
        source_system, source_channel,
        funnel_id, campaign_id, idempotency_key,
        payload, validation_result, duplicate_result, pipeline_result,
        action, error_code, error_message,
        ip_address, user_agent, referer
      )
      VALUES (
        ${data.event_id},
        ${data.opportunity_id},
        'intake',
        'pipeline',
        ${data.source_system},
        ${data.source_channel},
        ${data.funnel_id || null},
        ${data.campaign_id || null},
        ${data.idempotency_key || null},
        ${JSON.stringify(data.payload)},
        ${JSON.stringify(data.validation_result)},
        ${JSON.stringify(data.duplicate_result)},
        ${JSON.stringify(data.pipeline_result)},
        ${data.action},
        ${data.error_code || null},
        ${data.error_message || null},
        ${data.ip_address || null},
        ${data.user_agent || null},
        ${data.referer || null}
      )
      ON CONFLICT (event_id) DO NOTHING
    `
  } catch (err) {
    console.error('[intakePipeline.logIntakeEvent] Error (non-fatal):', err)
  }
}
