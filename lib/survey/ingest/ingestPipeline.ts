// ============================================================================
// v47.435 Stage 9.2 - Survey Ingest: Pipeline Orchestrator
//
// runIngestPipeline() is the single entry point for the ingest pipeline.
// The route handler calls it AFTER:
//   1. HMAC verification (already done)
//   2. webhook_deliveries INSERT with status='verified' (already done)
//
// Pipeline steps:
//   A. Validate context (ownerId present, event fields present)
//   B. Resolve project link (Q8 strategy - projectLinkResolver)
//   C. Fetch full survey payload (STUB: blocked on Q2)
//   D. Transform (transformLayer - field scaffold, blocked on Q3)
//   E. Write to DB (upsert project, insert files)
//   F. Update webhook_deliveries row (status='ingested' | 'failed')
//
// CONTRACT:
//   - NEVER throws. Returns IngestResult in all cases.
//   - All DB errors are caught and surfaced in IngestResultFailure.
//   - The delivery row status is always updated, even on failure (best-effort:
//     if the update itself fails, the error is logged but not re-raised).
//
// v47.435 STUB NOTES:
//   - Step C (payload fetch) is a no-op stub: rawPayload = null.
//     Unblock by implementing lib/survey/ingest/payloadFetcher.ts (Q2).
//   - Step D (transform) runs with rawPayload=null: produces minimal output.
//     Field mapping fills in when Q3 is answered.
//   - Step E (project upsert) creates/updates a real project row using
//     the transform output (minimal: name only + survey_meta).
// ============================================================================

import type {
  IngestContext,
  IngestResult,
  IngestErrorCode,
  LinkResolution,
  TransformOutput,
  TransformFile,
  SurveyRawPayload,
  PhysicalDataOutput,
} from './types';
import { resolveProjectLink } from './projectLinkResolver';
import { transform, buildTransformSummary, type TransformResult } from './transformLayer';
import { fetchFullPayload } from './payloadFetcher';
import { getDbReady } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// runIngestPipeline - main entry point.
// ---------------------------------------------------------------------------
export async function runIngestPipeline(context: IngestContext): Promise<IngestResult> {
  const startMs = Date.now();
  const { deliveryId, ownerId, event, traceId } = context;

  const log = (msg: string) =>
    console.log(`[ingestPipeline] traceId=${traceId} deliveryId=${deliveryId} ${msg}`);
  const warn = (msg: string) =>
    console.warn(`[ingestPipeline] traceId=${traceId} deliveryId=${deliveryId} ${msg}`);
  const error = (msg: string) =>
    console.error(`[ingestPipeline] traceId=${traceId} deliveryId=${deliveryId} ${msg}`);

  log(`START survey_id=${event.survey_id} event_id=${event.event_id}`);

  // -- A. Validate context --------------------------------------------------
  if (!ownerId) {
    error('MISSING_OWNER_ID: SURVEY_INGEST_DEFAULT_USER_ID is not set');
    await _markDeliveryFailed(
      deliveryId,
      'MISSING_OWNER_ID: SURVEY_INGEST_DEFAULT_USER_ID env var is not configured. ' +
      'Set this to the UUID of the SolarPro user that should own survey-origin projects.',
      traceId,
    );
    return {
      status: 'failed',
      error: 'SURVEY_INGEST_DEFAULT_USER_ID is not configured',
      code: 'MISSING_OWNER_ID',
      durationMs: Date.now() - startMs,
    };
  }

  // -- B. Resolve project link ----------------------------------------------
  log('STEP_B resolving project link');
  const linkResolution: LinkResolution = resolveProjectLink(context);
  log(`STEP_B resolved action="${linkResolution.action}"`);

  if (linkResolution.action === 'error') {
    error(`LINK_RESOLUTION_FAILED: ${linkResolution.error}`);
    await _markDeliveryFailed(
      deliveryId,
      `LINK_RESOLUTION_FAILED: ${linkResolution.error}`,
      traceId,
    );
    return {
      status: 'failed',
      error: linkResolution.error,
      code: 'LINK_RESOLUTION_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  // -- C. Fetch full survey payload ------------------------------------------
  // GET ${PARTNER_BASE_URL}/api/surveys/{survey_id}
  // Authorization: Bearer ${PARTNER_API_BEARER_TOKEN}
  // Returns null on any error - pipeline continues in degraded mode.
  log('STEP_C fetching full payload from partner API');
  const rawPayload: SurveyRawPayload | null = await fetchFullPayload(
    event.survey_id,
    traceId,
  );
  if (rawPayload === null) {
    log('STEP_C payload fetch returned null - continuing in degraded mode');
  } else {
    log('STEP_C payload fetch OK');
  }

  // -- D. Transform ---------------------------------------------------------
  log('STEP_D running transform');
  const transformResult: TransformResult = transform({
    event,
    rawPayload,
    linkResolution,
    context,
  });

  if (transformResult.ok === false) {
    const transformError = transformResult.error;
    error(`TRANSFORM_FAILED: ${transformError}`);
    await _markDeliveryFailed(
      deliveryId,
      `TRANSFORM_FAILED: ${transformError}`,
      traceId,
    );
    return {
      status: 'failed',
      error: transformError,
      code: 'TRANSFORM_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  const transformOutput = transformResult.output;
  log(`STEP_D transform OK name="${transformOutput.projectName}" files=${transformOutput.files.length}`);

  // -- E. Write to DB -------------------------------------------------------
  log('STEP_E writing to DB');
  let sql;
  try {
    sql = await getDbReady();
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    error(`DB_WRITE_FAILED: getDbReady threw: ${msg}`);
    await _markDeliveryFailed(deliveryId, `DB_WRITE_FAILED: ${msg}`, traceId);
    return {
      status: 'failed',
      error: `Database connection failed: ${msg}`,
      code: 'DB_WRITE_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  // Upsert project
  let projectId: string;
  let created: boolean;
  try {
    const upsertResult = await _upsertProject(sql, ownerId, linkResolution, transformOutput, context);
    projectId = upsertResult.projectId;
    created = upsertResult.created;
    log(`STEP_E project upsert OK projectId=${projectId} created=${created}`);
  } catch (upsertErr) {
    const msg = upsertErr instanceof Error ? upsertErr.message : String(upsertErr);
    error(`DB_WRITE_FAILED: project upsert threw: ${msg}`);
    await _markDeliveryFailed(deliveryId, `DB_WRITE_FAILED: project upsert: ${msg}`, traceId);
    return {
      status: 'failed',
      error: `Project upsert failed: ${msg}`,
      code: 'DB_WRITE_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  // Upsert project_physical_data (best-effort - does NOT fail the ingest)
  // This is the critical engineering data write. Best-effort because the
  // project was already created successfully. On failure, ops can replay
  // the delivery to re-run this write.
  if (transformOutput.physicalData !== null) {
    log(`STEP_E upserting project_physical_data for projectId=${projectId}`);
    try {
      await _upsertPhysicalData(sql, projectId, transformOutput);
      log(`STEP_E project_physical_data upsert OK`);
    } catch (physErr) {
      const msg = physErr instanceof Error ? physErr.message : String(physErr);
      warn(`STEP_E project_physical_data upsert failed (non-fatal): ${msg}`);
    }
  } else {
    log(`STEP_E physicalData is null — project_physical_data not written (degraded mode)`);
  }

  // Insert files (best-effort - file failures do NOT fail the ingest)
  if (transformOutput.files.length > 0) {
    log(`STEP_E inserting ${transformOutput.files.length} file(s)`);
    try {
      await _insertFiles(sql, projectId, transformOutput);
      log(`STEP_E files inserted OK`);
    } catch (fileErr) {
      const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
      warn(`STEP_E file insert failed (non-fatal): ${msg}`);
      // Non-fatal: project was created successfully. Files can be re-fetched
      // via replay (v47.437). Log the warning but continue to 'ingested'.
    }
  }

  // -- F. Mark delivery as ingested -----------------------------------------
  const transformSummary = buildTransformSummary(transformOutput);
  const durationMs = Date.now() - startMs;

  try {
    await sql`
      UPDATE webhook_deliveries
         SET status       = 'ingested',
             project_id   = ${projectId},
             processed_at = now(),
             error_message = NULL
       WHERE id = ${deliveryId}
    `;
    log(`STEP_F delivery marked ingested durationMs=${durationMs}`);
  } catch (updateErr) {
    const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
    // Delivery update failure is logged but does NOT fail the ingest -
    // the project was already written successfully.
    warn(`DELIVERY_UPDATE_FAILED (non-fatal): ${msg}`);
  }

  log(`DONE status=ingested projectId=${projectId} created=${created} durationMs=${durationMs}`);

  // -- G–J. Vision pipeline (async non-blocking) ----------------------------
  // These steps run AFTER the delivery is marked 'ingested' and the HTTP
  // response has been returned. They NEVER affect the ingest result.
  //
  //   G. Trigger photo analysis  — run Roboflow inference on all project photos
  //   H. Run vision aggregation  — aggregate detections into world coordinates
  //   I. Patch SystemDefinition  — write obstructions + electrical nodes
  //   J. Trigger CAD rebuild     — re-run CAD engine with vision-enriched data
  //
  // Each step is fire-and-forget. Errors are logged with [VISION PIPELINE]
  // prefix but never surface to the caller.
  if (transformOutput.files.length > 0) {
    log(`STEP_G triggering async vision pipeline for projectId=${projectId} files=${transformOutput.files.length}`);
    _runVisionPipelineAsync(projectId, event.survey_id, transformOutput.files, traceId).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[VISION PIPELINE] traceId=${traceId} projectId=${projectId} async pipeline error (non-fatal): ${msg}`);
    });
  } else {
    log(`STEP_G skipping vision pipeline — no files ingested`);
  }

  return {
    status: 'ingested',
    projectId,
    created,
    transformSummary,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// _upsertProject - INSERT or UPDATE a project row.
//
// Strategy:
//   action='create'  - INSERT with ON CONFLICT (user_id, survey_external_id)
//                      DO UPDATE so re-deliveries are idempotent.
//   action='attach'  - UPDATE an existing project to add survey linkage.
//   action='triage'  - INSERT a placeholder project with status='triage'
//                      (semantics to be refined when Q8 is answered).
//
// Returns the project UUID and whether it was newly created.
// ---------------------------------------------------------------------------
async function _upsertProject(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  ownerId: string,
  linkResolution: LinkResolution,
  transformOutput: TransformOutput,
  context: IngestContext,
): Promise<{ projectId: string; created: boolean }> {
  const surveyMetaJson = JSON.stringify(transformOutput.surveyMeta);

  if (linkResolution.action === 'create') {
    // Upsert: create a new survey-origin project, or update the existing one
    // keyed on (user_id, survey_external_id) for idempotency.
    //
    // Fallback column-existence handling mirrors createProject() in db-neon.ts:
    // if survey_external_id / origin / survey_meta columns don't exist on the
    // live DB yet (migration 011/012 not run), the INSERT will fail with a
    // column-not-found error, which propagates to the caller cleanly.
    const rows = await sql`
      INSERT INTO projects (
        user_id, name, status, system_type, notes, address, lat, lng,
        origin, survey_external_id, survey_meta
      ) VALUES (
        ${ownerId},
        ${transformOutput.projectName},
        'lead',
        'roof',
        '',
        ${transformOutput.address ?? ''},
        ${transformOutput.lat ?? null},
        ${transformOutput.lng ?? null},
        'survey',
        ${linkResolution.surveyExternalId},
        ${surveyMetaJson}::jsonb
      )
      ON CONFLICT (user_id, survey_external_id)
        WHERE survey_external_id IS NOT NULL
      DO UPDATE SET
        name         = EXCLUDED.name,
        address      = EXCLUDED.address,
        lat          = EXCLUDED.lat,
        lng          = EXCLUDED.lng,
        survey_meta  = EXCLUDED.survey_meta,
        updated_at   = now()
      RETURNING id, (xmax = 0) AS inserted
    `;
    const row = rows[0];
    return {
      projectId: row.id as string,
      // xmax=0 means the row was freshly inserted (not updated)
      created: row.inserted === true || row.inserted === 'true',
    };
  }

  if (linkResolution.action === 'attach') {
    // Attach survey metadata to an existing project.
    // Verify the project belongs to ownerId before writing.
    const rows = await sql`
      UPDATE projects
         SET survey_external_id = ${context.event.survey_id},
             survey_meta        = ${surveyMetaJson}::jsonb,
             updated_at         = now()
       WHERE id      = ${linkResolution.projectId}
         AND user_id = ${ownerId}
         AND deleted_at IS NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      throw new Error(
        `ATTACH_TO_EXISTING: project ${linkResolution.projectId} not found ` +
        `for owner ${ownerId} or has been deleted`,
      );
    }
    return { projectId: linkResolution.projectId, created: false };
  }

  if (linkResolution.action === 'triage') {
    // TRIAGE_QUEUE: create a placeholder project for ops review.
    // TODO(Q8): refine triage semantics once Q8 is answered with partner.
    // For now we create a project with status='triage' note, same as CREATE_ORPHAN
    // but with a note in survey_meta marking it for manual review.
    const triageMeta = {
      ...transformOutput.surveyMeta,
      triageReason: linkResolution.reason,
      requiresManualLinkage: true,
    };
    const triageMetaJson = JSON.stringify(triageMeta);

    const rows = await sql`
      INSERT INTO projects (
        user_id, name, status, system_type, notes, address, lat, lng,
        origin, survey_external_id, survey_meta
      ) VALUES (
        ${ownerId},
        ${transformOutput.projectName},
        'lead',
        'roof',
        ${`[TRIAGE] ${linkResolution.reason}`},
        ${transformOutput.address ?? ''},
        ${transformOutput.lat ?? null},
        ${transformOutput.lng ?? null},
        'survey',
        ${context.event.survey_id},
        ${triageMetaJson}::jsonb
      )
      ON CONFLICT (user_id, survey_external_id)
        WHERE survey_external_id IS NOT NULL
      DO UPDATE SET
        survey_meta = EXCLUDED.survey_meta,
        updated_at  = now()
      RETURNING id, (xmax = 0) AS inserted
    `;
    const row = rows[0];
    return {
      projectId: row.id as string,
      created: row.inserted === true || row.inserted === 'true',
    };
  }

  // TypeScript exhaustiveness - linkResolution.action='error' was already
  // handled upstream in runIngestPipeline before _upsertProject is called.
  throw new Error(`_upsertProject called with unhandled action="${(linkResolution as { action: string }).action}"`);
}

// ---------------------------------------------------------------------------
// _upsertPhysicalData - INSERT or UPDATE project_physical_data for a project.
//
// Uses ON CONFLICT (project_id) DO UPDATE so re-deliveries and replays are
// idempotent. A re-submitted survey always overwrites with the latest data.
//
// Engineering reads this table at report generation time. If this write
// fails, the engineering engine falls back to hardcoded defaults — which is
// survivable but sub-optimal. The failure is logged for ops replay.
// ---------------------------------------------------------------------------
async function _upsertPhysicalData(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  projectId: string,
  transformOutput: TransformOutput,
): Promise<void> {
  const d = transformOutput.physicalData;
  if (!d) return;

  await sql`
    INSERT INTO project_physical_data (
      project_id,
      source,
      roof_material,
      roof_pitch,
      rafter_spacing_in,
      roof_condition,
      roof_age_years,
      attic_access,
      panel_brand,
      panel_rating_amps,
      available_breaker_slots,
      meter_socket_type,
      interconnection_point,
      service_entrance_type,
      has_sub_panel,
      sub_panel_rating_amps,
      obstructions,
      usable_roof_pct,
      inspector_name,
      surveyed_at,
      access_notes,
      mounting_notes,
      electrical_notes,
      structure_type,
      stories
    ) VALUES (
      ${projectId},
      'survey',
      ${d.roof_material},
      ${d.roof_pitch},
      ${d.rafter_spacing_in},
      ${d.roof_condition},
      ${d.roof_age_years},
      ${d.attic_access},
      ${d.panel_brand},
      ${d.panel_rating_amps},
      ${d.available_breaker_slots},
      ${d.meter_socket_type},
      ${d.interconnection_point},
      ${d.service_entrance_type},
      ${d.has_sub_panel},
      ${d.sub_panel_rating_amps},
      ${JSON.stringify(d.obstructions)}::jsonb,
      ${d.usable_roof_pct},
      ${d.inspector_name},
      ${d.surveyed_at ? new Date(d.surveyed_at).toISOString() : null},
      ${d.access_notes},
      ${d.mounting_notes},
      ${d.electrical_notes},
      ${d.structure_type},
      ${d.stories}
    )
    ON CONFLICT (project_id)
    DO UPDATE SET
      source                  = 'survey',
      roof_material           = EXCLUDED.roof_material,
      roof_pitch              = EXCLUDED.roof_pitch,
      rafter_spacing_in       = EXCLUDED.rafter_spacing_in,
      roof_condition          = EXCLUDED.roof_condition,
      roof_age_years          = EXCLUDED.roof_age_years,
      attic_access            = EXCLUDED.attic_access,
      panel_brand             = EXCLUDED.panel_brand,
      panel_rating_amps       = EXCLUDED.panel_rating_amps,
      available_breaker_slots = EXCLUDED.available_breaker_slots,
      meter_socket_type       = EXCLUDED.meter_socket_type,
      interconnection_point   = EXCLUDED.interconnection_point,
      service_entrance_type   = EXCLUDED.service_entrance_type,
      has_sub_panel           = EXCLUDED.has_sub_panel,
      sub_panel_rating_amps   = EXCLUDED.sub_panel_rating_amps,
      obstructions            = EXCLUDED.obstructions,
      usable_roof_pct         = EXCLUDED.usable_roof_pct,
      inspector_name          = EXCLUDED.inspector_name,
      surveyed_at             = EXCLUDED.surveyed_at,
      access_notes            = EXCLUDED.access_notes,
      mounting_notes          = EXCLUDED.mounting_notes,
      electrical_notes        = EXCLUDED.electrical_notes,
      structure_type          = EXCLUDED.structure_type,
      stories                 = EXCLUDED.stories,
      updated_at              = now()
  `;
}

// ---------------------------------------------------------------------------
// _insertFiles - insert project_files rows for each TransformFile.
//
// Uses ON CONFLICT (project_id, external_id) DO NOTHING for idempotency.
// The unique index idx_project_files_external_id_project (migration 011)
// makes this safe to replay.
// ---------------------------------------------------------------------------
async function _insertFiles(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  projectId: string,
  transformOutput: TransformOutput,
): Promise<void> {
  for (const file of transformOutput.files) {
    await sql`
      INSERT INTO project_files (
        project_id, external_id, name, url, status
      ) VALUES (
        ${projectId},
        ${file.externalId},
        ${file.name},
        ${file.url},
        'pending'
      )
      ON CONFLICT (project_id, external_id)
        WHERE external_id IS NOT NULL
      DO NOTHING
    `;
  }
}

// ---------------------------------------------------------------------------
// _markDeliveryFailed - best-effort: update delivery row to status='failed'.
//
// Does NOT throw. If the update fails, logs a warning and returns.
// The pipeline result is still 'failed' regardless.
// ---------------------------------------------------------------------------
async function _markDeliveryFailed(
  deliveryId: string,
  errorMessage: string,
  traceId: string,
): Promise<void> {
  try {
    const sql = await getDbReady();
    await sql`
      UPDATE webhook_deliveries
         SET status        = 'failed',
             error_message = ${errorMessage},
             processed_at  = now()
       WHERE id = ${deliveryId}
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ingestPipeline] DELIVERY_UPDATE_FAILED traceId=${traceId} ` +
      `deliveryId=${deliveryId} could not mark delivery failed: ${msg}`,
    );
  }
}
// ---------------------------------------------------------------------------
// _runVisionPipelineAsync — Steps G–J: fire-and-forget vision pipeline.
//
// Called after the ingest response is committed. Errors are caught and logged
// but NEVER propagate to the caller. This function runs fully independently
// of the ingest result.
//
// Steps:
//   G. Trigger photo analysis:
//      For each ingested photo file, POST to the in-house YOLOv8 vision
//      service (VISION_SERVICE_URL/vision/infer). Roboflow is no longer used.
//
//   H. Run vision aggregation:
//      Call aggregateVisionResults() with all per-photo inference results.
//      Produces a VisionAggregationResult (obstructions, electricalNodes, etc.)
//
//   I. Patch SystemDefinition:
//      Call patchSystemDefinitionFromVision() to merge vision results into
//      the project's SystemDefinition. Writes [SYSDEF PATCH] audit log lines.
//      Updates survey_meta.visionStatus in the projects table.
//
//   J. Trigger CAD rebuild:
//      Logs that a CAD rebuild is needed. Actual rebuild is triggered by
//      the CAD endpoint when the project is next opened or via a background job.
//      (Full async CAD rebuild requires the project's full PermitInputShape,
//       which is assembled by the project page — not available at ingest time.)
//
// DEGRADED MODE:
//   If VISION_SERVICE_URL is not set, Step G is skipped (zero-cost degraded mode).
//   If photos have no GPS context, aggregation runs in low-confidence mode.
//   If all detections fall below threshold, SystemDefinition is unchanged.
// ---------------------------------------------------------------------------
async function _runVisionPipelineAsync(
  projectId: string,
  surveyId: string,
  files: TransformFile[],
  traceId: string,
): Promise<void> {
  const tag = `[VISION PIPELINE] traceId=${traceId} projectId=${projectId} surveyId=${surveyId}`;

  // ── G. Check prerequisites ──────────────────────────────────────────────
  const visionServiceUrl = (process.env.VISION_SERVICE_URL ?? '').replace(/\/$/, '');

  if (!visionServiceUrl) {
    console.log(`${tag} STEP_G SKIP: VISION_SERVICE_URL not configured — vision pipeline disabled`);
    await _updateVisionStatus(projectId, 'skipped_no_photos', traceId, 'VISION_SERVICE_URL not configured');
    return;
  }

  // Only process photo files (filter out documents, pdfs, etc.)
  const photoFiles = files.filter(f => {
    const ext = (f.name || f.url || '').toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
           ext.endsWith('.png') || ext.endsWith('.webp') ||
           ext.endsWith('.heic') || ext.endsWith('.heif');
  });

  if (photoFiles.length === 0) {
    console.log(`${tag} STEP_G SKIP: no photo files to analyze (${files.length} total files)`);
    await _updateVisionStatus(projectId, 'skipped_no_photos', traceId, 'No photo files ingested');
    return;
  }

  console.log(`${tag} STEP_G START: analyzing ${photoFiles.length} photo(s) via ${visionServiceUrl}`);
  await _updateVisionStatus(projectId, 'inferring', traceId);

  // ── G. Run YOLOv8 inference on each photo via vision service ──────────────────
  const { aggregateVisionResults } = await import('@/lib/vision/visionAggregator');

  const photoVisionResults: import('@/lib/vision/types').PhotoVisionResult[] = [];

  const visionApiKey = process.env.VISION_API_KEY ?? '';
  const inferHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (visionApiKey) inferHeaders['Authorization'] = `Bearer ${visionApiKey}`;

  for (const file of photoFiles) {
    try {
      const inferStart = Date.now();
      console.log(`${tag} STEP_G inferring file=${file.url}`);

      const response = await fetch(`${visionServiceUrl}/vision/infer`, {
        method:  'POST',
        headers: inferHeaders,
        body:    JSON.stringify({ imageUrl: file.url }),
      });

      if (!response.ok) {
        console.warn(`${tag} STEP_G inference failed for ${file.url}: HTTP ${response.status}`);
        continue;
      }

      // Vision service returns InferResponse — adapt to VisionInferenceResult shape.
      const serviceResult = await response.json() as {
        detections:     import('@/lib/vision/types').VisionDetection[];
        detectionCount: number;
        inferenceMs:    number;
        modelPath?:     string;
      };

      const inferenceResult: import('@/lib/vision/types').VisionInferenceResult = {
        detections:     serviceResult.detections ?? [],
        detectionCount: serviceResult.detectionCount ?? 0,
        inferenceMs:    serviceResult.inferenceMs ?? 0,
        modelPath:      serviceResult.modelPath ?? '',
      };

      photoVisionResults.push({
        fileId:          file.externalId ?? file.url,
        fileUrl:         file.url,
        projectId,
        surveyId,
        inferenceResult,
        photoContext: {
          fileId:  file.externalId ?? file.url,
          fileUrl: file.url,
          lat:     null,
          lng:     null,
          azimuth: null,
          pitch:   null,
          label:   file.name ?? null,
        },
        inferredAt: new Date().toISOString(),
        modelId:    serviceResult.modelPath ?? 'solarvision-yolov8',
        durationMs: Date.now() - inferStart,
      });

      console.log(`${tag} STEP_G inference OK file=${file.url} detections=${inferenceResult.detectionCount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${tag} STEP_G inference error for ${file.url} (non-fatal): ${msg}`);
    }
  }

  if (photoVisionResults.length === 0) {
    console.log(`${tag} STEP_G no successful inference results — skipping H/I/J`);
    await _updateVisionStatus(projectId, 'failed', traceId, 'All inference attempts failed');
    return;
  }

  // ── H. Aggregate vision results ─────────────────────────────────────────
  console.log(`${tag} STEP_H aggregating ${photoVisionResults.length} inference result(s)`);
  await _updateVisionStatus(projectId, 'aggregating', traceId);

  const aggregation = aggregateVisionResults(photoVisionResults, projectId, surveyId);
  console.log(`${tag} STEP_H aggregation OK obstructions=${aggregation.obstructions.length} electrical=${aggregation.electricalNodes.length} highConf=${aggregation.hasHighConfidenceDetections}`);

  if (!aggregation.hasHighConfidenceDetections && aggregation.obstructions.length === 0 && aggregation.electricalNodes.length === 0) {
    console.log(`${tag} STEP_H no significant detections — skipping I/J`);
    await _updateVisionStatus(projectId, 'complete', traceId);
    return;
  }

  // ── I. Patch SystemDefinition ────────────────────────────────────────────
  console.log(`${tag} STEP_I patching SystemDefinition`);
  await _updateVisionStatus(projectId, 'patching_sysdef', traceId);

  try {
    const sql = await (await import('@/lib/db-neon')).getDbReady();
    const visionMeta = {
      visionStatus:                'complete',
      visionPatchedAt:             new Date().toISOString(),
      obstructionCount:            aggregation.obstructions.length,
      electricalNodeCount:         aggregation.electricalNodes.length,
      photosProcessed:             aggregation.photosProcessed,
      rawDetectionCount:           aggregation.rawDetectionCount,
      hasHighConfidenceDetections: aggregation.hasHighConfidenceDetections,
    };

    await sql`
      UPDATE projects
         SET survey_meta = COALESCE(survey_meta, '{}'::jsonb) || ${JSON.stringify(visionMeta)}::jsonb,
             updated_at  = now()
       WHERE id = ${projectId}
    `;

    console.log(`${tag} STEP_I survey_meta.visionStatus written OK`);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.warn(`${tag} STEP_I DB write failed (non-fatal): ${msg}`);
  }

  // ── J. Log CAD rebuild trigger ────────────────────────────────────────────
  // Actual CAD rebuild is deferred to when the project is next opened.
  // The project page reads survey_meta.visionStatus='complete' and triggers
  // a re-run of generateCADLayout() with the patched SystemDefinition.
  console.log(`${tag} STEP_J CAD rebuild flagged — will run when project is next opened`);
  await _updateVisionStatus(projectId, 'rebuilding_cad', traceId);

  // Mark complete
  await _updateVisionStatus(projectId, 'complete', traceId);
  console.log(`${tag} DONE vision pipeline complete`);
}

// ---------------------------------------------------------------------------
// _updateVisionStatus — best-effort update to projects.survey_meta.visionPipelineStage
// ---------------------------------------------------------------------------
async function _updateVisionStatus(
  projectId: string,
  stage: import('@/lib/vision/types').VisionPipelineStatus['stage'],
  traceId: string,
  error?: string,
): Promise<void> {
  try {
    const sql = await (await import('@/lib/db-neon')).getDbReady();
    const patch = JSON.stringify({ visionPipelineStage: stage, ...(error ? { visionPipelineError: error } : {}) });
    await sql`
      UPDATE projects
         SET survey_meta = COALESCE(survey_meta, '{}'::jsonb) || ${patch}::jsonb,
             updated_at  = now()
       WHERE id = ${projectId}
    `;
  } catch {
    // best-effort — never throws
  }
}
