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
import { MigrationFile } from './types';

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
