// ============================================================================
// app/api/site-survey/upload/route.ts — Site Survey Ingest Pipeline
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// ROUTE:   POST /api/site-survey/upload
// AUTH:    Session cookie (getUserFromRequest) OR Bearer token
//
// PIPELINE:
//   1. Parse + validate request body → RawSurveyPayload
//   2. normalizeSurvey()             → NormalizedSiteSurvey
//   3. enrichSurvey()                → EnrichedSiteSurvey
//   4. Upsert DB                     → project_site_surveys table
//   5. Return enriched survey + feasibility flags
//
// NON-NEGOTIABLE RULES:
//   - NEVER passes RawSurveyPayload to downstream modules
//   - NEVER skips normalization or enrichment layers
//   - NEVER mutates SystemDefinition directly from this route
//   - ALL errors are logged with survey ID + project ID for tracing
//   - DB failure is NON-FATAL — returns 200 with enriched data even if DB fails
//   - Enrichment failure is NON-FATAL — returns 200 with normalization data
//
// PATTERN: Mirrors bill-upload/route.ts structure exactly.
//   - POST handler is the only export
//   - Auth check before processing
//   - Validation before pipeline
//   - Background DB upsert (non-blocking to response)
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { logger } from '@/lib/logger';

import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type RawSurveyPayload,
  type NormalizedSiteSurvey,
  type EnrichedSiteSurvey,
  type SurveyValidationResult,
} from '@/lib/siteSurvey/types';

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * validateRawPayload — validates the minimum required fields in RawSurveyPayload.
 *
 * Only checks fields required for the pipeline to run.
 * Individual normalization warnings are handled by normalizeSurvey().
 */
function validateRawPayload(body: unknown): SurveyValidationResult {
  const errors: SurveyValidationResult['errors'] = [];
  const warnings: SurveyValidationResult['warnings'] = [];

  if (!body || typeof body !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'Request body must be a JSON object' }],
      warnings: [],
    };
  }

  const raw = body as Record<string, unknown>;

  // Required: id
  if (!raw.id || typeof raw.id !== 'string' || (raw.id as string).trim().length === 0) {
    errors.push({ field: 'id', message: 'survey id is required' });
  }

  // Required: projectId
  if (!raw.projectId || typeof raw.projectId !== 'string' || (raw.projectId as string).trim().length === 0) {
    errors.push({ field: 'projectId', message: 'projectId is required' });
  }

  // Warn if location is missing (pipeline can run without it but accuracy is reduced)
  if (!raw.location || typeof raw.location !== 'object') {
    warnings.push({ field: 'location', message: 'Location block missing — GPS-dependent features disabled' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── DB upsert ────────────────────────────────────────────────────────────────

/**
 * upsertSiteSurvey — stores the enriched survey in project_site_surveys.
 *
 * Non-throwing — all errors are caught and returned as dbAction status.
 * Uses INSERT ... ON CONFLICT (id) DO UPDATE to handle re-submissions.
 */
async function upsertSiteSurvey(
  raw: RawSurveyPayload,
  normalized: NormalizedSiteSurvey,
  enriched: EnrichedSiteSurvey,
  log: string[],
): Promise<'inserted' | 'updated' | 'failed'> {
  try {
    const sql = await getDbReady();
    const now = new Date().toISOString();

    // Serialize each stage to JSON for storage
    const rawJson = JSON.stringify(raw);
    const normalizedJson = JSON.stringify(normalized);
    const enrichedJson = JSON.stringify(enriched);
    const structuralJson = JSON.stringify(enriched.derived.structuralFeasibility);
    const electricalJson = JSON.stringify(enriched.derived.electricalFeasibility);

    // Upsert — handle re-submissions gracefully (field app may resend on retry)
    await sql`
      INSERT INTO project_site_surveys (
        id,
        project_id,
        pipeline_version,
        raw_payload,
        normalized,
        enriched,
        structural_feasibility,
        electrical_feasibility,
        created_at,
        updated_at
      ) VALUES (
        ${raw.id},
        ${raw.projectId},
        ${SITE_SURVEY_PIPELINE_VERSION},
        ${rawJson},
        ${normalizedJson},
        ${enrichedJson},
        ${structuralJson},
        ${electricalJson},
        ${now},
        ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        pipeline_version        = EXCLUDED.pipeline_version,
        raw_payload             = EXCLUDED.raw_payload,
        normalized              = EXCLUDED.normalized,
        enriched                = EXCLUDED.enriched,
        structural_feasibility  = EXCLUDED.structural_feasibility,
        electrical_feasibility  = EXCLUDED.electrical_feasibility,
        updated_at              = EXCLUDED.updated_at
    `;

    log.push(`[upload] DB upsert success: survey=${raw.id} project=${raw.projectId}`);
    return 'inserted';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Check if it was an update (conflict resolution)
    if (msg.includes('updated')) {
      log.push(`[upload] DB updated: survey=${raw.id}`);
      return 'updated';
    }
    log.push(`[upload] DB upsert failed: ${msg}`);
    logger.warn('SURVEY', `[SURVEY_DB_FAIL] survey=${raw.id} project=${raw.projectId} error=${msg}`);
    return 'failed';
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestStart = Date.now();
  const pipelineLog: string[] = [];

  pipelineLog.push(`[upload] POST /api/site-survey/upload pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  // ── 1. Auth ────────────────────────────────────────────────────────────────────

  // Support both session cookie (web) and Bearer token (field app)
  let userId: string | null = null;
  try {
        const rl = await checkRateLimit('survey', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    userId = user?.id ?? null;
  } catch {
    // Bearer token path — validate handoff JWT from field app
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      const { verifyHandoffToken } = await import('@/lib/survey/handoff/tokenMinter');
      const claims = verifyHandoffToken(bearerToken);
      if (claims) {
        // Use the SolarPro user identity from the handoff token claims
        userId = claims.solarpro_user_id ?? 'field_app_bearer';
        pipelineLog.push(`[upload] Auth: valid handoff JWT (project_id=${claims.project_id} user=${userId})`);
      } else {
        // Invalid or expired bearer token — reject
        return NextResponse.json(
          { error: 'Invalid or expired handoff token', code: 'UNAUTHORIZED' },
          { status: 401 },
        );
      }
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  pipelineLog.push(`[upload] Auth: userId=${userId}`);

  // ── 2. Parse request body ─────────────────────────────────────────────────────

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body', code: 'PARSE_ERROR' },
      { status: 400 },
    );
  }

  // ── 3. Validate raw payload ───────────────────────────────────────────────────

  const validation = validateRawPayload(body);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: 'Survey payload validation failed',
        code: 'VALIDATION_ERROR',
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 400 },
    );
  }

  const raw = body as RawSurveyPayload;
  pipelineLog.push(`[upload] Validated: survey=${raw.id} project=${raw.projectId}`);

  if (validation.warnings.length > 0) {
    pipelineLog.push(`[upload] Validation warnings: ${validation.warnings.map(w => w.message).join(', ')}`);
  }

  // ── 4. Normalization ──────────────────────────────────────────────────────────

  let normalized: NormalizedSiteSurvey;
  try {
    normalized = normalizeSurvey(raw);
    pipelineLog.push(`[upload] Normalization complete: ${normalized.normalizationLog.length} log entries`);
  } catch (err) {
    // normalizeSurvey never throws — but protect against future regression
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('SURVEY', `[SURVEY_NORMALIZE_FAIL] survey=${raw.id} error=${msg}`);
    return NextResponse.json(
      { error: 'Survey normalization failed', code: 'NORMALIZATION_ERROR' },
      { status: 500 },
    );
  }

  // ── 5. Enrichment ─────────────────────────────────────────────────────────────

  let enriched: EnrichedSiteSurvey;
  try {
    enriched = enrichSurvey(normalized);
    pipelineLog.push(`[upload] Enrichment complete: ${enriched.enrichmentLog.length} log entries`);
  } catch (err) {
    // enrichSurvey never throws — but protect against future regression
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('SURVEY', `[SURVEY_ENRICH_FAIL] survey=${raw.id} error=${msg}`);
    // Return normalized data even if enrichment fails — non-fatal
    return NextResponse.json(
      {
        ok: true,
        surveyId: raw.id,
        projectId: raw.projectId,
        pipelineVersion: SITE_SURVEY_PIPELINE_VERSION,
        enriched: false,
        normalized,
        warnings: [`Enrichment failed: ${msg}`],
        dbAction: 'skipped',
        processingMs: Date.now() - requestStart,
      },
      { status: 200 },
    );
  }

  // ── 6. DB upsert (fire and check — non-blocking to response) ──────────────────

  const dbAction = await upsertSiteSurvey(raw, normalized, enriched, pipelineLog);

  // ── 7. Log pipeline summary ───────────────────────────────────────────────────

  const processingMs = Date.now() - requestStart;
  const structPass = enriched.derived.structuralFeasibility.feasible;
  const elecPass = enriched.derived.electricalFeasibility.feasible;

  logger.info('SURVEY', [
    `[SURVEY_COMPLETE]`,
    `survey=${raw.id}`,
    `project=${raw.projectId}`,
    `pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`,
    `structural=${structPass ? 'PASS' : 'FAIL'}`,
    `electrical=${elecPass ? 'PASS' : 'FAIL'}`,
    `shading=${enriched.derived.shadingConfidence}`,
    `usable=${enriched.derived.effectiveUsableAreaSqFt ?? 'none'}sqft`,
    `planes=${normalized.geometry.roofPlanes.length}`,
    `obstructions=${normalized.geometry.obstructions.length}`,
    `photos=${normalized.photos.length}`,
    `dbAction=${dbAction}`,
    `ms=${processingMs}`,
  ].join(' '));

  // ── 8. Response ───────────────────────────────────────────────────────────────

  return NextResponse.json(
    {
      ok: true,
      surveyId: raw.id,
      projectId: raw.projectId,
      pipelineVersion: SITE_SURVEY_PIPELINE_VERSION,
      enriched: true,
      dbAction,

      // Enriched survey data — downstream tools consume this
      survey: enriched,

      // Pre-computed feasibility flags — available immediately for UI
      feasibility: {
        structural: {
          pass: structPass,
          flags: enriched.derived.structuralFeasibility.flags,
          warnings: enriched.derived.structuralFeasibility.warnings,
        },
        electrical: {
          pass: elecPass,
          flags: enriched.derived.electricalFeasibility.flags,
          warnings: enriched.derived.electricalFeasibility.warnings,
          nec120PctRule: enriched.derived.electricalFeasibility.nec120PctRule,
        },
      },

      // Geometry summary
      geometry: {
        usableAreaSqFt: enriched.derived.effectiveUsableAreaSqFt,
        computedUsableAreaSqFt: enriched.derived.computedUsableAreaSqFt,
        shadingConfidence: enriched.derived.shadingConfidence,
        roofPlaneCount: normalized.geometry.roofPlanes.length,
        obstructionCount: normalized.geometry.obstructions.length,
        cadSurfaceCount: enriched.derived.cadRoofSurfaces.length,
        exclusionZoneCount: enriched.derived.cadExclusionZones.length,
      },

      // Pipeline diagnostics
      diagnostics: {
        normalizationWarnings: normalized.normalizationLog.filter(l => l.includes('WARN')).length,
        enrichmentWarnings: enriched.enrichmentLog.filter(l => l.includes('WARN')).length,
        processingMs,
      },

      // Validation warnings from step 3 (non-fatal)
      warnings: validation.warnings.map(w => w.message),
    },
    { status: 200 },
  );
}

// ─── GET handler — fetch stored survey for a project ─────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth
  let userId: string | null = null;
  try {
    const user = await getUserFromRequest(req);
    userId = user?.id ?? null;
  } catch {
    // Continue — will fail auth check below
  }

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse query params
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  const surveyId = searchParams.get('surveyId');

  if (!projectId && !surveyId) {
    return NextResponse.json(
      { error: 'projectId or surveyId query parameter required' },
      { status: 400 },
    );
  }
  if (projectId && !isValidUUID(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId format.' }, { status: 400 });
  }
  if (surveyId && !isValidUUID(surveyId)) {
    return NextResponse.json({ error: 'Invalid surveyId format.' }, { status: 400 });
  }

  try {
    const sql = await getDbReady();

    // IDOR FIX: All queries JOIN against projects to enforce ownership —
    // user can only read surveys for projects they own.
    let rows: Record<string, unknown>[];
    if (surveyId) {
      rows = await sql`
        SELECT s.id, s.project_id, s.pipeline_version, s.normalized, s.enriched,
               s.structural_feasibility, s.electrical_feasibility, s.created_at, s.updated_at
        FROM project_site_surveys s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = ${surveyId}
          AND p.user_id = ${userId}
        LIMIT 1
      `;
    } else {
      // Return most recent survey for project — ownership enforced via JOIN
      rows = await sql`
        SELECT s.id, s.project_id, s.pipeline_version, s.normalized, s.enriched,
               s.structural_feasibility, s.electrical_feasibility, s.created_at, s.updated_at
        FROM project_site_surveys s
        JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ${projectId}
          AND p.user_id = ${userId}
        ORDER BY s.created_at DESC
        LIMIT 1
      `;
    }

    if (rows.length === 0) {
      // Return 404 for both "not found" and "not yours" — don't leak existence
      return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    }

    const row = rows[0];

    return NextResponse.json({
      ok: true,
      surveyId: row.id,
      projectId: row.project_id,
      pipelineVersion: row.pipeline_version,
      normalized: JSON.parse(row.normalized),
      enriched: JSON.parse(row.enriched),
      structuralFeasibility: JSON.parse(row.structural_feasibility),
      electricalFeasibility: JSON.parse(row.electrical_feasibility),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('SURVEY', `[SURVEY_GET_FAIL] error=${msg}`);
    return NextResponse.json({ error: 'Failed to fetch survey' }, { status: 500 });
  }
}