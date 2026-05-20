-- Migration 072: Marketplace Inventory + Contractor Eligibility + Claim Flow v1
--
-- Additive-only support for explicit marketplace inventory projection and
-- explainable claim behavior. Canonical rows remain network_opportunities,
-- immutable history remains network_events, and contractor claims remain
-- opportunity_assignments.
--
-- IMPORTANT RUNNER COMPATIBILITY:
--   Keep this file as plain semicolon-delimited SQL only. Do not use DO $$
--   blocks because the current System Tools runner splits statements by
--   semicolon and cannot safely execute PL/pgSQL blocks.

ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS intake_event_id UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS release_gate_result JSONB NOT NULL DEFAULT '{}';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS marketplace_status TEXT NOT NULL DEFAULT 'not_released';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS released_by UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS paused_by UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS unreleased_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS unreleased_by UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS inventory_transition_reason TEXT;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS claim_mode TEXT NOT NULL DEFAULT 'exclusive';
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS max_claims INTEGER NOT NULL DEFAULT 1;
ALTER TABLE network_opportunities ADD COLUMN IF NOT EXISTS claim_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_net_opps_intake_event_id
  ON network_opportunities (intake_event_id)
  WHERE intake_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_net_opps_unique_intake_event_id
  ON network_opportunities (intake_event_id)
  WHERE intake_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_net_opps_marketplace_status
  ON network_opportunities (marketplace_status, released_at DESC);

CREATE INDEX IF NOT EXISTS idx_net_opps_live_inventory
  ON network_opportunities (status, marketplace_status, released_at DESC)
  WHERE status = 'live' AND marketplace_status = 'live';

-- Replace the older opportunity-only claimed uniqueness so shared claim mode can
-- support more than one contractor while still preventing the same contractor
-- from holding duplicate active records for the same opportunity. Exclusive mode
-- is enforced by network_opportunities.claim_mode/max_claims/claim_count in the
-- claim mutation guard.
DROP INDEX IF EXISTS idx_opp_assignments_unique_claimed;

CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_assignments_unique_active_claim_v1
  ON opportunity_assignments(opportunity_id, contractor_id)
  WHERE status IN ('offered','viewed','claimed','contacted','appointment','proposal','won');

COMMENT ON COLUMN network_opportunities.intake_event_id IS
  'Canonical link back to the immutable homeowner intake event that produced this marketplace opportunity.';

COMMENT ON COLUMN network_opportunities.release_gate_result IS
  'Explainable marketplace release gate snapshot captured at release/unrelease/pause/archive time.';

COMMENT ON COLUMN network_opportunities.marketplace_status IS
  'Operational inventory state: not_released, live, paused, unreleased, archived, claimed, expired. Separate from lifecycle status.';
