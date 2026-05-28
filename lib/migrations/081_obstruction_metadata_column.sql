-- ============================================================================
-- Migration 081: Add obstruction_metadata column to unified_geometry_artifacts
-- ============================================================================
-- Adds the obstruction_metadata JSONB column used by the roof obstruction
-- registration pipeline. This column stores the full ObstructionMetadata blob
-- for obstruction-class artifacts.
--
-- The column is NULLable — non-obstruction artifacts do not use it.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.
-- Safe to run against databases where /api/migrate already added this column.
-- No destructive operations.
-- ============================================================================

ALTER TABLE unified_geometry_artifacts
  ADD COLUMN IF NOT EXISTS obstruction_metadata JSONB NULL;
