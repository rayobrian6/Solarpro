# Phase 1B.1 — Correctness Audit

> **Document role:** Audit-first, evidence-bearing record. This document is
> produced as Commit 1 of the Phase 1B.1 initiative. It identifies every defect
> in the live Phase 1B implementation that contradicts the approved canonical
> authority model, ADRs, and threat model. No source files are modified in this
> commit. All citations are line-accurate against the repository state at commit
> `6ba1dbd6` (HEAD of `dev` at audit time).
>
> **Audited repository state:** `dev` branch, commit `6ba1dbd6e987f5e82b9b7cc9605c0d3dd556efc3`
>
> **Audit performed by:** SuperNinja Agent
>
> **Phase 1B end commit:** `a31224d9` (reachable, 8 commits back from `6ba1dbd6`)

---

## 1. Audit Scope and Methodology

This audit examines the Phase 1B organization authority implementation against
the following authoritative sources, which were read in full during the audit:

- `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-CANONICAL-AUTHORITY-MODEL.md` — 10 canonical diagrams
- `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-AUTHORITY-ARCHITECTURE-DECISION-RECORDS.md` — ADR-001 through ADR-012+
- `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-THREAT-MODEL.md` — 20 numbered threats
- `docs/enterprise-multi-tenant/ENTERPRISE-MULTI-TENANT-AUTHORITY-ARCHITECTURE.md` — Phase 0 architecture (principles P-01 through P-12)
- `docs/enterprise-multi-tenant/phase1b/PHASE1B-CURRENT-STATE-AUDIT.md` — Phase 1B's own pre-implementation audit
- `docs/enterprise-multi-tenant/phase1b/PHASE1B-FINAL-REPORT.md` — Phase 1B completion report

The following Phase 1B source files were read line-by-line:

| File | Lines | Role |
|------|-------|------|
| `lib/organizations/authorization.ts` | 577 | Default-deny authorization engine |
| `lib/organizations/memberships.ts` | ~650 | Data access layer |
| `lib/organizations/context.ts` | ~400 | Server-authoritative active org context |
| `lib/organizations/service.ts` | ~350 | High-level orchestration |
| `lib/organizations/permissions.ts` | ~230 | Permission matrix |
| `lib/organizations/types.ts` | ~270 | Canonical type definitions |
| `lib/organizations/index.ts` | 111 | Barrel exports |
| `lib/migrations/105_organization_authority_foundation.sql` | 223 | Schema migration |
| `app/api/organizations/[id]/route.ts` | 128 | Org detail API |
| `app/api/organizations/[id]/members/route.ts` | 204 | Members collection API |
| `app/api/organizations/[id]/members/[userId]/route.ts` | 276 | Member detail API |
| `app/api/organizations/active/route.ts` | 183 | Active org context API |
| `app/api/organizations/features/route.ts` | 39 | Feature flag surface |
| `app/api/organizations/mine/route.ts` | 61 | User's memberships API |
| `components/settings/OrganizationAuthorityPanel.tsx` | 682 | Client UI panel |
| `components/settings/OrganizationPanelWrapper.tsx` | 25 | Server component wrapper |
| `lib/auditLog.ts` | — | Centralized audit logging |
| `lib/adminAuth.ts` | — | Admin authentication |

---

## 2. Confirmed Defects

Seven defects are confirmed. Each is cited against the live source code and
cross-referenced against the canonical authority model, ADRs, or threat model
it violates.

### Defect 1 — Standing Platform-Admin Cross-Tenant Bypass in `authorize()`

**Severity:** CRITICAL (authority boundary violation)

**Location:** `lib/organizations/authorization.ts`, lines 162–164

```typescript
// 2. Check platform role — super_admin/admin bypass org checks
const platformRole = await getPlatformRole(userId);
if (isPlatformAdmin(platformRole)) {
  return { allowed: true, reason: 'allowed' };
}
```

**What it does:** The primary authorization function (`authorize()`) checks the
user's platform role at step 2, before checking org existence, membership, or
org role. If the platform role is `super_admin` or `admin`, the function
returns an immediate `allowed: true` with no further checks. This grants
platform administrators unconditional cross-tenant access to every organization
in the system, including organizations they have no membership in.

**The helper:** `isPlatformAdmin()` at line 119:

```typescript
function isPlatformAdmin(platformRole: string): boolean {
  const r = platformRole.toLowerCase();
  return r === 'super_admin' || r === 'admin';
}
```

**What the canonical model requires:** Diagram 3 of the Canonical Authority
Model specifies that a `super_admin` bypass applies **only to platform-level
resources**, and that an admin acting within their own organization must still
check their organization role. Cross-organization access requires explicit
participant grants — it is never automatic. ADR-004 (Platform Roles vs
Organization Roles) establishes that platform roles and org roles occupy
**separate namespaces**: a platform admin is **not** automatically an org admin
and does not automatically receive org-scoped permissions. Architecture
Principle P-10 (Scoped Admin Access) states that customer admin access is
scoped to the admin's organization, and platform super_admin retains global
access **only for support and operations** with enhanced audit logging and
step-up MFA — not as a standing grant.

**Phase 1B's own admission:** The Phase 1B Final Report, section 3.4, states:
"Platform admins (`super_admin`, `admin`) bypass org-role checks for
cross-tenant access. This is the mechanism by which SolarPro support staff can
access any org." This is the defect Phase 1B.1 is authorized to correct.

**Correct direction:** Remove the unconditional bypass. Platform roles must
remain a separate namespace from org roles. Support access — if enabled at all
— must be explicit, time-limited, scoped, reason-bound, audited, read-only by
default, and revocable. When no support-elevation mechanism is active, the
default must be fail-closed: platform admins without org membership are denied,
identical to any other non-member.

---

### Defect 2 — Standing Platform-Admin Bypass in `authorizeMemberAction()` and `authorizeRoleChange()`

**Severity:** CRITICAL (authority boundary violation)

**Locations:**

- `lib/organizations/authorization.ts`, lines 320–330 (`authorizeMemberAction`)
- `lib/organizations/authorization.ts`, lines 393–401 (`authorizeRoleChange`)

`authorizeMemberAction()` at line 320:

```typescript
// 3. Platform admins bypass member-to-member checks
const platformRole = await getPlatformRole(actorId);
if (isPlatformAdmin(platformRole)) {
  // But still check owner protection (even admins can't remove the last owner)
  if (action === 'remove' || action === 'change_role' || action === 'suspend') {
    const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, action);
    if (!ownerProtection.allowed) return ownerProtection;
  }
  return { allowed: true, reason: 'allowed' };
}
```

`authorizeRoleChange()` at line 393:

```typescript
// 2. Platform admins bypass role assignment checks
const platformRole = await getPlatformRole(actorId);
if (isPlatformAdmin(platformRole)) {
  // But still check owner protection (can't demote last owner)
  const ownerProtection = await checkOwnerProtection(organizationId, targetUserId, 'change_role');
  if (!ownerProtection.allowed) return ownerProtection;
  return { allowed: true, reason: 'allowed' };
}
```

**What it does:** Both member-level authorization functions contain the same
pattern: a platform admin can remove, suspend, change the role of, or
reactivate any member in any organization — including organizations where they
are not a member — without any org-role check. The only guard is last-owner
protection. This means a platform admin can invite, remove, or restructure
members in any tenant's organization.

**What the canonical model requires:** The same ADR-004 and Diagram 3
requirements apply. Member-to-member operations are org-scoped operations; they
require an org role with sufficient privilege. Platform admin status does not
confer org role privileges. Diagram 3 explicitly shows that admin acting within
their own org checks org role, and cross-org requires participant grants.

**Correct direction:** Remove both bypass blocks. A platform admin who needs to
perform member-to-member operations in a tenant's org must either be a member
with sufficient org role, or must have an active, scoped support elevation that
explicitly authorizes the operation. The last-owner protection logic should
remain for all actors.

---

### Defect 3 — Platform-Admin Membership Bypass in Org Detail API Route

**Severity:** CRITICAL (authority boundary violation, API layer)

**Location:** `app/api/organizations/[id]/route.ts`, lines 57–66

```typescript
// Platform admins bypass membership checks
const isPlatformAdmin = await isPlatformAdminUser(user.id);

if (!isPlatformAdmin) {
  // Check membership in the requested org directly using the new system
  const member = await isMember(orgId, user.id);
  if (!member) {
    return NextResponse.json(
      { success: false, error: 'You are not a member of this organization' },
      { status: 403 }
    );
  }
}
```

**What it does:** The GET handler for a single organization's details checks
whether the user is a platform admin. If they are, the membership check is
skipped entirely, and the org's details and member list are returned regardless
of membership. This is a route-layer manifestation of the same authority
boundary violation as Defects 1 and 2, but in the API surface directly rather
than in the authorization engine.

**What the canonical model requires:** The same ADR-004 / Diagram 3 / P-10
requirements. Viewing an organization's details and members is an org-scoped
read. It requires org membership. Platform admin status alone does not satisfy
this.

**Correct direction:** Remove the `isPlatformAdmin` bypass. The route should
call `authorize()` with the appropriate read action (`org:view_settings` or
`member:view`) for all users. If the authorization engine is corrected to
remove the bypass (Defects 1–2), this route's explicit bypass becomes redundant
but should still be removed for defense-in-depth and to ensure the route uses
the centralized engine rather than its own ad-hoc check.

---

### Defect 4 — Enforcement Advisory Mode Allows Mutations After Denied Authorization

**Severity:** HIGH (default-deny violation)

**Locations:**

- `lib/organizations/authorization.ts`, lines 475–490 (`enforceAuthz`)
- `lib/organizations/authorization.ts`, lines 492–510 (`enforceMemberAction`)
- `app/api/organizations/[id]/members/route.ts`, lines 59–71 (GET advisory fall-through)
- `app/api/organizations/[id]/members/route.ts`, line 169 (POST enforcement gate)
- `app/api/organizations/[id]/members/[userId]/route.ts`, PATCH/DELETE/PUT enforcement gates

`enforceAuthz()` at line 475:

```typescript
export async function enforceAuthz(
  userId: string,
  organizationId: string,
  action: OrgAction
): Promise<void> {
  const result = await authorize(userId, organizationId, action);
  logAuthzDecision(userId, organizationId, action, result);

  if (!result.allowed && isEnforcementEnabled()) {
    const denied = result as DeniedAuthzResult;
    throw new AuthzError(denied.reason, denied.detail);
  }
}
```

Members route GET at line 59:

```typescript
if (isOrgAuthzActive()) {
  // Enforce authorization
  await enforceAuthz(user.id, orgId, 'member:view');
} else {
  // Advisory check (logged but not enforced)
  const authz = await authorize(user.id, orgId, 'member:view');
  if (!authz.allowed) {
    // In advisory mode, fall through to legacy path if denied
  }
}
```

**What it does:** When the `ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED` flag is
`false` (which is the default, as all feature flags default to false), the
`enforceAuthz()` and `enforceMemberAction()` functions compute the authorization
decision, log it via `console.warn`, but **do not throw**. The caller then
proceeds with the mutation. In the API routes, the pattern is even more explicit:
routes check `isOrgAuthzActive()` (which requires both the authority flag and the
enforcement flag to be true) and only call `enforceAuthz()` when both are true.
When either is false, the advisory path runs, and denied decisions result in a
comment-only `if (!authz.allowed) { /* fall through */ }` block that does nothing.

**The flag helper** at line 438:

```typescript
export function isEnforcementEnabled(): boolean {
  return isOrgFeatureEnabled('ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED');
}
```

All feature flags default to `false` (fail-closed in the sense of "not enabled"),
but the consequence is that **the authority system is effectively disabled by
default**: denied authorizations do not block mutations. This inverts the
default-deny principle. A system that only enforces denials when a flag is
explicitly set is not default-deny — it is default-allow with opt-in enforcement.

**What the canonical model requires:** Architecture Principle P-01 is
Default-Deny. The canonical model's authorization decision sequence (Diagram 3)
always ends in either ALLOW (after all checks pass) or DENY (on first failing
check). There is no advisory mode in the canonical model. Threat T-02 (Admin
route global data exposure) is rated CRITICAL/HIGH and requires org-scoped
access enforcement, not advisory logging.

**Phase 1B's own admission:** The Phase 1B Final Report, section 9.3, states:
"Authorization enforcement runs in advisory mode (defaults to false). Denied
decisions are logged but not enforced unless
`ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED=true`."

**Correct direction:** The new authority APIs must always enforce denied
decisions. The enforcement flag should not be able to convert a denial into an
allow. The advisory mode was an intentional Phase 1B safety mechanism for
rolling out alongside the legacy system, but it contradicts the default-deny
principle that the authority model requires. The flag should gate whether the
new authority path is used at all (already handled by the authority-enabled
flag), not whether denials are enforced within that path. Once the new path is
taken, denials must be enforced unconditionally.

---

### Defect 5 — Hard Delete in `removeMember()` Destroys Membership Audit History

**Severity:** HIGH (audit trail destruction, lifecycle semantics)

**Location:** `lib/organizations/memberships.ts`, lines 431–436

```typescript
// Delete the membership row (hard delete — the row is gone)
await sql`
  DELETE FROM organization_members
  WHERE organization_id = ${organizationId}
    AND user_id = ${userId}
`;
```

**What it does:** The `removeMember()` function performs a hard `DELETE` of the
membership row from `organization_members`. Once removed, all record of the
membership — including the user's role, join date, and the fact that they were
ever a member — is permanently destroyed. There is no `removed` status, no
`removed_at` timestamp, and no `removed_by` actor record.

**What the canonical model requires:** ADR-001 (Membership Cardinality)
specifies the `organization_members` table with `status TEXT NOT NULL DEFAULT
'active' -- active|invited|suspended|removed` and explicit `joined_at`,
`removed_at`, and `removed_by` columns. The Canonical Authority Model Diagram 1
shows the membership lifecycle with a `removed` terminal state. Architecture
Principle section 2.1 specifies the same `active|invited|removed|suspended`
status vocabulary. Threat T-12 (Member removal has no audit trail, rated
MEDIUM/MEDIUM) requires `removed_at`/`removed_by` fields for audit trail
completeness. Threat T-18 (Member removal leaves resources accessible,
HIGH/MEDIUM) also depends on the membership row being retained for cleanup
logic.

**What Phase 1B implemented:** Migration 105 (line 77–78) only allows three
statuses:

```sql
status          TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'invited', 'suspended')),
```

The `removed` status is absent. There are no `removed_at` or `removed_by`
columns in the migration. The `MembershipStatus` type in `types.ts` (line 62)
matches the migration: `'active' | 'invited' | 'suspended'` — no `removed`.

**Correct direction:** Introduce a new migration (106) that adds the `removed`
status to the `organization_members` CHECK constraint and adds `joined_at`,
`removed_at`, and `removed_by` columns. Change `removeMember()` to perform a
soft-delete: set `status = 'removed'`, `removed_at = now()`, `removed_by =
removedBy` instead of hard-deleting the row. The membership row must be retained
for audit trail and resource-cleanup logic. The `MembershipStatus` type and
`MEMBERSHIP_STATUSES` array must be updated to include `'removed'`. The
`mapMembership()` function and the `OrganizationMembership` interface must map
the new fields.

---

### Defect 6 — `deleted` Organization Status Instead of `archived`

**Severity:** MEDIUM (lifecycle semantics, canonical vocabulary mismatch)

**Locations:**

- `lib/migrations/105_organization_authority_foundation.sql`, lines 35–36 (CHECK constraint)
- `lib/migrations/105_organization_authority_foundation.sql`, line 44 (`deleted_at` column)
- `lib/organizations/types.ts`, lines 75 and 77 (`OrgStatus` type and `ORG_STATUSES`)
- `lib/organizations/types.ts`, line 122 (`deletedAt` field on `Organization`)
- `lib/organizations/service.ts` (`getOrganization` filters `status != 'deleted'`)

Migration 105, line 35:

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'deleted'));
```

`types.ts`, line 75:

```typescript
export type OrgStatus = 'active' | 'suspended' | 'deleted';
```

**What it does:** The organization lifecycle uses `deleted` as the terminal
soft-delete status, with a `deleted_at` timestamp. The `OrgStatus` type and
the `ORG_STATUSES` array in `types.ts` both use `deleted`. The service layer
filters archived organizations with `status != 'deleted'`.

**What the canonical model requires:** The Canonical Authority Model and the
Architecture section 2.1 use `archived` as the organization terminal state, not
`deleted`. The rationale is that organizations are never truly deleted — they
are archived (retained for audit, historical reference, and potential
reinstatement). Using `deleted` creates a semantic mismatch: the code says
"deleted" but the behavior is archival (the row is retained). This is not a
security defect per se, but it is a canonical vocabulary mismatch that will
cause confusion and inconsistency as the authority model is extended.

**Correct direction:** Introduce migration 106 to change the CHECK constraint
from `'deleted'` to `'archived'`, rename `deleted_at` to `archived_at`, and
backfill any existing `deleted` rows to `archived`. Update `OrgStatus` to
`'active' | 'suspended' | 'archived'`, update `ORG_STATUSES`, rename `deletedAt`
to `archivedAt` on the `Organization` interface, and update the service layer
to filter on `status != 'archived'`. The `org:delete` permission action should
be reviewed for renaming to `org:archive` to match the corrected vocabulary
(this is a type-level and permission-matrix change, done carefully to avoid
breaking existing action string consumers).

---

### Defect 7 — No Tenant-Aware Audit Context for Authority Operations

**Severity:** HIGH (compliance gap, audit integrity)

**Locations:**

- `lib/organizations/authorization.ts`, lines 451–463 (`logAuthzDecision`)
- `lib/auditLog.ts` (no organization-specific audit actions or org-context columns)

`logAuthzDecision()` at line 451:

```typescript
export function logAuthzDecision(
  userId: string,
  organizationId: string,
  action: string,
  result: AuthzResult
): void {
  const status = result.allowed ? 'ALLOWED' : `DENIED(${(result as DeniedAuthzResult).reason})`;
  const detail = result.allowed ? '' : `: ${(result as DeniedAuthzResult).detail}`;
  // Using console.warn so it appears in server logs for audit purposes.
  // In production, this would be routed to the audit log (lib/auditLog.ts).
  console.warn(
    `[AUTHZ] user=${userId} org=${organizationId} action=${action} → ${status}${detail}`
  );
}
```

**What it does:** Authorization decisions are logged exclusively via
`console.warn`, emitting a single-line string to stdout/stderr. The comment
acknowledges: "In production, this would be routed to the audit log
(`lib/auditLog.ts`)." No routing exists. The `organizationId` is embedded in
the log string but is not structured data. No member-lifecycle event
(invite, remove, suspend, reactivate, role change) is written to the
tamper-evident audit log at all.

**What the canonical model requires:** Diagram 10 of the Canonical Authority
Model specifies an audit event flow with `actor_organization_id` and
`resource_owner_organization_id` columns, and per-org hash chains. ADR-013
requires tenant-aware audit context. Threat T-08 (Audit log lacks org context,
rated HIGH/HIGH) identifies this as a compliance gap. The existing
`lib/auditLog.ts` has a hash-chained, tamper-evident audit log with categories
(auth, access, data, config, security, admin, billing, compliance, migration)
and actions, but it has **no organization-specific audit actions** and **no
org-context columns**. The hash chain is global, not per-org.

**Correct direction:** Add organization-specific audit actions to the audit log
vocabulary (e.g., `organization.created`, `organization.updated`,
`organization.archived`, `organization.membership.invited`,
`organization.membership.removed`, `organization.membership.suspended`,
`organization.membership.reactivated`, `organization.membership.role_changed`,
`organization.authz.decision`). Route `logAuthzDecision()` and member-lifecycle
operations through the structured audit log rather than `console.warn`. The
audit log must capture the actor's org context and the resource's owning org.
Audit logging must fail-closed: if an audit write fails for an authority
mutation, the mutation must not proceed (or must be rolled back). This is
Workstream 5.

---

## 3. Defect Summary Table

| # | Defect | Severity | Workstream | Canonical Source Violated |
|---|--------|----------|------------|---------------------------|
| 1 | Standing platform-admin bypass in `authorize()` | CRITICAL | 1 | ADR-004, Diagram 3, P-10 |
| 2 | Standing platform-admin bypass in `authorizeMemberAction()` / `authorizeRoleChange()` | CRITICAL | 1 | ADR-004, Diagram 3, P-10 |
| 3 | Platform-admin membership bypass in org detail route | CRITICAL | 1 | ADR-004, Diagram 3, P-10 |
| 4 | Enforcement advisory mode allows mutations after denial | HIGH | 2 | P-01 (Default-Deny), T-02 |
| 5 | Hard delete in `removeMember()` destroys audit history | HIGH | 3 | ADR-001, Diagram 1, T-12, T-18 |
| 6 | `deleted` org status instead of `archived` | MEDIUM | 4 | Canonical vocabulary, Arch §2.1 |
| 7 | No tenant-aware audit context for authority operations | HIGH | 5 | Diagram 10, ADR-013, T-08 |

---

## 4. What This Audit Does NOT Cover (Phase 1B.1 Boundary)

Per the authorization document, Phase 1B.1 does **not** address the following,
which are out of scope and must not be touched:

- Project/client/proposal/site-survey/permit organization ownership
- Cross-company collaboration
- Project participants and share grants
- Organization billing migration
- Ownership transfers
- Row-Level Security (RLS) rollout
- Storage migration
- Worker/cron tenant conversion
- Production database access or migration execution
- Tenant cutover
- MFA changes (MFA Phase 3 is FROZEN and CLOSED — `lib/mfa.ts`, MFA migrations,
  MFA tests, MFA acceptance scripts/evidence, frozen hashes, recovery/enrollment/
  TOTP validation behavior must not be modified)

---

## 5. Migration Governance Note

Migration 105 (`105_organization_authority_foundation.sql`) is a **committed,
immutable migration** with a checksum recorded in the migration governance
ledger. Phase 1B.1 must **not modify** migration 105. The schema corrections
for Defects 5 and 6 (adding the `removed` membership status and `joined_at`/
`removed_at`/`removed_by` columns, and changing `deleted` to `archived` org
status) must be introduced via a **new migration 106**, created only after
verifying the next valid migration identifier through the canonical migration
runner.

Migration 105 must be verified through the canonical migration runner locally
(Workstream 6) to confirm it applies cleanly and produces the expected schema.
This verification is evidence-gathering, not modification.

---

## 6. Baseline Test Evidence

The following baseline tests were run and confirmed passing before this audit
commit, establishing the pre-correction test baseline:

| Test suite | Result | Notes |
|------------|--------|-------|
| `npx tsc --noEmit` | 0 errors | `NODE_OPTIONS="--max-old-space-size=4096"` required |
| `tests/phase1b-permissions-pure.test.ts` | 45/45 pass | Pure unit tests, no DB |
| `tests/phase1b-organization-schema.test.ts` | 23/23 pass | DB-backed, `TEST_DATABASE_URL` set |
| `tests/phase1b-membership-adversarial.test.ts` | 31/31 pass | DB-backed adversarial |
| `tests/phase1a-migration-governance.test.ts` | 306/306 pass | Migration governance |

Test database: `postgresql://testuser:testuser@localhost:5432/migration_gov_test`
with `pgcrypto` extension installed.

---

## 7. Commit Plan Reference

This audit document is **Commit 1** of the 9-commit Phase 1B.1 strategy. The
subsequent commits address the defects identified above:

1. **This document** — Correctness audit (no source changes)
2. Workstream 1 — Remove platform-admin bypass, add support-elevation boundary
3. Workstream 2 — Fix enforcement flag behavior
4. Workstream 3 — Membership lifecycle (`removed` status, soft-delete)
5. Workstream 4 — Organization lifecycle (`archived` status)
6. Workstream 5 — Tenant-aware audit context
7. Workstream 6+7 — Migration 105 verification + migration 106 creation
8. Workstream 8 — New test files
9. Documentation + final report

All commits are made directly on `dev`, small and reviewable, with git author
`SuperNinja Agent <noreply@ninjatech.ai>`.

---

*End of Phase 1B.1 Correctness Audit.*
