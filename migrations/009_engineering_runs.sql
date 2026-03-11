-- ============================================================
-- Migration 009: Engineering Runs — Reverse State Loading
-- Stores a structured config snapshot for every engineering run
-- so files can be traced back to the exact system configuration
-- that generated them.
-- ============================================================

-- engineering_runs: one row per engineering calc run
CREATE TABLE IF NOT EXISTS engineering_runs (
  id                    VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id            VARCHAR(36)   NOT NULL,
  user_id               VARCHAR(36)   NOT NULL,
  client_id             VARCHAR(36),

  -- System sizing
  system_size_kw        DECIMAL(8,2)  NOT NULL DEFAULT 0,
  panel_count           INTEGER       NOT NULL DEFAULT 0,
  annual_production_kwh INTEGER,

  -- Equipment
  panel_id              VARCHAR(100),
  panel_model           VARCHAR(200),
  panel_wattage         INTEGER,
  inverter_id           VARCHAR(100),
  inverter_model        VARCHAR(200),
  inverter_type         VARCHAR(20),   -- 'string' | 'micro' | 'optimizer'
  inverter_qty          INTEGER        DEFAULT 1,
  mounting_id           VARCHAR(100),
  mount_type            VARCHAR(50),

  -- Electrical
  main_panel_rating     INTEGER,       -- bus amps
  backfeed_breaker      INTEGER,       -- amps
  interconnection_method VARCHAR(50),
  wire_gauge            VARCHAR(30),
  conduit_type          VARCHAR(30),
  rapid_shutdown        BOOLEAN        DEFAULT true,
  ac_disconnect         BOOLEAN        DEFAULT true,
  dc_disconnect         BOOLEAN        DEFAULT true,

  -- Site
  utility_name          VARCHAR(200),
  utility_id            VARCHAR(100),
  state_code            VARCHAR(2),
  address               TEXT,
  ahj                   VARCHAR(200),
  roof_pitch            INTEGER,
  system_type           VARCHAR(20),   -- 'roof' | 'ground' | 'fence'

  -- String configuration (full JSON for complete hydration)
  string_config         JSONB          NOT NULL DEFAULT '[]',

  -- Full config snapshot (complete ProjectConfig for full hydration)
  config_snapshot       JSONB          NOT NULL DEFAULT '{}',

  -- Calc outputs (for display in file viewer)
  calc_outputs          JSONB          NOT NULL DEFAULT '{}',

  -- Metadata
  generated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_runs_project_id ON engineering_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_eng_runs_user_id ON engineering_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_eng_runs_created_at ON engineering_runs(created_at DESC);

-- Add engineering_run_id to project_files (links each file to the run that generated it)
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS engineering_run_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_project_files_run_id ON project_files(engineering_run_id);