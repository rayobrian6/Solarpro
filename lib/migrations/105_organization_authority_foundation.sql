-- ============================================================================
-- Migration 105: Organization Authority Foundation
--
-- Phase 1B — Enterprise Multi-Tenant Authority
--
-- This migration establishes the organization authority foundation:
--   1. A many-to-many membership table (organization_members) replacing the
--      1:1 users.org_id pointer as the authoritative membership source.
--   2. Expanded organization roles: owner, admin, member, viewer
--      (CHECK constraint enforces the vocabulary).
--   3. Organization status and suspension lifecycle columns on organizations.
--   4. An active_organization_context table for server-authoritative active
--      org selection (a user may belong to multiple orgs; one is active).
--   5. A compatibility backfill: existing users.org_id memberships are
--      mirrored into organization_members as 'owner' or 'member' rows.
--   6. Legacy users.org_id and users.org_role columns are RETAINED as
--      backward-compatible pointers — NOT dropped, NOT made non-authoritative
--      in this migration (the application layer manages the transition via
--      feature flags).
--
-- Transaction mode: REQUIRED (all DDL is transaction-safe; no concurrent
-- index creation, no maintenance operations, no database-level DDL).
--
-- Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
-- ============================================================================

-- ============================================================================
-- 1. organizations table enhancements (status + lifecycle)
-- ============================================================================

-- Organization status: 'active' | 'suspended' | 'deleted'
-- 'active' is the normal operating state.
-- 'suspended' means billing/admin action has paused the org (members read-only).
-- 'deleted' is a soft-delete marker (the row remains for audit).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'deleted'));

-- When the org was suspended (null when active). Used for audit and
-- reactivation logic.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- Soft-delete timestamp. Organizations are never hard-deleted in the
-- authority model — the row is retained for audit trail integrity.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Organization slug — a URL-friendly identifier. Unique when non-null.
-- Null is allowed for legacy orgs that haven't been assigned a slug yet.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug
  ON organizations (slug) WHERE slug IS NOT NULL;

-- Organization-level settings (JSONB). Stores feature toggles, display
-- preferences, and other org-scoped configuration. Empty object default.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- ============================================================================
-- 2. organization_members — many-to-many membership table
-- ============================================================================

-- This is the authoritative membership source. A user may belong to
-- multiple organizations. Each membership has its own role.
--
-- Legacy users.org_id remains as a backward-compatible pointer. The
-- application compatibility layer (lib/organizations/memberships.ts) keeps
-- users.org_id in sync with the user's "primary" membership for legacy code
-- paths that have not been migrated.
CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  -- Membership status: 'active' | 'invited' | 'suspended'
  -- 'active' — full membership, role applies
  -- 'invited' — pending acceptance (replaces some org_invites use cases)
  -- 'suspended' — temporarily disabled by an admin, retains the row for audit
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  suspended_at    TIMESTAMPTZ,
  suspended_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A user has at most one membership row per organization.
  CONSTRAINT uq_organization_members_org_user UNIQUE (organization_id, user_id)
);

-- Indexes for common query patterns:
-- 1. Find all members of an org (with active status filter)
CREATE INDEX IF NOT EXISTS idx_organization_members_org
  ON organization_members (organization_id)
  WHERE status = 'active';

-- 2. Find all orgs a user belongs to (with active status filter)
CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members (user_id)
  WHERE status = 'active';

-- 3. Find all owners of an org (for last-owner protection checks)
CREATE INDEX IF NOT EXISTS idx_organization_members_org_owner
  ON organization_members (organization_id)
  WHERE role = 'owner' AND status = 'active';

-- 4. Find all admins of an org
CREATE INDEX IF NOT EXISTS idx_organization_members_org_admin
  ON organization_members (organization_id)
  WHERE role = 'admin' AND status = 'active';

-- 5. Invited (pending) memberships lookup by org
CREATE INDEX IF NOT EXISTS idx_organization_members_org_invited
  ON organization_members (organization_id)
  WHERE status = 'invited';

-- ============================================================================
-- 3. active_organization_context — server-authoritative active org
-- ============================================================================

-- When a user belongs to multiple organizations, exactly one is "active" at
-- any time. This is the server-authoritative record of which org context
-- the user is currently operating in. The active org is never stored in the
-- JWT (which contains only identity). Instead, the server resolves the
-- active org from this table on each request that needs org context.
--
-- If a user has no row here, their active org defaults to their primary
-- membership (or the single org they belong to, or null if none).
CREATE TABLE IF NOT EXISTS active_organization_context (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- When the active org was set (for audit trail)
  set_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Optional: the source of the switch ('user' | 'system' | 'default')
  set_by          TEXT NOT NULL DEFAULT 'user'
                  CHECK (set_by IN ('user', 'system', 'default')),
  -- One active org per user
  CONSTRAINT uq_active_organization_context_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_active_organization_context_user
  ON active_organization_context (user_id);

-- ============================================================================
-- 4. updated_at trigger for organization_members
-- ============================================================================

-- Ensure updated_at is maintained on membership changes. This trigger
-- function may already exist from other tables (e.g. projects); use
-- CREATE OR REPLACE to be idempotent.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_organization_members_updated_at ON organization_members;
CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 5. Compatibility backfill — mirror existing users.org_id into memberships
-- ============================================================================

-- For every user who currently has a non-null users.org_id, create a
-- corresponding organization_members row with the role from users.org_role.
-- This is a one-time backfill that runs idempotently (ON CONFLICT DO NOTHING).
--
-- Legacy org_role values: 'owner' | 'member'. Both are valid in the new
-- CHECK constraint, so no mapping is needed.
INSERT INTO organization_members (organization_id, user_id, role, status, accepted_at, created_at)
SELECT u.org_id, u.id,
       CASE
         WHEN u.org_role = 'owner' THEN 'owner'
         WHEN u.org_role = 'member' THEN 'member'
         ELSE 'member'  -- defensive default for unexpected legacy values
       END,
       'active',
       now(),
       COALESCE(o.created_at, now())
FROM users u
JOIN organizations o ON o.id = u.org_id
WHERE u.org_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ============================================================================
-- 6. Audit columns on organizations (updated_at trigger already exists from
--    migration 016? No — 016 did not create a trigger. Add one now.)
-- ============================================================================

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 7. Summary
-- ============================================================================
-- New tables:
--   organization_members (many-to-many memberships, 4 roles, 3 statuses)
--   active_organization_context (server-authoritative active org per user)
--
-- New columns on organizations:
--   status, suspended_at, deleted_at, slug, settings
--
-- Backfilled:
--   All existing users.org_id memberships mirrored into organization_members
--
-- Retained (NOT dropped):
--   users.org_id (backward-compatible pointer)
--   users.org_role (backward-compatible role)
--   org_invites (email-based invite table, unchanged)
--
-- Not in scope for this migration:
--   RLS policies (deferred to later phase)
--   Project ownership backfill (deferred)
--   Removal of legacy columns (deferred)
--   Billing migration (deferred)
