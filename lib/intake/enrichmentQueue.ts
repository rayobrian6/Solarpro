/**
 * enrichmentQueue.ts
 *
 * SolarPro Intake & Acquisition Infrastructure — Enrichment Job Queue
 *
 * Manages the enrichment_queue table: enqueue, start, update per-provider
 * status, finalize, cancel, retry, and stats.
 *
 * Uses neon() directly (not getDbReady()).
 */

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type EnrichmentProvider = 'property' | 'solar' | 'utility' | 'ahj' | 'demographics' | 'satellite'
export type EnrichmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'retry'

export interface EnqueueOptions {
  providers?: EnrichmentProvider[]
  priority?: number
  force_refresh?: boolean
  dry_run?: boolean
  triggered_by?: string
}

export interface EnrichmentQueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  retry: number
  total: number
  avg_duration_ms: number | null
  failure_rate: number
}

// ────────────────────────────────────────────────────────────────────────────
// Enqueue
// ────────────────────────────────────────────────────────────────────────────

export async function enqueueEnrichment(
  opportunityId: string,
  options: EnqueueOptions = {}
): Promise<{ queued: boolean; job_id: string | null; already_exists: boolean }> {
  const {
    providers = ['property', 'solar', 'utility'],
    priority = 5,
    force_refresh = false,
    dry_run = false,
    triggered_by = 'system',
  } = options

  try {
    const rows = await sql`
      INSERT INTO enrichment_queue (
        opportunity_id,
        providers_requested,
        priority,
        force_refresh,
        dry_run,
        triggered_by
      )
      VALUES (
        ${opportunityId},
        ${providers},
        ${priority},
        ${force_refresh},
        ${dry_run},
        ${triggered_by}
      )
      ON CONFLICT (opportunity_id) DO UPDATE
        SET
          status            = CASE WHEN enrichment_queue.status IN ('completed','failed','cancelled') OR ${force_refresh}
                                   THEN 'pending' ELSE enrichment_queue.status END,
          providers_requested = EXCLUDED.providers_requested,
          priority          = GREATEST(enrichment_queue.priority, EXCLUDED.priority),
          force_refresh     = EXCLUDED.force_refresh,
          attempt_count     = CASE WHEN ${force_refresh} THEN 0 ELSE enrichment_queue.attempt_count END,
          updated_at        = NOW()
      RETURNING id, (xmax = 0) AS inserted
    `

    const row = rows[0]
    if (!row) return { queued: false, job_id: null, already_exists: false }

    return {
      queued: true,
      job_id: row.id as string,
      already_exists: !(row.inserted as boolean),
    }
  } catch (err) {
    console.error('[enrichmentQueue.enqueueEnrichment] Error:', err)
    return { queued: false, job_id: null, already_exists: false }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Job lifecycle
// ────────────────────────────────────────────────────────────────────────────

export async function markJobStarted(opportunityId: string): Promise<void> {
  try {
    await sql`
      UPDATE enrichment_queue
      SET
        status       = 'processing',
        started_at   = NOW(),
        updated_at   = NOW(),
        attempt_count = attempt_count + 1
      WHERE opportunity_id = ${opportunityId}
        AND status IN ('pending', 'retry')
    `
  } catch (err) {
    console.error('[enrichmentQueue.markJobStarted] Error:', err)
  }
}

export async function markProviderStarted(
  opportunityId: string,
  provider: EnrichmentProvider
): Promise<void> {
  try {
    if (provider === 'property') {
      await sql`UPDATE enrichment_queue SET property_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    } else if (provider === 'solar') {
      await sql`UPDATE enrichment_queue SET solar_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    } else if (provider === 'utility') {
      await sql`UPDATE enrichment_queue SET utility_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    } else if (provider === 'ahj') {
      await sql`UPDATE enrichment_queue SET ahj_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    } else if (provider === 'demographics') {
      await sql`UPDATE enrichment_queue SET demographics_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    } else if (provider === 'satellite') {
      await sql`UPDATE enrichment_queue SET satellite_status = 'processing', updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
    }
  } catch (err) {
    console.error(`[enrichmentQueue.markProviderStarted] ${provider}:`, err)
  }
}

export async function markProviderComplete(
  opportunityId: string,
  provider: EnrichmentProvider,
  result: 'completed' | 'failed' | 'skipped',
  providerUsed?: string,
  error?: string
): Promise<void> {
  try {
    if (provider === 'property') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET property_status = 'completed', property_provider_used = ${providerUsed || null}, property_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'property'), 'property'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET property_status = 'failed', property_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'property'), 'property'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET property_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'property'), 'property'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    } else if (provider === 'solar') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET solar_status = 'completed', solar_provider_used = ${providerUsed || null}, solar_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'solar'), 'solar'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET solar_status = 'failed', solar_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'solar'), 'solar'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET solar_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'solar'), 'solar'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    } else if (provider === 'utility') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET utility_status = 'completed', utility_provider_used = ${providerUsed || null}, utility_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'utility'), 'utility'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET utility_status = 'failed', utility_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'utility'), 'utility'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET utility_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'utility'), 'utility'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    } else if (provider === 'ahj') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET ahj_status = 'completed', ahj_provider_used = ${providerUsed || null}, ahj_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'ahj'), 'ahj'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET ahj_status = 'failed', ahj_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'ahj'), 'ahj'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET ahj_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'ahj'), 'ahj'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    } else if (provider === 'demographics') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET demographics_status = 'completed', demographics_provider_used = ${providerUsed || null}, demographics_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'demographics'), 'demographics'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET demographics_status = 'failed', demographics_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'demographics'), 'demographics'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET demographics_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'demographics'), 'demographics'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    } else if (provider === 'satellite') {
      if (result === 'completed') {
        await sql`UPDATE enrichment_queue SET satellite_status = 'completed', satellite_provider_used = ${providerUsed || null}, satellite_enriched_at = NOW(), providers_completed = array_append(array_remove(providers_completed, 'satellite'), 'satellite'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else if (result === 'failed') {
        await sql`UPDATE enrichment_queue SET satellite_status = 'failed', satellite_error = ${error || null}, providers_failed = array_append(array_remove(providers_failed, 'satellite'), 'satellite'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      } else {
        await sql`UPDATE enrichment_queue SET satellite_status = 'skipped', providers_skipped = array_append(array_remove(providers_skipped, 'satellite'), 'satellite'), updated_at = NOW() WHERE opportunity_id = ${opportunityId}`
      }
    }
  } catch (err) {
    console.error(`[enrichmentQueue.markProviderComplete] ${provider}:`, err)
  }
}

export async function finalizeJob(
  opportunityId: string,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  try {
    if (status === 'completed') {
      await sql`
        UPDATE enrichment_queue
        SET
          status        = 'completed',
          completed_at  = NOW(),
          failed_at     = NULL,
          last_error    = NULL,
          duration_ms   = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
          updated_at    = NOW()
        WHERE opportunity_id = ${opportunityId}
      `
    } else {
      await sql`
        UPDATE enrichment_queue
        SET
          status        = 'failed',
          failed_at     = NOW(),
          last_error    = ${error || null},
          duration_ms   = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
          updated_at    = NOW()
        WHERE opportunity_id = ${opportunityId}
      `
    }
  } catch (err) {
    console.error('[enrichmentQueue.finalizeJob] Error:', err)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Cancel / Retry / Reset
// ────────────────────────────────────────────────────────────────────────────

export async function cancelEnrichmentJob(opportunityId: string): Promise<boolean> {
  try {
    const rows = await sql`
      UPDATE enrichment_queue
      SET status = 'cancelled', updated_at = NOW()
      WHERE opportunity_id = ${opportunityId}
        AND status IN ('pending', 'retry')
      RETURNING id
    `
    return rows.length > 0
  } catch (err) {
    console.error('[enrichmentQueue.cancelEnrichmentJob] Error:', err)
    return false
  }
}

export async function scheduleRetry(
  opportunityId: string,
  delaySeconds = 300
): Promise<void> {
  try {
    await sql`
      UPDATE enrichment_queue
      SET
        status        = 'retry',
        next_retry_at = NOW() + (${delaySeconds} * INTERVAL '1 second'),
        updated_at    = NOW()
      WHERE opportunity_id = ${opportunityId}
        AND attempt_count < max_attempts
    `
  } catch (err) {
    console.error('[enrichmentQueue.scheduleRetry] Error:', err)
  }
}

export async function resetEnrichmentJob(opportunityId: string): Promise<boolean> {
  try {
    const rows = await sql`
      UPDATE enrichment_queue
      SET
        status                = 'pending',
        attempt_count         = 0,
        started_at            = NULL,
        completed_at          = NULL,
        failed_at             = NULL,
        next_retry_at         = NULL,
        last_error            = NULL,
        error_details         = '{}',
        providers_completed   = ARRAY[]::TEXT[],
        providers_failed      = ARRAY[]::TEXT[],
        providers_skipped     = ARRAY[]::TEXT[],
        property_status       = 'pending',
        property_enriched_at  = NULL,
        property_error        = NULL,
        solar_status          = 'pending',
        solar_enriched_at     = NULL,
        solar_error           = NULL,
        utility_status        = 'pending',
        utility_enriched_at   = NULL,
        utility_error         = NULL,
        updated_at            = NOW()
      WHERE opportunity_id = ${opportunityId}
      RETURNING id
    `
    return rows.length > 0
  } catch (err) {
    console.error('[enrichmentQueue.resetEnrichmentJob] Error:', err)
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

export async function getEnrichmentQueueStats(): Promise<EnrichmentQueueStats> {
  try {
    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')     AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled,
        COUNT(*) FILTER (WHERE status = 'retry')      AS retry,
        COUNT(*)                                       AS total,
        AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL AND status = 'completed') AS avg_duration_ms
      FROM enrichment_queue
    `
    const r = rows[0] || {}
    const total = Number(r.total) || 0
    const failed = Number(r.failed) || 0
    const completed = Number(r.completed) || 0
    const denominator = failed + completed
    return {
      pending:      Number(r.pending)    || 0,
      processing:   Number(r.processing) || 0,
      completed,
      failed,
      cancelled:    Number(r.cancelled)  || 0,
      retry:        Number(r.retry)      || 0,
      total,
      avg_duration_ms: r.avg_duration_ms ? Math.round(Number(r.avg_duration_ms)) : null,
      failure_rate: denominator > 0 ? Math.round((failed / denominator) * 100) / 100 : 0,
    }
  } catch (err) {
    console.error('[enrichmentQueue.getEnrichmentQueueStats] Error:', err)
    return { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, retry: 0, total: 0, avg_duration_ms: null, failure_rate: 0 }
  }
}
