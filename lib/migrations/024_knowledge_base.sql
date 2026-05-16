-- Migration 024: SolarPro knowledge base table
CREATE TABLE IF NOT EXISTS solarpro_knowledge_items (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT[],
  is_global   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_user_id ON solarpro_knowledge_items (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_global ON solarpro_knowledge_items (is_global) WHERE is_global = true;
