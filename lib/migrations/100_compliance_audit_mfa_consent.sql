-- ============================================================================
-- Migration 100: Compliance schema — audit log, MFA, consent tracking
-- ============================================================================
-- SOC 2 (CC7.2) and ISO 27001 (A.12.4) require centralized tamper-evident
-- audit logging. This migration creates the audit_log table with SHA-256
-- hash-chained entries, adds MFA columns to users, creates the recovery
-- codes table, and adds consent tracking columns.
--
-- Idempotent: all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- No destructive operations, no backfill.
-- ============================================================================

-- ── Section A: Tamper-evident audit log ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category      TEXT NOT NULL,       -- auth|access|data|config|security|admin|billing|compliance
  action        TEXT NOT NULL,       -- Specific action (e.g., login_success, data_delete)
  actor_id      TEXT,                -- User ID of the actor (null for system actions)
  actor_email   TEXT,                -- Email of the actor
  actor_role    TEXT,                -- Role of the actor at time of action
  target_type   TEXT,                -- Type of target resource (e.g., 'user', 'project')
  target_id     TEXT,                -- ID of the target resource
  description   TEXT NOT NULL,       -- Human-readable summary of the event
  metadata      JSONB DEFAULT '{}',  -- Additional context (never Tier 1 data)
  ip_address    TEXT,                -- Client IP address
  user_agent    TEXT,                -- Client user agent
  request_path  TEXT,                -- API route that triggered the event
  prev_hash     TEXT,                -- SHA-256 hash of previous entry (chain link)
  entry_hash    TEXT NOT NULL        -- SHA-256 hash of this entry (tamper evidence)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (category);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log (entry_hash);

COMMENT ON TABLE audit_log IS 'Tamper-evident audit log for SOC 2 CC7.2 and ISO 27001 A.12.4 compliance. Entries are hash-chained: each entry_hash is SHA-256 of all fields, and prev_hash links to the previous entry. Use verifyAuditChain() to verify integrity.';

-- ── Section B: MFA columns on users ─────────────────────────────────────────
-- Supports POL-SEC-009 (Password & Authentication Policy) MFA enforcement

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT;           -- 'totp' | 'webauthn'
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT; -- AES-256-GCM encrypted TOTP secret
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

COMMENT ON COLUMN users.mfa_enabled IS 'Whether MFA is active for this user. Required for admin and staff roles per POL-SEC-009.';
COMMENT ON COLUMN users.mfa_method IS 'MFA method: totp (authenticator app) or webauthn (hardware key). SMS not approved.';
COMMENT ON COLUMN users.mfa_secret_encrypted IS 'AES-256-GCM encrypted TOTP secret. Never stored in plaintext.';
COMMENT ON COLUMN users.mfa_verified_at IS 'Timestamp of last successful MFA verification. Used for step-up auth.';
COMMENT ON COLUMN users.mfa_enrolled_at IS 'Timestamp of MFA enrollment. Used for compliance reporting.';

-- ── Section C: MFA recovery codes table ──────────────────────────────────────
-- Recovery codes are single-use, one-way hashed for security.
-- FK constraint added after table creation (not inline) for idempotency.

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL,
  code_hash   TEXT NOT NULL,       -- SHA-256 hash of the recovery code (never stored plaintext)
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ          -- When the code was used (for audit trail)
);

-- FK: mfa_recovery_codes.user_id references users(id)
-- Idempotent: "already exists" errors are silently ignored by the migration runner
ALTER TABLE mfa_recovery_codes
  ADD CONSTRAINT mfa_recovery_codes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON mfa_recovery_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_unused ON mfa_recovery_codes (user_id, used) WHERE used = false;

COMMENT ON TABLE mfa_recovery_codes IS 'MFA recovery codes for account recovery when authenticator is lost. Codes are SHA-256 hashed (one-way) and single-use per POL-SEC-009.';

-- ── Section D: Consent tracking columns on users ─────────────────────────────
-- Supports GDPR/CCPA compliance (POL-SEC-007, POL-SEC-004)

ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_privacy_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_terms_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_cookie_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_marketing_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_deletion_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN users.consent_privacy_at IS 'When user consented to privacy policy. Required for GDPR/CCPA compliance.';
COMMENT ON COLUMN users.consent_terms_at IS 'When user consented to terms of service.';
COMMENT ON COLUMN users.consent_cookie_at IS 'When user consented to non-essential cookies.';
COMMENT ON COLUMN users.consent_marketing_at IS 'When user consented to marketing communications. Null = not consented.';
COMMENT ON COLUMN users.data_deletion_requested_at IS 'When user requested data deletion. Triggers 30-day deletion per POL-SEC-007.';
