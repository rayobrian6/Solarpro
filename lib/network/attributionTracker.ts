/**
 * attributionTracker.ts
 *
 * SolarPro Network Intelligence OS — Attribution Tracking
 *
 * Records and queries attribution data for every opportunity.
 * Handles multi-touch attribution, UTM parsing, duplicate detection,
 * and funnel stage progression.
 */

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface AttributionData {
  source_type: string
  platform?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  gclid?: string | null
  fbclid?: string | null
  ttclid?: string | null
  landing_page_url?: string | null
  landing_page_path?: string | null
  landing_page_variant?: string | null
  session_id?: string | null
  ip_address?: string | null
  user_agent?: string | null
  device_type?: string | null
  cost_per_lead?: number | null
  attributed_spend?: number | null
  referring_contractor_id?: string | null
  referral_code?: string | null
  partner_id?: string | null
  partner_name?: string | null
  partner_lead_id?: string | null
  raw_payload?: Record<string, unknown>
}

export interface FunnelEvent {
  opportunity_id: string
  stage: 'lead' | 'qualified' | 'claimed' | 'appointment' | 'proposal' | 'closed_won' | 'closed_lost'
  occurred_at?: Date
  metadata?: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Infer platform from UTM params and click IDs
 */
function inferPlatform(data: AttributionData): string {
  if (data.gclid) return 'google'
  if (data.fbclid) return 'meta'
  if (data.ttclid) return 'tiktok'
  if (data.utm_source) {
    const src = data.utm_source.toLowerCase()
    if (src.includes('google'))   return 'google'
    if (src.includes('facebook') || src.includes('fb') || src.includes('meta')) return 'meta'
    if (src.includes('tiktok'))   return 'tiktok'
    if (src.includes('bing') || src.includes('msn')) return 'bing'
    if (src === 'organic') return 'organic'
  }
  if (data.source_type === 'seo') return 'organic'
  if (data.source_type === 'referral') return 'referral'
  if (data.source_type === 'partner') return 'partner'
  if (data.source_type === 'contractor_shared') return 'solarpro'
  return 'direct'
}

/**
 * Infer source_campaign_id from UTM params or click IDs
 */
function inferCampaignId(data: AttributionData): string | null {
  if (data.utm_campaign) return data.utm_campaign
  return null
}

/**
 * Parse device type from user agent string
 */
function parseDeviceType(userAgent?: string | null): string {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) return 'tablet'
  if (/mobile|iphone|android.*mobile|windows phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * createAttribution
 * Called at intake: creates an opportunity_sources record for a new opportunity.
 */
export async function createAttribution(
  opportunityId: string,
  data: AttributionData
): Promise<string> {
  const platform = data.platform ?? inferPlatform(data)
  const campaign_id = inferCampaignId(data)
  const device_type = data.device_type ?? parseDeviceType(data.user_agent)

  const [record] = await sql`
    INSERT INTO opportunity_sources (
      opportunity_id,
      source_type,
      source_channel,
      source_campaign_id,
      source_campaign_name,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      platform,
      gclid,
      fbclid,
      ttclid,
      cost_per_lead,
      attributed_spend,
      referring_contractor_id,
      referral_code,
      partner_id,
      partner_name,
      partner_lead_id,
      landing_page_url,
      landing_page_path,
      landing_page_variant,
      session_id,
      ip_address,
      user_agent,
      device_type,
      first_touch_at,
      form_submit_at,
      funnel_stage,
      raw_payload,
      processed_at
    ) VALUES (
      ${opportunityId},
      ${data.source_type},
      ${platform},
      ${campaign_id},
      ${data.utm_campaign ?? null},
      ${data.utm_source ?? null},
      ${data.utm_medium ?? null},
      ${data.utm_campaign ?? null},
      ${data.utm_content ?? null},
      ${data.utm_term ?? null},
      ${platform},
      ${data.gclid ?? null},
      ${data.fbclid ?? null},
      ${data.ttclid ?? null},
      ${data.cost_per_lead ?? null},
      ${data.attributed_spend ?? null},
      ${data.referring_contractor_id ?? null},
      ${data.referral_code ?? null},
      ${data.partner_id ?? null},
      ${data.partner_name ?? null},
      ${data.partner_lead_id ?? null},
      ${data.landing_page_url ?? null},
      ${data.landing_page_path ?? null},
      ${data.landing_page_variant ?? null},
      ${data.session_id ?? null},
      ${data.ip_address ?? null},
      ${data.user_agent ?? null},
      ${device_type},
      NOW(),
      NOW(),
      'lead',
      ${JSON.stringify(data.raw_payload ?? {})},
      NOW()
    )
    RETURNING id
  `

  return record.id
}

/**
 * advanceFunnelStage
 * Updates the funnel stage timestamp when an opportunity progresses.
 */
export async function advanceFunnelStage(event: FunnelEvent): Promise<void> {
  const ts = event.occurred_at ?? new Date()

  const stageToColumn: Record<FunnelEvent['stage'], string> = {
    lead:        'first_touch_at',
    qualified:   'qualified_at',
    claimed:     'claimed_at',
    appointment: 'appointment_at',
    proposal:    'appointment_at',    // re-use until we add proposal_at
    closed_won:  'closed_at',
    closed_lost: 'closed_at',
  }

  const column = stageToColumn[event.stage]
  if (!column) return

  // Use dynamic SQL for the column update
  await sql`
    UPDATE opportunity_sources
    SET funnel_stage = ${event.stage}, updated_at = NOW()
    WHERE opportunity_id = ${event.opportunity_id}
  `

  // Update the specific timestamp
  if (event.stage === 'qualified') {
    await sql`UPDATE opportunity_sources SET qualified_at = ${ts.toISOString()} WHERE opportunity_id = ${event.opportunity_id}`
  } else if (event.stage === 'claimed') {
    await sql`UPDATE opportunity_sources SET claimed_at = ${ts.toISOString()} WHERE opportunity_id = ${event.opportunity_id}`
  } else if (event.stage === 'appointment') {
    await sql`UPDATE opportunity_sources SET appointment_at = ${ts.toISOString()} WHERE opportunity_id = ${event.opportunity_id}`
  } else if (event.stage === 'closed_won' || event.stage === 'closed_lost') {
    await sql`UPDATE opportunity_sources SET closed_at = ${ts.toISOString()} WHERE opportunity_id = ${event.opportunity_id}`
  }

  // Log to network_events
  await logNetworkEvent({
    event_type: `funnel.${event.stage}`,
    event_category: 'opportunity',
    opportunity_id: event.opportunity_id,
    data: { stage: event.stage, ...(event.metadata ?? {}) },
    triggered_by: 'system',
  })
}

/**
 * logNetworkEvent
 * Appends an immutable event to the network_events log.
 */
export async function logNetworkEvent(event: {
  event_type: string
  event_category: string
  opportunity_id?: string
  assignment_id?: string
  contractor_id?: string
  admin_user_id?: string
  data?: Record<string, unknown>
  from_status?: string
  to_status?: string
  score_at_event?: number
  grade_at_event?: string
  triggered_by?: string
  ip_address?: string
  is_error?: boolean
  error_code?: string
  error_message?: string
}): Promise<void> {
  try {
    await sql`
      INSERT INTO network_events (
        event_type,
        event_category,
        opportunity_id,
        assignment_id,
        contractor_id,
        admin_user_id,
        data,
        from_status,
        to_status,
        score_at_event,
        grade_at_event,
        triggered_by,
        ip_address,
        is_error,
        error_code,
        error_message,
        occurred_at
      ) VALUES (
        ${event.event_type},
        ${event.event_category},
        ${event.opportunity_id ?? null},
        ${event.assignment_id ?? null},
        ${event.contractor_id ?? null},
        ${event.admin_user_id ?? null},
        ${JSON.stringify(event.data ?? {})},
        ${event.from_status ?? null},
        ${event.to_status ?? null},
        ${event.score_at_event ?? null},
        ${event.grade_at_event ?? null},
        ${event.triggered_by ?? 'system'},
        ${event.ip_address ?? null},
        ${event.is_error ?? false},
        ${event.error_code ?? null},
        ${event.error_message ?? null},
        NOW()
      )
    `
  } catch (err) {
    // Never throw from logging — events must not break the main flow
    console.error('[attributionTracker] logNetworkEvent failed:', err)
  }
}

/**
 * getAttributionSummary
 * Returns attribution data for a specific opportunity.
 */
export async function getAttributionSummary(opportunityId: string) {
  const [source] = await sql`
    SELECT * FROM opportunity_sources WHERE opportunity_id = ${opportunityId} LIMIT 1
  `
  return source ?? null
}

/**
 * getCampaignPerformance
 * Returns aggregated CPL and conversion metrics for a campaign/source.
 */
export async function getCampaignPerformance(
  filters: {
    source_type?: string
    platform?: string
    campaign_id?: string
    days?: number
  } = {}
) {
  const { source_type, platform, campaign_id, days = 30 } = filters

  const rows = await sql`
    SELECT
      os.source_type,
      os.platform,
      os.source_campaign_id,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE no.status NOT IN ('rejected', 'intake')) as qualified_leads,
      COUNT(*) FILTER (WHERE os.claimed_at IS NOT NULL) as claimed_leads,
      COUNT(*) FILTER (WHERE os.closed_at IS NOT NULL AND os.funnel_stage = 'closed_won') as won_leads,
      AVG(os.cost_per_lead) as avg_cpl,
      SUM(os.attributed_spend) as total_spend,
      AVG(
        CASE WHEN os.claimed_at IS NOT NULL AND os.first_touch_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (os.claimed_at - os.first_touch_at)) / 3600
        END
      ) as avg_hours_to_claim
    FROM opportunity_sources os
    JOIN network_opportunities no ON no.id = os.opportunity_id
    WHERE os.created_at > NOW() - (${days} || ' days')::INTERVAL
      AND (${source_type ?? null} IS NULL OR os.source_type = ${source_type ?? ''})
      AND (${platform ?? null} IS NULL OR os.platform = ${platform ?? ''})
      AND (${campaign_id ?? null} IS NULL OR os.source_campaign_id = ${campaign_id ?? ''})
    GROUP BY os.source_type, os.platform, os.source_campaign_id
    ORDER BY total_leads DESC
  `

  return rows
}

/**
 * markDuplicate
 * Flags an opportunity_source as a duplicate.
 */
export async function markDuplicate(
  opportunityId: string,
  duplicateOfId: string,
  detectionData: Record<string, unknown>
): Promise<void> {
  await sql`
    UPDATE opportunity_sources SET
      is_duplicate = true,
      duplicate_of = ${duplicateOfId},
      duplicate_detected_at = NOW(),
      duplicate_detection = ${JSON.stringify(detectionData)},
      updated_at = NOW()
    WHERE opportunity_id = ${opportunityId}
  `

  await logNetworkEvent({
    event_type: 'opportunity.duplicate_detected',
    event_category: 'opportunity',
    opportunity_id: opportunityId,
    data: { duplicate_of: duplicateOfId, ...detectionData },
    triggered_by: 'system',
  })
}
