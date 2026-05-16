-- Migration 034: Client notes table
CREATE TABLE IF NOT EXISTS client_notes (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) <= 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_notes_client_id ON client_notes (client_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_user_id   ON client_notes (user_id);
