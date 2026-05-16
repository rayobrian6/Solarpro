-- Migration 027: Project micro-stages table
CREATE TABLE IF NOT EXISTS project_micro_stages (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  substage    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_micro_stage ON project_micro_stages (project_id, stage, substage);
CREATE INDEX IF NOT EXISTS idx_project_micro_stages_project ON project_micro_stages (project_id);
