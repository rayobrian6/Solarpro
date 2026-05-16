-- Migration 031: Proposal e-signing columns
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signed_at     TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_name   TEXT DEFAULT NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_email  TEXT DEFAULT NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS signer_ip     TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_signed_at   ON proposals (signed_at) WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_user_created ON proposals (user_id, created_at DESC);
