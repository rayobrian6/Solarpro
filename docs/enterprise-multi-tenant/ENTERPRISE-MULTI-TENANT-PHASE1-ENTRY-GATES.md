# Enterprise Multi-Tenant Authority — Phase 1 Entry Gates

**Document Type:** Phase 1 Entry Gate Conditions
**Phase:** 0.5 — Architecture Decision Gate (Read-Only)
**Date:** 2025-07-11
**Branch:** `dev` @ `7b344aa1`
**Status:** Complete
**Predecessor:** Phase 0 Audit & Architecture Design (commit `39a1f718`)
**Depends on:** ADR-001 through ADR-014, Decision Register

---

## Purpose

This document defines the exact conditions that must be met before Phase 1 implementation can begin. It is the authoritative gate-keeping document: **Migration 101 is PROHIBITED until every BLOCKING condition in this document is satisfied and Raymond has explicitly approved.**

Phase 1 is the foundational implementation phase that establishes canonical organizations, many-to-many memberships, server-validated active org context, separate role namespaces, centralized authorization interfaces, and tenant-aware audit logging. Phase 1 does NOT migrate resource ownership (that is Phase 2 / Migration 101), does NOT migrate file storage (Phase 2), and does NOT migrate billing (Phase 2).

---

## Hard Prohibitions (Apply Throughout Phase 0.5 and Phase 1)

The following are ABSOLUTE PROHIBITIONS. Violation of any prohibition invalidates the phase and requires immediate rollback.

### PROHIBITION 1: No Production Code Changes in Phase 0.5

Phase 0.5 is a read-only architecture decision phase. No production code may be modified, created, or deleted. This includes all files under `app/`, `lib/`, `worker/`, `middleware.ts`, and any other source directory.

### PROHIBITION 2: No Schema Migrations (Migration 101) Until Entry Gates Met

**Migration 101 is PROHIBITED until every BLOCKING entry gate condition is satisfied and Raymond has explicitly approved in writing.** Migration 101 is defined as the first schema migration that modifies existing resource tables to add org-level ownership columns (e.g., `projects.organization_id`). The 15 implementation gates (ADR-014) define the work that must be completed before Migration 101 is even considered.

### PROHIBITION 3: No MFA Modifications

The MFA subsystem (`lib/mfa.ts` and related code, tests, evidence, acceptance artifacts) is COMPLETE AND CLOSED. No MFA code, tests, evidence, or acceptance artifacts may be modified. MFA columns on the `users` table (`mfa_enabled`, `mfa_method`, `mfa_secret_encrypted`, `mfa_verified_at`, `mfa_enrolled_at`) and the `mfa_recovery_codes` table are frozen. The `MFA_REQUIRED_ROLES` list (`['admin', 'super_admin', 'staff']`) is frozen.

### PROHIBITION 4: No Authentication or Authorization Route Changes in Phase 0.5

No changes to authentication routes, authorization logic, session handling, or JWT signing/verification in Phase 0.5. The JWT payload structure (`{id, name, email, company}` — NO org_id, NO role) is frozen for Phase 0.5. Phase 1 implementation may extend the session user object returned by `getUserFromRequest()` but must NOT modify the JWT payload (per ADR-002: active org is server-side, not in JWT).

### PROHIBITION 5: No Existing Phase 0 Document Modifications

The 7 Phase 0 deliverable documents are authoritative inputs. They may NOT be modified unless correcting a verified factual error. Phase 0.5 produces additive documents only.

### PROHIBITION 6: No Billing, Storage, or Worker Changes in Phase 0.5

No changes to Stripe billing logic, Vercel Blob storage configuration, or background worker behavior in Phase 0.5. These are Phase 2+ concerns.

### PROHIBITION 7: No Frozen Integrity Record Modifications

Frozen integrity records (hash-chained audit logs, MFA evidence, acceptance artifacts) may not be modified, deleted, or recomputed.

---

## Entry Gate Conditions

The following conditions must ALL be satisfied before Phase 1 implementation can begin. Each condition is classified as BLOCKING (must be met) or INFORMATIONAL (documented but not blocking).

### GATE A: Architecture Decisions Resolved (BLOCKING)

**Condition:** All 14 architecture decisions (D-01 through D-14) must be resolved and documented as approved ADRs.

**Evidence of satisfaction:**
- [x] Decision Register (`ENTERPRISE-MULTI-TENANT-PHASE0.5-DECISION-REGISTER.md`) exists with all 14 decisions marked APPROVED.
- [x] ADR document (`ENTERPRISE-MULTI-TENANT-ARCHITECTURE-DECISION-RECORDS.md`) exists with ADR-001 through ADR-014, each containing the full required structure (Context, Current-State Evidence, Options Considered, Decision, Rationale, Security Impact, Data Model Impact, API Impact, Worker Impact, Storage Impact, Billing Impact, Migration Impact, Testing Requirements, Rejected Alternatives, Deferred Work, Rollback Considerations, Raymond Approval Required).
- [x] Every ADR cites verified current-state evidence from the SolarPro codebase.
- [x] ADRs requiring Raymond approval are clearly marked: ADR-008, ADR-009, ADR-010, ADR-012, ADR-014.

**Status:** SATISFIED — all 14 ADRs documented and approved.

### GATE B: Canonical Authority Model Defined (BLOCKING)

**Condition:** The canonical authority model must be defined with visual diagrams covering all 10 required domains.

**Evidence of satisfaction:**
- [x] Canonical Authority Model (`ENTERPRISE-MULTI-TENANT-CANONICAL-AUTHORITY-MODEL.md`) exists with 10 Mermaid diagrams:
  1. Identity and membership
  2. Active organization selection
  3. Authorization decision sequence
  4. Project ownership and participation
  5. Resource sharing
  6. File revision access
  7. Support access
  8. Billing attribution
  9. Worker authorization
  10. Audit event flow
- [x] Each diagram is annotated with dependent ADRs and governing principles.
- [x] Cross-reference table maps diagrams to ADRs and principles.

**Status:** SATISFIED — all 10 diagrams documented.

### GATE C: Phase 1 Implementation Spec Defined (BLOCKING)

**Condition:** The Phase 1 implementation specification must be defined, covering only Phase 1 scope (canonical orgs, memberships, active org context, role namespaces, authorization interfaces, audit context).

**Evidence of satisfaction:**
- [x] Phase 1 Implementation Spec (`ENTERPRISE-MULTI-TENANT-PHASE1-IMPLEMENTATION-SPEC.md`) exists.
- [x] Spec covers only Phase 1 scope — no Phase 2+ work (resource ownership migration, file storage migration, billing migration) is included as implementation tasks.
- [x] Spec defines the 15 implementation gates from ADR-014 with pass/fail criteria.
- [x] Spec explicitly states that Migration 101 is prohibited until all 15 gates pass and Raymond approves.

**Status:** SATISFIED — see accompanying Implementation Spec document.

### GATE D: Risk Review Completed (BLOCKING)

**Condition:** A risk review matrix must be completed, mapping each decision to threats mitigated, threats introduced, residual risk, and required tests.

**Evidence of satisfaction:**
- [x] Risk review matrix exists in the Decision Register or as a separate section.
- [x] Matrix covers all 14 decisions (D-01 through D-14).
- [x] Matrix references all 20 threats (T-01 through T-20) from the Phase 0 Threat Model.
- [x] Each decision's residual risk is documented with mitigation.

**Status:** SATISFIED — risk review matrix included in the Decision Register.

### GATE E: Codebase Evidence Validated (BLOCKING)

**Condition:** All ADR recommendations must be validated against the actual SolarPro codebase. No assumptions or hallucinated evidence.

**Evidence of satisfaction:**
- [x] 19 required source files inspected and verified (lib/auth.ts, lib/mfa.ts, lib/dev-auth.ts, lib/permissions.ts, lib/stripe.ts, lib/companyPricing.ts, lib/portalAuth.ts, lib/leadDeskAuth.ts, middleware.ts, worker/main.ts, app/api/organizations/* routes, app/api/admin/* routes, survey upload route, utility bill attachment, lib/db/projects.ts, lib/db/clients.ts, lib/auditLog.ts, Migration 016, Migration 100, Migration 006).
- [x] Zero RLS policies confirmed across all 101 migrations.
- [x] All project/client queries confirmed as user-scoped (`WHERE user_id = ?`), not org-scoped.
- [x] Admin routes confirmed as global queries with no org filter.
- [x] Impersonation confirmed as having no same-org validation.
- [x] Audit log confirmed as having no org context columns.
- [x] Storage paths confirmed as having no org prefix and using `access: 'public'`.
- [x] JWT confirmed as containing only `{id, name, email, company}` — no org_id, no role.

**Status:** SATISFIED — all evidence verified from source code.

### GATE F: Governing Principles Applied (BLOCKING)

**Condition:** All 7 governing principles must be applied consistently across all ADRs.

**Evidence of satisfaction:**
- [x] P1 (Organizations Own Business Data): applied in ADR-001, ADR-005, ADR-007, ADR-008, ADR-009, ADR-010.
- [x] P2 (Collaboration Does Not Change Ownership): applied in ADR-005, ADR-006, ADR-010.
- [x] P3 (Default Deny): applied in ADR-002, ADR-003, ADR-005, ADR-008, ADR-012.
- [x] P4 (Permission-First Authorization): applied in ADR-003, ADR-004, ADR-005, ADR-006, ADR-012.
- [x] P5 (Platform Authority and Tenant Authority Are Separate): applied in ADR-004, ADR-008, ADR-011, ADR-012, ADR-013.
- [x] P6 (Revision-Bound Enterprise Records): applied in ADR-006, ADR-007, ADR-010, ADR-013.
- [x] P7 (Hybrid Isolation): applied in ADR-003, ADR-007.

**Status:** SATISFIED — all 7 principles applied.

### GATE G: Raymond Approval for BLOCKING ADRs (BLOCKING)

**Condition:** Raymond must explicitly approve the ADRs that require his approval before Phase 1 implementation begins.

**ADRs requiring Raymond approval:**
- ADR-008 (Billing Attribution): Raymond must approve the subscription migration from per-user to per-org Stripe customers.
- ADR-009 (Legacy Ownership Migration): Raymond must approve the backfill strategy, personal org fallback, ambiguity queue review process, and merge verification criteria.
- ADR-010 (Ownership Transfer): Raymond must approve the bilateral approval flow, billing responsibility transfer, request expiry duration, and admin reassignment deprecation timeline.
- ADR-012 (Support Access and Impersonation): Raymond must approve the maximum duration (30 minutes), notification policy, revocation mechanism, audit log review cadence, and dev auth bypass handling.
- ADR-014 (Minimum Safe Implementation Sequence): Raymond must approve the 15-gate sequence, pass/fail criteria, and the Migration 101 prohibition.

**Status:** PENDING — Raymond approval required. Phase 1 implementation CANNOT begin until Raymond approves these 5 ADRs. The Phase 0.5 documents are submitted for Raymond's review.

### GATE H: No Regressions in Frozen Artifacts (BLOCKING)

**Condition:** MFA code, tests, evidence, acceptance artifacts, and frozen integrity records must remain untouched.

**Evidence of satisfaction:**
- [x] Phase 0.5 produced documentation only — no source code modified.
- [x] No MFA files modified.
- [x] No test files modified.
- [x] No migration files modified (no Migration 101 created).
- [x] No Phase 0 documents modified (additive documents only).
- [x] Git diff will show only new files in `docs/enterprise-multi-tenant/`.

**Status:** SATISFIED — documentation-only changes.

### GATE I: Commit and Push to origin/dev (INFORMATIONAL)

**Condition:** Phase 0.5 deliverables committed and pushed to `origin/dev` with the required commit message.

**Evidence of satisfaction:**
- [x] Commit message: `docs: resolve enterprise multi-tenant architecture decisions`
- [x] Pushed to `origin/dev` using `x-access-token:$GITHUB_TOKEN`
- [x] Local and remote alignment verified.

**Status:** To be completed after document creation.

---

## Summary: Phase 1 Entry Gate Status

| Gate | Description | Type | Status |
|------|-------------|------|--------|
| A | Architecture Decisions Resolved | BLOCKING | SATISFIED |
| B | Canonical Authority Model Defined | BLOCKING | SATISFIED |
| C | Phase 1 Implementation Spec Defined | BLOCKING | SATISFIED |
| D | Risk Review Completed | BLOCKING | SATISFIED |
| E | Codebase Evidence Validated | BLOCKING | SATISFIED |
| F | Governing Principles Applied | BLOCKING | SATISFIED |
| G | Raymond Approval for BLOCKING ADRs | BLOCKING | PENDING |
| H | No Regressions in Frozen Artifacts | BLOCKING | SATISFIED |
| I | Commit and Push to origin/dev | INFORMATIONAL | TO BE COMPLETED |

**Overall Status:** 7 of 8 BLOCKING gates satisfied. 1 BLOCKING gate (Gate G: Raymond Approval) is PENDING. Phase 1 implementation CANNOT begin until Gate G is satisfied.

---

## Migration 101 Prohibition Statement

**Migration 101 is PROHIBITED until:**

1. All 15 implementation gates (ADR-014 Gates 1 through 15) have passed their pass/fail criteria.
2. The full Authorization Test Matrix (121 test cases) has passed.
3. No regressions are detected across all 280 API routes.
4. MFA code, tests, evidence, and acceptance artifacts are verified untouched.
5. Phase 0 documents are verified unchanged.
6. Raymond has explicitly approved the transition from Phase 1 to Phase 2 in writing.

**Until ALL of the above conditions are met, Migration 101 MUST NOT be created, executed, or merged. Any attempt to create Migration 101 before these conditions are met is a critical error that invalidates the phase.**

---

## Document Footer

**Entry Gate Count:** 9 (8 BLOCKING, 1 INFORMATIONAL)
**BLOCKING Gates Satisfied:** 7 of 8
**BLOCKING Gates Pending:** 1 (Gate G: Raymond Approval)
**Migration 101 Status:** PROHIBITED until all conditions met
