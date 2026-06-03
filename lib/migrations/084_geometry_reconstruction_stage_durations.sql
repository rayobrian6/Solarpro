-- Add stage_durations and failure_stage tracking to geometry reconstruction jobs.
-- This enables:
--   1. Persisted per-stage timing breakdown for performance analysis
--   2. Recording which stage a pipeline failed at for debugging
--   3. Partial artifact visibility — knowing exactly how far a pipeline got
--
-- P0 — Execution Stability: checkpoint persistence and failure stage recording.
-- REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY

-- Jobs table: add stage_durations JSONB and failure_stage columns
ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS stage_durations JSONB NULL;

ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS failure_stage TEXT NULL;

-- stage_durations format: { "segmentation": 12345, "line_extraction": 678, ... }
-- Key = stage name, value = duration in milliseconds.
-- failure_stage: the stage name where the pipeline failed (NULL if completed or not started).
