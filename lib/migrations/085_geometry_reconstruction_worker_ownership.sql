-- Add worker ownership columns to geometry reconstruction jobs.
-- This enables atomic job claiming by Render background workers:
--   1. Worker claims a queued job by setting locked_by + locked_at atomically
--   2. Only one worker can claim a given job (CAS on locked_by IS NULL)
--   3. Stale locks are detected via locked_at timeout
--   4. Worker releases the lock on completion/failure
--
-- P1 — Execution Architecture: Render Background Worker
-- REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY

-- Worker identity that claimed this job (e.g. 'render-worker-abc123')
ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS locked_by TEXT NULL;

-- When this job was claimed by a worker
ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL;

-- Index for fast "find next queued unclaimed job" queries
CREATE INDEX IF NOT EXISTS idx_geom_recon_jobs_claimable
  ON site_survey_geometry_reconstruction_jobs (status, locked_by)
  WHERE status = 'queued' AND locked_by IS NULL;
