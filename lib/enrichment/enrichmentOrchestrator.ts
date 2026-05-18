/**
 * enrichmentOrchestrator.ts
 *
 * SolarPro Enrichment Engine — Orchestrator
 *
 * Runs property enrichment first (to get lat/lng), then solar + utility
 * in parallel. Provides batch processing with concurrency=3.
 *
 * Uses neon() directly.
 */

import { neon } from '@neondatabase/serverless'
import { enrichProperty, persistPropertyEnrichment, type PropertyEnrichmentInput } from './propertyEnricher'
import { enrichSolar, persistSolarEnrichment } from './solarEnricher'
import { enrichUtility, persistUtilityEnrichment } from './utilityEnricher'
import {
  markJobStarted,
  markProviderStarted,
  markProviderComplete,
  finalizeJob,
  type EnrichmentProvider,
} from '../intake/enrichmentQueue'

const sql = neon(process.env.DATABASE_URL!)

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  providers?: EnrichmentProvider[]
  force_refresh?: boolean
  dry_run?: boolean
}

export interface OrchestratorResult {
  opportunity_id: string
  completed: EnrichmentProvider[]
  failed: EnrichmentProvider[]
  skipped: EnrichmentProvider[]
  duration_ms: number
  errors: Record<string, string>
}

export interface BatchEnrichmentResult {
  total: number
  succeeded: number
  failed: number
  results: OrchestratorResult[]
  duration_ms: number
}

interface OpportunityRow {
  id: string
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  latitude: number | null
  longitude: number | null
  monthly_bill_amount: number | null
  current_electricity_rate: number | null
  square_feet_living: number | null
  roof_type: string | null
  roof_shade: string | null
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch opportunity data
// ────────────────────────────────────────────────────────────────────────────

async function fetchOpportunity(opportunityId: string): Promise<OpportunityRow | null> {
  try {
    const rows = await sql`
      SELECT
        id, address_line1, city, state, zip,
        latitude, longitude,
        monthly_bill_amount, current_electricity_rate,
        square_feet_living, roof_type, roof_shade
      FROM network_opportunities
      WHERE id = ${opportunityId}
      LIMIT 1
    `
    return (rows[0] as OpportunityRow) || null
  } catch (err) {
    console.error('[enrichmentOrchestrator.fetchOpportunity] Error:', err)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Single opportunity orchestrator
// ────────────────────────────────────────────────────────────────────────────

export async function runEnrichmentOrchestrator(
  opportunityId: string,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const startedAt = Date.now()
  const providers = options.providers || ['property', 'solar', 'utility']
  const completed: EnrichmentProvider[] = []
  const failed: EnrichmentProvider[] = []
  const skipped: EnrichmentProvider[] = []
  const errors: Record<string, string> = {}

  if (options.dry_run) {
    return {
      opportunity_id: opportunityId,
      completed: [],
      failed: [],
      skipped: providers,
      duration_ms: 0,
      errors: {},
    }
  }

  // Mark job as started
  await markJobStarted(opportunityId)

  // Fetch opportunity data
  const opp = await fetchOpportunity(opportunityId)
  if (!opp) {
    await finalizeJob(opportunityId, 'failed', 'Opportunity not found')
    return {
      opportunity_id: opportunityId,
      completed,
      failed: providers,
      skipped,
      duration_ms: Date.now() - startedAt,
      errors: { general: 'Opportunity not found' },
    }
  }

  // ── Step 1: Property enrichment (gets lat/lng for solar/utility)
  let lat = opp.latitude
  let lon = opp.longitude

  if (providers.includes('property')) {
    await markProviderStarted(opportunityId, 'property')
    try {
      const propInput: PropertyEnrichmentInput = {
        opportunity_id: opportunityId,
        address_line1: opp.address_line1,
        city: opp.city,
        state: opp.state,
        zip: opp.zip,
        latitude: opp.latitude,
        longitude: opp.longitude,
      }

      const propResult = await enrichProperty(propInput)

      if (propResult) {
        await persistPropertyEnrichment(opportunityId, propResult)
        // Use enriched lat/lng for downstream providers
        lat = propResult.latitude || lat
        lon = propResult.longitude || lon
        completed.push('property')
        await markProviderComplete(opportunityId, 'property', 'completed', propResult.provider_used)
      } else {
        failed.push('property')
        await markProviderComplete(opportunityId, 'property', 'failed', undefined, 'All providers failed')
        errors.property = 'All property providers returned no data'
      }
    } catch (err) {
      const msg = (err as Error).message
      failed.push('property')
      await markProviderComplete(opportunityId, 'property', 'failed', undefined, msg)
      errors.property = msg
    }
  } else {
    skipped.push('property')
  }

  // ── Step 2: Solar + Utility in parallel
  const parallelTasks: Promise<void>[] = []

  if (providers.includes('solar')) {
    parallelTasks.push(
      (async () => {
        await markProviderStarted(opportunityId, 'solar')
        try {
          const solarResult = await enrichSolar({
            opportunity_id: opportunityId,
            latitude: lat,
            longitude: lon,
            state: opp.state,
            zip: opp.zip,
            square_feet_living: opp.square_feet_living,
            monthly_bill_amount: opp.monthly_bill_amount,
            current_electricity_rate: opp.current_electricity_rate,
            roof_type: opp.roof_type,
            roof_shade: opp.roof_shade,
          })
          await persistSolarEnrichment(opportunityId, solarResult)
          completed.push('solar')
          await markProviderComplete(opportunityId, 'solar', 'completed', solarResult.provider_used)
        } catch (err) {
          const msg = (err as Error).message
          failed.push('solar')
          await markProviderComplete(opportunityId, 'solar', 'failed', undefined, msg)
          errors.solar = msg
        }
      })()
    )
  } else {
    skipped.push('solar')
  }

  if (providers.includes('utility')) {
    parallelTasks.push(
      (async () => {
        await markProviderStarted(opportunityId, 'utility')
        try {
          const utilResult = await enrichUtility({
            opportunity_id: opportunityId,
            zip: opp.zip,
            state: opp.state,
            city: opp.city,
            latitude: lat,
            longitude: lon,
            monthly_bill_amount: opp.monthly_bill_amount,
          })
          await persistUtilityEnrichment(opportunityId, utilResult)
          completed.push('utility')
          await markProviderComplete(opportunityId, 'utility', 'completed', utilResult.provider_used)
        } catch (err) {
          const msg = (err as Error).message
          failed.push('utility')
          await markProviderComplete(opportunityId, 'utility', 'failed', undefined, msg)
          errors.utility = msg
        }
      })()
    )
  } else {
    skipped.push('utility')
  }

  // Skip any other requested providers that aren't implemented yet
  for (const p of providers) {
    if (!['property', 'solar', 'utility'].includes(p)) {
      skipped.push(p)
    }
  }

  await Promise.all(parallelTasks)

  const overallStatus = failed.length === providers.length - skipped.length ? 'failed' : 'completed'
  await finalizeJob(opportunityId, overallStatus as 'completed' | 'failed', errors.general)

  return {
    opportunity_id: opportunityId,
    completed,
    failed,
    skipped,
    duration_ms: Date.now() - startedAt,
    errors,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Batch enrichment (concurrency = 3)
// ────────────────────────────────────────────────────────────────────────────

export async function runBatchEnrichment(
  opportunityIds: string[],
  options: OrchestratorOptions = {}
): Promise<BatchEnrichmentResult> {
  const startedAt = Date.now()
  const results: OrchestratorResult[] = []
  let succeeded = 0
  let failed = 0
  const CONCURRENCY = 3

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < opportunityIds.length; i += CONCURRENCY) {
    const chunk = opportunityIds.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(
      chunk.map(id => runEnrichmentOrchestrator(id, options))
    )
    for (const r of chunkResults) {
      results.push(r)
      if (r.failed.length === 0) succeeded++
      else failed++
    }
  }

  return {
    total: opportunityIds.length,
    succeeded,
    failed,
    results,
    duration_ms: Date.now() - startedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Get pending enrichment opportunities
// ────────────────────────────────────────────────────────────────────────────

export async function getPendingEnrichmentOpportunities(
  limit = 50,
  statusFilter: string[] = ['pending', 'retry']
): Promise<Array<{ opportunity_id: string; status: string; priority: number; attempt_count: number; created_at: string }>> {
  try {
    const rows = await sql`
      SELECT
        opportunity_id,
        status,
        priority,
        attempt_count,
        created_at
      FROM enrichment_queue
      WHERE status = ANY(${statusFilter}::text[])
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT ${limit}
    `
    return rows as Array<{ opportunity_id: string; status: string; priority: number; attempt_count: number; created_at: string }>
  } catch (err) {
    console.error('[enrichmentOrchestrator.getPendingEnrichmentOpportunities] Error:', err)
    return []
  }
}
