# SolarPro — Next Compliance-Phase Plan: MFA → SOC 2 Trust Services Criteria & ISO 27001:2022 Control Mapping

**Date:** 2026-07-09  
**Author:** Automated compliance mapping (SolarPro CI agent)  
**Branch:** dev (commit `b9a2894a`)  
**Preceded by:** MFA Phase 3 acceptance testing — 37 automated tests passed (MFA disable/re-enable NOT tested — no endpoint exists)  
**Status:** SOC 2 readiness in progress — NOT certified. Security controls aligned with ISO 27001:2022 principles.  
**Classification:** Internal — Redacted

---

## 1. Purpose

This document maps the completed MFA implementation (Phases 1–3) to the SOC 2 Trust Services Criteria (TSC) and ISO/IEC 27001:2022 / ISO/IEC 27002:2022 control objectives. For each control, it identifies: evidence present, evidence missing, control gaps, recommended owner, and remediation workload. This is the bridge from "MFA is built and tested" to "what remains for SOC 2 / ISO 27001 readiness."

**Critical language:** All mappings in this document are internal readiness assessments. They have NOT been validated by an external auditor and do not constitute SOC 2 certification, ISO 27001 certification, or attestation of any kind. SolarPro is in SOC 2 readiness — not certified.

---

## 2. SOC 2 Trust Services Criteria — MFA Control Mapping

### 2.1 CC6.1 — The entity implements logical access security measures over physical and virtual components to protect against threats from sources outside its boundaries.

| Control Objective | Implementation Status | Evidence Present | Evidence Missing | Gap |
|-------------------|-----------------------|------------------|------------------|-----|
| TOTP second factor (RFC 6238) | ✅ Implemented + tested | `lib/mfa.ts` generateTOTPSecret/verifyTOTPCode; acceptance test T2.1–T2.2 PASS | — | — |
| AES-256-GCM encrypted TOTP secrets | ✅ Implemented + tested | `lib/mfa.ts` encryptTOTPSecret; MFA_ENCRYPTION_KEY health check (T0.2–T0.4 PASS) | Key rotation procedure not documented | Low — document rotation in POL-SEC-010 |
| Fail-closed design (no key = no MFA) | ✅ Implemented + tested | `lib/mfa.ts` throws if key missing/invalid; all MFA ops return 500 | — | — |
| Recovery codes (SHA-256 hashed) | ✅ Implemented + tested | `lib/mfa.ts` hashRecoveryCode; acceptance test T5.1–T5.3 PASS (single-use + reuse failure) | — | — |
| No plaintext secrets in storage | ⚠️ Source-verified only | Source review T10.3 — `lib/mfa.ts` encrypts TOTP secrets (AES-256-GCM) and hashes recovery codes (SHA-256) before storage | Direct DB query to confirm `mfa_secret_encrypted` and `code_hash` columns contain only encrypted/hashed values was NOT performed | Medium — DB/log verification required to make this claim |
| No plaintext secrets in logs | ⚠️ Source-verified only | Source review T10.5 — log statements use only error messages + user IDs | Direct inspection of Vercel runtime function logs was NOT performed | Medium — log inspection required to make this claim |
| Rate limiting on auth endpoints | ✅ Implemented + tested | `lib/rateLimiter.ts`: login 5/60s, mfa_verify 10/5min, mfa_setup 3/15min; T8.1–T8.2 PASS (429 confirmed) | — | — |
| MFA enforcement for admin/super_admin | ✅ Implemented | `lib/mfa.ts` isMFARequiredButNotEnabled; login route issues MFA_ENROLLMENT_REQUIRED | End-to-end test with admin account (test account is role `user`) | Low — promote test account to admin (data change, no migration) |
| MFA enforcement for 'staff' role | ⚠️ Inconsistency found | `MFA_REQUIRED_ROLES` in `lib/mfa.ts` includes 'staff' | **No CHECK constraint exists on the `role` column** (migration 006 defines `role TEXT NOT NULL DEFAULT 'user'` with a comment only). Application-level validation (`app/api/admin/users/route.ts` line 150) allows `['user', 'admin', 'super_admin', 'sales']` — 'staff' is NOT assignable. The `staff` role does not exist as a functional role. See Acceptance Record Section 7 (Staff Role Audit) | Medium — resolve via Option A (remove 'staff' from `MFA_REQUIRED_ROLES` — code+doc change, no migration) or Option B (implement 'staff' as a real role — requires Migration 101, Raymond's approval required) |

**CC6.1 Evidence Summary:** 7 of 9 control objectives fully implemented and tested. 2 require further verification: (1) plaintext-secrets claims are source-verified only — direct DB/log inspection was NOT performed; (2) 'staff' role inconsistency — `staff` is in `MFA_REQUIRED_ROLES` but is not a functional role (no CHECK constraint exists on the `role` column; application validation does not allow `staff`). Evidence files: `MFA-PHASE3-ACCEPTANCE-TEST-RECORD.md` (Section 2 Evidence Classification, Section 7 Staff Role Audit), `MFA-PHASE3-ACCEPTANCE-TEST-RESULTS.json`, `COMPLIANCE_READINESS_REPORT.md` Section 5.2.

### 2.2 CC6.2 — The entity registers and authorizes new internal and external users and disables access for users no longer requiring access.

| Control Objective | Implementation Status | Evidence Present | Evidence Missing | Gap |
|-------------------|-----------------------|------------------|------------------|-----|
| MFA enrollment flow (self-service) | ✅ Implemented + tested | `SecurityPanel.tsx` + `/auth/mfa/enroll`; acceptance test T2.1–T2.3 PASS | — | — |
| Enrollment-required forced flow | ✅ Implemented (source-verified) | Login → MFA_ENROLLMENT_REQUIRED → enrollment pending cookie → /auth/mfa/enroll; T1.1–T1.10 source PASS | End-to-end operational test with admin account | Low — requires admin test account |
| Enrollment pending cookie (restricted) | ✅ Implemented + tested | 10-min TTL, path=/api/auth/mfa, not a full session; T7.1–T7.2 PASS | — | — |
| MFA disable / de-enrollment | ⛔ NOT TESTED (no endpoint) | No disable endpoint exists (deliberate security design choice). This is NOT a passed test and NOT a deferred test — the scenario could not be tested because the endpoint does not exist. | A secure administrator MFA reset procedure has been proposed (see Acceptance Record Section 6): super_admin authority, reauthentication, audit logging, atomic transaction, session invalidation, no public endpoint | Medium — implement proposed reset procedure per Acceptance Record Section 6 |
| Recovery code regeneration | ❌ Not implemented | — | "Regenerate recovery codes" UI in SecurityPanel | Medium — future feature for MFA-enabled users |
| User de-provisioning on offboarding | ✅ Policy exists | `CHK-OFB-001-Offboarding-Checklist.md` | Automated de-provisioning workflow | Low — checklist exists; automation is future work |

**CC6.2 Evidence Summary:** 3 of 6 fully implemented and tested. 1 not tested (no disable endpoint exists — deliberate design choice, not a deferred test). 2 not yet implemented (recovery code regeneration, MFA disable/reset). 1 has policy but needs automation. A secure admin MFA reset procedure has been proposed (Acceptance Record Section 6) but not implemented.

### 2.3 CC6.3 — The entity controls access to system assets by authorized users and removes access when no longer needed.

| Control Objective | Implementation Status | Evidence Present | Evidence Missing | Gap |
|-------------------|-----------------------|------------------|------------------|-----|
| Role-based access control (RBAC) | ⚠️ Implemented (no DB constraint) | Admin layout gate; PATCH /api/admin/users set_role; `app/api/admin/users/route.ts` line 150 validates roles to `['user', 'admin', 'super_admin', 'sales']` | **No CHECK constraint exists on the `role` column** (migration 006 has `role TEXT NOT NULL DEFAULT 'user'` with comment only). `REF-RBAC-001-Role-Access-Matrix.md` defines 5 roles but only 4 are assignable in code. 'staff' is defined in the matrix but not assignable. DB-level constraint to enforce allowed role values is missing | Low-Medium — add CHECK constraint in a future migration (Migration 101, requires Raymond's approval) or document the application-level validation as the enforcement mechanism |
| Atomic recovery code consumption | ✅ Implemented + tested | `UPDATE ... WHERE used=false RETURNING id`; T5.2 PASS (reuse fails) | — | — |
| Session JWT (identity only, no role) | ✅ Implemented + tested | `lib/auth.ts` signToken — role NOT in JWT, always read from DB; T4.2b PASS | — | — |
| Session staleness check | ✅ Implemented | `app/api/auth/me/route.ts` isSessionStale against password_changed_at | — | — |
| MFA pending cookie single-use | ✅ Implemented + tested | 5-min TTL, cleared after verify (maxAge=0); T4.1a, T4.2a PASS | — | — |
| Quarterly access review | ✅ Policy exists | `TMP-ACC-001-Quarterly-Access-Review.md` | Evidence of completed reviews | Low — schedule first review |

**CC6.3 Evidence Summary:** 5 of 6 fully implemented and tested. 1 has policy template but no evidence of completed review.

### 2.4 CC7.2 — The entity monitors system components and the operation of those components for anomalies that are indicative of malicious acts that may compromise the entity's ability to meet its objectives.

| Control Objective | Implementation Status | Evidence Present | Evidence Missing | Gap |
|-------------------|-----------------------|------------------|------------------|-----|
| SHA-256 hash-chained audit log | ✅ Implemented | `lib/auditLog.ts` prev_hash/entry_hash; Migration 100 `audit_log` table | Direct DB query for hash chain integrity | Medium — requires DB access to verify chain |
| MFA audit events (all transitions) | ✅ Implemented + operationally verified | mfa_setup_initiated, mfa_enabled, mfa_challenge_issued, mfa_challenge_success, mfa_challenge_failure, mfa_recovery_code_used, mfa_recovery_code_failed, mfa_enrollment_required, mfa_failure; T9.1 PASS | Direct query of audit_log table to verify event payloads | Medium — requires DB access |
| Login audit events | ✅ Implemented + operationally verified | login_success, login_failure (with reason: user_not_found, invalid_password, legacy_hash_reset_required); T9.1 PASS | — | — |
| Security audit events | ✅ Implemented | `auditSecurity()` for mfa_enrollment_required, mfa_failure | — | — |
| Monitoring / alerting (Sentry) | ❌ Not configured | Health endpoint shows `monitoring.ok: false, provider: 'console-only'` | Sentry DSN not set on dev | Medium — configure Sentry DSN on dev + prod |
| SIEM / log aggregation | ❌ Not implemented | Vercel function logs only (console) | Centralized log aggregation (Datadog, Logtail, or similar) | High — future infrastructure investment |

**CC7.2 Evidence Summary:** 4 of 6 fully implemented. 2 not configured (Sentry monitoring, SIEM/log aggregation). Audit event verification is source-level + operational (no throws) but direct DB query for hash chain integrity is deferred.

---

## 3. ISO 27001:2022 / ISO 27002:2022 — MFA Control Mapping

### 3.1 A.5.17 — Authentication information

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| TOTP secret generation (RFC 6238) | ✅ Implemented | `lib/mfa.ts` generateTOTPSecret (20-byte random, base32) | — |
| MFA pending cookie (5-min TTL) | ✅ Implemented + tested | `lib/auth.ts` MFA_PENDING_COOKIE; T4.1a PASS | — |
| Enrollment pending cookie (10-min TTL, restricted) | ✅ Implemented + tested | `lib/auth.ts` MFA_ENROLLMENT_PENDING_COOKIE; T7.1–T7.2 PASS | — |
| Recovery codes (SHA-256 hashed, single-use) | ✅ Implemented + tested | `lib/mfa.ts` hashRecoveryCode; T5.1–T5.3 PASS | — |

### 3.2 A.8.5 — Secure authentication

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| MFA enforced for privileged roles | ✅ Implemented | `lib/mfa.ts` isMFARequiredButNotEnabled for admin/super_admin | 'staff' is in `MFA_REQUIRED_ROLES` but is not a functional role (no CHECK constraint on `role` column; not in application role validation). See Acceptance Record Section 7 (Staff Role Audit). Mandatory admin/super_admin enforcement source-verified only — no operational test with admin account |
| TOTP verification (±1 step window) | ✅ Implemented + tested | `lib/mfa.ts` verifyTOTPCode; T2.2, T4.2 PASS | — |
| Rate limiting on authentication | ✅ Implemented + tested | `lib/rateLimiter.ts`; T8.1–T8.2 PASS | — |
| No MFA bypass for admins | ✅ Implemented (by absence) | No bypass endpoint exists; fail-closed design | Document emergency access procedure per POL-SEC-009 |

### 3.3 A.8.16 — Monitoring of systems

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| Hash-chained audit log | ✅ Implemented | `lib/auditLog.ts`; Migration 100 | Direct hash chain verification (DB access) |
| MFA state transition audit events | ✅ Implemented + verified | 9 distinct MFA audit event types; T9.1 PASS | — |
| Real-time monitoring/alerting | ❌ Not configured | Health: monitoring.ok=false | Configure Sentry or equivalent |

### 3.4 A.8.15 — Logging of events

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| Audit log table (tamper-evident) | ✅ Implemented | Migration 100 `audit_log` with hash chain | — |
| Recovery code consumption logged | ✅ Implemented + tested | mfa_recovery_code_used, mfa_recovery_code_failed (race condition); T9.1 PASS | — |
| Login events logged | ✅ Implemented + tested | login_success, login_failure; T9.1 PASS | — |
| Log retention policy | ✅ Policy exists | `POL-SEC-007-Data-Retention-and-Disposal-Policy.md` | Operational enforcement of retention period |

### 3.5 A.5.18 — Access rights

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| RBAC (application-level validation) | ⚠️ Implemented (no DB constraint) | `app/api/admin/users/route.ts` line 150 validates to `['user', 'admin', 'super_admin', 'sales']`; role changes require super_admin | **No `users_role_check` CHECK constraint exists** — migration 006 defines `role TEXT NOT NULL DEFAULT 'user'` with comment only. The prior documentation's reference to a `users_role_check` constraint was incorrect. DB-level enforcement of allowed role values is missing. 'staff' is in the RBAC matrix and `MFA_REQUIRED_ROLES` but is not assignable |
| Role always from DB (not JWT) | ✅ Implemented + tested | `app/api/auth/me/route.ts`; T4.2b PASS | — |
| Admin panel access gated by role | ✅ Implemented | `app/admin/layout.tsx` line 61 | — |
| Role change requires super_admin | ✅ Implemented | `app/api/admin/users/route.ts` PATCH set_role | — |

### 3.6 A.5.16 — Identity management

| Control | Implementation Status | Evidence | Gap |
|---------|-----------------------|----------|-----|
| User registration (default role user) | ✅ Implemented + tested | `app/api/auth/register/route.ts`; T1.1 PASS | — |
| MFA enrollment required for privileged roles | ⚠️ Implemented (source-verified only) | Login → MFA_ENROLLMENT_REQUIRED; T1.1–T1.10 source PASS. `lib/mfa.ts` isMFARequiredButNotEnabled for admin/super_admin | End-to-end operational test with admin account NOT performed — test account has role `user` (voluntary MFA), not `admin` (mandatory MFA). Mandatory admin/super_admin enforcement verified at source-code level only |
| No self-registration as admin | ✅ Implemented | Registration assigns role 'user' only; role changes require super_admin | — |

---

## 4. Evidence Inventory

### 4.1 Evidence Present (Verified)

| Evidence | Location | Verification Method |
|----------|----------|---------------------|
| MFA source code | `lib/mfa.ts`, `lib/auth.ts`, `app/api/auth/mfa/setup/route.ts`, `app/api/auth/mfa/verify/route.ts`, `app/api/auth/login/route.ts` | Source review + acceptance testing |
| MFA acceptance test results (37 passed; disable NOT tested) | `docs/compliance/MFA-PHASE3-ACCEPTANCE-TEST-RECORD.md`, `MFA-PHASE3-ACCEPTANCE-TEST-RESULTS.json` | Automated test suite against dev deployment (Tier 1 operational + Tier 2 source verification; Tier 3 DB/log verification NOT performed) |
| MFA acceptance test script | `docs/compliance/MFA-PHASE3-ACCEPTANCE-TEST-SCRIPT.py` | Executed against solarpro-dev.vercel.app |
| Compliance readiness report | `docs/compliance/COMPLIANCE_READINESS_REPORT.md` | Updated with operational verification results |
| MFA_ENCRYPTION_KEY health check | `/api/system/health` endpoint (commit `ad20626e`) | HTTP GET — configured=true, valid_length=true |
| Audit log schema (Migration 100) | `lib/migrations/100_compliance_audit_mfa_consent.sql` | Source review — complete and verified |
| Rate limiter configuration | `lib/rateLimiter.ts` | Source review + 429 operational test |
| Password & Authentication policy | `docs/compliance/POL-SEC-009-Password-and-Authentication-Policy.md` | Policy document (MFA section 4) |
| Access Control policy | `docs/compliance/POL-SEC-003-Access-Control-Policy.md` | Policy document (RBAC section 3) |
| Risk register | `docs/compliance/RSK-001-Risk-Register-and-Assessment.md` | Policy document (RSK-001 credential risk) |
| Role access matrix | `docs/compliance/REF-RBAC-001-Role-Access-Matrix.md` | Reference document |

### 4.2 Evidence Missing (To Be Produced)

| Missing Evidence | Required For | Owner | Workload | Method |
|------------------|-------------|-------|----------|--------|
| End-to-end MFA_ENROLLMENT_REQUIRED test with admin account | CC6.2, A.5.16 | Raymond (promote test account) or agent (if given DB access) | Low (data change) | Promote `mfatest@solarpro.solutions` to `admin` via PATCH /api/admin/users, then re-run acceptance test |
| Direct audit_log table query for hash chain integrity | CC7.2, A.8.16 | Ops engineer with DB access | Low (1 query) | `SELECT id, action, prev_hash, entry_hash, created_at FROM audit_log ORDER BY id DESC LIMIT 20` — verify each entry_hash = SHA256(prev_hash + payload) |
| Sentry DSN configuration on dev + prod | CC7.2, A.8.16 | Raymond / DevOps | Low (env var) | Set SENTRY_DSN in Vercel env vars for both projects |
| Evidence of first quarterly access review | CC6.3, A.5.18 | Security Lead | Medium (process) | Complete `TMP-ACC-001-Quarterly-Access-Review.md` with actual review data |
| 'staff' role resolution (code or schema) | CC6.1, A.8.5, A.5.18 | Developer | Medium (Migration 101 if schema, or code change if deprecating 'staff') | **Option A (code+doc only):** Remove 'staff' from `MFA_REQUIRED_ROLES` in `lib/mfa.ts` line 42, update RBAC matrix and POL-SEC-009 — no migration required. **Option B (schema):** Implement 'staff' as a real role — add to application validation in `app/api/admin/users/route.ts` line 150, add CHECK constraint via Migration 101 (`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin', 'staff', 'sales'))`). **Migration 101 must NOT be created without Raymond's explicit approval.** No action taken — see Acceptance Record Section 7. |
| MFA key rotation procedure documentation | CC6.1, A.8.16 | Security Lead | Low (documentation) | Document rotation steps in POL-SEC-010-Encryption-Policy.md |
| Emergency access procedure (MFA bypass) | CC6.1, A.8.5 | Security Lead | Low (documentation) | Document break-glass procedure per POL-SEC-009 section 4.4 |

---

## 5. Control Gaps & Remediation Roadmap

### 5.1 High-Priority Gaps

| Gap | SOC 2 TSC | ISO 27001 | Risk | Remediation | Owner | Effort |
|-----|-----------|-----------|------|-------------|-------|--------|
| Monitoring/alerting not configured (Sentry) | CC7.2 | A.8.16 | High — no real-time anomaly detection | Set SENTRY_DSN env var on dev + prod Vercel projects | Raymond / DevOps | 2 hours |
| SIEM / log aggregation not implemented | CC7.2 | A.8.16 | High — audit logs in DB only, no centralized aggregation | Evaluate Datadog, Logtail, or Vercel Log Drains | Raymond / DevOps | 2–3 days |
| 'staff' role inconsistency | CC6.1 | A.8.5, A.5.18 | Medium — 'staff' is in `MFA_REQUIRED_ROLES` but is not a functional role; no CHECK constraint exists on `role` column; application validation does not allow 'staff' | Option A: Remove 'staff' from `MFA_REQUIRED_ROLES` (code+doc change, no migration). Option B: Implement 'staff' as a real role (requires Migration 101 — Raymond's approval required). See Acceptance Record Section 7. | Developer | 4 hours (Option A) / 1–2 days (Option B) |

### 5.2 Medium-Priority Gaps

| Gap | SOC 2 TSC | ISO 27001 | Risk | Remediation | Owner | Effort |
|-----|-----------|-----------|------|-------------|-------|--------|
| Recovery code regeneration not implemented | CC6.2 | A.5.17 | Medium — users cannot regenerate after using all codes | Add "Regenerate recovery codes" UI in SecurityPanel (requires re-auth) | Developer | 1–2 days |
| MFA disable / reset endpoint not implemented | CC6.2 | A.5.17 | Medium (by design) — no admin-approved de-enrollment or reset path; NOT tested (no endpoint exists) | Implement proposed secure admin MFA reset procedure (Acceptance Record Section 6): super_admin authority, reauthentication, audit logging, atomic transaction, session invalidation, no public endpoint | Developer | 2–3 days |
| Direct audit_log hash chain verification | CC7.2 | A.8.16 | Medium — hash chain integrity not directly verified | Run DB query to verify chain: `SELECT id, action, prev_hash, entry_hash, created_at FROM audit_log ORDER BY id DESC LIMIT 20` — verify each `entry_hash = SHA256(prev_hash + payload)`. DB/log inspection was NOT performed during acceptance testing (Tier 3) | Ops engineer | 2 hours |
| WebAuthn / FIDO2 MFA method | CC6.1 | A.8.5 | Medium — only TOTP supported (phishing-resistant method absent) | Implement WebAuthn as additional MFA method | Developer | 1–2 weeks |
| Quarterly access review not yet executed | CC6.3 | A.5.18 | Medium — no evidence of completed review | Schedule and complete first quarterly access review | Security Lead | 1 day |

### 5.3 Low-Priority Gaps

| Gap | SOC 2 TSC | ISO 27001 | Risk | Remediation | Owner | Effort |
|-----|-----------|-----------|------|-------------|-------|--------|
| MFA key rotation procedure not documented | CC6.1 | A.8.16 | Low — key is configured and valid | Document rotation steps in POL-SEC-010 | Security Lead | 2 hours |
| Emergency access (break-glass) procedure not documented | CC6.1 | A.8.5 | Low — no bypass exists (good), but no documented emergency path | Document break-glass procedure in POL-SEC-009 | Security Lead | 2 hours |
| End-to-end admin enrollment test | CC6.2 | A.5.16 | Low — source-verified, API mechanics tested | Promote test account to admin, re-run acceptance test | Raymond or agent | 1 hour |
| Production deployment of MFA Phase 3 | — | — | Low (dev fully tested) | Raymond's decision to merge dev → master | Raymond | Raymond's call |

---

## 6. Risk Register Update Required

The existing risk register (`RSK-001-Risk-Register-and-Assessment.md`) RSK-001 (Unauthorized Data Access via Compromised Credentials) currently states:

- **Current Controls:** "JWT HS256 auth, timing-safe comparison, rate limiting on some routes"
- **Gap:** "No MFA enforcement for admin/staff; no breached password screening; incomplete rate limiting"
- **ISO 27001:** "A.9.2.2, A.9.4.2" (2013 numbering — should be A.5.17, A.8.5 per 2022 update)

**Required updates:**
1. Update Current Controls to include: "TOTP MFA (RFC 6238) enforced for admin/super_admin, AES-256-GCM encrypted secrets, atomic recovery codes, SHA-256 hash-chained audit logging, rate limiting on all auth endpoints"
2. Update Gap to: "'staff' role is in `MFA_REQUIRED_ROLES` but is not a functional role (no CHECK constraint on `role` column; application validation does not allow 'staff') — see Acceptance Record Section 7. Breached password screening not implemented. Sentry monitoring not configured. Direct DB/log verification of plaintext-secret claims not yet performed"
3. Update ISO 27001 references from 2013 to 2022 numbering: A.9.2.2 → A.5.17, A.9.4.2 → A.8.5
4. Update Target Risk Level: MFA enforcement now implemented → likelihood reduced from 4 to 2 → risk level reduced from Critical to High (still High due to monitoring gap)

---

## 7. Remediation Priority Order

Based on the gap analysis, the recommended order of remediation work is:

1. **Immediate (Raymond action required):** Configure Sentry DSN on dev + prod — closes the highest-risk gap (no monitoring)
2. **Immediate (agent can do with DB access):** Verify audit_log hash chain integrity via direct DB query; confirm `mfa_secret_encrypted` and `code_hash` columns contain only encrypted/hashed values (Tier 3 verification)
3. **Short-term (1–2 days):** Resolve 'staff' role inconsistency (Option A: remove from `MFA_REQUIRED_ROLES` — code+doc change, no migration; or Option B: Migration 101 — Raymond's approval required); implement recovery code regeneration UI
4. **Short-term (documentation):** Update RSK-001 risk register; document MFA key rotation; document emergency access procedure
5. **Medium-term (1–2 weeks):** Implement WebAuthn/FIDO2 as additional MFA method; implement secure admin MFA reset procedure per Acceptance Record Section 6 (no public disable endpoint — super_admin authority, reauthentication, audit logging, atomic transaction)
6. **Medium-term (infrastructure):** Evaluate and implement SIEM / log aggregation
7. **Ongoing:** First quarterly access review; schedule recurring reviews per TMP-ACC-001

---

## 8. What the Agent Can Do Next (Without Raymond)

The following remediation items can be performed by the agent without requiring Raymond's manual intervention:

| Item | Action | Constraint |
|------|--------|------------|
| Update RSK-001 risk register | Correct ISO numbering (2013→2022), update controls/gaps to reflect MFA implementation | Documentation only — no code/migration changes |
| Document MFA key rotation procedure | Add rotation section to POL-SEC-010-Encryption-Policy.md | Documentation only |
| Document emergency access (break-glass) procedure | Add break-glass section to POL-SEC-009 | Documentation only |
| Fix 'staff' role inconsistency (code approach) | Remove 'staff' from `MFA_REQUIRED_ROLES` if role is deprecated (Option A — code+doc change, no migration), OR flag for Migration 101 if role is intended (Option B — requires Raymond's approval) | Code change requires Raymond's confirmation on whether 'staff' role is intended to exist. **No CHECK constraint exists on the `role` column** — prior documentation's reference to a `users_role_check` constraint was incorrect. See Acceptance Record Section 7. |
| Recovery code regeneration UI | Implement in SecurityPanel.tsx with re-auth requirement | Code change on dev — would need testing + commit |

The following items require Raymond specifically:

| Item | Why Raymond |
|------|-------------|
| Configure Sentry DSN | Requires Vercel dashboard access (env vars) |
| SIEM / log aggregation | Infrastructure decision + cost approval |
| Promote test account to admin | Requires super_admin auth (Raymond's account) or DB access |
| Merge dev → master (production deployment) | Explicitly Raymond's decision per directive |
| 'staff' role: schema change (Migration 101) | Requires confirmation that 'staff' is an intended role. No CHECK constraint currently exists on the `role` column — adding one requires a migration. **Migration 101 must NOT be created without Raymond's explicit approval.** |
| WebAuthn implementation | Architectural decision + significant development effort |

---

## 9. Summary

The MFA implementation (Phases 1–3) is **complete, deployed on dev, and acceptance-tested (37 automated tests passed; MFA disable/re-enable NOT tested — no endpoint exists, deliberate design choice)**. It establishes security controls aligned with SOC 2 CC6.1, CC6.2, CC6.3, CC7.2 and ISO 27001:2022 A.5.16, A.5.17, A.5.18, A.8.5, A.8.15, A.8.16.

**Readiness posture:**
- **Strong (operationally verified — Tier 1):** MFA enrollment, TOTP verification, recovery code single-use/reuse-failure, cookie scoping, rate limiting (429 confirmed), API response field inspection (no encrypted secret or hash exposed)
- **Adequate (source-code verified — Tier 2):** Encryption algorithm, secret storage format, recovery code hashing, audit event call sites, hash-chain implementation, log-statement content, MFA enforcement for admin/super_admin, enrollment-required flow
- **NOT YET PERFORMED (Tier 3 — database/log verification):** Direct DB query of `mfa_secret_encrypted` and `code_hash` columns; direct DB query of `audit_log` table for hash chain integrity and event payloads; direct inspection of Vercel runtime function logs for secret values
- **Gaps to close:** Monitoring/alerting (Sentry), SIEM/log aggregation, 'staff' role inconsistency (not a functional role — no CHECK constraint on `role` column; see Acceptance Record Section 7), recovery code regeneration, secure admin MFA reset procedure (proposed in Acceptance Record Section 6 — not implemented), WebAuthn, quarterly access review execution, mandatory admin/super_admin MFA enforcement operational test

**SolarPro is in SOC 2 readiness — NOT certified. Security controls are aligned with ISO 27001:2022 principles. All mappings are internal readiness assessments and have not been validated by an external auditor.**

---

*This plan maps the completed MFA implementation to SOC 2 Trust Services Criteria and ISO/IEC 27001:2022 controls for internal readiness planning. It does not constitute certification, attestation, or auditor validation of any kind.*
