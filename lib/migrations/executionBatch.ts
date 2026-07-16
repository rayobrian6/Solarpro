// lib/migrations/executionBatch.ts
//
// Operator-recovery workstream — Commit 6. Reviewed BATCH execution.
//
// Batch execution is secondary and is enabled only after single execution is
// proven (Commit 5). It shares Commit 5's execution-identity digest per entry
// and adds a batch-level digest bound to the CANONICAL manifest order, so a
// reordered or tampered client selection cannot change what runs.
//
// Execution semantics (enforced by the route): run in canonical manifest order,
// STOP ON THE FIRST FAILURE, every selected migration receives an explicit
// result, remaining migrations stay pending, auto-relock afterward. There is no
// unreviewed "run everything" — the operator must select and confirm a digest.
//
// PURITY: canonicalization + digest are pure (no DB) and fully unit-testable.

import { createHash } from 'node:crypto';
import {
  buildExecutionIdentity,
  computeExecutionDigest,
  type ExecutionIdentity,
} from './executionReview';
import type { TransactionMode } from './types';

export const EXECUTION_BATCH_DIGEST_VERSION = 'execution-batch/v1';

const SEP = '␟';
const ROW = '␞';

/** Server-owned facts for one manifest migration (never client-supplied). */
export interface ServerExecutionEntry {
  identifier: string;
  filename: string;
  checksumSha256: string;
  transactionMode: TransactionMode;
  /** Canonical manifest order index. */
  order: number;
}

export interface CanonicalExecutionBatchEntry {
  identity: ExecutionIdentity;
  digest: string;
  order: number;
}

export interface CanonicalExecutionBatch {
  version: string;
  environment: string;
  entries: CanonicalExecutionBatchEntry[];
}

/**
 * Build the canonical execution batch from server entries + the client's
 * selected identifiers. Order is the manifest order (client order is ignored);
 * unknown/duplicate identifiers are rejected.
 */
export function canonicalizeExecutionBatch(params: {
  environment: string;
  serverEntries: ServerExecutionEntry[];
  selectedIdentifiers: string[];
}): CanonicalExecutionBatch {
  const { environment, serverEntries, selectedIdentifiers } = params;
  const byId = new Map(serverEntries.map((e) => [e.identifier, e]));
  const seen = new Set<string>();
  const entries: CanonicalExecutionBatchEntry[] = [];
  for (const id of selectedIdentifiers) {
    const server = byId.get(id);
    if (!server) {
      throw new Error(`[executionBatch] Unknown migration identifier: "${id}". Clients cannot introduce identifiers outside the server manifest.`);
    }
    if (seen.has(id)) {
      throw new Error(`[executionBatch] Duplicate identifier in selection: "${id}".`);
    }
    seen.add(id);
    const identity = buildExecutionIdentity({
      environment,
      identifier: server.identifier,
      filename: server.filename,
      checksumSha256: server.checksumSha256,
      transactionMode: server.transactionMode,
    });
    entries.push({ identity, digest: computeExecutionDigest(identity), order: server.order });
  }
  // Normalize to canonical manifest order — reordered client input yields the
  // identical batch (and digest).
  entries.sort((a, b) => a.order - b.order);
  return { version: EXECUTION_BATCH_DIGEST_VERSION, environment, entries };
}

/** Deterministic serialization of the canonical execution batch (pure). */
export function serializeExecutionBatch(batch: CanonicalExecutionBatch): string {
  const head = `${batch.version}${SEP}${batch.environment}${SEP}n=${batch.entries.length}`;
  const rows = batch.entries.map((e) => `${e.identity.identifier}${SEP}${e.digest}`);
  return [head, ...rows].join(ROW);
}

/** SHA-256 hex digest over the canonical execution batch (pure). */
export function computeExecutionBatchDigest(batch: CanonicalExecutionBatch): string {
  return createHash('sha256').update(serializeExecutionBatch(batch), 'utf8').digest('hex');
}

/** The ordered identifiers of the canonical batch (execution order). */
export function batchExecutionOrder(batch: CanonicalExecutionBatch): string[] {
  return batch.entries.map((e) => e.identity.identifier);
}
