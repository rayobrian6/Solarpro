-- ============================================================================
-- Migration 079: Unified Geometry — promotion records + unified artifacts
-- ============================================================================
-- Creates two tables that form the foundation of the unified geometry pipeline:
--
--   079a) geometry_promotion_records
--         Audit trail for geometry artifact promotion/rejection actions.
--         Each row records who promoted/rejected an artifact, from/to authority
--         state, and whether intelligence validation was performed.
--
--   079b) unified_geometry_artifacts
--         The primary persistence layer for UnifiedGeometryArtifact instances.
--         Routes should query this table first, falling back to on-the-fly
--         adaptation from source tables only when no rows exist for a survey.
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- Safe to run against databases where /api/migrate already created these objects.
-- No destructive operations.
-- ============================================================================

-- 079a: geometry_promotion_records table
CREATE TABLE IF NOT EXISTS geometry_promotion_records (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  promoted_by TEXT NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NULL,
  intelligence_validated BOOLEAN NOT NULL DEFAULT FALSE,
  intelligence_warnings TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_promotion_records_artifact
  ON geometry_promotion_records (artifact_id);

CREATE INDEX IF NOT EXISTS idx_promotion_records_survey
  ON geometry_promotion_records (survey_id);

CREATE INDEX IF NOT EXISTS idx_promotion_records_promoted_by
  ON geometry_promotion_records (promoted_by);

-- 079b: unified_geometry_artifacts table
CREATE TABLE IF NOT EXISTS unified_geometry_artifacts (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  geometry_class TEXT NOT NULL,
  authority_state TEXT NOT NULL DEFAULT 'raw_evidence',
  authority JSONB NOT NULL,
  provenance JSONB NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  limitations TEXT[] NOT NULL DEFAULT '{}',
  geometry_data JSONB NULL,
  review_state TEXT NOT NULL DEFAULT 'review_required',
  review_notes TEXT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  mock_artifact BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unified_geo_artifacts_survey
  ON unified_geometry_artifacts (survey_id);

CREATE INDEX IF NOT EXISTS idx_unified_geo_artifacts_class
  ON unified_geometry_artifacts (geometry_class);

CREATE INDEX IF NOT EXISTS idx_unified_geo_artifacts_authority
  ON unified_geometry_artifacts (authority_state);

CREATE INDEX IF NOT EXISTS idx_unified_geo_artifacts_review
  ON unified_geometry_artifacts (review_state);
