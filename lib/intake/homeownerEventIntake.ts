/**
 * homeownerEventIntake.ts
 *
 * Review-first homeowner intake for /free-solar-estimate.
 *
 * This module intentionally persists public homeowner submissions to the
 * canonical intake_events table only. It does not create network_opportunities,
 * opportunity_sources, enrichment_queue rows, assignments, or marketplace
 * inventory. Operator review can later convert an intake event into an
 * opportunity through the canonical admin workflow.
 */

import { getDbReady } from '@/lib/db-neon'
import { validateIntakePayload, type RawIntakePayload, type ValidatedIntakePayload } from './intakeValidator'

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady()
  return (db as any)(strings, ...values)
}

export type HomeownerIntakeAction = 'pending_review' | 'validation_failed' | 'error'

export interface HomeownerIntakeOptions {
  source_system?: string
  source_channel?: string
  funnel_id?: string | null
  funnel_slug?: string | null
  campaign_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  referer?: string | null
  require_email?: boolean
  require_phone?: boolean
  require_address?: boolean
}

export interface HomeownerIntakeResult {
  action: HomeownerIntakeAction
  event_id: string | null
  validation_errors: string[]
  validation_warnings: string[]
  duration_ms: number
}

interface HomeownerEventData {
  event_id: string
  action: HomeownerIntakeAction | 'malformed'
  source_system: string
  source_channel: string
  funnel_id?: string | null
  campaign_id?: string | null
  idempotency_key?: string | null
  payload: Record<string, unknown>
  validation_result: Record<string, unknown>
  duplicate_result: Record<string, unknown>
  pipeline_result: Record<string, unknown>
  error_code?: string | null
  error_message?: string | null
  ip_address?: string | null
  user_agent?: string | null
  referer?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
}

function makeEventId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `evt_homeowner_${ts}_${rand}`
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function deriveIdempotencyKey(payload: Record<string, unknown>): string | null {
  const explicit = cleanString(payload.idempotency_key)
  if (explicit) return explicit

  const email = cleanString(payload.email)?.toLowerCase() ?? ''
  const phone = cleanString(payload.phone)?.replace(/\D/g, '') ?? ''
  const address = cleanString(payload.address_line1) ?? cleanString(payload.property_address) ?? ''
  if (!email && !phone && !address) return null
  return ['homeowner_form', email, phone, address.toLowerCase()].join(':').slice(0, 240)
}

function operationalPayload(raw: Record<string, unknown>, normalized: ValidatedIntakePayload | null, opts: HomeownerIntakeOptions): Record<string, unknown> {
  return {
    ...raw,
    canonical_review_flow: 'event_first_operator_review',
    funnel_slug: opts.funnel_slug ?? cleanString(raw.funnel_slug) ?? 'free-solar-estimate',
    source_system: opts.source_system ?? normalized?.source_system ?? cleanString(raw.source_system) ?? 'homeowner_form',
    source_channel: normalized?.source_channel ?? opts.source_channel ?? cleanString(raw.source_channel) ?? 'web',
    first_name: normalized?.first_name ?? cleanString(raw.first_name),
    last_name: normalized?.last_name ?? cleanString(raw.last_name),
    email: normalized?.email ?? cleanString(raw.email),
    phone: normalized?.phone ?? cleanString(raw.phone),
    address_line1: normalized?.address_line1 ?? cleanString(raw.address_line1) ?? cleanString(raw.property_address),
    city: normalized?.city ?? cleanString(raw.city),
    state: normalized?.state ?? cleanString(raw.state),
    zip: normalized?.zip ?? cleanString(raw.zip),
    monthly_bill_amount: normalized?.monthly_bill_amount ?? numberOrNull(raw.monthly_bill_amount) ?? numberOrNull(raw.average_monthly_bill),
    utility_provider: cleanString(raw.utility_provider),
    battery_interest: cleanString(raw.battery_interest),
    homeowner_status: cleanString(raw.homeowner_status) ?? normalized?.home_ownership ?? cleanString(raw.home_ownership),
    home_ownership: normalized?.home_ownership ?? cleanString(raw.home_ownership) ?? cleanString(raw.homeowner_status),
    preferred_contact_method: cleanString(raw.preferred_contact_method),
    timeline: cleanString(raw.timeline),
    roof_age: cleanString(raw.roof_age),
    roof_age_years: normalized?.roof_age_years ?? numberOrNull(raw.roof_age_years) ?? numberOrNull(raw.roof_age),
    bill_metadata: {
      filename: cleanString(raw.uploaded_bill_filename),
      size_bytes: numberOrNull(raw.uploaded_bill_size_bytes),
      content_type: cleanString(raw.uploaded_bill_content_type),
    },
    attribution: {
      utm_source: normalized?.utm_source ?? cleanString(raw.utm_source),
      utm_medium: normalized?.utm_medium ?? cleanString(raw.utm_medium),
      utm_campaign: normalized?.utm_campaign ?? cleanString(raw.utm_campaign),
      utm_content: normalized?.utm_content ?? cleanString(raw.utm_content),
      utm_term: normalized?.utm_term ?? cleanString(raw.utm_term),
      gclid: normalized?.gclid ?? cleanString(raw.gclid),
      fbclid: normalized?.fbclid ?? cleanString(raw.fbclid),
    },
    consent_given: normalized?.consent_given ?? raw.consent_given === true,
    consent_text: normalized?.consent_text ?? cleanString(raw.consent_text),
    consent_timestamp: normalized?.consent_timestamp ?? cleanString(raw.consent_timestamp),
    notes: normalized?.notes ?? cleanString(raw.notes),
  }
}

async function insertHomeownerEvent(data: HomeownerEventData): Promise<void> {
  await sql`
    INSERT INTO intake_events (
      event_id, opportunity_id, event_type, event_source,
      source_system, source_channel,
      funnel_id, campaign_id, idempotency_key,
      payload, validation_result, duplicate_result, pipeline_result,
      action, error_code, error_message,
      ip_address, user_agent, referer,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, fbclid
    )
    VALUES (
      ${data.event_id},
      ${null},
      'homeowner_intake',
      'free_solar_estimate',
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
      ${data.referer || null},
      ${data.utm_source || null},
      ${data.utm_medium || null},
      ${data.utm_campaign || null},
      ${data.utm_content || null},
      ${data.utm_term || null},
      ${data.gclid || null},
      ${data.fbclid || null}
    )
    ON CONFLICT (event_id) DO NOTHING
  `
}

export async function submitHomeownerIntakeEvent(rawPayload: Record<string, unknown>, options: HomeownerIntakeOptions = {}): Promise<HomeownerIntakeResult> {
  const startedAt = Date.now()
  const sourceSystem = options.source_system || cleanString(rawPayload.source_system) || 'homeowner_form'
  const sourceChannel = options.source_channel || cleanString(rawPayload.source_channel) || 'web'
  const eventId = makeEventId()
  const idempotencyKey = deriveIdempotencyKey(rawPayload)

  const validation = validateIntakePayload(rawPayload as RawIntakePayload, {
    source_system: sourceSystem,
    require_email: options.require_email ?? true,
    require_phone: options.require_phone ?? true,
    require_address: options.require_address ?? true,
  })

  const normalized = validation.payload
  const payload = operationalPayload(rawPayload, normalized, options)
  const validationResult = { errors: validation.errors, warnings: validation.warnings }
  const attribution = payload.attribution as Record<string, unknown> | undefined

  if (!validation.valid || !normalized) {
    await insertHomeownerEvent({
      event_id: eventId,
      action: 'validation_failed',
      source_system: sourceSystem,
      source_channel: sourceChannel,
      funnel_id: options.funnel_id || null,
      campaign_id: options.campaign_id || null,
      idempotency_key: idempotencyKey,
      payload,
      validation_result: validationResult,
      duplicate_result: {},
      pipeline_result: { action: 'validation_failed', review_status: 'not_reviewable' },
      error_code: 'VALIDATION_FAILED',
      error_message: validation.errors.join('; '),
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
      utm_source: cleanString(attribution?.utm_source),
      utm_medium: cleanString(attribution?.utm_medium),
      utm_campaign: cleanString(attribution?.utm_campaign),
      utm_content: cleanString(attribution?.utm_content),
      utm_term: cleanString(attribution?.utm_term),
      gclid: cleanString(attribution?.gclid),
      fbclid: cleanString(attribution?.fbclid),
    })
    return { action: 'validation_failed', event_id: eventId, validation_errors: validation.errors, validation_warnings: validation.warnings, duration_ms: Date.now() - startedAt }
  }

  try {
    await insertHomeownerEvent({
      event_id: eventId,
      action: 'pending_review',
      source_system: normalized.source_system,
      source_channel: normalized.source_channel,
      funnel_id: options.funnel_id || normalized.funnel_id || null,
      campaign_id: options.campaign_id || normalized.campaign_id || null,
      idempotency_key: idempotencyKey,
      payload,
      validation_result: validationResult,
      duplicate_result: { status: 'not_run', reason: 'review_first_homeowner_event' },
      pipeline_result: {
        action: 'pending_review',
        review_status: 'pending_operator_review',
        opportunity_id: null,
        marketplace_auto_release: false,
      },
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
      utm_source: normalized.utm_source,
      utm_medium: normalized.utm_medium,
      utm_campaign: normalized.utm_campaign,
      utm_content: normalized.utm_content,
      utm_term: normalized.utm_term,
      gclid: normalized.gclid,
      fbclid: normalized.fbclid,
    })
    return { action: 'pending_review', event_id: eventId, validation_errors: [], validation_warnings: validation.warnings, duration_ms: Date.now() - startedAt }
  } catch (err) {
    console.error('[homeownerEventIntake] Failed to persist homeowner intake event:', err)
    return { action: 'error', event_id: eventId, validation_errors: [], validation_warnings: validation.warnings, duration_ms: Date.now() - startedAt }
  }
}

export async function logMalformedHomeownerIntake(message: string, options: HomeownerIntakeOptions = {}): Promise<string | null> {
  const eventId = makeEventId()
  try {
    await insertHomeownerEvent({
      event_id: eventId,
      action: 'malformed',
      source_system: options.source_system || 'homeowner_form',
      source_channel: options.source_channel || 'web',
      funnel_id: options.funnel_id || null,
      campaign_id: options.campaign_id || null,
      idempotency_key: null,
      payload: {
        canonical_review_flow: 'event_first_operator_review',
        funnel_slug: options.funnel_slug || 'free-solar-estimate',
        raw_parse_error: true,
      },
      validation_result: { errors: ['Invalid JSON body'], warnings: [] },
      duplicate_result: {},
      pipeline_result: { action: 'malformed', review_status: 'not_reviewable' },
      error_code: 'MALFORMED_JSON',
      error_message: message,
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      referer: options.referer || null,
    })
    return eventId
  } catch (err) {
    console.warn('[homeownerEventIntake] Failed to log malformed homeowner intake:', (err as Error).message)
    return null
  }
}
