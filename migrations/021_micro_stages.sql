-- ============================================================
-- Migration 021: Project Micro-Stage Engine
-- ============================================================
-- Implements the internal truth layer for project progress.
--
-- micro_stage  = granular internal event (40+ stages)
-- homeowner_stage = simplified grouping (7 stages, on projects table)
--
-- This table is write-only from the app layer.
-- Never updated — only inserted (append-only audit log).
-- ============================================================

CREATE TABLE IF NOT EXISTS project_micro_stages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  micro_stage TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID,                    -- user/admin UUID (nullable for system events)
  metadata    JSONB                    -- optional context payload
);

-- Primary access: all micro stages for a project, newest first
CREATE INDEX IF NOT EXISTS idx_pms_project_created
  ON project_micro_stages(project_id, created_at DESC);

-- Latest stage lookup (used by resolveHomeownerStage)
CREATE INDEX IF NOT EXISTS idx_pms_project_stage
  ON project_micro_stages(project_id, micro_stage);

-- Audit: who wrote which stage
CREATE INDEX IF NOT EXISTS idx_pms_created_by
  ON project_micro_stages(created_by)
  WHERE created_by IS NOT NULL;