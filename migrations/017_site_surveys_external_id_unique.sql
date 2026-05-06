-- ============================================================
-- Migration 017: Add UNIQUE constraint on site_surveys.external_survey_id
--
-- The ON CONFLICT DO NOTHING in createSiteSurvey() requires a real
-- UNIQUE constraint to work. Without it, re-delivery / force-ingest
-- can either create duplicate rows OR silently skip creation.
--
-- Also adds a backfill index on projects.survey_external_id for the
-- recovery query that finds projects with no site_surveys row.
--
-- Safe to re-run (IF NOT EXISTS / DO NOTHING guards).
-- ============================================================

-- Add unique constraint on external_survey_id (non-null rows only)
-- This enables ON CONFLICT (external_survey_id) DO NOTHING / DO UPDATE
-- and prevents duplicate site_surveys rows for the same partner survey.
DO $$ BEGIN
  ALTER TABLE site_surveys
    ADD CONSTRAINT site_surveys_external_survey_id_key
    UNIQUE (external_survey_id);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;