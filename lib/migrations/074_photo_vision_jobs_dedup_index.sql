-- Migration 074: Add partial index for photo vision job dedup queries
-- and clean up stale jobs on deploy.
--
-- The partial index on (survey_id) WHERE status IN ('pending', 'running')
-- makes findActiveJobForSurvey() queries fast without scanning completed jobs.
-- Also adds a user_id + status index for countActiveJobsForUser() rate limiting.

-- Partial index for dedup: find active jobs for a survey
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_survey_active
  ON photo_vision_jobs (survey_id, created_at DESC)
  WHERE status IN ('pending', 'running');

-- Index for per-user rate limiting: count active jobs per user
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_user_active
  ON photo_vision_jobs (user_id, created_at DESC)
  WHERE status IN ('pending', 'running');

-- Clean up any stale jobs that may be stuck in pending/running state
-- (e.g., from server restarts or failed deployments)
UPDATE photo_vision_jobs
SET status = 'failed',
    error = 'Marked as failed during migration 074 deployment (stale job cleanup)',
    completed_at = NOW(),
    updated_at = NOW()
WHERE status IN ('pending', 'running')
  AND updated_at < NOW() - INTERVAL '30 minutes';
