-- Migration 040: proposal_signatures audit table
--
-- Stores immutable audit records for every e-signature event.
-- The proposals table (migration 031) already has signer_* columns for
-- quick lookups; this table provides a full audit trail per ESIGN Act
-- / UETA compliance requirements.
--
-- Each INSERT uses ON CONFLICT DO NOTHING so the sign route can safely
-- retry without creating duplicate records.

CREATE TABLE IF NOT EXISTS proposal_signatures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  signer_name     TEXT        NOT NULL,
  signer_email    TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  agreed_to_terms BOOLEAN     NOT NULL DEFAULT false,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One audit record per proposal (prevents duplicates from retries)
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_signatures_proposal_id
  ON proposal_signatures (proposal_id);

-- Speed up lookups by proposal
CREATE INDEX IF NOT EXISTS idx_proposal_signatures_proposal_id
  ON proposal_signatures (proposal_id);

-- Speed up lookups by signer email (installer dashboard, audit)
CREATE INDEX IF NOT EXISTS idx_proposal_signatures_signer_email
  ON proposal_signatures (signer_email)
  WHERE signer_email IS NOT NULL;

COMMENT ON TABLE proposal_signatures IS
  'Immutable audit trail for proposal e-signatures (ESIGN Act / UETA compliance).';
