-- ============================================================================
-- Migration 080: Backfill unified_geometry_artifacts from source tables
-- ============================================================================
-- Populates unified_geometry_artifacts from two legacy pipelines:
--
--   Pipeline A: open_source_photo_vision_candidates
--     Each candidate becomes an obstruction-class artifact with raw_evidence
--     authority. ID is COALESCE(candidate_id, 'pv-' || id).
--
--   Pipeline B: site_survey_geometry_reconstruction_artifacts
--     Each artifact is mapped to a geometry_class via the artifact_type mapping
--     below. ID is the artifact's own id.
--
-- Idempotency guards:
--   1. Skips entirely if unified_geometry_artifacts table does not exist
--      (requires Migration 079 to have run first).
--   2. Skips if unified_geometry_artifacts already has rows (the inline
--      /api/migrate route checks COUNT(*) > 0).
--   3. Uses ON CONFLICT (id) DO NOTHING on every INSERT so re-runs are safe.
--
-- IMPORTANT DIFFERENCES FROM INLINE DDL (app/api/migrate/route.ts):
--   The inline migration uses JavaScript procedural logic:
--     - JSON.stringify() to build JSONB columns
--     - Null coalescing (??) for default values
--     - Row-by-row try/catch for individual insert failures
--     - A JS geometryClassMap for Pipeline B artifact_type → geometry_class
--
--   This SQL file expresses the same backfill as pure SQL using:
--     - COALESCE for defaults
--     - jsonb_build_object for structured columns
--     - CASE for the geometry_class mapping
--     - INSERT ... SELECT ... ON CONFLICT DO NOTHING for set-based backfill
--
--   The inline /api/migrate route remains the authoritative runtime executor.
--   This SQL file is the source-of-truth documentation for the migration's
--   schema and data intent. Running this file directly is equivalent in
--   outcome but differs in error handling (SQL stops on first error per
--   statement, whereas the inline route catches and continues per row).
-- ============================================================================

-- Guard: skip if table does not exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'unified_geometry_artifacts'
  ) THEN
    RAISE NOTICE 'Migration 080: skipped — unified_geometry_artifacts table does not exist yet (run 079 first)';
  END IF;
END $$;

-- Guard: skip if already populated
-- (The inline route checks COUNT(*) > 0 before backfilling.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'unified_geometry_artifacts'
  ) THEN
    IF (SELECT COUNT(*) FROM unified_geometry_artifacts) > 0 THEN
      RAISE NOTICE 'Migration 080: skipped — unified_geometry_artifacts already has rows';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- Pipeline A: open_source_photo_vision_candidates → unified_geometry_artifacts
-- ============================================================================
-- Each photo vision candidate is inserted as an obstruction-class artifact
-- with raw_evidence authority.
INSERT INTO unified_geometry_artifacts (
  id, survey_id, geometry_class, authority_state, authority,
  provenance, confidence, label, limitations, geometry_data,
  review_state, priority, mock_artifact, created_at, updated_at
)
SELECT
  COALESCE(c.candidate_id, 'pv-' || c.id),
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
    'toolVersion', '1.0.0',
    'runHash', COALESCE(c.id::text, 'unknown'),
    'sourceFileIds', CASE WHEN c.survey_id IS NOT NULL
                      THEN jsonb_build_array(c.survey_id)
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(c.confidence, 0),
  COALESCE(c.candidate_type, 'unknown'),
  '{}'::text[],
  jsonb_build_object(
    'originalCandidateId', COALESCE(c.candidate_id, c.id::text),
    'candidateType', c.candidate_type,
    'candidateCategory', c.candidate_category
  ),
  'review_required',
  'medium',
  FALSE,
  COALESCE(c.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM open_source_photo_vision_candidates c
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
    'toolVersion', COALESCE(a.tool_version, '1.0.0'),
    'runHash', COALESCE(a.job_id::text, a.id::text, 'unknown'),
    'sourceFileIds', COALESCE(a.source_file_ids, '[]'::jsonb),
    'derivedFromArtifactIds', '[]'::jsonb
  ),
  COALESCE(a.confidence, 0),
  COALESCE(a.artifact_type, 'unknown'),
  COALESCE(a.limitations, '{}'::text[]),
  jsonb_build_object(
    'originalArtifactId', a.id::text,
    'artifactType', COALESCE(a.artifact_type, 'unknown'),
    'artifactData', a.artifact_data
  ),
  'review_required',
  'medium',
  (a.artifact_type = 'mock'),
  COALESCE(a.created_at, NOW())::timestamptz,
  NOW()::timestamptz
FROM site_survey_geometry_reconstruction_artifacts a
ON CONFLICT (id) DO NOTHING;
