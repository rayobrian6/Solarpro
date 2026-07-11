# Enterprise Multi-Tenant Authority — Phase 1 Implementation Specification

**Document Type:** Phase 1 Implementation Specification
**Phase:** 0.5 — Architecture Decision Gate (Read-Only)
**Date:** 2026-07-11
**Date Classification:** Document creation date (2026-07-11). Evidence baseline commit `7b344aa1` is dated 2026-07-11 (commit date). Phase 0 predecessor commit `39a1f718` is dated 2026-07-11 (commit date). This reconciliation commit is dated 2026-07-11 (document correction date). The previous incorrect value of 2025-07-11 has been corrected — no Phase 0.5 work occurred in 2025.
**Branch:** `dev` @ `ef51acff`
**Branch Reference Classification:** `ef51acff` is the Phase 0.5 documentation commit (this document and its companion Phase 0.5 deliverables). The codebase evidence baseline is `7b344aa1` (a code commit, not a documentation commit) — referenced where source evidence is cited.
**Status:** Complete — Phase 1 scope only (architecture analysis COMPLETE; documentation integrity reconciliation IN PROGRESS; stakeholder approval APPROVED BY RAYMOND for ADR-008/009/010/012/014; implementation BLOCKED pending 15 program gates and migration governance)
**Predecessor:** Phase 0 Audit & Architecture Design (commit `39a1f718`)
**Depends on:** ADR-001 through ADR-014, Canonical Authority Model, Phase 1 Entry Gates

---

## Purpose

This document specifies the implementation work for Phase 1 of the enterprise multi-tenant migration. Phase 1 is the foundational phase: it establishes canonical organizations, many-to-many memberships, server-validated active org context, separate role namespaces, centralized authorization interfaces, and tenant-aware audit logging. **Phase 1 does NOT migrate resource ownership (that is NEXT_ENTERPRISE_AUTHORITY_MIGRATION / Phase 2), does NOT migrate file storage (Phase 2), and does NOT migrate billing (Phase 2).**

This specification is implementation-ready: each section defines the exact schema, code, and tests that must be produced. The 15 implementation gates from ADR-014 define the execution order, and each gate's pass/fail criteria are restated here.

> **Placeholder Definition — NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** Throughout this document, `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` is a placeholder for the next verified available migration identifier. It CANNOT be assigned a numeric value at this time because the migration directory (`lib/migrations/`) has a duplicate prefix (074 appears twice) and gaps in the numbering sequence (009, 012, 013, 014 missing). The highest existing migration prefix is 104. The numeric identifier must be determined by a migration sequence reconciliation process before any migration file is created. This placeholder refers to the first resource ownership schema migration (adding org-level columns to existing resource tables such as `projects.organization_id`), which is PROHIBITED until all 15 Phase 1 entry gates pass and Raymond approves. See `ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md` for the full migration directory state analysis.

---

## Phase 1 Scope

### In Scope

- Canonical organization table (extend existing `organizations` table from Migration 016)
- Organization members junction table (many-to-many memberships, ADR-001)
- Organization roles namespace (separate from platform roles, ADR-004)
- Active organization context (server-side resolution, ADR-002)
- Extended session/user object (org context in `getUserFromRequest()` return, NOT in JWT)
- Centralized authorization interface (`canAccessResource()`)
- Org-scoped query helper (`getOrgScopedQuery()`)
- Tenant-aware audit logging (org context columns + per-org hash chains, ADR-013)
- Tenant-aware audit query API
- Dev auth bypass audit logging (ADR-012)
- Impersonation hardening (time-limited, tenant-aware, revocable, ADR-012)

### Out of Scope (Phase 2+)

- Resource ownership migration (`projects.organization_id`, `clients.organization_id`, etc.) — **NEXT_ENTERPRISE_AUTHORITY_MIGRATION, PROHIBITED until Phase 1 gates pass**
- File storage migration (private storage, org prefixes, signed URLs, ADR-007) — Phase 2
- Billing migration (org-level Stripe customers, ADR-008) — Phase 2
- Project participant grants (ADR-005) — Phase 2 (requires resource ownership)
- Resource share grants (ADR-006) — Phase 2+ (requires file revisions)
- Legacy ownership backfill script (dry-run mode, ADR-009) — Gate 13, later program phase
- Ambiguity queue admin API (ADR-009) — Gate 14, later program phase
- Full test suite verification (121 test cases from Authorization Test Matrix) — Gate 15, later program phase (adversarial validation)
- Ownership transfer (ADR-010) — Phase 3+
- Parent/subsidiary inheritance features (ADR-011) — Future phase (column is added in Phase 1, but inheritance logic is deferred)

---

## Implementation Gate Sequence

The 15 gates from ADR-014, restated with implementation-level detail. **The 15 gates describe the FULL program, not Phase 1 alone.** Phase 1 is foundation-only: Gates 1-12 establish canonical orgs, memberships, active org context, role separation, permission definitions, central authorization interfaces, tenant-aware audit context, feature flags, backward-compatible behavior, foundational tests, and migration-governance prerequisites. Gates 13-15 (legacy backfill, ambiguity queue, adversarial validation) belong to later program phases — they are NOT "Phase 1 Completion." All 15 gates must pass before NEXT_ENTERPRISE_AUTHORITY_MIGRATION (resource ownership migration) may begin. A gate-to-phase table is provided below.

### Gate-to-Phase Assignment

The 15 gates describe the full program, not Phase 1 alone. Phase 1 is foundation-only (Gates 1-12). Gates 13-15 belong to later program phases. The table below assigns each gate to its correct phase.

| Program Gate | Purpose | Assigned Phase | Entry Dependency | Exit Evidence | Rollback Boundary |
|---|---|---|---|---|---|
| Gate 1: Canonical Organization Table | Confirm `organizations` table is canonical; add `parent_org_id` metadata | Phase 1 — Foundation | Phase 0.5 ADRs complete; Raymond approval pending | `organizations` table exists with `parent_org_id`; no duplicate org tables | Drop `parent_org_id` column |
| Gate 2: Organization Members Junction Table | Create `organization_members` junction for many-to-many memberships | Phase 1 — Foundation | Gate 1 passed | Table exists with correct columns and constraints | Drop `organization_members` table |
| Gate 3: Organization Roles Namespace | Create `org_roles` and `org_role_permissions`; seed system roles | Phase 1 — Foundation | Gate 2 passed | Tables exist; four system roles seeded; separate from platform roles | Drop `org_roles` and `org_role_permissions` tables |
| Gate 4: Active Organization Context Table | Create `user_active_org` table | Phase 1 — Foundation | Gate 3 passed | Table exists with correct columns and constraints | Drop `user_active_org` table |
| Gate 5: Active Org Context Resolution Function | Implement `getActiveOrgId(userId)` | Phase 1 — Foundation | Gate 4 passed | Function returns valid org_id or NULL; does not trust client input | Revert function; callers fall back to user-scoped behavior |
| Gate 6: Extended Session/User Object | Extend `getUserFromRequest()` to include org context | Phase 1 — Foundation | Gate 5 passed | `getUserFromRequest()` returns org context; JWT unchanged; 136 files still work | Revert `getUserFromRequest()` extension; backward compatible |
| Gate 7: Authorization Interface | Implement `canAccessResource(actor, resource)` | Phase 1 — Foundation | Gate 6 passed | Function exists; returns boolean; unit tests pass | Revert function; no routes depend on it yet |
| Gate 8: Org-Scoped Query Helper | Implement `getOrgScopedQuery(orgId, tableName)` | Phase 1 — Foundation | Gate 7 passed | Helper exists; unit tests pass; no bypass | Revert helper; no routes use it yet |
| Gate 9: Audit Log Org Context | Add org context columns to `audit_log`; update `writeAuditLog()` | Phase 1 — Foundation | Gate 8 passed | Columns exist (nullable); new events include org context; per-org chain works | Drop added columns; revert `writeAuditLog()` |
| Gate 10: Tenant-Aware Audit Query API | Implement `GET /api/audit/org/{orgId}` | Phase 1 — Foundation | Gate 9 passed | API exists; returns only specified org's events; cross-org denied | Remove API route; existing audit queries unchanged |
| Gate 11: Dev Auth Bypass Audit | Add audit event for dev auth bypass in non-production | Phase 1 — Foundation | Gate 10 passed | Dev bypass in non-production writes audit event; production still disabled | Revert audit event addition; existing dev bypass behavior preserved |
| Gate 12: Impersonation Hardening | Time-limited, tenant-aware impersonation with revocation | Phase 1 — Foundation | Gate 11 passed | Org-scoped admins cannot impersonate cross-tenant; super_admin can with reason + duration; expiry, revocation, notification, audit | Revert impersonation changes; existing impersonation behavior restored |
| Gate 13: Legacy Ownership Backfill Script (Dry-Run) | Implement backfill script in dry-run mode | Later Phase — Data Migration | Gate 12 passed; Raymond approval of ADR-009 | Script runs in dry-run; reports assignments; does not execute changes | Remove script; no data changes in dry-run mode |
| Gate 14: Ambiguity Queue Admin API | Implement ambiguity queue and merge APIs | Later Phase — Data Migration | Gate 13 passed; Raymond approval of ADR-009 | APIs exist; merge is platform-admin only; merge is audited | Remove APIs and `org_merge_suggestions` table; no data changes |
| Gate 15: Program Entry Gate Verification | Run full test suite; verify no regressions; Raymond approves transition | Later Phase — Final Validation | Gates 1-14 passed; Raymond approval of ADR-014 | All 121 test cases pass; no regressions across 280 routes; MFA untouched; Raymond approves | No schema changes to roll back; verification gate only |


### Gate 1: Canonical Organization Table

**Objective:** Confirm `organizations` table (Migration 016) is canonical. Add `parent_org_id` metadata column (ADR-011).

**Schema migration (additive):**
```sql
-- Migration: Add parent_org_id metadata column (ADR-011)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS parent_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD CONSTRAINT no_self_reference CHECK (parent_org_id != id);
```

**Code changes:** None. `parent_org_id` is metadata only — no authorization, billing, or storage code reads it.

**Pass criteria:**
- `organizations` table exists with `parent_org_id` column.
- Self-reference constraint is enforced.
- No duplicate org tables created.
- Existing org rows retain `parent_org_id = NULL`.

**Tests:**
- Verify `parent_org_id` can be set at org creation by a parent org admin.
- Verify `parent_org_id` cannot be set to the org's own ID.
- Verify `parent_org_id` does NOT grant parent org access to subsidiary resources (metadata only).
- Verify deleting a parent org sets subsidiary `parent_org_id` to NULL.

### Gate 2: Organization Members Junction Table

**Objective:** Create `organization_members` junction table for many-to-many memberships (ADR-001).

**Schema migration (additive):**
```sql
-- Migration: Organization members junction table (ADR-001)
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id UUID REFERENCES org_roles(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
```

**Code changes:** None in Gate 2 (the table is created; population happens in later gates).

**Pass criteria:**
- `organization_members` table exists with `(user_id, org_id, role_id, joined_at)`.
- Unique constraint on `(user_id, org_id)` prevents duplicate memberships.
- A user can belong to multiple orgs (verified by inserting two rows with the same `user_id` and different `org_id`).
- The legacy `users.org_id` column is NOT removed (retained for backward compatibility during Phase 1).

**Tests:**
- Verify a user can be added to multiple orgs.
- Verify duplicate membership (same user + same org) is rejected.
- Verify cascade delete (deleting a user removes their memberships; deleting an org removes its memberships).

### Gate 3: Organization Roles Namespace

**Objective:** Create `org_roles` and `org_role_permissions` tables. Seed four system roles (ADR-004).

**Schema migration (additive):**
```sql
-- Migration: Organization roles namespace (ADR-004)
CREATE TABLE IF NOT EXISTS org_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS org_role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(role_id, permission_key)
);

-- Seed four system roles (org_id = NULL for system roles)
INSERT INTO org_roles (org_id, name, description, is_system_role) VALUES
    (NULL, 'owner', 'Full org control including billing and member management', true),
    (NULL, 'admin', 'Org management except billing and owner transfer', true),
    (NULL, 'member', 'Standard org member — create and edit resources', true),
    (NULL, 'viewer', 'Read-only org member', true)
ON CONFLICT DO NOTHING;

-- Seed default permissions for system roles
-- (permission_key values to be defined in implementation)
```

**Code changes:** None in Gate 3 (tables and seed data only).

**Pass criteria:**
- `org_roles` and `org_role_permissions` tables exist.
- Four system roles seeded (owner, admin, member, viewer) with `org_id = NULL`.
- `users.role` (platform roles) is separate from `org_roles` (org roles) — verified by querying both.
- No platform role values (`user`, `admin`, `super_admin`, `staff`) appear in `org_roles`.

**Tests:**
- Verify four system roles exist with correct names.
- Verify system roles have `org_id = NULL`.
- Verify `users.role` and `org_roles.name` are separate namespaces (no collision).
- Verify custom org roles can be created (org_id set to a specific org).

### Gate 4: Active Organization Context Table

**Objective:** Create `user_active_org` table for server-side active org resolution (ADR-002).

**Schema migration (additive):**
```sql
-- Migration: Active organization context table (ADR-002)
CREATE TABLE IF NOT EXISTS user_active_org (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Code changes:** None in Gate 4 (table only; resolution function is Gate 5).

**Pass criteria:**
- `user_active_org` table exists with `(user_id, org_id, set_at)`.
- Primary key on `user_id` ensures one active org per user at a time.
- Inserting a row for a user who already has one updates the existing row (upsert behavior).

**Tests:**
- Verify a user's active org can be set.
- Verify setting a new active org replaces the previous one (not duplicate).
- Verify cascade delete (deleting a user removes their active org record).

### Gate 5: Active Org Context Resolution Function

**Objective:** Implement `getActiveOrgId(userId)` — server-side resolution (ADR-002).

**Implementation:**
```typescript
// lib/orgContext.ts (new file)
export async function getActiveOrgId(userId: string): Promise<string | null> {
  // 1. Check user_active_org table
  const activeOrg = await querySingle(
    'SELECT org_id FROM user_active_org WHERE user_id = $1', [userId]
  );
  if (activeOrg) {
    // Validate that the user is still a member of this org
    const membership = await querySingle(
      'SELECT 1 FROM organization_members WHERE user_id = $1 AND org_id = $2',
      [userId, activeOrg.org_id]
    );
    if (membership) return activeOrg.org_id;
    // Stale active org — user left this org; fall through to fallback
  }
  
  // 2. Fallback: most recently joined org
  const latestMembership = await querySingle(
    'SELECT org_id FROM organization_members WHERE user_id = $1 ORDER BY joined_at DESC LIMIT 1',
    [userId]
  );
  if (latestMembership) {
    // Update user_active_org for consistency
    await query(
      'INSERT INTO user_active_org (user_id, org_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET org_id = $2, set_at = NOW()',
      [userId, latestMembership.org_id]
    );
    return latestMembership.org_id;
  }
  
  // 3. No org memberships
  return null;
}
```

**Pass criteria:**
- `getActiveOrgId(userId)` returns a valid `org_id` or `NULL`.
- Does NOT trust client input — resolves entirely from server-side data.
- If the stored active org is stale (user left the org), falls back to most recent membership.
- If the user has no memberships, returns `NULL`.

**Tests:**
- Verify function returns the stored active org for a user with a valid membership.
- Verify function returns NULL for a user with no memberships.
- Verify function falls back to most recent membership when stored active org is stale.
- Verify function does NOT accept or use client-supplied org IDs.

### Gate 6: Extended Session/User Object

**Objective:** Extend `getUserFromRequest()` to include `active_org_id` and `org_role` (ADR-002).

**Implementation:**
```typescript
// Modification to lib/auth.ts — getUserFromRequest()
// The JWT is NOT modified. The session user object is extended.

export async function getUserFromRequest(req: Request): Promise<SessionUser | null> {
  // ... existing JWT verification ...
  const user = await fetchUserFromDB(userId);
  if (!user) return null;
  
  // NEW: resolve active org context
  const activeOrgId = await getActiveOrgId(user.id);
  let orgRole: string | null = null;
  if (activeOrgId) {
    const membership = await querySingle(
      `SELECT r.name as role_name FROM organization_members om
       JOIN org_roles r ON om.role_id = r.id
       WHERE om.user_id = $1 AND om.org_id = $2`,
      [user.id, activeOrgId]
    );
    orgRole = membership?.role_name ?? null;
  }
  
  return {
    ...user,
    active_org_id: activeOrgId,  // NEW field
    org_role: orgRole,            // NEW field
  };
}
```

**Pass criteria:**
- `getUserFromRequest()` returns `{...user, active_org_id, org_role}`.
- The JWT payload is NOT modified (still `{id, name, email, company}` — no org_id, no role).
- All 136 files using `getUserFromRequest()` continue to function (backward compatible — existing code that reads `user.id`, `user.email` etc. is unaffected).
- `active_org_id` is `NULL` for users with no org memberships.

**Tests:**
- Verify `getUserFromRequest()` returns `active_org_id` for a user with memberships.
- Verify `getUserFromRequest()` returns `active_org_id = NULL` for a user without memberships.
- Verify the JWT payload does NOT contain `active_org_id` or `org_role`.
- Verify existing code that reads `user.id`, `user.email` continues to work.

### Gate 7: Authorization Interface

**Objective:** Implement `canAccessResource(actor, resource)` — centralized authorization (ADR-003, ADR-004, ADR-005, ADR-006).

**Implementation:**
```typescript
// lib/authorization.ts (new file)
export interface AuthorizationContext {
  userId: string;
  platformRole: string;
  isFreePass: boolean;
  activeOrgId: string | null;
  orgRole: string | null;
}

export interface ResourceRef {
  type: string;
  id: string;
  organizationId: string | null;
  revisionId?: string;
}

export async function canAccessResource(
  actor: AuthorizationContext,
  resource: ResourceRef,
  action: 'read' | 'comment' | 'edit' | 'admin'
): Promise<boolean> {
  // 1. Platform super_admin or free pass bypass
  if (actor.platformRole === 'super_admin' || actor.isFreePass) {
    return true;
  }
  
  // 2. Org role check for the resource's owning org
  if (resource.organizationId && actor.activeOrgId === resource.organizationId) {
    const hasOrgPermission = await checkOrgRolePermission(
      actor.userId, resource.organizationId, action
    );
    if (hasOrgPermission) return true;
  }
  
  // 3. Participant grant check (ADR-005) — Phase 2 (requires resource ownership)
  // const hasParticipantAccess = await checkParticipantGrant(actor, resource, action);
  // if (hasParticipantAccess) return true;
  
  // 4. Share grant check (ADR-006) — Phase 2+ (requires file revisions)
  // const hasShareGrant = await checkShareGrant(actor, resource, action);
  // if (hasShareGrant) return true;
  
  // 5. Default Deny
  return false;
}
```

**Note:** In Phase 1, the participant and share grant checks are stubbed (not implemented) because they depend on resource ownership (Phase 2 / NEXT_ENTERPRISE_AUTHORITY_MIGRATION). The function structure is in place, and the org-role check is functional. The stubs will be activated in Phase 2.

**Pass criteria:**
- `canAccessResource()` function exists and returns boolean.
- Platform super_admin and `is_free_pass` bypass all checks.
- Org role check works for resources with a known `organizationId`.
- Default Deny: returns `false` when no check passes.
- Does NOT trust client input — uses only server-resolved context.
- Participant and share grant checks are stubbed (Phase 2).

**Tests:**
- Verify super_admin bypass returns true for any resource.
- Verify free pass bypass returns true for any resource.
- Verify org role check returns true for an org member with adequate permissions.
- Verify org role check returns false for an org member with inadequate permissions.
- Verify default deny returns false when no check passes.
- Verify the function does NOT accept client-supplied org IDs or roles.

### Gate 8: Org-Scoped Query Helper

**Objective:** Implement `getOrgScopedQuery(orgId, tableName)` — query helper (ADR-003).

**Implementation:**
```typescript
// lib/orgScopedQuery.ts (new file)
export function orgScopedWhere(orgId: string | null, alias: string = 'p'): string {
  if (!orgId) {
    // No active org — return a clause that matches nothing
    // (prevents accidental cross-tenant access for users without an org)
    return `${alias}.organization_id IS NULL AND 1=0`;
  }
  return `${alias}.organization_id = '${escapeIdentifier(orgId)}'`;
}

// Helper to build a scoped SELECT
export function buildOrgScopedSelect(
  orgId: string | null,
  columns: string,
  table: string,
  alias: string,
  extraWhere: string = ''
): string {
  const orgClause = orgScopedWhere(orgId, alias);
  const where = extraWhere ? `${orgClause} AND (${extraWhere})` : orgClause;
  return `SELECT ${columns} FROM ${table} ${alias} WHERE ${where}`;
}
```

**Pass criteria:**
- `orgScopedWhere()` adds `WHERE organization_id = ${orgId}` to a query.
- When `orgId` is NULL, returns a clause that matches nothing (prevents cross-tenant access for users without an org).
- Does NOT allow bypass via client-supplied orgId — the orgId parameter is always server-resolved.

**Tests:**
- Verify the helper adds the correct `WHERE organization_id = ?` clause.
- Verify NULL orgId produces a no-match clause.
- Verify the helper uses parameterized/escaped values (no SQL injection).

### Gate 9: Audit Log Org Context

**Objective:** Add org context columns to `audit_log` and update `writeAuditLog()` (ADR-013).

**Schema migration (additive):**
```sql
-- Migration: Audit log org context (ADR-013)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_organization_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resource_owner_organization_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_org ON audit_log(actor_organization_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource_org ON audit_log(resource_owner_organization_id, timestamp);
```

**Code changes:** Update `lib/auditLog.ts`:
- `AuditLogEntry` type gains `actor_organization_id` and `resource_owner_organization_id` fields.
- `writeAuditLog()` accepts org context parameters and populates the columns.
- `prev_hash` computation changes: query `SELECT entry_hash FROM audit_log WHERE actor_organization_id IS NOT DISTINCT FROM ${orgId} ORDER BY timestamp DESC LIMIT 1` (per-org chain, or platform chain for NULL).
- `verifyAuditChain()` accepts an optional `orgId` parameter and verifies only that org's chain.
- All convenience wrappers (`auditAuth()`, `auditData()`, `auditAdmin()`, `auditSecurity()`, `auditCompliance()`) gain an `organizationId` parameter.

**Pass criteria:**
- `actor_organization_id` and `resource_owner_organization_id` columns exist (nullable).
- New audit events include org context.
- `prev_hash` links to the previous event for the SAME org (per-org chain).
- `verifyAuditChain(orgId)` works for a specific org.
- Platform-level events (NULL org) form a separate chain.

**Tests:**
- Verify new audit events include org context columns.
- Verify `prev_hash` links within the same org, not globally.
- Verify per-org chain verification detects tampering in that org's chain.
- Verify tampering in Org A's chain does NOT break Org B's chain verification.
- Verify platform-level events form a separate chain.
- Verify backward compatibility: existing events with NULL org context are not corrupted.

### Gate 10: Tenant-Aware Audit Query API

**Objective:** Implement `GET /api/audit/org/{orgId}` (ADR-013).

**Implementation:**
```typescript
// app/api/audit/org/[orgId]/route.ts (new file)
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  
  const targetOrgId = params.orgId;
  
  // Authorization: org admin of target org OR platform super_admin
  if (user.role !== 'super_admin') {
    if (user.active_org_id !== targetOrgId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (user.org_role !== 'owner' && user.org_role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  
  const events = await query(
    `SELECT * FROM audit_log 
     WHERE actor_organization_id = $1 OR resource_owner_organization_id = $1
     ORDER BY timestamp DESC LIMIT 100`,
    [targetOrgId]
  );
  
  return Response.json({ events });
}
```

**Pass criteria:**
- API exists at `GET /api/audit/org/{orgId}`.
- Returns only the specified org's events.
- Non-admins (org members, viewers) are denied (403).
- Org-scoped admins cannot access other orgs' audit logs (403 for cross-org).
- Platform super_admin can access any org's audit log.

**Tests:**
- Verify org admin can access their own org's audit log.
- Verify org member (non-admin) is denied (403).
- Verify org admin cannot access another org's audit log (403).
- Verify platform super_admin can access any org's audit log.
- Verify the API returns only events for the specified org (no cross-tenant leakage).

### Gate 11: Dev Auth Bypass Audit

**Objective:** Add audit event for dev auth bypass usage in non-production (ADR-012).

**Implementation:**
- Modify `lib/dev-auth.ts` `getDevSessionUser()` to write an audit event when the bypass is activated.
- The audit event uses the platform chain (`actor_organization_id = NULL`).
- Category: `security`, action: `dev_auth_bypass_used`.

**Pass criteria:**
- Dev bypass in non-production writes an audit event.
- Dev bypass in production is still disabled (existing behavior preserved — verified in `lib/dev-auth.ts`: `isDevAuthAllowed()` returns false if `VERCEL_ENV === 'production'`).
- The audit event includes: actor_id (dev-user-bypass-001), action (dev_auth_bypass_used), request_path, ip_address, user_agent.

**Tests:**
- Verify dev bypass in non-production writes an audit event.
- Verify dev bypass in production is disabled (no session, no audit event).
- Verify the audit event has the correct category and action.

### Gate 12: Impersonation Hardening

**Objective:** Implement time-limited, tenant-aware, revocable impersonation (ADR-012).

**Schema migration (additive):**
```sql
-- Migration: Impersonation session hardening (ADR-012)
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS duration_minutes INT;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'normal'; -- normal | break_glass
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS revoked_by UUID;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS target_org_id UUID;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT false;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;
ALTER TABLE admin_impersonation_tokens ADD COLUMN IF NOT EXISTS customer_approval_token TEXT; -- required for extended sessions >30 min
```

**Code changes:**
- Modify `app/api/admin/impersonate/route.ts` POST: require `reason`, `duration_minutes`, and `session_type` (normal or break_glass); enforce tiered duration limits (Normal: default 30 min, max 240 min/4 hr; Break-glass: default 15 min, max 30 min; Extended >30 min requires `customer_approval_token`); validate tenant scoping (org-scoped admins can only impersonate users in their org); set `session_expires_at`; send email notification to target.
- Modify session JWT creation: include `_impersonationExpiresAt` and `_impersonationReason` claims.
- Modify `middleware.ts`: check `_impersonationExpiresAt` on every request; check revocation flag.
- New API: `POST /api/admin/impersonate/revoke` — revokes an active session.

**Pass criteria:**
- Org-scoped admins cannot impersonate users in a different org (403).
- Platform super_admin can impersonate any user with reason + duration per tiered model (Normal max 4 hr; Break-glass max 30 min).
- Sessions expire at `_impersonationExpiresAt` even if the cookie is still valid.
- Revocation terminates the session on the next request.
- Email notification is sent to the target user.
- All impersonation actions are audited with org context.

**Tests:**
- Verify org-scoped admin CANNOT impersonate a cross-tenant user (403).
- Verify platform super_admin CAN impersonate any user with reason + duration.
- Verify impersonation without reason is rejected (400).
- Verify impersonation with duration exceeding the session-type limit is rejected (400) (Normal: >240 min; Break-glass: >30 min).
- Verify session expires at `_impersonationExpiresAt`.
- Verify revocation terminates the session on next request.
- Verify email notification is sent.
- Verify all actions are audited with org context.

### Gate 13: Legacy Ownership Backfill Script (Dry-Run)

**Objective:** Implement the backfill script in dry-run mode (ADR-009).

**Implementation:**
```typescript
// scripts/backfill-org-ownership.ts (new file)
// This script runs in DRY-RUN mode by default.
// It does NOT execute changes unless --execute flag is passed.

async function backfillOrgOwnership(execute: boolean) {
  const report = {
    usersWithOrgId: 0,
    usersWithoutOrgId: 0,
    personalOrgsCreated: 0,
    resourcesAssigned: 0,
    ambiguityQueueEntries: 0,
  };
  
  // 1. Users with existing org_id: assign resources to their org
  // 2. Users without org_id: create personal org, assign resources
  // 3. Group by normalized company text: generate ambiguity queue
  
  if (execute) {
    // Execute the backfill
  } else {
    // Dry-run: report only
  }
  
  return report;
}
```

**Pass criteria:**
- Script runs in dry-run mode by default (no changes executed).
- Reports: number of users with `org_id`, number without, number of personal orgs that would be created, number of resources that would be assigned, number of ambiguity queue entries.
- Does NOT execute changes in dry-run mode.
- The `--execute` flag is required for live execution (and requires Raymond's approval per ADR-009).

**Tests:**
- Verify dry-run mode produces a report without executing changes.
- Verify the report correctly counts users with and without `org_id`.
- Verify the report correctly identifies ambiguity queue entries (same normalized `company` text).
- Verify the `--execute` flag is required for live execution.

### Gate 14: Ambiguity Queue Admin API

**Objective:** Implement ambiguity queue admin APIs (ADR-009).

**Schema migration (additive):**
```sql
-- Migration: Org merge suggestions table (ADR-009)
CREATE TABLE IF NOT EXISTS org_merge_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggested_company_name TEXT NOT NULL,
    user_ids UUID[] NOT NULL,
    org_ids UUID[] NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**APIs:**
- `GET /api/admin/migration/ambiguity-queue` — lists merge suggestions grouped by normalized `company` value (platform admin only).
- `POST /api/admin/migration/merge-orgs` — merges one or more personal orgs into a target org (platform admin only, audited).

**Pass criteria:**
- Ambiguity queue API exists and returns merge suggestions.
- Merge API is platform-admin only.
- Merge correctly reassigns all resources from source orgs to the target org.
- Merge is audited.
- Non-admins are denied (403).

**Tests:**
- Verify the ambiguity queue API returns suggestions grouped by normalized company.
- Verify the merge API requires platform admin (non-admins get 403).
- Verify the merge correctly reassigns resources to the target org.
- Verify the merge is audited.

### Gate 15: Phase 1 Entry Gate Verification

**Objective:** Run the full Phase 1 test suite and verify no regressions.

**Actions:**
1. Run all 121 test cases from the Authorization Test Matrix.
2. Verify all 280 API routes respond correctly (no 500 errors, no broken endpoints).
3. Verify MFA code, tests, evidence, and acceptance artifacts are untouched (checksum comparison).
4. Verify Phase 0 documents are unchanged.
5. Obtain Raymond's approval for the transition to Phase 2 (NEXT_ENTERPRISE_AUTHORITY_MIGRATION).

**Pass criteria:**
- All 121 test cases pass.
- No regressions across all 280 routes.
- MFA artifacts verified untouched.
- Phase 0 documents verified unchanged.
- Raymond has explicitly approved the transition to Phase 2.

**If any criterion fails:** The failing gate is reworked. NEXT_ENTERPRISE_AUTHORITY_MIGRATION remains PROHIBITED until all criteria pass and Raymond approves.

---

## Phase 1 to Phase 2 Transition

Once all 15 gates pass and Raymond approves, Phase 2 may begin. Phase 2 includes:

1. **NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** Add `organization_id` to resource tables (`projects`, `clients`, `productions`, `proposals`, `layouts`, `permits`, `surveys`, `geometry`). Execute the backfill script (Gate 13, live mode).
2. **File storage migration (ADR-007):** Migrate public blob URLs to private, org-prefixed storage with signed URLs.
3. **Billing migration (ADR-008):** Migrate per-user Stripe subscriptions to org-level customers.
4. **Project participant grants (ADR-005):** Implement the `project_participants` table and participant-based access.
5. **Resource share grants (ADR-006):** Implement the `resource_share_grants` table and revision-pinned sharing.

Phase 2 has its own entry gates and implementation sequence, to be defined in a Phase 2 specification document after Phase 1 is complete.

---

## Frozen Artifacts Inventory (Must Not Be Modified)

The following artifacts are FROZEN and must not be modified during Phase 1 implementation:

| Artifact | Location | Reason |
|----------|----------|--------|
| MFA implementation | `lib/mfa.ts` | COMPLETE AND CLOSED |
| MFA tests | Test files referencing `lib/mfa.ts` | Frozen |
| MFA evidence | Acceptance artifacts | Frozen |
| MFA recovery codes | `mfa_recovery_codes` table | Frozen |
| MFA columns on users | `mfa_enabled`, `mfa_method`, `mfa_secret_encrypted`, `mfa_verified_at`, `mfa_enrolled_at` | Frozen |
| `MFA_REQUIRED_ROLES` | `['admin', 'super_admin', 'staff']` in `lib/mfa.ts` | Frozen |
| JWT payload structure | `{id, name, email, company}` in `lib/auth.ts` | Frozen — active org is server-side, not in JWT |
| Phase 0 documents | 7 files in `docs/enterprise-multi-tenant/` | Authoritative inputs — no modification unless verified factual error |
| Audit log hash chain (existing) | Existing `audit_log` rows | Existing rows' `prev_hash` values are preserved |
| Frozen integrity records | Hash-chained audit logs, MFA evidence | Frozen |

---

## Document Footer

**Program Gates:** 15 (ADR-014) — Phase 1 is foundation-only (Gates 1-12); Gates 13-15 belong to later program phases
**Phase 1 Scope:** Foundational only — canonical orgs, memberships, active org context, role namespaces, authorization interfaces, audit context
**Phase 2 Scope (NOT in this spec):** Resource ownership migration, file storage migration, billing migration, participant grants, share grants
**NEXT_ENTERPRISE_AUTHORITY_MIGRATION Status:** PROHIBITED until all 15 gates pass and Raymond approves
**Frozen Artifacts:** 10 categories listed above
