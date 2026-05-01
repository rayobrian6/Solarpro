-- Migration 008: Admin Activity Log + Impersonation tokens
-- Run this migration to enable admin activity tracking and impersonation

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(100) NOT NULL,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  target_company  VARCHAR(255),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id    ON admin_activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_target_user ON admin_activity_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at  ON admin_activity_log(created_at DESC);

-- Impersonation tokens table
CREATE TABLE IF NOT EXISTS admin_impersonation_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(128) NOT NULL UNIQUE,
  used        BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_token ON admin_impersonation_tokens(token);