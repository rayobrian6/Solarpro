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
-- Idempotency guards:
--   1. Skips if the obstruction_metadata column does not exist yet
--      (requires Migration 081 to have run first).
--   2. Skips if unified_geometry_artifacts already has obstruction-class
--      rows with obstruction_metadata IS NOT NULL (the inline /api/migrate
--      route checks COUNT(*) of such rows).
--   3. Uses ON CONFLICT (id) DO NOTHING on every INSERT so re-runs are safe.
--
-- IMPORTANT DIFFERENCES FROM INLINE DDL (app/api/migrate/route.ts):
--   The inline migration uses JavaScript procedural logic:
--     - Iterates over obsData.obstructions array with for...of
--     - Builds geometryData and provenance objects via JS object literals
--     - Uses Math.min/Math.max for confidence clamping (0–1 range)
--     - Converts confidence from 0–100 scale to 0–1 scale
--     - Uses row-by-row try/catch for individual insert failures
--     - Generates IDs as: obs.id ?? 'backfill-{survey_id}-{counter}'
--       (counter is a JS runtime variable, not reproducible in pure SQL)
--     - Stores the raw obs object as obstruction_metadata
--
--   This SQL file expresses the same backfill using:
--     - jsonb_array_elements to unnest the obstructions array
--     - jsonb_build_object for structured columns
--     - LEAST/GREATEST for confidence clamping
--     - COALESCE(obs->>'id', ...) for ID generation
--     - The raw obs JSONB as obstruction_metadata directly
--
--   The inline /api/migrate route remains the authoritative runtime executor.
--   This SQL file is the source-of-truth documentation for the migration's
--   schema and data intent. Running this file directly is equivalent in
--   outcome but differs in error handling (SQL stops on first error per
--   statement, whereas the inline route catches and continues per row).
--
--   NOTE: The inline route generates IDs using a JS counter variable when
--   obs.id is null: 'backfill-{survey_id}-{counter}'. In pure SQL, we use
--   ROW_NUMBER() over the unnested result set to produce a stable equivalent.
-- ============================================================================

-- Guard: skip if obstruction_metadata column does not exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unified_geometry_artifacts'
      AND column_name = 'obstruction_metadata'
  ) THEN
    RAISE NOTICE 'Migration 082: obstruction_metadata column not yet created — skipping backfill';
  END IF;
END $$;

-- Guard: skip if backfill already completed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'unified_geometry_artifacts'
      AND column_name = 'obstruction_metadata'
  ) THEN
    IF (SELECT COUNT(*) FROM unified_geometry_artifacts
        WHERE geometry_class = 'obstruction' AND obstruction_metadata IS NOT NULL) > 0 THEN
      RAISE NOTICE 'Migration 082: obstruction backfill — already completed';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- Backfill: site_survey_files.obstruction_data → unified_geometry_artifacts
-- ============================================================================
-- Unnest the obstructions array from each site_survey_file row, then build
-- the full geometry_data and provenance JSONB and insert as an obstruction
-- artifact with derived_review_only authority.
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
ON CONFLICT (id) DO NOTHING;
