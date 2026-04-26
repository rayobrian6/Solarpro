-- ============================================================
-- Migration 012: Survey Ingest v2 (v47.435)
--
-- Adds schema surface required by the v47.435 ingest pipeline.
-- Migration 011 (v47.434) added the core tables and columns;
-- this migration adds columns needed by the pipeline orchestrator
-- and triage queue (Q8).
--
-- All additive. No existing tables modified destructively.
-- IF NOT EXISTS / DO NOTHING guards make this safe to re-run.
-- ============================================================

-- ============================================================
-- webhook_deliveries — ingest pipeline additions
-- ============================================================

-- ingest_version: records which version of the pipeline processed
-- this delivery. Useful when replaying old deliveries after a
-- pipeline change (v47.437 replay will set this).
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS ingest_version TEXT;

-- ingest_summary: JSONB snapshot of TransformSummary for quick
-- ops visibility without reading project rows.
-- { projectName, hasAddress, fileCount, hasSurveyMeta }
ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS ingest_summary JSONB;

-- ============================================================
-- projects — triage support (Q8)
-- ============================================================

-- survey_triage_reason: set when SURVEY_PROJECT_LINK_STRATEGY=TRIAGE_QUEUE.
-- Stores the human-readable reason the delivery was queued for manual review.
-- NULL for all non-triage survey projects and all non-survey projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS survey_triage_reason TEXT;

-- ============================================================
-- project_files — async photo fetch lifecycle additions
-- ============================================================

-- fetch_error: captures the error message when status='failed'
-- so ops can diagnose download failures without reading logs.
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS fetch_error TEXT;

-- fetch_attempts: number of download attempts made (for retry backoff logic
-- in v47.436+ async photo worker).
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS fetch_attempts INTEGER NOT NULL DEFAULT 0;

-- mime_type: MIME type recorded at ingest time (may differ from actual content).
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- ============================================================
-- Indexes
-- ============================================================

-- Speed up admin log queries filtering by ingest status across deliveries
-- that have reached 'ingested' or 'failed' terminal state.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ingest_version
  ON webhook_deliveries(ingest_version)
  WHERE ingest_version IS NOT NULL;

-- Speed up the async photo worker finding files that need fetching.
CREATE INDEX IF NOT EXISTS idx_project_files_status_pending
  ON project_files(project_id, status)
  WHERE status = 'pending';

-- Speed up the async photo worker finding failed files for retry.
CREATE INDEX IF NOT EXISTS idx_project_files_status_failed
  ON project_files(project_id, status, fetch_attempts)
  WHERE status = 'failed';

-- ============================================================
-- Notes for v47.436+ (photo fetch worker)
-- ============================================================
-- The async photo fetch worker (not yet implemented) will:
--   1. SELECT project_files WHERE status='pending' ORDER BY created_at
--   2. Attempt to fetch each URL and store the result in object storage
--   3. UPDATE status='ready', mime_type=<actual>, fetch_attempts++  on success
--   4. UPDATE status='failed', fetch_error=<msg>, fetch_attempts++ on failure
--   5. Retry up to N times with exponential backoff (N configurable via env)