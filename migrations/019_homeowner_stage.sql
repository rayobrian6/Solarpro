-- ============================================================
-- Migration 019: Homeowner-facing project stage column
-- ============================================================
-- IMPORTANT: project_status is the internal 13-stage ops pipeline.
-- homeowner_stage is a separate, admin-controlled field used
-- ONLY by the homeowner portal to display progress.
-- Do NOT merge these two pipelines.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS homeowner_stage TEXT
    CHECK (homeowner_stage IN (
      'lead_submitted',
      'under_review',
      'site_survey',
      'design',
      'proposal',
      'installation',
      'completed'
    ));

-- Stage history: every time admin changes homeowner_stage, log it
CREATE TABLE IF NOT EXISTS project_homeowner_stage_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,
  changed_by   UUID,           -- admin user id (nullable for system changes)
  note         TEXT,           -- optional admin note
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phsh_project_id
  ON project_homeowner_stage_history(project_id);

CREATE INDEX IF NOT EXISTS idx_phsh_created_at
  ON project_homeowner_stage_history(created_at DESC);