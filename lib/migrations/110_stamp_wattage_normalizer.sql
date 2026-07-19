-- Migration 110: per-panel stamp-wattage normalizer (run AFTER 109).
--
-- WHY (DATA-AUTHORITY-AUDIT P0-6): layouts.panels[].wattage stamps are poisoned at
-- the source — the studio stamped hardcoded literals instead of the chosen panel's
-- equipment-db watts. Live truth 2026-07-19:
--   • Stowell 4d720c49: ground 16/16 stamped 405 (map longi-himo6-580 → 580 W, 43%
--     error) and fence 18/18 stamped 430 (map panel-fence-ps1 → 440 W);
--   • Braidon 4030b664: roof 31/31 stamped 440 (map rec-alpha-pure-405 → 405 W,
--     8.6% oversell);
--   • systemic 430-stamped fence panels across the fleet (hardcoded
--     SolarEngine3D.tsx:5007) — projects that received maps via migration 109 are
--     normalized here too (fence → panel-fence-ps1 → 440 W per Ray's 2026-07-19
--     ruling: the SolFence fence uses ONLY the Philadelphia Solar PS-MNB108(HCBF)
--     440W panel).
--
-- WHAT: for EVERY layout row of a non-deleted project that has a subSystems map
-- (engineering_config first, selected_equipment as per-key fallback — same
-- precedence as the runtime nameplate resolver), re-stamp each panel element's
-- `wattage` from the map's panelId watts (equipment-db values inlined below).
-- Panels whose sub key has no map entry (or an unresolvable panelId) keep their
-- stamp — the map never guesses. Panel order and every other field are preserved.
--
-- SAFETY / IDEMPOTENCE: only layouts with >= 1 actually-differing wattage are
-- updated (a second run selects zero rows). No DO blocks; runnable via
-- Admin → System Tools → Run migration.
--
-- VERIFY AFTER RUN (Stowell should show ground 580 / fence 440 / roof 405):
--   SELECT CASE
--            WHEN upper(COALESCE(pe->>'placementType','')) = 'FENCE'
--              OR lower(COALESCE(pe->>'systemType','')) IN ('fence','solar_fence') THEN 'fence'
--            WHEN upper(COALESCE(pe->>'placementType','')) = 'GROUND'
--              OR lower(COALESCE(pe->>'systemType','')) IN ('ground','ground_mount') THEN 'ground'
--            ELSE 'roof' END AS sub, pe->>'wattage' AS w, COUNT(*)
--   FROM layouts, jsonb_array_elements(panels) pe
--   WHERE project_id = '4d720c49-2703-441a-97d3-c7b83ed703da'
--   GROUP BY 1, 2 ORDER BY 1;

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
rebuilt AS (
  SELECT l.id AS layout_id,
         jsonb_agg(
           CASE WHEN wt.watts IS NOT NULL
                     AND (NOT (pe ? 'wattage')
                          OR NOT ((pe->>'wattage') ~ '^[0-9]+(\.[0-9]+)?$')
                          OR (pe->>'wattage')::numeric <> wt.watts)
                THEN jsonb_set(pe, '{wattage}', to_jsonb(wt.watts))
                ELSE pe
           END
           ORDER BY a.ord
         ) AS new_panels,
         COUNT(*) FILTER (
           WHERE wt.watts IS NOT NULL
             AND (NOT (pe ? 'wattage')
                  OR NOT ((pe->>'wattage') ~ '^[0-9]+(\.[0-9]+)?$')
                  OR (pe->>'wattage')::numeric <> wt.watts)
         ) AS changed
  FROM layouts l
  JOIN mapped_projects mp ON mp.project_id = l.project_id
  CROSS JOIN LATERAL jsonb_array_elements(l.panels) WITH ORDINALITY AS a(pe, ord)
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN upper(COALESCE(a.pe->>'placementType','')) = 'FENCE'
               OR lower(COALESCE(a.pe->>'systemType','')) IN ('fence','solar_fence') THEN 'fence'
             WHEN upper(COALESCE(a.pe->>'placementType','')) = 'GROUND'
               OR lower(COALESCE(a.pe->>'systemType','')) IN ('ground','ground_mount') THEN 'ground'
             ELSE 'roof'
           END AS sub_key
  ) k
  LEFT JOIN watts_table wt
    ON wt.panel_id = COALESCE(mp.eng -> k.sub_key ->> 'panelId',
                              mp.sel -> k.sub_key ->> 'panelId')
  WHERE jsonb_typeof(l.panels) = 'array' AND jsonb_array_length(l.panels) > 0
  GROUP BY l.id
)
UPDATE layouts l
SET panels = r.new_panels,
    updated_at = NOW()
FROM rebuilt r
WHERE l.id = r.layout_id
  AND r.changed > 0;
