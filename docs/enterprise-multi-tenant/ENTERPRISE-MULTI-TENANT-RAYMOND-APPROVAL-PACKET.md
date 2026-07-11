# Enterprise Multi-Tenant Raymond Approval Packet

**Date:** 2026-07-11
**Branch:** `dev`
**Commit:** `ef51acff` (pre-correction Phase 0.5 documentation commit)
**Status:** Complete — 5 decisions presented for Raymond's approval
**Classification:** Phase 0.5A Integrity Reconciliation deliverable

> **Date classification:** All git commit dates in this repository are 2026-07-11. The date "2025-07-11" that appeared in earlier Phase 0.5 documents was incorrect and has been corrected to 2026-07-11 throughout the Phase 0.5 documentation set. The date 2026-07-11 is classified as a FACTUAL git commit date (verified via `git log --format=%ci`).

> **Branch reference classification:** The commit `ef51acff` is the pre-correction Phase 0.5 documentation commit on the `dev` branch. The earlier reference to `7b344aa1` as the Phase 0.5 baseline was misleading — `7b344aa1` is a CODE commit ("Planset PV-1: fix pluralization") that represents the codebase evidence baseline, not a documentation commit. The documentation commit for Phase 0.5 is `ef51acff`.

---

## 1. Purpose

This document is the formal approval packet for the five architecture decisions that require Raymond's explicit approval before implementation of the Enterprise Multi-Tenant Authority initiative can proceed. Each decision is presented with:

- The recommended choice and its rationale
- The alternatives that were considered and rejected
- The consequences of the recommended choice
- The reversibility of the decision
- The work that is blocked pending approval
- Formal approval fields for Raymond to sign

The five decisions requiring Raymond's approval are:

| Decision ID | ADR | Title |
|-------------|-----|-------|
| D-08 | ADR-008 | Billing Attribution |
| D-09 | ADR-009 | Legacy Ownership Migration |
| D-10 | ADR-010 | Ownership Transfer |
| D-12 | ADR-012 | Support Access and Impersonation |
| D-14 | ADR-014 | Minimum Safe Implementation Sequence |

The remaining nine decisions (D-01 through D-07, D-11, D-13) do not require Raymond's approval — they are settled by sufficient codebase evidence and governing principles. See `ENTERPRISE-MULTI-TENANT-PHASE0.5-DECISION-REGISTER.md` for the full decision register.

> **Architecture Status vs. Stakeholder Approval Status:** All 14 decisions have Architecture Status RECOMMENDED — the architecture analysis is complete and a recommendation has been made based on codebase evidence and governing principles. The five decisions in this packet additionally have Stakeholder Approval Status PENDING RAYMOND APPROVAL — Raymond must explicitly approve each before implementation proceeds. No decision has Stakeholder Approval Status APPROVED BY RAYMOND at this time.

---

## 2. D-08 / ADR-008: Billing Attribution — Server-Authoritative, Organization-Level Billing

### Recommended Choice

**Option B — Org-level Stripe customer, server-authoritative billing attribution.**

Billing is attributed to the organization, not to individual users. A `stripe_customer_id` and `stripe_subscription_id` are added to the `organizations` table. The `users` table's billing columns are deprecated (retained for legacy compatibility during migration). All billing operations — subscription creation, seat sync, invoice retrieval — operate on the org-level Stripe customer. Billing attribution is server-authoritative: the active org context (D-002) determines which Stripe customer is charged. No route trusts a client-supplied `stripe_customer_id` or `org_id` for billing.

### Alternatives Considered

| Option | Description | Why Rejected |
|--------|-------------|--------------|
| Option A | Keep per-user billing, add org-level seat aggregation. Transfer the Stripe subscription to the new owner when the owner changes. | Operational fragility — Stripe subscription transfers are non-trivial and can fail. Does not establish org-level billing identity. |
| Option C | Hybrid — org-level subscription with per-user metered usage (API calls, storage). | Excessive complexity for initial release. Metered usage can be added in a future phase. |

### Consequences of the Recommended Choice

- **Positive:** The org owns its billing relationship (P1). The owner-departure billing disruption is architecturally addressed — the subscription lives on the org, not on a user. Server-authoritative attribution satisfies P3 (Default Deny) — no client can charge a different org's Stripe customer.
- **Negative:** Legacy per-user subscriptions (existing users with `stripe_subscription_id` on their `users` row) must be migrated to org-level customers. This migration has a window of risk (double-billing or billing gaps). Per-org custom pricing (T-20) is deferred — the initial model uses existing global pricing.
- **Threats architecturally addressed:** T-08 (audit log no org context — billing events are org-attributed). Cross-tenant billing confusion (server-authoritative attribution prevents charging another org's customer).
- **Threats CURRENTLY EXPOSED:** T-20 (pricing global) remains DEFERRED. Legacy per-user subscriptions remain until migrated (Phase 2).

### Reversibility

If rolled back, the org-level billing columns can be dropped and billing reverted to per-user. However, the Stripe customer migration is difficult to reverse — a rollback plan must preserve the original user-level Stripe customers until the migration is confirmed stable.

### Blocked Work

The following work is BLOCKED pending Raymond's approval of this decision:

- Phase 2 billing migration (migrating existing per-user Stripe subscriptions to org-level customers)
- `syncSeatsForOrg()` update to use org-level subscription
- Stripe webhook handler update to map events to org-level customers
- New API: `GET /api/organizations/{id}/billing`
- Deprecation of `users` table billing columns

### What Raymond Must Approve

1. The decision to migrate billing from per-user to org-level Stripe customers
2. The migration sequence and strategy for existing per-user subscriptions
3. The handling of `is_free_pass` users and trialing subscriptions during migration
4. The deprecation timeline for per-user billing columns

### Approval Fields

| Field | Value |
|-------|-------|
| Decision ID | D-08 |
| ADR | ADR-008 |
| Architecture Status | RECOMMENDED |
| Stakeholder Approval Status | PENDING RAYMOND APPROVAL |
| Raymond Approval | ☐ APPROVED ☐ REJECTED ☐ DEFERRED |
| Approval Date | _________________ |
| Raymond Signature | _________________ |
| Conditions / Notes | _________________ |

---

## 3. D-09 / ADR-009: Legacy Ownership Migration — No Free-Text Auto-Merging, Ambiguity Queue

### Recommended Choice

**Option C — `org_id` first, personal org fallback, ambiguity queue for `company`-based suggestions.**

Existing `org_id` memberships are respected — resources are assigned to the verified org. Users without an `org_id` get a personal org (auto-provisioned, named after the user or their `company` text). The `company` text field is never used for automatic merging. Instead, it generates suggestions in an ambiguity queue. Merges are performed manually after verification. The `users.company` text field is deprecated as an ownership indicator but retained for display purposes.

### Alternatives Considered

| Option | Description | Why Rejected |
|--------|-------------|--------------|
| Option A | Auto-merge by `users.company` free-text. Group users by exact or fuzzy match on the `company` field. | HIGH data corruption risk — free-text matching is unreliable (case variations, suffixes, abbreviations). Can merge unrelated companies or split a single company. |
| Option B | Auto-merge by `users.org_id` only, ignore `company`. For users without `org_id`, create personal org. | Safe but does not provide a path to consolidate users who belong to the same company but never joined an org. The ambiguity queue in Option C provides this path safely. |

### Consequences of the Recommended Choice

- **Positive:** No unverified ownership changes (P1). No data corruption from incorrect merging. Every resource gets an owner (personal org fallback prevents orphaned data). The ambiguity queue provides a safe path to consolidate users who belong to the same company.
- **Negative:** Personal orgs for users who actually belong to a shared company will exist until the ambiguity queue is processed. This is a data hygiene issue, not a security issue. The ambiguity queue review SLA is not yet defined — personal orgs may persist until reviewed.
- **Threats architecturally addressed:** Data corruption from incorrect merging (ARCHITECTURALLY ADDRESSED, IMPLEMENTATION PENDING). Cross-tenant data leakage from auto-merging unrelated companies (ARCHITECTURALLY ADDRESSED, IMPLEMENTATION PENDING). T-13 (ON DELETE SET NULL orphans — every resource gets an owner via personal org fallback).
- **Threats CURRENTLY EXPOSED:** All threats remain CURRENTLY EXPOSED until the backfill script is executed (Gate 13) and the ambiguity queue is processed (Gate 14).

### Reversibility

If rolled back, the personal orgs created by the fallback can be dissolved (resources reassigned back to user ownership). The ambiguity queue suggestions are non-destructive and can be discarded. However, any merges that were performed must be reversed individually.

### Blocked Work

The following work is BLOCKED pending Raymond's approval of this decision:

- Legacy ownership backfill script (Phase 1 Gate 13, dry-run mode)
- Ambiguity queue admin API (`GET /api/admin/migration/ambiguity-queue`, `POST /api/admin/migration/merge-orgs`) (Phase 1 Gate 14)
- Personal org auto-provisioning for users without `org_id`
- Deprecation of `users.company` as an ownership indicator

### What Raymond Must Approve

1. The personal org fallback naming convention
2. The ambiguity queue review process and SLA
3. The handling of `is_free_pass` users and seed data
4. The merge verification criteria before the backfill is executed

### Approval Fields

| Field | Value |
|-------|-------|
| Decision ID | D-09 |
| ADR | ADR-009 |
| Architecture Status | RECOMMENDED |
| Stakeholder Approval Status | PENDING RAYMOND APPROVAL |
| Raymond Approval | ☐ APPROVED ☐ REJECTED ☐ DEFERRED |
| Approval Date | _________________ |
| Raymond Signature | _________________ |
| Conditions / Notes | _________________ |

---

## 4. D-10 / ADR-010: Ownership Transfer — Formal, Audited, Both Sides Approve

### Recommended Choice

**Option C — Formal bilateral transfer with both-sides approval and full audit trail.**

Ownership transfer is a two-phase, bilateral process. The owning org's admin initiates a transfer request, specifying the receiving org and the resources to transfer. The receiving org's admin accepts or rejects the request. Upon acceptance, ownership is transferred atomically — `organization_id` is updated on all transferred resources, the transferor and transferee are recorded, and a full audit event is written (per D-013). Platform admins can facilitate (e.g., resolve disputes) but cannot unilaterally execute transfers — they act as mediators, not as transferors.

### Alternatives Considered

| Option | Description | Why Rejected |
|--------|-------------|--------------|
| Option A | Admin-initiated unilateral transfer — a platform admin can transfer ownership to any org/user. | Violates P5 (tenant autonomy). Single point of failure — a compromised admin account could transfer all orgs to an attacker. No consent from the receiving party. |
| Option B | One-sided transfer — owning org admin initiates, receiving org auto-accepts. | Receiving org has no consent mechanism. Could be flooded with unwanted transfers (and associated billing/storage costs). |

### Consequences of the Recommended Choice

- **Positive:** Both parties consent to the ownership change (P5). Atomic transfer prevents partial states. Full audit trail ensures every ownership change is traceable (P6). Unauthorized transfers are prevented by bilateral approval.
- **Negative:** The transfer process is more complex than unilateral transfer. A transfer request that is never accepted or rejected leaves resources in a pending state (addressed by request expiry and cancel). Transferred resources may carry billing implications that the receiving org must accept.
- **Threats architecturally addressed:** T-12 (member removal no audit — transfers are fully audited). T-18 (member removal leaves resources — formal transfer ensures resources have a clear new owner). Unauthorized transfers (bilateral approval prevents single-account transfer).
- **Threats CURRENTLY EXPOSED:** The existing admin reassignment route (`app/api/admin/projects/route.ts` PATCH) allows unilateral project reassignment with NO audit trail. This remains CURRENTLY EXPOSED until the transfer flow is implemented (Phase 3+) and the admin reassignment route is deprecated.

### Reversibility

If rolled back, the `ownership_transfer_requests` table can be dropped. Any completed transfers would need to be reversed manually (reassigning `organization_id` back to the source org). The deprecated admin reassignment route would need to be re-enabled.

### Blocked Work

The following work is BLOCKED pending Raymond's approval of this decision:

- `ownership_transfer_requests` table creation (Phase 3+)
- Transfer API endpoints (`POST /api/transfers`, `GET /api/transfers`, accept/reject/cancel)
- Deprecation of the existing admin project reassignment route (`app/api/admin/projects/route.ts` PATCH)
- Billing responsibility transfer logic (receiving org assumes billing for transferred resources)

### What Raymond Must Approve

1. The bilateral approval flow (both-sides consent)
2. The handling of billing responsibility transfer
3. The expiry duration for pending transfer requests
4. The deprecation timeline for the existing admin reassignment route

### Approval Fields

| Field | Value |
|-------|-------|
| Decision ID | D-10 |
| ADR | ADR-010 |
| Architecture Status | RECOMMENDED |
| Stakeholder Approval Status | PENDING RAYMOND APPROVAL |
| Raymond Approval | ☐ APPROVED ☐ REJECTED ☐ DEFERRED |
| Approval Date | _________________ |
| Raymond Signature | _________________ |
| Conditions / Notes | _________________ |

---

## 5. D-12 / ADR-012: Support Access and Impersonation — Time-Limited, Break-Glass, Tenant-Aware

### Recommended Choice

**Option B — Time-limited, tenant-aware, break-glass impersonation with revocation and notification.**

Impersonation is restructured as a formal break-glass operation with a tiered duration model:

| Session Type | Default Duration | Maximum Duration | Extended (>30 min) |
|-------------|-----------------|-----------------|-------------------|
| Normal | 30 minutes | 4 hours (240 min) | Requires customer approval |
| Break-glass (emergency) | 15 minutes | 30 minutes | Not permitted (break-glass is always short) |

The admin specifies a reason and a duration according to the session type. The session JWT includes `_impersonated: true`, `_adminId`, `_impersonationReason`, `_impersonationExpiresAt` (a hard expiry timestamp). The middleware checks `_impersonationExpiresAt` on every request and terminates the session if expired. The admin (or another platform admin) can revoke an active impersonation session at any time. The target user receives an email notification. Every impersonation session and every action within it is fully audited (D-013). The dev auth bypass (T-06) is additionally constrained: it is disabled in production, and Phase 0.5 recommends adding an explicit audit event when dev bypass is used in non-production environments.

> **Duration Conflict Resolution:** This tiered model resolves a contradiction that existed in earlier versions of the documentation. The Decision Register previously stated "30 min default, 4 hr max" while the ADR document asked "whether 30 minutes is the right maximum" and stated "max 30 minutes." The resolved model is: Normal sessions have a 30-minute default and 4-hour maximum; Break-glass sessions have a 15-minute default and 30-minute maximum; Extended sessions exceeding 30 minutes require explicit customer approval. This model is now consistent across all Phase 0.5 documents.

### Alternatives Considered

| Option | Description | Why Rejected |
|--------|-------------|--------------|
| Option A | Keep current impersonation, add same-org validation. Require admin's org matches target user's org. | Does not address platform-level support (super_admin needs to support any org). Does not address the 1-hour unbounded session or the lack of break-glass revocation. |
| Option C | Remove impersonation entirely, use read-only support dashboard. | Most restrictive option but severely limits support's ability to reproduce user-reported issues (which often require interacting with the UI as the user). |

### Consequences of the Recommended Choice

- **Positive:** Impersonation sessions are time-limited (tiered duration model prevents indefinite sessions). The reason requirement creates an auditable record. The email notification provides transparency to the affected user. The revocation mechanism allows immediate termination if misuse is detected. Tenant-aware scoping ensures org-scoped admins cannot impersonate cross-tenant.
- **Negative:** The email notification system must be reliable — if notifications fail silently, users would not be informed of support access (addressed by requiring notification delivery confirmation or logging the notification attempt). The revocation mechanism must be real-time — if revocation is delayed, a revoked session could continue operating (addressed by middleware checking a revocation flag on every request).
- **Threats architecturally addressed:** T-05 (impersonation cross-tenant — ARCHITECTURALLY ADDRESSED, IMPLEMENTATION PENDING for org-scoped admins; ARCHITECTURALLY ADDRESSED, PARTIALLY IMPLEMENTED for super_admin). T-06 (dev auth bypass — ARCHITECTURALLY ADDRESSED, PARTIALLY IMPLEMENTED; dev bypass is disabled in production, audit logging recommendation is IMPLEMENTATION PENDING). T-08 (audit log no org context — ARCHITECTURALLY ADDRESSED, IMPLEMENTATION PENDING; impersonation events are specified to be fully audited with org context per D-013).
- **Threats CURRENTLY EXPOSED:** T-05 remains CURRENTLY EXPOSED — there is NO same-org validation in the current impersonation route (`app/api/admin/impersonate/route.ts`). T-06 remains CURRENTLY EXPOSED — the dev auth bypass audit logging is not yet implemented. Both are IMPLEMENTATION PENDING (Phase 1 Gate 11/12).

### Reversibility

If rolled back, the `impersonation_sessions` table (or `admin_impersonation_tokens` extension) can be dropped and the middleware changes reverted. The existing `admin_impersonation_tokens` table and the original impersonation route would need to be restored. However, the security improvements (time-limited sessions, revocation, notification) should not be rolled back without an equivalent alternative.

### Blocked Work

The following work is BLOCKED pending Raymond's approval of this decision:

- Impersonation hardening (Phase 1 Gate 12)
- Dev auth bypass audit logging (Phase 1 Gate 11)
- `admin_impersonation_tokens` table extension (or new `impersonation_sessions` table)
- Middleware changes (expiry check, revocation check)
- Email notification system for impersonation
- New API: `POST /api/admin/impersonate/revoke`

### What Raymond Must Approve

1. The tiered duration model (Normal: 30 min default, 4 hr max; Break-glass: 15 min default, 30 min max; Extended >30 min requires customer approval)
2. The notification policy (email to target user)
3. The revocation mechanism
4. The audit log review cadence
5. The handling of the dev auth bypass in non-production environments (whether dev bypass should be further restricted or audit-logged)

### Approval Fields

| Field | Value |
|-------|-------|
| Decision ID | D-12 |
| ADR | ADR-012 |
| Architecture Status | RECOMMENDED |
| Stakeholder Approval Status | PENDING RAYMOND APPROVAL |
| Raymond Approval | ☐ APPROVED ☐ REJECTED ☐ DEFERRED |
| Approval Date | _________________ |
| Raymond Signature | _________________ |
| Conditions / Notes | _________________ |

---

## 6. D-14 / ADR-014: Minimum Safe Implementation Sequence — 15 Entry Gates Before NEXT_ENTERPRISE_AUTHORITY_MIGRATION

### Recommended Choice

**Option C — Gated sequential implementation with 15 entry gates.**

Phase 1 implementation proceeds through 15 gates, each with explicit pass/fail criteria. No gate begins until the previous gate passes. NEXT_ENTERPRISE_AUTHORITY_MIGRATION (the first schema migration that adds org-level columns to existing resource tables) is PROHIBITED until all 15 gates are passed and Raymond approves. The 15 gates span two phases within Phase 1:

- **Phase 1 Foundation (Gates 1-12):** Canonical org table, org members junction table, org roles namespace, active org context table, active org resolution function, extended session/user object, authorization interface, org-scoped query helper, audit log org context, tenant-aware audit query API, dev auth bypass audit, impersonation hardening.
- **Phase 1 Completion (Gates 13-15):** Legacy ownership backfill script (dry-run), ambiguity queue admin API, Phase 1 entry gate verification (full test suite, 121 test cases, no regressions, Raymond approval).

### The 15 Gates

| Gate | Title | Key Pass Criteria |
|------|-------|-------------------|
| 1 | Canonical Organization Table | `organizations` table exists with `parent_org_id`; no duplicate org tables |
| 2 | Organization Members Junction Table | `organization_members` exists with `(user_id, org_id, role_id, joined_at)`; unique constraint; multi-org membership |
| 3 | Organization Roles Namespace | `org_roles` + `org_role_permissions` tables; four system roles seeded; separate from platform roles |
| 4 | Active Organization Context Table | `user_active_org` exists; server-side resolution function exists |
| 5 | Active Org Context Resolution Function | `getActiveOrgId(userId)` returns valid org_id or NULL; does NOT trust client input |
| 6 | Extended Session/User Object | `getUserFromRequest()` returns `{...user, active_org_id, org_role}`; JWT NOT modified; 136 files continue to function |
| 7 | Authorization Interface | `canAccessResource(actor, resource)` exists; returns boolean; unit tests pass |
| 8 | Org-Scoped Query Helper | `getOrgScopedQuery(orgId, tableName)` exists; unit tests pass; no bypass |
| 9 | Audit Log Org Context | `actor_organization_id` + `resource_owner_organization_id` columns; per-org chain logic; `verifyAuditChain(orgId)` works |
| 10 | Tenant-Aware Audit Query API | `GET /api/audit/org/{orgId}` exists; non-admins denied; cross-org denied for org-scoped admins |
| 11 | Dev Auth Bypass Audit | Dev bypass in non-production writes audit event; production still disabled |
| 12 | Impersonation Hardening | Org-scoped admins cannot impersonate cross-tenant; super_admin can with reason + duration; expiry, revocation, notification, audit |
| 13 | Legacy Ownership Backfill Script | Script runs in dry-run mode; reports assignments; does NOT execute changes |
| 14 | Ambiguity Queue Admin API | `GET /api/admin/migration/ambiguity-queue` and `POST /api/admin/migration/merge-orgs` exist; merge is audited |
| 15 | Phase 1 Entry Gate Verification | All 121 test cases pass; no regressions across 280 routes; MFA untouched; Raymond approves NEXT_ENTERPRISE_AUTHORITY_MIGRATION |

### Alternatives Considered

| Option | Description | Why Rejected |
|--------|-------------|--------------|
| Option A | Big-bang migration — implement all 14 decisions in one phase. Migrate all 280 routes, 55 tables, all auth code simultaneously. | Highest risk — a single bug in the foundational layer would propagate to all 280 routes. Rolling back would be extremely difficult. |
| Option B | Minimal viable multi-tenancy — implement only orgs and memberships (D-01, D-02). Defer everything else. | Lowest-risk but leaves the system in a half-migrated state (orgs exist but resources are still user-scoped, roles in single namespace, audit logs have no org context). Creates a window of inconsistency. |

### Consequences of the Recommended Choice

- **Positive:** Each foundational piece is in place and verified before the next piece is built. Rollback is possible at the gate level, not just the phase level. The prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION ensures no schema changes (org-level columns on resource tables) are made until the authorization infrastructure is ready to enforce them. This prevents the "big-bang" failure mode.
- **Negative:** The 15-gate sequence is slower than a big-bang approach. Each gate must pass before the next begins, which means the full Phase 1 implementation takes longer. The backfill script (Gate 13) and ambiguity queue (Gate 14) involve data ownership changes with a small risk of incorrect assignment.
- **D-14 is a sequencing decision, not a mitigation decision.** It does not itself address any threat. It sequences the implementation of D-01 through D-13 across 15 gates. Of the 20 threats: T-14 (SSO), T-19 (soft-delete consistency), and T-20 (per-org pricing) are DEFERRED and are NOT addressed by any gate. The remaining 17 threats are ARCHITECTURALLY ADDRESSED by D-01 through D-13 and sequenced across the gates.
- **Threats CURRENTLY EXPOSED:** All 20 threats remain CURRENTLY EXPOSED in the codebase until the corresponding gates are implemented and verified. The gated sequence ensures each threat is addressed in the appropriate gate, but no threat is "fully mitigated" until its gate passes.

### Reversibility

Individual gates can be rolled back at the gate level (e.g., if Gate 7 fails, Gates 1-6 are preserved and Gate 7 is reworked). The entire Phase 1 can be rolled back by dropping the Phase 1 schema additions (`organization_members`, `org_roles`, `user_active_org`, `audit_log` columns, `impersonation_sessions` extension, `org_merge_suggestions`). NEXT_ENTERPRISE_AUTHORITY_MIGRATION (resource ownership columns) is not executed until all gates pass, so it requires no rollback during Phase 1.

### Blocked Work

The following work is BLOCKED pending Raymond's approval of this decision:

- The entire Phase 1 implementation sequence (all 15 gates)
- NEXT_ENTERPRISE_AUTHORITY_MIGRATION (prohibited until all 15 gates pass AND Raymond approves)
- Transition to Phase 2 (resource ownership migration, file storage migration, billing migration)

### What Raymond Must Approve

1. The 15-gate implementation sequence and ordering
2. The pass/fail criteria for each gate
3. The prohibition on NEXT_ENTERPRISE_AUTHORITY_MIGRATION until all gates pass
4. The backfill script execution (Gate 13, live mode — requires separate approval after dry-run verification)
5. The transition from Phase 1 to Phase 2

### Approval Fields

| Field | Value |
|-------|-------|
| Decision ID | D-14 |
| ADR | ADR-014 |
| Architecture Status | RECOMMENDED |
| Stakeholder Approval Status | PENDING RAYMOND APPROVAL |
| Raymond Approval | ☐ APPROVED ☐ REJECTED ☐ DEFERRED |
| Approval Date | _________________ |
| Raymond Signature | _________________ |
| Conditions / Notes | _________________ |

---

## 7. Summary of Blocked Work

| Decision | Blocked Work | Phase |
|----------|-------------|-------|
| D-08 | Billing migration (per-user to org-level Stripe) | Phase 2 |
| D-09 | Backfill script (dry-run + live), ambiguity queue admin API | Phase 1 Gates 13-14 |
| D-10 | Ownership transfer table, transfer API, admin reassignment deprecation | Phase 3+ |
| D-12 | Impersonation hardening, dev auth bypass audit, middleware changes | Phase 1 Gates 11-12 |
| D-14 | Entire Phase 1 implementation sequence (15 gates), NEXT_ENTERPRISE_AUTHORITY_MIGRATION | Phase 1 (all gates) + Phase 2 transition |

**Total blocked work:** All Phase 1 implementation, all Phase 2 migration, and Phase 3+ ownership transfer. No implementation may proceed until Raymond approves the five decisions in this packet AND all Phase 1 entry gate conditions are met.

---

## 8. Cross-References

| Reference | Document |
|-----------|----------|
| Full ADRs | `ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md` |
| Decision Register | `ENTERPRISE-MULTI-TENANT-PHASE0.5-DECISION-REGISTER.md` |
| Phase 1 Entry Gates | `ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` |
| Phase 1 Implementation Spec | `ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md` |
| Canonical Authority Model | `ENTERPRISE-MULTI-TENANT-CANONICAL-AUTHORITY-MODEL.md` |
| Migration Sequence State | `ENTERPRISE-MULTI-TENANT-MIGRATION-SEQUENCE-STATE.md` |

---

**Document Footer**

**Decisions requiring Raymond approval:** 5 (D-08, D-09, D-10, D-12, D-14)
**Architecture Status (all 5):** RECOMMENDED
**Stakeholder Approval Status (all 5):** PENDING RAYMOND APPROVAL
**Decisions approved by Raymond:** 0 (none at this time)
**Blocked work:** All Phase 1 implementation, Phase 2 migration, Phase 3+ ownership transfer
**NEXT_ENTERPRISE_AUTHORITY_MIGRATION:** PROHIBITED until all 15 gates pass AND Raymond approves
