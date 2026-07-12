# Migration Operator Lockout — Audit

**Status:** Emergency recovery, Phase 1A operator surface.
**Author:** Operator-recovery workstream (2026-07-12).
**Verified against:** live `dev` @ `d2390d09` (local == `origin/dev`).

This document is **additive**. It does not revise or contradict any prior
Phase 1A report. The prior reports correctly document that migration
**governance** (security) was implemented. This document records the missing
piece: a usable **operator control surface**. All findings below were verified
first-hand from the live repository, not from any prior session's claims.

---

## 1. One-sentence problem statement

Raymond (platform `super_admin`, the owner) cannot run any database migration,
because the only legacy execution UI was permanently disabled (MIGRATION-GOV-13)
before the canonical replacement was given an operator-usable control surface.

## 2. Verified repository state

| Fact | Value | How verified |
| --- | --- | --- |
| Local HEAD | `d2390d09` | `git rev-parse HEAD` |
| `origin/dev` HEAD | `d2390d09` | `git rev-parse origin/dev`, `git ls-remote` |
| Worktree | clean except 1 unrelated cosmetic change (`scripts/render-cad-preview.ts`) | `git status` |
| Migration `.sql` count | **105** | `ls lib/migrations/*.sql \| wc -l` |
| Highest prefix | **108** (`108_nearmap_ai_cache_latlng_idx.sql`) | filename scan |
| Duplicate prefixes | only historical `074` (→ `074a`/`074b`) | prefix uniq scan |
| Migration 108 unique? | yes | filename scan |
| Migration 102 exists? | yes (`102_nearmap_ai_cache.sql`) | filename scan |
| Migrations after 107 | only `108` (this workstream's nearmap index) | filename scan |

## 3. Existing canonical API actions (`app/api/admin/migrations/route.ts`)

- `GET` — inspect (read-only): manifest + ledger + pending/applied/failed/conflicts + lifecycle + legacy flags.
- `POST` actions: `inspect`, `dry-run-pending`, `dry-run-single`, `run-single`,
  `run-pending`, `inspect-baseline`, `record-baseline-entry`, `verify-baseline`,
  `enable-execution`, `disable-execution`.

**Missing actions** (needed for a usable operator flow): consolidated
`inspect-readiness`, `generate-baseline-evidence` (the generator exists but is
not exposed), a **batched** baseline reconciliation with a tamper-evident
digest (only one-at-a-time `record-baseline-entry` exists today), **bounded/
temporary** execution activation with auto-expiry, and reviewed single/batch
execution wrappers that force a dry-run + verification step.

## 4. Existing admin migration UI

- `app/admin/system-tools/page.tsx` — the "Run Database Migration" card. It
  calls the **legacy** `POST /api/admin/system-tools { tool: 'run_migration' }`,
  which always returns **423 Locked**. `list_migrations` still works, which is
  why the dropdown populates but every Execute click fails.
- There is **no** UI for the canonical `/api/admin/migrations` API. No page,
  no component. This is the core defect.

## 5. Exact sequence currently required to run ONE migration (why it is unusable)

1. Be an authenticated platform `super_admin`.
2. Have MFA enrolled (fail-closed — `verifyFreshTotp`).
3. Ledger tables must exist. If not, call `bootstrapMigrationLedger` — **but no
   API action or UI exposes it** (the route has no `bootstrap` action). This is
   a hard dead-end for a fresh environment.
4. Governance lifecycle must reach `BASELINE_VERIFIED`. That requires a
   `migration_baseline` reconciliation row for **every** manifest migration
   (105 today) with a non-blocking status, via `record-baseline-entry`
   **one migration at a time**, then `verify-baseline`.
5. Call `enable-execution` (super_admin + fresh TOTP + reason). This sets
   `EXECUTION_ENABLED` **indefinitely** — a standing production bypass.
6. Call `run-single` (super_admin + fresh TOTP + reason + env allowlist +
   `MIGRATION_ALLOW_PRODUCTION_EXECUTION=true` in production).
7. Manually call `disable-execution` afterward to relock.

Every step is a raw JSON API call with no UI. Step 4 alone is 105 sequential
TOTP-gated calls. **This is not an operable product.**

## 6. Exact point where the owner is operationally blocked

The blocker is **UI-only + two API-design gaps**, not an environment or
security-model defect:

- **UI-only:** no page speaks the canonical API. This alone blocks everything.
- **API gap A (bootstrap):** `bootstrapMigrationLedger()` exists in
  `lib/migrations/ledger.ts` but is not exposed by any route action.
- **API gap B (baseline batching):** reconciling 105 migrations one-TOTP-each
  is not viable; there is no reviewed-batch action.

Environment configuration (`MIGRATION_RUN_ALLOWED_ENVS`,
`MIGRATION_ALLOW_PRODUCTION_EXECUTION`) and the security model are **correct and
intentionally retained**.

## 7. Governance tables are bootstrap infrastructure, not numbered migrations

`governance_lifecycle`, `schema_migrations`, `schema_migration_runs`,
`migration_baseline`, `migration_totp_uses` are created by
`BOOTSTRAP_LEDGER_DDL` in `ledger.ts` via `bootstrapMigrationLedger()` — **not**
by a numbered `lib/migrations/*.sql` file. Consequence: adding an
`execution_enabled_expires_at` column for bounded activation does **not** require
a numbered migration and has **no chicken-and-egg problem**; it is applied as an
idempotent governance-schema upgrade during bootstrap/readiness, outside the
numbered-migration flow.

## 8. Activation cannot currently expire

`governance_lifecycle` has `execution_enabled_by` / `execution_enabled_at` but
**no expiry column**. `enableExecution()` transitions to `EXECUTION_ENABLED`
with no time bound; only a manual `disableExecution()` relocks. This is the
"indefinite production bypass" the recovery must replace with a bounded window.

## 9. Baseline recording is one-migration-per-TOTP

`recordBaselineReconciliation()` records a single migration. There is no batch,
no digest, no tamper-evident reviewed-set concept. The recovery adds a
reviewed-batch with a server-computed SHA-256 digest bound to the TOTP.

## 10. Canonical route already supports safe internals

`runSinglePendingMigration` / `runPendingMigrations` already enforce: manifest-
only selection, checksum verification, advisory locking, transactional execution,
`FORBIDDEN` blocking, ledger + run-history recording, and `assertExecutionPermitted`
(lifecycle gate). The recovery builds **on** these; it does not reimplement them.

## 11. Legacy routes correctly locked; no raw-SQL endpoint reachable

- `POST /api/admin/system-tools { tool:'run_migration' }` → always 423.
- `POST /api/migrate` → always 423 (after `MIGRATE_SECRET` check).
- Neither accepts and executes client-supplied SQL. No other route executes
  arbitrary SQL. Verified by grep. **These locks are retained.**

## 12. Production-table assumptions

The audit does **not** connect to production. Whether the ledger tables and
migration 102's table exist on prod is unknown from code alone and must be read
at runtime via the readiness endpoint (fail-closed: absent tables ⇒
`UNBOOTSTRAPPED`, never a silent mutation).

## 13. Nearmap cost-safety (verified independent of migrations)

`lib/aerial/nearmapCache.ts` is fail-closed: a missing/unreadable cache table
returns `{ ok:false }` and **blocks** the paid fetch (no metered call), logging
`CACHE UNAVAILABLE — live fetch BLOCKED`. The fallback is OSM/manual, not another
metered Nearmap endpoint. This protection is active **without** migration 102 or
108. The operator-recovery work does not depend on applying those migrations.

---

## Design intent for the recovery (summary; details in the workflow doc)

1. **One admin page** (`/admin/system-tools/migrations`, super_admin only)
   speaking the canonical API.
2. Expose `bootstrap` and `generate-baseline-evidence` as route actions.
3. **Reviewed baseline batch**: generate read-only evidence → review table →
   server canonicalizes + SHA-256 digest → single TOTP → transactional record.
4. **Bounded activation**: `execution_enabled_expires_at` (≤15 min), auto-treated
   as disabled on expiry; execution gate checks it; auto-relock after a run.
5. **Reviewed single execution** first (batch deferred until single is proven).
6. Retain every security control: super_admin, fresh MFA/TOTP, env authorization,
   checksums, advisory lock, durable audit, append-only run history, FORBIDDEN
   blocking. No legacy re-enable. No browser-supplied SQL. MFA files untouched.
