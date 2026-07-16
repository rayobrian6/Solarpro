# Phase 1B — Current-State Organization Authority Audit

**Document type:** Audit-first inspection record (Commit 1 of 9)
**Phase:** 1B — Organization Authority Foundation
**Date:** 2026-07-12
**Base commit:** `cedbfd88` (origin/dev, post-rebase)
**Inspector:** SuperNinja autonomous agent
**Status:** Complete — all findings verified by direct file inspection

---

## 1. Purpose and Scope

This document records the exact state of every organization-related code path, schema object, API route, UI component, and data model in the SolarPro codebase **before any Phase 1B changes are made**. It fulfills the audit-first requirement: inspect existing organization implementation before changing anything. Every finding below was verified by reading the actual source files, not by assumption.

The audit covers:

- Database schema: the `organizations` table, `users.org_id`, `users.org_role`, and the `org_invites` table
- API routes: all endpoints under `/api/organizations`
- UI components: the existing `OrganizationPanel` and its integration into the settings page
- Authentication and session: the `SessionUser` interface, JWT payload, and `getUserFromRequest`
- Platform vs. organization role models: `users.role` vs. `users.org_role`
- Project ownership model: `projects.user_id` scoping
- Billing integration: `syncSeatsForOrg` seat counting
- Audit logging: `lib/auditLog.ts` categories and actions
- Permission system: `lib/permissions.ts` plan-based access
- Existing tests: search for organization-related test coverage

---

## 2. Database Schema

### 2.1 Migration 016 — organizations (the existing org model)

**File:** `lib/migrations/016_organizations.sql`

The organizations table is a simple company-hierarchy model introduced to allow multiple SolarPro users to share a single subscription plan under one organization.

```sql
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'contractor',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Key observations:

- **`owner_id` is a single-column foreign key** to `users(id)`. The owner is recorded as a column on the organization row itself — not via a membership table. This is a 1:1 owner reference, not a many-to-many membership.
- **`plan` defaults to `'contractor'`** and is described as "inherits from owner." There is no separate organization billing entity — the plan is stored directly on the organization row.
- There is no `slug`, no `status`, no `suspended_at`, no `deleted_at` (soft delete), and no organization-level settings or metadata columns.

### 2.2 users.org_id and users.org_role — the 1:1 membership model

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id   UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'owner';
```

This is the critical structural constraint of the existing model:

- **Each user belongs to at most one organization** — `org_id` is a single nullable UUID column on the `users` row. There is no join table. A user cannot be a member of multiple organizations.
- **The org role is stored on the users row** — `org_role` is a `TEXT` column defaulting to `'owner'`. The comment documents only two values: `'owner' | 'member'`. There are no `admin` or `viewer` roles in the existing schema.
- **The default of `'owner'`** means that every user who has never joined an org has `org_role = 'owner'`. This is a design choice to avoid null-handling — users not in an org are nominally "owners" of nothing. This creates ambiguity: a `SELECT org_role FROM users` for a user with `org_id IS NULL` returns `'owner'`, which is misleading.

The `ON DELETE SET NULL` on `users.org_id` means that if an organization is deleted, all member users' `org_id` becomes `NULL` (but `org_role` retains its previous value — there is no trigger to reset it).

### 2.3 org_invites — email-based invitation table

```sql
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
```

The invite system is email-token-based: an owner creates an invite row with the invitee's email and a random hex token. If the invitee already has an account with that email and no org, the invite is auto-accepted (see §4.3 below). If not, an email is sent with a sign-up link. Invites expire after 7 days.

### 2.4 Indexes

Five indexes support the existing model:

- `idx_users_org_id` — on `users(org_id)` for membership lookups
- `idx_organizations_owner` — on `organizations(owner_id)` for owner-based queries
- `idx_org_invites_org` — on `org_invites(org_id)`
- `idx_org_invites_email` — on `org_invites(invited_email)`
- `idx_org_invites_token` — on `org_invites(token)`

---

## 3. Authentication and Session Model

### 3.1 SessionUser interface

**File:** `lib/auth.ts` (lines 172–178)

```typescript
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  company?: string;
  // role intentionally omitted — always read from DB
}
```

The JWT contains **only identity fields** — `id`, `name`, `email`, and `company`. The comment explicitly states that role is never stored in the JWT and is always fetched from the database. There is **no organization context** in the JWT payload: no `org_id`, no `org_role`, no active organization identifier.

### 3.2 signToken

```typescript
export function signToken(user: SessionUser): string {
  const payload: SessionUser = {
    id:      user.id,
    name:    user.name,
    email:   user.email,
    company: user.company,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}
```

The token is signed with a 30-day expiry. Only the four identity fields are included. This means that organization membership and role are **never available from the JWT alone** — every API route that needs org context must query the database for `users.org_id` and `users.org_role`.

### 3.3 getUserFromRequest

```typescript
export function getUserFromRequest(req: Request): SessionUser | null {
  // ... dev-auth bypass check ...
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifyToken(match[1]);
}
```

This returns a `SessionUser` with only identity fields. Every API route that needs org context does its own ad-hoc DB query for `org_id` and `org_role` (see §4 below). There is no centralized function that returns "the current user with their organization context."

### 3.4 Platform admin role model (separate from org role)

**File:** `lib/adminAuth.ts`

```typescript
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'super_admin';
};
```

The platform admin role (`users.role` column, values `'user' | 'admin' | 'super_admin'`) is **entirely separate** from the organization role (`users.org_role`). The `requireAdmin()` function checks `users.role` from the database and gates access to the `/admin` section. This is a platform-level authority concept, not an organization-level one.

**Implication for Phase 1B:** The authorization foundation must keep platform roles and organization roles as separate axes. A platform `admin` is not automatically an organization `admin`. The existing separation is correct and should be preserved.

---

## 4. Existing API Routes

### 4.1 GET / POST / DELETE /api/organizations

**File:** `app/api/organizations/route.ts`

**GET** — Returns the current user's organization (or null). The query joins `organizations` to `users` on `org_id`, aggregates members via a subquery (`SELECT json_agg(...) FROM users m WHERE m.org_id = o.id`), and aggregates pending invites. The member list includes `id, name, email, org_role` for each member.

**POST** — Creates a new organization. Guards: user must not already be in an org (`SELECT org_id FROM users WHERE id = ${user.id}` — if non-null, returns 409). Creates the org with `owner_id = ${user.id}`, then updates the user's `org_id` and sets `org_role = 'owner'`.

**DELETE** — Deletes the organization. Guards: user must be in an org, and `org_role` must be `'owner'`. First unlinks all members (`UPDATE users SET org_id = NULL, org_role = 'owner' WHERE org_id = ${orgId}`), then deletes the org row (cascades to `org_invites`).

### 4.2 DELETE /api/organizations/member

**File:** `app/api/organizations/member/route.ts`

Removes a member from the org. Authorization logic:

- If `memberId !== user.id` and caller's `org_role !== 'owner'` → 403 "Only the owner can remove other members"
- If `memberId === user.id` and caller's `org_role === 'owner'` → 400 "Owner cannot leave — delete the org or transfer ownership first"
- Members can remove themselves (self-leave)

After removal, calls `syncSeatsForOrg(orgId)` to adjust billing.

### 4.3 POST / DELETE /api/organizations/invite

**File:** `app/api/organizations/invite/route.ts`

**POST** — Sends an invite. Guards: caller must be org owner. Checks if the email is already a member (409) or has a pending invite (409). Creates the invite row. If the invitee already has an account with that email and `org_id IS NULL`, auto-accepts: sets `org_id` and `org_role = 'member'`, marks invite `accepted_at = now()`, syncs seats, sends a notification email. Otherwise, sends a sign-up invite email.

**DELETE** — Revokes a pending invite. Guards: caller must be org owner. Deletes the invite row scoped to the caller's `org_id`.

### 4.4 Authorization pattern summary

Every existing org route follows the same ad-hoc authorization pattern:

1. Get the user from JWT (`getUserFromRequest`)
2. Query `SELECT org_id, org_role FROM users WHERE id = ${user.id}`
3. Check `org_role === 'owner'` inline
4. Perform the operation

There is **no centralized authorization function**. Each route duplicates the ownership check. There is no concept of `admin` or `viewer` roles — only `owner` can perform privileged actions, and `member` can self-leave. There is no permission model beyond the binary owner/member distinction.

---

## 5. Registration and Onboarding

### 5.1 Registration auto-accept

**File:** `app/api/auth/register/route.ts`

During registration, after the user is created, the route checks for a pending invite matching the new user's email:

```typescript
const inv = await sql`
  SELECT id, org_id FROM org_invites
  WHERE invited_email = ${email.toLowerCase().trim()}
    AND accepted_at IS NULL AND expires_at > now()
  ORDER BY expires_at DESC LIMIT 1
`;
if (inv[0]?.org_id) {
  await sql`UPDATE users SET org_id = ${inv[0].org_id}, org_role = 'member', updated_at = NOW() WHERE id = ${userId}`;
  await sql`UPDATE org_invites SET accepted_at = now() WHERE id = ${inv[0].id}`;
  const { syncSeatsForOrg } = await import('@/lib/stripe');
  await syncSeatsForOrg(inv[0].org_id as string);
}
```

This is wrapped in a try/catch with a non-fatal warning — registration must never break if the invite system has an issue. The new user is always assigned `org_role = 'member'`.

**Implication:** A user can only auto-join one organization (the most recent valid invite by expiry). The 1:1 model is enforced at registration.

---

## 6. Billing Integration

### 6.1 syncSeatsForOrg

**File:** `lib/stripe.ts` (line 405)

```typescript
export async function syncSeatsForOrg(orgId: string) {
  // ... fetches org + owner ...
  const cntRows = await sql`SELECT COUNT(*)::int AS n FROM users WHERE org_id = ${orgId}`;
  // ... adjusts Stripe subscription quantity ...
}
```

Seat counting is based on `SELECT COUNT(*) FROM users WHERE org_id = ${orgId}`. This is a direct count of users with that `org_id` — it will need to be reconciled with the new `organization_members` table during Phase 1B's compatibility layer. The function is described as a "no-op if seat billing not set up."

---

## 7. Project Ownership Model

### 7.1 projects.user_id — per-user ownership

**File:** `lib/migrations/001_initial_schema.sql` (line 44)

```sql
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  ...
);
```

Projects are owned by a single `user_id` — there is no `org_id` column on `projects`. The `getProjectsByUser(user.id)` function in `lib/db-neon.ts` fetches projects for a specific user only. There is **no org-scoped project visibility** — members of an organization cannot see each other's projects through the existing API.

**Implication for Phase 1B:** The authorization spec does not authorize project ownership backfill or org-scoped project queries in this phase. The legacy `projects.user_id` model remains authoritative. The new authorization foundation must be designed to eventually support org-scoped access, but Phase 1B does not implement project reassignment.

---

## 8. Audit Logging

### 8.1 lib/auditLog.ts

**File:** `lib/auditLog.ts`

The audit logging system is a centralized, hash-chained, tamper-evident log. It defines:

- **Categories:** `'auth' | 'access' | 'data' | 'config' | 'security' | 'admin' | 'billing' | 'compliance' | 'migration'`
- **Actions** for access control: `role_change`, `permission_grant`, `permission_revoke`
- **Storage:** PostgreSQL `audit_log` table (hash-chained for tamper evidence)

The `admin_activity_log` table (migration 008) is a separate, simpler admin-action log with `admin_id`, `action`, `target_user_id`, `target_company`, and `metadata` (JSONB).

**Implication for Phase 1B:** Organization-aware audit context should be added to the existing audit system. The authorization spec requires "organization-aware audit context" — membership changes, role changes, and active-org switches should be logged with the organization identifier. The existing `AuditCategory` and `AuditAction` types may need extension for org-specific events.

---

## 9. Permission System

### 9.1 lib/permissions.ts

**File:** `lib/permissions.ts`

The existing permission system is **plan-based**, not org-based. The `hasPlatformAccess()` function checks:

1. `super_admin` or `admin` role → always allowed (bypasses subscription)
2. `is_free_pass` boolean → always allowed
3. `subscription_status = 'active'` → allowed
4. `subscription_status = 'trialing'` → allowed if trial not expired
5. Otherwise → denied

The `canAccess(plan, feature)` function gates specific features (`engineering`, `permitPackets`, `structuralCalcs`, etc.) based on the user's subscription plan. There is a `multiCompany` feature key (required plan: Enterprise), but it is not currently enforced.

**Implication for Phase 1B:** The new organization authorization layer is a **separate axis** from plan-based access. A user may have platform access (active subscription) but still be denied an organization-level action (e.g., not an org admin). The authorization foundation should default to deny and layer org permissions on top of existing plan permissions.

---

## 10. UI Components

### 10.1 OrganizationPanel

**File:** `components/settings/OrganizationPanel.tsx`

A client component rendered in the settings page (`app/settings/page.tsx`) under the "organization" tab. It provides:

- **No-org state:** A "Create Organization" button with a company-name input
- **Org header:** Shows org name, seat count, plan badge, and an "Owner" badge if `org_role === 'owner'`
- **Members list:** Shows each member's avatar, name, email, and role badge (`owner` or `member`). Owner sees a "remove member" button for non-self members.
- **Invite form:** Email input + "Invite" button (owner only)
- **Pending invites list:** Shows pending invite emails with revoke buttons (owner only)
- **Delete org:** Confirmation modal (owner only)

The component calls the existing `/api/organizations`, `/api/organizations/invite`, and `/api/organizations/member` endpoints. It uses `org.org_role` to gate UI elements (owner-only controls).

### 10.2 Settings page integration

**File:** `app/settings/page.tsx`

The settings page imports `OrganizationPanel` and renders it under the `'organization'` tab. The page also renders `CrewMembersPanel` under the `'teams'` tab and `SecurityPanel` under `'security'`. The user object comes from `UserContext` (`useUser()`).

---

## 11. Existing Tests

**Finding:** There are **no existing organization-related tests**. A search for test files matching `*org*` in the `tests/` directory returned zero results. The existing org routes have no unit or integration test coverage.

This means Phase 1B tests will be entirely new — there is no existing test baseline to preserve or update for organization functionality.

---

## 12. Gap Analysis — What Phase 1B Must Add

Based on the audit, the following gaps exist between the current state and the Phase 1B authorization model:

### 12.1 Schema gaps

| Gap | Current | Required |
|-----|---------|----------|
| Membership model | 1:1 (`users.org_id` single column) | Many-to-many (`organization_members` join table) |
| Organization roles | `owner`, `member` only | `owner`, `admin`, `member`, `viewer` |
| Role storage | `users.org_role` (TEXT) | `organization_members.role` (per-membership) |
| Active org context | None (implicit from `users.org_id`) | Server-authoritative, explicit |
| Org status fields | None | Needed for suspension lifecycle |
| Owner protection | Ad-hoc in routes (owner can't self-remove) | Centralized, last-owner guard |

### 12.2 Authorization gaps

| Gap | Current | Required |
|-----|---------|----------|
| Centralized authz | None (each route checks inline) | Centralized authorization interface |
| Default posture | Ad-hoc (owner/member binary) | Default-deny |
| Permission model | Binary owner/member | Org-role-based permissions |
| Platform vs org roles | Separate (correct) | Must remain separate, explicitly |

### 12.3 Context gaps

| Gap | Current | Required |
|-----|---------|----------|
| Active org in session | Not in JWT, implicit from users.org_id | Server-authoritative active org context |
| Org context in API | Each route queries users.org_id | Centralized context resolution |

### 12.4 Audit gaps

| Gap | Current | Required |
|-----|---------|----------|
| Org-aware audit | No org_id in audit events | Organization context in audit events |

### 12.5 Compatibility requirements

The legacy `users.org_id` and `users.org_role` columns must remain as a compatibility pointer (not authoritative) during Phase 1B. Existing routes that read `users.org_id` must continue to function. The new `organization_members` table becomes the authoritative membership source, with `users.org_id` derived/synced as a backward-compatible pointer.

---

## 13. Files Inspected

The following files were read in full or in relevant part during this audit:

| File | Purpose |
|------|---------|
| `lib/migrations/016_organizations.sql` | Organizations table, users.org_id/org_role, org_invites |
| `lib/migrations/006_users_subscriptions_whitelabel.sql` | Users table base schema, subscription columns |
| `lib/migrations/001_initial_schema.sql` | Projects table, user_id ownership model |
| `lib/migrations/008_admin_activity_log.sql` | Admin activity log and impersonation tokens |
| `lib/auth.ts` | SessionUser, signToken, getUserFromRequest, JWT model |
| `lib/adminAuth.ts` | Platform admin role model (admin/super_admin) |
| `lib/permissions.ts` | Plan-based feature gating, hasPlatformAccess |
| `lib/stripe.ts` | syncSeatsForOrg seat counting |
| `lib/auditLog.ts` | Hash-chained audit logging, categories, actions |
| `app/api/organizations/route.ts` | GET/POST/DELETE org endpoints |
| `app/api/organizations/member/route.ts` | DELETE member endpoint |
| `app/api/organizations/invite/route.ts` | POST/DELETE invite endpoints |
| `app/api/auth/register/route.ts` | Registration auto-accept org invites |
| `app/api/projects/route.ts` | Project listing (getProjectsByUser) |
| `app/settings/page.tsx` | Settings page with OrganizationPanel tab |
| `components/settings/OrganizationPanel.tsx` | Existing org management UI |
| `contexts/UserContext.tsx` | AppUser interface, global user state |
| `lib/migrations/manifest.ts` | Migration file discovery |
| `lib/migrations/runner.ts` | Canonical migration runner |
| `lib/migrations/types.ts` | Migration types, MIGRATION_LOCK_KEY |

---

## 14. Migration Sequence Verification

- **Total migration files:** 101 (in `lib/migrations/`)
- **Highest prefix:** 104 (`104_seed_manufacturer_assets.sql`)
- **Gaps:** 009, 012, 013, 014 (reserved, not errors)
- **Duplicate prefix:** 074 (disambiguated as 074a/074b)
- **Next valid migration prefix:** **105**
- **No migration files exist after prefix 104** — verified by directory listing
- **No organization-authority implementation code exists** — no `lib/organizations/` directory, no `phase1b` files, no `organization_members` references anywhere in the codebase

The `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` placeholder resolves to **105**.

---

## 15. Conclusion

The existing organization implementation is a minimal 1:1 model with two roles (owner/member), ad-hoc per-route authorization, no centralized context, no many-to-many memberships, no org-scoped project access, and no test coverage. Phase 1B will build the organization authority foundation on top of this — adding the `organization_members` join table, expanding roles to owner/admin/member/viewer, creating centralized authorization interfaces, establishing server-authoritative active org context, and maintaining backward compatibility with the legacy `users.org_id` pointer.

All changes will be feature-flagged (default off), tested locally against isolated non-production PostgreSQL, and executed through the canonical migration runner. Production remains untouched.
