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

  // 🚨 A SAVE THAT CHANGES NOTHING IS NOT A VERSION.
  //
  // This wrote a full-fidelity snapshot on every single call. Measured against a
  // real database: five byte-identical saves produced five snapshots. That was
  // tolerable while nobody could see the versions — the route that writes them
  // says as much, accepting the row size because "a snapshot that cannot restore
  // the design it snapshots" is worth less, and noting that the honest place to
  // bound growth is a retention policy.
  //
  // It stopped being tolerable when the design-history panel shipped. That list is
  // the documented recovery path for a LAYOUT_STALE_WRITE refusal, which discards
  // the losing tab's edit — and a list of two hundred identical entries is not a
  // way back, it is a way to pick the wrong one confidently.
  //
  // THE COMPARISON IS AGAINST THE NEWEST VERSION ONLY, and against CONTENT.
  //   • Newest only, because returning to an earlier state is a real edit: A → B →
  //     A must record three versions. A rule that compared against any existing
  //     version would silently drop the third, which is the one that says the user
  //     undid something.
  //   • THE `layout` SUBTREE ONLY, minus its own `updatedAt`. Everything outside
  //     `layout` is PROVENANCE rather than content, and the writers do not agree on
  //     it: `savedAt` is stamped by the caller and differs every call, and
  //     `restoredFromVersion` exists on the restore route's snapshot and NOT on the
  //     layout route's — so the two have DIFFERENT KEY SETS and a whole-snapshot
  //     comparison could never match across them. Measured before this was
  //     narrowed: an autosave immediately after a restore, changing nothing, wrote
  //     a second version with identical content. `layout.updatedAt` is removed too,
  //     because the row's own BEFORE UPDATE trigger re-stamps it on every write.
  //
  //     `#>` extracts a path and `#-` deletes one; jsonb equality normalises key
  //     order, so this compares meaning rather than serialisation. Arrays stay
  //     order-sensitive, which is right: reordered panels are a change.
  //
  // One statement, so the check and the insert cannot be separated by a concurrent
  // save, and no extra round trip is added to the path that does insert.
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
    WHERE NOT EXISTS (
      SELECT 1 FROM project_versions pv
      WHERE pv.project_id = ${data.projectId}
        AND pv.version_number = (
          SELECT MAX(version_number) FROM project_versions WHERE project_id = ${data.projectId}
        )
        AND ((pv.snapshot #> '{layout}') #- '{updatedAt}')
            = ((${snapshotJson}::jsonb #> '{layout}') #- '{updatedAt}')
    )
    RETURNING *
  `;

  // Nothing inserted means the newest version already says exactly this, so that
  // version IS the answer — the caller asked for the design to be recorded and it
  // is recorded. Returning it rather than throwing keeps this a no-op from every
  // caller's point of view; the layout route treats the result as fire-and-forget
  // and the restore route only needs it not to fail.
  if (rows.length === 0) {
    const existing = await sql`
      SELECT * FROM project_versions
      WHERE project_id = ${data.projectId}
      ORDER BY version_number DESC
      LIMIT 1
    `;
    if (existing.length > 0) return rowToProjectVersion(existing[0] as Record<string, unknown>);
    // No newest version and nothing inserted should be impossible — the NOT
    // EXISTS can only be false when a row is there. If it ever happens, say so
    // rather than returning a half-built object that reads as a saved version.
    throw new Error('saveProjectVersion: nothing was written and no existing version was found');
  }

  return rowToProjectVersion(rows[0] as Record<string, unknown>);
}

/** One place that shapes a row, so the insert path and the already-recorded path
 *  cannot drift into returning different objects for the same row. */
function rowToProjectVersion(row: Record<string, unknown>): ProjectVersion {
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

