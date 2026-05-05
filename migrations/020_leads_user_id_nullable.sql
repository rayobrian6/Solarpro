-- ============================================================
-- Migration 020: Allow leads to exist without a user_id
--
-- Leads created directly in the admin UI are not yet tied to
-- a registered system user. This change allows user_id to be NULL
-- until the lead is converted to a client/project.
-- ============================================================

ALTER TABLE leads
  ALTER COLUMN user_id DROP NOT NULL;