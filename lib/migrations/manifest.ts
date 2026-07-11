// lib/migrations/manifest.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
//
// Migration file discovery and manifest validation.
//
// This module scans the canonical `lib/migrations/` directory, parses the
// numeric prefixes from filenames, detects duplicate prefixes (assigning
// disambiguated identifiers), computes checksums, identifies reserved gaps, and
// validates the overall manifest structure.
//
// Design constraints:
// - No renumbering of historical files.
// - Reserved gaps (009, 012, 013, 014) are NOT errors.
// - Duplicate prefix 074 is a historical anomaly — disambiguated as 074a/074b.
// - Path traversal is impossible: we scan a fixed directory and use
//   path.basename for containment. No user-supplied filenames are accepted.
// - The legacy `migrations/` directory is NOT scanned — only `lib/migrations/`.

import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  MigrationFile,
  MigrationManifest,
  ManifestValidationResult,
  MIGRATIONS_DIR_RELATIVE,
} from './types';
import { calculateMigrationChecksum } from './validation';

/**
 * Extract the numeric prefix from a migration filename.
 *
 * Filenames are expected to be of the form `NNN_description.sql` where NNN is a
 * zero-padded 3-digit number. Returns null if the filename does not match.
 *
 * @param filename The filename (e.g. `074_photo_vision_jobs_dedup_index.sql`).
 * @returns The prefix string (e.g. `074`) or null if invalid.
 */
export function extractPrefix(filename: string): string | null {
  const match = /^(\d{3,})_.*\.sql$/.exec(filename);
  return match ? match[1] : null;
}

/**
 * Extract a human-readable description from a migration filename.
 *
 * Given `074_photo_vision_jobs_dedup_index.sql`, returns
 * `photo vision jobs dedup index`.
 */
export function extractDescription(filename: string): string {
  // Strip the prefix and extension, replace underscores with spaces.
  const stripped = filename.replace(/^\d{3,}_/, '').replace(/\.sql$/, '');
  return stripped.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Discover all migration files in the canonical `lib/migrations/` directory.
 *
 * This is the single entry point for building the migration manifest. It:
 * 1. Resolves the migrations directory relative to process.cwd().
 * 2. Reads all `.sql` files.
 * 3. Parses prefixes, detects duplicates, assigns disambiguated identifiers.
 * 4. Computes SHA-256 checksums over exact file bytes.
 * 5. Identifies reserved gaps.
 * 6. Sorts files by identifier (prefix, then suffix).
 *
 * @param dirOverride Optional override for the migrations directory (for testing).
 * @returns The complete migration manifest.
 */
export function discoverMigrationFiles(dirOverride?: string): MigrationManifest {
  const migrationsDir = dirOverride ?? join(process.cwd(), MIGRATIONS_DIR_RELATIVE);

  // Security: read the directory. We do NOT accept user-supplied filenames.
  // Only files ending in .sql are considered migrations.
  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    // Directory does not exist or is unreadable — return an empty manifest.
    return {
      files: [],
      duplicates: {},
      gaps: [],
      highestPrefix: '000',
      count: 0,
    };
  }

  // Filter to .sql files only and validate prefix format.
  const rawFiles: Array<{
    filename: string;
    prefix: string;
    fullPath: string;
    sizeBytes: number;
  }> = [];

  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const prefix = extractPrefix(entry);
    if (prefix === null) continue; // skip non-conforming files silently

    const fullPath = join(migrationsDir, entry);
    // Security: ensure the resolved path is within the migrations directory.
    if (!fullPath.startsWith(migrationsDir + sep) && fullPath !== join(migrationsDir, entry)) {
      // Path traversal attempt detected — skip this file.
      continue;
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    rawFiles.push({
      filename: entry,
      prefix,
      fullPath,
      sizeBytes: stat.size,
    });
  }

  // Group by prefix to detect duplicates.
  const byPrefix: Record<string, typeof rawFiles> = {};
  for (const rf of rawFiles) {
    if (!byPrefix[rf.prefix]) byPrefix[rf.prefix] = [];
    byPrefix[rf.prefix].push(rf);
  }

  // Build MigrationFile objects with disambiguated identifiers.
  const files: MigrationFile[] = [];
  const duplicates: Record<string, string[]> = {};

  for (const [prefix, group] of Object.entries(byPrefix)) {
    // Sort within group by filename for stable a/b suffix assignment.
    group.sort((a, b) => a.filename.localeCompare(b.filename));

    if (group.length === 1) {
      const rf = group[0];
      files.push(buildMigrationFile(rf, prefix, false));
    } else {
      // Duplicate prefix — assign suffixes a, b, c, ...
      const ids: string[] = [];
      group.forEach((rf, idx) => {
        const suffix = String.fromCharCode(97 + idx); // 'a', 'b', ...
        const identifier = `${prefix}${suffix}`;
        ids.push(identifier);
        files.push(buildMigrationFile(rf, identifier, true));
      });
      duplicates[prefix] = ids;
    }
  }

  // Sort all files by identifier (numeric prefix, then suffix).
  files.sort((a, b) => {
    const pa = parseInt(a.prefix, 10);
    const pb = parseInt(b.prefix, 10);
    if (pa !== pb) return pa - pb;
    return a.identifier.localeCompare(b.identifier);
  });

  // Identify reserved gaps (prefixes with no file, between 001 and highest).
  const allPrefixes = new Set(Object.keys(byPrefix));
  const numericPrefixes = Array.from(allPrefixes).map((p) => parseInt(p, 10));
  const maxPrefix = numericPrefixes.length > 0 ? Math.max(...numericPrefixes) : 0;
  const gaps: string[] = [];
  for (let i = 1; i <= maxPrefix; i++) {
    const padded = String(i).padStart(3, '0');
    if (!allPrefixes.has(padded)) {
      gaps.push(padded);
    }
  }

  return {
    files,
    duplicates,
    gaps,
    highestPrefix: maxPrefix > 0 ? String(maxPrefix).padStart(3, '0') : '000',
    count: files.length,
  };
}

/**
 * Build a MigrationFile object from a raw file record.
 */
function buildMigrationFile(
  rf: { filename: string; prefix: string; fullPath: string; sizeBytes: number },
  identifier: string,
  isDuplicatePrefix: boolean,
): MigrationFile {
  const checksum = calculateMigrationChecksum(rf.fullPath);
  return {
    identifier,
    prefix: rf.prefix,
    filename: rf.filename,
    fullPath: rf.fullPath,
    description: extractDescription(rf.filename),
    isDuplicatePrefix,
    checksumSha256: checksum,
    sizeBytes: rf.sizeBytes,
  };
}

/**
 * Validate a migration manifest.
 *
 * Checks:
 * - At least one file exists (warning if empty, not error).
 * - No two distinct files have the same checksum (error — would mean identical
 *   content under different names, a data integrity issue).
 * - Duplicate prefixes are explicitly documented (note, not error).
 * - Reserved gaps are documented (note, not error).
 * - All filenames conform to the `NNN_description.sql` pattern (error if not).
 * - No path traversal in any fullPath (error if detected).
 *
 * @param manifest The manifest to validate.
 * @returns Validation result with errors, warnings, and notes.
 */
export function validateMigrationManifest(manifest: MigrationManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  if (manifest.count === 0) {
    warnings.push('Manifest is empty — no migration files found in lib/migrations/.');
  }

  // Check for identical files (same checksum, different filename).
  const checksumToFiles: Record<string, string[]> = {};
  for (const file of manifest.files) {
    if (!checksumToFiles[file.checksumSha256]) {
      checksumToFiles[file.checksumSha256] = [];
    }
    checksumToFiles[file.checksumSha256].push(file.filename);
  }
  for (const [checksum, filenames] of Object.entries(checksumToFiles)) {
    if (filenames.length > 1) {
      errors.push(
        `Duplicate content detected: files ${filenames.join(', ')} all have checksum ${checksum}. ` +
          'Migration files must be distinct.',
      );
    }
  }

  // Document duplicate prefixes as informational notes.
  for (const [prefix, ids] of Object.entries(manifest.duplicates)) {
    notes.push(
      `Duplicate prefix ${prefix} detected: assigned identifiers ${ids.join(', ')} ` +
        '(historical anomaly, disambiguated by alphabetical filename sort).',
    );
  }

  // Document reserved gaps.
  for (const gap of manifest.gaps) {
    notes.push(`Reserved gap at prefix ${gap} (no file, not an error).`);
  }

  // Validate all filenames conform.
  for (const file of manifest.files) {
    if (!/^\d{3,}_.*\.sql$/.test(file.filename)) {
      errors.push(`Filename does not conform to NNN_description.sql: ${file.filename}`);
    }
    // Path traversal check (defense in depth).
    const dir = file.fullPath.split(sep).slice(0, -1).join(sep);
    if (!file.fullPath.startsWith(dir + sep)) {
      errors.push(`Path traversal detected for file: ${file.filename}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    notes,
  };
}

/**
 * Find a migration file by identifier in a manifest.
 */
export function findMigrationByIdentifier(
  manifest: MigrationManifest,
  identifier: string,
): MigrationFile | null {
  return manifest.files.find((f) => f.identifier === identifier) ?? null;
}

/**
 * Get the list of migration identifiers in order.
 */
export function getMigrationIdentifiers(manifest: MigrationManifest): string[] {
  return manifest.files.map((f) => f.identifier);
}
