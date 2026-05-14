-- =============================================================
-- Migration 020: Digital Signatures on Proposals
-- =============================================================
-- Adds signature capture fields to the proposals table.
-- Stores: signer name, email, timestamp, IP address, and a
-- base64 data-URL of the drawn signature image.
-- Signature data is stored in data_json for forward-compatibility
-- (avoids schema migration in environments with restricted ALTER).
-- These columns are also added directly for fast indexed queries.
-- =============================================================

-- Add dedicated signature columns to proposals table
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS signed_at       TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signer_name     TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signer_email    TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signer_ip       TEXT        DEFAULT NULL;

-- Index for finding signed proposals quickly
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_signed_at
  ON proposals (signed_at)
  WHERE signed_at IS NOT NULL;

-- Index for CRM: proposals by user + status (covers signed/accepted lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_user_status
  ON proposals (user_id, status, created_at DESC);

COMMENT ON COLUMN proposals.signed_at    IS 'Timestamp when the client signed the proposal';
COMMENT ON COLUMN proposals.signer_name  IS 'Full name entered by the client at time of signing';
COMMENT ON COLUMN proposals.signer_email IS 'Email entered by the client at time of signing';
COMMENT ON COLUMN proposals.signer_ip    IS 'Client IP address at time of signing (for audit trail)';
