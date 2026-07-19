-- Migration 109: subSystems-map inference backfill for map-less stamp-hybrid projects.
--
-- WHY (DATA-AUTHORITY-AUDIT P2-6): 5 projects whose layouts carry MIXED per-panel
-- systemType stamps (>= 2 of roof/ground/fence — the §1.1 membership truth) have NO
-- per-subsystem equipment map in either projects.engineering_config.subSystems or
-- projects.selected_equipment.subSystems (live probe 2026-07-19: Markulis bbfd994f
-- roof31/ground34/fence30, "New Client" b981f172 roof198/fence42, "Scam Likley"
-- 4970c984 roof399/fence95, + any Carpenter/Sol-Fence-quote rows whose stamps mix).
-- Without a map, every downstream consumer falls back to poisoned stamp wattage and
-- project-wide single-panel scalars.
--
-- WHAT: for every non-deleted project whose NEWEST layout has >= 2 distinct stamped
-- sub keys AND no subSystems map anywhere, write a CONSERVATIVE map — only panelId
-- (+ mountingId for fence), source='migration' — into BOTH owners:
--   • projects.engineering_config.subSystems   (doctrine owner)
--   • projects.selected_equipment.subSystems   (hydration mirror, + schemaVersion 2
--     so upsertSelectedEquipment's v2 envelope guard protects it from legacy writes)
--
-- INFERENCE RULE (conservative, per register):
--   fence  → 'panel-fence-ps1' (Philadelphia Solar PS-MNB108(HCBF) 440W).
--            RAY'S RULING 2026-07-19: the SolFence fence uses ONLY this panel.
--            mountingId 'solfence-8ft' (Wave 6.1 canonical fence racking).
--   roof / ground →
--     1. the layout's design_electrical.panelId IF it resolves in equipment-db AND
--        its catalog watts equal the sub's stamp-majority wattage (consistency), else
--     2. 'rec-alpha-pure-405' IF the stamp-majority wattage is 405 (the ONLY 405 W
--        panel in equipment-db — unambiguous), else
--     3. NO ENTRY for that sub (nameplate falls back to stamps with a warn — we never
--        guess between multiple same-wattage catalog panels).
--   The equipment-db id→watts table is inlined below (source: lib/equipment-db.ts
--   SOLAR_PANELS @ 2026-07-19).
--
-- SAFETY / IDEMPOTENCE: TWO sequential statements (the runner splits on ';' and
-- executes both in one transaction). Statement 1 infers + writes ONLY
-- engineering_config.subSystems for the truly mapless set; statement 2 MIRRORS a
-- migration-sourced engineering map into selected_equipment where that side is
-- still empty. Updating both columns of the same rows inside ONE statement (CTE +
-- outer UPDATE) is unsupported in Postgres — one write can be silently lost
-- (verify-lead F2, 2026-07-19) — and a both-empty gate could never repair a
-- partial write. With independent gates a rerun repairs either missing half and
-- a full rerun selects zero rows. Existing maps are NEVER modified. No DO blocks.
--
-- VERIFY AFTER RUN:
--   SELECT p.id, p.name,
--          p.engineering_config->'subSystems' AS eng_map,
--          p.selected_equipment->'subSystems' AS sel_map
--   FROM projects p WHERE p.engineering_config ? 'subSystems' OR p.selected_equipment ? 'subSystems';

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
newest_layout AS (
  SELECT DISTINCT ON (l.project_id)
         l.project_id, l.id AS layout_id, l.panels, l.design_electrical
  FROM layouts l
  WHERE jsonb_typeof(l.panels) = 'array' AND jsonb_array_length(l.panels) > 0
  ORDER BY l.project_id, l.updated_at DESC
),
mapless AS (
  SELECT p.id AS project_id, nl.layout_id, nl.panels, nl.design_electrical
  FROM projects p
  JOIN newest_layout nl ON nl.project_id = p.id
  WHERE p.deleted_at IS NULL
    AND COALESCE(p.engineering_config -> 'subSystems', '{}'::jsonb) = '{}'::jsonb
    AND COALESCE(p.selected_equipment -> 'subSystems', '{}'::jsonb) = '{}'::jsonb
),
stamped AS (
  SELECT m.project_id, m.design_electrical,
         CASE
           WHEN upper(COALESCE(pe->>'placementType','')) = 'FENCE'
             OR lower(COALESCE(pe->>'systemType','')) IN ('fence','solar_fence') THEN 'fence'
           WHEN upper(COALESCE(pe->>'placementType','')) = 'GROUND'
             OR lower(COALESCE(pe->>'systemType','')) IN ('ground','ground_mount') THEN 'ground'
           ELSE 'roof'
         END AS sub_key,
         CASE WHEN (pe->>'wattage') ~ '^[0-9]+(\.[0-9]+)?$'
              THEN (pe->>'wattage')::numeric ELSE NULL END AS stamp_watts
  FROM mapless m
  CROSS JOIN LATERAL jsonb_array_elements(m.panels) AS pe
),
majority AS (
  -- stamp-majority wattage per (project, sub); ties broken by higher wattage
  SELECT DISTINCT ON (project_id, sub_key)
         project_id, sub_key, design_electrical, stamp_watts AS maj_watts, COUNT(*) AS n
  FROM stamped
  GROUP BY project_id, sub_key, design_electrical, stamp_watts
  ORDER BY project_id, sub_key, COUNT(*) DESC, stamp_watts DESC NULLS LAST
),
hybrid AS (
  SELECT project_id FROM majority GROUP BY project_id HAVING COUNT(DISTINCT sub_key) >= 2
),
inferred AS (
  SELECT mj.project_id, mj.sub_key,
         CASE
           WHEN mj.sub_key = 'fence' THEN 'panel-fence-ps1'
           WHEN de_wt.watts IS NOT NULL AND de_wt.watts = mj.maj_watts
             THEN mj.design_electrical ->> 'panelId'
           WHEN mj.maj_watts = 405 THEN 'rec-alpha-pure-405'
           ELSE NULL
         END AS panel_id
  FROM majority mj
  JOIN hybrid h ON h.project_id = mj.project_id
  LEFT JOIN watts_table de_wt ON de_wt.panel_id = mj.design_electrical ->> 'panelId'
),
maps AS (
  SELECT project_id,
         jsonb_object_agg(
           sub_key,
           jsonb_build_object(
             'key', sub_key,
             'panelId', panel_id,
             'source', 'migration',
             'updatedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) ||
           CASE WHEN sub_key = 'fence'
                THEN jsonb_build_object('mountingId', 'solfence-8ft')
                ELSE '{}'::jsonb END
         ) AS sub_map
  FROM inferred
  WHERE panel_id IS NOT NULL
  GROUP BY project_id
)
-- STATEMENT 1: infer → engineering_config.subSystems (doctrine owner) only.
UPDATE projects p
SET engineering_config = jsonb_set(
      COALESCE(p.engineering_config, '{}'::jsonb), '{subSystems}', m.sub_map),
    updated_at = NOW()
FROM maps m
WHERE p.id = m.project_id
  AND COALESCE(p.engineering_config -> 'subSystems', '{}'::jsonb) = '{}'::jsonb;

-- STATEMENT 2: mirror a MIGRATION-SOURCED engineering map into
-- selected_equipment where that side is still empty (covers this run's writes
-- AND repairs a prior partial run). Never touches maps a human/studio wrote.
UPDATE projects p
SET selected_equipment = jsonb_set(
      COALESCE(p.selected_equipment, '{}'::jsonb)
        || jsonb_build_object('schemaVersion', 2),
      '{subSystems}', p.engineering_config -> 'subSystems'),
    updated_at = NOW()
WHERE p.deleted_at IS NULL
  AND COALESCE(p.selected_equipment -> 'subSystems', '{}'::jsonb) = '{}'::jsonb
  AND COALESCE(p.engineering_config -> 'subSystems', '{}'::jsonb) <> '{}'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_each(p.engineering_config -> 'subSystems') e
    WHERE e.value ->> 'source' = 'migration'
  );
