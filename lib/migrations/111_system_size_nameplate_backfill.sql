-- Migration 111: system-size nameplate backfill (run AFTER 109 + 110).
--
-- WHY (DATA-AUTHORITY-AUDIT P0-7): ONE project stored FOUR contradictory system
-- sizes — layouts.system_size_kw 36.09 (poisoned stamp sum), projects.system_size_kw
-- 37.251 (provenance unknown), engineering_runs 39.07 (truth), permit-input 38.72
-- (panel0 flat math). The code fix routes every save through the ONE nameplate
-- function (lib/system/nameplate.ts, wired into upsertLayout); this migration
-- repairs the ALREADY-STORED rows for every project that has a subSystems map.
--
-- WHAT — mirrors the nameplate rule exactly:
--   per panel: watts = subSystems[stamp-classified key].panelId → equipment-db watts
--              (engineering_config first, selected_equipment per-key fallback);
--              when the map lacks the sub (or the id is unknown), FALLBACK to the
--              panel's own stamp wattage, else 400 (legacy default).
--   layouts.system_size_kw  = ROUND(Σ watts / 1000, 2)  — every layout row.
--   projects.system_size_kw = the NEWEST layout's recomputed value.
--   (After migration 110 normalized the stamps, map-watts and stamp-watts agree —
--   the fallback only fires for subs the conservative 109 inference skipped.)
--
-- Expected: Stowell 4d720c49 → 39.07 (54×405 + 16×580 + 18×440); Braidon 4030b664
-- → 12.56 (31×405 = 12555 W; SQL ROUND is half-up. NOTE: the runtime nameplate
-- function keeps legacy JS toFixed parity and yields 12.55 at this exact
-- half-cent boundary — the next layout save settles such rows to the JS value,
-- a one-time ±0.01 formatting difference, never a data contradiction).
--
-- SAFETY / IDEMPOTENCE: only rows whose stored value differs are updated
-- (IS DISTINCT FROM); a second run updates zero rows. Map-less projects are NOT
-- touched. No DO blocks; runnable via Admin → System Tools → Run migration.
--
-- VERIFY AFTER RUN:
--   SELECT p.id, p.name, p.system_size_kw AS proj_kw, l.system_size_kw AS layout_kw
--   FROM projects p JOIN layouts l ON l.project_id = p.id
--   WHERE COALESCE(p.engineering_config->'subSystems', p.selected_equipment->'subSystems') IS NOT NULL
--   ORDER BY p.updated_at DESC;
--   -- proj_kw and layout_kw must AGREE per project (Stowell 39.07, Braidon 12.56).

WITH watts_table(panel_id, watts) AS (
  VALUES
    ('tesla-tsp-420', 420), ('tesla-tsp-415', 415), ('sp-maxeon7-440', 440),
    ('sp-maxeon6-400', 400), ('sp-maxeon3-400', 400), ('rec-alpha-pure-430', 430),
    ('rec-alpha-pure-405', 405), ('pan-evervolt-410', 410), ('jinko-tiger-neo-580', 580),
    ('cs-hiku7-600', 600), ('longi-himo6-580', 580), ('trina-vertex-s-435', 435),
    ('qcells-peak-duo-400', 400), ('silfab-sil430', 430), ('panel-fence-ps1', 440),
    ('panel-std440', 440), ('panel-jk2', 610), ('panel-jk3', 545), ('panel-cs2', 620),
    ('panel-cs3', 430), ('panel-lo2', 615), ('panel-tr2', 600), ('panel-qc2', 430),
    ('panel-ax1', 420), ('panel-hq1', 500), ('panel-sol1', 400), ('panel-ms1', 400),
    ('panel-bv1', 420), ('panel-as1', 580), ('panel-fence1', 400), ('panel-fence2', 440),
    ('panel-fence3', 420)
),
mapped_projects AS (
  SELECT p.id AS project_id,
         COALESCE(p.engineering_config -> 'subSystems', '{}'::jsonb) AS eng,
         COALESCE(p.selected_equipment -> 'subSystems', '{}'::jsonb) AS sel
  FROM projects p
  WHERE p.deleted_at IS NULL
    AND (COALESCE(p.engineering_config -> 'subSystems', '{}'::jsonb) <> '{}'::jsonb
      OR COALESCE(p.selected_equipment -> 'subSystems', '{}'::jsonb) <> '{}'::jsonb)
),
recomputed AS (
  SELECT l.id AS layout_id, l.project_id, l.updated_at,
         ROUND(SUM(
           COALESCE(
             wt.watts::numeric,                                        -- map-authoritative
             CASE WHEN (pe->>'wattage') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (pe->>'wattage')::numeric END,                  -- stamp fallback
             400                                                       -- legacy default
           )
         ) / 1000.0, 2) AS kw
  FROM layouts l
  JOIN mapped_projects mp ON mp.project_id = l.project_id
  CROSS JOIN LATERAL jsonb_array_elements(l.panels) AS pe
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN upper(COALESCE(pe->>'placementType','')) = 'FENCE'
               OR lower(COALESCE(pe->>'systemType','')) IN ('fence','solar_fence') THEN 'fence'
             WHEN upper(COALESCE(pe->>'placementType','')) = 'GROUND'
               OR lower(COALESCE(pe->>'systemType','')) IN ('ground','ground_mount') THEN 'ground'
             ELSE 'roof'
           END AS sub_key
  ) k
  LEFT JOIN watts_table wt
    ON wt.panel_id = COALESCE(mp.eng -> k.sub_key ->> 'panelId',
                              mp.sel -> k.sub_key ->> 'panelId')
  WHERE jsonb_typeof(l.panels) = 'array' AND jsonb_array_length(l.panels) > 0
  GROUP BY l.id, l.project_id, l.updated_at
),
upd_layouts AS (
  UPDATE layouts l
  SET system_size_kw = r.kw,
      updated_at = NOW()
  FROM recomputed r
  WHERE l.id = r.layout_id
    AND l.system_size_kw IS DISTINCT FROM r.kw
  RETURNING l.id
),
newest AS (
  SELECT DISTINCT ON (project_id) project_id, kw
  FROM recomputed
  ORDER BY project_id, updated_at DESC
)
UPDATE projects p
SET system_size_kw = n.kw,
    updated_at = NOW()
FROM newest n
WHERE p.id = n.project_id
  AND p.system_size_kw IS DISTINCT FROM n.kw;
