# Migration Operator Recovery — Test Evidence

Captured 2026-07-12 on the operator-recovery branch state.

## Real PostgreSQL environment

- **Engine:** PostgreSQL **18.4** on x86_64-windows (real server binaries via
  `embedded-postgres`, encoding **UTF8**). Not Docker (unavailable), not a mock,
  not production.
- **Connection:** `TEST_DATABASE_URL` → local embedded instance on port 55433.
- **No production database was connected to or mutated at any point.**

## Real-PostgreSQL suites (executed, not skipped)

| Suite | Result |
| --- | --- |
| `phase1a2-postgres-integration` | **55 passed** |
| `phase1a3-migration-governance-e2e` (incl. real canary execution) | **96 passed** |
| `phase1a3-edge-cases` | **31 passed** |
| `phase1a3-route-handler-e2e` | **51 passed** |
| `migration-baseline-batch-postgres` | **4 passed** |
| `migration-temporary-activation-postgres` | **7 passed** |
| `migration-operator-execution-postgres` | **4 passed** |
| `migration-batch-execution-postgres` | **3 passed** |
| **Total real-PG** | **251 passed** |

Real-PG highlights:
- **Genuine migration execution through the canonical runner** — canary fixtures
  applied transactionally; the created table actually exists in the DB; success
  read from `schema_migrations` + `schema_migration_runs`.
- Baseline batch: atomic multi-row commit, whole-batch rollback on a mid-batch
  constraint violation, `ON CONFLICT` idempotency.
- Bounded activation: future window permitted; past + NULL-expiry (indefinite)
  fail closed; auto-relock; idempotent column upgrade.
- Reviewed single execution: dry-run → canonical run → ledger+run-history verify
  → auto-relock → subsequent `ALREADY_APPLIED`.
- Reviewed batch: canonical-order execution from scrambled input; genuine
  stop-on-first-failure (901 fails without 900's table → 902 not_run → remaining
  pending → auto-relock).

## Pure adversarial suites (run everywhere, no DB)

| Suite | Result |
| --- | --- |
| `migration-baseline-batch` | 22 passed |
| `migration-temporary-activation` | 7 passed |
| `migration-operator-execution` | 23 passed |
| `migration-batch-execution` | 8 passed |
| **Total pure recovery** | **60 passed** |

## Full suite (no `TEST_DATABASE_URL`)

**7546 passed · 454 skipped · 5 failed.** The 5 failures are pre-existing and
unrelated to this work (verified failing on the pre-work baseline / caused by the
Windows environment):
1. `phase1a-migration-governance` "every file has a valid identifier and prefix"
   — Windows path separator (`lib\migrations` vs `lib/migrations`).
2. `phase1a-migration-governance` "legacy migrations/ directory is excluded" —
   same Windows path-separator assertion.
3. `priority5-crew-calendar` weekStart — pre-existing date/timezone test.
4. `assistedEvidenceSources/ocrRuntimeAdapter` — `spawnSync npm ENOENT` (Windows).
5. `assistedEvidenceSources/metadataRuntimeAdapter` — `spawnSync npm ENOENT`.

The 454 skips are the `TEST_DATABASE_URL`-gated Postgres suites, which are NOT
acceptance-skipped — they were executed against real PostgreSQL 18.4 as recorded
above.

## TypeScript

`tsc --noEmit`: **0 errors** (excluding a pre-existing scratch file
`_tmp_franklin/*` that predates this work and is untracked).

## Production build

`next build`: **compiled successfully**; `/admin/system-tools/migrations` (the
operator console) and `/api/admin/migrations` both built; all 86 app routes
generated.
