-- ============================================================================
-- Migration 082: Backfill obstruction_data → unified_geometry_artifacts
-- ============================================================================
-- Reads obstruction_data JSONB from site_survey_files, unnests each
-- obstruction record, and writes it as a unified geometry artifact with the
-- full ObstructionMetadata blob.
--
-- Source: site_survey_files WHERE obstruction_data IS NOT NULL AND label = 'roof_plane'
-- Target: unified_geometry_artifacts (geometry_class = 'obstruction')
--
-- Idempotency (plain SQL only — no DO $$ blocks):
--   1. INSERT ... SELECT ... WHERE NOT EXISTS guard checks that there are
--      zero obstruction-class rows with obstruction_metadata IS NOT NULL.
--      If such rows already exist (from a prior run or the inline route),
--      the WHERE NOT EXISTS fails and zero rows are inserted.
--   2. ON CONFLICT (id) DO NOTHING on every INSERT so re-runs are safe
--      even if the guard is bypassed.
--
-- SCHEMA NOTES (verified against actual table DDL):
--   site_survey_files columns (migration 016 + dynamic alter):
--     id UUID PK, survey_id UUID, file_url TEXT, file_type survey_file_type,
--     label TEXT, filename TEXT, mime_type TEXT, created_at TIMESTAMPTZ,
--     obstruction_data JSONB (added dynamically by roofObstructionRegistration.ts)
--
--   unified_geometry_artifacts columns (migration 079 + 081):
--     id TEXT PK, survey_id TEXT, geometry_class TEXT, authority_state TEXT,
--     authority JSONB, provenance JSONB, confidence REAL, label TEXT,
--     limitations TEXT[], geometry_data JSONB, review_state TEXT,
--     review_notes TEXT, priority TEXT, mock_artifact BOOLEAN,
--     created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
--     obstruction_metadata JSONB NULL (added by migration 081)
-- ============================================================================

-- ============================================================================
-- Backfill: site_survey_files.obstruction_data → unified_geometry_artifacts
-- ============================================================================
-- Unnest the obstructions array from each site_survey_file row, then build
-- the full geometry_data and provenance JSONB and insert as an obstruction
-- artifact with derived_review_only authority.
--
-- Guard: only insert if no obstruction-class rows with obstruction_metadata
-- already exist (idempotent — matches inline route behavior).
INSERT INTO unified_geometry_artifacts (
  id, survey_id, geometry_class, authority_state, authority,
  provenance, confidence, label, limitations, geometry_data,
  obstruction_metadata,
  review_state, priority, mock_artifact, created_at, updated_at
)
WITH unnested AS (
  SELECT
    f.survey_id,
    obs,
    ROW_NUMBER() OVER (ORDER BY f.survey_id, f.filename, obs->>'id') AS rn
  FROM site_survey_files f
  CROSS JOIN LATERAL jsonb_array_elements(
    f.obstruction_data->'obstructions'
  ) AS obs
  WHERE f.obstruction_data IS NOT NULL
    AND f.label = 'roof_plane'
    AND f.obstruction_data->'obstructions' IS NOT NULL
    AND jsonb_array_length(f.obstruction_data->'obstructions') > 0
)
SELECT
  -- ID: use obs.id if present, else generate 'backfill-{survey_id}-{row_number}'
  COALESCE(
    NULLIF(u.obs->>'id', ''),
    'backfill-' || u.survey_id || '-' || u.rn
  ),
  u.survey_id,
  'obstruction',
  'derived_review_only',
  -- authority
  jsonb_build_object(
    'state', 'derived_review_only',
    'level', 1,
    'reviewOnly', true,
    'nonAuthoritative', true,
    'cadMutationAllowed', false,
    'permitGenerationAllowed', false,
    'bomMutationAllowed', false,
    'canonicalMutationAllowed', false,
    'engineeringWorkflowMutationAllowed', false,
    'cadConsumable', false,
    'mockArtifact', false
  ),
  -- provenance
  jsonb_build_object(
    'sourcePipeline', 'obstruction_registration',
    'toolName', 'roofObstructionRegistration',
    'toolVersion', '1.0.0',
    'runHash', COALESCE(u.obs->>'sourceFileId', 'unknown'),
    'sourceFileIds', CASE WHEN u.obs->>'sourceFileId' IS NOT NULL
                      THEN jsonb_build_array(u.obs->>'sourceFileId')
                      ELSE '[]'::jsonb END,
    'derivedFromArtifactIds', '[]'::jsonb,
    'createdAt', TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'synthetic', true,
    'disclaimer', 'Backfilled from site_survey_files.obstruction_data',
    'backfilledFrom', 'site_survey_files.obstruction_data'
  ),
  -- confidence: clamp from 0-100 scale to 0-1 scale
  LEAST(1.0, GREATEST(0.0, COALESCE((u.obs->>'confidence')::real, 0) / 100.0)),
  -- label
  COALESCE(u.obs->>'obstructionType', u.obs->>'obstruction_type', 'unknown_obstruction'),
  -- limitations
  CASE WHEN jsonb_typeof(u.obs->'limitations') = 'array'
       THEN COALESCE(
         (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(u.obs->'limitations') elem),
         '{}'::text[]
       )
       ELSE '{}'::text[]
  END,
  -- geometry_data (the full structured blob)
  jsonb_build_object(
    'id', COALESCE(NULLIF(u.obs->>'id', ''), 'backfill-' || u.survey_id || '-' || u.rn),
    'surveyId', u.survey_id,
    'geometryClass', 'obstruction',
    'authority', jsonb_build_object(
      'state', 'derived_review_only',
      'level', 1,
      'reviewOnly', true,
      'nonAuthoritative', true,
      'cadMutationAllowed', false,
      'permitGenerationAllowed', false,
      'bomMutationAllowed', false,
      'canonicalMutationAllowed', false,
      'engineeringWorkflowMutationAllowed', false,
      'cadConsumable', false,
      'mockArtifact', false
    ),
    'provenance', jsonb_build_object(
      'sourcePipeline', 'obstruction_registration',
      'toolName', 'roofObstructionRegistration',
      'toolVersion', '1.0.0',
      'runHash', COALESCE(u.obs->>'sourceFileId', 'unknown'),
      'sourceFileIds', CASE WHEN u.obs->>'sourceFileId' IS NOT NULL
                        THEN jsonb_build_array(u.obs->>'sourceFileId')
                        ELSE '[]'::jsonb END,
      'derivedFromArtifactIds', '[]'::jsonb,
      'createdAt', TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'synthetic', true,
      'disclaimer', 'Backfilled from site_survey_files.obstruction_data',
      'backfilledFrom', 'site_survey_files.obstruction_data'
    ),
    'confidence', LEAST(1.0, GREATEST(0.0, COALESCE((u.obs->>'confidence')::real, 0) / 100.0)),
    'label', COALESCE(u.obs->>'obstructionType', u.obs->>'obstruction_type', 'unknown_obstruction'),
    'limitations', CASE WHEN jsonb_typeof(u.obs->'limitations') = 'array'
                        THEN u.obs->'limitations'
                        ELSE '[]'::jsonb END,
    'bbox', CASE WHEN u.obs->'region' IS NOT NULL
                 THEN jsonb_build_object(
                   'x', COALESCE((u.obs->'region'->>'x')::numeric, 0),
                   'y', COALESCE((u.obs->'region'->>'y')::numeric, 0),
                   'width', COALESCE((u.obs->'region'->>'width')::numeric, 0),
                   'height', COALESCE((u.obs->'region'->>'height')::numeric, 0),
                   'coordinateSystem', 'normalized_image_0_1000'
                 )
                 ELSE NULL
            END,
    'polygon', NULL,
    'lineSegment', NULL,
    'center', CASE WHEN u.obs->'center' IS NOT NULL
                   THEN jsonb_build_object(
                     'x', COALESCE((u.obs->'center'->>'x')::numeric, 0),
                     'y', COALESCE((u.obs->'center'->>'y')::numeric, 0),
                     'coordinateSystem', 'normalized_image_0_1000'
                   )
                   ELSE NULL
              END,
    'planeType', NULL,
    'pitchDegrees', NULL,
    'azimuthDegrees', NULL,
    'normalVector', NULL,
    'areaSqM', COALESCE(
      (u.obs->>'areaNormalized')::numeric,
      (u.obs->>'area_normalized')::numeric,
      0
    ),
    'inlierCount', NULL,
    'totalPoints', NULL,
    'lineSubtype', NULL,
    'estimatedLengthM', NULL,
    'obstructionSubtype', COALESCE(u.obs->>'obstructionType', u.obs->>'obstruction_type', 'other'),
    'radiusM', NULL,
    'setbackM', NULL,
    'heightFt', NULL,
    'roofPlaneId', NULL,
    'cadImpact', jsonb_build_object(
      'canAffectPanelPlacement', COALESCE((u.obs->>'canAffectPanelPlacement')::boolean, false),
      'canAffectFirePathway', COALESCE((u.obs->>'canAffectFirePathway')::boolean, false),
      'canAffectConduitPath', COALESCE((u.obs->>'canAffectConduitPath')::boolean, false),
      'canAffectStructuralAttachment', COALESCE((u.obs->>'canAffectStructuralAttachment')::boolean, false),
      'layoutAvoidancePriority', COALESCE(u.obs->>'priority', 'medium'),
      'cadBlockHint', COALESCE(u.obs->>'cadBlockHint', 'unknown'),
      'obstructionFootprintHint', COALESCE(u.obs->>'obstructionFootprintHint', 'unknown'),
      'clearanceRadiusHint', COALESCE(u.obs->>'clearanceRadiusHint', 'unknown')
    ),
    'electricalSubtype', NULL,
    'story', NULL,
    'isPrimaryInterconnect', NULL,
    'depthResolution', NULL,
    'depthMetric', NULL,
    'consensusPhotoCount', NULL,
    'segmentationClass', NULL,
    'reviewState', CASE COALESCE(u.obs->>'reviewState', u.obs->>'review_state', 'review_required')
                   WHEN 'accepted' THEN 'accepted'
                   WHEN 'rejected' THEN 'rejected'
                   ELSE 'review_required'
              END,
    'reviewNotes', NULL,
    'priority', COALESCE(u.obs->>'priority', 'medium'),
    'stageTimings', NULL,
    'isSynthetic', true,
    'obstructionMetadata', u.obs
  ),
  -- obstruction_metadata: store the raw obstruction object as-is
  u.obs,
  -- review_state
  CASE COALESCE(u.obs->>'reviewState', u.obs->>'review_state', 'review_required')
    WHEN 'accepted' THEN 'accepted'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'review_required'
  END,
  -- priority
  COALESCE(u.obs->>'priority', 'medium'),
  -- mock_artifact
  FALSE,
  -- created_at, updated_at
  NOW()::timestamptz,
  NOW()::timestamptz
FROM unnested u
WHERE NOT EXISTS (
  SELECT 1 FROM unified_geometry_artifacts
  WHERE geometry_class = 'obstruction'
    AND obstruction_metadata IS NOT NULL
)
ON CONFLICT (id) DO NOTHING;
