-- Migration 037: Proposal share token (for Send to Client feature)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS share_token      TEXT DEFAULT NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_share_token ON proposals (share_token) WHERE share_token IS NOT NULL;
