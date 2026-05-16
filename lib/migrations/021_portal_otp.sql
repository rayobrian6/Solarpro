-- Migration 021: Portal OTP Tokens
-- Adds a one-time passcode table for the homeowner portal login flow.
-- A 6-digit code is emailed; the raw code is NEVER stored — only a SHA-256 hash.
-- Codes expire after 10 minutes and are single-use (used_at IS NOT NULL = consumed).

CREATE TABLE IF NOT EXISTS portal_otp_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code_hash  TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by hash during verification
CREATE INDEX IF NOT EXISTS idx_portal_otp_code_hash
  ON portal_otp_tokens (code_hash);

-- Fast cleanup sweep for expired / used tokens
CREATE INDEX IF NOT EXISTS idx_portal_otp_client_id
  ON portal_otp_tokens (client_id);

CREATE INDEX IF NOT EXISTS idx_portal_otp_expires_at
  ON portal_otp_tokens (expires_at);
