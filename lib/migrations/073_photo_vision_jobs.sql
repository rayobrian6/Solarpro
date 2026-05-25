-- Photo vision async job tracking table.
-- Stores job state in PostgreSQL so it survives across Vercel serverless
-- function instances (in-memory state is lost when the instance recycles
-- or a different instance handles the next request).
--
-- Used by asyncPhotoVisionJobManager.ts for the open-source photo vision pass.

CREATE TABLE IF NOT EXISTS photo_vision_jobs (
  job_id TEXT PRIMARY KEY,
  survey_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT photo_vision_jobs_status CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  -- Survey/files snapshot (JSONB — contains survey + photoFiles)
  job_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Progress
  total_batches INT NOT NULL DEFAULT 0,
  current_batch INT NOT NULL DEFAULT 0,
  completed_batches INT NOT NULL DEFAULT 0,
  total_photo_files INT NOT NULL DEFAULT 0,
  processed_files INT NOT NULL DEFAULT 0,
  -- Accumulated results (JSONB — grows as batches complete)
  file_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  batch_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_availability JSONB NULL,
  -- Final result (JSONB — populated on completion)
  final_result JSONB NULL,
  error TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_survey
  ON photo_vision_jobs (survey_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_vision_jobs_status
  ON photo_vision_jobs (status, updated_at DESC);
