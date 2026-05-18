/**
 * /api/admin/network/enrichment/route.ts
 *
 * Admin API — Enrichment Queue Dashboard + Trigger + Control
 *
 * GET   — Queue stats: counts by status, recent jobs, per-provider breakdown,
 *         avg duration, failure rate
 * POST  — Trigger enrichment: { opportunity_id?, ids[]?, all_pending?,
 *         force_refresh?, providers[] }
 * PATCH — Cancel / retry / reset: { opportunity_id, action: 'cancel'|'retry'|'reset' }
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';
import {
  getEnrichmentQueueStats,
  cancelEnrichmentJob,
  scheduleRetry,
  resetEnrichmentJob,
} from '@/lib/intake/enrichmentQueue';
import {
  runEnrichmentOrchestrator,
  runBatchEnrichment,
  getPendingEnrichmentOpportunities,
} from '@/lib/enrichment/enrichmentOrchestrator';
import type { EnrichmentProvider } from '@/lib/intake/enrichmentQueue';

// ── GET: Dashboard
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = await getDbReady();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  try {
    // Queue stats
    const stats = await getEnrichmentQueueStats();

    // Recent jobs with per-provider detail
    const recentJobs = await sql`
      SELECT
        eq.id,
        eq.opportunity_id,
        eq.status,
        eq.priority,
        eq.attempt_count,
        eq.providers_requested,
        eq.providers_completed,
        eq.providers_failed,
        eq.providers_skipped,
        eq.property_status,
        eq.property_provider_used,
        eq.solar_status,
        eq.solar_provider_used,
        eq.utility_status,
        eq.utility_provider_used,
        eq.started_at,
        eq.completed_at,
        eq.failed_at,
        eq.duration_ms,
        eq.last_error,
        eq.force_refresh,
        eq.triggered_by,
        eq.created_at,
        -- Join opportunity display info
        no.first_name,
        no.last_name,
        no.city,
        no.state,
        no.zip
      FROM enrichment_queue eq
      LEFT JOIN network_opportunities no ON no.id = eq.opportunity_id
      ORDER BY eq.created_at DESC
      LIMIT ${limit}
    `;

    // Provider breakdown
    const providerStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE property_status = 'completed') AS property_completed,
        COUNT(*) FILTER (WHERE property_status = 'failed')    AS property_failed,
        COUNT(*) FILTER (WHERE solar_status    = 'completed') AS solar_completed,
        COUNT(*) FILTER (WHERE solar_status    = 'failed')    AS solar_failed,
        COUNT(*) FILTER (WHERE utility_status  = 'completed') AS utility_completed,
        COUNT(*) FILTER (WHERE utility_status  = 'failed')    AS utility_failed,
        -- Most common providers used
        MODE() WITHIN GROUP (ORDER BY property_provider_used) AS most_common_property_provider,
        MODE() WITHIN GROUP (ORDER BY solar_provider_used)    AS most_common_solar_provider,
        MODE() WITHIN GROUP (ORDER BY utility_provider_used)  AS most_common_utility_provider
      FROM enrichment_queue
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `;

    // Hourly throughput (last 24h)
    const hourlyThroughput = await sql`
      SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')    AS failed
      FROM enrichment_queue
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY 1 DESC
    `;

    return NextResponse.json({
      stats,
      provider_stats: providerStats[0] || {},
      recent_jobs: recentJobs,
      hourly_throughput: hourlyThroughput,
    });
  } catch (err) {
    console.error('[GET /api/admin/network/enrichment] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── POST: Trigger enrichment
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    opportunity_id,
    ids,
    all_pending,
    force_refresh = false,
    providers,
  } = body as {
    opportunity_id?: string;
    ids?: string[];
    all_pending?: boolean;
    force_refresh?: boolean;
    providers?: EnrichmentProvider[];
  };

  const options = { force_refresh, providers };

  try {
    // Single opportunity
    if (opportunity_id) {
      const result = await runEnrichmentOrchestrator(opportunity_id, options);
      return NextResponse.json({ triggered_by: admin.email, result });
    }

    // Specific IDs
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const result = await runBatchEnrichment(ids, options);
      return NextResponse.json({
        triggered_by: admin.email,
        batch_result: result,
      });
    }

    // All pending
    if (all_pending) {
      const pending = await getPendingEnrichmentOpportunities(100);
      if (pending.length === 0) {
        return NextResponse.json({ message: 'No pending enrichment jobs found', triggered: 0 });
      }
      const pendingIds = pending.map(p => p.opportunity_id);
      const result = await runBatchEnrichment(pendingIds, options);
      return NextResponse.json({
        triggered_by: admin.email,
        batch_result: result,
      });
    }

    return NextResponse.json(
      { error: 'Provide opportunity_id, ids[], or all_pending=true' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[POST /api/admin/network/enrichment] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── PATCH: Cancel / retry / reset
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { opportunity_id, action } = body as {
    opportunity_id?: string;
    action?: 'cancel' | 'retry' | 'reset';
  };

  if (!opportunity_id) {
    return NextResponse.json({ error: 'opportunity_id is required' }, { status: 400 });
  }

  if (!action || !['cancel', 'retry', 'reset'].includes(action)) {
    return NextResponse.json(
      { error: 'action must be cancel, retry, or reset' },
      { status: 400 }
    );
  }

  try {
    let success = false;
    let message = '';

    if (action === 'cancel') {
      success = await cancelEnrichmentJob(opportunity_id);
      message = success ? 'Job cancelled' : 'Job not found or not in cancellable state';
    } else if (action === 'retry') {
      await scheduleRetry(opportunity_id, 0); // immediate retry
      success = true;
      message = 'Job scheduled for immediate retry';
    } else if (action === 'reset') {
      success = await resetEnrichmentJob(opportunity_id);
      message = success ? 'Job reset to pending' : 'Job not found';
    }

    return NextResponse.json({
      opportunity_id,
      action,
      success,
      message,
      admin: admin.email,
    });
  } catch (err) {
    console.error('[PATCH /api/admin/network/enrichment] Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
