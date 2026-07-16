# Baseline Batch — Security Model

Reconciling 100+ historical migrations one-TOTP-each is not operable. The
reviewed baseline batch records the operator's whole reviewed set atomically
under **one** fresh TOTP, bound to a tamper-evident digest. Core:
`lib/migrations/baselineBatch.ts` (pure) + `ledger.recordBaselineBatchRows`
(transactional).

## Server-authoritative canonicalization

The **server** owns identifiers, filenames, checksums, and canonical order (all
from the manifest). The **client** supplies only per-identifier review
decisions: `{ identifier, status, notes }`.

- A client identifier not in the manifest is **rejected**.
- A duplicate identifier is **rejected**.
- Client-supplied filename/checksum/order are **ignored** — the canonical entry
  always uses the server's manifest values (so a client cannot substitute them).
- The batch is normalized to canonical manifest order, so a **reordered** client
  selection produces the identical batch and digest.

## The digest

`computeBaselineBatchDigest` = SHA-256 over a deterministic serialization:
`version ␟ environment ␟ n` then, per entry in canonical order,
`identifier ␟ filename ␟ checksum ␟ status ␟ notes`. Notes are separator-
sanitized (the field `␟` and row `␞` separators are stripped) so a note can
never forge a field/row boundary.

The digest changes if **any** of these change: an identifier, a filename, a
checksum, a status, a note, the environment, or the selected set. It is stable
under client reordering.

## Blocking resolution rules

`validateBaselineBatch`:
- `UNKNOWN` and `PARTIALLY_APPLIED` require an explicit operator **note**
  (`RESOLUTION_REQUIRED`) — they can never be swept in silently.
- A checksum-conflicted migration is blocking (`CHECKSUM_CONFLICT`).

## Confirm + record

`record-baseline-batch` re-derives the canonical batch and digest server-side
and verifies it equals the operator-confirmed digest (**tamper check**) BEFORE
any write. If the review changed after confirmation, the digest mismatches and
nothing is written. It then records the whole batch in **one transaction**
(`recordBaselineBatchRows` via neon `sql.transaction`): all upserts commit
together or roll back together — a single-entry failure aborts the whole batch,
so there is never a partial baseline. `ON CONFLICT` upsert makes re-recording an
identical confirmed batch **idempotent**. `evidence_type` is server-fixed to
`MANUAL_VERIFICATION` (the reviewed batch's evidence source is the operator —
never a client claim). One durable audit event records the digest, identifiers,
per-status counts, actor, environment, reason, and timestamp.

## Tests

Pure (`tests/migration-baseline-batch.test.ts`, 22): digest determinism; digest
changes on status/note/selection/env/checksum; separator-injection defense;
reorder normalization; unknown/duplicate rejection; filename/checksum
substitution ignored; resolution-required; conflict-blocking; injected-
transaction atomicity + digest-mismatch-writes-nothing + idempotency.
Real Postgres (`tests/migration-baseline-batch-postgres.test.ts`, 4): atomic
multi-row commit, whole-batch rollback on a mid-batch constraint violation,
`ON CONFLICT` idempotency — validated on PostgreSQL 18.4.
