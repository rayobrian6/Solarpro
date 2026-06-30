-- Migration 098: Repair cross-project coordinate contamination in `layouts`.
--
-- WHY: A full DB audit (2026-06-30) found layouts whose saved panel geometry sits in a
-- DIFFERENT CITY OR STATE than the project's geocoded address — geometry from one project
-- persisted under another project_id (stale design state on project-switch, copied
-- templates, etc.). These corrupt the planset: PV-1/PV-2 render the wrong roof and the
-- aerial frames the wrong location. The upsertLayout coordinate-integrity guard
-- (lib/db/projects.ts) prevents any NEW contamination; this migration repairs the rows
-- already corrupted so they don't keep producing wrong plansets.
--
-- WHAT: For every layout whose panel centroid is more than 5 km from its project's
-- geocoded address, clear the mismatched geometry (panels + roof_planes). The affected
-- design must then be re-traced on the correct address (the cleared geometry was on the
-- wrong location and was unusable anyway). Old geometry remains recoverable from
-- project_versions history if ever needed.
--
-- SAFETY: 5 km threshold only catches cross-location contamination — a legitimately
-- placed array is always within ~200 m of its address. Phoenix-placeholder geocodes
-- (33.4484, -112.0740) are skipped (can't be validated). Idempotent: once geometry is
-- cleared the centroid no longer computes, so re-running this migration is a no-op.
-- No DO blocks; runnable via Admin → System Tools → Run migration.

WITH centroids AS (
  SELECT
    l.id,
    p.lat AS plat,
    p.lng AS plng,
    AVG((pe->>'lat')::float8) AS clat,
    AVG((pe->>'lng')::float8) AS clng
  FROM layouts l
  JOIN projects p ON p.id = l.project_id
  CROSS JOIN LATERAL jsonb_array_elements(l.panels) AS pe
  WHERE jsonb_typeof(l.panels) = 'array'
    AND jsonb_array_length(l.panels) > 0
    AND (pe->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND (pe->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND ABS((pe->>'lat')::float8) > 0.001
    AND p.lat IS NOT NULL AND p.lng IS NOT NULL AND ABS(p.lat) > 0.001
    -- Skip Phoenix-placeholder project geocodes — cannot validate against them.
    AND NOT (ABS(p.lat - 33.4484) < 0.01 AND ABS(p.lng - (-112.0740)) < 0.01)
  GROUP BY l.id, p.lat, p.lng
),
mismatched AS (
  SELECT id
  FROM centroids
  WHERE sqrt(
          power((clat - plat) * 111320.0, 2) +
          power((clng - plng) * 111320.0 * cos(radians(clat)), 2)
        ) > 5000.0
)
UPDATE layouts
SET panels         = '[]'::jsonb,
    roof_planes    = '[]'::jsonb,
    total_panels   = 0,
    system_size_kw = 0,
    updated_at     = NOW()
WHERE id IN (SELECT id FROM mismatched);
