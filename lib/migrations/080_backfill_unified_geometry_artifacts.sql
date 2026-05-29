-- ============================================================================
-- Migration 080: Backfill unified_geometry_artifacts from source tables
-- ============================================================================
-- Populates unified_geometry_artifacts from two legacy pipelines:
--
--   Pipeline A: open_source_photo_vision_candidates
--     Each candidate becomes an obstruction-class artifact with raw_evidence
--     authority. ID is 'pv-' || id (PK is id; no candidate_id column exists).
--
--   Pipeline B: site_survey_geometry_reconstruction_artifacts
--     Each artifact is mapped to a geometry_class via the artifact_type mapping.
--     ID is the artifact's own id cast to text.
--
-- Idempotency (plain SQL only, no procedural blocks):
--   1. INSERT ... SELECT ... WHERE NOT EXISTS guard checks that
--      unified_geometry_artifacts has zero rows before backfilling.
--   2. ON CONFLICT (id) DO NOTHING so re-runs are safe.
--
-- Column mapping (verified against actual table DDL):
--   Pipeline A source: open_source_photo_vision_candidates (migration 023)
--     id TEXT PK, survey_id UUID, file_id UUID, tool_name TEXT,
--     tool_version TEXT, run_hash TEXT, candidate_type TEXT,
--     candidate_category TEXT, payload JSONB, confidence NUMERIC,
--     limitations JSONB, review_status TEXT, deterministic_hash TEXT,
--     thumbnail_data_url TEXT, created_at TIMESTAMPTZ
--
--   Pipeline B source: site_survey_geometry_reconstruction_artifacts (077+078)
--     id UUID PK, job_id UUID, survey_id UUID, file_id TEXT,
--     artifact_type TEXT, pipeline TEXT, payload JSONB,
--     confidence DOUBLE PRECISION, limitations TEXT[], authority JSONB,
--     created_at TIMESTAMPTZ, stage_timings JSONB, worker_version TEXT
--
--   Key column fixes from original SQL:
--     c.candidate_id -> c.id (PK is id, no candidate_id column)
--     a.tool_version -> a.worker_version (078 added worker_version)
--     a.source_file_ids -> a.file_id (single TEXT column)
--     a.artifact_data -> a.payload (the JSONB payload column)
-- ============================================================================

-- ============================================================================
-- Pipeline A: open_source_photo_vision_candidates -> unified_geometry_artifacts
-- ============================================================================
-- Each photo vision candidate is inserted as an obstruction-class artifact
-- with raw_evidence authority.
-- Guard: only insert if unified_geometry_artifacts has zero rows.
INSERT INTO unified_geometry_artifacts (
  id, survey_id, geometry_class, authority_state, authority,
  provenance, confidence, label, limitations, geometry_data,
  review_state, priority, mock_artifact, created_at, updated_at
)
WITH source AS (
  SELECT
    'pv-' || c.id AS artifact_id,
    c.survey_id,
    c.candidate_type,
    c.candidate_category,
    c.tool_version,
    c.run_hash,
    c.file_id,
    c.confidence,
    c.limitations,
    c.created_at
  FROM open_source_photo_vision_candidates c
)
SELECT
  s.artifact_id,
  s.survey_id,
  'obstruction',
  'raw_evidence',
  jsonb_build_object(
    'state', 'raw_evidence',
    'level', 0,
    'reviewOnly', true,
    'cadConsumable', false,
    'mockArtifact', false
  ),
  jsonb_build_object(
    'sourcePipeline', 'photo_vision',
    'toolName', COALESCE(s.candidate_type, 'unknown'),
    'toolVersion', COALESCE(s.tool_version, '1.0.0'),
    'runHash', COALESCE(s.run_hash, 'unknown'),
    'sourceFileIds', CASE WHEN s.file_id IS NOT NULL
                      THEN jsonb_build_array(s.file_id::text)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(s.confidence, 0),
  COALESCE(s.candidate_type, 'unknown'),
  ARRAY(SELECT jsonb_array_elements_text(s.limitations)),
  jsonb_build_object(
    'originalCandidateId', s.artifact_id,
    'candidateType', s.candidate_type,
    'candidateCategory', s.candidate_category
  ),
  'review_required',
  'medium',
  FALSE,
  COALESCE(s.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM source s
WHERE NOT EXISTS (
  SELECT 1 FROM unified_geometry_artifacts
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Pipeline B: site_survey_geometry_reconstruction_artifacts -> unified_geometry_artifacts
-- ============================================================================
-- Each reconstruction artifact is mapped to a geometry_class via artifact_type.
-- Guard: only insert if unified_geometry_artifacts has zero rows.
INSERT INTO unified_geometry_artifacts (
  id, survey_id, geometry_class, authority_state, authority,
  provenance, confidence, label, limitations, geometry_data,
  review_state, priority, mock_artifact, created_at, updated_at
)
WITH source AS (
  SELECT
    a.id,
    a.survey_id,
    a.artifact_type,
    a.worker_version,
    a.job_id,
    a.file_id,
    a.confidence,
    a.limitations,
    a.payload,
    a.created_at
  FROM site_survey_geometry_reconstruction_artifacts a
)
SELECT
  s.id::text,
  s.survey_id,
  CASE s.artifact_type
    WHEN 'segmentation_mask'          THEN 'segmentation'
    WHEN 'depth_map'                  THEN 'depth'
    WHEN 'sfm_point_cloud'            THEN 'point_cloud'
    WHEN 'plane_candidate'            THEN 'roof_plane'
    WHEN 'roof_plane_candidate'       THEN 'roof_plane'
    WHEN 'wall_plane_candidate'       THEN 'wall_plane'
    WHEN 'line_candidate'             THEN 'structural_line'
    WHEN 'semantic_segmentation_mask' THEN 'segmentation'
    WHEN 'structural_line_candidate'  THEN 'structural_line'
    WHEN 'vanishing_point'            THEN 'vanishing_point'
    WHEN 'consensus_plane_candidate'  THEN 'consensus_plane'
    ELSE 'unknown'
  END,
  'raw_evidence',
  jsonb_build_object(
    'state', 'raw_evidence',
    'level', 0,
    'reviewOnly', true,
    'cadConsumable', false,
    'mockArtifact', (s.artifact_type = 'mock')
  ),
  jsonb_build_object(
    'sourcePipeline', 'geometry_reconstruction',
    'toolName', COALESCE(s.artifact_type, 'unknown'),
    'toolVersion', COALESCE(s.worker_version, '1.0.0'),
    'runHash', COALESCE(s.job_id::text, s.id::text, 'unknown'),
    'sourceFileIds', CASE WHEN s.file_id IS NOT NULL
                      THEN jsonb_build_array(s.file_id)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(s.confidence, 0),
  COALESCE(s.artifact_type, 'unknown'),
  s.limitations,
  jsonb_build_object(
    'originalArtifactId', s.id::text,
    'artifactType', COALESCE(s.artifact_type, 'unknown'),
    'artifactData', s.payload
  ),
  'review_required',
  'medium',
  (s.artifact_type = 'mock'),
  COALESCE(s.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM source s
WHERE NOT EXISTS (
  SELECT 1 FROM unified_geometry_artifacts
)
ON CONFLICT (id) DO NOTHING;
