// ============================================================================
// lib/siteSurveys/unifiedGeometry/promotionStore.ts
//
// Promotion Store — persistence layer for promotion records and authority
// transition history.
//
// This module stores GeometryPromotionRecord entries in the database and
// provides query functions for audit trail retrieval.
//
// NEON DRIVER QUIRKS:
//   - Must use RETURNING on all UPDATE queries
//   - TEXT[] columns receive JS arrays directly, NOT JSON.stringify'd arrays
//
// DB CONNECTION: getDbReady() from @/lib/db/core
// AUTH: getUserFromRequest(req) from @/lib/auth
// ============================================================================

import { getDbReady } from '@/lib/db/core';
import type { GeometryPromotionRecord } from './types';
import type { UnifiedGeometryAuthorityState } from './authority';

// ─── DB Row Type ────────────────────────────────────────────────────────────

interface PromotionRecordRow {
  id: string;
  artifact_id: string;
  survey_id: string;
  from_state: string;
  to_state: string;
  promoted_by: string;
  promoted_at: string;
  notes: string | null;
  intelligence_validated: boolean;
  intelligence_warnings: unknown; // TEXT[] — JS array, not JSON.stringify'd
}

// ─── Insert ──────────────────────────────────────────────────────────────────

/**
 * Persist a promotion record to the database.
 * Called after every successful promotion action.
 */
export async function insertPromotionRecord(
  record: GeometryPromotionRecord,
  surveyId: string,
): Promise<void> {
  const sql = await getDbReady();

  await sql`
    INSERT INTO geometry_promotion_records (
      id,
      artifact_id,
      survey_id,
      from_state,
      to_state,
      promoted_by,
      promoted_at,
      notes,
      intelligence_validated,
      intelligence_warnings
    ) VALUES (
      ${record.id},
      ${record.artifactId},
      ${surveyId},
      ${record.fromState},
      ${record.toState},
      ${record.promotedBy},
      ${record.promotedAt},
      ${record.notes},
      ${record.intelligenceValidated},
      ${record.intelligenceWarnings}
    )
  `;
}

// ─── Batch Insert ───────────────────────────────────────────────────────────

/**
 * Persist multiple promotion records in a single transaction.
 * All inserts succeed or all roll back — no partial writes.
 *
 * NEON TRANSACTION API:
 *   sql.transaction(txn => [ ...queries ]) submits all queries as a single
 *   non-interactive HTTP transaction. The callback must be SYNCHRONOUS —
 *   it returns an array of query promises; no await inside.
 *   All queries are batched into one Postgres transaction behind the scenes.
 */
export async function insertPromotionRecords(
  records: GeometryPromotionRecord[],
  surveyId: string,
): Promise<void> {
  const sql = await getDbReady();

  await sql.transaction(txn => {
    return records.map(record =>
      txn`
        INSERT INTO geometry_promotion_records (
          id,
          artifact_id,
          survey_id,
          from_state,
          to_state,
          promoted_by,
          promoted_at,
          notes,
          intelligence_validated,
          intelligence_warnings
        ) VALUES (
          ${record.id},
          ${record.artifactId},
          ${surveyId},
          ${record.fromState},
          ${record.toState},
          ${record.promotedBy},
          ${record.promotedAt},
          ${record.notes},
          ${record.intelligenceValidated},
          ${record.intelligenceWarnings}
        )
      `
    );
  });
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Get the full promotion history for an artifact.
 * Returns records ordered by promoted_at ascending (chronological).
 */
export async function getPromotionHistoryForArtifact(
  artifactId: string,
): Promise<GeometryPromotionRecord[]> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, artifact_id, survey_id, from_state, to_state,
           promoted_by, promoted_at, notes,
           intelligence_validated, intelligence_warnings
    FROM geometry_promotion_records
    WHERE artifact_id = ${artifactId}
    ORDER BY promoted_at ASC
  `;

  return rows.map(rowToRecord);
}

/**
 * Get all promotion records for a survey.
 * Returns records ordered by promoted_at descending (most recent first).
 */
export async function getPromotionRecordsForSurvey(
  surveyId: string,
): Promise<GeometryPromotionRecord[]> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, artifact_id, survey_id, from_state, to_state,
           promoted_by, promoted_at, notes,
           intelligence_validated, intelligence_warnings
    FROM geometry_promotion_records
    WHERE survey_id = ${surveyId}
    ORDER BY promoted_at DESC
  `;

  return rows.map(rowToRecord);
}

/**
 * Get all promotion records by a specific user.
 */
export async function getPromotionRecordsByUser(
  userId: string,
  limit: number = 100,
): Promise<GeometryPromotionRecord[]> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT id, artifact_id, survey_id, from_state, to_state,
           promoted_by, promoted_at, notes,
           intelligence_validated, intelligence_warnings
    FROM geometry_promotion_records
    WHERE promoted_by = ${userId}
    ORDER BY promoted_at DESC
    LIMIT ${limit}
  `;

  return rows.map(rowToRecord);
}

/**
 * Get the promotion count by target state for a survey.
 * Useful for dashboards and audit summaries.
 */
export async function getPromotionCountsByState(
  surveyId: string,
): Promise<Record<UnifiedGeometryAuthorityState, number>> {
  const sql = await getDbReady();

  const rows = await sql`
    SELECT to_state, COUNT(*) as count
    FROM geometry_promotion_records
    WHERE survey_id = ${surveyId}
    GROUP BY to_state
  `;

  const counts: Record<string, number> = {
    raw_evidence: 0,
    derived_review_only: 0,
    reviewed_candidate: 0,
    promoted_canonical: 0,
    cad_safe: 0,
  };

  for (const row of rows as any[]) {
    counts[row.to_state] = Number(row.count);
  }

  return counts as Record<UnifiedGeometryAuthorityState, number>;
}

// ─── Row → Record Conversion ────────────────────────────────────────────────

function rowToRecord(row: PromotionRecordRow): GeometryPromotionRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    fromState: row.from_state as UnifiedGeometryAuthorityState,
    toState: row.to_state as UnifiedGeometryAuthorityState,
    promotedBy: row.promoted_by,
    promotedAt: row.promoted_at,
    notes: row.notes,
    intelligenceValidated: row.intelligence_validated,
    intelligenceWarnings: Array.isArray(row.intelligence_warnings)
      ? row.intelligence_warnings as string[]
      : [],
  };
}
