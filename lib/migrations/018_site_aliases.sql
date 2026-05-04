-- Migration 018: Create site_aliases table for SolarDog learned navigation mappings
-- Previously this table was created at runtime via CREATE TABLE IF NOT EXISTS inside
-- solardogSaveAlias() on every alias save — this migration makes it a proper schema object.
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS site_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  phrase     TEXT NOT NULL,
  route      TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, phrase)
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_site_aliases_user_id
  ON site_aliases (user_id);