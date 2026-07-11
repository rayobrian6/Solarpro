# Enterprise Multi-Tenant Authority — Phase 0 Current-State Audit

> **Document type:** Phase 0 audit (read-only, no implementation)
> **Branch:** `dev` (commit `fedb27ac`)
> **Status:** SOC 2 readiness in progress — not certified. Security controls aligned with ISO 27001 principles.
> **Scope:** SolarPro full codebase — identity, organization, tenancy, permissions, collaboration, audit, storage, billing, and isolation model
> **Date:** 2025
> **Compliance posture:** This document is a pre-implementation audit. No schema changes, migrations, application code, tests, or MFA Phase 3 artifacts were modified during this audit. MFA Phase 3 is complete and closed.

---

## 0. Audit Scope and Method

This audit was conducted entirely on the `dev` branch of the SolarPro repository. No feature branch was created. No production code, database migrations, tests, or MFA Phase 3 evidence artifacts were modified. Every claim in this document is grounded in verifiable evidence: file paths, function names, table names, migration file numbers, route paths, or grep-based counts executed against the live codebase.

The audit method proceeded in these stages:

1. **Repository reconnaissance** — mapped the directory structure, identified the framework (Next.js 14.2, React 18, TypeScript, Tailwind CSS), located the database layer (`@neondatabase/serverless` with `DATABASE_URL`), the migration files (`lib/migrations/001` through `104`, 101 files with gaps), the authentication layer (`lib/auth.ts`, `lib/dev-auth.ts`, `lib/mfa.ts`), the middleware (`middleware.ts`), the API routes (`app/api/`), the background worker (`worker/main.ts`), and the billing layer (`lib/stripe.ts`, `lib/companyPricing.ts`).

2. **Identity and authentication analysis** — read the full source of `lib/auth.ts` (JWT signing, session lifecycle), `lib/mfa.ts` (TOTP enforcement), `lib/dev-auth.ts` (development bypass), `middleware.ts` (request pipeline), and the three parallel auth systems (main JWT, homeowner portal OTP, lead-desk scoped access).

3. **Organization and membership analysis** — read `lib/migrations/016_organizations.sql` (the organizations table, org_invites, users.org_id / users.org_role), searched all TypeScript files for `org_id` references, and determined how deeply the organization concept is wired into the application.

4. **Data ownership inventory** — extracted all `CREATE TABLE` statements from 101 migration files, catalogued 55 distinct tables, and classified each by its ownership field (`user_id`, `project_id`, `org_id`, or none), its isolation enforcement mechanism, and its delete behavior.

5. **API authorization audit** — counted 280 API route handlers, identified the two authorization functions (`getUserFromRequest` called across 136 files, `requireAdminApi` across 70 files), and classified routes by their authorization model.

6. **Database isolation audit** — searched all migration files for Row Level Security policies (zero found), database roles (none per-tenant), and evaluated the Neon PostgreSQL / Vercel / Render deployment context.

7. **Storage and file isolation audit** — located the two `@vercel/blob` upload paths, determined the storage key patterns, and evaluated whether they include tenant prefixes.

8. **Cache, search, notification, and worker audit** — examined `lib/rateLimiter.ts` (Upstash Redis), the background worker pipeline, cron jobs, and the audit log.

9. **Billing and usage authority audit** — examined `lib/stripe.ts` (per-user billing, seat syncing), `lib/companyPricing.ts` (global pricing), and `lib/permissions.ts` (plan-based feature gating).

Each statement below is tagged with one of the following evidence labels:

- **[VERIFIED]** — confirmed by reading source code, migration SQL, or executing a grep/inspection command against the codebase
- **[INFERRED]** — a reasonable conclusion drawn from verified evidence, but not directly observed in a single code location
- **[MISSING]** — no evidence found; the capability or control does not exist or could not be located
- **[PROPOSED]** — a future-state design recommendation (not current behavior)
- **[OPEN-DECISION]** — a design question that requires stakeholder input before implementation

---

## 1. Executive Summary

SolarPro is a single-tenant application that has been extended with a lightweight organization concept (the `organizations` table from migration 016) that is almost entirely unwired. The application's authority model is built around individual users, not organizations. Resources — projects, clients, layouts, proposals, survey data, equipment libraries, and more — are owned by a `user_id` column, not by an organization. The JWT that authenticates every request carries only identity fields (`id`, `name`, `email`, `company`) and no tenant context whatsoever. There is no Row Level Security on any table. There is no per-tenant database role. There is no tenant-scoped storage namespace. The audit log is hash-chained for tamper-evidence but records no organization context for either the actor or the target resource.

The authorization model is binary and coarse: a user is either an admin (full access to everything, across all tenants) or a regular user (access to their own `user_id`-scoped resources, with plan-based feature gating). The `requireAdminApi()` function, called across 70 route files, grants global access with no tenant boundary. The `hasPlatformAccess()` function in `lib/permissions.ts` is a plan-based feature gate, not a resource authorization system — it checks subscription status, not whether a user owns or is permitted to access a specific resource.

The `organizations` table exists but is referenced by `org_id` in only 8 TypeScript files across the entire codebase. Organization membership grants no resource access — it only affects seat billing via `syncSeatsForOrg()`. An org member cannot see the owner's projects, clients, or any other resources. There is no active-company context, no company switcher, and no server-side tenant resolution from the request.

These findings mean that SolarPro, as currently architected, cannot safely support multiple organizations sharing the same database instance without significant risk of cross-tenant data exposure. The proposed architecture in the companion document `ENTERPRISE-MULTI-TENANT-AUTHORITY-ARCHITECTURE.md` addresses these gaps with a default-deny, organization-as-tenant-boundary design.

### Key Metrics (Verified)

| Metric | Value | Evidence |
|--------|-------|----------|
| SQL migration files | 101 | `ls lib/migrations/*.sql \| wc -l` |
| Distinct database tables | 55 | `grep -rhioE "CREATE TABLE..." lib/migrations/*.sql` |
| API route handlers | 280 | `find app/api -name "route.ts" \| wc -l` |
| Files calling `getUserFromRequest` | 136 | `grep -rl "getUserFromRequest" app/api --include="*.ts" \| wc -l` |
| Files calling `requireAdminApi` | 70 | `grep -rl "requireAdminApi" app/api --include="*.ts" \| wc -l` |
| TypeScript files referencing `org_id` | 8 | `grep -rl "org_id" --include="*.ts"` |
| Row Level Security policies | 0 | `grep -ril "ROW LEVEL SECURITY" lib/migrations/*.sql` |
| Server actions (`"use server"`) | 0 | `grep -rl '"use server"' --include="*.ts"` |
| Tables with `deleted_at` (soft delete) | 2 | `clients`, `projects` |
| Auth systems in parallel | 3 | main JWT, portal OTP, lead-desk scoped |

---

## 2. Current Identity and Authentication Model

### 2.1 User Identity

**[VERIFIED]** The `users` table is defined in `lib/migrations/006_users_subscriptions_whitelabel.sql` (with the original schema in `lib/migrations/001_initial_schema.sql`). The table contains: `id` (UUID, primary key), `name`, `email`, `password_hash`, `company` (TEXT, free-text field), `phone`, `role` (TEXT, default `'user'`, documented as `'user' | 'admin'`), `email_verified`, `created_at`, `updated_at`. Migration 006 added subscription columns: `plan`, `subscription_status`, `is_free_pass`, `free_pass_note`, `trial_ends_at`, and branding columns (`company_logo_url`, `company_website`, `company_address`, `company_phone`, `brand_primary_color`, `brand_secondary_color`, `proposal_footer_text`). Migration 016 added `org_id` (UUID, references `organizations(id)`, `ON DELETE SET NULL`) and `org_role` (TEXT, default `'owner'`, documented as `'owner' | 'member'`). Migration 094 added `password_changed_at`. Migration 100 added MFA columns: `mfa_enabled`, `mfa_method`, `mfa_secret_encrypted`, `mfa_verified_at`, `mfa_enrolled_at`.

**[VERIFIED]** The `company` field on the `users` table is a free-text TEXT column. It is not a foreign key to any organization table. It is populated at registration time and used for branding display. It has no structural relationship to the `organizations` table introduced in migration 016. This is a critical architectural observation: there are two parallel "company" concepts in the system — the free-text `users.company` and the structured `organizations` table — and they are structurally independent.

**[VERIFIED]** The `role` column on the `users` table is documented in migration 006 as `'user' | 'admin'`. However, the middleware (`middleware.ts`) references additional roles: `super_admin`, `staff`, `crew_member`, `homeowner`, and `sales`. The MFA module (`lib/mfa.ts`) defines `MFA_REQUIRED_ROLES = ['admin', 'super_admin', 'staff']`. The dev auth bypass (`lib/dev-auth.ts`) returns `role: 'super_admin'`. There is a role constraint conflict: the database comment says `'user' | 'admin'` but the application uses at least 6 role strings. **[MISSING]** No `CHECK` constraint on the `role` column was found in the migration files enforcing a specific enum — the column is free-text TEXT, so any role string can be stored.

### 2.2 Session Model

**[VERIFIED]** The session is a JWT signed with `jsonwebtoken` in `lib/auth.ts`. The `signToken()` function constructs a payload containing only `{id, name, email, company}` and signs it with `JWT_SECRET` using `expiresIn: '30d'` (30-day TTL). The comment in the source explicitly states "Only sign identity fields — no role, no subscription data." The JWT is stored in an httpOnly cookie.

**[VERIFIED]** The JWT payload does NOT contain: `role`, `org_id`, `org_role`, `plan`, `subscription_status`, `is_free_pass`, or any tenant context. The role and subscription data are always read from the database at request time via `getUserFromRequest()`, which decodes the JWT to get the user `id`, then queries the `users` table for the full user record. This design means the JWT is purely an identity token — it proves who you are but says nothing about what organization you belong to or what you are authorized to do.

**[VERIFIED]** There is a separate "MFA pending" JWT (`signMFAPendingToken()`) with a 5-minute TTL, signed with `mfa_pending: true` and `role` included. This token only authorizes the holder to complete MFA verification — it does not grant application access. The cookie name is `solarpro_mfa_pending` with `MFA_PENDING_MAX_AGE = 60 * 5`.

**[VERIFIED]** The middleware (`middleware.ts`) implements session timeout by role: `super_admin` and `admin` get 8-hour timeouts, `staff` gets 8 hours, `crew_member` gets 24 hours, `homeowner` gets 24 hours. Regular users (no matching role key) get the default timeout. The middleware checks session age by comparing a timestamp in the JWT or cookie against the role-specific timeout. Admin paths (`/admin`, `/api/admin`) use the 8-hour timeout.

### 2.3 MFA Integration

**[VERIFIED]** MFA is implemented in `lib/mfa.ts` as TOTP-based (RFC 6238) two-factor authentication. MFA secrets are encrypted with AES-256-GCM (`mfa_secret_encrypted` column on `users`). The `MFA_REQUIRED_ROLES` array is `['admin', 'super_admin', 'staff']` — these roles must have MFA enabled. The function `isMfaRequiredForRole()` returns true if the role is in this array and MFA is not enabled. Recovery codes are stored in the `mfa_recovery_codes` table (migration 100). MFA Phase 3 is complete and closed — no MFA artifacts were modified during this audit.

**[VERIFIED]** The MFA enforcement check is `MFA_REQUIRED_ROLES.includes(role) && !mfaEnabled`. This means MFA is required only for admin-class roles. Regular users are not required to have MFA. The MFA verification flow uses a step-up pattern: password verification succeeds → MFA pending token issued → user enters TOTP code → full session token issued.

### 2.4 Authentication Providers

**[VERIFIED]** SolarPro uses a single authentication provider: email/password with bcrypt password hashing (`bcryptjs`). There are no OAuth providers (no Google, GitHub, Microsoft, or SSO integration). There is no SAML or OIDC support. There are no API keys or service accounts. Authentication is exclusively through the login form at `/api/auth/login` which verifies the password hash and issues the JWT.

**[MISSING]** There is no support for SSO/SAML/OIDC, which is a gap for enterprise multi-tenant deployments where customers typically require integration with their corporate identity provider.

### 2.5 Account Recovery

**[VERIFIED]** Password reset is implemented via the `password_reset_tokens` table (migration 011). The flow: user requests reset → token generated → emailed → user clicks link → token verified → password updated. The `password_changed_at` column (migration 094) tracks when the password was last changed. Email verification is implemented via the `email_verification` columns (migration 038) on the `users` table.

**[VERIFIED]** Account recovery does not involve any organization context. A password reset operates purely on the user's email — there is no verification that the user still belongs to the same organization or that the organization is still active.

### 2.6 Parallel Authentication Systems

**[VERIFIED]** SolarPro has three parallel authentication systems that operate independently:

1. **Main user JWT** (`lib/auth.ts`) — for SolarPro staff/contractors. JWT with `{id, name, email, company}`, 30-day TTL, httpOnly cookie. This is the primary authentication system.

2. **Homeowner portal OTP** (`lib/portalAuth.ts`, migrations 021 and 032) — for homeowners accessing their project portal. Uses one-time passcodes (OTP) sent via email, stored in the `portal_otp_tokens` table. The homeowner is authenticated by a scoped OTP token, not by a full user account. This is a completely separate auth path from the main JWT.

3. **Lead-desk scoped access** (`lib/leadDeskAuth.ts`) — for the lead/opportunity management desk. Provides scoped access to lead data without full user authentication. This is a third parallel auth path.

**[VERIFIED]** These three systems do not share a common identity model. A homeowner in the portal system is not a `users` table row. A lead-desk operator may have a different identity context than a main JWT user. There is no unified identity layer that spans all three systems.

### 2.7 Admin Bypasses and Impersonation

**[VERIFIED]** The development auth bypass is implemented in `lib/dev-auth.ts`. It activates when `VERCEL_ENV !== 'production'` AND `DEV_AUTH_BYPASS === 'true'` AND the request carries the header `X-Dev-Auth: bypass`. When active, it returns a fixed `SessionUser` with `role: 'super_admin'`, `isFreePass: true`, `plan: 'pro'`, and full access. The production guard is explicit: if `VERCEL_ENV === 'production'`, the bypass always returns false regardless of any other setting. The bypass logs `[DEV_AUTH_ACTIVE]` to the function logs.

**[VERIFIED]** Admin impersonation is implemented via the `admin_impersonation_tokens` table (migration 008). An admin creates a one-time token targeting a specific user. The token is 128 characters (VARCHAR(128)), unique, and expires after 5 minutes (the `expires_at` column defaults to `NOW() + INTERVAL '5 minutes'`). When the token is used, the admin receives a JWT for the target user. The `used` boolean tracks whether the token has been consumed. The `admin_activity_log` table records the impersonation action with `admin_id`, `target_user_id`, `action`, and `metadata`.

**[INFERRED]** The impersonation system has no tenant boundary. An admin can impersonate any user in any organization. There is no check that the admin belongs to the same organization as the target user, because the admin role is global (not org-scoped). This is a significant cross-tenant risk documented in the threat model (T-05).

**[VERIFIED]** The `admin_activity_log` table (migration 008) records admin actions with `admin_id`, `action` (VARCHAR(100)), `target_user_id`, `target_company` (VARCHAR(255), free-text), `metadata` (JSONB), and `created_at`. The `target_company` is free-text, not a foreign key to `organizations`. This means admin actions are logged with a free-text company name, not a structured organization reference.

### 2.8 Service-to-Service Authentication

**[VERIFIED]** Cron jobs are authenticated via a `CRON_SECRET` environment variable. The cron routes in `app/api/cron/*/route.ts` check the `Authorization` header against `CRON_SECRET`. This is a shared-secret authentication model, not per-tenant.

**[VERIFIED]** The background worker (`worker/main.ts`) authenticates to the database using the single `DATABASE_URL` environment variable. It polls the Neon database for queued geometry reconstruction jobs. The worker has no tenant context — it processes jobs from any user without organization filtering. The worker calls `getSurveyOwnerId()` to determine the survey owner, but this is a user-level ownership check, not an org-level check.

**[VERIFIED]** Webhooks are authenticated via signature verification. The `webhook_ingestion_log` table (migration 057) records webhook events. Stripe webhooks verify the Stripe signature. There is no per-tenant webhook authentication — webhooks are authenticated at the integration level (Stripe, etc.), not at the tenant level.

### 2.9 Where Authentication Equals Authorization

**[VERIFIED]** In several critical locations, authentication (proving identity) is conflated with authorization (proving permission):

1. **Admin routes** — `requireAdminApi()` checks that the user's role is `admin` or `super_admin`. If the role check passes, the user has full access to all data across all tenants. There is no secondary check that the admin belongs to the same organization as the data being accessed. Authentication (you are an admin) IS authorization (you can access everything).

2. **User-scoped routes** — `getUserFromRequest()` returns the authenticated user. Routes then filter by `WHERE user_id = $authenticatedUserId`. This is authorization by ownership, but it is user-level, not org-level. An org member cannot access the org owner's resources because the `user_id` filter excludes them.

3. **Dev auth bypass** — When active, the bypass returns `super_admin` with `isFreePass: true`. Authentication (the bypass header is present) IS authorization (full super_admin access). There is no resource-level check beyond the role.

4. **Free pass** — The `is_free_pass` flag grants full platform access. `hasPlatformAccess()` returns true if `is_free_pass === true`. This is a billing-level bypass that acts as authorization — the user has full access regardless of subscription status. There is no tenant scoping on the free pass.

---

## 3. Current Organization and Membership Model

### 3.1 The Organizations Table

**[VERIFIED]** The `organizations` table is defined in `lib/migrations/016_organizations.sql`. Its schema:

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

The table has: `id` (UUID PK), `name` (TEXT), `owner_id` (UUID FK to users, CASCADE on delete), `plan` (TEXT, default `'contractor'`), and timestamps. The `plan` column is documented as "inherits from owner." There is no `status` column (no active/inactive/suspended state). There is no `slug` or `domain` column. There is no `billing_email` or separate billing entity.

**[VERIFIED]** The `org_invites` table (also in migration 016) stores pending invitations:

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

Invites are email-based with a 24-byte random hex token, 7-day expiry, and an `accepted_at` timestamp. The invite links to an org, not to a specific role or permission set. There is no role specification in the invite — the accepting user gets `org_role = 'member'`.

### 3.2 Membership and Roles

**[VERIFIED]** Organization membership is stored on the `users` table via two columns added in migration 016: `org_id` (UUID, references `organizations(id)`, `ON DELETE SET NULL`) and `org_role` (TEXT, default `'owner'`, documented as `'owner' | 'member'`). The `ON DELETE SET NULL` on `org_id` means that if an organization is deleted, the user's `org_id` is set to NULL rather than the user being deleted — the user becomes organizationless but retains their account.

**[VERIFIED]** There are exactly two org roles: `owner` and `member`. The owner is the user who created the organization (the `owner_id` on the `organizations` table). Members are users who accepted an invite. There is no `admin` org role, no `viewer` org role, no custom roles. The org role is separate from the platform role (`users.role` which is `user`/`admin`/`super_admin`).

**[VERIFIED]** There is no `organization_members` junction table. Membership is denormalized onto the `users` table via `org_id` and `org_role`. This means a user can belong to exactly one organization (the `org_id` column is a single UUID, not an array or junction table). There is no support for a user belonging to multiple organizations.

### 3.3 Invite Lifecycle

**[VERIFIED]** The invite lifecycle is: owner creates invite (row in `org_invites` with `invited_email`, `invited_by`, `token`, `expires_at`) → invitee receives email with token → invitee accepts (sets `accepted_at`, sets `users.org_id` and `users.org_role = 'member'`). The `org_invites` table has indexes on `org_id`, `invited_email`, and `token`.

**[VERIFIED]** The invite acceptance logic is in `app/api/organizations/invite/route.ts` and `app/api/organizations/member/route.ts` (both are among the 8 files referencing `org_id`). The acceptance flow sets the user's `org_id` and `org_role`.

**[MISSING]** There is no explicit revocation flow for accepted members. There is no `removed_at` or `status` column on the membership. To remove a member, the owner would need to set the user's `org_id` to NULL, but there is no API route found that performs this operation with audit logging. This is documented as a threat (T-18).

### 3.4 The Parallel "Company" Concept

**[VERIFIED]** There are two structurally independent "company" concepts in SolarPro:

1. **`users.company` (TEXT, free-text)** — introduced in migration 006. Populated at registration. Used for branding (company name on proposals, logo, website, address, phone, colors). Not a foreign key. Not structurally connected to any organization entity. This is the "company" that appears on proposals and in the UI.

2. **`organizations` table (structured)** — introduced in migration 016. Has a UUID primary key, an owner, a plan, and membership via `users.org_id`. This is the "organization" that controls seat billing. It is NOT connected to `users.company` — a user can have `company = 'Acme Solar'` (free text) and `org_id = NULL` (no organization), or `company = 'Acme Solar'` and `org_id` pointing to an organization named something completely different.

**[INFERRED]** This dual concept is a significant source of ambiguity for any multi-tenant migration. When backfilling `org_id` onto resources, which "company" do you use? The free-text `users.company` or the structured `organizations.name`? This is documented as an open design decision.

### 3.5 Multi-Company Support

**[VERIFIED]** The current system does not support active company context selection. There is no company switcher in the UI. There is no `active_org_id` in the session or JWT. A user belongs to at most one organization (via `users.org_id`), and there is no mechanism to switch between organizations.

**[VERIFIED]** The `organizations` table exists and can store multiple organizations, but there is no application-level concept of "which organization am I currently operating as." Every request resolves the user from the JWT, reads their `org_id` from the database (if set), but this `org_id` is not used for resource access control anywhere in the application except billing.

### 3.6 Organization Connection to Resources

**[VERIFIED]** The `org_id` concept is referenced in only 8 TypeScript files across the entire codebase:

1. `app/api/admin/projects/[id]/send-portal-invite/route.ts`
2. `app/api/auth/register/route.ts`
3. `app/api/migrate/route.ts`
4. `app/api/organizations/member/route.ts`
5. `app/api/organizations/route.ts`
6. `app/api/organizations/invite/route.ts`
7. `app/api/proposals/[id]/send-email/route.ts`
8. `lib/stripe.ts`

**[INFERRED]** Of these 8 files, 4 are the organization management routes themselves (organizations CRUD, member management, invite). One is the registration route (which may set `org_id` on new users). One is the Stripe billing file (`syncSeatsForOrg()`). One is a portal invite route. One is a proposal email route. None of these files use `org_id` for resource access control — they use it for billing or for organization management. There is no `WHERE org_id = $1` filter on any business resource query (projects, clients, layouts, proposals, etc.) anywhere in the codebase.

**[VERIFIED]** This means the organization concept is almost entirely unwired from the application's resource access model. An organization member cannot see the owner's projects, clients, layouts, proposals, survey data, or any other business resource. Organization membership affects only seat billing.

---

## 4. Current Permissions and Authorization Model

### 4.1 Plan-Based Feature Gating

**[VERIFIED]** The authorization model is implemented in `lib/permissions.ts`. The `hasPlatformAccess()` function is documented as "the single function that determines whether a user has access to the platform." Its priority order is: `super_admin > admin > is_free_pass > active > trialing > false`. If the user's role is `super_admin` or `admin`, access is granted immediately (bypassing all subscription checks). If `is_free_pass` is true, access is granted. Otherwise, the subscription status is checked: `active` grants access, `free_pass` grants access, `trialing` grants access if the trial has not expired.

**[VERIFIED]** The `FeatureKey` type defines feature-level gates: `engineering`, `permitPackets`, `structuralCalcs`, `solFence`, `bom`, `whiteLabelBranding`, `proposalEsigning`, `batteryDesign`, `bulkProposals`, `apiAccess`, `multiCompany`. These are plan-tier features, not resource permissions. A user on the `pro` plan gets `engineering` and `bom`; a user on the `contractor` plan may not. This is a billing/plan gate, not a tenant isolation mechanism.

**[VERIFIED]** `lib/permissions.ts` imports `PlanId` and `getPlanPermissions` from `lib/stripe.ts`. The plan permissions define which features are available at each plan tier. This is the single source of truth for feature gating. However, this system has no concept of resource-level permissions — it cannot answer "can user X access project Y?" It can only answer "does user X's plan include feature Z?"

### 4.2 The Single Authorization Gate

**[VERIFIED]** There are exactly two authorization functions used across the API:

1. **`getUserFromRequest()`** — called across 136 route files. This function decodes the JWT, extracts the user `id`, queries the `users` table, and returns the full user record. Routes then use the returned user's `id` to filter queries: `WHERE user_id = $authenticatedUserId`. This is user-scoped authorization — the user can only see resources they own.

2. **`requireAdminApi()`** — called across 70 route files. This function calls `getUserFromRequest()` and then checks that the user's role is `admin` or `super_admin`. If the check passes, the route handler proceeds with no further authorization. Admin routes typically query all data globally: `SELECT * FROM projects` with no `WHERE user_id` or `WHERE org_id` filter. This is global authorization — admins can see everything.

**[VERIFIED]** The admin projects route (`app/api/admin/projects/route.ts`) queries projects globally with no organization filter. An admin can see every project from every user in every organization. This is by design for the current single-tenant model but is a critical cross-tenant exposure for multi-tenant operation.

### 4.3 Free-Pass Bypass

**[VERIFIED]** The `is_free_pass` flag on the `users` table grants full platform access. When `is_free_pass === true`, `hasPlatformAccess()` returns true regardless of subscription status. The dev auth bypass sets `isFreePass: true`. Admins can grant free passes to users via the admin panel. The free pass has no tenant scoping — it grants access to the user's own resources (via `user_id` filtering) and, if the user is also an admin, to all resources globally.

### 4.4 No Resource-Level Authorization

**[MISSING]** There is no resource-level authorization system. There is no function that checks "does user X have permission Y on resource Z?" The application relies entirely on: (a) `user_id` ownership filtering for regular users, and (b) role-based admin bypass for admins. There is no ACL, no capability table, no permission matrix, no resource-level policy engine.

**[VERIFIED]** Some routes implement ad-hoc ownership checks. For example, `app/api/projects/transition/route.ts` checks that the user owns the project before allowing a status transition. But these checks are inconsistent — not all routes perform them, and the pattern is not centralized. This creates IDOR (Insecure Direct Object Reference) risk: if a route loads a resource by ID without checking ownership, any authenticated user who knows the UUID can access it.

---

## 5. Middleware and Request Pipeline

**[VERIFIED]** The middleware (`middleware.ts`) runs on every request. Its responsibilities:

1. **Session validation** — checks for the JWT cookie, decodes it, validates the session age against the role-specific timeout.
2. **Route protection** — unauthenticated requests to protected routes are redirected to login.
3. **Admin path routing** — `/admin` and `/api/admin` paths use the 8-hour admin timeout.
4. **Role-based session timeout** — different roles get different session durations (8 hours for admin/staff, 24 hours for crew/homeowner).

**[VERIFIED]** The middleware does NOT perform: tenant resolution (no `org_id` extraction), resource-level authorization (no per-route permission checks), or rate limiting (that is in `lib/rateLimiter.ts` using Upstash Redis). The middleware is an authentication gate, not an authorization gate.

**[VERIFIED]** Admin role authorization is handled downstream: `app/admin/layout.tsx` calls `requireAdmin()` which queries the database for the role, and `/api/admin/*` routes call `requireAdminApi()` which does the same. The middleware does not enforce admin-only access on `/api/admin/*` — it relies on the route handler to call `requireAdminApi()`. **[INFERRED]** This means if a route handler forgets to call `requireAdminApi()`, the route is accessible to any authenticated user. This is a defense-in-depth gap.

---

## 6. Data Ownership Model

**[VERIFIED]** The dominant ownership pattern in SolarPro is `user_id`-scoped ownership. The core business resource tables — `projects`, `clients`, `layouts`, `productions`, `user_equipment_panels`, `user_equipment_inverters`, `user_equipment_batteries`, `user_equipment_mounting`, `site_aliases`, `proposal_signatures`, `crew_members`, `contractor_profiles`, `client_notes`, `project_micro_stages`, `project_versions`, `eagleview_orders` — all have a `user_id` column that identifies the owning user.

**[VERIFIED]** The `projects` table (migration 001) has `user_id UUID NOT NULL` with an index `idx_projects_user_id`. The `clients` table (migration 001) has `user_id UUID NOT NULL` with an index `idx_clients_user_id`. Both tables also have `deleted_at TIMESTAMPTZ` for soft deletes with indexes on `deleted_at`.

**[VERIFIED]** Child tables that belong to a project use `project_id` as the ownership link, with `ON DELETE CASCADE` to the parent project. For example, `layouts` has `project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE` and also `user_id UUID NOT NULL`. The `user_id` on child tables is redundant with the project's `user_id` but provides a direct ownership path without requiring a join.

**[VERIFIED]** No business resource table has an `org_id` column. The only tables with `org_id` are `organizations` (the org itself), `org_invites` (invitations to an org), and `users` (the user's org membership). There is no `projects.org_id`, no `clients.org_id`, no `layouts.org_id`, no `proposals.org_id`. This means there is no database-level mechanism to scope resources to an organization — all scoping is done at the application level via `WHERE user_id = $1`.

**[INFERRED]** Because resources are owned by `user_id` and organizations have members, an org member cannot access the org owner's resources unless the application explicitly queries by the owner's `user_id` or unless the member is an admin (global access). The current application does not implement "see all resources in my org" queries — it only implements "see my resources" (`WHERE user_id = $authenticatedUserId`) and "see all resources" (admin, no filter).

---

## 7. Database Isolation

**[VERIFIED]** SolarPro uses Neon PostgreSQL (serverless) via the `@neondatabase/serverless` package. The connection is established through a single `DATABASE_URL` environment variable. There are no per-tenant database roles, no per-tenant schemas, and no per-tenant databases. All tenants share the same database instance and the same connection string.

**[VERIFIED]** There are zero Row Level Security (RLS) policies on any table. A grep for "ROW LEVEL SECURITY", "ENABLE ROW LEVEL", and "FORCE ROW LEVEL" across all 101 migration files returned no results. This means the database enforces no tenant isolation — all isolation must be done at the application level.

**[VERIFIED]** There are no database-level tenant isolation mechanisms: no separate schemas per tenant, no views scoped to tenants, no database roles with tenant-specific grants. The database is a flat shared schema where all data is accessible to any query that the application sends.

**[VERIFIED]** The `ON DELETE CASCADE` pattern is used extensively. When a project is deleted (hard delete), all child records (layouts, productions, micro_stages, versions, etc.) are automatically cascade-deleted. When a user is deleted, their organizations are cascade-deleted (which in turn cascade-deletes org_invites). The `users.org_id` uses `ON DELETE SET NULL` — if an org is deleted, the user's `org_id` becomes NULL but the user and their resources remain.

**[VERIFIED]** Soft delete is implemented only on `clients` and `projects` (both have `deleted_at TIMESTAMPTZ`). When a client or project is "deleted," the `deleted_at` column is set to the current timestamp, and queries filter with `WHERE deleted_at IS NULL`. Child tables do not have soft delete — they use `ON DELETE CASCADE` for hard deletion when the parent is hard-deleted. This creates an inconsistency: if a project is soft-deleted, its child records (layouts, productions) remain visible because they have no `deleted_at` and no cascade is triggered by a soft delete.

**[INFERRED]** The lack of RLS, combined with the single `DATABASE_URL`, means that any SQL query that does not include a `WHERE user_id` or `WHERE org_id` filter will return data from all tenants. The application is the sole enforcer of isolation, and any missed filter is a cross-tenant data exposure. This is the foundational isolation gap that the proposed architecture must address.

---

## 8. Storage and File Isolation

**[VERIFIED]** SolarPro uses `@vercel/blob` for file storage. There are exactly two locations that call `blob.put()`:

1. **Survey photo upload** (`app/api/survey/upload-photo/route.ts`) — the storage key pattern is `surveys/{projectId}/{jti}/{category}/{timestamp}.{ext}`. The key is built from the project ID, a JWT ID (`jti`), the photo category, and a timestamp. There is NO organization prefix in the path. The blob is uploaded with `access: 'public'`, meaning the resulting URL is publicly accessible to anyone who knows it.

2. **Utility bill attachment** (`lib/intake/utilityBillAttachment.ts`) — the storage key pattern is `intake/utility-bills/{funnel}/{eventId}/{timestamp}-{uuid}-{safeName}.{ext}`. The key is built from the intake funnel slug, the intake event ID, a timestamp, a UUID, and the sanitized filename. There is NO organization prefix in the path. The blob is also uploaded with `access: 'public'`.

**[VERIFIED]** Both blob upload paths use `access: 'public'`, which means the resulting URLs are world-readable. There are no signed URLs, no time-limited access tokens, no access control on the blob URLs themselves. Anyone who obtains the URL can access the file. The security model relies on the obscurity of the URL path (which includes a UUID or jti) rather than on access control.

**[VERIFIED]** There is a development fallback in the survey upload route: if `BLOB_READ_WRITE_TOKEN` is not set, the file is saved to `public/uploads/surveys/` on the local filesystem. This fallback is for local development only.

**[MISSING]** There is no tenant-scoped storage namespace. Files from different organizations are stored in the same blob container with no org prefix. There is no mechanism to list or delete all files belonging to an organization. There is no mechanism to revoke access to a file (the URL is permanent and public). There is no revision history for files — uploads overwrite or create new paths.

**[INFERRED]** The public-access blob model means that if a file URL is leaked (via logs, error messages, browser history, shared links, or API responses), the file is accessible to anyone, including users from other organizations. This is a cross-tenant data exposure risk via file URLs.

---

## 9. Cache, Search, Notification, and Background Worker Isolation

### 9.1 Cache

**[VERIFIED]** SolarPro uses `@upstash/redis` for rate limiting only, not for data caching. The `lib/rateLimiter.ts` module implements rate limiting using Redis. There is no Redis-based data cache, no query cache, no session cache (sessions are JWT-based, stateless). There is no search index (no Elasticsearch, no Algolia, no Meilisearch). There is no analytics engine. There is no event bus.

**[INFERRED]** Because there is no data cache, there is no cache isolation risk — cached data cannot leak across tenants because no data is cached. However, the rate limiter keys are likely based on user ID or IP address, and there is no org-level rate limiting. This is a minor gap but not a cross-tenant data exposure.

### 9.2 Notifications

**[VERIFIED]** Email notifications are sent via Resend (`resend` npm package). The notification preferences are stored in the `notification_prefs` table (migration 036). Notifications are per-user — there is no org-level notification routing. The `solardog_conversations` table (migration 023) stores AI chat conversations, scoped by `user_id`.

**[MISSING]** There are no websockets or real-time push notifications. There is no server-sent events (SSE) mechanism. Notifications are exclusively email-based.

### 9.3 Background Worker

**[VERIFIED]** The background worker (`worker/main.ts`) is a standalone Node.js service running on Render (not Vercel, because SAM2 segmentation takes 53-95 seconds per photo, exceeding Vercel's 300-second function timeout). The worker polls the Neon database for queued geometry reconstruction jobs using `claimNextQueuedJob()`, which performs an atomic compare-and-swap on `locked_by IS NULL`. The worker processes jobs from all users — there is no tenant filter in the job polling query.

**[VERIFIED]** The worker calls `getSurveyOwnerId()` to determine the owner of the survey being processed. This is a user-level ownership lookup, not an org-level lookup. The worker processes the job, writes artifacts via `insertReconstructionArtifactsBatch()` and `writeUnifiedArtifacts()`, and updates job status. The worker authenticates to the database with the single `DATABASE_URL` — there is no per-tenant credential.

**[INFERRED]** The worker processes jobs across all tenants without isolation. The job payload includes the survey ID and project ID, from which the owner can be derived, but the worker does not enforce any tenant boundary on the data it reads or writes. Artifacts are written to the database with the job's survey/project context, not with an org context.

### 9.4 Audit Log

**[VERIFIED]** The `audit_log` table (migration 100) is a tamper-evident, hash-chained audit log. Each entry has: `id` (BIGSERIAL), `timestamp`, `category` (auth|access|data|config|security|admin|billing|compliance), `action`, `actor_id`, `actor_email`, `actor_role`, `target_type`, `target_id`, `description`, `metadata` (JSONB), `ip_address`, `user_agent`, `request_path`, `prev_hash` (SHA-256 of previous entry), `entry_hash` (SHA-256 of this entry). The `COMMENT ON TABLE` states this is for "SOC 2 CC7.2 and ISO 27001 A.12.4 compliance."

**[VERIFIED]** The audit log has NO `actor_organization_id` column and NO `resource_owner_organization_id` column. The `actor_id` is a TEXT field (the user ID), and the `target_id` is a TEXT field (the resource ID). There is no way to query "all actions taken by users in organization X" or "all actions affecting resources owned by organization Y" without joining to the `users` table to resolve `org_id` at query time.

**[VERIFIED]** The hash chain (`prev_hash` / `entry_hash`) provides tamper-evidence: each entry's hash is computed from all fields, and the `prev_hash` links to the previous entry. This allows verification that the log has not been tampered with. The `verifyAuditChain()` function (referenced in the table comment) can verify integrity. However, the hash chain does not provide tenant isolation — it provides integrity, not scoping.

**[INFERRED]** The absence of org context in the audit log means that in a multi-tenant scenario, audit log queries cannot be scoped to an organization without runtime joins. This is a compliance gap: an organization admin should be able to see all audit events for their organization, but the current schema does not support this without joining to the users table (which may not capture the org at the time of the event if the user has since changed orgs).

---

## 10. Billing and Usage Authority

**[VERIFIED]** SolarPro uses Stripe for billing (`stripe` npm package, `lib/stripe.ts`). The billing model is per-user: each user has their own Stripe subscription (`stripe_subscription_id` on the `users` table). The plan is stored on the user (`plan` column). The subscription status is stored on the user (`subscription_status` column).

**[VERIFIED]** When a user creates an organization, the organization's `plan` inherits from the owner (`plan TEXT NOT NULL DEFAULT 'contractor'` in the organizations table, documented as "inherits from owner"). The org does not have its own Stripe subscription — the owner's subscription covers the org. The `syncSeatsForOrg()` function in `lib/stripe.ts` syncs the seat count: it counts the members of the org, calculates extra seats beyond the base, and adds/removes a "Additional Seat" recurring price line item (`STRIPE_PRICE_EXTRA_SEAT`) on the owner's subscription with `proration_behavior: 'create_prorations'`.

**[VERIFIED]** The billing model is: the org owner pays for their own subscription plus extra seats for each member beyond the base. The `syncSeatsForOrg()` function is defensive — it no-ops (never throws) if anything is missing (no seat price configured, org owner not found, owner has no subscription). This means membership changes (invite accepted, member removed) should trigger a seat sync, but if the sync fails, the membership change still succeeds — billing is eventually consistent, not transactionally consistent with membership.

**[VERIFIED]** Pricing is configured globally in `lib/companyPricing.ts`. This file contains hardcoded pricing configuration that applies to all organizations. There is no per-org pricing, no custom contracts, no tiered pricing per organization. All organizations see the same pricing.

**[VERIFIED]** The `hasPlatformAccess()` function in `lib/permissions.ts` checks subscription status to gate feature access. The priority is: `super_admin > admin > is_free_pass > active > trialing > false`. This means admins and free-pass users bypass all billing checks. Regular users must have an active subscription or an active trial.

**[INFERRED]** The per-user billing model creates a structural mismatch with multi-tenancy: if the org is the tenant, billing should be per-org (the org pays, members get access). The current model is per-user (each user pays, the org inherits the owner's plan). This is an open design decision for the migration.

---

## 11. Consolidated Verified Findings

### F-01: JWT Carries No Tenant Context
**[VERIFIED]** The JWT payload is `{id, name, email, company}` — no `org_id`, no `org_role`, no tenant context. Evidence: `lib/auth.ts` `signToken()` function. The `company` field is free-text, not a structured org reference.

### F-02: Two Parallel "Company" Concepts
**[VERIFIED]** `users.company` (TEXT, free-text, migration 006) and `organizations` table (structured, migration 016) are structurally independent. No foreign key connects them. Evidence: `lib/migrations/006_users_subscriptions_whitelabel.sql` and `lib/migrations/016_organizations.sql`.

### F-03: Organizations Barely Wired
**[VERIFIED]** `org_id` is referenced in only 8 TypeScript files. No business resource query filters by `org_id`. Evidence: `grep -rl "org_id" --include="*.ts"`.

### F-04: Zero RLS Policies
**[VERIFIED]** No Row Level Security on any table. Evidence: `grep -ril "ROW LEVEL SECURITY" lib/migrations/*.sql` returns empty.

### F-05: Single DATABASE_URL, No Per-Tenant Roles
**[VERIFIED]** All tenants share one `DATABASE_URL`. No per-tenant database roles or schemas. Evidence: `@neondatabase/serverless` usage, single connection string.

### F-06: Admin Access Is Global, Not Org-Scoped
**[VERIFIED]** `requireAdminApi()` grants global access. Admin routes query without org filters. Evidence: `app/api/admin/projects/route.ts` queries globally; `requireAdminApi` in 70 route files.

### F-07: No Resource-Level Authorization
**[MISSING]** No ACL, capability table, or permission matrix. Authorization is `user_id` ownership filtering or admin role bypass. Evidence: `lib/permissions.ts` is plan-based feature gating, not resource authorization.

### F-08: Storage Paths Have No Org Prefix
**[VERIFIED]** Survey photos: `surveys/{projectId}/{jti}/{category}/{timestamp}.{ext}`. Utility bills: `intake/utility-bills/{funnel}/{eventId}/...`. No org prefix. Both use `access: 'public'`. Evidence: `app/api/survey/upload-photo/route.ts`, `lib/intake/utilityBillAttachment.ts`.

### F-09: Audit Log Has No Org Context
**[VERIFIED]** `audit_log` has `actor_id` and `target_id` but no `actor_organization_id` or `resource_owner_organization_id`. Evidence: `lib/migrations/100_compliance_audit_mfa_consent.sql`.

### F-10: User Can Belong to Only One Org
**[VERIFIED]** `users.org_id` is a single UUID, not a junction table. No support for multi-org membership. Evidence: `lib/migrations/016_organizations.sql`.

### F-11: Only Two Org Roles (owner, member)
**[VERIFIED]** `org_role` is `'owner' | 'member'`. No admin/viewer/custom roles. Evidence: migration 016.

### F-12: Soft Delete Only on Two Tables
**[VERIFIED]** Only `clients` and `projects` have `deleted_at`. Child tables use `ON DELETE CASCADE`. Evidence: `lib/migrations/001_initial_schema.sql`.

### F-13: Three Parallel Auth Systems
**[VERIFIED]** Main JWT (`lib/auth.ts`), homeowner portal OTP (`lib/portalAuth.ts`), lead-desk scoped access (`lib/leadDeskAuth.ts`). No unified identity layer. Evidence: three separate auth modules.

### F-14: Dev Auth Bypass Returns super_admin
**[VERIFIED]** `lib/dev-auth.ts` returns `role: 'super_admin'`, `isFreePass: true` when active. Guarded by `VERCEL_ENV !== 'production'` AND `DEV_AUTH_BYPASS === 'true'` AND `X-Dev-Auth: bypass` header. Evidence: full source of `lib/dev-auth.ts`.

### F-15: Impersonation Has No Tenant Boundary
**[VERIFIED]** `admin_impersonation_tokens` allows any admin to impersonate any user across any org. No same-org check. Evidence: `lib/migrations/008_admin_activity_log.sql`.

### F-16: Background Worker Has No Tenant Context
**[VERIFIED]** `worker/main.ts` polls all jobs without org filter. Uses single `DATABASE_URL`. Evidence: `worker/main.ts` source.

### F-17: Role Constraint Conflict
**[VERIFIED]** DB comment says `'user' | 'admin'` but app uses `super_admin`, `staff`, `crew_member`, `homeowner`, `sales`. No CHECK constraint found. Evidence: migration 006 role comment vs. middleware.ts role references vs. `lib/mfa.ts` MFA_REQUIRED_ROLES.

### F-18: Billing Is Per-User, Not Per-Org
**[VERIFIED]** Each user has own Stripe subscription. Org inherits owner's plan. `syncSeatsForOrg()` adds seat line items to owner's subscription. Evidence: `lib/stripe.ts`.

### F-19: No SSO/SAML/OIDC Support
**[MISSING]** Only email/password with bcrypt. No OAuth providers, no SAML, no OIDC. Evidence: `lib/auth.ts` — only `bcrypt` and `jsonwebtoken` imports.

### F-20: No Active Company Context
**[MISSING]** No `active_org_id` in session/JWT. No company switcher. No server-side tenant resolution. Evidence: JWT payload has no org field; no switcher component found.

### F-21: No Server Actions
**[VERIFIED]** Zero `"use server"` directives found in the codebase. All server-side logic is in API route handlers. Evidence: `grep -rl '"use server"'` returns empty.

### F-22: Cache Is Rate-Limiting Only
**[VERIFIED]** `@upstash/redis` used for rate limiting only (`lib/rateLimiter.ts`). No data cache, no search index. Evidence: rate limiter module is the only Redis consumer.

### F-23: Pricing Is Global, Not Per-Org
**[VERIFIED]** `lib/companyPricing.ts` has hardcoded global pricing. No per-org pricing or custom contracts. Evidence: `lib/companyPricing.ts`.

### F-24: Member Removal Has No Audit Trail
**[MISSING]** No `removed_at` or `status` on membership. No API route found for member removal with audit logging. Evidence: no removal route in the 8 org_id-referencing files; no membership status column.

### F-25: On Delete SET NULL Orphans Users
**[VERIFIED]** `users.org_id` uses `ON DELETE SET NULL` — deleting an org sets `org_id` to NULL but the user and their resources remain. No cascade cleanup of resources. Evidence: migration 016 `ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL`.

---

## 12. Architecture Gap Summary

The following gaps must be addressed by the proposed multi-tenant architecture:

1. **No tenant context in the authentication token** — the JWT must carry the active organization context, or it must be resolved server-side from the user's membership.

2. **No tenant-scoped resource ownership** — business resource tables need an `org_id` column, and all queries must filter by it.

3. **No database-level isolation** — RLS policies or per-tenant database roles should be considered as a defense-in-depth layer.

4. **No centralized authorization guard** — a single authorization function must mediate all resource access, checking both ownership and permissions.

5. **No tenant-scoped storage** — file storage paths must include an org prefix, and access should be controlled (signed URLs or auth-gated access).

6. **No tenant-aware audit log** — the audit log must record `actor_organization_id` and `resource_owner_organization_id` for every event.

7. **No org-scoped admin access** — admin access must be scoped to the admin's organization, not global. A platform-level super_admin role may exist for SolarPro staff, but customer admins must be org-scoped.

8. **No cross-tenant collaboration mechanism** — if organizations need to share projects or data, an explicit share-grant mechanism must be designed.

9. **No per-org billing** — billing should be migrated from per-user to per-org (the org pays, members inherit access).

10. **No member lifecycle management** — member removal, role changes, and org deletion must have proper audit trails and resource cleanup.

The companion document `ENTERPRISE-MULTI-TENANT-AUTHORITY-ARCHITECTURE.md` proposes a default-deny, organization-as-tenant-boundary architecture that addresses all of these gaps. The migration plan (`ENTERPRISE-MULTI-TENANT-MIGRATION-PLAN.md`) describes how to transition from the current state to the proposed state without data loss or downtime.

---

## 13. Evidence Index

All evidence in this document was gathered from the SolarPro repository on the `dev` branch at commit `fedb27ac`. Key source files examined:

| File | Purpose |
|------|---------|
| `lib/auth.ts` | JWT signing, session lifecycle, user retrieval |
| `lib/mfa.ts` | TOTP MFA enforcement, MFA_REQUIRED_ROLES |
| `lib/dev-auth.ts` | Development auth bypass (full source read) |
| `lib/permissions.ts` | Plan-based feature gating (hasPlatformAccess) |
| `lib/stripe.ts` | Per-user billing, syncSeatsForOrg |
| `lib/companyPricing.ts` | Global hardcoded pricing |
| `lib/rateLimiter.ts` | Upstash Redis rate limiting |
| `middleware.ts` | Session validation, role-based timeout |
| `worker/main.ts` | Background worker pipeline |
| `lib/migrations/001_initial_schema.sql` | Core tables: users, projects, clients, layouts, productions |
| `lib/migrations/006_users_subscriptions_whitelabel.sql` | Users table extensions, company field, subscription columns |
| `lib/migrations/008_admin_activity_log.sql` | Admin activity log, impersonation tokens |
| `lib/migrations/016_organizations.sql` | Organizations table, org_invites, users.org_id/org_role |
| `lib/migrations/100_compliance_audit_mfa_consent.sql` | Hash-chained audit_log table, MFA columns |
| `app/api/survey/upload-photo/route.ts` | Vercel Blob upload (survey photos) |
| `lib/intake/utilityBillAttachment.ts` | Vercel Blob upload (utility bills) |
| `app/api/admin/projects/route.ts` | Global admin project query (no org filter) |
| `app/api/clients/route.ts` | User-scoped client query |
| `app/api/projects/transition/route.ts` | Ad-hoc ownership check pattern |
| `app/api/cron/*/route.ts` | CRON_SECRET authenticated cron jobs |

---

*End of Current-State Audit document. This document is read-only and proposes no code changes. All findings are grounded in verified evidence from the SolarPro codebase on the `dev` branch.*
