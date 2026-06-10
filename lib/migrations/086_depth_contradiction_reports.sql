-- Depth-class contradiction reports for geometry reconstruction.
-- Stores reports produced by the depth contradiction detector (P0-2.3)
-- when the estimated depth for a segmentation mask contradicts the
-- expected depth range for its class.
--
-- Used by:
--   - Contradiction-aware promotion validation (P0-4.2) to block
--     artifacts with moderate/major contradictions from canonical promotion
--   - Pipeline diagnostics and debugging
--   - Future: automated reclassification suggestions
--
-- REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY

-- Stores individual contradiction reports per pipeline run
CREATE TABLE IF NOT EXISTS site_survey_depth_contradiction_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to the geometry reconstruction job that produced this report
  job_id UUID NOT NULL REFERENCES site_survey_geometry_reconstruction_jobs(id) ON DELETE CASCADE,

  -- Link to the survey for direct query access
  survey_id UUID NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,

  -- The segmentation class of the mask that was contradicted
  -- (e.g., 'sky', 'roof_plane', 'tree_canopy')
  segmentation_class TEXT NOT NULL,

  -- The mask ID that triggered the contradiction
  -- Links back to the SemanticSegmentationMask that was checked
  mask_id TEXT NOT NULL,

  -- Expected depth range for the class [min, max] in normalized depth
  -- (0=far from camera, 1=near camera, matching MiDaS inverted depth)
  expected_range_min DOUBLE PRECISION NOT NULL,
  expected_range_max DOUBLE PRECISION NOT NULL,

  -- Actual estimated depth of the mask region (normalized, 0=far, 1=near)
  actual_depth DOUBLE PRECISION NOT NULL,

  -- How far outside the expected range the actual depth is
  -- (absolute difference between actual depth and nearest range boundary)
  deviation DOUBLE PRECISION NOT NULL,

  -- Severity of the contradiction:
  --   'none'     — deviation < 0.05 (no action)
  --   'minor'    — deviation 0.05–0.10 (logged, no penalty)
  --   'moderate' — deviation 0.10–0.20 (blocks canonical promotion)
  --   'major'    — deviation > 0.20 (blocks canonical promotion)
  severity TEXT NOT NULL CHECK (severity IN ('none', 'minor', 'moderate', 'major')),

  -- Confidence penalty applied to the depth estimate
  -- (0 for 'none'/'minor', 15 for 'moderate', 30 for 'major')
  confidence_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Human-readable description of the contradiction
  description TEXT NOT NULL DEFAULT '',

  -- When this report was created
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for finding contradiction reports by survey (dashboard/diagnostics)
CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_survey
  ON site_survey_depth_contradiction_reports (survey_id);

-- Index for finding contradiction reports by job (pipeline debugging)
CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_job
  ON site_survey_depth_contradiction_reports (job_id);

-- Index for finding blocking contradictions (moderate/major severity)
-- Used by promotion validation to check if an artifact is contradicted
CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_blocking
  ON site_survey_depth_contradiction_reports (mask_id, severity)
  WHERE severity IN ('moderate', 'major');

-- Index for finding contradictions by segmentation class
-- Useful for diagnostic queries: "which classes are most often contradicted?"
CREATE INDEX IF NOT EXISTS idx_depth_contradiction_reports_class
  ON site_survey_depth_contradiction_reports (segmentation_class);
