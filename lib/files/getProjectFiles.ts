// ============================================================================
// lib/files/getProjectFiles.ts — Project Files Query (Read-Only)
//
// PURPOSE:
//   Fetches photo files from the project_files table for a given projectId
//   and normalizes them into the Photo shape consumed by the SiteSurvey
//   pipeline. This is the ONLY entry point for project_files → SiteSurvey.
//
// CONTRACTS:
//   - NEVER throws — all errors are caught and logged; returns [] on any failure
//   - NEVER writes to DB — SELECT only
//   - NEVER called from CAD, proposal, or permit paths — SiteSurvey only
//   - Returns Photo[] — url, category, metadata, createdAt
//   - Only returns rows with a non-null url and status != 'failed'
//   - Category is inferred from the file name prefix (e.g. "roof-1.jpg" → "roof")
//   - metadata carries raw DB fields for downstream traceability
//
// PIPELINE POSITION:
//   project_files (DB)
//     → getProjectFiles(projectId)   ← YOU ARE HERE
//     → fromPhysicalData()
//     → normalizeSurvey()
//     → enrichSurvey()
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

// ── Photo type ────────────────────────────────────────────────────────────────

/**
 * Photo — normalized shape of a project_files row for use in the
 * SiteSurvey pipeline. Intentionally minimal — only what the pipeline needs.
 */
export interface Photo {
  /** Absolute URL or relative path to the photo. */
  url: string;
  /**
   * Category inferred from the file name prefix.
   * Matches SurveyPhotoRef.category: 'roof' | 'panel' | 'meter' | 'obstruction' | 'site' | 'other'
   */
  category: 'roof' | 'panel' | 'meter' | 'obstruction' | 'site' | 'other';
  /**
   * Raw DB metadata for traceability. Safe to pass downstream — no PII, no secrets.
   * Includes: id, name, file_type, status, external_id, notes.
   */
  metadata: Record<string, unknown>;
  /** ISO timestamp from project_files.created_at */
  createdAt: string;
}

// ── Category inference ────────────────────────────────────────────────────────

const CATEGORY_PREFIXES: Array<[string, Photo['category']]> = [
  ['roof',        'roof'],
  ['panel',       'panel'],
  ['meter',       'meter'],
  ['obstruction', 'obstruction'],
  ['site',        'site'],
];

/**
 * inferCategory — maps a file name to a Photo category.
 * Uses prefix matching on the lowercase filename.
 * Falls back to 'other' if no prefix matches.
 */
function inferCategory(fileName: string): Photo['category'] {
  const lower = (fileName ?? '').toLowerCase();
  for (const [prefix, cat] of CATEGORY_PREFIXES) {
    if (lower.startsWith(prefix)) return cat;
  }
  return 'other';
}

// ── Row shape returned by DB query ────────────────────────────────────────────

interface ProjectFileRow {
  id: string;
  url: string | null;
  name: string;
  file_type: string | null;
  notes: string | null;
  status: string | null;
  external_id: string | null;
  created_at: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * getProjectFiles — fetches and normalizes project_files rows for a project.
 *
 * Read-only. Never throws. Returns [] on any DB error.
 *
 * Only returns rows where:
 *   - url IS NOT NULL (no URL = nothing to attach)
 *   - status != 'failed' (failed fetch = unusable)
 *
 * @param projectId  UUID of the project to fetch files for
 * @returns          Normalized Photo[] sorted by created_at ASC
 */
export async function getProjectFiles(projectId: string): Promise<Photo[]> {
  if (!projectId) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[getProjectFiles] Called with empty projectId — returning []');
    }
    return [];
  }

  try {
    const sql = await getDbReady();

    const rows = (await sql`
      SELECT
        id,
        url,
        name,
        file_type,
        notes,
        status,
        external_id,
        created_at::text AS created_at
      FROM project_files
      WHERE
        project_id   = ${projectId}
        AND url      IS NOT NULL
        AND status   != 'failed'
      ORDER BY created_at ASC
    `) as ProjectFileRow[];

    const photos: Photo[] = rows.map((row) => ({
      url:       row.url as string,
      category:  inferCategory(row.name),
      createdAt: row.created_at,
      metadata: {
        id:          row.id,
        name:        row.name,
        file_type:   row.file_type,
        status:      row.status,
        external_id: row.external_id,
        notes:       row.notes,
      },
    }));

    if (process.env.NODE_ENV === 'development' && photos.length > 0) {
      const counts = photos.reduce<Record<string, number>>((acc, p) => {
        acc[p.category] = (acc[p.category] ?? 0) + 1;
        return acc;
      }, {});
      console.debug(
        `[getProjectFiles] project=${projectId} total=${photos.length}`,
        counts,
      );
    }

    return photos;
  } catch (err) {
    // Never throw — log and return empty
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[getProjectFiles] WARN: DB query failed for project=${projectId}: ${msg}`);
    return [];
  }
}