-- ============================================================
-- Migration 016: Site Surveys — First-Class Field Data Layer
--
-- Establishes site_surveys and site_survey_files as the
-- canonical storage for all field survey submissions.
--
-- Design principles:
--   - client_id is REQUIRED (surveys always owned by a client)
--   - project_id is NULLABLE (may not exist at survey time)
--   - Completely separate from project_versions / layout data
--   - Both project_handoff and standalone sources route here
--   - Safe to re-run (IF NOT EXISTS / DO NOTHING guards)
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE site_survey_status AS ENUM ('draft', 'completed', 'reviewed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE site_survey_source AS ENUM ('project_handoff', 'standalone');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE survey_file_type AS ENUM ('photo', 'document');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TABLE: site_surveys
-- ============================================================

CREATE TABLE IF NOT EXISTS site_surveys (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership (client is source of truth; project is optional link)
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE SET NULL,
  created_by        UUID        NOT NULL,   -- user_id of the person who submitted

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status lifecycle
  status            site_survey_status NOT NULL DEFAULT 'completed',

  -- Source of survey (how it was initiated)
  source            site_survey_source NOT NULL DEFAULT 'project_handoff',

  -- Address snapshot at time of survey (denormalized for display without joins)
  address_snapshot  TEXT,

  -- Full structured survey payload (from ingest transform)
  survey_data       JSONB,

  -- Optional inspector / field notes
  inspector_name    TEXT,
  notes             TEXT,

  -- Link back to the external survey system (for dedup / replay)
  external_survey_id TEXT,

  -- Webhook delivery that created this row (for traceability)
  delivery_id       TEXT
);

-- ============================================================
-- TABLE: site_survey_files
-- ============================================================

CREATE TABLE IF NOT EXISTS site_survey_files (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   UUID        NOT NULL REFERENCES site_surveys(id) ON DELETE CASCADE,

  file_url    TEXT        NOT NULL,
  file_type   survey_file_type NOT NULL DEFAULT 'photo',

  -- Descriptive label for grouping in the UI
  -- e.g. 'roof', 'panel', 'meter', 'attic', 'utility_room', 'exterior'
  label       TEXT,

  -- Original filename from the survey app (optional)
  filename    TEXT,

  -- MIME type if known
  mime_type   TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Primary access pattern: surveys for a client (client page tab)
CREATE INDEX IF NOT EXISTS idx_site_surveys_client_created
  ON site_surveys(client_id, created_at DESC);

-- Secondary access pattern: surveys for a project (project page card)
CREATE INDEX IF NOT EXISTS idx_site_surveys_project_created
  ON site_surveys(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

-- Files for a survey (detail page photo grid)
CREATE INDEX IF NOT EXISTS idx_site_survey_files_survey
  ON site_survey_files(survey_id, created_at ASC);

-- Files grouped by label (for grouped photo display)
CREATE INDEX IF NOT EXISTS idx_site_survey_files_label
  ON site_survey_files(survey_id, label);

-- Dedup / replay: look up by external survey id
CREATE INDEX IF NOT EXISTS idx_site_surveys_external_id
  ON site_surveys(external_survey_id)
  WHERE external_survey_id IS NOT NULL;

-- ============================================================
-- updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_site_surveys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_surveys_updated_at ON site_surveys;
CREATE TRIGGER trg_site_surveys_updated_at
  BEFORE UPDATE ON site_surveys
  FOR EACH ROW EXECUTE FUNCTION update_site_surveys_updated_at();