-- ============================================================
-- Migration 010: Terms of Service Acceptance Tracking
-- Adds tos_accepted_at and tos_version columns to users table
-- so we can record exactly when and which version each user accepted.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tos_accepted_at  TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tos_version      TEXT        DEFAULT NULL;

-- Index for fast lookup of users who haven't accepted yet
CREATE INDEX IF NOT EXISTS idx_users_tos_accepted_at ON users(tos_accepted_at)
  WHERE tos_accepted_at IS NULL;

-- Index for version tracking / audit queries
CREATE INDEX IF NOT EXISTS idx_users_tos_version ON users(tos_version);