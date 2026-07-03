# Migration 100: Deployment Instructions

**Document ID:** OPS-MIG-100  
**Category:** Operations — Database Migration  
**Compliance Mapping:** SOC 2 CC6.1, CC7.2; ISO 27001 A.12.4, A.9.2.1  
**Last Updated:** July 2025  
**Status:** Ready to Deploy

---

## Overview

Migration `100_compliance_audit_mfa_consent.sql` adds the database schema required for SolarPro's compliance features:

1. **`audit_log` table** — Tamper-evident, hash-chained audit logging for SOC 2 CC7.2 evidence
2. **MFA columns on `users` table** — `mfa_enabled`, `mfa_method`, `mfa_secret_encrypted`, `mfa_verified_at`, `mfa_enrolled_at`
3. **`mfa_recovery_codes` table** — Single-use, SHA-256-hashed recovery codes for TOTP MFA
4. **Consent tracking columns on `users` table** — `consent_privacy_at`, `consent_terms_at`, `consent_cookie_at`, `consent_marketing_at`, `data_deletion_requested_at`

All statements use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, making this migration safe to run multiple times (idempotent).

The migration is available in **two forms**:
- **SQL file**: `lib/migrations/100_compliance_audit_mfa_consent.sql` — for manual execution
- **Inline DDL**: Added to `app/api/migrate/route.ts` as Migration 100 — for the standard `/api/migrate` runner

---

## Deployment

### Option A: Standard Migration Runner (Recommended)

This is the same way all other migrations are applied. Call the `/api/migrate` endpoint after deploying the code:

```bash
curl -X POST https://your-app.vercel.app/api/migrate \
  -H "Content-Type: application/json" \
  -d '{"secret": "YOUR_MIGRATE_SECRET"}'
```

Migration 100 will run automatically alongside any other pending migrations. The idempotent checks ensure it's safe even if the tables already exist.

### Option B: Neon SQL Editor

1. Log into the [Neon Console](https://console.neon.tech)
2. Select the SolarPro project
3. Open the SQL Editor
4. Copy the contents of `lib/migrations/100_compliance_audit_mfa_consent.sql`
5. Paste and execute

### Option C: psql via Connection String

```bash
psql "postgresql://username:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require" \
  -f lib/migrations/100_compliance_audit_mfa_consent.sql
```

---

## Post-Deployment Verification

### Verify tables exist

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('audit_log', 'mfa_recovery_codes');
```

Expected: `audit_log`, `mfa_recovery_codes`

### Verify columns on users table

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'mfa_enabled', 'mfa_method', 'mfa_secret_encrypted',
    'mfa_verified_at', 'mfa_enrolled_at',
    'consent_privacy_at', 'consent_terms_at', 'consent_cookie_at',
    'consent_marketing_at', 'data_deletion_requested_at'
  )
ORDER BY column_name;
```

Expected: 10 rows.

### Verify indexes

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('audit_log', 'mfa_recovery_codes')
ORDER BY indexname;
```

Expected: `idx_audit_log_action`, `idx_audit_log_actor_id`, `idx_audit_log_category`, `idx_audit_log_entry_hash`, `idx_audit_log_target`, `idx_audit_log_timestamp`, `idx_mfa_recovery_codes_unused`, `idx_mfa_recovery_codes_user`

---

## Rollback Plan

```sql
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS audit_log;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_method;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_secret_encrypted;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_enrolled_at;
ALTER TABLE users DROP COLUMN IF EXISTS consent_privacy_at;
ALTER TABLE users DROP COLUMN IF EXISTS consent_terms_at;
ALTER TABLE users DROP COLUMN IF EXISTS consent_cookie_at;
ALTER TABLE users DROP COLUMN IF EXISTS consent_marketing_at;
ALTER TABLE users DROP COLUMN IF EXISTS data_deletion_requested_at;
```

**⚠️ Warning**: Rolling back after audit_log entries exist will permanently delete compliance evidence. Only rollback if the migration was applied in error before the features went live.

---

## Feature Activation Sequence

1. Deploy application code (Vercel picks up the new API routes + migrate route changes)
2. Run `/api/migrate` to apply migration 100
3. Audit logging (`lib/auditLog.ts`) — Already wired in auth routes, writes to `audit_log` immediately
4. MFA Setup/Verify (`app/api/auth/mfa/setup`, `app/api/auth/mfa/verify`) — Fully functional
5. Data Export/Delete (`app/api/privacy/export-data`) — Uses `data_deletion_requested_at` column
6. Build frontend MFA UI per REF-MFA-002
