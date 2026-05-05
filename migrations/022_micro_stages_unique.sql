-- Migration 022: Add UNIQUE constraint to project_micro_stages
-- Ensures each micro_stage is recorded exactly once per project at the DB level.
-- Belt-and-suspenders alongside the SELECT 1 idempotency check in writeMicroStage().

ALTER TABLE project_micro_stages
  ADD CONSTRAINT uq_project_micro_stage
  UNIQUE (project_id, micro_stage);