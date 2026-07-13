# Production Migration Activation — Runbook

Migration execution requires a **bounded activation window**. The old indefinite
`EXECUTION_ENABLED` standing bypass is gone. Implementation:
`ledger.enableExecutionTemporary` / `assertExecutionPermitted` /
`readExecutionActivation`; column `governance_lifecycle.execution_enabled_expires_at`.

## The window

- `enable-execution-temporary` grants a window: **default 10 min, max 15 min**.
  The requested duration is **server-clamped** to `[1, 15]` — a client can never
  exceed the maximum; absent/garbage input → default.
- Transition is allowed **only** from `BASELINE_VERIFIED`.
- Requires super_admin + fresh MFA/TOTP + reason (+ typed `production`
  confirmation in prod) + env allowlist + production two-key
  (`MIGRATION_ALLOW_PRODUCTION_EXECUTION=true`). Server-derived environment,
  actor, and role — never client-claimed.

## Fail-closed semantics (the gate)

`assertExecutionPermitted` permits mutation iff lifecycle is `EXECUTION_ENABLED`
**and** there is a non-null expiry **in the future**. Three cases:

| State | Permitted? | Action |
| --- | --- | --- |
| `EXECUTION_ENABLED`, future expiry | ✅ yes | execute |
| `EXECUTION_ENABLED`, expired | ❌ no | auto-relock → `BASELINE_VERIFIED`, audited (`ACTIVATION_EXPIRED`) |
| `EXECUTION_ENABLED`, **NULL** expiry (legacy indefinite) | ❌ no | auto-relock → `BASELINE_VERIFIED`, audited (`ACTIVATION_INDEFINITE_FAIL_CLOSED`) |

Enforcement is server-side and does **not** depend on any UI timer. There is no
indefinite production-capable activation path.

## Relock

The window is single-use for a run: `execute-reviewed-single` and
`execute-reviewed-batch` **auto-relock** (call `disableExecution`) after success
OR failure, returning to `BASELINE_VERIFIED`. The operator may also disable
early (`disable-execution`, TOTP + reason). Expiry auto-relocks on the next gate
check. Every enable / expiry-detection / disable is durably audited.

## Governance schema

The activation column lives in `BOOTSTRAP_LEDGER_DDL` (fresh environments) and is
applied idempotently to already-bootstrapped environments by
`ensureGovernanceSchemaCurrent()` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`),
run during bootstrap and on enable/disable. Governance tables are bootstrap
infrastructure, **not** numbered migrations, so this needs **no** numbered
migration.

## Operator steps (production)

1. Reach `BASELINE_VERIFIED` (bootstrap → baseline batch → verify).
2. `enable-execution-temporary` (10 min) — TOTP + reason + type `production`.
3. Watch the console countdown. Prepare + execute a reviewed single migration;
   confirm success from the ledger status shown.
4. The window auto-relocks. If you did not run in time, it expires and relocks —
   re-enable to continue.

## Tests

Pure (`tests/migration-temporary-activation.test.ts`, 7): clamp `[1,15]`,
default on absent/garbage, client-cannot-exceed-max. Real Postgres
(`tests/migration-temporary-activation-postgres.test.ts`, 7): future window
permitted; past window not permitted; **NULL expiry not permitted (fail-closed)**;
auto-relock of expired and of indefinite; idempotent column upgrade — on
PostgreSQL 18.4. The Phase 1A.3 e2e (96/96) exercises the bounded window through
real canary execution.
