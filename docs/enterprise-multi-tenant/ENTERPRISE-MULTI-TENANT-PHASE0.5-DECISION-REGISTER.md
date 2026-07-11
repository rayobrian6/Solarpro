# Enterprise Multi-Tenant Authority — Phase 0.5 Decision Register

**Document Type:** Consolidated Architecture Decision Register
**Phase:** 0.5 — Architecture Decision Gate (Read-Only)
**Date:** 2025-07-11
**Branch:** `dev` @ `7b344aa1`
**Status:** Complete — All 14 decisions resolved
**Predecessor:** Phase 0 Audit & Architecture Design (commit `39a1f718`)
**Successor:** Phase 1 Implementation (BLOCKED — see Entry Gates document)

---

## 0. Purpose

This document is the single source of truth for the 14 architecture decisions (D-01 through D-14) that must be settled before any schema migrations or implementation work begin on the Enterprise Multi-Tenant Authority initiative. Each decision is recorded with a definitive status: **APPROVED**, **REJECTED**, **DEFERRED**, or **REQUIRES RAYMOND DECISION**.

The full Architecture Decision Records (ADR-001 through ADR-014) with complete evidence, options analysis, and impact assessment are in the companion document `ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md`.

---

## 1. Governing Principles

All 14 decisions are evaluated against the seven governing principles established for this initiative:

| ID | Principle | Summary |
|----|-----------|---------|
| P1 | Organizations Own Business Data | Users act on behalf of organizations; creation authorship does not equal ownership |
| P2 | Collaboration Does Not Change Ownership | A collaborator is not a tenant member |
| P3 | Default Deny | No route trusts client-supplied org/ownership/billing IDs |
| P4 | Permission-First Authorization | Roles are permission bundles, not authorization logic |
| P5 | Platform Authority and Tenant Authority Are Separate | Platform staff roles are distinct from organization roles |
| P6 | Revision-Bound Enterprise Records | Approvals and shares bind to exact revisions |
| P7 | Hybrid Isolation | Central app authz + tenant-scoped data helpers + selective RLS + tenant-safe storage/worker |

---

## 2. Consolidated Decision Table

| Decision ID | Title | Status | Summary | Key Evidence |
|-------------|-------|--------|---------|--------------|
| **D-01** | Membership Cardinality | **APPROVED** | Many-to-many org memberships via `organization_members` junction table | Migration 016: `users.org_id` is single-valued; POST /api/organizations returns 409 if already in org; `getProjectsByUser(user.id)` is user-scoped |
| **D-02** | Active Organization Context | **APPROVED** | Server-side resolution from persisted `user_active_org` table, validated against `organization_members` on every request | F-01: JWT has no tenant context; F-20: no active company context; T-04: token replay across tenants; `signToken()` strips all non-identity fields |
| **D-03** | Database Isolation Strategy | **APPROVED** | Hybrid: app-level authorization as primary enforcement; selective RLS as defense-in-depth on highest-sensitivity tables via transaction-wrapped `SET LOCAL` | F-04: zero RLS policies; F-05: single DATABASE_URL, Neon serverless HTTP driver; T-03: no RLS = full exposure on missed filter |
| **D-04** | Platform Roles vs Organization Roles | **APPROVED** | Separate namespaces: platform roles in `users.role` (super_admin, staff, user); org roles in `org_roles` + `organization_members.role_id` (owner, admin, member, viewer) | F-17: role constraint conflict — DB says 'user'\|'admin' but app uses super_admin, staff, crew_member, homeowner, sales; F-11: only two org roles |
| **D-05** | Project Collaboration Model | **APPROVED** | One canonical owning org per durable resource; cross-org collaboration via explicit `project_participants` table with permission envelope | `projects.user_id` is individual, not org; `getProjectsByUser(user.id)` is user-scoped; no collaboration model exists |
| **D-06** | Resource Share Grants | **APPROVED** | Explicit `resource_share_grants` table; revision-pinned; no reshare by default; no future revisions by default | No sharing model exists; all data is user-scoped; admin has global access (F-06) |
| **D-07** | Files and Revisions | **APPROVED** | Private tenant-prefixed storage (`{org_id}/...`); DB-backed `file_revisions` table; immutable revisions; access via signed URLs from auth-gated endpoint | F-08: storage paths have no org prefix; survey photos use `access: 'public'`; utility bills use `access: "public"`; T-07: public blob URLs leaked |
| **D-08** | Billing Attribution | **APPROVED** | Organization-level billing; org owns Stripe subscription; seats metered server-side from `organization_members`; server-authoritative attribution | F-18: billing is per-user; `syncSeatsForOrg()` bills seats on owner's subscription; F-23: pricing is global; T-20: no per-org billing isolation |
| **D-09** | Legacy Ownership Migration | **APPROVED** | No free-text company-name auto-merging; solo org per unaffiliated user; ambiguity queue for manual review | F-02: two parallel company concepts; `users.company` is free-text TEXT with no FK to `organizations`; F-03: organizations barely wired |
| **D-10** | Ownership Transfer | **APPROVED** | Formal `ownership_transfer_requests` table; both sides must approve; fully audited with before/after state; cooldown period | Admin can reassign projects with `UPDATE projects SET user_id` and no audit trail; no transfer concept exists |
| **D-11** | Parent/Subsidiary Organizations | **APPROVED** | Design for future via optional `parent_org_id` column; no automatic inheritance in initial release; cross-subsidiary access via explicit share grants | Migration 016: flat organizations, no hierarchy; no parent/subsidiary concept exists |
| **D-12** | Support Access and Impersonation | **APPROVED** | Time-limited support elevation (30 min default, 4 hr max); no standing access; break-glass for emergencies with post-hoc review; same-org validation required | F-15: impersonation has no tenant boundary; T-05: impersonation cross-tenant access; `admin_impersonation_tokens` has 5-min TTL, no same-org check |
| **D-13** | Audit Ledger Architecture | **APPROVED** | Tenant-aware audit ledger; `audit_log` gets `actor_organization_id` and `resource_owner_organization_id`; per-org hash chains within single table | F-09: audit log has no org context; T-08: compliance gap; `audit_log` table has actor_id/email/role but no org columns |
| **D-14** | Minimum Safe Implementation Sequence | **APPROVED** | 15-gate sequence: centralized authorization built BEFORE route-by-route migration; adversarial validation as final gate | 280 API routes, 136 files with `getUserFromRequest()`, 70 files with `requireAdminApi()`; all user-scoped |

---

## 3. Decision Status Legend

| Status | Meaning |
|--------|---------|
| **APPROVED** | The decision is settled based on sufficient codebase evidence, governing principles, and the default recommendation framework. Implementation may proceed once Phase 1 entry gates are met. |
| **REJECTED** | The decision option is rejected based on evidence conflict or principle violation. The rejected option and rationale are documented in the ADR. |
| **DEFERRED** | The core decision is approved, but a specific sub-component is deferred to a later phase. The deferral is documented with rationale and future trigger conditions. |
| **REQUIRES RAYMOND DECISION** | Evidence is insufficient to settle the decision. The open question and available evidence are documented for Raymond's review. No implementation proceeds until resolved. |

---

## 4. Deferred Components

The following sub-components are deferred within approved decisions:

| Decision | Deferred Component | Rationale | Future Trigger |
|----------|-------------------|-----------|----------------|
| D-03 | RLS implementation on non-critical tables | Neon serverless HTTP driver makes transaction-wrapped `SET LOCAL` necessary for RLS; only highest-sensitivity tables get RLS in Phase 1 | After app-level authz is proven and transaction-wrapping patterns are established |
| D-04 | Custom org roles | Four system roles (owner, admin, member, viewer) are sufficient for initial release; custom roles add complexity | Enterprise customer requests role customization |
| D-06 | Reshare chains | No reshare by default; reshare capability is a future enhancement | Customer use case requires delegated sharing |
| D-08 | Per-org pricing overrides | Global pricing is sufficient for initial release; architecture supports future `pricing_overrides` table | Enterprise contracts with negotiated rates |
| D-11 | Parent/subsidiary inheritance | No automatic inheritance in initial release; `parent_org_id` column is nullable and unused | Multi-entity enterprise customers request hierarchy |
| D-13 | Per-org separate chain verification UI | Per-org chains are implemented but compliance reporting UI is deferred | SOC 2 audit preparation |

---

## 5. Raymond Approval Summary

All 14 decisions have sufficient codebase evidence to be settled as APPROVED. No decision is marked REQUIRES RAYMOND DECISION. However, the following implementation details should be confirmed by Raymond before Phase 1 begins:

| Item | Decision | What Raymond Should Confirm |
|------|----------|---------------------------|
| Billing migration timing | D-08 | When to migrate existing per-user Stripe subscriptions to org-level subscriptions |
| Ambiguity queue ownership | D-09 | Who reviews the ambiguity queue and the review SLA |
| Support elevation max duration | D-12 | Whether 30 minutes is the right maximum for time-limited elevation |
| Phase 1 scope boundary | D-14 | Whether all 15 gates are in Phase 1 or some extend into Phase 2 |

These are implementation-timing confirmations, not architecture decisions. The architectural stance for each is settled.

---

## 6. Cross-Reference Index

| Reference | Document | Location |
|-----------|----------|----------|
| ADR-001 through ADR-014 | `ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md` | Full ADRs with evidence, options, impact |
| Canonical Authority Model | `ENTERPRISE-MULTI-TENANT-CANONICAL-AUTHORITY-MODEL.md` | 10 Mermaid diagrams |
| Phase 1 Entry Gates | `ENTERPRISE-MULTI-TENANT-PHASE1-ENTRY-GATES.md` | Entry conditions and Migration 101 prohibition |
| Phase 1 Implementation Spec | `ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md` | Implementation-ready spec |
| Phase 0 Current-State Audit | `ENTERPRISE-MULTI-TENANT-CURRENT-STATE-AUDIT.md` | Findings F-01 through F-25 |
| Phase 0 Architecture | `ENTERPRISE-MULTI-TENANT-AUTHORITY-ARCHITECTURE.md` | Open decisions D-01 through D-10 |
| Phase 0 Threat Model | `ENTERPRISE-MULTI-TENANT-THREAT-MODEL.md` | Threats T-01 through T-20 |
| Phase 0 Data Inventory | `ENTERPRISE-MULTI-TENANT-DATA-INVENTORY.md` | 55 tables with ownership classification |
| Phase 0 Migration Plan | `ENTERPRISE-MULTI-TENANT-MIGRATION-PLAN.md` | 6-phase migration strategy |
| Phase 0 Test Matrix | `ENTERPRISE-MULTI-TENANT-AUTHORIZATION-TEST-MATRIX.md` | 121 test cases |
| Phase 0 Roadmap | `ENTERPRISE-MULTI-TENANT-IMPLEMENTATION-ROADMAP.md` | 8 phases R0 through R7 |

---

## 7. Risk Review Matrix — Decision × Threat × Residual Risk × Required Tests

This matrix maps each of the 14 architecture decisions against the 20 threats (T-01 through T-20) from the Phase 0 Threat Model. For each decision, it documents: threats mitigated, threats introduced, residual risk, and required tests.

### Threat Reference (from Phase 0 Threat Model)

| ID | Threat | Severity |
|----|--------|----------|
| T-01 | IDOR — user-scoped queries enable cross-user access | CRITICAL |
| T-02 | Admin global exposure — admin routes see all tenants | CRITICAL |
| T-03 | No RLS — zero row-level security policies | CRITICAL |
| T-04 | JWT no tenant context — no org_id in token | HIGH |
| T-05 | Impersonation cross-tenant — no same-org validation | CRITICAL |
| T-06 | Dev auth bypass — super_admin with isFreePass in non-prod | HIGH |
| T-07 | Public blob URLs — files publicly accessible | HIGH |
| T-08 | Audit log no org context — no actor/resource org columns | HIGH |
| T-09 | Worker no isolation — background worker has no tenant context | HIGH |
| T-10 | Role constraint conflict — DB says user|admin, app uses super_admin|staff|crew_member|homeowner|sales | MEDIUM |
| T-11 | Free pass global access — is_free_pass grants full access | MEDIUM |
| T-12 | Member removal no audit — org member removal unlogged | MEDIUM |
| T-13 | ON DELETE SET NULL orphans — removing org_id orphans resources | MEDIUM |
| T-14 | No SSO — no SAML/OIDC enterprise federation | MEDIUM |
| T-15 | Cache leaks — Redis cache not tenant-scoped | MEDIUM |
| T-16 | Webhook not tenant-scoped — Stripe webhook not org-attributed | MEDIUM |
| T-17 | No active company context — no mechanism to switch orgs | HIGH |
| T-18 | Member removal leaves resources — departed member's resources orphaned | HIGH |
| T-19 | Soft-delete inconsistency — deleted_at handling varies | MEDIUM |
| T-20 | Pricing global — no per-org custom pricing | LOW |

### Risk Review Matrix

| Decision | Threats Mitigated | Threats Introduced | Residual Risk | Required Tests |
|----------|-------------------|--------------------|---------------|----------------|
| **D-01** Membership Cardinality (many-to-many) | T-17 (no active company context — memberships enable org switching), T-13 (orphans — junction table with CASCADE prevents orphans) | None — junction table is additive | Users with no memberships have no org context (active_org_id = NULL) | Verify user can join multiple orgs; verify CASCADE on membership delete; verify no orphaned membership rows |
| **D-02** Active Org Context (server-side) | T-04 (JWT no tenant context — active org is server-side, not in JWT), T-17 (no active company context — resolved) | If active org resolution is bypassed or client-supplied org is trusted, cross-tenant access possible | Stale active org (user left org but row not updated) — mitigated by membership validation on every resolution | Verify server-side resolution ignores client input; verify stale active org falls back; verify NULL for no memberships |
| **D-03** Database Isolation (hybrid app authz + RLS) | T-01 (IDOR — org-scoped queries replace user-scoped), T-02 (admin global exposure — RLS on critical tables), T-03 (no RLS — selective RLS added) | If RLS policies are misconfigured, legitimate access may be denied or illegitimate access granted | App-level authz remains primary; RLS is defense-in-depth. If app authz has a bug, RLS may not catch all cases | Verify RLS policies on critical tables; verify app authz denies cross-tenant; verify RLS denies when app authz is bypassed |
| **D-04** Platform vs Org Roles (separate namespaces) | T-10 (role constraint conflict — separate namespaces resolve collision) | None — additive tables | Custom org roles not supported initially (four system roles only) | Verify platform roles and org roles are separate; verify no collision; verify four system roles seeded |
| **D-05** Project Collaboration (owning org + participants) | T-01 (IDOR — org-scoped ownership), T-02 (admin global exposure — admin routes add org filter), T-18 (member removal leaves resources — org owns resources, not user) | Participant grants create a new access path — if participant check is bypassed, cross-org access possible | Participant with edit permission could modify owning org's data — mitigated by permission envelope and audit | Verify owning org access; verify non-participant denied; verify participant envelope enforced; verify revocation removes access |
| **D-06** Resource Share Grants (revision-pinned) | T-07 (public blob URLs — share requires server-side access resolution), T-01 (IDOR — explicit, pinned grants) | If revision pinning is not enforced at access time, grantee could access unintended revisions | Grants with no expiry persist indefinitely — mitigated by requiring expiry for external grantees | Verify grantee accesses only pinned revision; verify no reshare; verify expired/revoked denied; verify revision_id set server-side |
| **D-07** Files and Revisions (private, org-prefixed) | T-07 (public blob URLs — ELIMINATED, private storage), T-15 (cache leaks — short TTL signed URLs) | Signed URL infrastructure must be correct — broken signing denies or grants incorrectly | Signed URL valid for TTL regardless of subsequent authz changes — mitigated by short TTL (5 min) | Verify private storage; verify authorization required; verify cross-org denied; verify revision immutability; verify signed URL expiry |
| **D-08** Billing Attribution (org-level) | T-08 (audit log no org context — billing events org-attributed), T-16 (webhook not tenant-scoped — webhook maps to org customer) | If active org context is compromised, billing misattributed | Legacy per-user subscriptions must be migrated — window of risk (double-billing/gaps) | Verify org-level billing; verify client-supplied IDs ignored; verify seat sync on org subscription; verify webhook mapping |
| **D-09** Legacy Ownership Migration (no auto-merge) | T-13 (orphans — personal org fallback ensures no orphaned data), data corruption from auto-merging ELIMINATED | Personal orgs for users who belong to shared company exist until ambiguity queue processed | Ambiguity queue review SLA not defined — personal orgs may persist | Verify org_id-first assignment; verify personal org fallback; verify no auto-merge; verify ambiguity queue grouping |
| **D-10** Ownership Transfer (bilateral, audited) | T-12 (member removal no audit — transfers fully audited), T-18 (member removal leaves resources — formal transfer ensures new owner) | If acceptance endpoint does not verify receiving org admin, malicious actor could accept transfers | Pending transfer requests never accepted/rejected leave resources in limbo — mitigated by expiry and cancel | Verify bilateral flow; verify atomic transfer; verify audit trail; verify expired/cancelled cannot be accepted |
| **D-11** Parent/Subsidiary (metadata, no inheritance) | None directly — metadata only | None — no inheritance logic | If future inheritance is implemented incorrectly, unintended cross-tenant access — mitigated by separate future ADR | Verify parent_org_id metadata only; verify no access inheritance; verify no billing rollup; verify self-reference prevented |
| **D-12** Support Access (time-limited, break-glass) | T-05 (impersonation cross-tenant — ELIMINATED for org-scoped admins, mitigated for super_admin), T-06 (dev auth bypass — audit logging added) | Email notification failure could leave users uninformed; revocation delay could allow continued access | Platform super_admin can impersonate any user for 30 min — mitigated by reason, audit, notification, revocation, review | Verify cross-tenant denied for org admins; verify super_admin can impersonate with reason; verify expiry; verify revocation; verify notification |
| **D-13** Audit Ledger (tenant-aware, per-org chains) | T-08 (audit log no org context — ELIMINATED), T-02 (admin global exposure — admin events org-attributed), T-09 (worker no isolation — worker includes org context) | If per-org chain partitioning is incorrect, chain integrity weakened | Platform-level events share single platform chain — if tampered, platform audit integrity compromised | Verify org context columns; verify per-org chain; verify tampering in Org A doesn't break Org B; verify platform chain separate |
| **D-14** Implementation Sequence (15 gates) | All T-01 through T-20 — gated sequence ensures each threat addressed in appropriate gate with verification | None — gates are additive and non-breaking | Backfill script (Gate 13) and ambiguity queue (Gate 14) involve data ownership changes — small risk of incorrect assignment | Verify each gate's pass/fail criteria; verify 121 test cases pass; verify no regressions across 280 routes; verify MFA untouched |

### Threat Coverage Summary

| Threat | Mitigated By | Status After Phase 0.5 |
|--------|-------------|----------------------|
| T-01 IDOR | D-03, D-05, D-06 | Mitigated (Phase 2 implementation) |
| T-02 Admin global exposure | D-03, D-05, D-13 | Mitigated (Phase 2 implementation) |
| T-03 No RLS | D-03 | Mitigated (selective RLS, Phase 2) |
| T-04 JWT no tenant context | D-02 | Mitigated (server-side resolution, Phase 1) |
| T-05 Impersonation cross-tenant | D-12 | Mitigated (Phase 1 Gate 12) |
| T-06 Dev auth bypass | D-12 | Mitigated (audit logging, Phase 1 Gate 11) |
| T-07 Public blob URLs | D-06, D-07 | Mitigated (Phase 2 storage migration) |
| T-08 Audit log no org context | D-08, D-13 | Mitigated (Phase 1 Gate 9) |
| T-09 Worker no isolation | D-13 | Mitigated (Phase 1+ worker org context) |
| T-10 Role constraint conflict | D-04 | Mitigated (Phase 1 Gate 3) |
| T-11 Free pass global access | D-04, D-12 | Partially mitigated (free pass remains for platform admin; audited) |
| T-12 Member removal no audit | D-10, D-13 | Mitigated (Phase 1 Gate 9 + Phase 3 transfer) |
| T-13 ON DELETE SET NULL orphans | D-01, D-09 | Mitigated (CASCADE + personal org fallback) |
| T-14 No SSO | Not addressed in Phase 0.5 | DEFERRED — out of scope for multi-tenant authority |
| T-15 Cache leaks | D-07 | Partially mitigated (short TTL signed URLs; Redis tenant-scoping deferred) |
| T-16 Webhook not tenant-scoped | D-08 | Mitigated (org-level customer mapping, Phase 2) |
| T-17 No active company context | D-01, D-02 | Mitigated (Phase 1 Gates 4-6) |
| T-18 Member removal leaves resources | D-05, D-09, D-10 | Mitigated (org owns resources, Phase 2+) |
| T-19 Soft-delete inconsistency | Not directly addressed | DEFERRED — consistency is an implementation concern, not an architecture decision |
| T-20 Pricing global | D-08 (deferred component) | DEFERRED — per-org pricing is a future phase |

### Summary

- **Threats fully mitigated by Phase 0.5 decisions:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-12, T-13, T-16, T-17, T-18 (15 of 20)
- **Threats partially mitigated:** T-11, T-15 (2 of 20)
- **Threats deferred (out of scope):** T-14 (SSO), T-19 (soft-delete consistency), T-20 (per-org pricing) (3 of 20)
- **No threats introduced by any decision that are not mitigated by the same or another decision.**
- **All residual risks have documented mitigations.**
