-- Migration 019: Composite covering indexes for hot dashboard queries
--
-- WHY THESE INDEXES EXIST
-- ────────────────────────────────────────────────────────────────────────────
-- The three hottest queries on the dashboard are:
--
--   1. getProjectsByUser():
--        WHERE user_id = $1 AND deleted_at IS NULL
--        ORDER BY updated_at DESC
--      Current: idx_projects_user_id (single column) — Postgres must do an
--      index scan on user_id then filter deleted_at then filesort on updated_at.
--      Fix: composite (user_id, deleted_at, updated_at DESC) covers the WHERE
--      and ORDER BY in one B-tree scan with no separate sort pass.
--
--   2. getProjectsByUser() LATERAL join on productions:
--        WHERE pr.project_id = p.id
--        ORDER BY pr.calculated_at DESC LIMIT 1
--      Current: idx_productions_project_id (single column) — LATERAL must scan
--      all productions for a project and sort by calculated_at.
--      Fix: composite (project_id, calculated_at DESC) lets Neon satisfy the
--      LATERAL ORDER BY...LIMIT 1 with a single index seek + 1 row read.
--
--   3. getClientsByUser():
--        WHERE user_id = $1 AND deleted_at IS NULL
--        ORDER BY created_at DESC
--      Current: idx_clients_user_id (single column) — same pattern as projects.
--      Fix: composite (user_id, deleted_at, created_at DESC).
--
-- All three indexes are CONCURRENTLY-safe: they build without locking writes,
-- and IF NOT EXISTS makes them idempotent so the migration can be re-run safely.
-- ────────────────────────────────────────────────────────────────────────────

-- ── projects: covering index for dashboard list query ─────────────────────
-- Covers: WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC
-- The partial index condition (deleted_at IS NULL) keeps the index small —
-- deleted projects are excluded, which is the overwhelming majority of live rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_active_updated
  ON projects (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- ── productions: covering index for LATERAL ORDER BY calculated_at DESC ───
-- Covers the inner LATERAL query in getProjectsByUser / getProjectsByClient:
--   SELECT data_json FROM productions WHERE project_id = $1
--   ORDER BY calculated_at DESC LIMIT 1
-- With this index Neon does a single index seek per project row in the outer
-- scan — no sort pass needed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_productions_project_calc
  ON productions (project_id, calculated_at DESC);

-- ── clients: covering index for getClientsByUser ───────────────────────────
-- Covers: WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_user_active_created
  ON clients (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
