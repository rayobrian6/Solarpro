-- Migration 032: Portal OTP tokens table (homeowner portal login)
CREATE TABLE IF NOT EXISTS portal_otp_tokens (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  otp_hash    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_otp_project    ON portal_otp_tokens (project_id);
CREATE INDEX IF NOT EXISTS idx_portal_otp_email      ON portal_otp_tokens (email);
CREATE INDEX IF NOT EXISTS idx_portal_otp_expires    ON portal_otp_tokens (expires_at);
