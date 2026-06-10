// ============================================================================
// lib/siteSurveys/unifiedGeometry/canonicalModelStore.ts
//
// Persistence layer for the CanonicalBuildingModel (Roadmap Phase 1 — the
// survey→canonical→planset spine). Backed by the `canonical_building_model`
// table (Migration 087), one row per survey.
//
//   - writeCanonicalModel()  upserts the model for a survey (rebuild-safe).
//   - getCanonicalModel()    reads it back; returns null if absent OR if the
//                            table doesn't exist yet (migration not applied) —
//                            so callers (e.g. the permit route) fall back safely.
//   - rowToCanonicalModel()  pure row→model mapping (unit-testable, no DB).
//
// NEON DRIVER NOTES: JSONB columns return parsed objects; use RETURNING on
// upserts. The full model lives in `model` JSONB; scalar columns are
// denormalized for querying only.
// ============================================================================

import { getDbReady } from '@/lib/db/core';
import type { CanonicalBuildingModel } from './types';

/** Row shape of the canonical_building_model table. */
export interface CanonicalModelRow {
  survey_id: string;
  schema_version: string;
  authority_state: string;
  roof_plane_count: number;
  model: unknown; // JSONB → parsed CanonicalBuildingModel
  built_by: string;
  built_at: string;
  updated_at: string;
}

/**
 * Pure mapping from a DB row to a CanonicalBuildingModel. The authoritative
 * representation is the `model` JSONB; the scalar columns are denormalized
 * copies used only for querying. Exposed for unit testing without a DB.
 */
export function rowToCanonicalModel(row: CanonicalModelRow): CanonicalBuildingModel {
  return row.model as CanonicalBuildingModel;
}

/**
 * Upsert the CanonicalBuildingModel for a survey (one row per survey).
 * Rebuilding a survey's model overwrites the previous row.
 */
export async function writeCanonicalModel(model: CanonicalBuildingModel): Promise<void> {
  const sql = await getDbReady();
  const modelJson = JSON.stringify(model);

  await sql`
    INSERT INTO canonical_building_model (
      survey_id, schema_version, authority_state, roof_plane_count,
      model, built_by, built_at, updated_at
    ) VALUES (
      ${model.surveyId},
      ${model.schemaVersion},
      ${model.authority.state},
      ${model.roofPlanes.length},
      ${modelJson}::jsonb,
      ${model.provenance.builtBy},
      NOW()::timestamptz,
      NOW()::timestamptz
    )
    ON CONFLICT (survey_id) DO UPDATE SET
      schema_version   = EXCLUDED.schema_version,
      authority_state  = EXCLUDED.authority_state,
      roof_plane_count = EXCLUDED.roof_plane_count,
      model            = EXCLUDED.model,
      built_by         = EXCLUDED.built_by,
      updated_at       = NOW()::timestamptz
    RETURNING survey_id
  `;
}

/**
 * Read the persisted CanonicalBuildingModel for a survey.
 * Returns null if no model exists, or if the table is missing (migration 087
 * not yet applied) — callers must treat null as "no authoritative geometry
 * yet" and fall back gracefully.
 */
export async function getCanonicalModel(surveyId: string): Promise<CanonicalBuildingModel | null> {
  try {
    const sql = await getDbReady();
    const rows = (await sql`
      SELECT survey_id, schema_version, authority_state, roof_plane_count,
             model, built_by, built_at, updated_at
      FROM canonical_building_model
      WHERE survey_id = ${surveyId}
      LIMIT 1
    `) as CanonicalModelRow[];

    if (!rows || rows.length === 0) return null;
    return rowToCanonicalModel(rows[0]);
  } catch (err) {
    // Missing table (pre-migration) or transient DB error — fall back safely.
    console.warn(
      `[canonicalModelStore] getCanonicalModel failed for survey ${surveyId} (treating as absent):`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
