-- ============================================================
-- Migration 017: project_physical_data additions
--
-- Adds two columns:
--   setback_notes    TEXT        -- captures obstructions.setbackNotes
--                                   from SurveyV2Payload (was silently dropped)
--   source_survey_id UUID        -- backlink to site_surveys.id so engineering
--                                   can trace which survey populated each row
--
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS setback_notes    TEXT;

ALTER TABLE project_physical_data
  ADD COLUMN IF NOT EXISTS source_survey_id UUID
    REFERENCES site_surveys(id) ON DELETE SET NULL;

-- Index for the reverse lookup: given a survey, find its physical_data row
CREATE INDEX IF NOT EXISTS idx_project_physical_data_source_survey
  ON project_physical_data(source_survey_id)
  WHERE source_survey_id IS NOT NULL;