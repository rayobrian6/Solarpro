/**
 * lib/db/versions.ts
 * Project version DB operations — extracted from lib/db-neon.ts.
 */

import { getDbReady, isValidUUID, assertUUID } from './core';

// PROJECT VERSIONS
// ============================================================

export interface ProjectVersion {
  id: string;
  projectId: string;
  userId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  panelsCount: number;
  systemSizeKw: number;
  changeSummary: string;
  createdAt: string;
}

export async function saveProjectVersion(data: {
  projectId: string;
  userId: string;
  snapshot: Record<string, unknown>;
  panelsCount?: number;
  systemSizeKw?: number;
  changeSummary?: string;
}): Promise<ProjectVersion> {
  assertUUID(data.projectId, 'projectId');
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();

  // PERF FIX: Compute next version number atomically inside the INSERT using a subquery.
  // Eliminates the extra SELECT round-trip that previously doubled latency on every save.
  const snapshotJson = JSON.stringify(data.snapshot);
  const rows = await sql`
    INSERT INTO project_versions (
      project_id, user_id, version_number, snapshot,
      panels_count, system_size_kw, change_summary
    )
    SELECT
      ${data.projectId},
      ${data.userId},
      COALESCE((SELECT MAX(version_number) FROM project_versions WHERE project_id = ${data.projectId}), 0) + 1,
      ${snapshotJson}::jsonb,
      ${data.panelsCount ?? 0},
      ${data.systemSizeKw ?? 0},
      ${data.changeSummary || ''}
    RETURNING *
  `;

  const row = rows[0];
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: row.snapshot as Record<string, unknown>,
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  };
}

// PERF FIX: Returns version metadata only — no snapshot JSON blob.
// The version list panel only needs id/number/summary/counts to render the list.
// Snapshot is only fetched when user actually clicks "restore" (getProjectVersion).
export async function getProjectVersions(projectId: string, userId: string): Promise<ProjectVersion[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  const sql = await getDbReady();
  const rows = await sql`
    SELECT id, project_id, user_id, version_number,
           panels_count, system_size_kw, change_summary, created_at
    FROM project_versions
    WHERE project_id = ${projectId}
      AND user_id = ${userId}
    ORDER BY version_number DESC
    LIMIT 50
  `;
  return rows.map(row => ({
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: {} as Record<string, unknown>,  // not loaded in list — fetch via getProjectVersion
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  }));
}

export async function getProjectVersion(
  projectId: string,
  versionId: string,
  userId: string
): Promise<ProjectVersion | null> {
  if (!isValidUUID(projectId) || !isValidUUID(versionId) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM project_versions
    WHERE id = ${versionId}
      AND project_id = ${projectId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    versionNumber: row.version_number as number,
    snapshot: row.snapshot as Record<string, unknown>,
    panelsCount: row.panels_count as number,
    systemSizeKw: row.system_size_kw as number,
    changeSummary: row.change_summary as string,
    createdAt: row.created_at as string,
  };
}

