// lib/migrations/baselineBatch.ts
//
// Operator-recovery workstream (Phase 1A operator surface) — Commit 3.
//
// Reviewed baseline reconciliation as a single tamper-evident batch. Reconciling
// 100+ historical migrations one-TOTP-each is not operable; this records the
// operator's whole reviewed set atomically under ONE fresh TOTP, bound to a
// deterministic SHA-256 digest.
//
// SECURITY MODEL (adversarial):
//   • The SERVER owns identifiers, filenames, checksums, and canonical order —
//     all loaded from the manifest. The CLIENT supplies only per-identifier
//     review DECISIONS: { identifier, status, notes }. Any client-supplied
//     filename/checksum/order/evidence-source is ignored.
//   • A client identifier not present in the manifest is rejected.
//   • The canonical batch is normalized to manifest order, so reordered client
//     input produces the identical digest.
//   • UNKNOWN and PARTIALLY_APPLIED require an explicit operator note
//     (RESOLUTION_REQUIRED) — they can never be silently swept into a batch.
//   • Checksum-conflicted migrations are blocking (CHECKSUM_CONFLICT).
//   • The digest changes if ANY identifier, filename, checksum, status, note,
//     or the environment changes. record verifies the client-echoed digest
//     equals the server-recomputed digest (tamper check) before writing.
//
// PURITY: canonicalize / digest / validate are pure (no DB, no clock, no env
// read beyond the passed environment) so the security guarantees are unit-
// testable without a database. Only recordBaselineBatch touches Postgres, and
// it does so in ONE transaction (all-or-nothing) via the injected executor.

import { createHash } from 'node:crypto';
import type { BaselineReconciliationStatus } from './types';

/** Digest/version tag — bump only on a canonical-format change. */
export const BASELINE_BATCH_DIGEST_VERSION = 'baseline-batch/v1';

/** Field separator for the canonical serialization — a control char that
 *  cannot appear in identifiers/filenames/checksums/statuses and is stripped
 *  from notes, so no field value can forge a boundary. */
const SEP = '␟'; // ␟ SYMBOL FOR UNIT SEPARATOR
const ROW = '␞'; // ␞ SYMBOL FOR RECORD SEPARATOR

/** Statuses that require an explicit operator note before they can be batched. */
export const RESOLUTION_REQUIRED_STATUSES: ReadonlySet<BaselineReconciliationStatus> = new Set([
  'UNKNOWN',
  'PARTIALLY_APPLIED',
]);

/** Server-owned facts for one manifest migration (from the manifest, never the client). */
export interface ServerBaselineEntry {
  identifier: string;
  filename: string;
  checksumSha256: string;
  /** Position in canonical manifest order (0-based). */
  order: number;
}

/** Client-owned review decision for one migration (the ONLY client input). */
export interface ClientBaselineReview {
  identifier: string;
  status: BaselineReconciliationStatus;
  notes?: string | null;
}

/** One entry of the normalized, server-authoritative batch. */
export interface CanonicalBaselineEntry {
  identifier: string;
  filename: string;
  checksumSha256: string;
  status: BaselineReconciliationStatus;
  /** Normalized operator note (trimmed, control chars stripped). */
  notes: string;
  order: number;
}

export interface CanonicalBaselineBatch {
  version: string;
  environment: string;
  entries: CanonicalBaselineEntry[];
}

export interface BaselineBatchIssue {
  identifier: string;
  code: 'RESOLUTION_REQUIRED' | 'CHECKSUM_CONFLICT';
  message: string;
}

/** Normalize a note: strip the separator control chars and trim. Never lets a
 *  note value forge a field/row boundary in the digest input. */
function normalizeNote(note: string | null | undefined): string {
  return String(note ?? '')
    .replace(/[␟␞]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/**
 * Build the canonical, server-authoritative batch from server manifest entries
 * and the client's selected review decisions.
 *
 * @throws if a client review references an identifier not in `serverEntries`
 *         (client cannot invent migrations), or if the same identifier is
 *         reviewed twice (ambiguous decision).
 */
export function canonicalizeBaselineBatch(params: {
  environment: string;
  serverEntries: ServerBaselineEntry[];
  clientReviews: ClientBaselineReview[];
}): CanonicalBaselineBatch {
  const { environment, serverEntries, clientReviews } = params;
  const byId = new Map(serverEntries.map((e) => [e.identifier, e]));

  const seen = new Set<string>();
  const entries: CanonicalBaselineEntry[] = [];
  for (const review of clientReviews) {
    const server = byId.get(review.identifier);
    if (!server) {
      throw new Error(
        `[baselineBatch] Unknown migration identifier in review: "${review.identifier}". ` +
        `Clients cannot introduce identifiers outside the server manifest.`,
      );
    }
    if (seen.has(review.identifier)) {
      throw new Error(`[baselineBatch] Duplicate review for identifier "${review.identifier}".`);
    }
    seen.add(review.identifier);
    entries.push({
      // filename + checksum + order come from the SERVER entry, never the client.
      identifier: server.identifier,
      filename: server.filename,
      checksumSha256: server.checksumSha256,
      status: review.status,
      notes: normalizeNote(review.notes),
      order: server.order,
    });
  }

  // Normalize to canonical manifest order — reordered client input yields the
  // identical batch (and therefore the identical digest).
  entries.sort((a, b) => a.order - b.order);

  return { version: BASELINE_BATCH_DIGEST_VERSION, environment, entries };
}

/** Deterministic serialization of the canonical batch (pure). */
export function serializeBaselineBatch(batch: CanonicalBaselineBatch): string {
  const head = `${batch.version}${SEP}${batch.environment}${SEP}n=${batch.entries.length}`;
  const rows = batch.entries.map((e) =>
    [e.identifier, e.filename, e.checksumSha256, e.status, e.notes].join(SEP),
  );
  return [head, ...rows].join(ROW);
}

/** SHA-256 hex digest of the canonical batch (pure, deterministic). */
export function computeBaselineBatchDigest(batch: CanonicalBaselineBatch): string {
  return createHash('sha256').update(serializeBaselineBatch(batch), 'utf8').digest('hex');
}

/**
 * Validate a canonical batch for blocking issues (pure).
 *
 * @param conflictIdentifiers Identifiers currently in checksum-conflict state
 *        (from inspectMigrationState().conflicts) — blocking.
 */
export function validateBaselineBatch(
  batch: CanonicalBaselineBatch,
  opts?: { conflictIdentifiers?: string[] },
): { ok: boolean; issues: BaselineBatchIssue[] } {
  const conflicts = new Set(opts?.conflictIdentifiers ?? []);
  const issues: BaselineBatchIssue[] = [];
  for (const e of batch.entries) {
    if (RESOLUTION_REQUIRED_STATUSES.has(e.status) && e.notes.length === 0) {
      issues.push({
        identifier: e.identifier,
        code: 'RESOLUTION_REQUIRED',
        message: `${e.identifier}: status ${e.status} requires an explicit operator note before it can be recorded.`,
      });
    }
    if (conflicts.has(e.identifier)) {
      issues.push({
        identifier: e.identifier,
        code: 'CHECKSUM_CONFLICT',
        message: `${e.identifier}: file checksum conflicts with the applied ledger checksum — resolve the conflict before baselining.`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Count entries by reconciliation status (pure). */
export function baselineBatchStatusCounts(
  batch: CanonicalBaselineBatch,
): Record<BaselineReconciliationStatus, number> {
  const counts: Record<BaselineReconciliationStatus, number> = {
    CONFIRMED_APPLIED: 0, CONFIRMED_NOT_APPLIED: 0,
    PARTIALLY_APPLIED: 0, NOT_APPLICABLE: 0, UNKNOWN: 0,
  };
  for (const e of batch.entries) counts[e.status] += 1;
  return counts;
}

// ── Transactional recorder (DB) ─────────────────────────────────────────────

/** Minimal transactional executor shape — satisfied by neon's sql.transaction.
 *  Injected so the pure logic above stays DB-free and this stays testable. */
export interface BaselineBatchTxnDeps {
  environment: string;
  /** Run the given upserts atomically (all-or-nothing). Resolves on commit,
   *  rejects (and rolls back) on any failure. */
  runTransaction: (entries: CanonicalBaselineEntry[], reconciledBy: string | null) => Promise<void>;
  /** Emit ONE durable audit event for the whole batch. */
  audit: (event: {
    digest: string;
    identifiers: string[];
    statusCounts: Record<BaselineReconciliationStatus, number>;
    reconciledBy: string | null;
    reason: string;
    environment: string;
  }) => void;
}

export interface RecordBaselineBatchResult {
  success: boolean;
  recorded: number;
  digest: string;
  error?: string;
}

/**
 * Record the entire reviewed batch transactionally. Re-derives and verifies the
 * digest against the client-echoed digest (tamper check) BEFORE any write. Any
 * single-entry failure rolls back the whole batch (guaranteed by runTransaction).
 * Recording the identical confirmed batch again is idempotent (ON CONFLICT
 * upsert to the same values).
 */
export async function recordBaselineBatch(params: {
  batch: CanonicalBaselineBatch;
  /** The digest the operator confirmed (echoed from prepare). */
  confirmedDigest: string;
  reconciledBy: string | null;
  reason: string;
  conflictIdentifiers?: string[];
  deps: BaselineBatchTxnDeps;
}): Promise<RecordBaselineBatchResult> {
  const { batch, confirmedDigest, reconciledBy, reason, deps } = params;

  const digest = computeBaselineBatchDigest(batch);
  if (digest !== confirmedDigest) {
    return {
      success: false, recorded: 0, digest,
      error: 'DIGEST_MISMATCH: the reviewed batch changed after confirmation. Re-review and confirm again.',
    };
  }
  if (!reason || reason.trim().length === 0) {
    return { success: false, recorded: 0, digest, error: 'REASON_REQUIRED' };
  }
  const validation = validateBaselineBatch(batch, { conflictIdentifiers: params.conflictIdentifiers });
  if (!validation.ok) {
    return {
      success: false, recorded: 0, digest,
      error: `BLOCKING_ISSUES: ${validation.issues.map((i) => i.code).join(', ')}`,
    };
  }
  if (batch.entries.length === 0) {
    return { success: false, recorded: 0, digest, error: 'EMPTY_BATCH' };
  }

  try {
    await deps.runTransaction(batch.entries, reconciledBy);
  } catch (err) {
    return {
      success: false, recorded: 0, digest,
      error: `TRANSACTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  deps.audit({
    digest,
    identifiers: batch.entries.map((e) => e.identifier),
    statusCounts: baselineBatchStatusCounts(batch),
    reconciledBy,
    reason: reason.trim(),
    environment: batch.environment,
  });

  return { success: true, recorded: batch.entries.length, digest };
}
