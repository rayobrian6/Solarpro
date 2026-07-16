# Migration System Read-Only Audit — Pre-Implementation

> Branch: `dev` at `d7b8e400` (aligned with `origin/dev`, clean worktree)
> Purpose: Complete documentation of the migration system state before Phase 1A
> implementation, satisfying the read-only audit requirement of the Phase 1A spec.
> This document is the authoritative reference for all architecture decisions that follow.

## 1. Migration File Inventories

### 1.1 Primary directory: `lib/migrations/`

- **Total SQL files:** 101
- **Highest prefix:** 104 (`104_seed_manufacturer_assets.sql`)
- **No non-SQL files** (no `.sha256` sidecar files, no `.js` files)
- **Gaps (reserved, not missing):** `009`, `012`, `013`, `014` — these prefixes have
  no file. Gaps between 008→010 and 011→015.
- **Duplicate prefix:** `074` — two distinct files share the prefix:
  - `074_photo_vision_jobs_dedup_index.sql`
  - `074_photo_vision_jobs_render_job_id.sql`
  - This is a historical anomaly (two unrelated schema changes assigned the same
    sequence number at different times).

### 1.2 Legacy directory: `migrations/` (repository root)

- **Total SQL files:** 17, plus 1 JS file (`add_is_global_column.js`) and 1 seed
  file (`seed_solardog_knowledge.sql`).
- **Prefix range:** 009–023.
- **Duplicate prefix:** `017` — two files: `017_physical_data_additions.sql` and
  `017_site_surveys_external_id_unique.sql`.
- **Gaps:** `001`–`008` have no files in this directory.
- **Purpose determination:** This is an **older duplicate copy** of a subset of the
  primary migrations. Files `009`–`023` overlap in numeric range with the primary
  directory but are not referenced by either active runner. The primary runner
  (`system-tools/route.ts`) reads exclusively from `lib/migrations/`. The inline
  runner (`migrate/route.ts`) embeds SQL inline and does not read from either
  directory for migrations 003–022+. The seed file `seed_solardog_knowledge.sql`
  is also present in the inline runner as a function call
  (`solardogSeedKnowledge`).
- **Disposition:** Treat as frozen historical artifact. Do not execute from this
  directory. Document its existence in the reconciliation inventory. It should not
  be part of the authoritative manifest.

## 2. Migration Entry Points — Full Documentation (15-Field Schema)

### Entry Point 1: `app/api/migrate/route.ts` (Inline SQL Runner)

| Field | Value |
|---|---|
| **File / size** | `app/api/migrate/route.ts`, 4223 lines |
| **HTTP method** | POST only. GET returns 405. |
| **Caller(s)** | `app/admin/database/page.tsx` (admin UI, prompts for MIGRATE_SECRET), `app/settings/page.tsx` |
| **Auth model** | Shared secret: requires `MIGRATE_SECRET` in JSON body, compared via `timingSafeEqual`. No session/JWT. No role check. |
| **Env restrictions** | None — callable in any environment if MIGRATE_SECRET is known. No production disable. |
| **SQL source** | Inline DDL embedded directly in the route file (migrations 003–022+). Not read from migration files. Also calls `solardogSeedKnowledge()`. |
| **Ordering** | Hard-coded sequential execution of inline statements. No file-based ordering. |
| **Transaction wrapping** | **NONE.** Each operation in individual try/catch. Partial application possible. |
| **Checksum validation** | **NONE.** No checksums computed or verified. |
| **Retry / resilience** | `checkRateLimit('migrate', getClientIp(req))` for rate limiting. Uses `getDbReady()` with cold-start retry. |
| **Failure behavior** | Tolerates "already exists" errors (idempotent-ish). Other errors collected and returned. No ledger record of what succeeded/failed. |
| **Audit trail** | **NONE.** No `schema_migrations` ledger. No audit event emission. Console logs only. |
| **Production accessibility** | **Fully accessible** in production if MIGRATE_SECRET known. No environment gate. |
| **Risk** | **CRITICAL.** Single secret grants full DDL. No ledger → no state. No transactions → partial application. Inline SQL drifts from files → divergence. No checksum → tampering undetectable. |
| **Recommended disposition** | **Deprecate execution path.** Convert to a wrapper that delegates to the canonical runner for diagnostics only, OR restrict to read-only health checks. Retain the file (do not delete in Phase 1A) but gate its mutation path behind a feature flag and emit a deprecation audit event when invoked. |

### Entry Point 2: `app/api/admin/system-tools/route.ts` (File-Based Runner)

| Field | Value |
|---|---|
| **File / size** | `app/api/admin/system-tools/route.ts`, 969 lines |
| **HTTP method** | POST with `tool` param (`run_migration`, `list_migrations`, `set_user_password`, etc.) |
| **Caller(s)** | `app/admin/system-tools/page.tsx` (admin UI with file dropdown + confirm modal) |
| **Auth model** | `requireAdminApi(req)` → JWT session cookie + DB role fetch. Requires `super_admin` role. For `set_user_password`, additionally requires MIGRATE_SECRET as second factor. |
| **Env restrictions** | None — no production disable. super_admin in any env can run. |
| **SQL source** | Reads `.sql` files from `lib/migrations/` directory via `fs.readFileSync`. |
| **Ordering** | Caller selects a single file from dropdown. No sequential/pending concept. Manual selection. |
| **Transaction wrapping** | **NONE.** SQL split by semicolons, each statement executed individually. Partial application possible. |
| **Checksum validation** | **OPTIONAL.** Only if a `.sha256` sidecar file exists alongside the `.sql`. Currently **zero** sidecar files exist, so validation never triggers. |
| **Retry / resilience** | Uses `neon(process.env.DATABASE_URL!)` directly (not `getDbReady`, no cold-start retry). Ignores "already exists" errors. |
| **Failure behavior** | Errors collected per-statement, returned in response. No ledger. |
| **Audit trail** | **NONE.** No `schema_migrations` ledger. No audit event emission. |
| **Production accessibility** | **Accessible** to any super_admin in production. No environment gate. |
| **Risk** | **HIGH.** No mandatory checksum (optional only, currently never enforced). No ledger → no state. No transactions. No advisory locks → concurrent execution risk. Splits SQL by semicolon (fragile: string literals with semicolons, functions, dollar-quoting). Direct `DATABASE_URL` use bypasses retry. |
| **Recommended disposition** | **Restrict to diagnostics/wrapper.** The `run_migration` case should delegate to the canonical runner (which provides ledger, checksum, transaction, locking). `list_migrations` can remain as a diagnostic listing but should source from the canonical manifest. Retain `set_user_password` (emergency tool, separate concern). |

### Entry Point 3: `app/api/admin/prospects/seed/route.ts` (Direct File Read — Bypass)

| Field | Value |
|---|---|
| **File** | `app/api/admin/prospects/seed/route.ts` |
| **Caller(s)** | Admin prospects seed UI |
| **Auth model** | Admin session (requireAdminApi) |
| **SQL source** | Reads migration files `092` (schema) and `093` (seed) directly from `lib/migrations/`, bypassing BOTH runners. |
| **Transaction / checksum / ledger** | NONE |
| **Risk** | **MEDIUM.** Bypasses all governance. Executes specific migrations out of the normal path. |
| **Recommended disposition** | **Route through canonical runner** as `runSinglePendingMigration` calls, or document as a known bypass to be deprecated in a later phase. At minimum, record in audit as a non-canonical path. |

## 3. Configuration & Pipeline Audit

- **`package.json`:** No migration scripts (no `migrate`, `db:migrate`, etc.). Scripts:
  `test` (vitest run), `type-check` (tsc --noEmit), `lint` (next lint), `test:ci`,
  `build`. Dependencies include `@neondatabase/serverless ^0.10.4`.
- **`vercel.json`:** Crons: `/api/cron/proposal-expiry` (daily 8am),
  `/api/cron/stale-job-cleanup` (daily 3am). **No migration crons.**
- **`render.yaml`:** External workers: `opencv-photo-vision` (web),
  `geometry-reconstruction-worker` (worker). **No migration workers.**
- **CI (`.github/workflows/ci.yml`):** Runs vitest, tsc, lint, env-audit, build
  (build only on master push). **No migration execution in CI.** Stub env vars
  used. Good — no automated path that could mutate production schema.
- **`.github/workflows/promote-production.yml`:** Manual dispatch,
  `npx vercel --prod`. No migration step. **Good.**
- **`db/schema-upgrades-v25.sql`:** Separate schema upgrade file NOT in either
  migration directory. Stray schema DDL outside governance. Document as
  non-canonical.

## 4. Pattern Search Results (Confirmed)

- `schema_migrations`: **NOT found anywhere** in the codebase (confirms
  MIGRATION-GOV-01 — no ledger exists).
- `pg_advisory_lock` / `advisory_lock`: **NOT found anywhere** (no concurrency
  protection).
- `sha256` / `SHA-256`: found in `system-tools/route.ts` (optional checksum) and
  various non-migration contexts (auth hashing, etc.). **No mandatory migration
  checksums.**
- `MIGRATE_SECRET`: found in `migrate/route.ts`, `system-tools/route.ts`,
  `set-roles/route.ts`, admin UI pages, `lib/env.ts`, `.env.example`.
- `BEGIN` / `COMMIT` / `ROLLBACK`: **NOT found in migration contexts** (no
  transactional migration execution).
- `IF NOT EXISTS` / `ON CONFLICT`: used extensively in inline migration SQL for
  idempotency — but this is NOT a substitute for proper governance.

## 5. Database Connection & Transaction Model

- `getDb()`: synchronous, throws `DbConfigError` if `DATABASE_URL` missing,
  returns `neon(url)` executor.
- `getDbReady()`: async, delegates to `_getDbWithRetry()` — 5 retries, base delay
  50ms (50/100/200/400/800ms), `SELECT 1` probe. Module-level singleton cached.
- `isTransientDbError()`: whitelist-fatal approach — only known fatal errors are
  non-retryable; unknown errors retry.
- **Neon transaction API constraint (critical):** `sql.transaction(txn => [...])`
  requires a **synchronous callback** that returns an **array of query promises**.
  No `await` is permitted inside the callback. This is the reference pattern from
  `lib/siteSurveys/unifiedGeometry/promotionStore.ts`. The canonical runner must
  respect this constraint — DDL statements must be pre-split and passed as an
  array; no dynamic decision-making inside the transaction.

## 6. Authorization & MFA Model Findings

- `requireAdminApi(req)`: reads `solarpro_session` cookie, verifies JWT, fetches
  role from DB (never JWT-only), 60s in-memory role cache. Returns
  `AdminUser { id, name, email, role }`. **No MFA verification** — MFA is checked
  only in the login flow.
- `lib/mfa.ts`: exports TOTP generation/verification, recovery codes, MFA-required
  checks. **No "recent MFA" tracking or verification state** exists. MFA is
  verified at login time only; there is no mechanism to require fresh MFA for a
  sensitive action after login.
- **Implication for Phase 1A:** The "recent MFA for human execution" requirement
  for migrations requires a **new mechanism**. Options: (a) require re-verification
  via a dedicated MFA challenge endpoint that sets a short-lived signed token /
  session flag, or (b) gate human-initiated migration execution behind a fresh
  TOTP code submitted with the request and verified server-side. Phase 1A will
  implement option (b) — require a fresh TOTP code in the migration request body
  for human-initiated execution, verified via `verifyTOTPCode()` — as it requires
  no new session-state infrastructure and aligns with the existing MFA module.
  Production execution remains disabled by default regardless of MFA.
- `lib/env.ts`: `getMigrateSecret()`, `isVercelProduction()`, `isProduction()`
  helpers available for environment gating.

## 7. Existing Migration Tests

- `tests/priority-utility-seed-migration.test.ts`: the only existing
  migration-specific test. Source-code scanning (no DB). Tests seed_utility_policies
  bulk upsert pattern and site_aliases DDL removal. No ledger/checksum/runner tests.
- `vitest.config.ts`: primary runner, includes `tests/**/*.test.ts`,
  `lib/**/*.test.ts`, `__tests__/**/*.test.ts`. 11 quarantined files excluded.
- `jest.config.ts`: alternative runner (ts-jest). `__tests__/**/*.test.ts`.
- `tsconfig.json`: strict: false, target es2017, moduleResolution bundler,
  paths `@/*` → `./*`.

## 8. MIGRATION-GOV-01 Risk Summary (Confirmed)

The risk is fully confirmed by this audit:

1. **Multiple non-authoritative execution paths** — 2 runners + 1 direct-file-read
   bypass (3 paths total).
2. **No `schema_migrations` ledger** — no record of what has been applied.
3. **No advisory locks** — concurrent execution can corrupt schema.
4. **No transaction wrapping** — partial application possible on any runner.
5. **Optional-only checksums** — tampering/corruption undetectable (and currently
   never enforced since no sidecar files exist).
6. **No environment gating** — production DDL fully accessible to secret/role
   holders.
7. **Inline SQL drift** — the inline runner's embedded DDL diverges from the
   canonical migration files.
8. **Two migration directories** — the legacy `migrations/` is a frozen duplicate
   not referenced by active runners but still present, creating ambiguity.

## 9. Migration File Status in the Applied Database

- The applied production database has no `schema_migrations` ledger, so there is
  **no authoritative record** of which migrations have been applied.
- Both runners use idempotent patterns (`IF NOT EXISTS`, "already exists"
  tolerance), so the applied schema reflects a union of whatever was run, in
  whatever order, across both runners.
- **Phase 1A will NOT attempt to retroactively determine applied state from DB
  introspection.** Instead, the ledger will be bootstrapped empty/pending, and
  the reconciliation inventory will record the *file-level* state (filename,
  checksum, git intro commit). Any future "mark as applied" operation is an
  explicit administrative act recorded with actor identity — not inferred.
- Migration **105 does not exist** and is **NOT authorized** for creation in
  Phase 1A. The `NEXT_ENTERPRISE_AUTHORITY_MIGRATION` placeholder remains
  unassigned until the org-authority schema work (outside this phase).

## 10. Audit Conclusion

All findings are consistent with the Phase 0.5 audits. No migration runner
behavior has changed since those audits. The system is ready for the Phase 1A
architecture decision and implementation. The canonical model will be: versioned
migration files (from `lib/migrations/`) + `schema_migrations` database ledger +
mandatory SHA-256 checksums + single execution service + transactional execution
+ PostgreSQL advisory locks + environment-aware authorization + append-only
application history. Legacy runners will be restricted/wrapped, not deleted.

> **Update (Phase 1A):** This audit's findings (MIGRATION-GOV-01) were resolved
> in Phase 1A. See `docs/phase1a/PHASE1A-MIGRATION-GOVERNANCE-IMPLEMENTATION.md`
> and `docs/phase1a/PHASE1A-FINAL-REPORT.md` for the full Phase 1A
> implementation report.

> **Update (Phase 1A.1):** The 8 remaining governance risks (MIGRATION-GOV-02
> through MIGRATION-GOV-08) identified after the Phase 1A implementation were
> resolved in Phase 1A.1. Key resolutions: the third ungated execution path
> (`app/api/admin/prospects/seed/route.ts` — Entry Point 3 in Section 2 above)
> is now gated behind a feature flag; the historical applied-state baseline
> problem (Section 9 above) is now addressed by the baseline reconciliation model;
> MFA fail-open and TOTP replay risks are closed; audit events are now persisted
> durably. See `docs/phase1a/PHASE1A1-FINAL-REPORT.md` for the complete Phase 1A.1
> report. The test suite now has 185 tests (up from 114 in Phase 1A).
