-- Add heartbeat, current_stage, and worker_version tracking to geometry reconstruction.
-- This enables:
--   1. Detection of stuck/in-flight jobs via heartbeat timestamps
--   2. Visibility into which pipeline stage a running job is in
--   3. Provenance tracking (worker_version) on both jobs and artifacts
--   4. Stage timing breakdown on artifacts for performance analysis
--
-- REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY

-- Jobs table: add heartbeat + stage + worker_version columns
ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS current_stage TEXT NULL;

ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NULL;

ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS worker_version TEXT NULL;

-- Artifacts table: add stage_timings + worker_version columns
ALTER TABLE site_survey_geometry_reconstruction_artifacts
  ADD COLUMN IF NOT EXISTS stage_timings JSONB NULL;

ALTER TABLE site_survey_geometry_reconstruction_artifacts
  ADD COLUMN IF NOT EXISTS worker_version TEXT NULL;

-- Index for finding stuck jobs (running with stale heartbeat)
CREATE INDEX IF NOT EXISTS idx_geo_recon_jobs_stuck
  ON site_survey_geometry_reconstruction_jobs (status, last_heartbeat_at)
  WHERE status = 'running';
