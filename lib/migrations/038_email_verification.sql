-- Migration 038: Email verification columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token   TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at          TIMESTAMPTZ DEFAULT NULL;
