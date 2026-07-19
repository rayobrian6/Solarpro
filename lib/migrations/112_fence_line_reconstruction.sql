-- Migration 112: fence_line reconstruction from fence-panel positions.
--
-- WHY (DATA-AUTHORITY-AUDIT P1-14): layouts carry >= 2 fence-stamped panels but an
-- EMPTY fence_line (the 07-16 wipe recovery restored panels, not the line; live
-- probe 2026-07-19: Stowell 4d720c49 has 18 collinear fence panels + fence_line
-- NULL, plus ~15 more fence layouts fleet-wide). Sheets and geometry consumers
-- that read fence_line see no fence.
--
-- WHAT: for every layout with >= 2 fence-stamped panels and an empty/absent
-- fence_line, rebuild fence_line as the least-squares line through the fence
-- panels' lat/lng positions:
--   • positions are scaled to a locally isotropic frame (lng × cos(mean lat)) so
--     the fit is correct in meters, not degrees;
--   • the axis is the TOTAL-least-squares principal direction
--     (theta = ½·atan2(2·cov(y,x), var(x) − var(y)) — orthogonal regression, so
--     N-S fences are as stable as E-W ones);
--   • endpoints = the min/max projections of the panel centers onto that axis,
--     mapped back to lat/lng — ORDERED (t_min → t_max, deterministic);
--   • written as the canonical 2-point [{lat,lng},{lat,lng}] jsonb array
--     (types/index.ts Layout.fenceLine shape).
--
-- CONSERVATIVE GUARD: layouts whose fence panels deviate more than 2.5 m
-- (orthogonal residual) from the fitted line are SKIPPED — a multi-segment or
-- L-shaped fence cannot be honestly represented by one line and must be re-traced
-- in the studio. Those rows keep fence_line empty (query below lists them).
--
-- SAFETY / IDEMPOTENCE: only empty/absent fence_line rows are selected — once
-- written, a row is never re-selected. Existing (user-drawn) fence lines are
-- NEVER modified. No DO blocks; runnable via Admin → System Tools → Run migration.
--
-- VERIFY AFTER RUN:
--   -- reconstructed lines:
--   SELECT project_id, id, fence_line FROM layouts
--   WHERE jsonb_typeof(fence_line) = 'array' AND jsonb_array_length(fence_line) = 2;
--   -- still-empty fence layouts (non-collinear → need studio re-trace):
--   SELECT l.project_id, l.id, COUNT(*) AS fence_panels
--   FROM layouts l, jsonb_array_elements(l.panels) pe
--   WHERE (upper(COALESCE(pe->>'placementType','')) = 'FENCE'
--          OR lower(COALESCE(pe->>'systemType','')) IN ('fence','solar_fence'))
--     AND (l.fence_line IS NULL OR jsonb_typeof(l.fence_line) <> 'array'
--          OR jsonb_array_length(l.fence_line) < 2)
--   GROUP BY 1, 2 HAVING COUNT(*) >= 2;

WITH fence_pts AS (
  SELECT l.id AS layout_id,
         (pe->>'lat')::float8 AS lat,
         (pe->>'lng')::float8 AS lng
  FROM layouts l
  CROSS JOIN LATERAL jsonb_array_elements(l.panels) AS pe
  WHERE jsonb_typeof(l.panels) = 'array'
    AND (l.fence_line IS NULL
         OR jsonb_typeof(l.fence_line) <> 'array'
         OR jsonb_array_length(l.fence_line) < 2)
    AND (upper(COALESCE(pe->>'placementType','')) = 'FENCE'
         OR lower(COALESCE(pe->>'systemType','')) IN ('fence','solar_fence'))
    AND (pe->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND (pe->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND ABS((pe->>'lat')::float8) > 0.001
),
centers AS (
  SELECT layout_id, COUNT(*) AS n,
         AVG(lat) AS mlat, AVG(lng) AS mlng,
         cos(radians(AVG(lat))) AS coslat
  FROM fence_pts
  GROUP BY layout_id
  HAVING COUNT(*) >= 2
),
scaled AS (
  SELECT f.layout_id,
         (f.lng - c.mlng) * c.coslat AS x,   -- isotropic degrees (east)
         (f.lat - c.mlat)            AS y,   -- degrees (north)
         c.mlat, c.mlng, c.coslat
  FROM fence_pts f
  JOIN centers c ON c.layout_id = f.layout_id
),
axis AS (
  SELECT layout_id, mlat, mlng, coslat,
         0.5 * atan2(2.0 * covar_pop(y, x), var_pop(x) - var_pop(y)) AS theta
  FROM scaled
  GROUP BY layout_id, mlat, mlng, coslat
),
projected AS (
  SELECT s.layout_id, a.mlat, a.mlng, a.coslat, a.theta,
         s.x * cos(a.theta) + s.y * sin(a.theta)        AS t,
         ABS(-s.x * sin(a.theta) + s.y * cos(a.theta))  AS ortho_resid
  FROM scaled s
  JOIN axis a ON a.layout_id = s.layout_id
),
lines AS (
  SELECT layout_id, mlat, mlng, coslat, theta,
         MIN(t) AS t_min, MAX(t) AS t_max,
         MAX(ortho_resid) AS max_resid
  FROM projected
  GROUP BY layout_id, mlat, mlng, coslat, theta
)
UPDATE layouts l
SET fence_line = jsonb_build_array(
      jsonb_build_object(
        'lat', li.mlat + li.t_min * sin(li.theta),
        'lng', li.mlng + (li.t_min * cos(li.theta)) / li.coslat
      ),
      jsonb_build_object(
        'lat', li.mlat + li.t_max * sin(li.theta),
        'lng', li.mlng + (li.t_max * cos(li.theta)) / li.coslat
      )
    ),
    updated_at = NOW()
FROM lines li
WHERE l.id = li.layout_id
  AND li.t_max > li.t_min                    -- degenerate (all panels coincident) → skip
  AND li.max_resid * 111320.0 <= 2.5;        -- collinearity guard: <= 2.5 m orthogonal deviation
