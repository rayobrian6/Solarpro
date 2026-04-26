-- ============================================================
-- Migration 013: project_physical_data (v47.438)
--
-- Creates the project_physical_data table — the single source
-- of truth for the actual physical + electrical reality of a
-- property.
--
-- ARCHITECTURE:
--   Survey  WRITES to this table.
--   Engineering READS from this table.
--   Future systems (manual override, API, office entry) may
--   also update it.
--
-- This is NOT survey_data. This is NOT site_conditions.
-- site_conditions = jurisdiction/environmental (wind, snow, NEC)
-- project_physical_data = physical + electrical reality of the property
--
-- All additive. IF NOT EXISTS guards make this safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_physical_data (
  -- --------------------------------------------------------
  -- Core
  -- --------------------------------------------------------
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Source of this record:
  --   'survey'   - written by the ingest pipeline from a completed survey
  --   'manual'   - entered manually by office staff
  --   'api'      - written by an external system
  --   'override' - manually overridden after survey (corrects bad field data)
  source                  TEXT          NOT NULL DEFAULT 'survey'
                            CHECK (source IN ('survey', 'manual', 'api', 'override')),

  -- --------------------------------------------------------
  -- Structure / Roof
  -- Engineering reads: roofType, rafterSpacingIn, roofPitch
  -- --------------------------------------------------------

  -- Enum values mirror RoofMaterial in lib/survey/v2/types.ts:
  --   comp_shingle | tile_concrete | tile_clay | metal_standing_seam |
  --   metal_r_panel | flat_tpo | flat_epdm | flat_torch | wood_shake | other
  roof_material           TEXT,

  -- Enum values mirror RoofPitch in lib/survey/v2/types.ts:
  --   flat | low | standard | steep | very_steep
  roof_pitch              TEXT,

  -- Numeric rafter spacing in inches (16 or 24 are standard values).
  -- Engineering reads this directly for structural calculations.
  rafter_spacing_in       INTEGER,

  -- Enum: good | fair | poor
  roof_condition          TEXT,

  -- Age of roof in years. Engineering uses for permit flagging.
  roof_age_years          INTEGER,

  -- Whether the attic is accessible. Engineering uses for wire routing decisions.
  attic_access            BOOLEAN,

  -- --------------------------------------------------------
  -- Electrical
  -- Engineering reads: panel_rating_amps → mainPanelBusAmps
  --                    interconnection_point → interconnectionType
  -- --------------------------------------------------------
  panel_brand             TEXT,

  -- Numeric panel bus rating in amps.
  -- Maps PanelRating enum ('100','150','200','225','320','400','other') → integer.
  -- Engineering uses this to determine load-side vs supply-side interconnection
  -- per NEC 705.12(B): backfeed breaker must be ≤ 20% of bus rating.
  panel_rating_amps       INTEGER,

  -- Number of available breaker slots.
  -- Stored as text to preserve the range values ('0','1-2','3-4','5+').
  available_breaker_slots TEXT,

  -- Enum: standard | combo | 320a | other
  meter_socket_type       TEXT,

  -- Enum: main_panel | sub_panel | load_side | supply_side
  interconnection_point   TEXT,

  -- Enum: overhead | underground
  service_entrance_type   TEXT,

  has_sub_panel           BOOLEAN,

  -- Sub-panel bus rating in amps (same mapping as panel_rating_amps).
  sub_panel_rating_amps   INTEGER,

  -- --------------------------------------------------------
  -- Constraints
  -- --------------------------------------------------------

  -- JSONB array of obstruction objects: { id, type, location, notes }
  -- Engineering uses for CAD layout and usable roof area calculation.
  obstructions            JSONB         NOT NULL DEFAULT '[]'::jsonb,

  -- 0-100 percent of roof area usable for solar array.
  -- Engineering uses for final panel count cap and CAD layout.
  usable_roof_pct         INTEGER
                            CHECK (usable_roof_pct IS NULL OR (usable_roof_pct >= 0 AND usable_roof_pct <= 100)),

  -- --------------------------------------------------------
  -- Survey Metadata
  -- These fields do not drive engineering calculations but are
  -- required for audit, permit packages, and QA review.
  -- --------------------------------------------------------
  inspector_name          TEXT,
  surveyed_at             TIMESTAMPTZ,
  access_notes            TEXT,
  mounting_notes          TEXT,
  electrical_notes        TEXT,

  -- --------------------------------------------------------
  -- Site Overview (structural context for permit plan sets)
  -- --------------------------------------------------------
  structure_type          TEXT,    -- residential | commercial | industrial
  stories                 TEXT,    -- '1' | '2' | '3+'

  -- --------------------------------------------------------
  -- Timestamps
  -- --------------------------------------------------------
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- One record per project. A project has exactly one
-- current physical data record. ON CONFLICT allows the
-- ingest pipeline to upsert safely on re-submission.
-- --------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_physical_data_project_id
  ON project_physical_data(project_id);

-- --------------------------------------------------------
-- Indexes for engineering read patterns
-- --------------------------------------------------------

-- Engineering lookup by project_id (primary read pattern)
CREATE INDEX IF NOT EXISTS idx_project_physical_data_source
  ON project_physical_data(source);

-- --------------------------------------------------------
-- updated_at trigger
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION update_project_physical_data_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_physical_data_updated_at ON project_physical_data;
CREATE TRIGGER trg_project_physical_data_updated_at
  BEFORE UPDATE ON project_physical_data
  FOR EACH ROW
  EXECUTE FUNCTION update_project_physical_data_updated_at();

-- ============================================================
-- Notes for engineering integration (reportGenerator.ts)
-- ============================================================
--
-- When generateStructuralEngineering() runs:
--   SELECT * FROM project_physical_data WHERE project_id = $1
--   Use roof_material      → roofType        (default: 'Asphalt Shingle' if NULL)
--   Use rafter_spacing_in  → rafterSpacingIn (default: 24 if NULL)
--   Use roof_pitch         → pitchDegrees    (via enum map if NULL, fall back to snap value)
--
-- When generateElectricalEngineering() runs:
--   Use panel_rating_amps  → mainPanelBusAmps       (default: 200 if NULL)
--   Use interconnection_point → interconnectionType (hint, overrides NEC calc if set)
--
-- ============================================================