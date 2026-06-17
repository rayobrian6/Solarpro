/**
 * lib/db/surveys.ts
 * Site survey DB operations — extracted from lib/db-neon.ts.
 */

import { getDbReady, isValidUUID, assertUUID } from './core';

export interface SiteSurvey {
  id: string;
  clientId: string;
  projectId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'completed' | 'reviewed';
  source: 'project_handoff' | 'standalone';
  addressSnapshot: string | null;
  surveyData: Record<string, unknown> | null;
  inspectorName: string | null;
  notes: string | null;
  externalSurveyId: string | null;
  deliveryId: string | null;
  // joined fields (optional, populated by detail queries)
  clientName?: string;
  projectName?: string;
  fileCount?: number;
}

export interface SiteSurveyFile {
  id: string;
  surveyId: string;
  fileUrl: string;
  fileType: 'photo' | 'document';
  label: string | null;
  filename: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface SiteSurveyFileLabelRowMatchDiagnostic {
  fileId: string;
  requestedSurveyId: string;
  requestedUserId: string;
  fileRowExists: boolean;
  fileBelongsToRequestedSurvey: boolean;
  linkedSurveyRowExists: boolean;
  linkedClientRowExists: boolean;
  clientBelongsToAuthenticatedUser: boolean;
  updatePredicateWouldMatch: boolean;
  actualSurveyId: string | null;
  linkedClientId: string | null;
  linkedClientUserId: string | null;
  currentLabel: string | null;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------
function rowToSiteSurvey(row: Record<string, unknown>): SiteSurvey {
  return {
    id:               row.id as string,
    clientId:         row.client_id as string,
    projectId:        (row.project_id as string | null) ?? null,
    createdBy:        row.created_by as string,
    createdAt:        row.created_at as string,
    updatedAt:        row.updated_at as string,
    status:           row.status as SiteSurvey['status'],
    source:           row.source as SiteSurvey['source'],
    addressSnapshot:  (row.address_snapshot as string | null) ?? null,
    surveyData:       (row.survey_data as Record<string, unknown> | null) ?? null,
    inspectorName:    (row.inspector_name as string | null) ?? null,
    notes:            (row.notes as string | null) ?? null,
    externalSurveyId: (row.external_survey_id as string | null) ?? null,
    deliveryId:       (row.delivery_id as string | null) ?? null,
    clientName:       (row.client_name as string | undefined) ?? undefined,
    projectName:      (row.project_name as string | undefined) ?? undefined,
    fileCount:        row.file_count !== undefined ? Number(row.file_count) : undefined,
  };
}

function rowToSiteSurveyFile(row: Record<string, unknown>): SiteSurveyFile {
  return {
    id:        row.id as string,
    surveyId:  row.survey_id as string,
    fileUrl:   row.file_url as string,
    fileType:  row.file_type as SiteSurveyFile['fileType'],
    label:     (row.label as string | null) ?? null,
    filename:  (row.filename as string | null) ?? null,
    mimeType:  (row.mime_type as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// getSiteSurveysByProject
// ---------------------------------------------------------------------------
export async function getSiteSurveysByProject(
  projectId: string,
  userId: string,
): Promise<SiteSurvey[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  const sql = await getDbReady();
  const rows = await sql`
    SELECT
      ss.*,
      c.name  AS client_name,
      COUNT(ssf.id)::int AS file_count
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
    LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
    WHERE ss.project_id = ${projectId}
    GROUP BY ss.id, c.name
    ORDER BY ss.created_at DESC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurvey);
}

// ---------------------------------------------------------------------------
// getSiteSurveysByClient
// ---------------------------------------------------------------------------
export async function getSiteSurveysByClient(
  clientId: string,
  userId: string,
): Promise<SiteSurvey[]> {
  if (!isValidUUID(clientId) || !isValidUUID(userId)) return [];
  const sql = await getDbReady();
  const rows = await sql`
    SELECT
      ss.*,
      c.name  AS client_name,
      p.name  AS project_name,
      COUNT(ssf.id)::int AS file_count
    FROM site_surveys ss
    JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId} AND c.id = ${clientId}
    LEFT JOIN projects p ON p.id = ss.project_id
    LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
    GROUP BY ss.id, c.name, p.name
    ORDER BY ss.created_at DESC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurvey);
}

// ---------------------------------------------------------------------------
// getSiteSurveyById
// ---------------------------------------------------------------------------
export interface GetSiteSurveyByIdOptions {
  /** When true, skip the client.user_id ownership check.
   *  Used by dev auth bypass (dev-user-bypass-001) so the dev user can
   *  access any survey without needing to be the owner.
   *  Callers MUST verify the requesting user is a dev/admin before setting
   *  this flag — the function itself does not re-check. */
  bypassOwnershipCheck?: boolean;
}

export async function getSiteSurveyById(
  surveyId: string,
  userId: string,
  options?: GetSiteSurveyByIdOptions,
): Promise<SiteSurvey | null> {
  if (!isValidUUID(surveyId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();

  const rows = options?.bypassOwnershipCheck
    ? await sql`
        SELECT
          ss.*,
          c.name AS client_name,
          p.name AS project_name,
          COUNT(ssf.id)::int AS file_count
        FROM site_surveys ss
        JOIN clients c ON c.id = ss.client_id
        LEFT JOIN projects p ON p.id = ss.project_id
        LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
        WHERE ss.id = ${surveyId}
        GROUP BY ss.id, c.name, p.name
        LIMIT 1
      `
    : await sql`
        SELECT
          ss.*,
          c.name AS client_name,
          p.name AS project_name,
          COUNT(ssf.id)::int AS file_count
        FROM site_surveys ss
        JOIN clients c ON c.id = ss.client_id AND c.user_id = ${userId}
        LEFT JOIN projects p ON p.id = ss.project_id
        LEFT JOIN site_survey_files ssf ON ssf.survey_id = ss.id
        WHERE ss.id = ${surveyId}
        GROUP BY ss.id, c.name, p.name
        LIMIT 1
      `;

  if (!rows.length) return null;
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// createSiteSurvey
// ---------------------------------------------------------------------------
export async function createSiteSurvey(data: {
  clientId: string;
  projectId?: string | null;
  createdBy: string;
  status?: SiteSurvey['status'];
  source: SiteSurvey['source'];
  addressSnapshot?: string | null;
  surveyData?: Record<string, unknown> | null;
  inspectorName?: string | null;
  notes?: string | null;
  externalSurveyId?: string | null;
  deliveryId?: string | null;
}): Promise<SiteSurvey> {
  const sql = await getDbReady();
  const rows = await sql`
    INSERT INTO site_surveys (
      client_id, project_id, created_by,
      status, source,
      address_snapshot, survey_data,
      inspector_name, notes,
      external_survey_id, delivery_id
    ) VALUES (
      ${data.clientId},
      ${data.projectId ?? null},
      ${data.createdBy},
      ${data.status ?? 'completed'},
      ${data.source},
      ${data.addressSnapshot ?? null},
      ${data.surveyData ? JSON.stringify(data.surveyData) : null},
      ${data.inspectorName ?? null},
      ${data.notes ?? null},
      ${data.externalSurveyId ?? null},
      ${data.deliveryId ?? null}
    )
    ON CONFLICT (external_survey_id)
    DO UPDATE SET
      -- Idempotent re-delivery: update mutable fields but keep id/created_at stable.
      -- This ensures force-ingest + backfill can safely re-run without duplicates.
      -- project_id and client_id are updated so replays can fix surveys that
      -- initially landed under the wrong project (e.g. first delivery had no
      -- solarpro_project_id claim; a replay after the column was populated will
      -- now correctly re-link the survey to the right project).
      status           = EXCLUDED.status,
      project_id       = COALESCE(EXCLUDED.project_id, site_surveys.project_id),
      client_id        = COALESCE(EXCLUDED.client_id, site_surveys.client_id),
      address_snapshot = COALESCE(EXCLUDED.address_snapshot, site_surveys.address_snapshot),
      survey_data      = COALESCE(EXCLUDED.survey_data, site_surveys.survey_data),
      inspector_name   = COALESCE(EXCLUDED.inspector_name, site_surveys.inspector_name),
      delivery_id      = COALESCE(EXCLUDED.delivery_id, site_surveys.delivery_id),
      updated_at       = NOW()
    RETURNING *
  `;
  if (!rows.length) {
    // Fallback: fetch by external_survey_id (should not happen after ON CONFLICT DO UPDATE)
    const existing = await sql`
      SELECT * FROM site_surveys
      WHERE external_survey_id = ${data.externalSurveyId ?? ''}
      LIMIT 1
    `;
    if (existing.length) return rowToSiteSurvey(existing[0] as Record<string, unknown>);
    // Last resort: fetch by project_id
    const byProject = await sql`
      SELECT * FROM site_surveys
      WHERE project_id = ${data.projectId ?? ''}
      LIMIT 1
    `;
    if (!byProject.length) {
      throw new Error('createSiteSurvey: could not locate or create survey');
    }
    return rowToSiteSurvey(byProject[0] as Record<string, unknown>);
  }
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// updateSiteSurvey
// ---------------------------------------------------------------------------
export async function updateSiteSurvey(
  surveyId: string,
  userId: string,
  updates: Partial<Pick<SiteSurvey,
    'projectId' | 'status' | 'addressSnapshot' | 'surveyData' | 'notes' | 'inspectorName'
  >>,
): Promise<SiteSurvey | null> {
  const sql = await getDbReady();
  // Security: verify ownership via client join
  const rows = await sql`
    UPDATE site_surveys ss
    SET
      project_id       = COALESCE(${updates.projectId ?? null}, ss.project_id),
      status           = COALESCE(${updates.status ?? null}::site_survey_status, ss.status),
      address_snapshot = COALESCE(${updates.addressSnapshot ?? null}, ss.address_snapshot),
      survey_data      = COALESCE(${updates.surveyData ? JSON.stringify(updates.surveyData) : null}::jsonb, ss.survey_data),
      notes            = COALESCE(${updates.notes ?? null}, ss.notes),
      inspector_name   = COALESCE(${updates.inspectorName ?? null}, ss.inspector_name),
      updated_at       = NOW()
    FROM clients c
    WHERE ss.id = ${surveyId}
      AND ss.client_id = c.id
      AND c.user_id = ${userId}
    RETURNING ss.*
  `;
  if (!rows.length) return null;
  return rowToSiteSurvey(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// getSiteSurveyFiles
// ---------------------------------------------------------------------------
export async function getSiteSurveyFiles(surveyId: string): Promise<SiteSurveyFile[]> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM site_survey_files
    WHERE survey_id = ${surveyId}
    ORDER BY label NULLS LAST, created_at ASC
  `;
  return (rows as Record<string, unknown>[]).map(rowToSiteSurveyFile);
}

// ---------------------------------------------------------------------------
// addSiteSurveyFile
// ---------------------------------------------------------------------------
export async function addSiteSurveyFile(data: {
  surveyId: string;
  fileUrl: string;
  fileType?: SiteSurveyFile['fileType'];
  label?: string | null;
  filename?: string | null;
  mimeType?: string | null;
}): Promise<SiteSurveyFile> {
  const sql = await getDbReady();
  const rows = await sql`
    INSERT INTO site_survey_files (
      survey_id, file_url, file_type, label, filename, mime_type
    ) VALUES (
      ${data.surveyId},
      ${data.fileUrl},
      ${data.fileType ?? 'photo'},
      ${data.label ?? null},
      ${data.filename ?? null},
      ${data.mimeType ?? null}
    )
    RETURNING *
  `;
  return rowToSiteSurveyFile(rows[0] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// bulkAddSiteSurveyFiles — for ingest pipeline (batch insert)
// ---------------------------------------------------------------------------
export async function bulkAddSiteSurveyFiles(
  files: Array<{
    surveyId: string;
    fileUrl: string;
    fileType?: SiteSurveyFile['fileType'];
    label?: string | null;
    filename?: string | null;
    mimeType?: string | null;
  }>,
): Promise<number> {
  if (!files.length) return 0;
  const sql = await getDbReady();
  let inserted = 0;
  for (const f of files) {
    const rows = await sql`
      INSERT INTO site_survey_files (survey_id, file_url, file_type, label, filename, mime_type)
      VALUES (
        ${f.surveyId}, ${f.fileUrl},
        ${f.fileType ?? 'photo'},
        ${f.label ?? null}, ${f.filename ?? null}, ${f.mimeType ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    // Count only rows actually inserted — ON CONFLICT skips were being counted,
    // so re-deliveries reported files as newly added when zero were.
    inserted += rows.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// updateSiteSurveyFileLabels — apply operator-reviewed photo evidence labels
//
// Options:
//   skipOwnerCheck — when true, omits the c.user_id ownership JOIN condition.
//     Used by system auto-classifiers (e.g. OpenAI Vision) that are already
//     gated by the pipeline and don't have a UUID in the clients table.
//     The caller should pass a descriptive source identifier as `userId`
//     for audit logging purposes only.
// ---------------------------------------------------------------------------
export async function updateSiteSurveyFileLabels(
  surveyId: string,
  userId: string,
  updates: Array<{ fileId: string; label: string | null }>,
  options?: { skipOwnerCheck?: boolean },
): Promise<SiteSurveyFile[]> {
  if (!updates.length) return [];
  const sql = await getDbReady();
  const results: SiteSurveyFile[] = [];

  const skipOwnerCheck = options?.skipOwnerCheck ?? false;

  if (skipOwnerCheck) {
    // System auto-classifier path: no ownership check (the pipeline already
    // gate-keeps access), but we still verify the file belongs to the survey.
    console.log(`[updateSiteSurveyFileLabels] skipOwnerCheck=true, source=${userId}, surveyId=${surveyId}, updates=${updates.length}`);
    for (const update of updates) {
      const rows = await sql`
        UPDATE site_survey_files ssf
        SET label = ${update.label ?? null}
        WHERE ssf.id = ${update.fileId}
          AND ssf.survey_id = ${surveyId}
        RETURNING ssf.*
      `;
      if (rows.length) results.push(rowToSiteSurveyFile(rows[0] as Record<string, unknown>));
    }
  } else {
    // Human operator path: enforce ownership via client join (existing behavior)
    for (const update of updates) {
      const rows = await sql`
        UPDATE site_survey_files ssf
        SET label = ${update.label ?? null}
        FROM site_surveys ss
        JOIN clients c ON c.id = ss.client_id
        WHERE ssf.id = ${update.fileId}
          AND ssf.survey_id = ${surveyId}
          AND ss.id = ssf.survey_id
          AND c.user_id = ${userId}
        RETURNING ssf.*
      `;
      if (rows.length) results.push(rowToSiteSurveyFile(rows[0] as Record<string, unknown>));
    }
  }

  console.log(`[updateSiteSurveyFileLabels] ${skipOwnerCheck ? 'system' : 'operator'} path: ${results.length}/${updates.length} updates applied (source=${userId})`);
  return results;
}

// ---------------------------------------------------------------------------
// diagnoseSiteSurveyFileLabelUpdateMatches — read-only predicate diagnostics
// ---------------------------------------------------------------------------
export async function diagnoseSiteSurveyFileLabelUpdateMatches(
  surveyId: string,
  userId: string,
  fileIds: string[],
): Promise<SiteSurveyFileLabelRowMatchDiagnostic[]> {
  if (!fileIds.length) return [];
  const sql = await getDbReady();
  const diagnostics: SiteSurveyFileLabelRowMatchDiagnostic[] = [];

  for (const fileId of fileIds) {
    const rows = await sql`
      SELECT
        ssf.id AS file_id,
        ssf.survey_id AS actual_survey_id,
        ssf.label AS current_label,
        ss.id AS linked_survey_id,
        ss.client_id AS linked_client_id,
        c.id AS linked_client_row_id,
        c.user_id AS linked_client_user_id
      FROM (SELECT ${fileId}::text AS requested_file_id) requested
      LEFT JOIN site_survey_files ssf ON ssf.id = requested.requested_file_id
      LEFT JOIN site_surveys ss ON ss.id = ssf.survey_id
      LEFT JOIN clients c ON c.id = ss.client_id
      LIMIT 1
    `;
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    const actualSurveyId = (row.actual_survey_id as string | null) ?? null;
    const linkedSurveyId = (row.linked_survey_id as string | null) ?? null;
    const linkedClientId = (row.linked_client_id as string | null) ?? null;
    const linkedClientRowId = (row.linked_client_row_id as string | null) ?? null;
    const linkedClientUserId = (row.linked_client_user_id as string | null) ?? null;
    const fileRowExists = typeof row.file_id === 'string';
    const fileBelongsToRequestedSurvey = actualSurveyId === surveyId;
    const linkedSurveyRowExists = linkedSurveyId === actualSurveyId && linkedSurveyId !== null;
    const linkedClientRowExists = linkedClientRowId === linkedClientId && linkedClientRowId !== null;
    const clientBelongsToAuthenticatedUser = linkedClientUserId === userId;

    diagnostics.push({
      fileId,
      requestedSurveyId: surveyId,
      requestedUserId: userId,
      fileRowExists,
      fileBelongsToRequestedSurvey,
      linkedSurveyRowExists,
      linkedClientRowExists,
      clientBelongsToAuthenticatedUser,
      updatePredicateWouldMatch:
        fileRowExists &&
        fileBelongsToRequestedSurvey &&
        linkedSurveyRowExists &&
        linkedClientRowExists &&
        clientBelongsToAuthenticatedUser,
      actualSurveyId,
      linkedClientId,
      linkedClientUserId,
      currentLabel: (row.current_label as string | null) ?? null,
    });
  }

  return diagnostics;
}

