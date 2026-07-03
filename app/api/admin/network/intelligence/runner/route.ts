/**
 * POST /api/admin/network/intelligence/runner
 *
 * Manual admin-safe intelligence runner trigger.
 * - Admin authenticated via requireAdminApi
 * - Dry-run defaults true
 * - Non-dry-run restricted to super_admin
 * - Bounded scope required
 * - No projections, no lifecycle mutation, no dashboards, no scheduled execution
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { NeonObservationWriter } from '@/lib/intelligence/observations';
import { PRODUCER_REGISTRY, type ProducerInput, type ProducerName } from '@/lib/intelligence/registry';
import { runIntelligenceProducers, type ProducerRunJob } from '@/lib/intelligence/runner';
import type { ObservationEntityType } from '@/lib/intelligence/observations';
import type { ProducerWindow } from '@/lib/intelligence/producers';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

const MAX_WINDOW_DAYS = 31;
const MAX_PREVIEW_LIMIT = 50;
const DEFAULT_PREVIEW_LIMIT = 10;

interface RunnerRequestBody {
  producer_names?: string[];
  dry_run?: boolean;
  entity_type?: string;
  entity_id?: string;
  project_id?: string;
  opportunity_id?: string;
  source_event_id?: string;
  window?: { start?: string; end?: string };
  preview_limit?: number;
}

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: message, details }, { status });
}

function parseWindow(window?: RunnerRequestBody['window']): { ok: true; window?: ProducerWindow } | { ok: false; error: string } {
  if (!window) return { ok: true };
  if (!window.start || !window.end) return { ok: false, error: 'window.start and window.end are required when window is provided' };
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { ok: false, error: 'window.start and window.end must be valid timestamps' };
  if (endMs < startMs) return { ok: false, error: 'window.end must be greater than or equal to window.start' };
  const days = (endMs - startMs) / 86_400_000;
  if (days > MAX_WINDOW_DAYS) return { ok: false, error: `Replay window cannot exceed ${MAX_WINDOW_DAYS} days` };
  return { ok: true, window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() } };
}

function hasBoundedScope(body: RunnerRequestBody): boolean {
  return Boolean(
    (body.entity_type && body.entity_id) ||
    body.project_id ||
    body.opportunity_id ||
    body.source_event_id ||
    body.window
  );
}

function previewLimit(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_PREVIEW_LIMIT;
  return Math.max(0, Math.min(MAX_PREVIEW_LIMIT, n));
}

function validateProducerNames(names: unknown): { ok: true; names: ProducerName[] } | { ok: false; error: string; details?: unknown } {
  if (!Array.isArray(names) || names.length === 0) return { ok: false, error: 'producer_names is required and must be a non-empty array' };
  const allowed = new Set(Object.keys(PRODUCER_REGISTRY));
  const unknown = names.filter(n => typeof n !== 'string' || !allowed.has(n));
  if (unknown.length) return { ok: false, error: 'Unknown producer_names supplied', details: { unknown, allowed: [...allowed] } };
  return { ok: true, names: [...new Set(names)] as ProducerName[] };
}

async function loadOpportunityLifecycleJob(sql: Awaited<ReturnType<typeof getDbReady>>, opportunityId: string): Promise<ProducerRunJob> {
  const oppRows = await sql`
    SELECT id, status, intake_at, live_at, claimed_at, closed_at, expires_at, updated_at,
           opportunity_score, source_type, enrichment_status, duplicate_flag, spam_flag, validation_errors
    FROM network_opportunities
    WHERE id = ${opportunityId}
    LIMIT 1
  `;
  if (!oppRows.length) throw new Error(`Opportunity not found: ${opportunityId}`);
  const assignmentRows = await sql`
    SELECT id, opportunity_id, contractor_id, status, offered_at, claimed_at, first_contact_at,
           proposal_at, closed_at, close_status, lost_reason, dispute_filed_at, refund_at,
           quality_score, system_size_kw, financing_offered
    FROM opportunity_assignments
    WHERE opportunity_id = ${opportunityId}
    ORDER BY offered_at ASC NULLS LAST, created_at ASC
  `;
  return { producer_name: 'opportunity_lifecycle', input: { producer: 'opportunity_lifecycle', opportunity: oppRows[0] as any, assignments: assignmentRows as any[] } };
}

async function loadContractorPerformanceJob(sql: Awaited<ReturnType<typeof getDbReady>>, contractorId: string): Promise<ProducerRunJob> {
  const rows = await sql`
    SELECT id, opportunity_id, contractor_id, status, offered_at, claimed_at, first_contact_at,
           proposal_at, closed_at, close_status, lost_reason, dispute_filed_at, refund_at,
           quality_score, system_size_kw, financing_offered
    FROM opportunity_assignments
    WHERE contractor_id = ${contractorId}
    ORDER BY offered_at ASC NULLS LAST, created_at ASC
    LIMIT 500
  `;
  return { producer_name: 'contractor_performance', input: { producer: 'contractor_performance', contractor_id: contractorId, assignments: rows as any[] } };
}

async function loadProjectActivityRows(sql: Awaited<ReturnType<typeof getDbReady>>, projectId: string, window?: ProducerWindow) {
  if (window) {
    return sql`
      SELECT id, project_id, user_id, type, title, details, metadata, created_at
      FROM project_activity
      WHERE project_id = ${projectId}
        AND created_at >= ${window.start}
        AND created_at <= ${window.end}
      ORDER BY created_at ASC
      LIMIT 500
    `;
  }
  return sql`
    SELECT id, project_id, user_id, type, title, details, metadata, created_at
    FROM project_activity
    WHERE project_id = ${projectId}
    ORDER BY created_at ASC
    LIMIT 500
  `;
}

function activityToEngagement(rows: any[], fallback: RunnerRequestBody) {
  return rows.map(r => ({
    project_id: r.project_id,
    client_id: fallback.entity_type === 'client' ? fallback.entity_id : null,
    opportunity_id: fallback.opportunity_id ?? (fallback.entity_type === 'opportunity' ? fallback.entity_id : null),
    event_id: r.id,
    event_type: String(r.type || r.title || 'project_activity'),
    occurred_at: new Date(r.created_at).toISOString(),
    metadata: r.metadata ?? {},
  }));
}

function activityToAhj(rows: any[], fallback: RunnerRequestBody) {
  return rows.map(r => ({
    id: r.id,
    project_id: r.project_id,
    ahj_id: fallback.entity_type === 'ahj' ? fallback.entity_id : (r.metadata?.ahj_id ?? null),
    ahj_name: fallback.entity_type === 'ahj' ? fallback.entity_id : (r.metadata?.ahj_name ?? r.metadata?.jurisdiction ?? null),
    event_type: String(r.type || r.title || 'project_activity'),
    occurred_at: new Date(r.created_at).toISOString(),
    details: r.details ?? r.title ?? null,
    metadata: r.metadata ?? {},
  }));
}

function activityToUtility(rows: any[], fallback: RunnerRequestBody) {
  return rows.map(r => ({
    id: r.id,
    project_id: r.project_id,
    opportunity_id: fallback.opportunity_id ?? null,
    utility_id: fallback.entity_type === 'utility' ? fallback.entity_id : (r.metadata?.utility_id ?? r.metadata?.canonical_utility_id ?? null),
    utility_name: fallback.entity_type === 'utility' ? fallback.entity_id : (r.metadata?.utility_name ?? null),
    event_type: String(r.type || r.title || 'project_activity'),
    occurred_at: new Date(r.created_at).toISOString(),
    details: r.details ?? r.title ?? null,
    metadata: r.metadata ?? {},
  }));
}

function activityToFailures(rows: any[], fallback: RunnerRequestBody) {
  const entity_type = (fallback.entity_type as any) || (fallback.project_id ? 'project' : fallback.opportunity_id ? 'opportunity' : 'project');
  const entity_id = fallback.entity_id || fallback.project_id || fallback.opportunity_id;
  if (!entity_id) return [];
  return rows.map(r => ({
    id: r.id,
    entity_type,
    entity_id,
    failure_type: String(r.type || r.title || 'project_activity'),
    occurred_at: new Date(r.created_at).toISOString(),
    details: r.details ?? r.title ?? null,
    metadata: r.metadata ?? {},
  }));
}

async function buildJobs(body: RunnerRequestBody, producerNames: ProducerName[], window?: ProducerWindow): Promise<ProducerRunJob[]> {
  const sql = await getDbReady();
  const jobs: ProducerRunJob[] = [];
  const opportunityId = body.opportunity_id || (body.entity_type === 'opportunity' ? body.entity_id : undefined);
  const projectId = body.project_id || (body.entity_type === 'project' ? body.entity_id : undefined);
  const contractorId = body.entity_type === 'contractor' ? body.entity_id : undefined;

  let projectActivityRows: any[] | null = null;
  if (projectId && producerNames.some(p => ['homeowner_engagement', 'ahj_corrections', 'utility_behavior', 'inspection_failures'].includes(p))) {
    projectActivityRows = await loadProjectActivityRows(sql, projectId, window) as any[];
  }

  for (const name of producerNames) {
    if (name === 'opportunity_lifecycle') {
      if (!opportunityId) throw new Error('opportunity_lifecycle requires opportunity_id or entity_type=opportunity with entity_id');
      jobs.push(await loadOpportunityLifecycleJob(sql, opportunityId));
    } else if (name === 'contractor_performance') {
      if (!contractorId) throw new Error('contractor_performance requires entity_type=contractor with entity_id');
      jobs.push(await loadContractorPerformanceJob(sql, contractorId));
    } else if (name === 'homeowner_engagement') {
      jobs.push({ producer_name: name, input: { producer: 'homeowner_engagement', entity: { client_id: body.entity_type === 'client' ? body.entity_id : null, project_id: projectId ?? null, opportunity_id: opportunityId ?? null }, events: activityToEngagement(projectActivityRows ?? [], body) } });
    } else if (name === 'ahj_corrections') {
      jobs.push({ producer_name: name, input: { producer: 'ahj_corrections', events: activityToAhj(projectActivityRows ?? [], body) } });
    } else if (name === 'utility_behavior') {
      jobs.push({ producer_name: name, input: { producer: 'utility_behavior', events: activityToUtility(projectActivityRows ?? [], body) } });
    } else if (name === 'inspection_failures') {
      jobs.push({ producer_name: name, input: { producer: 'inspection_failures', events: activityToFailures(projectActivityRows ?? [], body) } });
    }
  }

  return jobs;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) return jsonError('Unauthorized', 401);

  let body: RunnerRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const producerValidation = validateProducerNames(body.producer_names);
  if (producerValidation.ok === false) return jsonError(producerValidation.error, 400, producerValidation.details);

  if (!hasBoundedScope(body)) return jsonError('Bounded scope is required: provide entity_type+entity_id, project_id, opportunity_id, source_event_id, or window', 400);

  const parsedWindow = parseWindow(body.window);
  if (parsedWindow.ok === false) return jsonError(parsedWindow.error, 400);

  const dryRun = body.dry_run !== false;
  if (!dryRun && admin.role !== 'super_admin') return jsonError('Only super_admin can run non-dry-run intelligence execution', 403);

  const limit = previewLimit(body.preview_limit);

  try {
    const jobs = await buildJobs(body, producerValidation.names, parsedWindow.window);
    const result = await runIntelligenceProducers({
      dry_run: dryRun,
      jobs,
      writer: dryRun ? undefined : new NeonObservationWriter(),
      observed_at: parsedWindow.window?.end,
      window: parsedWindow.window,
      source_event_id: body.source_event_id ?? null,
      correlation_id: body.source_event_id ?? null,
      scope: {
        entity_type: body.entity_type as ObservationEntityType | undefined,
        entity_id: body.entity_id,
        producer_name: producerValidation.names.join(','),
        source_event_id: body.source_event_id,
        opportunity_id: body.opportunity_id,
        project_id: body.project_id,
      },
      replay_scope: {
        entity_type: body.entity_type as ObservationEntityType | undefined,
        entity_id: body.entity_id,
        producer_name: producerValidation.names.join(','),
        source_event_id: body.source_event_id,
        opportunity_id: body.opportunity_id,
        project_id: body.project_id,
        window: parsedWindow.window,
      },
      execution_metadata: { triggered_by_admin_id: admin.id, endpoint: '/api/admin/network/intelligence/runner' },
    });

    if (!dryRun) {
      await logAdminAction({
        adminId: admin.id,
        action: 'run_intelligence_producers',
        metadata: {
          producer_names: producerValidation.names,
          dry_run: dryRun,
          scope: { entity_type: body.entity_type, entity_id: body.entity_id, project_id: body.project_id, opportunity_id: body.opportunity_id, source_event_id: body.source_event_id, window: parsedWindow.window },
          summary: result.summary,
        },
      });
    }

    return NextResponse.json({
      success: result.summary.producer_failures.length === 0 && result.summary.validation_failures.length === 0 && result.summary.write_failures.length === 0,
      dry_run: dryRun,
      summary: result.summary,
      observations_preview: result.observations.slice(0, limit).map(o => ({
        entity_type: o.entity_type,
        entity_id: o.entity_id,
        observation_type: o.observation_type,
        confidence: o.confidence,
        observed_at: o.observed_at,
        idempotency_key: o.idempotency_key,
      })),
    });
  } catch (err: unknown) {
    return jsonError((err as Error).message || 'Intelligence runner execution failed', 400);
  }
}
