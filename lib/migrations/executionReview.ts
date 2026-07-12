// lib/migrations/executionReview.ts
//
// Operator-recovery workstream — Commit 5. Reviewed single-migration execution.
//
// A migration is executed only after a SEPARATE read-only preparation step
// produces a deterministic reviewed payload + digest. At execute time the
// server REBUILDS the payload from authoritative sources and verifies the
// operator-confirmed digest still matches (the file/checksum/target cannot have
// changed since review), then re-checks live eligibility, then runs ONLY through
// the canonical runner, and determines success from the ledger + run history —
// never from an HTTP status or a dry-run response.
//
// PURITY: the identity digest and the eligibility assessment are pure (no DB,
// no clock) so they are fully unit-testable. The route supplies server-derived
// facts (filename, checksum, transaction mode, current status, baseline status,
// conflicts, activation window, env authorization) — none of which the client
// can substitute.

import { createHash } from 'node:crypto';
import type { TransactionMode, BaselineReconciliationStatus, MigrationStatus } from './types';

export const EXECUTION_REVIEW_DIGEST_VERSION = 'execution-single/v1';

const SEP = '␟';

/** The immutable identity of a single-migration execution target. The digest is
 *  taken over THIS — a change to the file (checksum), the target identifier/
 *  filename, the transaction mode, or the environment invalidates a prepared
 *  review and forces re-preparation. */
export interface ExecutionIdentity {
  version: string;
  environment: string;
  identifier: string;
  filename: string;
  checksumSha256: string;
  transactionMode: TransactionMode;
}

export type ExecutionBlockReason =
  | 'NOT_FOUND'            // not in the manifest
  | 'ALREADY_APPLIED'      // current status applied
  | 'NOT_PENDING'          // running/failed/superseded — not a clean pending
  | 'CHECKSUM_CONFLICT'    // file changed after being applied
  | 'FORBIDDEN'            // non-transactional; canonical runner cannot apply
  | 'BASELINE_UNRECONCILED'// no non-blocking baseline row for this migration
  | 'NO_ACTIVE_WINDOW'     // no valid bounded activation window
  | 'ENV_NOT_ALLOWED'      // environment not in the execution allowlist
  | 'PRODUCTION_DISABLED'; // production two-key not set

/** All the server-derived facts needed to assess eligibility (pure input). */
export interface ExecutionEligibilityInput {
  foundInManifest: boolean;
  currentStatus: MigrationStatus | 'pending' | null; // null = never attempted (pending)
  hasChecksumConflict: boolean;
  transactionMode: TransactionMode;
  baselineStatus: BaselineReconciliationStatus | null;
  hasValidActivationWindow: boolean;
  environmentAllowed: boolean;
  isProduction: boolean;
  productionExecutionAllowed: boolean;
}

const NON_BLOCKING_BASELINE: ReadonlySet<BaselineReconciliationStatus> = new Set([
  'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'NOT_APPLICABLE',
]);

export interface ExecutionEligibility {
  eligible: boolean;
  /** All blocking reasons (most-specific first); empty when eligible. */
  blockReasons: ExecutionBlockReason[];
}

/**
 * Pure eligibility assessment. ALL blocking conditions are evaluated (not
 * short-circuited) so the operator sees every reason at once.
 */
export function assessExecutionEligibility(input: ExecutionEligibilityInput): ExecutionEligibility {
  const reasons: ExecutionBlockReason[] = [];
  if (!input.foundInManifest) reasons.push('NOT_FOUND');
  if (input.currentStatus === 'applied') reasons.push('ALREADY_APPLIED');
  // A clean target is pending (null) or previously failed→retryable. running/
  // superseded are not directly executable here.
  if (input.currentStatus === 'running' || input.currentStatus === 'superseded') reasons.push('NOT_PENDING');
  if (input.hasChecksumConflict) reasons.push('CHECKSUM_CONFLICT');
  if (input.transactionMode === 'FORBIDDEN') reasons.push('FORBIDDEN');
  if (!input.baselineStatus || !NON_BLOCKING_BASELINE.has(input.baselineStatus)) reasons.push('BASELINE_UNRECONCILED');
  if (!input.hasValidActivationWindow) reasons.push('NO_ACTIVE_WINDOW');
  if (!input.environmentAllowed) reasons.push('ENV_NOT_ALLOWED');
  if (input.isProduction && !input.productionExecutionAllowed) reasons.push('PRODUCTION_DISABLED');
  return { eligible: reasons.length === 0, blockReasons: reasons };
}

/** Build the identity object (pure). */
export function buildExecutionIdentity(params: {
  environment: string;
  identifier: string;
  filename: string;
  checksumSha256: string;
  transactionMode: TransactionMode;
}): ExecutionIdentity {
  return {
    version: EXECUTION_REVIEW_DIGEST_VERSION,
    environment: params.environment,
    identifier: params.identifier,
    filename: params.filename,
    checksumSha256: params.checksumSha256,
    transactionMode: params.transactionMode,
  };
}

/** Deterministic serialization of the execution identity (pure). */
export function serializeExecutionIdentity(id: ExecutionIdentity): string {
  return [
    id.version, id.environment, id.identifier, id.filename,
    id.checksumSha256, id.transactionMode,
  ].join(SEP);
}

/** SHA-256 hex digest over the execution identity (pure, deterministic). */
export function computeExecutionDigest(id: ExecutionIdentity): string {
  return createHash('sha256').update(serializeExecutionIdentity(id), 'utf8').digest('hex');
}
