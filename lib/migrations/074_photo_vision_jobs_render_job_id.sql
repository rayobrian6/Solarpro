-- Add render_job_id column to link Vercel jobs to Render-side processing jobs.
-- This allows the Render worker to update job progress directly in Neon DB.

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS render_job_id TEXT NULL;

-- Partial indexes for dedup and rate limiting queries
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_active_survey
  ON photo_vision_jobs (survey_id) WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_active_user
  ON photo_vision_jobs (user_id) WHERE status IN ('pending', 'running');

-- Stale job cleanup index
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_stale
  ON photo_vision_jobs (updated_at) WHERE status = 'running';
