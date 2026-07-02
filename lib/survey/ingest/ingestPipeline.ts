// ============================================================================
// v47.440 Stage 9.3 - Survey Ingest: Pipeline Orchestrator
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
  SurveyRawPayload,
  PhysicalDataOutput,
} from './types';
import { resolveProjectLink } from './projectLinkResolver';
import { transform, buildTransformSummary, type TransformResult } from './transformLayer';
import { fetchFullPayload } from './payloadFetcher';
import { getDbReady, createSiteSurvey, bulkAddSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';
import { writeMicroStage } from '@/lib/microStage';

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
  // resolveProjectLink() is pure (no DB). It returns:
  //   action='attach'           — direct UUID known (JWT or on-device picker)
  //   action='resolve_existing' — must look up existing project by survey_id/address
  //   action='error'            — could not even form a lookup strategy
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
  // Priority 1: Use inline_payload if provided by /api/survey/submit.
  //   This is the full SurveyV2Payload already in memory - no network fetch needed.
  //   External partner webhooks never set inline_payload.
  // Priority 2: Fetch from GET ${PARTNER_BASE_URL}/api/surveys/{survey_id}
  //   Used for survey-app webhook worker path where only a thin event arrives.
  log('STEP_C fetching full payload');
  let rawPayload: SurveyRawPayload | null = null;

  if (event.inline_payload && typeof event.inline_payload === 'object') {
    rawPayload = event.inline_payload as SurveyRawPayload;
    log('STEP_C using inline_payload from submit route (no network fetch needed)');
  } else {
    rawPayload = await fetchFullPayload(event.survey_id, traceId);
    if (rawPayload === null) {
      log('STEP_C payload fetch returned null - continuing in degraded mode');
    } else {
      log('STEP_C payload fetch OK');
    }
  }

  // -- D. Transform ---------------------------------------------------------
  // v47.441: When inline_payload is present (mobile direct submit via
  // /api/survey/submit), use the v2.0 transformer so photos, physicalData,
  // and siteOverview fields are correctly extracted.
  // For external partner webhooks (schemaVersion always '1.0'), use the
  // v1.0 transformer as before.
  log('STEP_D running transform');
  const transformEvent = rawPayload === event.inline_payload && rawPayload !== null
    ? { ...event, schemaVersion: '2.0' as const }
    : event;
  const transformResult: TransformResult = transform({
    event: transformEvent,
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

  // -- E-pre-1. Merge ownership claims into surveyMeta (F-06) ----------------
  // Persists solarpro_user_id, owner_source, and solarpro_project_id into
  // projects.survey_meta so that the admin "Fix Owner" endpoint can
  // read back the original claim and reassign if needed.
  transformOutput.surveyMeta = {
    ...transformOutput.surveyMeta,
    ...(context.event.solarpro_user_id    ? { solarpro_user_id:    context.event.solarpro_user_id    } : {}),
    ...(context.event.solarpro_project_id ? { solarpro_project_id: context.event.solarpro_project_id } : {}),
    ...(context.event.solarpro_email      ? { solarpro_email:      context.event.solarpro_email      } : {}),
    owner_source: context.ownerSource,
  };

  // -- E-pre-2. Resolve the existing project (v47.440) -----------------------
  //
  // Surveys MUST attach to an existing project. Auto-create is prohibited.
  //
  // Resolution priority (strict order):
  //   A) action='attach'           — direct UUID from linkResolution; verify exists in DB.
  //   B) action='resolve_existing' — look up by survey_external_id (= event.survey_id).
  //   C) action='resolve_existing' — look up by client_id + normalized address.
  //
  // If project cannot be resolved: log [SURVEY_PROJECT_RESOLUTION_FAIL] + STOP.
  log('STEP_E resolving existing project');
  const projectResolution = await _resolveExistingProjectId(
    sql, ownerId, linkResolution, context, transformOutput, traceId,
  );

  if (!projectResolution.projectId) {
    const failPayload = {
      incomingProjectRef: linkResolution.action === 'attach'
        ? linkResolution.projectId
        : (event.survey_id ?? null),
      clientId: linkResolution.action === 'resolve_existing'
        ? (linkResolution.clientId ?? null)
        : null,
      address: transformOutput.address ?? null,
      reason: projectResolution.reason,
    };
    console.error(
      `[SURVEY_PROJECT_RESOLUTION_FAIL] ${JSON.stringify(failPayload)}`,
    );
    error(
      `PROJECT_RESOLUTION_FAILED: ${projectResolution.reason} ` +
      `survey_id=${event.survey_id} deliveryId=${deliveryId}`,
    );
    await _markDeliveryFailed(
      deliveryId,
      `PROJECT_RESOLUTION_FAILED: ${projectResolution.reason}`,
      traceId,
    );
    return {
      status: 'failed',
      error: projectResolution.reason,
      code: 'PROJECT_RESOLUTION_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  const projectId: string = projectResolution.projectId;
  const created = false; // v47.440: we never create; always attach to existing

  // [SURVEY_PROJECT_RESOLUTION] success log
  console.log(`[SURVEY_PROJECT_RESOLUTION] ${JSON.stringify({
    resolvedProjectId: projectId,
    method: projectResolution.method,
  })}`);
  log(`STEP_E project resolved projectId=${projectId} method=${projectResolution.method}`);

  // Attach the survey to the resolved project: write survey_external_id and
  // survey_meta onto the project row so it is fully linked.
  try {
    await _attachSurveyToProject(sql, ownerId, projectId, event.survey_id, transformOutput);
    log(`STEP_E survey attached to project OK projectId=${projectId}`);
  } catch (attachErr) {
    const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
    error(`DB_WRITE_FAILED: _attachSurveyToProject threw: ${msg}`);
    await _markDeliveryFailed(deliveryId, `DB_WRITE_FAILED: attach survey: ${msg}`, traceId);
    return {
      status: 'failed',
      error: `Survey attachment failed: ${msg}`,
      code: 'DB_WRITE_FAILED',
      durationMs: Date.now() - startMs,
    };
  }

  // Upsert project_physical_data (best-effort - does NOT fail the ingest)
  // This is the critical engineering data write. Best-effort because the
  // project was already created successfully. On failure, ops can replay
  // the delivery to re-run this write.
  // NOTE: source_survey_id backlink is set in a second pass after E2 creates
  // the site_surveys row (we need the UUID first).
  if (transformOutput.physicalData !== null) {
    log(`STEP_E upserting project_physical_data for projectId=${projectId}`);
    try {
      await _upsertPhysicalData(sql, projectId, transformOutput, null);
      log(`STEP_E project_physical_data upsert OK`);
    } catch (physErr) {
      const msg = physErr instanceof Error ? physErr.message : String(physErr);
      warn(`STEP_E project_physical_data upsert failed (non-fatal): ${msg}`);
    }
  } else {
    log(`STEP_E physicalData is null — project_physical_data not written (degraded mode)`);
  }

  // Insert files into project_files (engineering pipeline read path).
  // This is separate from site_survey_files — project_files serves the older
  // lib/siteSurvey/ normalization pipeline and fromPhysicalData() bridge.
  if (transformOutput.files.length > 0) {
    log(`STEP_E inserting ${transformOutput.files.length} file(s) into project_files`);
    try {
      await _insertFiles(sql, projectId, transformOutput);
      log(`STEP_E project_files insert OK`);
    } catch (fileErr) {
      const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
      warn(`STEP_E project_files insert failed (non-fatal): ${msg}`);
      // Non-fatal: project was created successfully. Files can be re-fetched
      // via replay (v47.437). Log the warning but continue to 'ingested'.
    }
  }

  // -- E2. Create site_surveys row (canonical Field Data Layer) ---------------
  //
  // site_surveys is the single source of truth for field survey submissions.
  // This step:
  //   1. Resolves client_id from the freshly upserted project row (guaranteed
  //      to exist at this point). Falls back to picker selections.
  //   2. Creates the site_surveys row with the FULL rawPayload as survey_data.
  //   3. Inserts site_survey_files rows with category as label (no guessing).
  //   4. Backfills source_survey_id on project_physical_data.
  //   5. Emits [SURVEY_LINK] structured debug log.
  //   6. Fail-safe: verifies the row exists in site_surveys after write;
  //      auto-re-runs the link step if the row is missing (e.g. race condition).
  //
  // Spec requirements:
  //   - ON CONFLICT (external_survey_id) DO UPDATE  [handled in createSiteSurvey]
  //   - ERROR (not warn) if project_id is missing before insert
  //   - [SURVEY_LINK] log: { projectId, surveyId, photosInserted, createdOrUpdated }
  //   - Fail-safe: if survey exists in ingest but NOT in site_surveys → auto-run link
  //
  // If client_id cannot be resolved (orphan project with no client), the
  // site_surveys row cannot be created (client_id is NOT NULL). This is logged
  // prominently — ops must assign the project to a client to recover.
  //
  // NOTE: This step is wrapped in try/catch to prevent E2 bugs from failing a
  // successful ingest, but failures ARE logged at ERROR level (not just warn).

  // Spec requirement: ERROR (not warn) if project_id is missing before insert.
  if (!projectId) {
    error(
      `STEP_E2 CRITICAL: project_id is null/undefined before site_surveys insert ` +
      `survey_id=${event.survey_id} deliveryId=${deliveryId} — site_surveys row NOT created.`,
    );
  }

  let siteSurveyId: string | null = null;
  try {
    // Resolve client_id — query the project we just upserted for its client_id.
    // This is the most reliable source: the project row always exists at this point.
    // Falls back to auto-creating a client from the survey data when none exists.
    const clientId = await _resolveClientIdForSurvey(sql, ownerId, linkResolution, context, projectId, transformOutput);

    if (clientId) {
      // standalone: no project_id in JWT, or explicit picker selections present
      const isStandalone = !context.event.solarpro_project_id
        || context.event.solarpro_project_id === '__standalone__'
        || !!(context.selectedClientId || context.selectedProjectId);
      const source: 'project_handoff' | 'standalone' =
        isStandalone ? 'standalone' : 'project_handoff';

      const siteSurvey = await createSiteSurvey({
        clientId,
        projectId,
        createdBy:        ownerId,
        source,
        status:           'completed',
        addressSnapshot:  transformOutput.address ?? null,
        // Pass the FULL SurveyV2Payload (rawPayload) as survey_data.
        // This makes site_surveys the single source of truth for all field data.
        surveyData:       (rawPayload as Record<string, unknown>) ?? null,
        inspectorName:    transformOutput.physicalData?.inspector_name ?? null,
        externalSurveyId: event.survey_id ?? null,
        deliveryId:       deliveryId ?? null,
      });

      siteSurveyId = siteSurvey.id;
      log(`STEP_E2 site_surveys row created id=${siteSurvey.id} clientId=${clientId} source=${source}`);

      // -- Fail-safe: verify the row actually landed in site_surveys ----------
      // If createSiteSurvey returned an id but the row is somehow missing
      // (e.g. ON CONFLICT DO NOTHING ate the write before migration 017 landed,
      // or a concurrent delete), re-run the upsert once more to self-heal.
      const verifyRows = await sql`
        SELECT id FROM site_surveys
        WHERE id = ${siteSurveyId}
        LIMIT 1
      `;
      if (verifyRows.length === 0) {
        warn(
          `STEP_E2 FAIL-SAFE: site_surveys row id=${siteSurveyId} not found after write ` +
          `survey_id=${event.survey_id} projectId=${projectId} — re-running link step`,
        );
        // Re-run the upsert (createSiteSurvey uses ON CONFLICT DO UPDATE).
        const retrySurvey = await createSiteSurvey({
          clientId,
          projectId,
          createdBy:        ownerId,
          source,
          status:           'completed',
          addressSnapshot:  transformOutput.address ?? null,
          surveyData:       (rawPayload as Record<string, unknown>) ?? null,
          inspectorName:    transformOutput.physicalData?.inspector_name ?? null,
          externalSurveyId: event.survey_id ?? null,
          deliveryId:       deliveryId ?? null,
        });
        siteSurveyId = retrySurvey.id;
        log(`STEP_E2 FAIL-SAFE re-link OK id=${retrySurvey.id}`);
      }

      // Track how many photos were inserted for the [SURVEY_LINK] log.
      let photosInserted = 0;

      // Insert survey photos into site_survey_files.
      // Use file.category directly — this is the canonical SurveyV2 slot key
      // (e.g. 'main_panel_open', 'roof_overview'). Never guess from filename.
      if (transformOutput.files.length > 0) {
        const surveyFiles = transformOutput.files.map(f => ({
          surveyId: siteSurveyId!,
          fileUrl:  f.url,
          fileType: 'photo' as const,
          // category is the v2.0 slot key; fall back to filename guess only for
          // v1.0 partner payloads where category is null.
          label:    f.category ?? _guessPhotoLabel(f.name ?? f.url),
          filename: f.name ?? null,
          mimeType: f.mimeType ?? null,
          // capture-time device GPS (v2.0) → PV-1 equipment-marker tier 1
          gps:      f.gps ?? null,
        }));
        photosInserted = await bulkAddSiteSurveyFiles(surveyFiles);
        log(`STEP_E2 site_survey_files inserted count=${photosInserted}`);
      }

      // -- [SURVEY_LINK] structured debug log (spec requirement) --------------
      // Emitted after every successful E2 write so ops/devs can grep for it.
      // createdOrUpdated: 'created' if row was freshly inserted, 'updated' if
      //   ON CONFLICT DO UPDATE fired (i.e. external_survey_id already existed).
      const surveyLinkPayload = {
        projectId,
        surveyId:         event.survey_id,
        photosInserted,
        createdOrUpdated: siteSurvey.id === siteSurveyId ? 'created' : 'updated',
      };
      console.log(`[SURVEY_LINK] ${JSON.stringify(surveyLinkPayload)}`);

      // Backfill source_survey_id on project_physical_data now that we have
      // the site_surveys UUID. This links the flat engineering table back to
      // the canonical survey record.
      if (transformOutput.physicalData !== null) {
        try {
          await sql`
            UPDATE project_physical_data
               SET source_survey_id = ${siteSurveyId}
             WHERE project_id = ${projectId}
          `;
          log(`STEP_E2 project_physical_data.source_survey_id backfilled id=${siteSurveyId}`);
        } catch (backfillErr) {
          const msg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
          warn(`STEP_E2 source_survey_id backfill failed (non-fatal): ${msg}`);
        }
      }
    } else {
      // client_id could not be resolved — site_surveys row NOT created.
      // This means the project has no client assigned. The FieldSurveyCard
      // on the project page will show "No Survey" until a client is assigned
      // and the delivery is replayed.
      error(
        `STEP_E2 CRITICAL: could not resolve client_id for projectId=${projectId} ` +
        `survey_id=${event.survey_id} — site_surveys row NOT created. ` +
        `Assign a client to this project and replay delivery=${deliveryId} to recover.`,
      );
      // [SURVEY_LINK] log even on failure so we have a trace.
      console.log(`[SURVEY_LINK] ${JSON.stringify({
        projectId,
        surveyId:         event.survey_id,
        photosInserted:   0,
        createdOrUpdated: 'failed_no_client',
      })}`);
    }
  } catch (e2Err) {
    const msg = e2Err instanceof Error ? e2Err.message : String(e2Err);
    error(`STEP_E2 site_surveys creation failed: ${msg} — survey_id=${event.survey_id} projectId=${projectId}`);
    // [SURVEY_LINK] log on exception so there is always a grep-able trace entry.
    console.log(`[SURVEY_LINK] ${JSON.stringify({
      projectId,
      surveyId:         event.survey_id,
      photosInserted:   0,
      createdOrUpdated: `error:${msg.slice(0, 120)}`,
    })}`);
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

  // -- G. Prohibited-boundary quarantine ------------------------------------
  // Survey ingest must preserve immutable field evidence and canonical file
  // history without launching CV/OCR/AI/image-byte analysis or mutating
  // engineering truth from raw uploads. File-present ingests therefore stop
  // after persistence; downstream engineering must use canonical manifests and
  // explicit provenance-aware evaluation paths.
  if (transformOutput.files.length > 0) {
    log(`STEP_G vision/CV pipeline disabled by canonical survey evidence boundary files=${transformOutput.files.length}`);
  } else {
    log(`STEP_G no files ingested; no vision/CV pipeline available`);
  }

  // ── Write micro stage: survey_submitted (critical — awaited, retries once internally) ───
  await writeMicroStage(projectId, 'survey_submitted', ownerId ?? null, {
    survey_id: event.survey_id,
    event_id: event.event_id,
    deliveryId,
    created,
  });

  return {
    status: 'ingested',
    projectId,
    created,
    transformSummary,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// _resolveExistingProjectId — Priority A/B/C DB lookup.
//
// v47.440: Surveys MUST attach to existing projects. Auto-create is BANNED.
//
// Priority order (strict):
//   A) action='attach' — direct UUID from resolver. Verify exists in DB for ownerId.
//   B) action='resolve_existing' — look up by survey_external_id column.
//      This catches re-deliveries of surveys already linked to a project.
//   C) action='resolve_existing' — look up by client_id + normalized address.
//      Used when the field worker selected a client on-device (no project UUID).
//
// Returns:
//   { projectId: string, method }  — resolved OK
//   { projectId: null, reason }    — could not resolve; caller must STOP ingest
// ---------------------------------------------------------------------------
async function _resolveExistingProjectId(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  ownerId: string,
  linkResolution: LinkResolution,
  context: IngestContext,
  transformOutput: TransformOutput,
  traceId: string,
): Promise<
  | { projectId: string; method: 'direct_id' | 'selected_project' | 'survey_external_id' | 'client_address'; reason?: never }
  | { projectId: null; method?: never; reason: string }
> {
  const surveyId = context.event.survey_id;

  // ── Priority A: direct UUID (attach action) ───────────────────────────────
  if (linkResolution.action === 'attach') {
    const { projectId, method } = linkResolution;
    // Verify the project exists for this owner and is not deleted
    try {
      const rows = await sql`
        SELECT id FROM projects
        WHERE id = ${projectId}
          AND user_id = ${ownerId}
          AND deleted_at IS NULL
        LIMIT 1
      `;
      if (rows.length > 0) {
        console.log(
          `[ingestPipeline] _resolveExistingProjectId: Priority A OK ` +
          `method=${method} projectId=${projectId} traceId=${traceId}`,
        );
        return { projectId, method };
      }
      return {
        projectId: null,
        reason:
          `Priority A (${method}): project ${projectId} not found for ` +
          `owner=${ownerId} or has been deleted. survey_id=${surveyId}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        projectId: null,
        reason: `Priority A (${method}): DB lookup failed: ${msg}`,
      };
    }
  }

  // ── Priority B: look up by survey_external_id ─────────────────────────────
  // For resolve_existing action: the survey_id may already be linked to a
  // project via the survey_external_id column (idempotent re-delivery).
  try {
    const rows = await sql`
      SELECT id FROM projects
      WHERE survey_external_id = ${surveyId}
        AND user_id = ${ownerId}
        AND deleted_at IS NULL
      LIMIT 2
    `;
    if (rows.length === 1) {
      const projectId = rows[0].id as string;
      console.log(
        `[ingestPipeline] _resolveExistingProjectId: Priority B OK ` +
        `method=survey_external_id projectId=${projectId} traceId=${traceId}`,
      );
      return { projectId, method: 'survey_external_id' };
    }
    if (rows.length > 1) {
      return {
        projectId: null,
        reason:
          `Priority B: multiple projects found for survey_external_id=${surveyId} ` +
          `owner=${ownerId} — ambiguous, cannot auto-attach`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ingestPipeline] _resolveExistingProjectId: Priority B DB error (continuing to C): ${msg}`,
    );
  }

  // ── Priority C: look up by client_id + normalized address ─────────────────
  const clientId = linkResolution.action === 'resolve_existing'
    ? linkResolution.clientId
    : null;
  const address = transformOutput.address?.trim() ?? null;

  if (clientId && isValidUUID(clientId) && address) {
    try {
      const rows = await sql`
        SELECT id FROM projects
        WHERE client_id = ${clientId}
          AND user_id   = ${ownerId}
          AND LOWER(TRIM(address)) = LOWER(TRIM(${address}))
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 2
      `;
      if (rows.length === 1) {
        const projectId = rows[0].id as string;
        console.log(
          `[ingestPipeline] _resolveExistingProjectId: Priority C OK ` +
          `method=client_address projectId=${projectId} clientId=${clientId} traceId=${traceId}`,
        );
        return { projectId, method: 'client_address' };
      }
      if (rows.length > 1) {
        return {
          projectId: null,
          reason:
            `Priority C: multiple projects found for clientId=${clientId} ` +
            `address="${address}" owner=${ownerId} — ambiguous, cannot auto-attach`,
        };
      }
      return {
        projectId: null,
        reason:
          `Priority C: no project found for clientId=${clientId} ` +
          `address="${address}" owner=${ownerId}. ` +
          `Create the project in SolarPro first, then the survey will link on next delivery.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        projectId: null,
        reason: `Priority C: DB lookup failed: ${msg}`,
      };
    }
  }

  // No resolution path available
  return {
    projectId: null,
    reason:
      `No project resolution path available for survey_id=${surveyId}. ` +
      `No direct project UUID (Priority A), no survey_external_id match (Priority B), ` +
      `and no client+address hint (Priority C). ` +
      `Assign the project in SolarPro and re-deliver.`,
  };
}

// ---------------------------------------------------------------------------
// _attachSurveyToProject — link a survey to an existing project row.
//
// Writes survey_external_id and survey_meta onto the project row.
// Uses SET ... WHERE id = ... AND user_id = ... for safety.
// Does NOT create the project. The project must already exist.
// ---------------------------------------------------------------------------
async function _attachSurveyToProject(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  ownerId: string,
  projectId: string,
  surveyExternalId: string,
  transformOutput: TransformOutput,
): Promise<void> {
  const surveyMetaJson = JSON.stringify(transformOutput.surveyMeta);
  const rows = await sql`
    UPDATE projects
       SET survey_external_id = ${surveyExternalId},
           survey_meta        = COALESCE(survey_meta, '{}'::jsonb) || ${surveyMetaJson}::jsonb,
           updated_at         = now()
     WHERE id      = ${projectId}
       AND user_id = ${ownerId}
       AND deleted_at IS NULL
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new Error(
      `_attachSurveyToProject: project ${projectId} not found for ` +
      `owner=${ownerId} or deleted — cannot attach survey ${surveyExternalId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// _upsertPhysicalData - INSERT or UPDATE project_physical_data for a project.
//
// Uses ON CONFLICT (project_id) DO UPDATE so re-deliveries and replays are
// idempotent. A re-submitted survey always overwrites with the latest data.
//
// siteSurveyId: the site_surveys.id UUID created in Step E2. Written to
//   source_survey_id so engineering can trace which survey populated this row.
//   Pass null on the initial write (E step) — the backfill is done in E2 after
//   the site_surveys row is created.
//
// Engineering reads this table at report generation time. If this write
// fails, the engineering engine falls back to hardcoded defaults — which is
// survivable but sub-optimal. The failure is logged for ops replay.
// ---------------------------------------------------------------------------
async function _upsertPhysicalData(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  projectId: string,
  transformOutput: TransformOutput,
  siteSurveyId: string | null,
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
      setback_notes,
      inspector_name,
      surveyed_at,
      access_notes,
      mounting_notes,
      electrical_notes,
      structure_type,
      stories,
      source_survey_id
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
      ${d.setback_notes},
      ${d.inspector_name},
      ${d.surveyed_at ? new Date(d.surveyed_at).toISOString() : null},
      ${d.access_notes},
      ${d.mounting_notes},
      ${d.electrical_notes},
      ${d.structure_type},
      ${d.stories},
      ${siteSurveyId}
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
      setback_notes           = EXCLUDED.setback_notes,
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
// _resolveClientIdForSurvey — find the client_id for the site_surveys row.
//
// Priority:
//   1. context.selectedClientId (on-device picker selected a client)
//   2. resolve_existing hint: clientId from linkResolution (on-device client pick)
//   3. Look up client_id from the resolved project row (most reliable —
//      the project always exists at this point in the pipeline).
//   4. Find any existing client for this user keyed on survey address
//   5. Auto-create a client record from survey address/name so photos
//      always land in site_survey_files and appear in the UI.
//
// projectId: the UUID returned by _resolveExistingProjectId() — primary lookup.
// ---------------------------------------------------------------------------
async function _resolveClientIdForSurvey(
  sql: Awaited<ReturnType<typeof getDbReady>>,
  ownerId: string,
  linkResolution: LinkResolution,
  context: IngestContext,
  projectId: string,
  transformOutput: TransformOutput,
): Promise<string | null> {
  // Priority 1: explicit client selection from on-device picker
  if (context.selectedClientId && isValidUUID(context.selectedClientId)) {
    return context.selectedClientId;
  }

  // Priority 2: resolve_existing hint — field worker picked a client on-device
  if (
    linkResolution.action === 'resolve_existing' &&
    linkResolution.clientId &&
    isValidUUID(linkResolution.clientId)
  ) {
    return linkResolution.clientId;
  }

  // Priority 3: look up client_id from the resolved project row.
  // The project is guaranteed to exist at this point.
  if (isValidUUID(projectId)) {
    try {
      const rows = await sql`
        SELECT client_id FROM projects
        WHERE id = ${projectId} AND user_id = ${ownerId} AND deleted_at IS NULL
        LIMIT 1
      `;
      const clientId = (rows[0] as Record<string, unknown> | undefined)?.client_id as string | null;
      if (clientId && isValidUUID(clientId)) return clientId;
    } catch {
      // fall through to address-based fallback
    }
  }

  // Priority 4 & 5: Survey-origin projects frequently have no client_id because
  // they were created from the field without a prior SolarPro client record.
  // We still need a client_id to satisfy the site_surveys NOT NULL constraint
  // so that photos land in site_survey_files and appear in the project UI.
  //
  // Strategy: upsert a client record keyed on (user_id, address) so that
  // repeated ingest of the same site converges on the same client row.
  try {
    const surveyName    = transformOutput.projectName ?? 'Survey Client';
    const surveyAddress = transformOutput.address ?? '';

    // Priority 4: Look for an existing client with the same address under this user.
    // Prevents duplicate clients on re-delivery / replay.
    if (surveyAddress) {
      const existing = await sql`
        SELECT id FROM clients
        WHERE user_id = ${ownerId}
          AND LOWER(TRIM(address)) = LOWER(TRIM(${surveyAddress}))
        LIMIT 1
      `;
      const existingId = (existing[0] as Record<string, unknown> | undefined)?.id as string | null;
      if (existingId && isValidUUID(existingId)) {
        console.log(
          `[ingestPipeline] _resolveClientIdForSurvey: found existing client by address ` +
          `clientId=${existingId} address="${surveyAddress}"`,
        );
        // Backfill the project client_id so future lookups hit Priority 3.
        await sql`
          UPDATE projects SET client_id = ${existingId}, updated_at = now()
          WHERE id = ${projectId} AND user_id = ${ownerId} AND client_id IS NULL
        `;
        return existingId;
      }
    }

    // Priority 5: No existing client found — create one from the survey data.
    // Use a placeholder email derived from the survey external_id so it
    // is unique; the user can update the client record later in the UI.
    const placeholderEmail = `survey-${context.event.survey_id.slice(0, 8)}@survey.local`;

    // The clients table has no unique constraint, so the ON CONFLICT below never
    // matches and would insert a fresh duplicate on every re-delivery/replay of
    // a survey that carries no address (the address dedupe above is skipped).
    // The placeholder email is deterministic per survey, so look it up first to
    // converge idempotently.
    const existingByEmail = await sql`
      SELECT id FROM clients
      WHERE user_id = ${ownerId} AND LOWER(email) = LOWER(${placeholderEmail})
      LIMIT 1
    `;
    const existingByEmailId = (existingByEmail[0] as Record<string, unknown> | undefined)?.id as string | null;
    if (existingByEmailId && isValidUUID(existingByEmailId)) {
      console.log(
        `[ingestPipeline] _resolveClientIdForSurvey: found existing client by placeholder email ` +
        `clientId=${existingByEmailId} email="${placeholderEmail}"`,
      );
      await sql`
        UPDATE projects SET client_id = ${existingByEmailId}, updated_at = now()
        WHERE id = ${projectId} AND user_id = ${ownerId} AND client_id IS NULL
      `;
      return existingByEmailId;
    }

    const inserted = await sql`
      INSERT INTO clients (user_id, name, email, address, lat, lng)
      VALUES (
        ${ownerId},
        ${surveyName},
        ${placeholderEmail},
        ${surveyAddress},
        ${transformOutput.lat ?? null},
        ${transformOutput.lng ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const newClientId = (inserted[0] as Record<string, unknown> | undefined)?.id as string | null;

    if (newClientId && isValidUUID(newClientId)) {
      console.log(
        `[ingestPipeline] _resolveClientIdForSurvey: auto-created client ` +
        `clientId=${newClientId} name="${surveyName}" address="${surveyAddress}"`,
      );
      // Backfill the project client_id so the project page shows the client.
      await sql`
        UPDATE projects SET client_id = ${newClientId}, updated_at = now()
        WHERE id = ${projectId} AND user_id = ${ownerId} AND client_id IS NULL
      `;
      return newClientId;
    }
  } catch (clientErr) {
    const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
    console.warn(
      `[ingestPipeline] _resolveClientIdForSurvey: auto-client upsert failed (non-fatal): ${msg}`,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// _guessPhotoLabel — infer a display label from a photo filename/URL.
// Returns one of: 'roof' | 'panel' | 'meter' | 'attic' | 'exterior' | null
// ---------------------------------------------------------------------------
function _guessPhotoLabel(nameOrUrl: string | null | undefined): string | null {
  if (!nameOrUrl) return null;
  const n = nameOrUrl.toLowerCase();
  if (n.includes('roof') || n.includes('shingle') || n.includes('tile')) return 'roof';
  if (n.includes('panel') || n.includes('electrical') || n.includes('breaker')) return 'panel';
  if (n.includes('meter')) return 'meter';
  if (n.includes('attic') || n.includes('rafter') || n.includes('joist')) return 'attic';
  if (n.includes('exterior') || n.includes('front') || n.includes('side') || n.includes('back')) return 'exterior';
  if (n.includes('utility') || n.includes('service')) return 'utility';
  return null;
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
