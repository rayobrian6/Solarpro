-- Migration 067: repair missing canonical opportunity_assignments table
-- Idempotent copy of migration 051 for shared DBs that missed the original assignments migration.

-- ============================================================
-- Migration 051: opportunity_assignments
--
-- Lifecycle state machine for opportunity → contractor matching.
-- Tracks every assignment attempt, routing decision, claim,
-- appointment, and final outcome.
--
-- An opportunity can be assigned to multiple contractors
-- (if unclaimed after TTL) but can only be WON by one.
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id        UUID NOT NULL REFERENCES network_opportunities(id) ON DELETE CASCADE,
  contractor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- ── Assignment State ────────────────────────────────────────
  status                TEXT NOT NULL DEFAULT 'offered',
  -- offered     — shown to contractor, awaiting action
  -- viewed      — contractor viewed the detail
  -- claimed     — contractor paid and claimed
  -- contacted   — contractor has reached out to homeowner
  -- appointment — appointment scheduled
  -- proposal    — proposal delivered
  -- won         — deal closed
  -- lost        — deal lost (homeowner chose competitor/no-go)
  -- expired     — contractor didn't claim within TTL
  -- released    — admin released back to pool
  -- refunded    — claim refunded (bad lead, etc.)

  -- ── Assignment Metadata ─────────────────────────────────────
  assignment_type       TEXT DEFAULT 'marketplace',
  -- marketplace | direct | admin_assigned | exclusive

  assignment_rank       INTEGER,     -- 1 = best match, 2 = 2nd best, etc.
  match_score           NUMERIC(5,2), -- contractor fit score (0-100)
  match_factors         JSONB DEFAULT '{}',

  -- ── Offer Window ────────────────────────────────────────────
  offered_at            TIMESTAMPTZ DEFAULT NOW(),
  offer_expires_at      TIMESTAMPTZ,    -- when this offer expires
  offer_ttl_hours       INTEGER DEFAULT 72,

  -- ── Claim ───────────────────────────────────────────────────
  claimed_at            TIMESTAMPTZ,
  claim_amount          NUMERIC(10,2),  -- what contractor paid
  claim_currency        TEXT DEFAULT 'USD',
  payment_intent_id     TEXT,           -- Stripe payment intent
  payment_status        TEXT,           -- succeeded | pending | failed | refunded

  -- ── Contractor Activity ─────────────────────────────────────
  first_viewed_at       TIMESTAMPTZ,
  last_viewed_at        TIMESTAMPTZ,
  view_count            INTEGER DEFAULT 0,
  contact_attempts      INTEGER DEFAULT 0,
  first_contact_at      TIMESTAMPTZ,
  last_contact_at       TIMESTAMPTZ,

  -- ── Appointment ─────────────────────────────────────────────
  appointment_at        TIMESTAMPTZ,
  appointment_type      TEXT,    -- in_home | virtual | phone
  appointment_confirmed BOOLEAN DEFAULT false,
  appointment_notes     TEXT,

  -- ── Proposal ────────────────────────────────────────────────
  proposal_at           TIMESTAMPTZ,
  proposal_amount       NUMERIC(12,2),  -- quoted system price
  system_size_kw        NUMERIC(6,2),
  panel_brand           TEXT,
  inverter_brand        TEXT,
  warranty_years        INTEGER,
  financing_offered     TEXT,    -- cash | loan | lease | ppa

  -- ── Close ───────────────────────────────────────────────────
  closed_at             TIMESTAMPTZ,
  close_status          TEXT,    -- won | lost | no_decision
  contract_value        NUMERIC(12,2),
  lost_reason           TEXT,
  lost_to               TEXT,    -- competitor name if known

  -- ── Dispute / Refund ────────────────────────────────────────
  dispute_filed_at      TIMESTAMPTZ,
  dispute_reason        TEXT,
  dispute_status        TEXT,    -- open | resolved | denied
  refund_amount         NUMERIC(10,2),
  refund_at             TIMESTAMPTZ,
  refund_reason         TEXT,

  -- ── Admin Control ───────────────────────────────────────────
  admin_notes           TEXT,
  flagged               BOOLEAN DEFAULT false,
  flag_reason           TEXT,
  quality_score         NUMERIC(5,2),  -- post-close quality rating

  -- ── Notifications Sent ──────────────────────────────────────
  notifications         JSONB DEFAULT '[]',
  -- [{type, sent_at, channel, status}]

  -- ── Timestamps ──────────────────────────────────────────────
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opp_assignments_opportunity_id ON opportunity_assignments(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_assignments_contractor_id  ON opportunity_assignments(contractor_id);
CREATE INDEX IF NOT EXISTS idx_opp_assignments_status         ON opportunity_assignments(status);
CREATE INDEX IF NOT EXISTS idx_opp_assignments_offered_at     ON opportunity_assignments(offered_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_assignments_claimed_at     ON opportunity_assignments(claimed_at DESC) WHERE claimed_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_assignments_unique_claimed
  ON opportunity_assignments(opportunity_id)
  WHERE status IN ('claimed','contacted','appointment','proposal','won');
