-- =============================================================================
-- Migration 015: Mobile SSO JTI Tracking
--
-- Tracks used JTI (JWT ID) values for mobile SSO tokens to prevent replay attacks.
-- Each JTI is stored on first use and rejected on subsequent use within the TTL window.
--
-- Tokens expire after 10 minutes (matching SOLARPRO_HANDOFF_SECRET token TTL).
-- Cleanup of expired rows is handled by the periodic cleanup job or on-insert trigger.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mobile_sso_used_jtis (
  jti         TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Index for cleanup queries — allows efficient deletion of expired rows
CREATE INDEX IF NOT EXISTS idx_mobile_sso_used_jtis_expires_at
  ON mobile_sso_used_jtis (expires_at);

-- Comment on usage
COMMENT ON TABLE mobile_sso_used_jtis IS
  'Tracks consumed JTI values for mobile SSO JWTs to prevent replay attacks. '
  'Rows with expires_at < NOW() can be deleted periodically.';