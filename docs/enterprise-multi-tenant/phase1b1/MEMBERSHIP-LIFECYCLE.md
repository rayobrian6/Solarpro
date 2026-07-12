# Phase 1B.1 — Membership Lifecycle Correction

**Document type:** Workstream documentation (Workstream 3)
**Phase:** 1B.1 — Organization Authority Boundary and Lifecycle Correction
**Date:** 2026-07-12
**Commit covered:** `b31b4c06`
**Migration:** 106 (`lib/migrations/106_membership_org_lifecycle_correction.sql`)
**Implementer:** SuperNinja autonomous agent
**Status:** Complete — soft-delete lifecycle implemented, 27 adversarial tests passing

---

## 1. Executive Summary

Phase 1B implemented membership management with three statuses (`active`, `invited`, `suspended`) and used hard `DELETE` for member removal. This created two problems. First, the canonical authority model (ADR-001) specifies four membership statuses including `removed`, with `removed_at` and `removed_by` fields for audit trail. Second, hard deletion destroyed the audit trail entirely — there was no record that a member had ever existed, who removed them, or when. Threat model T-12 (member removal has no audit trail) flagged this as a HIGH/HIGH severity gap.

Phase 1B.1 corrects the membership lifecycle by adding the `removed` status, converting `removeMember()` from a hard `DELETE` to a soft-delete `UPDATE`, adding `joined_at`, `removed_at`, and `removed_by` columns, and invalidating the active organization context when a member is suspended or removed. The `getMembersByOrg()` function now defaults to returning only `active` members (previously returned all statuses), preventing removed and suspended members from appearing in member lists. Re-adding a previously removed member reactivates their original membership row rather than creating a duplicate, preserving the full membership history.

---

## 2. Defect 3 — Missing `removed` Status and Hard-Delete Lifecycle

### 2.1 The Defect

The `organization_members` table created by migration 105 had a CHECK constraint allowing only three statuses:

```sql
CHECK (status IN ('active', 'invited', 'suspended'))
```

The `removeMember()` function in `lib/organizations/memberships.ts` performed a hard `DELETE`:

```typescript
await sql`DELETE FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}`;
```

This permanently destroyed the membership row, eliminating any evidence that the user had ever been a member, who removed them, or when the removal occurred.

### 2.2 Canonical Model Violation

ADR-001 specifies the membership status lifecycle as `active | invited | suspended | removed` and requires `removed_at`, `removed_by`, and `joined_at` fields on the membership record. The hard-delete approach made these fields impossible to populate and eliminated the audit trail that threat model T-12 requires.

### 2.3 The Correction

Migration 106 (`lib/migrations/106_membership_org_lifecycle_correction.sql`) performs the following schema changes:

**Membership status constraint** — drops and recreates `organization_members_status_check` to add `removed`:

```sql
ALTER TABLE organization_members DROP CONSTRAINT organization_members_status_check;
ALTER TABLE organization_members ADD CONSTRAINT organization_members_status_check
  CHECK (status IN ('active', 'invited', 'suspended', 'removed'));
```

**Lifecycle timestamp columns** — adds three columns to `organization_members`:

```sql
ALTER TABLE organization_members ADD COLUMN joined_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN removed_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN removed_by UUID;
```

**Backfill** — populates `joined_at` for existing active members from `created_at`:

```sql
UPDATE organization_members SET joined_at = created_at WHERE joined_at IS NULL AND status = 'active';
```

**Partial index for removed members** — enables efficient querying of removed-member history:

```sql
CREATE INDEX idx_org_members_removed ON organization_members (organization_id, user_id) WHERE status = 'removed';
```

The `removeMember()` function was converted from hard `DELETE` to soft-delete `UPDATE`:

```typescript
await sql`
  UPDATE organization_members
  SET status = 'removed',
      removed_at = NOW(),
      removed_by = ${removedBy}::uuid
  WHERE organization_id = ${orgId} AND user_id = ${userId}
    AND status IN ('active', 'invited', 'suspended')
`;
```

---

## 3. Active Context Invalidation

### 3.1 The Problem

When a member is suspended or removed, their active organization context (the `active_organization_context` row that records which org they are currently operating in) must be invalidated. Otherwise, the user's next request would resolve to an organization they are no longer authorized to access.

### 3.2 The Correction

The `suspendMember()` and `removeMember()` functions now delete the user's active org context row when the affected org matches the active context:

```typescript
// Invalidate active org context if the user was operating in this org
await sql`
  DELETE FROM active_organization_context
  WHERE user_id = ${userId} AND organization_id = ${orgId}
`;
```

The `resolveActiveOrg()` function falls back to the user's primary active membership when the active context is missing, re-inserting a default context row. This ensures the user always has a valid active org (their primary membership) after a suspension or removal from another org.

---

## 4. Re-Add Reactivation

### 4.1 The Problem

If a member is removed and later re-added to the same organization, a naive implementation would attempt to `INSERT` a new row, violating the `UNIQUE(organization_id, user_id)` constraint. Phase 1B's `addMember()` function used `INSERT ... ON CONFLICT DO NOTHING`, which would silently fail to re-add a removed member because the row already existed (with status `removed`).

### 4.2 The Correction

The `addMember()` function now uses `INSERT ... ON CONFLICT (organization_id, user_id) DO UPDATE` to reactivate a removed membership:

```typescript
await sql`
  INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
  VALUES (${orgId}::uuid, ${userId}::uuid, ${role}, 'active', NOW())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    status = 'active',
    role = EXCLUDED.role,
    joined_at = COALESCE(organization_members.joined_at, NOW()),
    removed_at = NULL,
    removed_by = NULL
  WHERE organization_members.status = 'removed'
`;
```

This preserves the original `joined_at` (if it was set) and clears the removal metadata, restoring the membership to active status. If the membership is not in `removed` status (e.g., it is `active` or `suspended`), the `WHERE` clause prevents the update, and the function returns an appropriate error.

---

## 5. Membership Status Lifecycle

The corrected membership lifecycle is:

```
                    addMember()
invited ──────────────────────────→ active
   │                                 │
   │ expire/decline                  │ suspendMember()
   ↓                                 ↓
removed ←──── removeMember() ──── suspended
   │                                 │
   │ re-add (addMember)              │ reactivateMember()
   ↓                                 ↓
active                            active
```

| Status | Meaning | Visible in member list | Can perform org actions |
|--------|---------|----------------------|----------------------|
| `active` | Full member | Yes | Yes (per org role) |
| `invited` | Invitation sent, not yet accepted | No | No |
| `suspended` | Temporarily disabled by admin | No | No |
| `removed` | Permanently removed (soft-delete) | No | No |

The `getMembersByOrg()` function defaults to returning only `active` members. Callers can pass `'all'` to retrieve all statuses (for administrative views) or a specific status (for filtered views).

---

## 6. Legacy Compatibility

The `syncLegacyOrgId()` function re-syncs `users.org_id` to the user's primary active membership after a removal. If the removed membership was the user's primary org (the one pointed to by `users.org_id`), the function finds the user's next active membership and updates `users.org_id` accordingly. If no active memberships remain, `users.org_id` is set to NULL. This ensures the legacy pointer remains consistent with the canonical membership table.

---

## 7. Files Changed

| File | Change |
|------|--------|
| `lib/migrations/106_membership_org_lifecycle_correction.sql` | New migration: add `removed` status, `joined_at`/`removed_at`/`removed_by` columns, backfill, partial index |
| `lib/organizations/types.ts` | Add `removed` to `MembershipStatus`, add `joined_at`/`removed_at`/`removed_by` to `OrganizationMember` type |
| `lib/organizations/memberships.ts` | Convert `removeMember()` to soft-delete, add context invalidation, change `getMembersByOrg()` default to `'active'`, add re-add reactivation in `addMember()` |
| `tests/phase1b1-membership-lifecycle.test.ts` | 27 adversarial tests |
| `tests/phase1b-membership-adversarial.test.ts` | Updated for migration 106 schema changes |

---

## 8. Test Evidence

### 8.1 Membership Lifecycle Tests (`tests/phase1b1-membership-lifecycle.test.ts`)

27 tests covering the full membership lifecycle:

- `removeMember()` sets status to `removed` (not hard delete)
- `removeMember()` sets `removed_at` timestamp
- `removeMember()` sets `removed_by` to the actor
- `removeMember()` invalidates active org context
- `removeMember()` syncs legacy `users.org_id`
- `removeMember()` protects last owner from removal
- `removeMember()` returns error for non-existent member
- `suspendMember()` sets status to `suspended`
- `suspendMember()` invalidates active org context
- `suspendMember()` prevents self-suspend
- `suspendMember()` protects last owner
- `reactivateMember()` restores `active` status
- `reactivateMember()` clears suspension metadata
- `addMember()` reactivates a `removed` membership
- `addMember()` preserves original `joined_at` on reactivation
- `addMember()` clears `removed_at`/`removed_by` on reactivation
- `addMember()` returns error if membership is already `active`
- `addMember()` returns error if membership is `suspended` (must reactivate first)
- `getMembersByOrg()` returns only `active` members by default
- `getMembersByOrg()` with `'all'` returns all statuses
- `getMembersByOrg()` with `'removed'` returns only removed members
- Removed member is not in active member list
- Removed member cannot perform org actions
- Suspended member cannot perform org actions
- Invited member cannot perform org actions
- `joined_at` is backfilled from `created_at` for existing members
- Re-adding a removed member does not create duplicate rows
