-- ============================================================
-- Migration 046: opportunity_claims
--
-- Exclusive claim records. One opportunity → at most one active claim.
-- UNIQUE constraint on (opportunity_id) prevents race conditions.
--
-- Status:
--   pending   → claimed, awaiting contractor first contact
--   active    → contractor contacted homeowner, deal in progress
--   closed    → deal closed successfully
--   released  → contractor released the claim (back to open)
--   expired   → claim expired without activity
--
-- Safe to re-run (IF NOT EXISTS guards).
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_claims (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  claimed_by_user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'closed', 'released', 'expired')),

  -- Claim price paid (matches opportunity.asking_price at time of claim, or negotiated)
  price_paid            NUMERIC(10,2),

  -- Internal notes from claiming contractor (private)
  contractor_notes      TEXT,

  -- Outcome tracking (populated when status = closed)
  outcome               TEXT        CHECK (outcome IN ('installed', 'sold_to_another', 'homeowner_declined', 'not_viable', 'other')),
  outcome_notes         TEXT,
  outcome_at            TIMESTAMPTZ,

  -- Activity tracking
  first_contact_at      TIMESTAMPTZ,
  claim_expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE exclusivity constraint — one active claim per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_claims_exclusive
  ON opportunity_claims (opportunity_id)
  WHERE status NOT IN ('released', 'expired');

-- My claims lookup
CREATE INDEX IF NOT EXISTS idx_opportunity_claims_user
  ON opportunity_claims (claimed_by_user_id, created_at DESC);

COMMENT ON TABLE opportunity_claims IS
  'Exclusive claim on an opportunity. UNIQUE index on opportunity_id (for non-released/expired) enforces exclusivity at DB level — no auction, no race conditions.';
