# Migration Operator Workflow

The supported, governed path to run a database migration. The legacy System
Tools runner and `/api/migrate` are permanently locked (MIGRATION-GOV-13); this
console is the only path. Every step is enforced server-side — the UI never
sends SQL and cannot bypass any control.

**Console:** `/admin/system-tools/migrations` (platform **super_admin** only).
**API:** `POST /api/admin/migrations` (one `action` per call).

## The state machine

```
UNBOOTSTRAPPED → (bootstrap) → BASELINE_REQUIRED → BASELINE_IN_PROGRESS
   → (reviewed baseline batch + verify) → BASELINE_VERIFIED
   → (enable-execution-temporary) → EXECUTION_ENABLED (bounded window)
   → (run one/batch; auto-relock) → BASELINE_VERIFIED
```

Dry-run/inspection is always allowed. Mutation is allowed only in
`EXECUTION_ENABLED` **with a valid bounded window** (see the activation runbook).

## The exact owner workflow

1. **Open** `/admin/system-tools/migrations`. The Readiness panel shows the
   environment, your role, MFA status, lifecycle, ledger presence, manifest /
   applied / pending / conflict counts, baseline reconciled/unresolved, the
   activation window, env allowlist, and a plain-language **next action** +
   blockers. It never shows URLs, secrets, tokens, or the MFA secret.

2. **Bootstrap** (only if the ledger is missing). `bootstrap` — super_admin +
   fresh TOTP + reason (+ typed `production` in prod). Idempotent; creates the
   ledger tables; runs **no** migration SQL.

3. **Historical baseline** (only while unresolved > 0):
   - `generate-baseline-evidence` — read-only schema introspection; one proposal
     per manifest migration with a proposed status + confidence.
   - Review the table. High-confidence proposals are pre-selected; `UNKNOWN` and
     `PARTIALLY_APPLIED` require an explicit note.
   - `prepare-baseline-batch` — the server canonicalizes your selection and
     returns a SHA-256 **digest**.
   - `record-baseline-batch` — one fresh TOTP + reason confirms the exact
     digest; the whole batch is recorded transactionally (all-or-nothing).
     Details in the baseline-batch security doc.

4. **Verify baseline.** `verify-baseline` advances to `BASELINE_VERIFIED`. This
   does **not** enable execution.

5. **Temporarily enable execution.** `enable-execution-temporary` — super_admin
   + fresh TOTP + reason (+ typed `production` in prod). Grants a **bounded
   window** (default 10 min, max 15). The console shows a live countdown. An
   expired or windowless activation fails closed (activation runbook).

6. **Run one migration** (reviewed single execution):
   - `prepare-execution-single { identifier }` — the server derives filename,
     checksum, transaction mode, current state, baseline status, conflicts, and
     eligibility, and returns an execution **digest**.
   - `execute-reviewed-single { identifier, confirmedDigest, reason, totpCode }`
     — the server rebuilds and re-verifies the digest, re-checks eligibility
     (blocks applied / missing / conflicted / FORBIDDEN / unreconciled /
     no-window), forces a canonical dry-run, runs **only** through the canonical
     runner, and reports success **read back from the ledger + run history** —
     never from the HTTP status or the dry-run. The window **auto-relocks**
     after success or failure.

7. **Run several** (reviewed batch, secondary): `prepare-execution-batch` then
   `execute-reviewed-batch` run the selected migrations in canonical manifest
   order and **stop on the first failure**; every selection gets an explicit
   result; remaining migrations stay pending; auto-relock afterward. There is no
   unreviewed "run everything".

## FORBIDDEN migrations

A migration whose statements cannot run inside a transaction (e.g.
`CREATE INDEX CONCURRENTLY`) is `transactionMode: FORBIDDEN`. The canonical
runner blocks it and the console shows it as ineligible (`FORBIDDEN`). A future
governed manual path (exact identifier + checksum + TOTP + reason + pre/post
audit + ledger reconciliation, no browser SQL) is required — not implemented
here. Manual Neon SQL is an exceptional emergency procedure, not normal
operation.

## Every control retained

super_admin · fresh MFA/TOTP (frozen, unchanged) · server-derived environment ·
env allowlist · production two-key · reconciled historical baseline · explicit
reason · canonical manifest · checksum verification · advisory locking · durable
audit · append-only run history · bounded activation. The client cannot spoof
actor, role, environment, path, filename, checksum, digest, or SQL.
