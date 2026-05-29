-- ============================================================================
-- Migration 080: Backfill unified_geometry_artifacts from source tables
-- ============================================================================
-- Populates unified_geometry_artifacts from two legacy pipelines:
--
--   Pipeline A: open_source_photo_vision_candidates
--     Each candidate becomes an obstruction-class artifact with raw_evidence
--     authority. ID is 'pv-' || id (PK is id, no candidate_id column exists).
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
--
-- IMPORTANT: This file must NOT contain semicolons inside comments or
-- string literals, because the system-tools runner splits on semicolons.
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
SELECT
  'pv-' || c.id,
  c.survey_id,
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
    'toolName', COALESCE(c.candidate_type, 'unknown'),
    'toolVersion', COALESCE(c.tool_version, '1.0.0'),
    'runHash', COALESCE(c.run_hash, 'unknown'),
    'sourceFileIds', CASE WHEN c.file_id IS NOT NULL
                      THEN jsonb_build_array(c.file_id::text)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(c.confidence, 0),
  COALESCE(c.candidate_type, 'unknown'),
  CASE WHEN jsonb_typeof(c.limitations) = 'array'
       THEN ARRAY(SELECT jsonb_array_elements_text(c.limitations))
       ELSE '{}'::text[] END,
  jsonb_build_object(
    'originalCandidateId', 'pv-' || c.id,
    'candidateType', c.candidate_type,
    'candidateCategory', c.candidate_category
  ),
  'review_required',
  'medium',
  FALSE,
  COALESCE(c.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM open_source_photo_vision_candidates c
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
SELECT
  a.id::text,
  a.survey_id,
  CASE a.artifact_type
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
    'mockArtifact', (a.artifact_type = 'mock')
  ),
  jsonb_build_object(
    'sourcePipeline', 'geometry_reconstruction',
    'toolName', COALESCE(a.artifact_type, 'unknown'),
    'toolVersion', COALESCE(a.worker_version, '1.0.0'),
    'runHash', COALESCE(a.job_id::text, a.id::text, 'unknown'),
    'sourceFileIds', CASE WHEN a.file_id IS NOT NULL
                      THEN jsonb_build_array(a.file_id)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(a.confidence, 0),
  COALESCE(a.artifact_type, 'unknown'),
  a.limitations,
  jsonb_build_object(
    'originalArtifactId', a.id::text,
    'artifactType', COALESCE(a.artifact_type, 'unknown'),
    'artifactData', a.payload
  ),
  'review_required',
  'medium',
  (a.artifact_type = 'mock'),
  COALESCE(a.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM site_survey_geometry_reconstruction_artifacts a
WHERE NOT EXISTS (
  SELECT 1 FROM unified_geometry_artifacts
)
ON CONFLICT (id) DO NOTHING;
