-- ============================================================================
-- Migration 087: canonical_building_model
-- ============================================================================
-- Persists the CanonicalBuildingModel built from promoted_canonical / cad_safe
-- artifacts (lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts).
--
-- WHY (Roadmap Phase 1 — survey→canonical→planset spine):
--   The canonical model was previously built on the fly and returned from the
--   API but never persisted, so nothing downstream could consume it. This table
--   is the durable spine: the Solar→canonical path writes it (one row per
--   survey, upserted), and the permit planset reads authoritative roof geometry
--   (worldPolygon lat/lng + pitch/azimuth/area) from it.
--
-- One row per survey (survey_id PRIMARY KEY → upsert on rebuild).
-- The full CanonicalBuildingModel is stored as `model` JSONB; the scalar
-- columns are denormalized for cheap querying/indexing.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS. No destructive operations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_building_model (
  survey_id        TEXT PRIMARY KEY,
  schema_version   TEXT NOT NULL,
  authority_state  TEXT NOT NULL,
  roof_plane_count INTEGER NOT NULL DEFAULT 0,
  model            JSONB NOT NULL,
  built_by         TEXT NOT NULL DEFAULT 'automated',
  built_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_building_model_authority
  ON canonical_building_model (authority_state);
