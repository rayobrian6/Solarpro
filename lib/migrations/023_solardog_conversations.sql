-- Migration 023: SolarDog AI conversations table
CREATE TABLE IF NOT EXISTS solardog_conversations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  TEXT,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solardog_conversations_user_id ON solardog_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_solardog_conversations_project_id ON solardog_conversations (project_id) WHERE project_id IS NOT NULL;
