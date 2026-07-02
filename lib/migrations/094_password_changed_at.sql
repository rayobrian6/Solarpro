-- ============================================================================
-- Migration 094: Add password_changed_at to users (session invalidation)
-- ============================================================================
-- Records when a user's password was last changed so that JWT sessions issued
-- BEFORE that moment can be rejected. The app uses stateless 30-day JWTs with
-- no server-side session table, so a password reset previously did NOT log out
-- other active sessions (audit 2026-06-16 #18). With this column, the auth
-- guards compare the token's issued-at (iat) against password_changed_at and
-- reject any token that predates the most recent password change.
--
-- NULL means "never changed / unknown" → tokens are always accepted (fail open),
-- so existing sessions are never invalidated until the user actually resets.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No destructive operations, no backfill.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;
