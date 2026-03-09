-- ============================================================
-- Engineering Automation System — Database Migration
-- Creates engineering_reports table linked to project + layout
-- ============================================================

CREATE TABLE IF NOT EXISTS engineering_reports (
  id                  VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id          VARCHAR(36)   NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  layout_id           VARCHAR(36),
  design_version_id   VARCHAR(32)   NOT NULL DEFAULT '',
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
  
  -- System summary (denormalized for quick queries)
  panel_count         INTEGER       NOT NULL DEFAULT 0,
  system_kw           DECIMAL(8,2)  NOT NULL DEFAULT 0,
  mount_type          VARCHAR(50)   NOT NULL DEFAULT 'roof',
  inverter_model      VARCHAR(200)  NOT NULL DEFAULT '',
  panel_model         VARCHAR(200)  NOT NULL DEFAULT '',
  
  -- Array summaries (JSON)
  roof_segments       JSONB         NOT NULL DEFAULT '[]',
  ground_arrays       JSONB         NOT NULL DEFAULT '[]',
  fence_arrays        JSONB         NOT NULL DEFAULT '[]',
  
  -- Site info
  utility_provider    VARCHAR(200)  NOT NULL DEFAULT '',
  ahj                 VARCHAR(200)  NOT NULL DEFAULT '',
  
  -- Full report data (JSON)
  report_data         JSONB         NOT NULL DEFAULT '{}',
  
  -- Metadata
  generated_at        TIMESTAMPTZ,
  generated_by        VARCHAR(20)   NOT NULL DEFAULT 'auto',
  version             VARCHAR(20)   NOT NULL DEFAULT '1.0',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_engineering_reports_project_id 
  ON engineering_reports(project_id);

-- Index for design version change detection
CREATE INDEX IF NOT EXISTS idx_engineering_reports_design_version 
  ON engineering_reports(project_id, design_version_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_engineering_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS engineering_reports_updated_at ON engineering_reports;
CREATE TRIGGER engineering_reports_updated_at
  BEFORE UPDATE ON engineering_reports
  FOR EACH ROW EXECUTE FUNCTION update_engineering_reports_updated_at();