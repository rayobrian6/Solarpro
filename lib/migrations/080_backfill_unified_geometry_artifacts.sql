-- ============================================================================
-- Migration 080: Backfill unified_geometry_artifacts from source tables
-- ============================================================================
-- Populates unified_geometry_artifacts from two legacy pipelines:
--
--   Pipeline A: open_source_photo_vision_candidates
--     Each candidate becomes an obstruction-class artifact with raw_evidence
--     authority. ID is 'pv-' || id (no candidate_id column exists; the PK is id).
--
--   Pipeline B: site_survey_geometry_reconstruction_artifacts
--     Each artifact is mapped to a geometry_class via the artifact_type mapping
--     below. ID is the artifact's own id cast to text.
--
-- Idempotency (plain SQL only — no DO $$ blocks):
--   1. INSERT ... SELECT ... WHERE NOT EXISTS guard checks that
--      unified_geometry_artifacts has zero rows before backfilling.
--      If rows already exist (from a prior run or the inline route),
--      the WHERE NOT EXISTS fails and zero rows are inserted.
--   2. ON CONFLICT (id) DO NOTHING on every INSERT so re-runs are safe
--      even if the guard is bypassed.
--
-- SCHEMA NOTES (verified against actual table DDL):
--   open_source_photo_vision_candidates columns (migration 023):
--     id TEXT PK, survey_id UUID, file_id UUID, tool_name TEXT,
--     tool_version TEXT, run_hash TEXT, candidate_type TEXT,
--     candidate_category TEXT, payload JSONB, confidence NUMERIC,
--     limitations JSONB, review_status TEXT, deterministic_hash TEXT,
--     thumbnail_data_url TEXT, created_at TIMESTAMPTZ
--
--   site_survey_geometry_reconstruction_artifacts columns (migration 077+078):
--     id UUID PK, job_id UUID, survey_id UUID, file_id TEXT,
--     artifact_type TEXT, pipeline TEXT, payload JSONB,
--     confidence DOUBLE PRECISION, limitations TEXT[], authority JSONB,
--     created_at TIMESTAMPTZ, stage_timings JSONB, worker_version TEXT
--
--   KEY DIFFERENCES from original SQL file:
--     - c.candidate_id  → c.id  (no candidate_id column; PK is id)
--     - a.tool_version  → a.worker_version  (078 added worker_version, not tool_version)
--     - a.source_file_ids → a.file_id wrapped in jsonb_build_array (single TEXT, not array)
--     - a.artifact_data → a.payload  (the JSONB payload column)
--     - limitations in Pipeline A is JSONB (not text[]), cast with ::text[]
--       after unnesting; for the INSERT target it goes to a text[] column
--       so we convert via jsonb_array_elements_text
-- ============================================================================

-- ============================================================================
-- Pipeline A: open_source_photo_vision_candidates → unified_geometry_artifacts
-- ============================================================================
-- Each photo vision candidate is inserted as an obstruction-class artifact
-- with raw_evidence authority.
-- Guard: only insert if unified_geometry_artifacts has zero rows (idempotent).
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
    'runHash', COALESCE(c.run_hash, c.id, 'unknown'),
    'sourceFileIds', CASE WHEN c.file_id IS NOT NULL
                      THEN jsonb_build_array(c.file_id::text)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(c.confidence, 0),
  COALESCE(c.candidate_type, 'unknown'),
  -- limitations: source is JSONB (not text[]), convert via array_agg
  COALESCE(
    (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(c.limitations) elem),
    '{}'::text[]
  ),
  jsonb_build_object(
    'originalCandidateId', c.id,
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
-- Pipeline B: site_survey_geometry_reconstruction_artifacts → unified_geometry_artifacts
-- ============================================================================
-- Each reconstruction artifact is mapped to a geometry_class via artifact_type.
-- Mapping (mirrors inline JS geometryClassMap):
--   segmentation_mask               → segmentation
--   depth_map                       → depth
--   sfm_point_cloud                 → point_cloud
--   plane_candidate                 → roof_plane
--   roof_plane_candidate            → roof_plane
--   wall_plane_candidate            → wall_plane
--   line_candidate                  → structural_line
--   semantic_segmentation_mask      → segmentation
--   structural_line_candidate       → structural_line
--   vanishing_point                 → vanishing_point
--   consensus_plane_candidate       → consensus_plane
--   (all others)                    → unknown
--
-- Guard: only insert if unified_geometry_artifacts has zero rows (idempotent).
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
  COALESCE(a.limitations, '{}'::text[]),
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
