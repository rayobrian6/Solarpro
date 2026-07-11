# Enterprise Multi-Tenant Authority — Architecture Decision Records

**Document Type:** Architecture Decision Records (ADR-001 through ADR-014)
**Phase:** 0.5 — Architecture Decision Gate (Read-Only)
**Date:** 2026-07-11
**Date Classification:** Document creation date (2026-07-11). Per-ADR dates (2026-07-11) are architecture decision dates. Evidence baseline commit `7b344aa1` is dated 2026-07-11 (commit date). Phase 0 predecessor commit `39a1f718` is dated 2026-07-11 (commit date). This reconciliation commit is dated 2026-07-11 (document correction date). The previous incorrect value of 2025-07-11 has been corrected — no Phase 0.5 work occurred in 2025.
**Branch:** `dev` @ `ef51acff`
**Branch Reference Classification:** `ef51acff` is the Phase 0.5 documentation commit (this document and its companion Phase 0.5 deliverables). The codebase evidence baseline is `7b344aa1` (a code commit, not a documentation commit) — referenced where source evidence is cited.
**Status:** Complete — All 14 ADRs documented (architecture analysis COMPLETE; documentation integrity reconciliation IN PROGRESS; stakeholder approval PENDING)
**Predecessor:** Phase 0 Audit & Architecture Design (commit `39a1f718`)

---

> **Placeholder Definition — NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** Throughout this document, `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` is a placeholder for the next verified available migration identifier. It CANNOT be assigned a numeric value at this time because the migration directory (`lib/migrations/`) has a duplicate prefix (074 appears twice) and gaps in the numbering sequence (009, 012, 013, 014 missing). The highest existing migration prefix is 104. The numeric identifier must be determined by a migration sequence reconciliation process before any migration file is created. This placeholder refers to the first resource ownership schema migration (adding org-level columns to existing resource tables such as `projects.organization_id`), which is PROHIBITED until all 15 Phase 1 entry gates pass and Raymond approves. See `ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md` for the full migration directory state analysis.

---

## ADR-001: Membership Cardinality — Many-to-Many Organization Memberships

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro currently supports a strictly one-organization-per-user model. Migration 016 (`lib/migrations/016_organizations.sql`) adds a single `org_id` column to the `users` table (`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID`), which means each user can belong to at most one organization. The POST handler in `app/api/organizations/route.ts` enforces this by returning HTTP 409 ("You are already part of an organization") when a user who already has an `org_id` attempts to create or join another org. The org member removal route (`app/api/organizations/member/route.ts`) simply sets `org_id = NULL` on the departing user's row.

This single-membership model creates a hard ceiling on enterprise use cases: a contractor who consults for multiple solar companies, a freelancer who serves multiple clients, or a parent company employee who needs access to a subsidiary's workspace cannot exist in the system without creating separate user accounts for each organization. This drives account proliferation, password reuse, and orphaned data.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/016_organizations.sql` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id)` — single-valued column |
| `app/api/organizations/route.ts` (POST) | `if (existing[0]?.org_id) { return ... status: 409 }` — blocks multi-org |
| `app/api/organizations/route.ts` (GET) | `WHERE u.org_id = o.id LIMIT 1` — returns at most one org |
| `app/api/organizations/member/route.ts` (DELETE) | `UPDATE users SET org_id = NULL, org_role = 'owner' WHERE id = ${memberId}` — membership removal by nulling single column |
| `lib/db/projects.ts` (`getProjectsByUser`) | `WHERE p.user_id = ${userId}` — projects are user-scoped, not org-scoped |
| Phase 0 Finding F-10 | "User Can Belong to Only One Org" |
| Phase 0 Finding F-11 | "Only Two Org Roles (owner, member)" |

### Options Considered

**Option A: One Org Per User (Status Quo)**
- Keep `users.org_id` as the sole membership mechanism.
- Pro: No schema change, no migration risk.
- Con: Account proliferation for multi-org users; violates P1 (organizations own data, users act on behalf); blocks enterprise use cases; forces shared credentials.

**Option B: Many-to-Many via Junction Table**
- Create `organization_members(org_id, user_id, role_id, status, joined_at, removed_at, removed_by)` junction table.
- Keep `users.org_id` for backward compatibility but eventually deprecate it.
- Pro: Natural fit for enterprise; supports active org context; enables audit trail for membership lifecycle; aligns with P1, P2, P4.
- Con: Requires migration; introduces active-org-selection UX; slightly more complex queries.

**Option C: Separate Identities Per Org**
- Each user account is scoped to one org; multi-org users create separate accounts.
- Pro: Zero overlap risk; simple isolation.
- Con: Forces account proliferation; password reuse risk; no unified identity; poor UX; does not address enterprise needs.

### Decision

**RECOMMENDED: Option B — Many-to-many organization memberships via `organization_members` junction table.**

The junction table will have the following structure:

```sql
organization_members:
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  role_id         UUID NOT NULL REFERENCES org_roles(id)
  status          TEXT NOT NULL DEFAULT 'active'  -- active|invited|suspended|removed
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  removed_at      TIMESTAMPTZ
  removed_by      UUID REFERENCES users(id) ON DELETE SET NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE(org_id, user_id)
```

### Rationale

The many-to-many model is the only option that aligns with all seven governing principles. P1 states that organizations own business data and users act on behalf of organizations — this presupposes that a user can act on behalf of multiple organizations. P2 (collaboration does not change ownership) requires a membership concept separate from collaboration, which a junction table provides. P4 (permission-first authorization) requires role-permission bindings per membership, which the `role_id` FK enables.

The existing `users.org_id` column will be retained during migration as a backward-compatible "default org" pointer but the junction table becomes the authoritative source. All new code queries `organization_members` for membership resolution.

### Security Impact

- **Architecturally addresses:** F-10 (one-org limit), T-18 (member removal leaves resources accessible — junction table tracks `removed_at`/`removed_by`), T-12 (member removal has no audit trail — `removed_by` and `removed_at` provide the audit trail).
- **Introduces:** Need for active-org validation on every request (addressed by D-02); need for membership status enforcement (suspended members must be denied).
- **Residual risk:** Race condition between membership removal and in-flight requests — addressed by D-02's per-request server-side validation.

### Data Model Impact

- New table: `organization_members` (junction).
- New table: `org_roles` (role definitions, see D-04).
- New table: `org_role_permissions` (role-permission mappings, see D-04).
- `users.org_id` retained as nullable backward-compat pointer; eventually deprecated.
- `users.org_role` retained as nullable; eventually deprecated.
- All resource queries change from `WHERE user_id = ?` to `WHERE owner_organization_id = ?` (see D-05).

### API Impact

- New endpoints: `GET /api/orgs` (list user's orgs), `POST /api/orgs/{id}/members`, `DELETE /api/orgs/{id}/members/{userId}`, `PATCH /api/orgs/{id}/members/{userId}` (change role/status).
- Modified: `POST /api/organizations` no longer returns 409 for existing members — instead creates a second membership.
- Modified: `GET /api/organizations` returns array instead of single object.

### Worker Impact

- Worker job claims must verify the job's `owner_organization_id` against the membership of the user who queued it (see D-07 worker section).
- No standing tenant context in worker — each job carries its org context in the job row.

### Storage Impact

- No direct impact; storage isolation is addressed by D-07.

### Billing Impact

- Seat billing (`syncSeatsForOrg`) changes from counting `users WHERE org_id = ?` to counting `organization_members WHERE org_id = ? AND status = 'active'` (see D-08).

### Migration Impact

- NEXT_ENTERPRISE_AUTHORITY_MIGRATION (PROHIBITED until entry gates met) will create `organization_members`, `org_roles`, `org_role_permissions`.
- Backfill: for each user with non-null `org_id`, insert a row into `organization_members` with the same org, role mapped from `org_role`, and `status = 'active'`.
- `users.org_id` and `users.org_role` remain for backward compatibility during Phase 1 dual-read period.

### Testing Requirements

- Unit: junction table insert/unique constraint; role_id FK enforcement; status transitions.
- Integration: user with 3 memberships can switch active org and see only that org's data.
- Adversarial: user removed from org A cannot access org A data even with valid JWT; suspended member cannot act.
- Adversarial: duplicate membership insert rejected by UNIQUE constraint.

### Rejected Alternatives

- Option A (status quo) rejected: violates P1, blocks enterprise use cases.
- Option C (separate identities) rejected: account proliferation, password reuse, poor UX.

### Deferred Work

- Custom role creation UI (see D-04 deferred component).
- Membership invitation with role selection (invite flow extended in D-04).

### Rollback Considerations

- If rolled back, `users.org_id` remains as the sole membership mechanism. The `organization_members` table can be dropped without data loss since `users.org_id` is maintained in parallel during Phase 1.

### Raymond Approval Required

No — evidence is sufficient. The default recommendation (many-to-many memberships) aligns with P1, P2, P4 and is supported by the codebase evidence.

---

## ADR-002: Active Organization Context — Server-Side Resolution with Per-Request Validation

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro's JWT (`lib/auth.ts`, `signToken()` function) signs only identity fields: `{id, name, email, company}`. The code comments explicitly state "Role is NEVER stored in the JWT. Always fetch from DB." There is no `org_id`, no `active_org_id`, and no tenant context of any kind in the token. The `verifyToken()` and `verifyTokenWithMeta()` functions extract only `{id, name, email, company}` and discard everything else. The middleware (`middleware.ts`) decodes the JWT payload without verification (for expiry check only) and does not check role — it passes all authenticated requests through.

This means the system has no concept of "which organization is this user currently acting on behalf of." Every data query is scoped by `user.id` directly (e.g., `getProjectsByUser(user.id)` → `WHERE p.user_id = ${userId}`). Phase 0 Finding F-01 identifies this as "JWT Carries No Tenant Context" and Finding F-20 identifies "No Active Company Context." Threat T-04 rates this as HIGH severity: "JWT has no tenant context — token replay across tenants."

With many-to-many memberships (D-01), the system must know which org the user is currently acting on behalf of. The question is how to carry and validate this context.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/auth.ts` (`signToken`) | `const payload: SessionUser = { id, name, email, company }` — only identity, no org |
| `lib/auth.ts` (comment) | "JWT contains ONLY identity — id, name, email, company. Role is NEVER stored in the JWT. Always fetch from DB." |
| `lib/auth.ts` (`verifyTokenWithMeta`) | Extracts `{id, name, email, company}` and `iat`; explicitly discards role fields from old JWTs |
| `middleware.ts` (`decodeJwtPayload`) | Extracts `{id, email, exp, iat}` — no org, no role |
| `lib/db/projects.ts` (`getProjectsByUser`) | `WHERE p.user_id = ${userId}` — user-scoped, no org context |
| Phase 0 Finding F-01 | "JWT Carries No Tenant Context" |
| Phase 0 Finding F-20 | "No Active Company Context" |
| Phase 0 Threat T-04 | "JWT has no tenant context — token replay across tenants" (HIGH) |
| Phase 0 Threat T-17 | "No active company context — no server-side tenant resolution" (HIGH) |

### Options Considered

**Option A: Active Org in JWT**
- Add `active_org_id` to the JWT payload; refresh token on org switch.
- Pro: No extra DB query per request; org context available in middleware.
- Con: Stale token problem — if user is removed from an org, their JWT still carries `active_org_id` until it expires (30 days); violates P3 (default deny) if the JWT is trusted without server-side validation; requires token refresh infrastructure.

**Option B: Server-Side Resolution from Persisted Preference**
- Store active org in a `user_active_org` table (user_id, org_id, set_at); resolve on every request by querying the membership.
- Pro: Always fresh; no stale token; membership validation is implicit; aligns with P3 (server is authoritative).
- Con: One extra DB query per request (addressed by connection pooling and caching).

**Option C: Signed Token (Separate from JWT)**
- Issue a short-lived signed token carrying `active_org_id`; store in a separate cookie.
- Pro: Shorter TTL reduces staleness; separate from identity token.
- Con: Two cookies to manage; still requires server-side validation; adds complexity without clear benefit over Option B.

**Option D: Client-Supplied Header**
- Client sends `X-Active-Org: {org_id}` header on every request.
- Pro: Simplest; no server state.
- Con: Violates P3 (default deny — no route trusts client-supplied org IDs); trivially spoofable; user could send any org_id.

### Decision

**RECOMMENDED: Option B — Server-side resolution from persisted `user_active_org` table with per-request membership validation.**

The active org is stored in a `user_active_org` table and resolved server-side on every request. The resolution function (`resolveActiveOrg(userId)`) queries the user's active org preference and validates it against `organization_members` (active membership). If the user is not an active member of the stored active org, the system falls back to the user's default org (the first active membership) or returns null if no active memberships exist.

### Rationale

P3 (Default Deny) is the deciding principle: no route may trust a client-supplied org ID. Option D is rejected outright because it violates P3. Option A (JWT) is rejected because the 30-day JWT TTL creates a stale-token window where a removed user retains access — this is exactly Threat T-04. Option C adds complexity without solving the staleness problem better than Option B.

Option B aligns with the existing security architecture: SolarPro already fetches the user's role from the DB on every request (the JWT explicitly does not carry role). Adding org resolution to the same DB query is consistent with this pattern. The extra DB query is a single indexed lookup on `user_active_org.user_id` — negligible cost on Neon serverless.

### Security Impact

- **Architecturally addresses:** T-04 (token replay across tenants — org is validated server-side, not from token), T-17 (no active company context — server resolves it), F-01 (JWT has no tenant context — org is resolved server-side), F-20 (no active company context — `user_active_org` provides it).
- **Introduces:** Need to handle "no active org" state gracefully (user with no memberships). Addressed by redirecting to org selection page.
- **Residual risk:** TOCTOU between membership check and data access — addressed by D-03's RLS defense-in-depth on critical tables.

### Data Model Impact

- New table: `user_active_org(user_id UUID PRIMARY KEY REFERENCES users(id), org_id UUID NOT NULL REFERENCES organizations(id), set_at TIMESTAMPTZ)`.
- The `resolveActiveOrg()` function is a DB query, not a JWT field.

### API Impact

- New endpoint: `POST /api/auth/switch-org` — sets active org, updates `user_active_org`, returns success.
- Modified: `getUserFromRequest()` is extended to also return `activeOrgId` (fetched from DB, not from JWT).
- All resource routes receive `activeOrgId` from the request context and use it in `WHERE owner_organization_id = ?` clauses.

### Worker Impact

- Worker does not use active org context — it processes jobs that carry their own `owner_organization_id` in the job row.

### Storage Impact

- No direct impact.

### Billing Impact

- Billing operations use the org from the request context (resolved server-side), not from the JWT or client header.

### Migration Impact

- NEXT_ENTERPRISE_AUTHORITY_MIGRATION creates `user_active_org` table.
- Backfill: for each user with non-null `org_id`, insert into `user_active_org` with the same org_id.
- No change to JWT signing — the JWT remains identity-only.

### Testing Requirements

- Unit: `resolveActiveOrg()` returns correct org for user with one membership; returns default for user with multiple memberships and no preference; returns null for user with no active memberships.
- Integration: switching active org changes visible data set; org switch persists across sessions.
- Adversarial: user removed from org A has `user_active_org` pointing to org A — `resolveActiveOrg()` must fall back or return null, NOT return org A.
- Adversarial: client sends `X-Active-Org` header — must be ignored (P3).

### Rejected Alternatives

- Option A (JWT) rejected: stale-token window with 30-day TTL; violates P3 if trusted without validation.
- Option C (signed token) rejected: unnecessary complexity; doesn't solve staleness better than B.
- Option D (header) rejected: violates P3 (default deny).

### Deferred Work

- Caching `resolveActiveOrg()` result in request scope (already a single query, caching is optional optimization).

### Rollback Considerations

- If rolled back, remove `user_active_org` table and revert `getUserFromRequest()` to identity-only. Data queries revert to `WHERE user_id = ?`.

### Raymond Approval Required

No — evidence is sufficient. The existing pattern of server-side role resolution (JWT carries identity only, role fetched from DB) makes server-side org resolution the natural and consistent choice.

---

## ADR-003: Database Isolation Strategy — Hybrid Application Authorization + Selective Row-Level Security

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro uses Neon PostgreSQL via the `@neondatabase/serverless` HTTP driver. There is a single `DATABASE_URL` environment variable and no per-tenant database roles. A search across all 101 migration files in `lib/migrations/` found ZERO Row Level Security (RLS) policies — the string "ROW LEVEL SECURITY" and "CREATE POLICY" do not appear in any migration (confirmed via `grep -rci "ROW LEVEL SECURITY\|CREATE POLICY" lib/migrations/`). All tenant isolation is done at the application level through `WHERE user_id = ?` clauses in SQL queries.

Phase 0 Finding F-04 ("Zero RLS Policies") and F-05 ("Single DATABASE_URL, No Per-Tenant Roles") document this. Threat T-03 rates the absence of RLS as CRITICAL: "No RLS — SQL injection or missed filter = full data exposure." The risk is that if any single route forgets to add the `WHERE user_id = ?` filter (or if a SQL injection bypasses it), the attacker gains access to all tenants' data with no database-level backstop.

The Neon serverless HTTP driver creates a complication for RLS: traditional RLS relies on session-level settings (`SET LOCAL app.current_tenant = ?`) set within a transaction. The Neon HTTP driver does not maintain persistent connections — each query is an independent HTTP request. However, Neon does support transaction-wrapped queries via the `transaction()` method, which allows `SET LOCAL` within a transaction boundary.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/` (all 101 files) | `grep -rci "ROW LEVEL SECURITY\|CREATE POLICY"` returns 0 matches — zero RLS policies |
| `lib/auth.ts` (`getDb`) | `neon(url)` — single connection string, HTTP driver |
| `lib/db/projects.ts` (`getProjectsByUser`) | `WHERE p.user_id = ${userId}` — app-level filtering only |
| `lib/db/clients.ts` (`getClientById`) | `WHERE id = ${id} AND user_id = ${userId}` — app-level filtering only |
| `app/api/admin/projects/route.ts` | Global query with no org or user filter — demonstrates the risk of app-only isolation |
| Phase 0 Finding F-04 | "Zero RLS Policies" |
| Phase 0 Finding F-05 | "Single DATABASE_URL, No Per-Tenant Roles" |
| Phase 0 Threat T-03 | "No RLS — SQL injection or missed filter = full data exposure" (CRITICAL) |

### Options Considered

**Option A: Application-Only (Status Quo)**
- Continue with `WHERE user_id = ?` in every query; no RLS.
- Pro: No DB-level complexity; works with Neon HTTP driver without transaction wrapping.
- Con: Single missed filter = full data exposure (T-03); no defense-in-depth; admin routes already demonstrate the risk (global queries).

**Option B: Full RLS**
- Enable RLS on all tenant tables; use `SET LOCAL app.current_org = ?` within transactions.
- Pro: Database enforces isolation even if app misses a filter; defense-in-depth.
- Con: Requires transaction-wrapping every query (Neon HTTP driver `transaction()` method); significant refactor of 280+ routes; performance overhead; complex testing; cannot use RLS for admin routes that need cross-tenant access.

**Option C: Hybrid — App Authorization Primary + Selective RLS Defense-in-Depth**
- App-level `WHERE owner_organization_id = ?` remains the primary enforcement mechanism on all routes.
- RLS is enabled on the highest-sensitivity tables (clients, projects, proposals, productions, audit_log) as defense-in-depth.
- RLS policies use `current_setting('app.current_org', true)` which is set within a transaction wrapper.
- Routes that need cross-tenant access (admin, support) use a `BYPASSRLS` database role.
- Pro: Defense-in-depth without refactoring every route; RLS catches missed filters on critical tables; admin routes use a separate role.
- Con: Two isolation mechanisms to maintain; RLS only on selected tables means non-critical tables still rely on app filtering.

**Option D: Separate Database Per Tenant**
- Each org gets its own Neon database branch.
- Pro: Physical isolation; no cross-tenant data risk.
- Con: Neon branching is not designed for this scale; connection management complexity; no shared schema; migration becomes per-database; billing and admin become cross-database; impractical for 280+ routes.

### Decision

**RECOMMENDED: Option C — Hybrid: application-level authorization as primary enforcement; selective RLS as defense-in-depth on highest-sensitivity tables via transaction-wrapped `SET LOCAL`.**

### Rationale

P7 (Hybrid Isolation) explicitly calls for "central app authz + tenant-scoped data helpers + selective RLS + tenant-safe storage/worker." Option C is the direct implementation of P7.

Option A is rejected because it leaves T-03 (CRITICAL) unmitigated — a single missed filter exposes all data, and the admin projects route already demonstrates this risk with its global query. Option B is rejected because wrapping all 280+ routes in transactions is a massive refactor with performance and complexity costs that outweigh the marginal security benefit over Option C. Option D is rejected as impractical with Neon's architecture and the current route count.

The selective RLS approach targets the tables where a missed filter has the highest impact: `clients` (PII), `projects` (business data), `proposals` (financial data), `productions` (engineering data), and `audit_log` (compliance data). These tables get RLS policies that enforce `owner_organization_id = current_setting('app.current_org')`. All other tables rely on app-level filtering, which is sufficient because they are child tables with FK cascades from the protected parent tables.

### Security Impact

- **Architecturally addresses:** T-03 (no RLS — selective RLS provides defense-in-depth on critical tables), F-04 (zero RLS — RLS is introduced on critical tables).
- **Introduces:** Need for transaction-wrapping on critical-table queries; need for a `BYPASSRLS` database role for admin/support routes; potential for RLS policy misconfiguration.
- **Residual risk:** Non-critical tables without RLS still rely on app filtering — addressed by FK cascades and the centralized authorization guard (D-14).

### Data Model Impact

- RLS enabled on: `clients`, `projects`, `proposals`, `productions`, `audit_log` (after `owner_organization_id` columns are added).
- RLS policy: `USING (owner_organization_id = current_setting('app.current_org', true)::uuid OR current_setting('app.bypass_rls', true) = 'true')`.
- New database role: `solarpro_bypass` with `BYPASSRLS` attribute for admin/support connections.
- `SET LOCAL app.current_org = ?` set within transaction wrapper on tenant-scoped routes.

### API Impact

- Tenant-scoped routes on critical tables must use the transaction-wrapped query pattern:
  ```typescript
  await sql.transaction([
    sql`SET LOCAL app.current_org = ${activeOrgId}`,
    sql`SELECT * FROM projects WHERE ...`
  ]);
  ```
- Admin/support routes use the `solarpro_bypass` role connection (separate `getDbBypass()` function).

### Worker Impact

- Worker uses the bypass role for job processing (jobs carry their own `owner_organization_id` in the job row; worker validates org membership before processing).

### Storage Impact

- No direct impact; storage isolation is addressed by D-07.

### Billing Impact

- Billing routes use the bypass role for cross-org subscription management.

### Migration Impact

- NEXT_ENTERPRISE_AUTHORITY_MIGRATION: Add `owner_organization_id` columns to critical tables; enable RLS; create policies; create `solarpro_bypass` role.
- Migration is additive — no existing data is lost; RLS policies default to permissive during the dual-read period.

### Testing Requirements

- Unit: RLS policy blocks cross-org SELECT on critical tables; `SET LOCAL app.current_org` correctly scopes queries.
- Integration: app-level filter + RLS both pass for same-org; app-level filter missed but RLS blocks cross-org access (the defense-in-depth test).
- Adversarial: SQL injection that bypasses `WHERE` clause is still blocked by RLS on critical tables.
- Adversarial: bypass role can access cross-tenant data (intended for admin).

### Rejected Alternatives

- Option A (app-only) rejected: leaves T-03 CRITICAL unmitigated.
- Option B (full RLS) rejected: impractical refactor for 280+ routes; performance overhead.
- Option D (separate DB) rejected: impractical with Neon and current architecture.

### Deferred Work

- RLS on non-critical tables (deferred to post-Phase-1 after app-level authz is proven).
- Full `BYPASSRLS` role migration for all admin routes (deferred — admin routes initially use app-level role check + RLS bypass role for critical-table queries only).

### Rollback Considerations

- RLS policies can be dropped without data loss. `owner_organization_id` columns remain. App-level filtering continues to work independently of RLS.

### Raymond Approval Required

No — evidence is sufficient. P7 explicitly calls for hybrid isolation, and the selective RLS approach is the practical implementation.

---

## ADR-004: Platform Roles vs Organization Roles — Separate Namespaces

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro has a significant role constraint conflict. Migration 006 (`lib/migrations/006_users_subscriptions_whitelabel.sql`) defines the `users.role` column as `TEXT NOT NULL DEFAULT 'user'` with a comment stating `-- 'user' | 'admin'`. However, the application uses a much wider set of role strings that are NOT in this constraint: `super_admin`, `staff`, `crew_member`, `homeowner`, `sales`. Phase 0 Finding F-17 ("Role Constraint Conflict") documents this: the database says the role should be 'user' or 'admin', but the application uses at least 7 distinct role strings with no CHECK constraint enforcing the documented values.

The middleware (`middleware.ts`) has session timeout configurations for: `super_admin`, `admin`, `staff`, `crew_member`, `homeowner`, and `user` — confirming the application-level role vocabulary. The `MFA_REQUIRED_ROLES` constant in `lib/mfa.ts` is `['admin', 'super_admin', 'staff']`. The `hasPlatformAccess()` function in `lib/permissions.ts` checks for `super_admin` and `admin` as platform-level roles. The lead-desk auth (`lib/leadDeskAuth.ts`) checks for `admin`, `super_admin`, and `sales`.

Separately, the organization model (Migration 016) has `users.org_role` with values `'owner' | 'member'` — only two roles. Phase 0 Finding F-11 ("Only Two Org Roles") documents this limitation.

The collision is that `admin` is used both as a platform-level role (in `users.role`) and would naturally be an org-level role (org admin). These are fundamentally different concepts: a platform admin is SolarPro staff with global access, while an org admin is a company employee with admin rights within their organization.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/006_users_subscriptions_whitelabel.sql` | `role TEXT NOT NULL DEFAULT 'user'` with comment `-- 'user' | 'admin'` |
| `lib/mfa.ts` | `MFA_REQUIRED_ROLES = ['admin', 'super_admin', 'staff']` |
| `lib/permissions.ts` (`hasPlatformAccess`) | Checks `role === 'super_admin'` and `role === 'admin'` as platform roles |
| `lib/leadDeskAuth.ts` | `ALLOWED = new Set(["admin", "super_admin", "sales"])` |
| `middleware.ts` | `SESSION_TIMEOUT_MS` keyed by: `super_admin`, `admin`, `staff`, `crew_member`, `homeowner`, `user` |
| `lib/migrations/016_organizations.sql` | `org_role TEXT NOT NULL DEFAULT 'owner'` — comment: `'owner' | 'member'` |
| Phase 0 Finding F-11 | "Only Two Org Roles (owner, member)" |
| Phase 0 Finding F-17 | "Role Constraint Conflict — undefined roles stored" |
| Phase 0 Threat T-10 | "Role constraint conflict — undefined roles stored" (MEDIUM) |

### Options Considered

**Option A: Unified Role Namespace**
- Use `users.role` for both platform and org roles; context determines which applies.
- Pro: Single column.
- Con: "admin" collision (platform admin vs org admin); violates P5 (platform authority and tenant authority are separate); ambiguous authorization logic.

**Option B: Separate Namespaces — Platform Roles in `users.role`, Org Roles in `org_roles` + `organization_members.role_id`**
- Platform roles: `super_admin`, `staff`, `user` (SolarPro staff / platform-level).
- Org roles: `owner`, `admin`, `member`, `viewer` (organization-scoped, via junction table).
- Pro: Clear separation per P5; no collision; platform admin and org admin are distinct concepts; each membership has its own role.
- Con: Two role systems to maintain; authorization logic must check both.

**Option C: Merge Existing Roles into Org Roles**
- Map `super_admin` → platform staff; `admin` → org owner; `user` → org member.
- Pro: Simple migration.
- Con: Loses the distinction between platform and org authority; violates P5; `admin` users currently have global access, not org-scoped.

### Decision

**RECOMMENDED: Option B — Separate namespaces. Platform roles in `users.role` (super_admin, staff, user); organization roles in `org_roles` + `organization_members.role_id` (owner, admin, member, viewer).**

### Rationale

P5 (Platform Authority and Tenant Authority Are Separate) is the deciding principle. A platform super_admin is a SolarPro employee with cross-tenant access for support and operations. An org admin is a company employee with admin rights within their organization. These are fundamentally different authority domains and must not share a namespace.

The existing `admin` role in `users.role` is actually a platform-level role (it grants global access via `hasPlatformAccess()` and `requireAdminApi()`). The org-level "admin" is a new concept that does not exist today (only `owner` and `member` exist). By separating the namespaces, we avoid the collision entirely.

### Security Impact

- **Architecturally addresses:** T-10 (role constraint conflict — separate namespaces architecturally address the collision; IMPLEMENTATION PENDING in Phase 1 Gate 3), F-17 (role constraint conflict — platform roles and org roles are clearly distinguished), F-11 (only two org roles — four system org roles introduced).
- **Introduces:** Authorization logic must check both platform role and org role (e.g., `isPlatformStaff(user.role) || hasOrgPermission(activeOrgId, user.id, 'projects:write')`).
- **Residual risk:** Complexity of dual-role checks — addressed by centralized authorization guard (D-14).

### Data Model Impact

- `users.role` retained for platform roles; constrained to `super_admin`, `staff`, `user` (CHECK constraint added in migration).
- Existing `admin` role mapped to either `super_admin` or `staff` during migration based on `is_free_pass` flag and business review.
- New table: `org_roles(id, org_id NULL for system roles, name, description, is_system, created_at)`.
- New table: `org_role_permissions(role_id, permission, PRIMARY KEY(role_id, permission))`.
- `organization_members.role_id` FK to `org_roles.id`.
- Four system-defined org roles: owner, admin, member, viewer (org_id = NULL, is_system = true).

### API Impact

- Authorization checks change from `requireAdminApi(req)` (platform role check) to `requireOrgPermission(req, 'projects:write')` (org permission check) for tenant-scoped routes.
- Platform admin routes retain `requireAdminApi()` (platform role check).
- New endpoint: `GET /api/orgs/{id}/roles` (list org roles), `POST /api/orgs/{id}/roles` (create custom role — deferred).

### Worker Impact

- Worker uses the job's `owner_organization_id` and the queuing user's org role to determine permitted operations.

### Storage Impact

- No direct impact.

### Billing Impact

- Billing management (`billing:manage` permission) is an org-level permission, not a platform role. Only org owners have this by default.

### Migration Impact

- NEXT_ENTERPRISE_AUTHORITY_MIGRATION: Create `org_roles`, `org_role_permissions` tables; add CHECK constraint on `users.role`; backfill four system org roles.
- Map existing `users.role = 'admin'` → `super_admin` (if `is_free_pass = true`) or `staff` (if not).
- Map existing `users.org_role = 'owner'` → org_roles 'owner'; `'member'` → org_roles 'member'.

### Testing Requirements

- Unit: `hasOrgPermission()` correctly resolves permissions from role-permission mappings.
- Integration: platform staff can access admin routes; org admin can manage org resources but NOT other orgs' resources; org viewer can read but not write.
- Adversarial: user with org 'admin' role in org A cannot access org B's resources; platform staff without org membership cannot access org-scoped resources via org role (must use platform authority).

### Rejected Alternatives

- Option A (unified namespace) rejected: "admin" collision; violates P5.
- Option C (merge) rejected: loses platform/org distinction; `admin` currently has global access, not org-scoped.

### Deferred Work

- Custom org role creation (four system roles are sufficient for initial release — see D-04 deferred component in Decision Register).
- Migration of `crew_member`, `homeowner`, `sales` roles (these are specialized platform roles that may be reclassified in a future phase).

### Rollback Considerations

- If rolled back, `users.role` remains the sole role mechanism. `org_roles` and `org_role_permissions` tables can be dropped. `organization_members.role_id` can be nullable temporarily.

### Raymond Approval Required

No — evidence is sufficient. P5 mandates separate namespaces, and the codebase evidence confirms the collision exists.

---

## ADR-005: Project Collaboration Model — Owning Org + Explicit Participants + Permission Envelope

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro projects are currently strictly user-scoped. The project data access layer (`lib/db/projects.ts`) enforces ownership through a `WHERE p.user_id = ${userId} AND p.deleted_at IS NULL` clause — the query is keyed on the individual user, not on an organization. Similarly, `lib/db/clients.ts` uses `WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL` for client records. There is no concept of "who else can see this project" — every resource belongs to exactly one user, and any other user (even within the same organization) cannot access it unless they are an administrator bypassing filters.

This creates a fundamental mismatch with enterprise collaboration: an organization with five installers expects all five to work on the org's projects, but the current model ties each project to a single `user_id`. An admin route (`app/api/admin/projects/route.ts`) provides cross-tenant visibility to platform administrators via a global query (`FROM projects p LEFT JOIN users u ... WHERE p.deleted_at IS NULL`), but this is a platform-level bypass, not a collaboration mechanism.

The Phase 0 Data Inventory classifies projects, productions, proposals, layouts, permits, clients, surveys, and geometry as durable business resources owned by the user who created them. None of these tables carry an `organization_id` column today.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/db/projects.ts` (`getProjectsByUser`) | `WHERE p.user_id = ${userId} AND p.deleted_at IS NULL` — user-scoped, NOT org-scoped |
| `lib/db/clients.ts` (`getClientById`) | `WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL` — user-scoped |
| `app/api/admin/projects/route.ts` (GET) | `FROM projects p LEFT JOIN users u ... WHERE p.deleted_at IS NULL` — global, no org or user filter |
| `app/api/admin/projects/route.ts` (PATCH) | `UPDATE projects SET user_id = ${userId}` — admin can reassign project ownership with NO audit trail |
| `lib/migrations/016_organizations.sql` | No `organization_id` column on `projects`, `clients`, `productions`, `proposals`, `layouts`, `permits`, `surveys` tables |
| Phase 0 Data Inventory | Projects, clients, productions, proposals, layouts, permits, surveys, geometry — all classified as durable business data with user-level ownership |

### Options Considered

**Option A: User-level sharing (share a project with another user).** Add a `project_shares` table mapping project to user with a permission level. This preserves the user-scoped model and requires minimal schema change. However, it does not scale to organizations — when an org has 20 members, each would need an individual share row. It also fails P1 (Organizations Own Business Data): a project shared with a user persists only as a user-to-user link, not as an org-level asset.

**Option B: Org-level ownership with implicit org member access.** Add `organization_id` to projects and grant all org members automatic access based on their org role. This is simple and aligns with P1, but it removes the ability to restrict access within an org (e.g., a junior installer should not see all projects) and makes cross-org collaboration impossible (an org cannot invite a partner org to collaborate on a specific project).

**Option C: Owning org + explicit participant organizations + per-participant permission envelope.** Add `organization_id` to projects (the owning org, satisfying P1). Create a `project_participants` table listing organizations (and optionally individuals) invited to collaborate, each with a permission envelope (read, comment, edit). Access requires EITHER membership in the owning org with an adequate org role OR an explicit participant grant. This satisfies P1 (org owns the data), P2 (collaboration does not change ownership — the owning org retains full control), and P4 (permission-first authorization — no implicit access beyond org membership defaults).

### Decision

**Option C — Owning org + explicit participant organizations + per-participant permission envelope.**

Every durable business resource (project, client, production, proposal, layout, permit, survey, geometry) gains an `organization_id` column referencing the owning organization. The owning org is set server-side at creation time from the actor's active org context (per D-02) — never from client input (P3). All members of the owning org can access the resource subject to their org role permissions (per D-04). Cross-org collaboration is achieved through explicit `project_participants` grants: an owning org admin invites a partner org, specifying a permission envelope (read-only, comment, edit). The partner org's members then access the resource subject to the intersection of (a) their org role permissions and (b) the participant permission envelope.

### Rationale

This model satisfies all governing principles:

- **P1 (Organizations Own Business Data):** The `organization_id` column establishes canonical ownership. The owning org, not the creating user, is the data owner.
- **P2 (Collaboration Does Not Change Ownership):** Participant grants are access grants, not ownership transfers. The owning org can revoke a participant grant at any time. A participant org gains no ownership rights.
- **P3 (Default Deny):** Access requires positive evidence — either membership in the owning org or an explicit participant grant. No route trusts client-supplied `organization_id`; it is always derived from the server-side active org context.
- **P4 (Permission-First Authorization):** Access is gated by explicit permission checks, not by implicit query scoping alone.

Option A was rejected because it violates P1 and does not scale. Option B was rejected because it removes intra-org access control and prevents cross-org collaboration.

### Security Impact

- **Threats architecturally addressed:** T-01 (IDOR) — org-scoped queries replace user-scoped queries, reducing the attack surface from per-user to per-org with explicit participant grants. T-02 (admin global exposure) — admin routes must add org filtering unless the actor is a platform super_admin. T-18 (member removal leaves resources) — resources remain owned by the org even after a member departs; no orphaned user-owned data.
- **Threats introduced:** None directly. The participant model introduces a new access path, but it is explicit and permission-gated.
- **Residual risk:** If a participant org is invited with edit permission, a malicious member of that org could modify the owning org's project data. Addressed by the permission envelope (minimum necessary access) and audit logging (D-013).

### Data Model Impact

New column: `projects.organization_id UUID NOT NULL REFERENCES organizations(id)` (set server-side). Backfill: assign each existing project to the org of its creating user (per D-09 legacy migration). New table: `project_participants(id, project_id, organization_id, permission_envelope, granted_by, granted_at, revoked_at)`. Participant grants are org-to-org, not user-to-user. The permission envelope is an enum: `read`, `comment`, `edit`. No `admin` envelope — administration is reserved for the owning org.

### API Impact

- Project list API: query changes from `WHERE user_id = ?` to `WHERE organization_id = ?` (active org) UNION projects where the user's org is a participant.
- Project creation API: `organization_id` is set from the active org context, never from the request body.
- New API: `POST /api/projects/{id}/participants` (owner-org admin only) to invite a partner org.
- New API: `DELETE /api/projects/{id}/participants/{orgId}` (owner-org admin only) to revoke a participant grant.
- Admin project routes: add `organization_id` filter; global access only for `super_admin`.

### Worker Impact

The background worker (`worker/main.ts`) currently resolves the owner via `getSurveyOwnerId(surveyId)`. After this decision, the worker must resolve the owning org from the project's `organization_id` and use it for any org-scoped operations (e.g., storage path prefix per D-007, audit context per D-013). No business logic change, but the ownership resolution gains an org dimension.

### Storage Impact

No direct storage impact. File storage org-prefixing is addressed in D-007. However, project-level resources (surveys, geometry, plansets) must be associated with the owning org's storage namespace.

### Billing Impact

Projects and their resources are attributed to the owning org for billing purposes (per D-008). A participant org does not incur billing for the owning org's resources, even if it has edit access.

### Migration Impact

This is a Phase 1+ migration (NOT NEXT_ENTERPRISE_AUTHORITY_MIGRATION). The `organization_id` column and `project_participants` table are additive. Backfill is required to assign existing projects to an org (per D-009). The backfill must handle users with no org (legacy single-user accounts) — these are assigned to an auto-provisioned personal org.

### Testing Requirements

- Verify that a member of the owning org can access the project.
- Verify that a member of a non-participant org CANNOT access the project (cross-tenant isolation).
- Verify that a participant org member with `read` envelope can view but not edit.
- Verify that a participant org member with `edit` envelope can edit but not delete.
- Verify that revoking a participant grant immediately removes access for that org's members.
- Verify that `organization_id` is set server-side and a client-supplied `organization_id` in the request body is ignored.
- Verify that a departed member (org_id nulled) loses access to the org's projects.

### Rejected Alternatives

- Option A (user-level sharing): violates P1, does not scale.
- Option B (org ownership with implicit member access): removes intra-org access control, prevents cross-org collaboration.

### Deferred Work

- Individual (non-org) participant grants: the initial model supports org-to-org collaboration only. Individual external collaborator grants may be added in a future phase.
- Project-level role overrides: the initial model uses org-role permissions intersected with the participant envelope. Per-project role overrides are deferred.

### Rollback Considerations

If rolled back, the `organization_id` column can be dropped (after confirming all queries revert to `user_id` scoping). The `project_participants` table can be dropped. Existing user-scoped queries would need to be restored.

### Raymond Approval Required

No — evidence is sufficient. The current user-scoped model is verified in `lib/db/projects.ts` and `lib/db/clients.ts`. The decision follows directly from P1 and P2.

---

## ADR-006: Resource Share Grants — Revision-Pinned, No Reshare, No Future Revisions

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro currently has no resource sharing mechanism outside of the admin global-access bypass. Resources (projects, proposals, plansets) are accessible only to their owning user or to platform administrators. There is no way for one user or organization to grant another access to a specific resource without full admin elevation.

The Phase 0 Threat Model (T-01 IDOR) identifies the user-scoped query pattern as a critical vulnerability. While ADR-005 addresses org-level ownership and participant collaboration, there is a separate need for granular, point-in-time resource sharing — for example, sharing a specific proposal revision with a homeowner or an external auditor for review, without granting ongoing access to the project or future revisions.

SolarPro's file storage uses `@vercel/blob` with `access: 'public'` (verified in `app/api/survey/upload-photo/route.ts` and `lib/intake/utilityBillAttachment.ts`). There are no signed URLs, no access-controlled downloads, and no revision tracking for shared resources. A shared blob URL is a permanent public link.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `app/api/survey/upload-photo/route.ts` | Blob path: `surveys/${project_id}/${jti}/${category}/${ts}.${ext}` — no org prefix, `access: 'public'` |
| `lib/intake/utilityBillAttachment.ts` | Blob path: `intake/utility-bills/${funnel}/${eventId}/${Date.now()}-${randomUUID()}-${safeName}.${ext}` — no org prefix, `access: "public"` |
| `lib/db/projects.ts` | No share table exists; access is exclusively `WHERE user_id = ${userId}` |
| `app/api/admin/projects/route.ts` | Admin global access is the only "sharing" mechanism — no granular share grants |
| Phase 0 Data Inventory | No `*_shares` or `*_grants` table in the 55-table schema |

### Options Considered

**Option A: Open-ended resource sharing (grant access to a resource and all its future revisions).** A share grant references a resource (e.g., a project) and persists until revoked. The grantee sees all current and future revisions. This is simple but violates the principle of least privilege — a reviewer who should see one specific proposal draft would gain access to all future drafts, including ones with sensitive pricing changes.

**Option B: Time-limited resource sharing without revision pinning.** A share grant references a resource and has an expiration timestamp. The grantee sees the current state of the resource until the grant expires. This adds temporal control but does not pin a specific revision — if the resource changes between grant creation and grant use, the grantee sees the latest version, which may not be the version the granter intended to share.

**Option C: Revision-pinned share grants with no reshare and optional expiry.** A share grant references a specific revision of a resource (not the resource itself). The grantee can access ONLY that revision. The grant cannot be reshared (no delegation). An optional expiry timestamp limits the grant's duration. If the resource is revised after the grant is created, the grantee does NOT see the new revision unless a new grant is issued. This satisfies least privilege (the granter controls exactly what the grantee sees) and prevents privilege escalation (no reshare).

### Decision

**Option C — Revision-pinned share grants with no reshare and optional expiry.**

A new `resource_share_grants` table records: `id`, `resource_type` (project, proposal, planset, etc.), `resource_id`, `revision_id` (pinned to a specific revision), `grantee_type` (organization or individual), `grantee_id`, `permission` (read or comment — never edit, never admin), `granted_by` (the user who created the grant), `granted_by_org` (the owning org), `expires_at` (nullable), `created_at`, `revoked_at` (nullable). The grant is immutable once created except for `revoked_at`. Resharing is prohibited — a grantee cannot create new grants for the same resource. Access resolution checks: (1) the grant exists and is not revoked, (2) the grant has not expired, (3) the requested revision matches the pinned `revision_id`.

### Rationale

Revision pinning satisfies the principle of least privilege and supports audit/compliance use cases where a specific document version must be shared for review without exposing future changes. The no-reshare constraint prevents privilege escalation: a grantee with read access cannot extend that access to others. The optional expiry supports temporary access scenarios (e.g., a 7-day review window for an external auditor).

This aligns with P4 (Permission-First Authorization) — every access requires a positive grant check — and with P6 (Revision-Bound Enterprise Records) — the grant is bound to a specific revision, ensuring that shared content is deterministic and auditable.

### Security Impact

- **Threats architecturally addressed:** T-07 (public blob URLs) — share grants require server-side access resolution; blob URLs are no longer public (per D-007). T-01 (IDOR) — share grants are explicit and revision-pinned, reducing the blast radius of any single grant. Privilege escalation — no reshare prevents a low-privilege grantee from creating broader access.
- **Threats introduced:** If revision pinning is implemented incorrectly (e.g., the revision_id is not enforced at access time), a grantee could access unintended revisions. Addressed by mandatory access-resolution tests.
- **Residual risk:** A grant with no expiry persists indefinitely. Addressed by requiring an expiry for external (non-org) grantees and by the revocation mechanism.

### Data Model Impact

New table: `resource_share_grants(id, resource_type, resource_id, revision_id, grantee_type, grantee_id, permission, granted_by, granted_by_org, expires_at, created_at, revoked_at)`. Indexes on `(resource_type, resource_id)`, `(grantee_type, grantee_id)`, and `(revision_id)`. A `revisions` table or revision-tracking column on resources is a prerequisite (per D-007).

### API Impact

- New API: `POST /api/resources/{type}/{id}/share` — creates a revision-pinned share grant. The `revision_id` is resolved server-side from the current revision at grant creation time. Client cannot specify an arbitrary revision.
- New API: `DELETE /api/shares/{grantId}` — revokes a grant (granter or owning-org admin only).
- Access resolution: every resource fetch checks `resource_share_grants` for the requesting user/org before returning data. The revision_id is enforced — if the requested revision differs from the pinned revision, access is denied.

### Worker Impact

No direct worker impact. The background worker operates on owned resources (geometry reconstruction) and does not serve shared resources to grantees.

### Storage Impact

Share grants reference revision-specific file artifacts. The storage layer (D-007) must support revision-pinned access — a signed URL for a specific revision, not a mutable resource URL.

### Billing Impact

Share grants do not transfer billing. The owning org remains responsible for all billing (per D-008). A grantee org does not incur charges for accessed resources.

### Migration Impact

This is a Phase 2+ migration (after D-007 file revisions exist). The `resource_share_grants` table is additive. No backfill is required — no existing shares exist.

### Testing Requirements

- Verify that a grantee can access the pinned revision.
- Verify that a grantee CANNOT access a different revision of the same resource.
- Verify that a grantee CANNOT reshare the resource (create a new grant).
- Verify that an expired grant is denied.
- Verify that a revoked grant is denied.
- Verify that a non-grantee (no grant) is denied.
- Verify that `permission: read` prevents edit operations.
- Verify that the `revision_id` is set server-side and a client-supplied value is ignored.

### Rejected Alternatives

- Option A (open-ended sharing): violates least privilege; exposes future revisions unintentionally.
- Option B (time-limited without pinning): does not guarantee the shared content matches the granter's intent.

### Deferred Work

- Reshare with explicit granter approval (a granter could pre-authorize reshare with a max depth). Deferred — no-reshare is the safe default.
- Share bundles (share multiple resources in one grant). Deferred.

### Rollback Considerations

If rolled back, the `resource_share_grants` table can be dropped. No existing data depends on it.

### Raymond Approval Required

No — evidence is sufficient. The absence of any share mechanism and the public blob URLs are verified. The decision follows from P4 and P6.

---

## ADR-007: Files and Revisions — Private Tenant-Prefixed Storage, DB-Backed Records, Immutable Revisions, Signed URLs

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro stores all file artifacts in Vercel Blob (`@vercel/blob`) with `access: 'public'`. Every uploaded file — survey photos, utility bills, plansets, proposal PDFs — receives a public URL that is accessible to anyone with the link, regardless of authentication or organization membership. This is verified in two upload paths: `app/api/survey/upload-photo/route.ts` (blob path `surveys/${project_id}/${jti}/${category}/${ts}.${ext}`, `access: 'public'`) and `lib/intake/utilityBillAttachment.ts` (blob path `intake/utility-bills/${funnel}/${eventId}/${Date.now()}-${randomUUID()}-${safeName}.${ext}`, `access: "public"`).

There is no org prefix in any storage path. A file uploaded by Org A and a file uploaded by Org B share the same flat namespace (`surveys/...`, `intake/...`), distinguishable only by embedded project/event IDs. There is no revision tracking — when a file is replaced, the old blob URL is simply overwritten or a new URL is generated, with no DB record linking revisions.

The Phase 0 Threat Model rates T-07 (public blob URLs) as HIGH severity: any tenant's files are publicly accessible if the URL is discovered, leaked, or guessed. There is no access control at the storage layer.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `app/api/survey/upload-photo/route.ts` | `put(pathname, file, { access: 'public' })` — public access, no org prefix in path |
| `lib/intake/utilityBillAttachment.ts` | `put(blobPath, file, { access: "public" })` — public access, no org prefix in path |
| `package.json` | `@vercel/blob` dependency — public blob storage |
| Phase 0 Data Inventory | No `file_revisions` or `file_records` table in the 55-table schema |
| Phase 0 Threat Model (T-07) | "Public blob URLs — any tenant's files are publicly accessible" — HIGH severity |

### Options Considered

**Option A: Keep public blob URLs, add application-level access control.** Continue using `access: 'public'` but wrap every file access in an API route that checks authorization before returning the blob URL. This reduces the attack surface (the URL is not returned to unauthorized users) but does not protect the blob itself — if a URL leaks (browser history, shared logs, cache), the file remains publicly accessible. This is defense-in-depth failure: the blob is only as secure as the URL's secrecy.

**Option B: Private blob storage with per-request signed URLs and no revision tracking.** Switch to `access: 'private'` (or equivalent private storage). Each file access generates a short-lived signed URL after authorization checks. This fixes T-07 but does not address revision tracking — file replacements still overwrite or generate new URLs with no revision history.

**Option C: Private tenant-prefixed storage with DB-backed file records, immutable revisions, and signed URLs.** Switch to private storage with org-prefixed paths (`orgs/{orgId}/projects/{projectId}/...`). Every file upload creates a DB record in a `file_records` table (file_id, org_id, resource_type, resource_id, revision_number, blob_path, content_hash, uploaded_by, uploaded_at, superseded_by). Revisions are immutable — a new upload creates a new revision row with an incremented revision_number and a new blob path; the old revision row is marked `superseded_by` but its blob is retained. Access to any file requires (1) authorization check, (2) signed URL generation with a short TTL (e.g., 5 minutes). This satisfies P7 (Hybrid Isolation — storage is tenant-isolated by path prefix), P6 (Revision-Bound Enterprise Records — revisions are immutable and tracked), and P1 (Organizations Own Business Data — files are stored under the owning org's prefix).

### Decision

**Option C — Private tenant-prefixed storage with DB-backed file records, immutable revisions, and signed URLs.**

All file storage migrates to private access with org-prefixed paths. A `file_records` table tracks every file artifact with revision metadata. Revisions are immutable: a new upload creates a new revision, never overwriting the old. Access requires server-side authorization and signed URL generation with a short TTL. Existing public blob URLs are migrated to private access during the Phase 2 storage migration (per D-009 legacy migration and D-014 implementation sequence).

### Rationale

Private storage with org prefixes establishes tenant isolation at the storage layer (P7). DB-backed file records provide an audit trail and enable revision-pinned sharing (D-006). Immutable revisions ensure that shared content is deterministic (P6) and that compliance requirements (retention, audit) can be met. Signed URLs with short TTLs minimize the window of exposure if a URL leaks.

Option A was rejected because it leaves the blob publicly accessible — defense-in-depth failure. Option B was rejected because it does not address revision tracking, which is a prerequisite for D-006 (revision-pinned sharing).

### Security Impact

- **Threats architecturally addressed:** T-07 (public blob URLs) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). The architecture specifies private storage with org-prefixed paths and signed URLs; current code uses `access: 'public'` — the migration to private storage is Phase 2 implementation work. T-15 (cache leaks) — NOT CURRENTLY APPLICABLE. Upstash Redis is used for rate-limiting only; no tenant-sensitive data is cached in Redis. The signed URL TTL concern is a storage-access concern, not a cache concern. T-03 (no RLS) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). Storage isolation complements DB isolation; even if a DB query leaks, the file requires a separate authorization check — but this requires Phase 2 storage migration to implement.
- **Threats introduced:** Signed URL infrastructure must be implemented correctly — a broken signing mechanism could either deny legitimate access or grant access to unauthorized users. Addressed by mandatory signing tests and key rotation procedures.
- **Residual risk:** Signed URLs, once generated, are valid for their TTL regardless of subsequent authorization changes (e.g., if a user's org membership is revoked mid-TTL, the signed URL remains valid until expiry). Addressed by short TTLs (5 minutes) and by requiring re-authorization for subsequent access.

### Data Model Impact

New table: `file_records(id, org_id, resource_type, resource_id, revision_number, blob_path, content_type, content_hash, byte_size, uploaded_by, uploaded_at, superseded_by_revision_id)`. Indexes on `(org_id, resource_type, resource_id)`, `(blob_path)`, `(content_hash)`. The `blob_path` uses the org-prefixed format: `orgs/{orgId}/{resourceType}/{resourceId}/r{revisionNumber}/{timestamp}-{filename}`.

### API Impact

- All upload routes: change `access: 'public'` to private storage; generate org-prefixed path using the active org context (D-002); create a `file_records` row.
- New API: `GET /api/files/{fileId}` — checks authorization, generates a signed URL, redirects or proxies the file content.
- New API: `GET /api/files/{fileId}/revisions` — lists all revisions of a file (owning org members or share grantees only).
- Existing routes that return blob URLs directly (e.g., survey photo responses) must be updated to return `fileId` references instead, with the client fetching via the signed-URL API.

### Worker Impact

The background worker (`worker/main.ts`) accesses geometry files during reconstruction. It must resolve the owning org from the project's `organization_id` and generate internal signed URLs or use a service-level storage access pattern that bypasses the per-request signed URL (with its own authorization context).

### Storage Impact

This is the core storage change. All existing public blobs must be migrated to private access with org-prefixed paths. This is a data migration, not a schema migration — the blob content is copied (or the access policy is changed) and `file_records` rows are created for each existing file. Migration is sequenced in D-014.

### Billing Impact

Storage costs may increase slightly due to revision retention (old revisions are not deleted). This is an acceptable trade-off for compliance and auditability. The owning org bears the storage cost (per D-008).

### Migration Impact

This is a Phase 2 migration (after orgs and memberships exist in Phase 1). The `file_records` table is additive. The blob migration (public to private, flat to org-prefixed) is a data migration that must be carefully sequenced to avoid downtime. See D-014 for the implementation sequence.

### Testing Requirements

- Verify that a file uploaded by Org A is stored under Org A's prefix and is NOT accessible via a public URL.
- Verify that a file access requires authorization — an unauthenticated request is denied.
- Verify that a cross-org request (Org B member accessing Org A's file) is denied without a share grant.
- Verify that a new upload creates a new revision and the old revision's blob is retained.
- Verify that a signed URL expires after its TTL.
- Verify that the `file_records` row records the correct `org_id`, `revision_number`, and `content_hash`.
- Verify that the blob path includes the org prefix.

### Rejected Alternatives

- Option A (public URLs + app-level access control): defense-in-depth failure; blob remains public.
- Option B (private storage without revision tracking): does not support revision-pinned sharing (D-006) or compliance requirements.

### Deferred Work

- Content-addressable storage (deduplication by content_hash): the `content_hash` column is included for future deduplication but is not enforced as unique initially.
- File-level RLS: the initial model uses application-level authorization + signed URLs. Storage-level RLS (if the storage provider supports it) is deferred.

### Rollback Considerations

If rolled back, the `file_records` table can be dropped and blob access reverted to public. However, the blob migration (path changes) is difficult to reverse without data loss — a rollback plan must preserve the old public URLs until the migration is confirmed stable.

### Raymond Approval Required

No — evidence is sufficient. The public blob URLs and lack of revision tracking are verified in the source code. The decision follows from P7, P6, and P1.

---

## ADR-008: Billing Attribution — Server-Authoritative, Organization-Level Billing

**Status:** RECOMMENDED
**Stakeholder Approval:** PENDING RAYMOND APPROVAL
**Date:** 2026-07-11

### Context

SolarPro's current billing model is per-user, not per-organization. Each user has their own Stripe subscription (`stripe_customer_id`, `stripe_subscription_id` columns on the `users` table from Migration 006). The organization inherits the owner's plan: `lib/stripe.ts` contains a `syncSeatsForOrg(orgId)` function that counts `users WHERE org_id = ${orgId}`, subtracts the plan's `usersIncluded` value, and syncs the seat quantity on the owner's Stripe subscription. Enterprise plan has `usersIncluded: null` (unlimited seats).

This creates a billing attribution problem: the subscription lives on the owner's individual Stripe customer, not on an organization-level customer. If the owner leaves the org (per `app/api/organizations/member/route.ts`, which sets `org_id = NULL`), the subscription remains on the departed owner's account, and the org's billing is disrupted. There is no mechanism to transfer the subscription to a new owner or to an org-level Stripe customer.

Additionally, pricing is globally hardcoded in `lib/companyPricing.ts` (`residentialPricePerWatt: 3.10`, etc.) with no per-org pricing support. The Phase 0 Threat Model rates T-20 (pricing global) as LOW severity but notes it as a limitation for enterprise custom pricing.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/006_users_subscriptions_whitelabel.sql` | `stripe_customer_id`, `stripe_subscription_id` columns on `users` table — per-user billing |
| `lib/stripe.ts` (`syncSeatsForOrg`) | `count = SELECT COUNT(*) FROM users WHERE org_id = ${orgId}` — seats synced on owner's subscription |
| `lib/stripe.ts` (plan config) | Enterprise plan: `usersIncluded: null` (unlimited) |
| `lib/companyPricing.ts` | `residentialPricePerWatt: 3.10`, `commercialPricePerWatt: 2.35` — hardcoded global pricing, no per-org override |
| `app/api/organizations/member/route.ts` (DELETE) | Owner removal nulls `org_id` on all members — no billing transfer mechanism |
| Phase 0 Threat Model (T-20) | "Pricing global — no per-org custom pricing" — LOW severity |

### Options Considered

**Option A: Keep per-user billing, add org-level seat aggregation.** Continue billing the owner's individual Stripe customer. When the owner changes, transfer the Stripe subscription to the new owner's customer. This preserves the current model but creates operational complexity (Stripe subscription transfers are non-trivial and can fail) and does not establish org-level billing identity.

**Option B: Org-level Stripe customer, per-user billing removed.** Create a Stripe customer at the organization level (`organizations.stripe_customer_id`). All billing — subscription, seats, usage — is attributed to the org, not to any individual user. Users no longer have `stripe_customer_id` or `stripe_subscription_id`. The org admin manages billing. This aligns with P1 (Organizations Own Business Data) — the org owns its billing relationship — and with P5 (Platform Authority and Tenant Authority Are Separate) — billing is a tenant-level concern, not a platform-level or user-level concern.

**Option C: Hybrid — org-level subscription with per-user metered usage.** Org-level Stripe customer for the base subscription, plus per-user metered usage (e.g., API calls, storage) billed to the org. This is the most flexible but adds complexity in usage tracking and metered billing configuration.

### Decision

**Option B — Org-level Stripe customer, server-authoritative billing attribution.**

Billing is attributed to the organization, not to individual users. A `stripe_customer_id` and `stripe_subscription_id` are added to the `organizations` table. The `users` table's billing columns are deprecated (retained for legacy compatibility during migration). All billing operations — subscription creation, seat sync, invoice retrieval — operate on the org-level Stripe customer. Billing attribution is server-authoritative: the active org context (D-002) determines which Stripe customer is charged. No route trusts a client-supplied `stripe_customer_id` or `org_id` for billing (P3).

### Rationale

Org-level billing aligns with P1 (the org owns its business data, including its billing relationship) and P5 (billing is a tenant concern). It architecturally addresses the owner-departure billing disruption: the subscription lives on the org, not on a user (IMPLEMENTATION PENDING — the migration from per-user to per-org Stripe customers is Phase 2 work requiring Raymond's approval per ADR-008). Server-authoritative attribution satisfies P3 (Default Deny) — no client can charge a different org's Stripe customer.

Option A was rejected because it creates operational fragility (subscription transfers) and does not establish org-level billing identity. Option C was rejected for initial implementation complexity — metered usage can be added in a future phase.

### Security Impact

- **Threats architecturally addressed:** T-08 (audit log no org context) — billing events are now org-attributed, improving audit traceability. Cross-tenant billing confusion — server-authoritative attribution prevents a user from charging another org's customer.
- **Threats introduced:** If the active org context (D-002) is compromised or spoofed, billing could be misattributed. Addressed by D-002's server-side validation and P3 (no client-supplied org IDs for billing).
- **Residual risk:** Legacy per-user subscriptions (existing users with `stripe_subscription_id` on their `users` row) must be migrated to org-level customers. This migration has a window of risk (double-billing or billing gaps). Addressed by a carefully sequenced migration (D-014) and Stripe-side coordination.

### Data Model Impact

New columns on `organizations`: `stripe_customer_id TEXT`, `stripe_subscription_id TEXT`, `plan TEXT`, `subscription_status TEXT`. The `users` table billing columns are deprecated but retained: `stripe_customer_id`, `stripe_subscription_id`, `plan`, `subscription_status`, `trial_starts_at`, `trial_ends_at`, `is_free_pass`. A migration job links existing user subscriptions to their org's new customer record. `syncSeatsForOrg()` is updated to use the org-level subscription.

### API Impact

- Billing routes (subscription, invoice, plan management): operate on the org-level Stripe customer, resolved from the active org context (D-002).
- `syncSeatsForOrg()`: updated to sync seats on `organizations.stripe_subscription_id`.
- New API: `GET /api/organizations/{id}/billing` (org admin only) — returns billing status, invoices, seat count.
- Stripe webhook handler: must map Stripe events to the org-level customer, not to a user.

### Worker Impact

No direct worker impact. The background worker does not handle billing.

### Storage Impact

No storage impact.

### Billing Impact

This IS the billing impact. The core change is shifting billing from per-user to per-org. Legacy subscriptions are migrated. Per-org custom pricing (T-20) is deferred — the initial model uses the existing global pricing with org-level subscription management.

### Migration Impact

This is a Phase 2 migration (after orgs exist). The org-level billing columns are additive. The subscription migration (moving existing user subscriptions to org-level customers) requires Stripe API coordination and is sequenced in D-014. The `is_free_pass` flag on users is retained for platform-level free passes (platform admin grants) but is no longer the primary billing mechanism for orgs.

### Testing Requirements

- Verify that billing operations use the org-level Stripe customer, not the user's.
- Verify that a client-supplied `stripe_customer_id` is ignored (P3).
- Verify that `syncSeatsForOrg()` syncs on the org's subscription.
- Verify that a non-admin org member cannot access billing endpoints.
- Verify that the Stripe webhook handler maps events to the correct org.
- Verify that legacy user subscriptions are correctly migrated to org-level customers.
- Verify that an org with no Stripe customer (new org) can initiate billing.

### Rejected Alternatives

- Option A (per-user billing with seat aggregation): operational fragility, no org-level billing identity.
- Option C (hybrid with metered usage): excessive complexity for initial release.

### Deferred Work

- Per-org custom pricing (T-20): the `companyPricing.ts` global values are retained initially. Per-org pricing overrides are deferred to a future phase.
- Metered usage billing: deferred.
- Proration and mid-cycle plan changes: deferred to Phase 3+.

### Rollback Considerations

If rolled back, the org-level billing columns can be dropped and billing reverted to per-user. However, the Stripe customer migration is difficult to reverse — a rollback plan must preserve the original user-level Stripe customers until the migration is confirmed stable.

### Raymond Approval Required

Yes — the subscription migration from per-user to per-org Stripe customers involves financial operations and Stripe API coordination. Raymond must approve the migration sequence and the handling of legacy subscriptions (especially `is_free_pass` users and trialing subscriptions) before implementation.

---

## ADR-009: Legacy Ownership Migration — No Free-Text Auto-Merging, Ambiguity Queue

**Status:** RECOMMENDED
**Stakeholder Approval:** PENDING RAYMOND APPROVAL
**Date:** 2026-07-11

### Context

SolarPro has two parallel "company" concepts with no foreign key relationship between them. Migration 006 (`lib/migrations/006_users_subscriptions_whitelabel.sql`) created a `users.company TEXT` column — a free-text field populated by users at registration with no validation, no normalization, and no link to the `organizations` table. Migration 016 (`lib/migrations/016_organizations.sql`) created the `organizations` table with `id, name, owner_id, plan`. A user's `company` text field and their `org_id` reference are completely independent — a user could have `company = "Acme Solar"` and `org_id` pointing to an org named "Bright Energy."

When Phase 1 introduces org-level ownership (per ADR-005), every existing resource (project, client, production, proposal, layout, permit, survey) must be backfilled with an `organization_id`. The question is: how do we determine which org owns each existing resource?

The naive approach would be to auto-merge users by their `company` text field — group all users with `company = "Acme Solar"` into one org. But free-text fields are unreliable: "Acme Solar," "Acme Solar LLC," "Acme Solar, Inc.," and "acme solar" would be treated as different companies by exact match but could be the same entity. Conversely, two unrelated companies could both be named "Sunrise Solar." Auto-merging based on free text would create data corruption — merging unrelated companies' data or splitting a single company's data across multiple orgs.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/006_users_subscriptions_whitelabel.sql` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT` — free-text, no FK, no normalization |
| `lib/migrations/016_organizations.sql` | `CREATE TABLE organizations(id, name, owner_id, plan, created_at, updated_at)` — no link to `users.company` |
| Phase 0 Current-State Audit (F-09) | "Two parallel company concepts: `organizations` table and `users.company` TEXT — no FK between them" |
| Phase 0 Data Inventory | 55 tables, none with `organization_id` — all existing resources are user-owned, not org-owned |
| Seed data (Migration 006) | 6 users seeded with `is_free_pass: true`, various `company` values including NULL |

### Options Considered

**Option A: Auto-merge by `users.company` free-text.** Group users by exact or fuzzy match on the `company` field. Create one org per unique company name. Assign all of a user's resources to their company's org. This is fast but dangerous — free-text matching is unreliable (case variations, suffixes, abbreviations) and can merge unrelated companies or split a single company. Data corruption risk is HIGH.

**Option B: Auto-merge by `users.org_id` (existing org memberships).** For users who already have an `org_id` (from Migration 016), assign their resources to that org. For users without an `org_id`, create a personal org (one org per user) and assign their resources to it. This is safe (no cross-company merging) but creates a large number of single-user orgs for users who never joined an org. It also ignores the `company` text field entirely.

**Option C: `org_id` first, personal org fallback, ambiguity queue for `company`-based suggestions.** For users with an existing `org_id`, assign resources to that org (safe, verified). For users without an `org_id`, create a personal org and assign resources to it (safe default). The `company` text field is NOT used for auto-merging. Instead, the `company` field is used to generate merge suggestions: users with the same normalized `company` value are flagged in an ambiguity queue for manual review by a platform admin or by Raymond. An admin can then merge personal orgs into a shared org after verifying that the users actually belong to the same company. This satisfies P1 (no unverified ownership changes) and avoids data corruption.

### Decision

**Option C — `org_id` first, personal org fallback, ambiguity queue for `company`-based suggestions.**

Existing `org_id` memberships are respected — resources are assigned to the verified org. Users without an `org_id` get a personal org (auto-provisioned, named after the user or their `company` text). The `company` text field is never used for automatic merging. Instead, it generates suggestions in an ambiguity queue. Merges are performed manually after verification. The `users.company` text field is deprecated as an ownership indicator but retained for display purposes.

### Rationale

Auto-merging by free-text `company` would violate P1 (Organizations Own Business Data) by assigning data to potentially incorrect orgs based on unverified text matching. The ambiguity queue approach is conservative: it never merges without human verification, preventing data corruption. The personal org fallback ensures that every resource has an owner (no orphaned data) without making assumptions about company identity.

This aligns with P3 (Default Deny) — no automatic ownership change without verification — and with P1 — ownership is established through verified org membership, not text matching.

### Security Impact

- **Threats architecturally addressed:** Data corruption from incorrect merging — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). The architecture prohibits auto-merging; the no-merge strategy must be implemented in the backfill script (Gate 13). Cross-tenant data leakage from auto-merging unrelated companies — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). The ambiguity queue and personal org fallback prevent auto-merging; implementation is Phase 1 Gate 13/14. T-13 (ON DELETE SET NULL orphans) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). Every resource gets an owner (personal org fallback), so no orphaned data even for users who never joined an org — but this requires the backfill script execution (Gate 13).
- **Threats introduced:** None. The ambiguity queue is a manual review tool, not an automated action.
- **Residual risk:** Personal orgs for users who actually belong to a shared company will exist until the ambiguity queue is processed. This is a data hygiene issue, not a security issue. Addressed by prompt review of the ambiguity queue.

### Data Model Impact

No new tables required for the migration itself. The backfill process: (1) for each user with `org_id`, set `organization_id = org_id` on all their resources; (2) for each user without `org_id`, create a personal org (`organizations` row with `owner_id = user.id`), set the user's `org_id`, and set `organization_id` on all their resources. An `org_merge_suggestions` table (or a section in an admin tool) tracks the ambiguity queue: `(suggested_company_name, user_ids[], status, reviewed_by, reviewed_at)`.

### API Impact

- New admin API: `GET /api/admin/migration/ambiguity-queue` — lists merge suggestions grouped by normalized `company` value.
- New admin API: `POST /api/admin/migration/merge-orgs` — merges one or more personal orgs into a target org (platform admin only, audited).
- The backfill itself is a migration script, not an API.

### Worker Impact

No worker impact. The migration is a one-time batch process.

### Storage Impact

No direct storage impact. File storage org-prefixing (D-007) is a separate migration that must be coordinated with this one — files belonging to resources being reassigned to a new org must have their storage paths updated.

### Billing Impact

Personal orgs created by the fallback will need a billing setup (per D-008). If a user had a per-user Stripe subscription, it is migrated to their personal org's customer. When personal orgs are later merged into a shared org, billing is consolidated.

### Migration Impact

This IS a migration decision. It defines the backfill strategy for Phase 1. The backfill is executed as part of the Phase 1 migration sequence (D-014). It is NOT NEXT_ENTERPRISE_AUTHORITY_MIGRATION (which is prohibited until entry gates are met per D-014).

### Testing Requirements

- Verify that a user with an existing `org_id` has their resources assigned to that org.
- Verify that a user without an `org_id` gets a personal org and their resources are assigned to it.
- Verify that two users with the same `company` text are NOT automatically merged.
- Verify that two users with different `company` text are NOT merged even if the text is similar.
- Verify that the ambiguity queue correctly groups users by normalized `company` value.
- Verify that a manual merge correctly reassigns all resources from the source org to the target org.
- Verify that no resources are orphaned (every resource has an `organization_id` after backfill).

### Rejected Alternatives

- Option A (auto-merge by free-text `company`): HIGH data corruption risk from unreliable text matching.
- Option B (auto-merge by `org_id` only, ignore `company`): safe but does not provide a path to consolidate users who belong to the same company but never joined an org. The ambiguity queue in Option C provides this path safely.

### Deferred Work

- Automated merge verification (e.g., email domain matching, phone number matching): deferred — manual verification is the safe default. Automated heuristics may be added as suggestions in the ambiguity queue.
- Bulk merge tooling: deferred — the initial merge API handles one merge at a time.

### Rollback Considerations

If rolled back, the personal orgs created by the fallback can be dissolved (resources reassigned back to user ownership). The ambiguity queue suggestions are non-destructive and can be discarded. However, any merges that were performed must be reversed individually.

### Raymond Approval Required

Yes — the backfill strategy affects every existing user's data ownership. Raymond must approve: (1) the personal org fallback naming convention, (2) the ambiguity queue review process, (3) the handling of `is_free_pass` users and seed data, and (4) the merge verification criteria before the backfill is executed.

---

## ADR-010: Ownership Transfer — Formal, Audited, Both Sides Approve

**Status:** RECOMMENDED
**Stakeholder Approval:** PENDING RAYMOND APPROVAL
**Date:** 2026-07-11

### Context

SolarPro currently has no formal ownership transfer mechanism. The closest existing functionality is the admin project reassignment in `app/api/admin/projects/route.ts` (PATCH), where a platform admin can reassign a project to a different user (`UPDATE projects SET user_id = ${userId}`) with NO audit trail. The org member removal route (`app/api/organizations/member/route.ts`) allows an owner to remove members, which nulls their `org_id`, but does not transfer ownership of the org itself or of the departing member's resources.

When an organization's owner departs, the org is left without an owner. The DELETE handler in `app/api/organizations/route.ts` allows the owner to delete the org (nulling all members' `org_id`), but there is no mechanism to transfer org ownership to another member. Similarly, when a project's owning org needs to transfer a project to another org (e.g., a subsidiary spins off, a project is sold to another company), there is no formal, audited transfer process.

The Phase 0 Threat Model (T-12, T-18) notes that member removal leaves resources without clear ownership transitions and that there is no audit trail for ownership changes.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `app/api/admin/projects/route.ts` (PATCH) | `UPDATE projects SET user_id = ${userId}` — admin reassigns project with NO audit trail |
| `app/api/organizations/member/route.ts` (DELETE) | Owner can remove members (nulls `org_id`), but cannot transfer org ownership |
| `app/api/organizations/route.ts` (DELETE) | Owner can delete org (nulls all members' `org_id`) — destructive, no transfer option |
| `lib/auditLog.ts` | No `ownership_transfer` audit category; no transfer event type |
| Phase 0 Threat Model (T-12) | "Member removal no audit" — MEDIUM |
| Phase 0 Threat Model (T-18) | "Member removal leaves resources" — HIGH |

### Options Considered

**Option A: Admin-initiated transfer (platform admin moves ownership unilaterally).** A platform admin can transfer org ownership or project ownership to any other org/user. This is fast but violates tenant autonomy (P5 — platform authority and tenant authority are separate) and creates a single point of failure (a compromised admin account could transfer all orgs to an attacker). No approval from the receiving party is required.

**Option B: One-sided transfer (owning org admin initiates, receiving org auto-accepts).** The owning org's admin initiates a transfer, and the receiving org automatically gains ownership. This is simpler than bilateral approval but does not verify that the receiving org consents to accepting the resources (and potentially the associated billing and storage costs). A receiving org could be flooded with unwanted transfers.

**Option C: Formal bilateral transfer with both-sides approval and full audit trail.** A transfer is a two-phase process: (1) the owning org's admin initiates a transfer request, specifying the receiving org and the resources to transfer; (2) the receiving org's admin accepts or rejects the request. Upon acceptance, ownership is transferred: `organization_id` is updated on all transferred resources, the owning org's admin is recorded as the transferor, the receiving org's admin is recorded as the transferee, and a full audit event is written (per D-013). The transfer is atomic — either all resources transfer or none do. This satisfies P1 (ownership changes are explicit and verified), P5 (tenant autonomy — both parties must consent), and P6 (revision-bound records — the transfer is an audited event).

### Decision

**Option C — Formal bilateral transfer with both-sides approval and full audit trail.**

Ownership transfer is a two-phase, bilateral process. The owning org initiates, the receiving org accepts, and the transfer is atomic and audited. A new `ownership_transfer_requests` table tracks the transfer lifecycle. Platform admins can facilitate (e.g., resolve disputes) but cannot unilaterally execute transfers — they act as mediators, not as transferors.

### Rationale

Bilateral approval ensures that both parties consent to the ownership change, preventing unwanted transfers and establishing a clear chain of custody. The atomic transfer prevents partial states (some resources transferred, others not). The full audit trail (D-013) ensures that every ownership change is traceable.

This aligns with P1 (Organizations Own Business Data — ownership changes are explicit), P5 (Platform Authority and Tenant Authority Are Separate — transfers are tenant-to-tenant, not platform-imposed), and P6 (Revision-Bound Enterprise Records — the transfer is an audited, revision-bound event).

### Security Impact

- **Threats architecturally addressed:** T-12 (member removal no audit) — transfers are fully audited. T-18 (member removal leaves resources) — formal transfer ensures resources have a clear new owner. Unauthorized transfers — bilateral approval prevents a single compromised account from transferring ownership.
- **Threats introduced:** If the transfer request/acceptance flow is not properly secured (e.g., the acceptance endpoint does not verify the receiving org's admin), a malicious actor could accept transfers on behalf of an org. Addressed by requiring the receiving org's admin authorization (D-004) and by audit logging.
- **Residual risk:** A transfer request that is never accepted or rejected leaves resources in a pending state. Addressed by request expiry (auto-reject after N days) and by allowing the initiating org to cancel.

### Data Model Impact

New table: `ownership_transfer_requests(id, resource_type, resource_ids[], source_org_id, target_org_id, initiated_by, initiated_at, accepted_by, accepted_at, rejected_by, rejected_at, status, expires_at, audit_event_id)`. The `resource_ids` column is an array of resource IDs to transfer. The `status` column is an enum: `pending`, `accepted`, `rejected`, `expired`, `cancelled`. Upon acceptance, a migration job updates `organization_id` on all listed resources atomically.

### API Impact

- New API: `POST /api/transfers` — initiates a transfer request (source org admin only).
- New API: `GET /api/transfers` — lists transfer requests for the active org (incoming and outgoing).
- New API: `POST /api/transfers/{id}/accept` — accepts a transfer (target org admin only).
- New API: `POST /api/transfers/{id}/reject` — rejects a transfer (target org admin only).
- New API: `POST /api/transfers/{id}/cancel` — cancels a pending transfer (source org admin only).
- The existing admin project reassignment (`app/api/admin/projects/route.ts` PATCH) is deprecated and replaced by the transfer flow.

### Worker Impact

No direct worker impact. The transfer execution (updating `organization_id` on resources) is a batch operation that can be performed synchronously or via a background job.

### Storage Impact

If files are transferred (per D-007), their storage paths must be updated from the source org's prefix to the target org's prefix. This is a data migration that is part of the transfer execution. File blobs may need to be copied (or the path metadata updated, depending on the storage provider's capabilities).

### Billing Impact

Transferred resources may carry billing implications (e.g., storage costs, seat usage). Upon transfer, the receiving org assumes billing responsibility for the transferred resources (per D-008). The transfer API must display the billing implications before the receiving org accepts.

### Migration Impact

This is a Phase 3+ migration (after orgs, memberships, and resource ownership are established). The `ownership_transfer_requests` table is additive. No backfill is required — no existing transfers exist. The existing admin reassignment route is deprecated but retained for backward compatibility during the transition.

### Testing Requirements

- Verify that a transfer request can be initiated by the source org admin.
- Verify that a transfer request CANNOT be initiated by a non-admin org member.
- Verify that a transfer request CANNOT be accepted by the source org (must be the target org).
- Verify that acceptance atomically updates `organization_id` on all listed resources.
- Verify that a partial transfer (some resources fail to update) rolls back all changes.
- Verify that a full audit event is written for the transfer.
- Verify that an expired transfer request cannot be accepted.
- Verify that a cancelled transfer request cannot be accepted.
- Verify that the existing admin reassignment route is deprecated (returns a warning or 410 Gone).

### Rejected Alternatives

- Option A (admin-initiated unilateral transfer): violates P5 (tenant autonomy), single point of failure.
- Option B (one-sided transfer): receiving org has no consent mechanism; could be flooded with unwanted transfers.

### Deferred Work

- Bulk transfer (transfer all resources of a given type): deferred — the initial model supports explicit resource lists.
- Transfer with conditions (e.g., transfer effective on a future date): deferred.
- Cross-resource-type transfers (transfer a project and all its child resources automatically): deferred — the initial model requires explicit resource lists, but a future enhancement could cascade transfers to child resources.

### Rollback Considerations

If rolled back, the `ownership_transfer_requests` table can be dropped. Any completed transfers would need to be reversed manually (reassigning `organization_id` back to the source org). The deprecated admin reassignment route would need to be re-enabled.

### Raymond Approval Required

Yes — ownership transfer affects data custody and billing. Raymond must approve: (1) the bilateral approval flow, (2) the handling of billing responsibility transfer, (3) the expiry duration for pending requests, and (4) the deprecation timeline for the existing admin reassignment route.

---

## ADR-011: Parent/Subsidiary Organizations — Design for Future, No Auto-Inheritance

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro's organization model is flat — every organization is independent, with no parent-child relationship. The `organizations` table (Migration 016) has no `parent_org_id` column. Enterprise customers, however, often have complex org structures: a parent company with subsidiaries, a holding company with divisions, or a franchise with franchisee orgs. These customers may want to roll up billing, share resources hierarchically, or apply policy from a parent to its subsidiaries.

The question is whether Phase 1 should introduce parent/subsidiary relationships and, if so, whether access and billing should automatically cascade from parent to subsidiary.

Introducing hierarchical org structures adds significant complexity: access resolution must traverse the hierarchy, billing rollup requires aggregation across subsidiaries, and policy inheritance requires conflict resolution (what if a subsidiary has a more restrictive policy than the parent?). Given that Phase 1's goal is to establish the canonical org and membership model (per D-014 implementation sequence), adding hierarchy now would expand scope and risk.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/migrations/016_organizations.sql` | `CREATE TABLE organizations(id, name, owner_id, plan, created_at, updated_at)` — no `parent_org_id` column |
| `app/api/organizations/route.ts` | No parent/subsidiary logic in org CRUD |
| Phase 0 Authority Architecture | D-11 (Parent/Subsidiary Organizations) listed as an open decision |
| Phase 0 Data Inventory | No hierarchy or parent-child relationship in the 55-table schema |

### Options Considered

**Option A: Implement parent/subsidiary with automatic access and billing inheritance.** Add `parent_org_id` to `organizations`. Parent org members automatically access subsidiary resources. Billing rolls up to the parent. Policy cascades from parent to subsidiary. This is the most feature-rich option but adds significant complexity and risk to Phase 1. It also raises questions: can a subsidiary override a parent policy? What happens if a subsidiary is transferred to a different parent? How are circular references prevented?

**Option B: Implement parent/subsidiary with NO automatic inheritance.** Add `parent_org_id` to `organizations` as a metadata field only. No automatic access, billing, or policy inheritance. Parent/subsidiary relationships are recorded but have no functional effect initially. Features that use the hierarchy (rollup billing, hierarchical access) are added in future phases. This establishes the data model without the complexity of inheritance logic.

**Option C: No parent/subsidiary in Phase 1.** Do not add `parent_org_id` at all. Organizations remain flat. Parent/subsidiary is a future phase decision. This is the simplest option and keeps Phase 1 focused, but means that the schema will need a migration later when hierarchy is added.

### Decision

**Option B — Add `parent_org_id` as metadata, no automatic inheritance.**

The `parent_org_id` column is added to `organizations` in Phase 1 as a nullable metadata field. It records the hierarchical relationship but has NO functional effect: no automatic access inheritance, no billing rollup, no policy cascade. Parent and subsidiary orgs remain independent for all authorization, billing, and storage purposes. Cross-org access between parent and subsidiary uses the same explicit participant/share grant mechanisms as any other cross-org collaboration (ADR-005, ADR-006). Features that leverage the hierarchy (rollup billing, hierarchical policy) are deferred to future phases.

### Rationale

Adding the `parent_org_id` column now establishes the data model without the complexity and risk of inheritance logic. This is a forward-compatible design: when hierarchical features are added in a future phase, the data is already in place. The no-inheritance default ensures that Phase 1 does not expand scope and that the authorization model remains simple and explicit (P4 — Permission-First Authorization; no implicit inherited access).

Option A was rejected because automatic inheritance adds significant complexity and risk to Phase 1, with unresolved design questions (override conflicts, circular references, transfer semantics). Option C was rejected because it defers a simple schema addition that would require a migration later — adding the nullable column now is low-cost and forward-compatible.

### Security Impact

- **Threats architecturally addressed:** None directly — this is a metadata-only addition. However, by explicitly NOT implementing automatic inheritance, we avoid the threat of unintended access cascading from a parent to a subsidiary (which would be a new cross-tenant access path).
- **Threats introduced:** None — `parent_org_id` is metadata only; no access, billing, or storage logic uses it.
- **Residual risk:** If a future phase implements inheritance incorrectly, it could create unintended cross-tenant access. Addressed by requiring a separate ADR for any inheritance feature and by the explicit no-inheritance default in Phase 1.

### Data Model Impact

New column: `organizations.parent_org_id UUID REFERENCES organizations(id)` (nullable). A CHECK constraint prevents self-reference (`parent_org_id != id`). No index is required initially (hierarchy traversal is deferred). No cascade behavior — deleting a parent org does not affect subsidiary orgs (subsidiaries' `parent_org_id` is set to NULL via `ON DELETE SET NULL`).

### API Impact

- Org creation API: accepts an optional `parent_org_id` (metadata only). The creating user must be an admin of the parent org to set this field (preventing arbitrary parent assignment).
- Org detail API: returns `parent_org_id` if set.
- No access, billing, or storage logic changes — `parent_org_id` is not consulted by any authorization, billing, or storage code.

### Worker Impact

None — the worker does not use org hierarchy.

### Storage Impact

None — storage paths use `org_id`, not `parent_org_id`.

### Billing Impact

None initially — billing is per-org (D-008). Rollup billing is deferred.

### Migration Impact

This is a Phase 1 migration (additive column). No backfill is required — existing orgs have `parent_org_id = NULL`. The column is nullable, so the migration is non-breaking.

### Testing Requirements

- Verify that `parent_org_id` can be set at org creation by a parent org admin.
- Verify that a non-admin cannot set `parent_org_id`.
- Verify that `parent_org_id` cannot be set to the org's own ID (self-reference prevention).
- Verify that `parent_org_id` does NOT grant the parent org access to the subsidiary's resources.
- Verify that `parent_org_id` does NOT roll up billing.
- Verify that deleting a parent org sets subsidiary `parent_org_id` to NULL.

### Rejected Alternatives

- Option A (hierarchy with automatic inheritance): excessive complexity and risk for Phase 1; unresolved design questions.
- Option C (no hierarchy at all): defers a low-cost, forward-compatible schema addition.

### Deferred Work

- Hierarchical access inheritance (parent accesses subsidiary resources): deferred to a future phase with a separate ADR.
- Billing rollup (parent sees aggregate subsidiary billing): deferred.
- Policy cascade (parent policy applies to subsidiaries): deferred.
- Hierarchy traversal utilities (e.g., "get all subsidiaries of a parent"): deferred.
- Multi-level hierarchy depth limits: deferred.

### Rollback Considerations

If rolled back, the `parent_org_id` column can be dropped. Since it is metadata only, dropping it has no functional impact.

### Raymond Approval Required

No — evidence is sufficient. The flat org model is verified. The decision (metadata-only, no inheritance) is the safe default and does not require approval. Any future decision to implement inheritance WILL require Raymond approval.

---

## ADR-012: Support Access and Impersonation — Time-Limited, Break-Glass, Tenant-Aware

**Status:** RECOMMENDED
**Stakeholder Approval:** PENDING RAYMOND APPROVAL
**Date:** 2026-07-11

### Context

SolarPro's current admin impersonation mechanism is documented in `app/api/admin/impersonate/route.ts`. A platform admin (via `requireAdminApi()`) can generate an impersonation token for any user. The token is a 128-character hex string (stored in `admin_impersonation_tokens`, created by Migration 008), with a 5-minute TTL and single-use enforcement via CAS (`SET used = true WHERE id = ? AND used = false`). When the token is redeemed, a JWT is created for the target user with `_impersonated: true` and `_adminId: row.admin_id`, set as a 1-hour session cookie.

The critical security gap: there is NO same-org validation. A platform admin can impersonate ANY user across ANY organization without verifying that the admin has a legitimate support relationship with that user's org. The impersonation is also not time-limited beyond the initial 1-hour session — once the JWT is created, the admin has full access as the target user for the full hour, with no break-glass expiration or revocation mechanism for the active session.

The Phase 0 Threat Model rates T-05 (impersonation cross-tenant) as CRITICAL: "Impersonation has no same-org validation — an admin can impersonate any user across any org." Additionally, T-06 (dev auth bypass) is rated HIGH, noting that the dev bypass (`lib/dev-auth.ts`) grants `super_admin` with `isFreePass: true` when `DEV_AUTH_BYPASS=true` and the `X-Dev-Auth: bypass` header is present.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `app/api/admin/impersonate/route.ts` (POST) | `requireAdminApi()` then creates token for target user — NO same-org validation |
| `lib/migrations/008_admin_activity_log.sql` | `admin_impersonation_tokens(id, admin_id, target_id, token VARCHAR(128) UNIQUE, used BOOLEAN, expires_at DEFAULT NOW() + 5 min)` |
| `app/api/admin/impersonate/route.ts` | Token regex `/^[0-9a-f]{96}$/` (96 hex chars = 48 bytes); JWT with `_impersonated: true, _adminId: row.admin_id`; 1-hour cookie |
| `lib/dev-auth.ts` | `getDevSessionUser()` returns `super_admin` with `isFreePass: true` when `DEV_AUTH_BYPASS=true` and `X-Dev-Auth: bypass` header |
| Phase 0 Threat Model (T-05) | "Impersonation cross-tenant — CRITICAL" |
| Phase 0 Threat Model (T-06) | "Dev auth bypass — HIGH" |
| `lib/permissions.ts` | `is_free_pass === true` grants full access; `hasPlatformAccess()` bypasses all checks for free pass |

### Options Considered

**Option A: Keep current impersonation, add same-org validation.** Require that the admin's org matches the target user's org before allowing impersonation. This fixes T-05 for org-scoped admins but does not address platform-level support (a platform super_admin needs to support any org). It also does not address the 1-hour unbounded session or the lack of break-glass revocation.

**Option B: Time-limited impersonation with tenant-aware scoping and break-glass revocation.** Impersonation is a break-glass operation with a tiered duration model: (1) the admin must specify a reason and a duration — Normal sessions: default 30 minutes, maximum 4 hours; Break-glass sessions: default 15 minutes, maximum 30 minutes; Extended sessions (>30 minutes) require customer approval; (2) the admin must be authorized to support the target user's org (platform super_admin can support any org; org-scoped admins can only impersonate within their org); (3) the impersonation session is time-limited and can be revoked at any time; (4) every impersonation action is fully audited with the admin's identity, the target's identity, the reason, and the duration; (5) the target user is notified (email) that their account was accessed by support. This satisfies P5 (platform authority and tenant authority are separate — platform super_admin can support any org, but the action is audited and notified) and P4 (permission-first — impersonation is an explicit, reason-coded, time-limited grant).

**Option C: Remove impersonation entirely, use read-only support dashboard.** Instead of impersonating users, support staff use a read-only dashboard that displays the user's data without creating a session. This is the most restrictive option but severely limits support's ability to reproduce user-reported issues (which often require interacting with the UI as the user).

### Decision

**Option B — Time-limited, tenant-aware, break-glass impersonation with revocation and notification.**

Impersonation is restructured as a formal break-glass operation with a tiered duration model. The admin specifies a reason and a duration according to the session type: Normal sessions have a default of 30 minutes and a maximum of 4 hours; Break-glass (emergency) sessions have a default of 15 minutes and a maximum of 30 minutes; Extended sessions exceeding 30 minutes require explicit customer approval. The session JWT includes `_impersonated: true`, `_adminId`, `_impersonationReason`, `_impersonationExpiresAt` (a hard expiry timestamp). The middleware checks `_impersonationExpiresAt` on every request and terminates the session if expired. The admin (or another platform admin) can revoke an active impersonation session at any time. The target user receives an email notification. Every impersonation session and every action within it is fully audited (D-013). The dev auth bypass (T-06) is additionally constrained: it is disabled in production (already verified in `lib/dev-auth.ts`), and Phase 0.5 recommends adding an explicit audit event when dev bypass is used in non-production environments.

### Rationale

Break-glass impersonation balances support effectiveness with security. The tiered duration model (Normal: 30 min default, 4 hr max; Break-glass: 15 min default, 30 min max; Extended >30 min requires customer approval) ensures that impersonation sessions do not persist indefinitely and that emergency access is short-lived. The reason requirement creates an auditable record of why support accessed the account. The email notification provides transparency to the affected user. The revocation mechanism allows immediate termination if misuse is detected. The tenant-aware scoping ensures that org-scoped admins cannot impersonate cross-tenant, while platform super_admins retain the ability to support any org (with full auditing).

This aligns with P5 (platform authority and tenant authority are separate — the scoping rules distinguish platform super_admin from org admin), P4 (permission-first — impersonation is an explicit, reason-coded grant), and P3 (default deny — no impersonation without explicit authorization and reason).

### Security Impact

- **Threats architecturally addressed:** T-05 (impersonation cross-tenant) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). The architecture specifies that org-scoped admins are restricted to their own org; platform super_admin impersonation is time-limited, reason-coded, notified, and audited — implementation is Phase 1 Gate 12. T-06 (dev auth bypass) — ARCHITECTURALLY ADDRESSED (PARTIALLY IMPLEMENTED). Dev auth bypass is already disabled in production; Phase 0.5 recommends audit logging for dev bypass usage in non-production — the audit logging recommendation is IMPLEMENTATION PENDING. T-08 (audit log no org context) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). Impersonation events are specified to be fully audited with org context (D-013) — requires the audit log schema extension (Gate 9).
- **Threats introduced:** The email notification system must be reliable — if notifications fail silently, users would not be informed of support access. Addressed by requiring notification delivery confirmation (or at minimum, logging the notification attempt). The revocation mechanism must be real-time — if revocation is delayed, a revoked session could continue operating. Addressed by middleware checking a revocation flag on every request.
- **Residual risk:** A platform super_admin with malicious intent could impersonate any user. The risk varies by session type: Normal sessions allow up to 4 hours; Break-glass sessions allow up to 30 minutes; Extended sessions exceeding 30 minutes require explicit customer approval. Addressed by: (1) the reason requirement and audit trail, (2) the email notification (deterrence and detection), (3) the tiered duration limits, (4) the revocation mechanism, and (5) regular review of impersonation audit logs by Raymond or a security officer.

### Data Model Impact

The `admin_impersonation_tokens` table is extended (or a new `impersonation_sessions` table is created) with: `reason TEXT`, `duration_minutes INT`, `expires_at TIMESTAMP` (hard session expiry), `revoked_at TIMESTAMP`, `revoked_by UUID`, `notification_sent BOOLEAN`, `notification_sent_at TIMESTAMP`. The session JWT gains `_impersonationExpiresAt` and `_impersonationReason` claims. A revocation check is added to the middleware.

### API Impact

- `POST /api/admin/impersonate`: requires `reason`, `duration_minutes`, and `session_type` (normal or break-glass) in the request body. Duration limits: Normal — default 30 min, max 240 min (4 hr); Break-glass — default 15 min, max 30 min; Extended (>30 min) requires a customer approval token. Validates tenant scoping: org-scoped admins can only impersonate users in their org; platform super_admin can impersonate any user. Creates the session with a hard expiry.
- New API: `POST /api/admin/impersonate/revoke` — revokes an active impersonation session (platform admin only).
- Middleware: checks `_impersonationExpiresAt` on every request; terminates session if expired. Checks a revocation flag (e.g., a Redis key or a DB lookup) on every request.
- Email notification: sent to the target user upon impersonation start.

### Worker Impact

No direct worker impact. The worker does not use impersonation.

### Storage Impact

None.

### Billing Impact

None — impersonation is a support operation, not a billing operation.

### Migration Impact

This is a Phase 2 migration (after orgs and roles exist). The `impersonation_sessions` table (or `admin_impersonation_tokens` extension) is additive. The middleware changes (expiry check, revocation check) are code changes, not schema changes. The existing `admin_impersonation_tokens` table is retained for backward compatibility during the transition.

### Testing Requirements

- Verify that an org-scoped admin CANNOT impersonate a user in a different org.
- Verify that a platform super_admin CAN impersonate a user in any org (with reason and duration).
- Verify that impersonation without a reason is rejected.
- Verify that impersonation with duration exceeding the session-type limit is rejected (Normal: >240 min rejected; Break-glass: >30 min rejected).
- Verify that the session expires at `_impersonationExpiresAt` even if the cookie is still valid.
- Verify that revocation terminates the session immediately (next request is denied).
- Verify that an email notification is sent to the target user.
- Verify that every impersonation action is audited with org context.
- Verify that dev auth bypass is disabled in production (existing test).
- Verify that dev auth bypass usage in non-production is audit-logged (new test).

### Rejected Alternatives

- Option A (current + same-org validation): does not address unbounded sessions, lack of revocation, or lack of notification.
- Option C (remove impersonation, read-only dashboard): severely limits support effectiveness for reproducing user-reported issues.

### Deferred Work

- Real-time impersonation monitoring (e.g., a live dashboard of active impersonation sessions): deferred.
- Automated anomaly detection (e.g., alerting if an admin impersonates more than N users per hour): deferred.
- User-initiated support grant (a user explicitly grants support access for a specified duration): deferred — the initial model is admin-initiated break-glass.

### Rollback Considerations

If rolled back, the `impersonation_sessions` table can be dropped and the middleware changes reverted. The existing `admin_impersonation_tokens` table and the original impersonation route would need to be restored. However, the security improvements (time-limited sessions, revocation, notification) should not be rolled back without an equivalent alternative.

### Raymond Approval Required

Yes — impersonation is a high-risk operation that affects tenant trust. Raymond must approve: (1) the tiered duration model (Normal: 30 min default, 4 hr max; Break-glass: 15 min default, 30 min max; Extended >30 min requires customer approval), (2) the notification policy (email to target user), (3) the revocation mechanism, (4) the audit log review cadence, and (5) the handling of the dev auth bypass in non-production environments (specifically, whether dev bypass should be further restricted or audit-logged).

---

## ADR-013: Audit Ledger Architecture — Tenant-Aware, Immutable, Per-Org Hash Chains

**Status:** RECOMMENDED
**Stakeholder Approval:** NOT REQUIRED
**Date:** 2026-07-11

### Context

SolarPro's current audit log (`lib/auditLog.ts`, created by Migration 100) is a hash-chained ledger with SHA-256 integrity verification. Each `AuditLogEntry` contains: `timestamp`, `category`, `action`, `actor_id`, `actor_email`, `actor_role`, `target_type`, `target_id`, `description`, `metadata`, `ip_address`, `user_agent`, `request_path`, `prev_hash`, `entry_hash`. The `writeAuditLog()` function computes a SHA-256 hash chain (`prev_hash` links to the previous entry's `entry_hash`), and `verifyAuditChain()` recomputes hashes to detect tampering.

The critical gap: the audit log has NO organization context. There is no `actor_organization_id` column and no `resource_owner_organization_id` column. This means that audit events cannot be filtered or grouped by tenant — a platform admin reviewing audit logs sees a flat stream of events with no way to isolate a specific org's activity. In a multi-tenant system, this makes tenant-specific compliance auditing impossible.

Additionally, the hash chain is global — all events across all orgs share a single chain. If one event in the chain is tampered with, the entire chain is broken, affecting all tenants. There is no per-org chain isolation.

The Phase 0 Threat Model rates T-08 (audit log no org context) as HIGH severity.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| `lib/auditLog.ts` (`AuditLogEntry`) | Fields: timestamp, category, action, actor_id, actor_email, actor_role, target_type, target_id, description, metadata, ip_address, user_agent, request_path, prev_hash, entry_hash — NO org columns |
| `lib/auditLog.ts` (`writeAuditLog`) | Computes SHA-256 hash chain; `prev_hash` links to previous entry globally |
| `lib/auditLog.ts` (`verifyAuditChain`) | Recomputes hashes to detect tampering — global chain |
| `lib/migrations/100_compliance_audit_mfa_consent.sql` | `CREATE TABLE audit_log(...)` — no `actor_organization_id` or `resource_owner_organization_id` columns |
| Phase 0 Threat Model (T-08) | "Audit log no org context — HIGH severity" |
| `lib/auditLog.ts` (convenience wrappers) | `auditAuth()`, `auditData()`, `auditAdmin()`, `auditSecurity()`, `auditCompliance()` — none pass org context |

### Options Considered

**Option A: Add org columns to existing `audit_log`, keep global hash chain.** Add `actor_organization_id` and `resource_owner_organization_id` columns to the existing `audit_log` table. The hash chain remains global. This is the simplest change — additive columns, no chain restructuring. However, the global chain means that a tampering event in one org's data breaks the chain for all orgs, and per-org chain verification is not possible.

**Option B: Add org columns and partition the hash chain per org.** Add `actor_organization_id` and `resource_owner_organization_id` columns. Restructure the hash chain so that each org has its own chain: `prev_hash` links to the previous entry FOR THE SAME ORG, not globally. Platform-level events (no org context) have their own "platform" chain. This enables per-org chain verification — tampering in Org A's chain does not affect Org B's chain. This satisfies P5 (platform authority and tenant authority are separate — platform events and tenant events are in separate chains) and P6 (revision-bound enterprise records — each org's audit chain is an independent, tamper-evident record).

**Option C: Separate audit tables per org (table-per-tenant).** Create a separate `audit_log_{orgId}` table for each org. This provides physical isolation but creates operational complexity (managing N tables, schema migrations across all tables, query complexity for cross-org analysis). This is excessive for the initial multi-tenant model.

### Decision

**Option B — Add org columns and partition the hash chain per org.**

The `audit_log` table gains `actor_organization_id UUID` and `resource_owner_organization_id UUID` columns (both nullable for platform-level events). The hash chain is partitioned by `actor_organization_id`: each event's `prev_hash` links to the previous event's `entry_hash` FOR THE SAME `actor_organization_id`. Platform-level events (where `actor_organization_id IS NULL`) form a separate "platform" chain. Chain verification (`verifyAuditChain`) accepts an optional `org_id` parameter and verifies only that org's chain. This enables per-org compliance auditing without affecting other tenants' chains.

### Rationale

Per-org hash chains provide tenant isolation for audit integrity: a tampering event in one org's chain is detectable without breaking other orgs' chains. This is critical for enterprise compliance, where each tenant may need to independently verify its own audit trail. The org columns enable tenant-scoped audit queries (e.g., "show all data-access events for Org A in the last 30 days").

This aligns with P5 (platform and tenant authority are separate — platform events and tenant events are in separate chains), P6 (revision-bound enterprise records — each org's chain is an independent, tamper-evident record), and P1 (organizations own business data — audit events are attributed to the org that owns the affected resource).

Option A was rejected because the global chain creates a cross-tenant integrity dependency. Option C was rejected for operational complexity.

### Security Impact

- **Threats architecturally addressed:** T-08 (audit log no org context) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). The architecture specifies that audit events carry org context, enabling tenant-scoped queries and per-org chain verification — the `actor_organization_id` and `resource_owner_organization_id` columns must be added in Phase 1 Gate 9. T-02 (admin global exposure) — ARCHITECTURALLY ADDRESSED (IMPLEMENTATION PENDING). Admin audit events are specified to be org-attributed, making cross-tenant admin activity visible and auditable per org — implementation requires the audit log schema extension (Gate 9) and org-scoped admin routes (Phase 2).
- **Threats introduced:** If the per-org chain partitioning is implemented incorrectly (e.g., `prev_hash` is computed across orgs instead of within an org), the chain integrity guarantee is weakened. Addressed by mandatory chain verification tests per org.
- **Residual risk:** Platform-level events (no org context) share a single platform chain. If the platform chain is tampered with, platform-level audit integrity is compromised. Addressed by the existing SHA-256 hash chain and by restricting platform-level events to platform admin actions (which are themselves audited and monitored).

### Data Model Impact

New columns on `audit_log`: `actor_organization_id UUID` (nullable — the org of the actor), `resource_owner_organization_id UUID` (nullable — the org that owns the affected resource). The `prev_hash` computation changes: instead of linking to the globally previous entry, it links to the previous entry with the same `actor_organization_id` (or the platform chain if NULL). The `writeAuditLog()` function is updated to query `SELECT entry_hash FROM audit_log WHERE actor_organization_id = ${orgId} ORDER BY timestamp DESC LIMIT 1` (or `WHERE actor_organization_id IS NULL` for platform events) to determine `prev_hash`. Index on `(actor_organization_id, timestamp)` to support chain traversal.

### API Impact

- All convenience wrappers (`auditAuth()`, `auditData()`, `auditAdmin()`, `auditSecurity()`, `auditCompliance()`) gain an `organizationId` parameter, sourced from the active org context (D-002) or from the resource's `organization_id`.
- New API: `GET /api/audit/org/{orgId}` — returns audit events for a specific org (org admin or platform super_admin only).
- New API: `GET /api/audit/verify/{orgId}` — verifies the hash chain for a specific org.
- The existing global audit query (if any) is updated to filter by org context.

### Worker Impact

The background worker (`worker/main.ts`) must include org context in its audit events. Currently, the worker has no tenant context (T-09). After this decision, the worker resolves the owning org from the resource's `organization_id` and includes it in audit events. This requires the worker to resolve org context per job (addressing T-09).

### Storage Impact

No direct storage impact. Audit logs are stored in the database, not in blob storage.

### Billing Impact

None — audit logging is a compliance function, not a billing function.

### Migration Impact

This is a Phase 1 migration (additive columns + chain logic change). The `actor_organization_id` and `resource_owner_organization_id` columns are nullable, so existing events retain `NULL` values (they are "pre-multi-tenant" events). New events populate the columns from the active org context. The chain logic change affects only new events — existing events' `prev_hash` values are preserved. A migration script backfills `actor_organization_id` for existing events where the actor's org can be determined (best-effort, per D-009 legacy migration principles — no guessing).

### Testing Requirements

- Verify that new audit events include `actor_organization_id` and `resource_owner_organization_id`.
- Verify that `prev_hash` links to the previous event for the SAME org (not globally).
- Verify that per-org chain verification (`verifyAuditChain(orgId)`) detects tampering in that org's chain.
- Verify that tampering in Org A's chain does NOT break Org B's chain verification.
- Verify that platform-level events (NULL org) form a separate chain.
- Verify that org-scoped audit queries return only that org's events.
- Verify that a non-admin org member cannot access the org's audit log.
- Verify that the worker includes org context in its audit events.

### Rejected Alternatives

- Option A (add org columns, keep global chain): cross-tenant integrity dependency; per-org verification not possible.
- Option C (table-per-tenant): excessive operational complexity for the initial model.

### Deferred Work

- Audit log retention policies (per-org retention durations): deferred.
- Audit log export (e.g., SIEM integration, CSV export for compliance): deferred.
- Real-time audit alerting (e.g., alert on suspicious admin actions): deferred.
- Audit log encryption at rest (beyond the hash chain): deferred — the hash chain provides tamper-evidence, not encryption.

### Rollback Considerations

If rolled back, the `actor_organization_id` and `resource_owner_organization_id` columns can be dropped. The chain logic would revert to global. However, events created with per-org chains would have `prev_hash` values that do not link correctly in a global chain — a rollback would require a chain rebuild or accepting a chain break at the rollback point.

### Raymond Approval Required

No — evidence is sufficient. The absence of org context in the audit log is verified in `lib/auditLog.ts` and Migration 100. The decision follows from P5 and P6. However, Raymond should review the backfill strategy for existing audit events (whether to attempt `actor_organization_id` backfill or leave them as NULL).

---

## ADR-014: Minimum Safe Implementation Sequence — 15 Entry Gates Before NEXT_ENTERPRISE_AUTHORITY_MIGRATION

**Status:** RECOMMENDED
**Stakeholder Approval:** PENDING RAYMOND APPROVAL
**Date:** 2026-07-11

### Context

The Phase 0.5 Architecture Decision Gate resolves 14 architecture decisions (D-01 through D-14, documented as ADR-001 through ADR-013 plus this ADR). Before any schema migration (NEXT_ENTERPRISE_AUTHORITY_MIGRATION) or production code implementation can begin, a minimum safe implementation sequence must be established to ensure that the foundational pieces are in place before dependent features are built.

The SolarPro codebase has 280 API routes, 136 files using `getUserFromRequest()`, 70 files using `requireAdminApi()`, 55 database tables across 101 migration files, and ZERO server actions. The migration from user-scoped to org-scoped access touches nearly every route. A phased, gated approach is essential to avoid introducing security regressions during the migration.

The Phase 0 Migration Plan and Implementation Roadmap outline a 6-phase strategy (R0–R7). This ADR defines the minimum safe implementation sequence for Phase 1 only — the foundational phase that establishes canonical orgs, memberships, active org context, role namespaces, authorization interfaces, and audit context.

### Current-State Evidence

| Source | Evidence |
|--------|----------|
| Phase 0 Migration Plan | 6-phase strategy (R0–R7) |
| Phase 0 Implementation Roadmap | 8 phases (R0–R7) with specific deliverables |
| Codebase metrics | 280 API routes, 136 files with `getUserFromRequest()`, 70 files with `requireAdminApi()`, 55 tables, 101 migrations, 0 server actions |
| `lib/auth.ts` | `getUserFromRequest()` in 136 files — the primary auth entry point that must be extended with org context |
| `lib/permissions.ts` | `hasPlatformAccess()` — the authorization function that must be extended with org-role checks |
| Phase 0 Threat Model | T-01 through T-20 — threats that must be mitigated in sequence, not all at once |

### Options Considered

**Option A: Big-bang migration — implement all 14 decisions in one phase.** Migrate all 280 routes, all 55 tables, and all auth/authorization code in a single phase. This is the fastest path to the end state but carries the highest risk: a single bug in the foundational layer (e.g., active org context resolution) would propagate to all 280 routes, and rolling back would be extremely difficult.

**Option B: Minimal viable multi-tenancy — implement only orgs and memberships, defer everything else.** Implement only D-01 (memberships) and D-02 (active org context). Defer all other decisions to future phases. This is the lowest-risk option but leaves the system in a half-migrated state where orgs exist but resources are still user-scoped, roles are still in a single namespace, and audit logs have no org context. This creates a window of inconsistency.

**Option C: Gated sequential implementation — 15 entry gates, each with explicit pass/fail criteria.** Define a sequence of 15 gates, each of which must pass its criteria before the next gate begins. The gates are ordered by dependency: foundational pieces (orgs, memberships, active org context) come first, followed by role namespaces, authorization interfaces, audit context, and finally the first resource ownership migration. NEXT_ENTERPRISE_AUTHORITY_MIGRATION (the first schema migration that adds org-level columns) is PROHIBITED until all 15 gates are passed. This balances risk (each gate is small and verifiable) with progress (the sequence reaches a consistent multi-tenant foundation).

### Decision

**Option C — Gated sequential implementation with 15 entry gates.**

Phase 1 implementation proceeds through 15 gates, each with explicit pass/fail criteria. No gate begins until the previous gate passes. NEXT_ENTERPRISE_AUTHORITY_MIGRATION is PROHIBITED until all 15 gates are passed and Raymond approves. The gates are:

**Gate 1: Canonical Organization Table.** Verify that the `organizations` table (Migration 016) is the canonical org table. No new org table is created. The `parent_org_id` column (D-011) is added. Pass criteria: `organizations` table exists with `parent_org_id` column; no duplicate org tables.

**Gate 2: Organization Members Junction Table.** Create the `organization_members` junction table (D-001). Pass criteria: table exists with `(user_id, org_id, role_id, joined_at)`; unique constraint on `(user_id, org_id)`; a user can belong to multiple orgs.

**Gate 3: Organization Roles Namespace.** Create the `org_roles` and `org_role_permissions` tables (D-004). Seed the four system roles (owner, admin, member, viewer) with default permissions. Pass criteria: tables exist; four system roles seeded; `users.role` (platform roles) is separate from `org_roles` (org roles).

**Gate 4: Active Organization Context Table.** Create the `user_active_org` table (D-002). Pass criteria: table exists with `(user_id, org_id, set_at)`; unique constraint on `user_id`; server-side resolution function exists.

**Gate 5: Active Org Context Resolution Function.** Implement `getActiveOrgId(userId)` that resolves the user's active org from `user_active_org`, falling back to the most recently joined org. Pass criteria: function returns a valid `org_id` or NULL; does NOT trust client input; is called by `getUserFromRequest()`.

**Gate 6: Extended Session/User Object.** Extend the session user object returned by `getUserFromRequest()` to include `active_org_id` and `org_role`. Pass criteria: `getUserFromRequest()` returns `{...user, active_org_id, org_role}`; the JWT is NOT modified (per D-002, active org is server-side, not in JWT); 136 files using `getUserFromRequest()` continue to function (backward compatible).

**Gate 7: Authorization Interface.** Implement `canAccessResource(actor, resource)` — the centralized authorization function that checks: (1) platform role (super_admin bypass), (2) org role for the resource's owning org, (3) participant grant (D-005), (4) share grant (D-006). Pass criteria: function exists; returns boolean; does not trust client input; unit tests pass for all permission combinations.

**Gate 8: Org-Scoped Query Helper.** Implement `getOrgScopedQuery(orgId, tableName)` — a helper that adds `WHERE organization_id = ${orgId}` to a query. Pass criteria: helper exists; unit tests pass; does not allow bypass via client-supplied orgId.

**Gate 9: Audit Log Org Context.** Add `actor_organization_id` and `resource_owner_organization_id` columns to `audit_log` (D-013). Update `writeAuditLog()` to accept and populate org context. Update convenience wrappers. Pass criteria: columns exist (nullable); new events include org context; per-org chain logic is implemented; `verifyAuditChain(orgId)` works.

**Gate 10: Tenant-Aware Audit Query API.** Implement `GET /api/audit/org/{orgId}` (org admin or platform super_admin only). Pass criteria: API exists; returns only the specified org's events; non-admins are denied; cross-org access is denied for org-scoped admins.

**Gate 11: Dev Auth Bypass Audit.** Add an audit event when dev auth bypass is used in non-production (D-012). Pass criteria: dev bypass in non-production writes an audit event; dev bypass in production is still disabled (existing behavior preserved).

**Gate 12: Impersonation Hardening.** Implement time-limited, reason-coded, tenant-aware impersonation with revocation and notification (D-012). Pass criteria: org-scoped admins cannot impersonate cross-tenant; platform super_admin can impersonate any user with reason + duration; sessions expire at `_impersonationExpiresAt`; revocation works; email notification is sent; all actions are audited.

**Gate 13: Legacy Ownership Backfill Script.** Implement the backfill script (D-009): assign existing resources to orgs based on `org_id` first, personal org fallback, ambiguity queue. Pass criteria: script runs in dry-run mode; reports the number of resources assigned to existing orgs, the number of personal orgs created, and the number of ambiguity queue entries; does NOT execute changes in dry-run mode.

**Gate 14: Ambiguity Queue Admin API.** Implement `GET /api/admin/migration/ambiguity-queue` and `POST /api/admin/migration/merge-orgs` (D-009). Pass criteria: APIs exist; merge is platform-admin only; merge is audited; merge correctly reassigns resources.

**Gate 15: Phase 1 Entry Gate Verification.** Run the full Phase 1 test suite (from the Authorization Test Matrix). Verify all 121 test cases pass. Verify no production routes are broken (all 280 routes respond correctly). Verify MFA code, tests, evidence, and acceptance artifacts are untouched. Pass criteria: all tests pass; no regressions; Raymond approves NEXT_ENTERPRISE_AUTHORITY_MIGRATION.

### Rationale

The 15-gate sequence ensures that each foundational piece is in place and verified before the next piece is built. This prevents the "big-bang" failure mode where a single bug propagates across all 280 routes. Each gate has explicit pass/fail criteria, enabling rollback at the gate level rather than at the phase level. The prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION until all gates pass ensures that no schema changes (org-level columns on resource tables) are made until the authorization infrastructure is ready to enforce them.

This aligns with P3 (Default Deny — no migration proceeds without verification), P4 (Permission-First Authorization — the authorization interface is built before resource migrations), and P7 (Hybrid Isolation — the isolation infrastructure is built before it is relied upon).

### Security Impact

- **Threats architecturally addressed:** D-14 is a **sequencing decision, not a mitigation decision**. It does not itself address any threat. It sequences the implementation of D-01 through D-13 across 15 gates, ensuring that each architecturally-addressed threat is implemented and verified in the appropriate gate before the next gate proceeds. The sequence prevents the introduction of new threats during migration (e.g., if resource ownership migration proceeded before the authorization interface was ready, resources would be org-owned but access checks would still be user-scoped, creating a window of vulnerability). Of the 20 threats: T-14 (SSO), T-19 (soft-delete consistency), and T-20 (per-org pricing) are DEFERRED and are NOT addressed by any gate. The remaining 17 threats (T-01 through T-13, T-15 through T-18) are ARCHITECTURALLY ADDRESSED by D-01 through D-13 and sequenced across the gates.
- **Threats introduced:** None — the gates are designed to be additive and non-breaking. Each gate's pass criteria include "no regressions" verification.
- **Residual risk:** The backfill script (Gate 13) and the ambiguity queue (Gate 14) involve data ownership changes. Even with dry-run verification, the live backfill carries a small risk of incorrect assignment. Addressed by the `org_id`-first strategy (D-009) and by Raymond's approval before execution.

### Data Model Impact

The 15 gates collectively define the Phase 1 schema additions: `organization_members` (Gate 2), `org_roles` + `org_role_permissions` (Gate 3), `user_active_org` (Gate 4), `audit_log` column additions (Gate 9), `impersonation_sessions` or `admin_impersonation_tokens` extension (Gate 12), `org_merge_suggestions` (Gate 14). The `organizations.parent_org_id` column (Gate 1) and the first resource ownership columns (`projects.organization_id`, etc.) are NOT added until after Gate 15 — they are NEXT_ENTERPRISE_AUTHORITY_MIGRATION, which is prohibited until all gates pass.

### API Impact

The 15 gates introduce new APIs: active org context resolution (Gate 5), authorization interface (Gate 7), org-scoped query helper (Gate 8), tenant-aware audit query (Gate 10), ambiguity queue admin APIs (Gate 14). Existing APIs are extended (Gate 6: `getUserFromRequest()` returns org context) but not broken. No existing route is migrated to org-scoped access until after Gate 15.

### Worker Impact

The worker is updated in Gate 9 to include org context in audit events. No other worker changes in Phase 1.

### Storage Impact

No storage changes in Phase 1. File storage org-prefixing (D-007) is a Phase 2 migration, after Phase 1 gates are passed.

### Billing Impact

No billing changes in Phase 1. Org-level billing (D-008) is a Phase 2 migration.

### Migration Impact

This ADR IS the migration impact decision. It defines the sequence and the prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION. The schema migrations for Gates 1–14 are additive (new tables, new nullable columns) and do not modify existing tables destructively. NEXT_ENTERPRISE_AUTHORITY_MIGRATION (the first resource ownership migration) is the first migration that modifies existing resource tables, and it is prohibited until all 15 gates pass and Raymond approves.

### Testing Requirements

- Each gate has its own pass/fail criteria (listed above).
- Gate 15 runs the full Authorization Test Matrix (121 test cases) and verifies no regressions across all 280 routes.
- MFA tests, evidence, and acceptance artifacts must remain untouched (verified by checksum comparison before and after Phase 1).
- Phase 0 documents must remain unchanged (except for verified factual corrections).

### Rejected Alternatives

- Option A (big-bang migration): highest risk; a single foundational bug propagates to all 280 routes; rollback is extremely difficult.
- Option B (minimal viable, defer everything else): leaves the system in a half-migrated, inconsistent state; creates a window of vulnerability.

### Deferred Work

- Phase 2 gates (resource ownership migration, file storage migration, billing migration): deferred — defined in the Phase 1 Implementation Spec's "Phase 2 Preview" section, but not part of Phase 1.
- Phase 3+ gates (ownership transfer, parent/subsidiary inheritance, resource share grants): deferred to future phases.

### Rollback Considerations

Each gate is independently rollable. If a gate fails, the schema additions and code changes for that gate can be reverted. The prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION ensures that no resource ownership changes have occurred during Phase 1, so a rollback of Phase 1 does not affect existing resource ownership — resources remain user-scoped until NEXT_ENTERPRISE_AUTHORITY_MIGRATION (which is post-Phase-1).

### Raymond Approval Required

Yes — Raymond must approve: (1) the 15-gate sequence, (2) the pass/fail criteria for each gate, (3) the prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION until all gates pass, (4) the execution of the backfill script (Gate 13, live mode), and (5) the transition from Phase 1 to Phase 2 (NEXT_ENTERPRISE_AUTHORITY_MIGRATION). Without Raymond's approval at Gate 15, NEXT_ENTERPRISE_AUTHORITY_MIGRATION is PROHIBITED and Phase 2 cannot begin.

---

## Document Footer

**ADR Count:** 14 (ADR-001 through ADR-014)
**All ADRs Architecture Status:** RECOMMENDED — all 14 ADRs have complete architecture analysis with verified codebase evidence; the recommended option for each is documented with options analysis, rationale, and impact assessment.
**Raymond Approval Required (Stakeholder Approval: PENDING RAYMOND APPROVAL):** ADR-008 (billing migration), ADR-009 (backfill strategy), ADR-010 (ownership transfer), ADR-012 (impersonation), ADR-014 (implementation sequence and NEXT_ENTERPRISE_AUTHORITY_MIGRATION prohibition)
**Raymond Approval Not Required (Stakeholder Approval: NOT REQUIRED):** ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-006, ADR-007, ADR-011, ADR-013

> **Status Model Clarification:** Architecture Status (RECOMMENDED) means the architecture analysis is complete and a recommendation has been made based on sufficient codebase evidence and governing principles. Stakeholder Approval Status is separate: PENDING RAYMOND APPROVAL means Raymond must explicitly approve the decision before implementation proceeds; NOT REQUIRED means the decision is settled by evidence and principles without requiring stakeholder sign-off. No ADR has a status of APPROVED (by stakeholder) at this time — all are RECOMMENDED pending Raymond's review for the 5 decisions that require it. See `ENTERPRISE-MULTI-TENANT-RAYMOND-APPROVAL-PACKET.md` for the formal approval packet.

**Evidence Base:** All ADRs cite verified current-state evidence from the SolarPro codebase (source files, migrations, Phase 0 documents). No assumptions or hallucinated data.

**Governing Principles Applied:** P1 (Organizations Own Business Data), P2 (Collaboration Does Not Change Ownership), P3 (Default Deny), P4 (Permission-First Authorization), P5 (Platform Authority and Tenant Authority Are Separate), P6 (Revision-Bound Enterprise Records), P7 (Hybrid Isolation).
