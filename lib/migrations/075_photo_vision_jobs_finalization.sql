-- Add finalization tracking columns to photo_vision_jobs.
-- This allows the GET polling route to return immediately once worker
-- results are available, while heavy post-processing (label updates,
-- obstruction registration, Vision classification, Phase 4A aggregation)
-- runs in the background and stores its output for subsequent polls.

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT photo_vision_jobs_finalization_status
      CHECK (finalization_status IN ('pending', 'running', 'complete', 'failed', 'skipped'));

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_result JSONB NULL;

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_error TEXT NULL;

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_started_at TIMESTAMPTZ NULL;

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_completed_at TIMESTAMPTZ NULL;

-- Index for finding jobs that need finalization
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_finalization_pending
  ON photo_vision_jobs (status, finalization_status)
  WHERE status = 'completed' AND finalization_status = 'pending';
