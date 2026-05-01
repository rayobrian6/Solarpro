-- ============================================================================
-- Migration 016: Organizations (Company Hierarchy / Multi-Seat)
--
-- Allows multiple SolarPro users to be grouped under one organization.
-- The org owner holds the subscription; members share access under that plan.
--
-- Usage:
--   1. A user creates an org (becomes owner, org_role = 'owner')
--   2. Owner invites others by email → pending invite row inserted
--   3. Invited user accepts → org_id set on their users row, org_role = 'member'
-- ============================================================================

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'contractor',   -- inherits from owner
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link users to an org
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role    TEXT NOT NULL DEFAULT 'owner';  -- 'owner' | 'member'

-- Pending invites (email-based, before the invitee has accepted)
CREATE TABLE IF NOT EXISTS org_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_org_id        ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_org     ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email   ON org_invites(invited_email);
CREATE INDEX IF NOT EXISTS idx_org_invites_token   ON org_invites(token);
