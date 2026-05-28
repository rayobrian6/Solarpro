-- Add finalization stage tracking and heartbeat columns.
-- This allows debugging WHERE a stuck finalization is (stage name)
-- and WHEN it was last alive (heartbeat), without relying only on logs.

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_stage TEXT NULL;

ALTER TABLE photo_vision_jobs
  ADD COLUMN IF NOT EXISTS finalization_last_heartbeat_at TIMESTAMPTZ NULL;

-- Index for finding stuck finalizations (running with stale heartbeat)
CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_stuck_finalization
  ON photo_vision_jobs (finalization_status, finalization_last_heartbeat_at)
  WHERE finalization_status = 'running';
