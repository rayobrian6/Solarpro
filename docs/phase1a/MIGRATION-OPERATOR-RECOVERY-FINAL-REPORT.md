# Migration Operator Recovery — Final Report

## Summary

Migration **governance** (security) was implemented and is retained; the missing
piece was a usable **operator control surface**. The legacy runner was
permanently locked (MIGRATION-GOV-13) before the canonical replacement had a UI
or the API affordances to bootstrap and reconcile at scale, so the super_admin
owner could not run any migration. This recovery delivers the governed operator
console + the missing API actions, adversarially tested against real PostgreSQL,
without weakening any control and without touching MFA.

## Commits (on `dev`)

| Commit | Hash | What |
| --- | --- | --- |
| 1 | `158a8e79` | Reproduce + document the operator lockout (audit) |
| 2 | `f6e921a3` | Readiness + evidence + bootstrap API actions |
| 3 | `3359cc7f` | Reviewed baseline batch — tamper-evident digest + transactional record |
| 4 | `bb690187` | Bounded execution activation (auto-expiring window) |
| 4c | `d2d042c2` | NULL-expiry fails closed (no indefinite path) + test-harness audit_log fix |
| 5 | `175eccbf` | Reviewed single-migration execution (canonical runner, ledger-verified) |
| 6 | `3e57fda5` | Reviewed batch execution (canonical order, stop-on-first-failure) |
| 7 | `566fc265` | Operator console UI (super_admin) |
| 8–9 | _this commit_ | Validation evidence + documentation |

## Operator lockout root cause

UI-only + two API gaps (not env/security): the legacy `run_migration` returned
423 unconditionally; no page spoke the canonical API; `bootstrapMigrationLedger`
was exposed by no route action (fresh-env dead-end); baseline reconciliation was
one-migration-per-TOTP (unworkable for 100+). See
`MIGRATION-OPERATOR-LOCKOUT-AUDIT.md`.

## Delivered

- **Console route:** `/admin/system-tools/migrations` (super_admin only).
- **Readiness dashboard:** environment/prod flag, role, MFA-enrolled, lifecycle,
  ledger, manifest/applied/pending/conflicts, baseline reconciled/unresolved,
  activation window + live countdown, env allowlist, prod flag, plain-language
  next-action + blockers. Redacted (no URLs/secrets/tokens/MFA secret).
- **Baseline evidence:** read-only schema introspection, one proposal per
  migration.
- **Reviewed baseline batch:** server-authoritative canonicalization + SHA-256
  digest; UNKNOWN/PARTIALLY_APPLIED require notes; conflicts block; one TOTP;
  transactional all-or-nothing; idempotent replay.
- **Bounded activation:** default 10 / max 15 min; server-clamped; expired AND
  indefinite (NULL-expiry) fail closed with audited auto-relock.
- **Reviewed single execution:** separate read-only prepare → digest; execute
  rebuilds+verifies the digest, re-checks eligibility (blocks applied / missing /
  conflicted / FORBIDDEN / unreconciled / no-window), forces a dry-run, runs only
  through the canonical runner, **verifies success from the ledger + run
  history**, auto-relocks.
- **Reviewed batch execution:** canonical order, stop-on-first-failure, explicit
  per-migration results, remaining stay pending, auto-relock. No unreviewed "run
  everything".

## Automatic relock — evidence

Real-PG: after `execute-reviewed-single`, lifecycle returns to
`BASELINE_VERIFIED` and the gate then denies; after a failed batch, lifecycle is
`BASELINE_VERIFIED` and remaining migrations stay pending. Expired/indefinite
windows auto-relock on the next gate check (audited).

## Ledger / run-history verification

Success is determined by reading `schema_migrations.status = 'applied'` AND a
matching `schema_migration_runs` `applied` row for the execution id — never the
HTTP status or the dry-run. A dry-run response is never treated as execution
proof.

## New migration identifiers

None for governance activation (the expiry column is bootstrap infrastructure,
applied idempotently — no numbered migration). Migration `108`
(`nearmap_ai_cache_latlng_idx`, from the prior Nearmap workstream) remains the
highest prefix. Committed migrations 105–108 were not modified.

## FORBIDDEN migrations

Remain blocked by the canonical runner and shown ineligible in the console. A
governed manual path is documented as future work (workflow doc), not
implemented; browser-supplied SQL is never accepted.

## Test environment / results

Real PostgreSQL **18.4** (embedded, UTF8; not Docker/mock/prod). **251 real-PG
tests passed** across 8 suites (incl. genuine canary execution through the
canonical runner). **60 pure recovery tests passed.** Full suite (no DB): **7546
passed, 454 skipped, 5 failed** — the 5 are pre-existing/environmental
(2 Windows path-separator in phase1a, 2 npm-ENOENT OCR/metadata adapters,
1 crew-calendar date). `tsc`: 0 errors (excl. a pre-existing untracked scratch
file). `next build`: compiled successfully. Full detail:
`MIGRATION-OPERATOR-RECOVERY-TEST-EVIDENCE.md`.

## Safety posture

- **Production:** never connected to or mutated during implementation. No
  production migration executed.
- **MFA files:** unchanged. The recovery uses `verifyFreshTotp` as-is.
- **Legacy routes:** remain permanently locked; no re-enable. No raw-SQL
  endpoint exists.
- **Retained controls:** super_admin, fresh MFA/TOTP, server-derived
  environment, env allowlist, production two-key, reconciled baseline, explicit
  reason, canonical manifest, checksum verification, advisory locking, durable
  audit, append-only run history, bounded activation. Client cannot spoof actor,
  role, environment, path, filename, checksum, digest, or SQL.

## What the owner does next

Open `/admin/system-tools/migrations` on the deployed dev environment (as
super_admin, MFA enrolled). Follow the console's next-action prompts:
bootstrap (if needed) → generate evidence → review + record the baseline batch →
verify → temporarily enable execution → prepare + execute the pending migration
(e.g. `102`, `108`). Success is confirmed from the ledger status shown in the
console. The Neon SQL editor is no longer needed for ordinary migrations.
