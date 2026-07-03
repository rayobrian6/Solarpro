# SolarPro Compliance Prep Work

## Phase 3: Code-Level Compliance Enhancements
- [x] Add centralized tamper-evident audit logging — `lib/auditLog.ts`
- [x] Add migration 024 for audit_log table + MFA/consent fields — `migrations/024_audit_log_and_compliance_fields.sql`
- [x] Add MFA module (TOTP, encrypted secrets, recovery codes) — `lib/mfa.ts`
- [x] Add MFA setup API endpoint — `app/api/auth/mfa/setup/route.ts`
- [x] Add MFA verify API endpoint — `app/api/auth/mfa/verify/route.ts`
- [x] Add data export/delete API — `app/api/privacy/export-data/route.ts`
- [x] **Complete login route MFA integration** — fix SELECT query + add missing audit logs
- [x] Verify rate limiting coverage across all API routes — 56 routes patched, 11 remaining are webhooks/debug/acceptable
- [x] Implement session timeout enforcement (8hr admin, 24hr homeowner)
- [ ] Wire MFA enrollment into frontend (or document what frontend needs)
- [ ] Run migration 024 against DB (or provide instructions)

## Phase 4: Access Review & Onboarding/Offboarding
- [x] Document current access levels per role — REF-RBAC-001
- [x] Create onboarding checklist document — CHK-ONB-001
- [x] Create offboarding checklist document — CHK-OFB-001
- [x] Set quarterly access review cadence template — TMP-ACC-001
- [x] Enforce MFA on all external platforms (document requirements) — REF-MFA-001

## Phase 5: Compliance Documentation Infrastructure
- [ ] Create /compliance trust center page
- [ ] Create sub-processor disclosure page
- [ ] Add SOC 2 readiness section to enterprise page
- [ ] Create security questionnaire response template

## Phase 1-2: COMPLETE ✓
- [x] 11 policy documents (POL-SEC-001 through POL-SEC-011)
- [x] Risk register (RSK-001)
- [x] Sub-processor register (VND-001)
