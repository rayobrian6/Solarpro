// lib/migrations/validation.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
//
// Checksum computation and verification for migration files.
//
// The canonical model requires mandatory SHA-256 checksums over the exact bytes
// of every migration file. This module provides the pure functions to compute
// and verify those checksums. No file I/O here beyond reading file contents —
// the manifest module handles discovery; the ledger module handles persistence
// of recorded checksums.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MigrationFile, TransactionMode } from './types';

/**
 * Calculate the SHA-256 checksum over the exact bytes of a file.
 *
 * This reads the file in binary mode and hashes the raw bytes, so it is
 * sensitive to any change — including trailing whitespace, line-ending changes,
 * and encoding differences. This is intentional: a migration file that has been
 * modified after being applied is a governance conflict.
 *
 * @param filePath Absolute path to the file.
 * @returns The hex-encoded SHA-256 digest (64 characters).
 */
export function calculateMigrationChecksum(filePath: string): string {
  const contents = readFileSync(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * Calculate the SHA-256 checksum over a string (used for in-memory validation
 * and testing).
 *
 * @param content The string content to hash (encoded as UTF-8).
 * @returns The hex-encoded SHA-256 digest (64 characters).
 */
export function calculateChecksumOfString(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Verify that a migration file's current checksum matches an expected
 * (ledger-recorded) checksum.
 *
 * @param file The migration file (with its current checksum).
 * @param expectedChecksum The checksum recorded in the ledger.
 * @returns An object indicating whether the checksums match.
 */
export function verifyMigrationChecksum(
  file: MigrationFile,
  expectedChecksum: string,
): { matches: boolean; computed: string; expected: string } {
  const computed = file.checksumSha256;
  const expected = expectedChecksum.toLowerCase();
  return {
    matches: computed === expected,
    computed,
    expected,
  };
}

/**
 * Verify a checksum against a computed one (raw comparison, no file needed).
 *
 * @param computed The computed checksum.
 * @param expected The expected (ledger) checksum.
 * @returns Whether they match.
 */
export function checksumsMatch(computed: string, expected: string): boolean {
  return computed.toLowerCase() === expected.toLowerCase();
}

/**
 * Check whether two migration files are identical (same checksum).
 *
 * Used to detect whether two files with the same prefix are actually identical
 * (which would be a different kind of anomaly than two distinct files).
 */
export function areFilesIdentical(fileA: MigrationFile, fileB: MigrationFile): boolean {
  return fileA.checksumSha256 === fileB.checksumSha256;
}

/**
 * Validate that a checksum string is a well-formed 64-character hex SHA-256.
 */
export function isValidChecksumFormat(checksum: string): boolean {
  return /^[0-9a-f]{64}$/i.test(checksum);
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction compatibility detection (MIGRATION-GOV-06, Phase 1A.1 Issue 10/11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQL statements that are incompatible with running inside a transaction block
 * in PostgreSQL. These statements must be executed outside a transaction, one
 * statement at a time.
 *
 * References:
 * - PostgreSQL docs: "CREATE INDEX CONCURRENTLY ... cannot be run inside a
 *   transaction block."
 * - VACUUM (without concurrent flag) cannot run inside a transaction.
 * - REINDEX CONCURRENTLY cannot run inside a transaction block.
 * - ALTER TYPE ... ADD VALUE (for enum types) cannot run inside a transaction
 *   block in PostgreSQL < 12.
 */
const TRANSACTION_INCOMPATIBLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // CREATE INDEX CONCURRENTLY (also CREATE UNIQUE INDEX CONCURRENTLY)
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i, label: 'CREATE INDEX CONCURRENTLY' },
  // REINDEX CONCURRENTLY
  { pattern: /\bREINDEX\s+(?:\w+\s+)*CONCURRENTLY\b/i, label: 'REINDEX CONCURRENTLY' },
  // VACUUM (not inside a transaction; note: VACUUM FULL is also incompatible)
  { pattern: /\bVACUUM\b/i, label: 'VACUUM' },
  // ALTER TYPE ... ADD VALUE (enum value addition — incompatible in PG < 12)
  { pattern: /\bALTER\s+TYPE\b[^;]*\bADD\s+VALUE\b/i, label: 'ALTER TYPE ADD VALUE' },
  // CREATE DATABASE / CREATE TABLESPACE — cannot run in transaction
  { pattern: /\bCREATE\s+DATABASE\b/i, label: 'CREATE DATABASE' },
  { pattern: /\bCREATE\s+TABLESPACE\b/i, label: 'CREATE TABLESPACE' },
  // DROP DATABASE — cannot run in transaction
  { pattern: /\bDROP\s+DATABASE\b/i, label: 'DROP DATABASE' },
];

/**
 * Detect the transaction compatibility mode for a migration file's SQL content.
 *
 * Scans the SQL content for known transaction-incompatible statements. If any
 * are found, the file is classified as `FORBIDDEN` (must run outside a
 * transaction). If none are found, the file is classified as `REQUIRED` (must
 * run inside a transaction — the safe default).
 *
 * `MANUAL_REVIEW` is reserved for future use where automatic detection cannot
 * make a confident determination. Currently, all files are classified as
 * either `REQUIRED` or `FORBIDDEN`.
 *
 * @param sqlContent The raw SQL content of the migration file.
 * @returns An object with the detected mode and a list of matched incompatible
 *          statements (for audit and reporting).
 */
export function detectTransactionMode(
  sqlContent: string,
): {
  mode: TransactionMode;
  incompatibleStatements: string[];
} {
  const matched: string[] = [];

  for (const { pattern, label } of TRANSACTION_INCOMPATIBLE_PATTERNS) {
    if (pattern.test(sqlContent)) {
      matched.push(label);
    }
  }

  if (matched.length > 0) {
    return { mode: 'FORBIDDEN', incompatibleStatements: matched };
  }

  return { mode: 'REQUIRED', incompatibleStatements: [] };
}

/**
 * Detect the transaction compatibility mode for a migration file by reading
 * it from disk.
 *
 * @param filePath Absolute path to the migration file.
 * @returns The detected mode and any incompatible statements found.
 */
export function detectTransactionModeFromFile(
  filePath: string,
): {
  mode: TransactionMode;
  incompatibleStatements: string[];
} {
  const content = readFileSync(filePath, 'utf-8');
  return detectTransactionMode(content);
}
