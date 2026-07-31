# Access Control Policy

| Field | Value |
|---|---|
| **Policy** | POL-IS-004 — Access Control Policy |
| **Version** | 1.0 |
| **Effective date** | 2026-08-15 |
| **Owner (CISO)** | Raymond O'Brien |
| **Approver (Management)** | James Carpenter, Founder & CEO |
| **Last reviewed** | 2026-08-15 |
| **Next review** | 2027-08-15 (annual) or on material change |
| **Scope** | All Solarpro systems, data, and accounts. Every user — employee, contractor, vendor — with logical access to anything Solarpro owns. |

---

## 1. Purpose

This policy defines who can access what at Solarpro, how access is granted and revoked, and how it's reviewed. It's the **SOC 2 CC6 + ISO 27001 A.5.15 / A.5.16 / A.5.18 / A.8.2 / A.8.5** evidence.

The default is **deny**. Every access grant is an exception to the default, not the other way around.

## 2. Principles

Five principles govern every access decision:

1. **Least privilege** — a person gets the minimum access needed to do their job, no more. Role grants are specific; org-scope grants are specific; admin grants are the exception, not the baseline.
2. **Need-to-know** — even within a granted scope, you only see what your task requires. Customer data is partitioned by organization; cross-org reads fail closed.
3. **Default-deny** — `checkOrgAuthz()` and `requireAdminApi()` fail closed. A missing grant = no access. A misconfigured middleware = no access. A bug that bypasses a check is a P0, not a feature.
4. **Role-based, time-bound** — admin and elevated grants have an expiration. The default is the duration of the project, with a hard cap of 90 days before re-approval.
5. **Attributable** — every access uses a unique named account. Shared accounts are not permitted. Service accounts are named (`ci-deploy`, `compliance-collector`), not generic (`service`).

## 3. Account lifecycle

### 3.1 Provisioning

- A new user account is created by **Raymond or Cody** (Cody creates the technical account, Raymond grants the role) after James approves the hire or contractor engagement in writing (Slack message, email, or Linear issue).
- The request must include: name, email, role, scope of access, end date (for contractors), and the approval reference.
- The first session must require a password reset and MFA enrollment. The user cannot use the account productively until both are done.

### 3.2 Modification (role change, scope change)

- Any change to a user's role, org scope, or admin status requires a Linear issue (or GitHub issue) with Raymond's approval.
- The change is recorded in `auditLog.ts` with actor, target, before/after, and reason. No silent grants.
- Effective immediately on change; the user re-authenticates within 5 minutes or their session is invalidated.

### 3.3 Deprovisioning — the 24-hour rule

**Terminations (voluntary or involuntary):** all access revoked within **24 hours** of the termination effective time. The mechanism:

- Google Workspace account suspended (immediately revokes email, Drive, admin scopes).
- GitHub org membership removed.
- Vercel, Render, Neon, Stripe, Resend, Cloudflare, Sentry — admin tokens rotated if they had any, user removed.
- App account: `password_changed_at` set to a future time so all existing tokens (issued before that timestamp) are rejected (`lib/adminAuth.ts:152` + migration 094). The user record is marked `terminated_at`, not deleted, for audit.
- All admin role cache entries invalidated (the 60-second cache TTL is also force-cleared).
- **Quarter-hour clock starts at termination effective time, not at "when we got around to it."** If a termination happens at 5pm Friday, all access is revoked by 5pm Saturday. There are no grace periods because the terminated person may act before you think they will.

**Role change (internal):** any access the person no longer needs is revoked at the same moment the new access is granted. Net access never goes up during a role change unless James has approved it.

**End of contract (contractor):** access expires on the contract end date. A 7-day reminder goes to Raymond 7 days before expiration.

### 3.4 Quarterly User Access Review (UAR)

Every quarter (1st business day of January, April, July, October), the script at `compliance/uar/run-uar.mjs`:

1. Snapshots current access state from GitHub, Vercel, Render, Neon, Google Workspace, and the internal `users` table.
2. Diffs against the prior quarter's snapshot.
3. Produces a markdown report at `compliance/uar/<YYYY-Q#>/report.md` listing: added users, removed users, role changes, MFA gaps (must be zero for any admin), stale accounts (no login > 90 days for production access), and inconsistent state.
4. **James reviews and signs off** by approving the PR that contains the report. The merge commit SHA is the audit artifact.

The UAR takes ~30 minutes for James to review in a 3-person team. It scales linearly as headcount grows.

## 4. Authentication

### 4.1 Password requirements

Per **NIST 800-63B**, with Solarpro-specific additions:

- **Minimum 12 characters.** No maximum (long passphrases are good).
- **No composition rules** (no "must contain uppercase + number + symbol" — NIST guidance). Length beats complexity.
- **No periodic forced rotation** unless there is evidence of compromise. Forced rotation pushes people to predictable patterns.
- **Checked against breach lists** (the `isGibberish` + `isDisposableEmail` checks in `app/api/auth/register/route.ts` and equivalents) at registration.
- **Stored only in 1Password.** No password managers other than 1Password are approved. Browser-saved passwords for work accounts are discouraged but not prohibited.

### 4.2 MFA

- **Required for all admin access** (Google Workspace admin, GitHub org owner, Vercel/Render/Neon admin, app `super_admin`).
- **Required for all production database access** (Neon).
- **Preferred factor**: TOTP (Google Authenticator, 1Password, Authy) or hardware key (YubiKey, Titan). SMS is the last resort and only when the system does not support TOTP.
- **MFA seeds** are stored encrypted at rest using `MFA_ENCRYPTION_KEY` (AES-256-GCM, 32-byte key). The encryption key is rotated annually; see the Encryption & Key Management Policy (Sprint 2).

### 4.3 Session and timeout

- **Web app JWT tokens**: 24 hours for standard users, 8 hours for admin users (`middleware.ts`).
- **Admin role cache**: 60 seconds, force-refreshed on role change.
- **Password change invalidation**: tokens issued before `password_changed_at` are rejected (migration 094).
- **Idle session**: 30 minutes of inactivity ends the session for admin roles; 8 hours for standard users. Re-authentication required to resume.

### 4.4 Break-glass access

The `/api/admin/debug/auth-status` and `/api/admin/repair-account` routes are gated by `ADMIN_SECRET` + `productionGuard()`. Use is logged to `auditLog.ts` and a Slack alert fires. Break-glass is for **emergencies only** (e.g. the auth service is itself broken). Every use generates a follow-up review within 24 hours.

## 5. Authorization

### 5.1 Role model

The app has three platform roles and one org-scoped role model:

- **Platform**: `super_admin` (Raymond), `admin`, `user`. Platform role does **not** confer org permissions (see ADR-004).
- **Org**: owner, admin, member, viewer. Enforced by `checkOrgAuthz()` in `lib/organizations/authorization.ts` — default-deny.
- **Service**: machine identities (`ci-deploy`, `compliance-collector`) with the minimum scopes their job requires.

### 5.2 Admin grants — time-bound

`super_admin` and `admin` grants expire after 90 days by default. A Linear issue with James's approval is required to renew. The expiration is enforced by `auditLog.ts` and the UAR.

### 5.3 Org-scoped access

Every cross-org read or write goes through `checkOrgAuthz()`. A `requireOrgRole()` API wrapper is the planned hardening (P1 in the control matrix); until it's live, route handlers must call `checkOrgAuthz()` directly and Raymond reviews the routes in the weekly UAR.

## 6. Privileged access (system, not application)

System-level access (Vercel env vars, Neon role grants, Render service config, Cloudflare DNS, GitHub org settings) is restricted to Raymond and James. Cody has read access for debugging but not write. Service-account keys are stored in GitHub Actions encrypted secrets and rotated per the Encryption & Key Management Policy.

## 7. Rate limiting and abuse controls

Every API route is expected to call `checkRateLimit()`. As of 2026-08-15, 178 of 293 routes still need the gate added (P0 in the control matrix). The rate limiter:

- Uses Upstash Redis in production with a **fail-closed in-memory LRU fallback** (the rate-limiter fail-open incident of 2026-08-12 is the trigger for this policy; see `compliance/incidents/` for the PIR).
- Buckets: 5/60s login, 2/60h migrate, and `standard` for the rest. Bucket choice is per-route.

## 8. Enforcement

Access control violations (shared credentials, bypassed controls, expired accounts still active) are handled per the Information Security Policy §9 and the Acceptable Use Policy §10. The UAR is the first line of detection; `auditLog.ts` events are the second.

## 9. Related documents

- `compliance/policies/01-information-security.md` — foundation.
- `compliance/policies/02-acceptable-use.md` — credential hygiene.
- `compliance/policies/04-data-classification-handling.md` — what access to what data is appropriate.
- `compliance/policies/05-incident-response.md` — what to do if access is compromised.
- `compliance/uar/` — quarterly UAR reports and script.

---

## Approval signatures

| Role | Name | Signature | Date |
|---|---|---|---|
| **CISO (Owner)** | Raymond O'Brien | _________________________ | __________ |
| **CEO (Management sign-off)** | James Carpenter | _________________________ | __________ |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-15 | compliance-lead (via legal-writer) | Initial issuance. Codifies the 24h deprovisioning SLA, 90-day admin expiry, and quarterly UAR cadence already in operation. |
