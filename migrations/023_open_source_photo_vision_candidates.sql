-- Review-only open-source photo vision candidates.
-- These rows are operator review aids only. They must not be treated as canonical
-- evidence, CAD geometry, project_physical_data, permit input, BOM input, or
-- engineering workflow state.

CREATE TABLE IF NOT EXISTS open_source_photo_vision_candidates (
  id TEXT PRIMARY KEY,
  survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES site_survey_files(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  run_hash TEXT NOT NULL,
  candidate_type TEXT NOT NULL,
  candidate_category TEXT NOT NULL,
  payload JSONB NOT NULL,
  confidence NUMERIC NOT NULL,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'review_required',
  deterministic_hash TEXT NOT NULL,
  thumbnail_data_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT open_source_photo_vision_review_only CHECK (review_status IN ('review_required', 'accepted_review_reference', 'rejected')),
  CONSTRAINT open_source_photo_vision_confidence CHECK (confidence >= 0 AND confidence <= 100)
);

CREATE INDEX IF NOT EXISTS idx_open_source_photo_vision_candidates_survey
  ON open_source_photo_vision_candidates (survey_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_open_source_photo_vision_candidates_file
  ON open_source_photo_vision_candidates (file_id);

CREATE INDEX IF NOT EXISTS idx_open_source_photo_vision_candidates_run
  ON open_source_photo_vision_candidates (run_hash);
