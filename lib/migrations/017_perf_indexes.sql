-- Migration 017: Performance indexes for project_versions hot paths
-- Root cause: Missing composite index caused sequential scans on version lookups.
-- All queries against project_versions filter by (project_id) and order by
-- version_number DESC or created_at DESC. A composite index covers both patterns.

-- Composite index: covers getProjectVersions (project_id + version_number DESC)
-- This is the primary hot-path index — replaces the single-column idx_versions_project_id
-- for the version list query which always does:
--   WHERE project_id = $1 AND user_id = $2 ORDER BY version_number DESC LIMIT 50
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_versions_project_user_version
  ON project_versions (project_id, user_id, version_number DESC);

-- Composite index: covers latest-version lookup by created_at
-- Replaces the single-column idx_versions_created_at for per-project queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_versions_project_created
  ON project_versions (project_id, created_at DESC);

-- Index on layouts (project_id, user_id, updated_at DESC) for the LATERAL join in
-- getProjectsByUser / getProjectsByClient which does:
--   WHERE l2.project_id = p.id AND l2.user_id = $1 ORDER BY l2.updated_at DESC LIMIT 1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_layouts_project_user_updated
  ON layouts (project_id, user_id, updated_at DESC);

-- Index on proposals (project_id, user_id, created_at DESC) for the LATERAL join:
--   WHERE pr2.project_id = p.id AND pr2.user_id = $1 ORDER BY pr2.created_at DESC LIMIT 1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_project_user_created
  ON proposals (project_id, user_id, created_at DESC);