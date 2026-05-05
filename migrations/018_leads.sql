-- ============================================================
-- Migration 018: Leads — Admin Lead System (Phase 1)
--
-- Captures potential customers before they become clients.
-- When converted: client + project are created and
-- lead.converted_project_id is set, status = 'converted'.
--
-- Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Contact info
  name                 TEXT          NOT NULL,
  phone                TEXT,
  email                TEXT,
  address              TEXT,

  -- Internal notes
  notes                TEXT,

  -- Pipeline status
  status               TEXT          NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new','contacted','qualified','converted','closed')),

  -- Set when converted to project
  converted_client_id  UUID          REFERENCES clients(id) ON DELETE SET NULL,
  converted_project_id UUID          REFERENCES projects(id) ON DELETE SET NULL,
  converted_at         TIMESTAMPTZ,

  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index for list queries scoped to user
CREATE INDEX IF NOT EXISTS idx_leads_user_created
  ON leads (user_id, created_at DESC);

-- Index for status filter
CREATE INDEX IF NOT EXISTS idx_leads_user_status
  ON leads (user_id, status);