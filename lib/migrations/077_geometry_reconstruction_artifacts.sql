-- Geometry reconstruction artifacts for site surveys.
-- Stores segmentation masks, depth maps, SfM point clouds, plane/line candidates.
-- REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY

-- Jobs table: tracks reconstruction pipeline runs
CREATE TABLE IF NOT EXISTS site_survey_geometry_reconstruction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  pipeline TEXT NOT NULL DEFAULT 'mock',
  input JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Artifacts table: stores individual reconstruction artifacts per job
CREATE TABLE IF NOT EXISTS site_survey_geometry_reconstruction_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES site_survey_geometry_reconstruction_jobs(id) ON DELETE CASCADE,
  survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,
  file_id TEXT,
  artifact_type TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  limitations TEXT[] NOT NULL DEFAULT '{}',
  authority JSONB NOT NULL DEFAULT '{"reviewOnly":true,"nonAuthoritative":true,"cadMutationAllowed":false,"permitGenerationAllowed":false,"bomMutationAllowed":false}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_geo_recon_artifacts_survey
  ON site_survey_geometry_reconstruction_artifacts (survey_id);
CREATE INDEX IF NOT EXISTS idx_geo_recon_artifacts_job
  ON site_survey_geometry_reconstruction_artifacts (job_id);
CREATE INDEX IF NOT EXISTS idx_geo_recon_jobs_survey
  ON site_survey_geometry_reconstruction_jobs (survey_id);
