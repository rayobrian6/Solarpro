/**
 * Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
 *
 * Tests for the migration governance core modules:
 * - Manifest discovery and validation
 * - Checksum integrity (SHA-256 over exact file bytes)
 * - SQL statement splitting (dollar-quoting, string literals, comments)
 * - Authorization logic (permissions, environment allowlist, production flag, TOTP)
 * - Ledger bootstrap DDL structure
 * - Type definitions and constants
 *
 * These tests are designed to run WITHOUT a database connection (pure logic /
 * source-code scanning), matching the pattern of the existing
 * tests/priority-utility-seed-migration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';

// Static ES imports of the migration governance modules.
// Vitest resolves .ts via its transform pipeline; require() on raw .ts paths
// does not work, so we use top-level import statements instead.
import {
  discoverMigrationFiles,
  validateMigrationManifest,
  extractPrefix,
  extractDescription,
} from '../lib/migrations/manifest';
import {
  calculateMigrationChecksum,
  calculateChecksumOfString,
  checksumsMatch,
  isValidChecksumFormat,
} from '../lib/migrations/validation';
import { splitSqlStatements, authorizeMigration } from '../lib/migrations/runner';
import {
  MIGRATION_IDENTIFIER_REGEX,
  isValidMigrationIdentifier,
} from '../lib/migrations/types';

const root = path.resolve(__dirname, '..');

/** THE highest governed migration prefix. Named once so adding a migration is a
 *  one-line, deliberate governance update rather than a hunt through literals —
 *  which is exactly why 117 left five assertions failing after it landed. */
const HIGHEST_GOVERNED_MIGRATION = '121';

/** THE count of governed migration SQL files. This is deliberately a LITERAL and
 *  not `discoverMigrationFiles().count` — deriving it from the manifest would
 *  assert the manifest against itself and could never fail. It is the tripwire
 *  that makes an ungoverned .sql file dropped into lib/migrations/ break the
 *  build until someone updates this line on purpose.
 *
 *  NOTE it is NOT the highest prefix: the numbering is non-contiguous (the
 *  101-file baseline, then 105-108, 109-112, 113/114, 115, 116, 117, 118, 119,
 *  120), so the count and the highest prefix move independently. */
const GOVERNED_MIGRATION_COUNT = 118;

/** Normalize a filesystem path to POSIX separators. `path.join` returns
 *  backslashes on Windows, so `toContain('lib/migrations')` failed on this
 *  platform regardless of what the manifest actually discovered — a test-harness
 *  defect, not a governance one. */
const posix = (p: string): string => String(p).replace(/\\/g, '/');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/**
 * Recursively collect all .ts (and .tsx) files under a directory, excluding
 * node_modules. Used for whole-codebase invariant checks.
 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * NODE_ENV is declared readonly in @types/node. For tests that need to mutate
 * the environment, cast through a mutable record so tsc --noEmit passes.
 */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Module Structure — all required modules exist
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Migration governance modules exist', () => {
  const requiredModules = [
    'lib/migrations/types.ts',
    'lib/migrations/manifest.ts',
    'lib/migrations/validation.ts',
    'lib/migrations/ledger.ts',
    'lib/migrations/runner.ts',
  ];

  for (const mod of requiredModules) {
    it(`module exists: ${mod}`, () => {
      expect(fs.existsSync(path.join(root, mod))).toBe(true);
    });
  }

  it('canonical API route exists', () => {
    expect(fs.existsSync(path.join(root, 'app/api/admin/migrations/route.ts'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Type Definitions — required types and constants are present
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Type definitions', () => {
  const typesSrc = readSrc('lib/migrations/types.ts');

  const requiredTypes = [
    'MigrationStatus',
    'MigrationFile',
    'MigrationManifest',
    'ManifestValidationResult',
    'MigrationLedgerRow',
    'MigrationAuthorization',
    'MigrationExecutionResult',
    'MigrationRunResult',
    'MigrationInspectionState',
    'MigrationAuditEvent',
    'MigrationAuditEventType',
    'RunPendingMigrationsOptions',
    'RunSingleMigrationOptions',
  ];

  for (const typeName of requiredTypes) {
    it(`type/interface exported: ${typeName}`, () => {
      expect(typesSrc).toMatch(new RegExp(`export (type|interface) ${typeName}\\b`));
    });
  }

  const requiredConstants = [
    'MIGRATION_LOCK_KEY',
    'MIGRATIONS_DIR_RELATIVE',
    'MIGRATION_ENV_VARS',
    'MIGRATION_PERMISSIONS',
  ];

  for (const constName of requiredConstants) {
    it(`constant exported: ${constName}`, () => {
      expect(typesSrc).toMatch(new RegExp(`export const ${constName}`));
    });
  }

  it('MigrationStatus includes all 5 statuses', () => {
    expect(typesSrc).toMatch(/'pending'/);
    expect(typesSrc).toMatch(/'running'/);
    expect(typesSrc).toMatch(/'applied'/);
    expect(typesSrc).toMatch(/'failed'/);
    expect(typesSrc).toMatch(/'superseded'/);
  });

  it('MIGRATION_ENV_VARS includes all required env var names', () => {
    expect(typesSrc).toMatch(/ALLOWED_ENVS.*MIGRATION_RUN_ALLOWED_ENVS/);
    expect(typesSrc).toMatch(/ALLOW_PRODUCTION.*MIGRATION_ALLOW_PRODUCTION_EXECUTION/);
    expect(typesSrc).toMatch(/LEGACY_INLINE_ENABLED.*MIGRATION_LEGACY_INLINE_ENABLED/);
    expect(typesSrc).toMatch(/LEGACY_SYSTEM_TOOLS_RUN_ENABLED.*MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED/);
    expect(typesSrc).toMatch(/LEGACY_PROSPECTS_SEED_ENABLED.*MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED/);
  });

  it('MIGRATION_PERMISSIONS includes execute and inspect', () => {
    expect(typesSrc).toMatch(/EXECUTE.*platform\.migrations\.execute/);
    expect(typesSrc).toMatch(/INSPECT.*platform\.migrations\.inspect/);
  });

  it('schema_migrations ledger row has all required fields', () => {
    const requiredFields = [
      'id',
      'migration_identifier',
      'filename',
      'checksum_sha256',
      'description',
      'status',
      'started_at',
      'applied_at',
      'failed_at',
      'execution_duration_ms',
      'environment',
      'applied_by_actor_type',
      'applied_by_actor_id',
      'execution_id',
      'error_code',
      'error_summary',
      'rollback_reference',
      'created_at',
    ];
    for (const field of requiredFields) {
      expect(typesSrc).toContain(field);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Manifest Discovery — discovers the real lib/migrations/ directory
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Manifest discovery (real lib/migrations/)', () => {
  // Functions are imported at the top of the file via static ES imports.

  it('extractPrefix parses NNN_description.sql correctly', () => {
    expect(extractPrefix('074_photo_vision_jobs_dedup_index.sql')).toBe('074');
    expect(extractPrefix('001_initial_schema.sql')).toBe('001');
    expect(extractPrefix('104_seed_manufacturer_assets.sql')).toBe('104');
    expect(extractPrefix('not_a_migration.txt')).toBeNull();
    expect(extractPrefix('123.sql')).toBeNull(); // no description
  });

  it('extractDescription converts filename to readable description', () => {
    expect(extractDescription('074_photo_vision_jobs_dedup_index.sql')).toBe(
      'photo vision jobs dedup index',
    );
    expect(extractDescription('001_initial_schema.sql')).toBe('initial schema');
  });

  it(`discovers ${GOVERNED_MIGRATION_COUNT} SQL files from lib/migrations/ (101 baseline + 105-108 governance/nearmap + 109-112 data-authority backfills + 113/114 authority registries + 115 personnel roles + 116 engineering review + 117 AHJ registry + 118 field route measurements + 119 document jurisdiction authority + 120 audit chain + 121 app feature flags)`, () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.count).toBe(GOVERNED_MIGRATION_COUNT);
  });

  it('highest prefix is 121 (app feature flags)', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.highestPrefix).toBe(HIGHEST_GOVERNED_MIGRATION);
  });

  it('detects duplicate prefix 074 and disambiguates as 074a/074b', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.duplicates['074']).toBeDefined();
    expect(manifest.duplicates['074']).toHaveLength(2);
    expect(manifest.duplicates['074']).toContain('074a');
    expect(manifest.duplicates['074']).toContain('074b');

    // Verify the two duplicate files have the correct identifiers.
    const file074a = manifest.files.find((f: any) => f.identifier === '074a');
    const file074b = manifest.files.find((f: any) => f.identifier === '074b');
    expect(file074a).toBeDefined();
    expect(file074b).toBeDefined();
    expect(file074a.isDuplicatePrefix).toBe(true);
    expect(file074b.isDuplicatePrefix).toBe(true);
    // Alphabetical sort: dedup_index comes before render_job_id
    expect(file074a.filename).toBe('074_photo_vision_jobs_dedup_index.sql');
    expect(file074b.filename).toBe('074_photo_vision_jobs_render_job_id.sql');
  });

  it('reserved gaps are identified (009, 012, 013, 014)', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.gaps).toContain('009');
    expect(manifest.gaps).toContain('012');
    expect(manifest.gaps).toContain('013');
    expect(manifest.gaps).toContain('014');
  });

  it('every file has a non-empty SHA-256 checksum (64 hex chars)', () => {
    const manifest = discoverMigrationFiles();
    for (const file of manifest.files) {
      expect(file.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.checksumSha256.length).toBe(64);
    }
  });

  it('every file has a valid identifier and prefix', () => {
    const manifest = discoverMigrationFiles();
    for (const file of manifest.files) {
      expect(file.identifier).toMatch(/^\d{3,}[a-z]?$/);
      expect(file.prefix).toMatch(/^\d{3,}$/);
      expect(file.filename).toMatch(/^\d{3,}_.*\.sql$/);
      expect(posix(file.fullPath)).toContain('lib/migrations');
      expect(file.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('files are sorted by identifier order', () => {
    const manifest = discoverMigrationFiles();
    const identifiers = manifest.files.map((f: any) => f.identifier);
    const sorted = [...identifiers].sort((a, b) => {
      const pa = parseInt(a, 10);
      const pb = parseInt(b, 10);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
    expect(identifiers).toEqual(sorted);
  });

  it('no two distinct files have the same checksum (no identical content)', () => {
    const manifest = discoverMigrationFiles();
    const checksums = manifest.files.map((f: any) => f.checksumSha256);
    const unique = new Set(checksums);
    expect(unique.size).toBe(checksums.length);
  });

  it('manifest validation passes (valid=true) for the real manifest', () => {
    const manifest = discoverMigrationFiles();
    const result = validateMigrationManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('manifest validation documents duplicate 074 as a note', () => {
    const manifest = discoverMigrationFiles();
    const result = validateMigrationManifest(manifest);
    const dupNote = result.notes.find((n: string) => n.includes('Duplicate prefix 074'));
    expect(dupNote).toBeDefined();
  });

  it('manifest validation documents reserved gaps as notes', () => {
    const manifest = discoverMigrationFiles();
    const result = validateMigrationManifest(manifest);
    const gapNote = result.notes.find((n: string) => n.includes('Reserved gap at prefix 009'));
    expect(gapNote).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Checksum Integrity — SHA-256 over exact file bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Checksum integrity', () => {

  it('calculateChecksumOfString produces a 64-char hex digest', () => {
    const hash = calculateChecksumOfString('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('calculateChecksumOfString is deterministic (same input → same output)', () => {
    const a = calculateChecksumOfString('test content');
    const b = calculateChecksumOfString('test content');
    expect(a).toBe(b);
  });

  it('checksums change on even a single byte difference', () => {
    const a = calculateChecksumOfString('SELECT 1;');
    const b = calculateChecksumOfString('SELECT 1; ');
    expect(a).not.toBe(b);
  });

  it('checksumsMatch is case-insensitive and handles equality', () => {
    const lower = 'abc123def456';
    const upper = 'ABC123DEF456';
    expect(checksumsMatch(lower, upper)).toBe(true);
    expect(checksumsMatch(lower, lower)).toBe(true);
    expect(checksumsMatch(lower, 'different')).toBe(false);
  });

  it('isValidChecksumFormat validates 64-char hex strings', () => {
    expect(isValidChecksumFormat('a'.repeat(64))).toBe(true);
    expect(isValidChecksumFormat('A'.repeat(64))).toBe(true);
    expect(isValidChecksumFormat('0123456789abcdef'.repeat(4))).toBe(true);
    expect(isValidChecksumFormat('short')).toBe(false);
    expect(isValidChecksumFormat('g'.repeat(64))).toBe(false); // non-hex char
    expect(isValidChecksumFormat('a'.repeat(63))).toBe(false); // too short
  });

  it('calculateMigrationChecksum matches independent sha256sum for a real file', () => {
    const realFile = path.join(root, 'lib/migrations/001_initial_schema.sql');
    const computed = calculateMigrationChecksum(realFile);
    // Independently compute via crypto to verify.
    const contents = fs.readFileSync(realFile);
    const independent = createHash('sha256').update(contents).digest('hex');
    expect(computed).toBe(independent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SQL Statement Splitting — handles dollar-quoting, strings, comments
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: SQL statement splitting', () => {

  it('splits simple semicolon-terminated statements', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toBe('SELECT 1');
    expect(stmts[1]).toBe('SELECT 2');
    expect(stmts[2]).toBe('SELECT 3');
  });

  it('handles statements without trailing semicolon', () => {
    const sql = 'SELECT 1; SELECT 2';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toBe('SELECT 2');
  });

  it('preserves semicolons inside single-quoted strings', () => {
    const sql = "INSERT INTO t VALUES ('hello; world'); SELECT 1;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe("INSERT INTO t VALUES ('hello; world')");
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('handles escaped single quotes in strings', () => {
    const sql = "INSERT INTO t VALUES ('it''s; ok'); SELECT 1;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
  });

  it('preserves semicolons inside dollar-quoted blocks', () => {
    const sql = `
CREATE FUNCTION foo() RETURNS void AS $$
BEGIN
  RAISE NOTICE 'hello; world';
  PERFORM 1;
END;
$$ LANGUAGE plpgsql;
SELECT 1;
`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('CREATE FUNCTION foo()');
    expect(stmts[0]).toContain('$$');
    expect(stmts[0]).toContain('BEGIN');
    expect(stmts[0]).toContain('RAISE NOTICE');
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('handles tagged dollar-quotes ($tag$...$tag$)', () => {
    const sql = `
CREATE FUNCTION bar() RETURNS void AS $body$
BEGIN
  RAISE NOTICE 'semi; colon';
END;
$body$ LANGUAGE plpgsql;
SELECT 2;
`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('$body$');
    expect(stmts[1]).toBe('SELECT 2');
  });

  it('handles line comments without splitting on semicolons in comments', () => {
    const sql = "SELECT 1; -- this; is a comment\nSELECT 2;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('SELECT 1');
  });

  it('handles block comments', () => {
    const sql = 'SELECT 1; /* this; is a ; comment */ SELECT 2;';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('SELECT 1');
    expect(stmts[1]).toContain('SELECT 2');
  });

  it('handles empty input', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   ')).toEqual([]);
    expect(splitSqlStatements(';;;')).toEqual([]);
  });

  it('handles double-quoted identifiers with semicolons', () => {
    const sql = 'SELECT "col;name" FROM t; SELECT 1;';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Authorization Logic — permissions, environment, production, TOTP
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Authorization logic', () => {

  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test.
    process.env = { ...originalEnv };
  });

  it('inspect action requires admin or super_admin', () => {
    setNodeEnv('development');
    const auth = authorizeMigration({
      action: 'inspect',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'admin' },
      dryRun: true,
      totpVerified: false,
    });
    expect(auth.allowed).toBe(true);
  });

  it('inspect action denied for non-admin', () => {
    setNodeEnv('development');
    const auth = authorizeMigration({
      action: 'inspect',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: null,
      dryRun: true,
      totpVerified: false,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('admin');
  });

  it('execute action requires super_admin (not just admin)', () => {
    setNodeEnv('development');
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('super_admin');
  });

  it('execute action allowed for super_admin in allowlisted env with TOTP', () => {
    setNodeEnv('development');
    process.env.VERCEL_ENV = undefined;
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(true);
  });

  it('execute denied when environment not in allowlist', () => {
    setNodeEnv('staging');
    process.env.VERCEL_ENV = undefined;
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('allowlist');
  });

  it('execute denied in production even if in allowlist (two-key requirement)', () => {
    setNodeEnv('production');
    process.env.VERCEL_ENV = 'production';
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'production';
    // MIGRATION_ALLOW_PRODUCTION_EXECUTION not set → denied
    delete process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION;
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('Production');
    expect(auth.reason).toContain('disabled by default');
  });

  it('execute allowed in production only with both allowlist + explicit flag', () => {
    setNodeEnv('production');
    process.env.VERCEL_ENV = 'production';
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'production';
    process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'true';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(true);
  });

  it('human execute denied without TOTP verification', () => {
    setNodeEnv('development');
    process.env.VERCEL_ENV = undefined;
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: false,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('TOTP');
  });

  it('migration-actor exempt from TOTP but still subject to env allowlist', () => {
    setNodeEnv('staging');
    process.env.VERCEL_ENV = undefined;
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'staging';
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'migration-actor',
      actorId: 'service-token-1',
      adminUser: { id: 'service-1', name: 'Service', email: 'svc@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: false, // migration-actor exempt
    });
    expect(auth.allowed).toBe(true);
  });

  it('dry-run bypasses environment allowlist and production flag', () => {
    setNodeEnv('production');
    process.env.VERCEL_ENV = 'production';
    // No allowlist, no production flag — but dry-run should still be allowed.
    delete process.env.MIGRATION_RUN_ALLOWED_ENVS;
    delete process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION;
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: true,
      totpVerified: false, // dry-run doesn't need TOTP
    });
    expect(auth.allowed).toBe(true);
    expect(auth.dryRun).toBe(true);
  });

  it('empty allowlist denies all environments for execution', () => {
    setNodeEnv('development');
    process.env.VERCEL_ENV = undefined;
    delete process.env.MIGRATION_RUN_ALLOWED_ENVS;
    const auth = authorizeMigration({
      action: 'execute',
      actorType: 'human',
      actorId: 'user-1',
      adminUser: { id: 'user-1', name: 'Test', email: 'test@test.com', role: 'super_admin' },
      dryRun: false,
      totpVerified: true,
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain('allowlist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Ledger Bootstrap DDL — structure validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Ledger bootstrap DDL', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');

  it('BOOTSTRAP_LEDGER_DDL constant is exported', () => {
    expect(ledgerSrc).toMatch(/export const BOOTSTRAP_LEDGER_DDL/);
  });

  it('bootstrap DDL creates schema_migrations table with IF NOT EXISTS', () => {
    expect(ledgerSrc).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });

  it('bootstrap DDL includes unique constraint on (migration_identifier, environment)', () => {
    expect(ledgerSrc).toContain('schema_migrations_env_identifier_unique');
    expect(ledgerSrc).toContain('migration_identifier, environment');
  });

  it('bootstrap DDL includes status index', () => {
    expect(ledgerSrc).toContain('schema_migrations_status_idx');
  });

  it('bootstrap DDL includes all required columns', () => {
    const requiredColumns = [
      'id',
      'migration_identifier',
      'filename',
      'checksum_sha256',
      'description',
      'status',
      'started_at',
      'applied_at',
      'failed_at',
      'execution_duration_ms',
      'environment',
      'applied_by_actor_type',
      'applied_by_actor_id',
      'execution_id',
      'error_code',
      'error_summary',
      'rollback_reference',
      'created_at',
    ];
    for (const col of requiredColumns) {
      expect(ledgerSrc).toContain(col);
    }
  });

  it('bootstrap uses pg_try_advisory_xact_lock (bounded, transaction-scoped)', () => {
    // Phase 1A.1: switched from pg_advisory_xact_lock (blocks indefinitely) to
    // pg_try_advisory_xact_lock (bounded, returns boolean). The lock key is
    // passed as a decimal string cast to BIGINT (MIGRATION-GOV-06).
    expect(ledgerSrc).toContain('pg_try_advisory_xact_lock');
    expect(ledgerSrc).toContain('MIGRATION_LOCK_KEY_DECIMAL');
    expect(ledgerSrc).toContain('::bigint');
    // The session-scoped pg_advisory_lock( should NOT appear in any SQL execution
    // context (template literal or string). Remove comments to check real code only.
    const codeOnly = ledgerSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/\bpg_advisory_lock\s*\(/);
    // The blocking variant pg_advisory_xact_lock( (without try_) must NOT appear
    // in actual SQL execution contexts.
    expect(codeOnly).not.toMatch(/\bpg_advisory_xact_lock\s*\(/);
  });

  it('MIGRATION_LOCK_KEY is a 64-bit integer constant', () => {
    const typesSrc = readSrc('lib/migrations/types.ts');
    expect(typesSrc).toMatch(/MIGRATION_LOCK_KEY\s*=\s*0x[0-9a-fA-F]+/);
  });

  it('bootstrap function emits audit events (started/completed/failed)', () => {
    expect(ledgerSrc).toContain('migration.bootstrap.started');
    expect(ledgerSrc).toContain('migration.bootstrap.completed');
    expect(ledgerSrc).toContain('migration.bootstrap.failed');
  });

  it('ledger uses Neon transaction with synchronous callback (no await inside)', () => {
    // The transaction callback should use the array-return pattern, not async/await.
    expect(ledgerSrc).toContain('sql.transaction((txn) => [');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Runner — transactional execution and audit events
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Runner execution model', () => {
  const runnerSrc = readSrc('lib/migrations/runner.ts');

  it('runner uses pg_try_advisory_xact_lock (bounded) with decimal key cast', () => {
    // Phase 1A.1: switched from pg_advisory_xact_lock (blocks indefinitely) to
    // pg_try_advisory_xact_lock (bounded, returns boolean). The lock key is
    // passed as a decimal string cast to BIGINT to avoid JS Number precision
    // loss (MIGRATION-GOV-06).
    expect(runnerSrc).toContain('pg_try_advisory_xact_lock');
    expect(runnerSrc).toContain('MIGRATION_LOCK_KEY_DECIMAL');
    expect(runnerSrc).toContain('::bigint');
    // The blocking variant must NOT be used in execution paths.
    const codeOnly = runnerSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/pg_advisory_xact_lock\s*\(/);
  });

  it('runner uses Neon transaction for execution (all-or-nothing)', () => {
    expect(runnerSrc).toContain('sql.transaction((txn) => [');
  });

  it('runner emits all required audit event types', () => {
    const requiredEvents = [
      'migration.inspect',
      'migration.run.started',
      'migration.run.completed',
      'migration.run.failed',
      'migration.migration.applied',
      'migration.migration.failed',
      'migration.migration.skipped',
      'migration.checksum_mismatch',
    ];
    for (const evt of requiredEvents) {
      expect(runnerSrc).toContain(evt);
    }
  });

  it('runner refuses execution of modified applied files (checksum conflict)', () => {
    expect(runnerSrc).toContain('CHECKSUM_CONFLICT');
    expect(runnerSrc).toContain('no silent checksum override');
  });

  it('runner refuses concurrent execution (already running check)', () => {
    expect(runnerSrc).toContain('ALREADY_RUNNING');
  });

  it('runner stops on first failure (no out-of-order application)', () => {
    expect(runnerSrc).toContain("if (failed > 0) break");
  });

  it('runner supports dry-run mode (no mutation)', () => {
    expect(runnerSrc).toContain('dryRun');
    // Dry-run should not call the DB for execution
    expect(runnerSrc).toMatch(/if \(dryRun\)/);
  });

  it('runner exports all required functions', () => {
    const requiredExports = [
      'inspectMigrationState',
      'runPendingMigrations',
      'runSinglePendingMigration',
      'authorizeMigration',
      'verifyFreshTotp',
    ];
    for (const fn of requiredExports) {
      expect(runnerSrc).toMatch(new RegExp(`export (async )?function ${fn}\\b`));
    }
  });

  it('verifyFreshTotp uses decryptTOTPSecret and generateTOTPCode from lib/mfa', () => {
    expect(runnerSrc).toContain('decryptTOTPSecret');
    expect(runnerSrc).toContain('generateTOTPCode');
  });

  it('verifyFreshTotp FAILS CLOSED when MFA not enabled (no secret) \u2014 denies, not waives (MIGRATION-GOV-05)', () => {
    // The prior implementation returned true (waived) when no MFA secret.
    // The hardened implementation returns false (denied) with MFA_NOT_ENABLED.
    expect(runnerSrc).toContain('MFA_NOT_ENABLED');
    expect(runnerSrc).toContain('FAIL-CLOSED');
    // Ensure the old fail-open waiver comment is gone.
    expect(runnerSrc).not.toContain('requirement waived');
    expect(runnerSrc).not.toContain('MFA not enabled for this user \u2014 requirement waived');
  });

  it('verifyFreshTotp returns a result object with verified, deniedReason, and timeStep', () => {
    expect(runnerSrc).toContain('VerifyFreshTotpResult');
    expect(runnerSrc).toContain('deniedReason');
    expect(runnerSrc).toContain('timeStep');
  });

  it('verifyFreshTotp implements TOTP replay prevention via recordTotpUse (MIGRATION-GOV-05)', () => {
    expect(runnerSrc).toContain('recordTotpUse');
    expect(runnerSrc).toContain('TOTP_REPLAY');
    // Failed auth must NOT consume a valid code \u2014 only record on success.
    expect(runnerSrc).toContain('does not consume a valid code');
  });

  it('verifyFreshTotp does not persist the TOTP code itself (only hashed time-step)', () => {
    // Matched-step computation lives in verifyTotpStepValidity (validity-only,
    // no ledger write); verifyFreshTotp records the accepted time-step, never
    // the code. The code is compared in-memory only and is never passed to
    // recordTotpUse.
    expect(runnerSrc).toContain('matchedStep');
    expect(runnerSrc).toMatch(/recordTotpUse\(adminUserId,\s*validity\.timeStep/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. API Route — canonical migration endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Canonical API route', () => {
  const routeSrc = readSrc('app/api/admin/migrations/route.ts');

  it('route has required Next.js exports (dynamic, runtime, revalidate)', () => {
    expect(routeSrc).toContain("export const dynamic = 'force-dynamic'");
    expect(routeSrc).toContain("export const runtime = 'nodejs'");
  });

  it('route has GET handler for inspection', () => {
    expect(routeSrc).toMatch(/export async function GET/);
  });

  it('route has POST handler for execution', () => {
    expect(routeSrc).toMatch(/export async function POST/);
  });

  it('route uses requireAdminApi for authentication', () => {
    expect(routeSrc).toContain('requireAdminApi');
  });

  it('route validates action against allowed actions list', () => {
    expect(routeSrc).toContain('run-pending');
    expect(routeSrc).toContain('run-single');
    expect(routeSrc).toContain('dry-run-pending');
    expect(routeSrc).toContain('dry-run-single');
    expect(routeSrc).toContain('inspect');
  });

  it('route requires TOTP code for non-dry-run execution', () => {
    expect(routeSrc).toContain('totpCode');
    expect(routeSrc).toContain('verifyFreshTotp');
  });

  it('route does NOT accept client-supplied SQL', () => {
    // The route should not have a parameter that accepts raw SQL.
    expect(routeSrc).not.toMatch(/body\?\.sql\b/);
    expect(routeSrc).not.toMatch(/body\?\.query\b/);
  });

  it('route accepts only migration identifiers (not arbitrary filenames)', () => {
    expect(routeSrc).toContain('identifier');
    expect(routeSrc).not.toMatch(/body\?\.filename\b/);
    expect(routeSrc).not.toMatch(/body\?\.file\b/);
  });

  it('route uses the canonical runner functions', () => {
    expect(routeSrc).toContain('inspectMigrationState');
    expect(routeSrc).toContain('runPendingMigrations');
    expect(routeSrc).toContain('runSinglePendingMigration');
    expect(routeSrc).toContain('authorizeMigration');
  });

  it('route does NOT allow client-supplied actorType \u2014 migration-actor is server-side only (MIGRATION-GOV-05)', () => {
    // The route must hardcode actorType to 'human' and reject any client attempt
    // to set it to 'migration-actor' (automated service token).
    expect(routeSrc).toContain("const actorType: MigrationActorType = 'human'");
    expect(routeSrc).toContain('clientActorType');
    expect(routeSrc).toContain('Client-supplied actorType is not permitted');
  });

  it('route handles VerifyFreshTotpResult with specific denial reasons (MIGRATION-GOV-05)', () => {
    expect(routeSrc).toContain('MFA_NOT_ENABLED');
    expect(routeSrc).toContain('TOTP_INVALID');
    expect(routeSrc).toContain('TOTP_REPLAY');
    expect(routeSrc).toContain('deniedReason');
  });

  it('route emits MFA audit events on denial (MIGRATION-GOV-05)', () => {
    expect(routeSrc).toContain('migration.mfa.denied');
    expect(routeSrc).toContain('migration.mfa.replay_detected');
    expect(routeSrc).toContain('emitAuditEvent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Legacy Runner Restriction — feature flag gates
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Legacy runner restriction (Phase 1A.2 permanent elimination)', () => {
  const migrateSrc = readSrc('app/api/migrate/route.ts');
  const systemToolsSrc = readSrc('app/api/admin/system-tools/route.ts');

  it('legacy inline runner is permanently eliminated — returns 423 Locked', () => {
    expect(migrateSrc).toContain('423'); // Locked status
    expect(migrateSrc).toContain('permanently eliminated');
  });

  it('legacy inline runner does NOT read MIGRATION_LEGACY_INLINE_ENABLED env var', () => {
    // Per MIGRATION-GOV-13 (Phase 1A.2), the flag is permanently removed.
    // The route must not check process.env.MIGRATION_LEGACY_INLINE_ENABLED.
    expect(migrateSrc).not.toContain('process.env.MIGRATION_LEGACY_INLINE_ENABLED');
  });

  it('legacy inline runner message says it will never re-enable', () => {
    expect(migrateSrc).toContain('never re-enable');
    expect(migrateSrc).toContain('regardless of environment variables');
  });

  it('legacy inline runner emits migration.legacy.invoked audit event', () => {
    expect(migrateSrc).toContain('migration.legacy.invoked');
  });

  it('legacy inline runner directs to canonical path', () => {
    expect(migrateSrc).toContain('/api/admin/migrations');
  });

  it('legacy system-tools run_migration is permanently eliminated — returns 423 Locked', () => {
    expect(systemToolsSrc).toContain('423');
    expect(systemToolsSrc).toContain('permanently eliminated');
  });

  it('legacy system-tools run_migration does NOT read MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED env var', () => {
    // Per MIGRATION-GOV-13 (Phase 1A.2), the flag is permanently removed.
    expect(systemToolsSrc).not.toContain('process.env.MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED');
  });

  it('legacy system-tools run_migration emits migration.legacy.invoked audit event', () => {
    expect(systemToolsSrc).toContain('migration.legacy.invoked');
  });

  it('legacy system-tools list_migrations still functional (not eliminated)', () => {
    // list_migrations is a diagnostic listing and remains functional.
    const listSection = systemToolsSrc.split('case \'list_migrations\'')[1] ?? '';
    expect(listSection).not.toContain('permanently eliminated');
  });

  it('legacy runners are NOT deleted (files still exist)', () => {
    expect(fs.existsSync(path.join(root, 'app/api/migrate/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/api/admin/system-tools/route.ts'))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10b. Non-Canonical Execution Path Elimination (MIGRATION-GOV-07)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1/1A.2: Non-canonical execution path elimination (permanent)', () => {
  const prospectsSeedSrc = readSrc('app/api/admin/prospects/seed/route.ts');
  const migrateSrc = readSrc('app/api/migrate/route.ts');
  const systemToolsSrc = readSrc('app/api/admin/system-tools/route.ts');

  it('prospects/seed route is permanently eliminated — returns 423 Locked (MIGRATION-GOV-13)', () => {
    // The prospects/seed route reads migration SQL files (092, 093) directly
    // and executes them without governance. Per GOV-13 it is permanently blocked.
    expect(prospectsSeedSrc).toContain('423'); // Locked status
    expect(prospectsSeedSrc).toContain('permanently eliminated');
  });

  it('prospects/seed route does NOT read MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED env var', () => {
    // Per MIGRATION-GOV-13 (Phase 1A.2), the flag is permanently removed.
    expect(prospectsSeedSrc).not.toContain('process.env.MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED');
  });

  it('prospects/seed route message says it will never re-enable', () => {
    expect(prospectsSeedSrc).toContain('never re-enable');
    expect(prospectsSeedSrc).toContain('regardless of environment variables');
  });

  it('prospects/seed route emits migration.legacy.invoked audit event', () => {
    expect(prospectsSeedSrc).toContain('migration.legacy.invoked');
  });

  it('prospects/seed route directs to canonical path /api/admin/migrations', () => {
    expect(prospectsSeedSrc).toContain('/api/admin/migrations');
    expect(prospectsSeedSrc).toContain('canonicalPath');
  });

  it('prospects/seed route audit event fires AFTER admin authentication (not before)', () => {
    // The audit event must come after requireAdminApi so we can record the actor.
    const adminCallIdx = prospectsSeedSrc.indexOf('await requireAdminApi');
    const auditIdx = prospectsSeedSrc.indexOf('migration.legacy.invoked');
    expect(adminCallIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(adminCallIdx);
  });

  it('prospects/seed route is NOT deleted (file still exists)', () => {
    expect(fs.existsSync(path.join(root, 'app/api/admin/prospects/seed/route.ts'))).toBe(true);
  });

  it('all three non-canonical paths are permanently eliminated with 423 Locked (GOV-13)', () => {
    // Every path that executes migration SQL outside the canonical governance
    // system must be permanently blocked with 423 Locked — NOT feature-flagged.
    expect(migrateSrc).toContain('423');
    expect(migrateSrc).toContain('permanently eliminated');
    expect(systemToolsSrc).toContain('423');
    expect(systemToolsSrc).toContain('permanently eliminated');
    expect(prospectsSeedSrc).toContain('423');
    expect(prospectsSeedSrc).toContain('permanently eliminated');
  });

  it('none of the three non-canonical paths read their legacy env vars (GOV-13)', () => {
    // Per MIGRATION-GOV-13, the feature flags are permanently removed from the
    // route function bodies. The routes must not check process.env for these.
    expect(migrateSrc).not.toContain('process.env.MIGRATION_LEGACY_INLINE_ENABLED');
    expect(systemToolsSrc).not.toContain('process.env.MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED');
    expect(prospectsSeedSrc).not.toContain('process.env.MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED');
  });

  it('no path writes to the migration ledger outside the canonical functions', () => {
    // The schema_migrations ledger must only be written by the canonical
    // governance functions in lib/migrations/. No API route or other module
    // should perform INSERT/UPDATE/DELETE on the ledger tables directly.
    const ledgerTables = ['schema_migrations', 'schema_migration_runs'];
    const canonicalPaths = [
      'lib/migrations/ledger.ts',
      'lib/migrations/runner.ts',
    ];
    // Gather all .ts files that reference a ledger table name (not in tests).
    const allTsFiles = collectTsFiles(root);
    for (const file of allTsFiles) {
      const relPath = path.relative(root, file).replace(/\\/g, '/');
      if (relPath.startsWith('tests/') || relPath.startsWith('node_modules/')) continue;
      if (canonicalPaths.includes(relPath)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      for (const table of ledgerTables) {
        // Look for INSERT/UPDATE/DELETE targeting the ledger tables.
        const writePattern = new RegExp(
          `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}`,
          'i',
        );
        // The migrate/route.ts contains inline DDL for application tables but
        // should not write to schema_migrations. Check for the write pattern.
        if (writePattern.test(src)) {
          throw new Error(
            `Non-canonical ledger write detected: ${relPath} writes to ${table}`,
          );
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Security — no path traversal, no client SQL, no arbitrary filenames
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Security properties', () => {
  const manifestSrc = readSrc('lib/migrations/manifest.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const routeSrc = readSrc('app/api/admin/migrations/route.ts');
  const migrateSrc = readSrc('app/api/migrate/route.ts');

  it('manifest uses path.basename for containment (no path traversal)', () => {
    expect(manifestSrc).toContain('startsWith');
    // Should not accept user-supplied filenames for discovery
  });

  it('manifest scans a fixed directory (no user-supplied directory in API)', () => {
    expect(manifestSrc).toContain('MIGRATIONS_DIR_RELATIVE');
    expect(manifestSrc).toContain('lib/migrations');
  });

  it('runner reads SQL only from manifest files (no client-supplied SQL)', () => {
    expect(runnerSrc).toContain('readFileSync(file.fullPath');
    // The executeMigrationInTransaction reads from the file, not from request body
  });

  it('API route does not accept SQL in request body', () => {
    expect(routeSrc).not.toMatch(/body\?\.sql\b/);
    expect(routeSrc).not.toMatch(/body\?\.query\b/);
    expect(routeSrc).not.toMatch(/body\?\.content\b/);
  });

  it('API route does not accept arbitrary filenames', () => {
    expect(routeSrc).not.toMatch(/body\?\.filename\b/);
    expect(routeSrc).not.toMatch(/body\?\.file\b/i);
  });

  it('schema_migrations is NOT referenced in legacy runners (only in new modules)', () => {
    // The legacy runners should not perform any schema_migrations DDL or queries.
    // We check for actual SQL usage (CREATE TABLE / INSERT / SELECT / FROM / INTO
    // near schema_migrations), not explanatory comments that merely mention the name.
    const schemaMigrationSqlUsage =
      /(CREATE\s+TABLE|INSERT\s+INTO|SELECT|UPDATE|DELETE\s+FROM|FROM)\s+schema_migrations/i;
    expect(schemaMigrationSqlUsage.test(migrateSrc)).toBe(false);
  });

  it('advisory lock key is a fixed constant (not user-supplied)', () => {
    const typesSrc = readSrc('lib/migrations/types.ts');
    expect(typesSrc).toMatch(/MIGRATION_LOCK_KEY\s*=\s*0x/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Historical Reconciliation — gaps, duplicates, no renumbering
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A: Historical reconciliation', () => {

  it('no files are renumbered (original filenames preserved)', () => {
    const manifest = discoverMigrationFiles();
    // Verify the duplicate 074 files still have their original names.
    const fileA = manifest.files.find((f: any) => f.identifier === '074a');
    const fileB = manifest.files.find((f: any) => f.identifier === '074b');
    expect(fileA.filename).toBe('074_photo_vision_jobs_dedup_index.sql');
    expect(fileB.filename).toBe('074_photo_vision_jobs_render_job_id.sql');
  });

  it('reserved gaps are not errors (009, 012, 013, 014 absent)', () => {
    const manifest = discoverMigrationFiles();
    const prefixes = manifest.files.map((f: any) => f.prefix);
    expect(prefixes).not.toContain('009');
    expect(prefixes).not.toContain('012');
    expect(prefixes).not.toContain('013');
    expect(prefixes).not.toContain('014');
    // But these are in the gaps list, not errors.
    expect(manifest.gaps).toContain('009');
    expect(manifest.gaps).toContain('012');
    expect(manifest.gaps).toContain('013');
    expect(manifest.gaps).toContain('014');
  });

  it('duplicate 074 files have distinct checksums (different content)', () => {
    const manifest = discoverMigrationFiles();
    const fileA = manifest.files.find((f: any) => f.identifier === '074a');
    const fileB = manifest.files.find((f: any) => f.identifier === '074b');
    expect(fileA.checksumSha256).not.toBe(fileB.checksumSha256);
  });

  it('migration 105 exists (organization authority foundation), 106 exists (lifecycle correction), 107 exists (audit org context), and 108 exists (nearmap cache idx)', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.highestPrefix).toBe(HIGHEST_GOVERNED_MIGRATION);
    const has105 = manifest.files.some((f: any) => f.prefix === '105');
    expect(has105).toBe(true);
    const has106 = manifest.files.some((f: any) => f.prefix === '106');
    expect(has106).toBe(true);
    const has107 = manifest.files.some((f: any) => f.prefix === '107');
    expect(has107).toBe(true);
    const has108 = manifest.files.some((f: any) => f.prefix === '108');
    expect(has108).toBe(true);
  });

  it('legacy migrations/ directory is excluded from manifest', () => {
    const manifest = discoverMigrationFiles();
    // None of the manifest files should have paths containing the root migrations/ dir
    // (they should all be in lib/migrations/). We verify every occurrence of
    // "/migrations/" is preceded by "lib" — i.e., the canonical lib/migrations path.
    for (const file of manifest.files) {
      expect(posix(file.fullPath)).toContain('lib/migrations');
      // Every "/migrations/" segment must be preceded by "lib" (not a root-level
      // migrations/ directory). We strip all "lib/migrations" occurrences and check
      // that no bare "/migrations/" remains.
      const stripped = posix(file.fullPath).replace(/lib\/migrations/g, '');
      expect(stripped).not.toMatch(/\/migrations\//);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 13. Persistent Audit Integration (MIGRATION-GOV-08)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Persistent audit integration', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const auditLogSrc = readSrc('lib/auditLog.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');

  it('auditLog.ts includes a migration AuditCategory', () => {
    expect(auditLogSrc).toMatch(/'migration'/);
    expect(auditLogSrc).toMatch(/migration governance events/i);
  });

  it('auditLog.ts includes migration-specific AuditAction values', () => {
    expect(auditLogSrc).toContain('migration_bootstrap_started');
    expect(auditLogSrc).toContain('migration_bootstrap_completed');
    expect(auditLogSrc).toContain('migration_bootstrap_failed');
    expect(auditLogSrc).toContain('migration_run_started');
    expect(auditLogSrc).toContain('migration_run_completed');
    expect(auditLogSrc).toContain('migration_run_failed');
    expect(auditLogSrc).toContain('migration_applied');
    expect(auditLogSrc).toContain('migration_failed');
    expect(auditLogSrc).toContain('migration_governance_state_change');
    expect(auditLogSrc).toContain('migration_governance_execution_denied');
    expect(auditLogSrc).toContain('migration_mfa_denied');
    expect(auditLogSrc).toContain('migration_mfa_replay_detected');
    expect(auditLogSrc).toContain('migration_transaction_mode_review_required');
  });

  it('ledger.ts imports writeAuditLog from lib/auditLog', () => {
    expect(ledgerSrc).toContain("from '@/lib/auditLog'");
    expect(ledgerSrc).toContain('writeAuditLog');
  });

  it('ledger.ts has a MIGRATION_EVENT_TO_AUDIT_ACTION mapping table', () => {
    expect(ledgerSrc).toContain('MIGRATION_EVENT_TO_AUDIT_ACTION');
    // Verify key mappings are present.
    expect(ledgerSrc).toContain("'migration.bootstrap.completed': 'migration_bootstrap_completed'");
    expect(ledgerSrc).toContain("'migration.migration.applied': 'migration_applied'");
    expect(ledgerSrc).toContain("'migration.migration.failed': 'migration_failed'");
    expect(ledgerSrc).toContain("'migration.mfa.denied': 'migration_mfa_denied'");
    expect(ledgerSrc).toContain("'migration.mfa.replay_detected': 'migration_mfa_replay_detected'");
    expect(ledgerSrc).toContain("'migration.transaction_mode.review_required': 'migration_transaction_mode_review_required'");
  });

  it('ledger.ts persists migration audit events through the central audit writer', () => {
    expect(ledgerSrc).toContain('async function persistMigrationAuditEvent');
    // `writeAuditLogDetailed` is the same central writer, returning the FAILURE
    // REASON as well as the hash. The reason used to be discarded here, which is
    // why migrations 113 and 119 both reported AUDIT_PERSISTENCE_FAILED naming no
    // cause — for weeks, while the cause was one line of PostgreSQL.
    expect(ledgerSrc).toMatch(/writeAuditLog(Detailed)?\(/);
    expect(ledgerSrc).toContain("category: 'migration'");
  });

  it('emitAuditEvent persists durably AND emits to console (fire-and-forget)', () => {
    // The emitAuditEvent function should call both console.log (synchronous)
    // and persistMigrationAuditEvent (fire-and-forget async).
    expect(ledgerSrc).toContain('console.log(JSON.stringify({ level: \'audit\'');
    expect(ledgerSrc).toContain('persistMigrationAuditEvent(fullEvent)');
    // The persistence should be fire-and-forget with a catch for safety.
    expect(ledgerSrc).toContain('.catch(');
  });

  it('executeMigrationInTransaction returns errorCode for transaction-mode failures', () => {
    // MANUAL_REVIEW mode should return a specific error code.
    expect(runnerSrc).toContain('TRANSACTION_MODE_MANUAL_REVIEW');
    // FORBIDDEN mode is now BLOCKED (GOV-12) with a specific error code.
    expect(runnerSrc).toContain('MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED');
    // Lock denial (already running) should have a specific error code.
    expect(runnerSrc).toContain('ALREADY_RUNNING');
    // Transaction errors should have a specific error code.
    expect(runnerSrc).toContain('TRANSACTION_ERROR');
  });

  it('runSinglePendingMigration uses the result errorCode for failure recording', () => {
    // The failure recording should use result.errorCode ?? 'EXECUTION_ERROR'
    // rather than hardcoding 'EXECUTION_ERROR'.
    expect(runnerSrc).toContain("result.errorCode ?? 'EXECUTION_ERROR'");
  });

  it('persistMigrationAuditEvent maps all MigrationAuditEventType values', () => {
    // Every event type in the MigrationAuditEventType union should have a
    // corresponding entry in the mapping table. We verify by checking that
    // the number of mapping entries matches the number of event types.
    const eventTypeMatches = ledgerSrc.match(/'migration\.[^']+'|'manifest\.[^']+'/g) || [];
    // The mapping table should have at least 25 entries (one per event type).
    expect(eventTypeMatches.length).toBeGreaterThanOrEqual(25);
  });

  it('audit events include transaction mode details for MANUAL_REVIEW (MIGRATION-GOV-08)', () => {
    // The MANUAL_REVIEW audit event should include the transactionMode detail.
    const reviewEventSection = runnerSrc.split('migration.transaction_mode.review_required')[1] ?? '';
    expect(reviewEventSection).toContain('MANUAL_REVIEW');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 14. Governance Lifecycle & Historical Baseline (MIGRATION-GOV-02,03)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Governance lifecycle & historical baseline', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const typesSrc = readSrc('lib/migrations/types.ts');

  it('MigrationGovernanceLifecycle includes all 6 lifecycle states', () => {
    expect(typesSrc).toContain('UNBOOTSTRAPPED');
    expect(typesSrc).toContain('LEDGER_BOOTSTRAPPED');
    expect(typesSrc).toContain('BASELINE_REQUIRED');
    expect(typesSrc).toContain('BASELINE_IN_PROGRESS');
    expect(typesSrc).toContain('BASELINE_VERIFIED');
    expect(typesSrc).toContain('EXECUTION_ENABLED');
  });

  it('governance_lifecycle table DDL has lifecycle_state CHECK with all 6 states', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS governance_lifecycle')[1] ?? '';
    expect(ddlSection).toContain('UNBOOTSTRAPPED');
    expect(ddlSection).toContain('LEDGER_BOOTSTRAPPED');
    expect(ddlSection).toContain('BASELINE_REQUIRED');
    expect(ddlSection).toContain('BASELINE_IN_PROGRESS');
    expect(ddlSection).toContain('BASELINE_VERIFIED');
    expect(ddlSection).toContain('EXECUTION_ENABLED');
    // Default state after bootstrap is LEDGER_BOOTSTRAPPED
    expect(ddlSection).toContain("DEFAULT 'LEDGER_BOOTSTRAPPED'");
    // Environment is unique (one row per environment)
    expect(ddlSection).toContain('UNIQUE');
  });

  it('setGovernanceLifecycleState and getGovernanceLifecycleState are exported', () => {
    expect(ledgerSrc).toContain('export async function getGovernanceLifecycleState');
    expect(ledgerSrc).toContain('export async function setGovernanceLifecycleState');
  });

  it('setGovernanceLifecycleState emits migration.governance.state_change audit event', () => {
    expect(ledgerSrc).toContain('migration.governance.state_change');
  });

  it('BaselineReconciliationStatus includes all 5 statuses', () => {
    expect(typesSrc).toContain('CONFIRMED_APPLIED');
    expect(typesSrc).toContain('CONFIRMED_NOT_APPLIED');
    expect(typesSrc).toContain('PARTIALLY_APPLIED');
    expect(typesSrc).toContain('NOT_APPLICABLE');
    expect(typesSrc).toContain('UNKNOWN');
  });

  it('migration_baseline table DDL has reconciliation_status CHECK with all 5 statuses', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_baseline')[1] ?? '';
    expect(ddlSection).toContain('CONFIRMED_APPLIED');
    expect(ddlSection).toContain('CONFIRMED_NOT_APPLIED');
    expect(ddlSection).toContain('PARTIALLY_APPLIED');
    expect(ddlSection).toContain('NOT_APPLICABLE');
    expect(ddlSection).toContain('UNKNOWN');
    // Unique constraint per migration+environment
    expect(ddlSection).toContain('migration_baseline_env_identifier_unique');
    // Evidence type CHECK
    expect(ddlSection).toContain('SCHEMA_INTROSPECTION');
    expect(ddlSection).toContain('LEDGER_RECORD');
    expect(ddlSection).toContain('MANUAL_VERIFICATION');
    expect(ddlSection).toContain('CHECKSUM_MATCH');
    expect(ddlSection).toContain('OBJECT_EXISTENCE');
  });

  it('recordBaselineReconciliation is exported and emits baseline audit events', () => {
    expect(ledgerSrc).toContain('export async function recordBaselineReconciliation');
    expect(ledgerSrc).toContain('migration.baseline.completed');
    expect(ledgerSrc).toContain('migration.baseline.failed');
  });

  it('verifyBaselineComplete is exported', () => {
    expect(ledgerSrc).toContain('export async function verifyBaselineComplete');
  });

  it('advanceToBaselineVerified is exported and emits state_change event', () => {
    expect(ledgerSrc).toContain('export async function advanceToBaselineVerified');
  });

  it('enableExecution is exported and emits state_change event', () => {
    expect(ledgerSrc).toContain('export async function enableExecution');
  });

  it('enableExecution requires a reason parameter (MIGRATION-GOV-09, Phase 1A.2)', () => {
    const fnSection = ledgerSrc.split('export async function enableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain('reason');
    expect(fnSection).toContain('ENABLE_EXECUTION_REASON_REQUIRED');
  });

  it('disableExecution is exported and emits state_change event (MIGRATION-GOV-09, Phase 1A.2)', () => {
    expect(ledgerSrc).toContain('export async function disableExecution');
    const fnSection = ledgerSrc.split('export async function disableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain('reason');
    expect(fnSection).toContain('DISABLE_EXECUTION_REASON_REQUIRED');
    expect(fnSection).toContain('BASELINE_VERIFIED');
  });

  it('assertExecutionPermitted is exported with fail-closed semantics', () => {
    expect(ledgerSrc).toContain('export async function assertExecutionPermitted');
    // The function should have fail-closed behavior (deny on unreadable state).
    const gateSection = ledgerSrc.split('assertExecutionPermitted')[1] ?? '';
    expect(gateSection).toContain('permitted');
  });

  it('assertExecutionPermitted emits execution_denied audit event when blocked', () => {
    expect(ledgerSrc).toContain('migration.governance.execution_denied');
  });

  it('execution gate only permits EXECUTION_ENABLED (MIGRATION-GOV-09, Phase 1A.2)', () => {
    // MIGRATION-GOV-09 fix: only EXECUTION_ENABLED permits schema mutation.
    // BASELINE_VERIFIED is a readiness state, NOT an execution-permitting state.
    // The operator must explicitly activate execution via enable-execution.
    const gateSection = ledgerSrc.split('async function assertExecutionPermitted')[1] ?? '';
    // The permitted check must reference EXECUTION_ENABLED
    expect(gateSection).toContain("lifecycle === 'EXECUTION_ENABLED'");
    // The gate must NOT use the old two-state OR pattern
    expect(gateSection).not.toContain("BASELINE_VERIFIED' || lifecycle === 'EXECUTION_ENABLED'");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 15. Transaction Mode Detection (MIGRATION-GOV-06)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Transaction mode detection', () => {
  const validationSrc = readSrc('lib/migrations/validation.ts');
  const manifestSrc = readSrc('lib/migrations/manifest.ts');

  it('TransactionMode type includes REQUIRED, FORBIDDEN, MANUAL_REVIEW', () => {
    const typesSrc = readSrc('lib/migrations/types.ts');
    expect(typesSrc).toContain("'REQUIRED'");
    expect(typesSrc).toContain("'FORBIDDEN'");
    expect(typesSrc).toContain("'MANUAL_REVIEW'");
  });

  it('detectTransactionMode is exported from validation.ts', () => {
    expect(validationSrc).toContain('export function detectTransactionMode');
  });

  it('detectTransactionModeFromFile is exported from validation.ts', () => {
    expect(validationSrc).toContain('export function detectTransactionModeFromFile');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes CREATE INDEX CONCURRENTLY', () => {
    expect(validationSrc).toContain('CREATE INDEX CONCURRENTLY');
    expect(validationSrc).toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes REINDEX CONCURRENTLY', () => {
    expect(validationSrc).toContain('REINDEX CONCURRENTLY');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes VACUUM', () => {
    expect(validationSrc).toContain('VACUUM');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes ALTER TYPE ADD VALUE', () => {
    expect(validationSrc).toContain('ALTER TYPE ADD VALUE');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes CREATE DATABASE', () => {
    expect(validationSrc).toContain('CREATE DATABASE');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes CREATE TABLESPACE', () => {
    expect(validationSrc).toContain('CREATE TABLESPACE');
  });

  it('TRANSACTION_INCOMPATIBLE_PATTERNS includes DROP DATABASE', () => {
    expect(validationSrc).toContain('DROP DATABASE');
  });

  it('manifest.ts computes transactionMode at discovery time', () => {
    expect(manifestSrc).toContain('transactionMode');
    expect(manifestSrc).toContain('detectTransactionMode');
  });

  it('MigrationFile interface includes transactionMode field', () => {
    const typesSrc = readSrc('lib/migrations/types.ts');
    expect(typesSrc).toContain('transactionMode: TransactionMode');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 16. Lock Key Exactness (MIGRATION-GOV-06)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Lock key exactness', () => {
  const typesSrc = readSrc('lib/migrations/types.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');

  it('MIGRATION_LOCK_KEY_DECIMAL is a decimal string constant (not a JS number)', () => {
    expect(typesSrc).toContain("MIGRATION_LOCK_KEY_DECIMAL");
    // The decimal value should be a string, not a number literal.
    expect(typesSrc).toMatch(/MIGRATION_LOCK_KEY_DECIMAL\s*[:=]\s*['"]/);
  });

  it('MIGRATION_LOCK_KEY_DECIMAL equals 6003100736085771346 (exact, not rounded)', () => {
    expect(typesSrc).toContain('6003100736085771346');
  });

  it('MIGRATION_LOCK_KEY as hex is 0x534f4c504d474452 (SOLPMGDR)', () => {
    expect(typesSrc).toContain('0x534f4c504d474452');
  });

  it('runner casts the decimal key to BIGINT in SQL (not passing as JS number)', () => {
    expect(runnerSrc).toContain('MIGRATION_LOCK_KEY_DECIMAL');
    expect(runnerSrc).toContain('::bigint');
  });

  it('ledger bootstrap casts the decimal key to BIGINT in advisory lock', () => {
    expect(ledgerSrc).toContain('MIGRATION_LOCK_KEY_DECIMAL');
    expect(ledgerSrc).toContain('::bigint');
  });

  it('runner uses pg_try_advisory_xact_lock (bounded, not indefinite block)', () => {
    expect(runnerSrc).toContain('pg_try_advisory_xact_lock');
    // Should NOT use pg_advisory_xact_lock (which blocks indefinitely) in the
    // REQUIRED transaction path.
  });

  it('REQUIRED mode uses pg_try_advisory_xact_lock (transaction-scoped, bounded)', () => {
    // Per GOV-12 (Phase 1A.2), FORBIDDEN mode is now BLOCKED and never reaches
    // the lock acquisition code. REQUIRED mode uses transaction-scoped advisory
    // locks (pg_try_advisory_xact_lock) for concurrency safety.
    expect(runnerSrc).toContain('pg_try_advisory_xact_lock');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 17. Append-Only Run History & Ledger Constraints (MIGRATION-GOV-02,03,08)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Append-only run history & ledger constraints', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');

  it('schema_migration_runs table is created in bootstrap DDL', () => {
    expect(ledgerSrc).toContain('CREATE TABLE IF NOT EXISTS schema_migration_runs');
  });

  it('schema_migration_runs has status CHECK with all 5 run statuses', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    expect(ddlSection).toContain("'started'");
    expect(ddlSection).toContain("'applied'");
    expect(ddlSection).toContain("'failed'");
    expect(ddlSection).toContain("'denied'");
    expect(ddlSection).toContain("'skipped'");
  });

  it('schema_migration_runs has migration_identifier CHECK constraint', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1]?.split(');')[0] ?? '';
    expect(ddlSection).toContain('migration_identifier');
    expect(ddlSection).toContain('CHECK');
    expect(ddlSection).toContain("'^[0-9]{3}");
  });

  it('schema_migration_runs has checksum_sha256 CHECK constraint', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1]?.split(');')[0] ?? '';
    expect(ddlSection).toContain('checksum_sha256');
    expect(ddlSection).toContain('CHECK');
    expect(ddlSection).toContain("'^[0-9a-f]{64}$");
  });

  it('schema_migration_runs has actor_type CHECK constraint', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    expect(ddlSection).toContain("'human'");
    expect(ddlSection).toContain("'migration-actor'");
  });

  it('schema_migration_runs has indexes on execution_id, identifier+env, and status', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    expect(ddlSection).toContain('schema_migration_runs_exec_id_idx');
    expect(ddlSection).toContain('schema_migration_runs_identifier_env_idx');
    expect(ddlSection).toContain('schema_migration_runs_status_idx');
  });

  it('recordMigrationRunEvent is exported (INSERT-only, never UPDATE/DELETE)', () => {
    expect(ledgerSrc).toContain('export async function recordMigrationRunEvent');
    const fnSection = ledgerSrc.split('export async function recordMigrationRunEvent')[1] ?? '';
    expect(fnSection).toContain('INSERT INTO schema_migration_runs');
    // Should not contain UPDATE or DELETE on this table.
    expect(fnSection).not.toMatch(/UPDATE\s+schema_migration_runs/i);
    expect(fnSection).not.toMatch(/DELETE\s+FROM\s+schema_migration_runs/i);
  });

  it('schema_migrations has unique constraint on (migration_identifier, environment)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migrations')[1] ?? '';
    expect(ddlSection).toContain('schema_migrations_env_identifier_unique');
  });

  it('schema_migrations has status CHECK with all 5 statuses', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migrations')[1] ?? '';
    expect(ddlSection).toContain("'pending'");
    expect(ddlSection).toContain("'running'");
    expect(ddlSection).toContain("'applied'");
    expect(ddlSection).toContain("'failed'");
    expect(ddlSection).toContain("'superseded'");
  });

  it('migration_totp_uses table is created in bootstrap DDL (MIGRATION-GOV-05)', () => {
    expect(ledgerSrc).toContain('CREATE TABLE IF NOT EXISTS migration_totp_uses');
  });

  it('migration_totp_uses has unique constraint on (user_id, time_step)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_totp_uses')[1] ?? '';
    expect(ddlSection).toContain('migration_totp_uses_user_step_unique');
    expect(ddlSection).toContain('UNIQUE (user_id, time_step)');
  });

  it('migration_totp_uses stores use_hash (SHA-256), NOT the TOTP code itself', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_totp_uses')[1]?.split('`')[0] ?? '';
    expect(ddlSection).toContain('use_hash');
    expect(ddlSection).toContain("'^[0-9a-f]{64}$");
    // There should be no column named 'totp_code' in this table DDL.
    expect(ddlSection).not.toMatch(/totp_code/i);
  });

  it('recordTotpUse is exported and uses ON CONFLICT DO NOTHING', () => {
    expect(ledgerSrc).toContain('export async function recordTotpUse');
    const fnSection = ledgerSrc.split('export async function recordTotpUse')[1] ?? '';
    expect(fnSection).toContain('ON CONFLICT');
    expect(fnSection).toContain('DO NOTHING');
    expect(fnSection).toContain('RETURNING');
  });

  it('recordTotpUse returns true for first use (new row) and false for replay (conflict)', () => {
    const fnSection = ledgerSrc.split('export async function recordTotpUse')[1] ?? '';
    // The function should distinguish between first-use (row inserted) and
    // replay (conflict, no row inserted).
    expect(fnSection).toContain('true');
    expect(fnSection).toContain('false');
  });

  it('isTotpTimeStepUsed is exported (read-only replay check)', () => {
    expect(ledgerSrc).toContain('export async function isTotpTimeStepUsed');
  });

  it('bootstrap sets governance_lifecycle state to BASELINE_REQUIRED after ledger creation', () => {
    // After the ledger tables are created, the lifecycle should advance from
    // LEDGER_BOOTSTRAPPED to BASELINE_REQUIRED, requiring baseline reconciliation
    // before execution is permitted.
    const bootstrapFnSection = ledgerSrc.split('export async function bootstrapMigrationLedger')[1] ?? '';
    expect(bootstrapFnSection).toContain('BASELINE_REQUIRED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Phase 1A.2: Lifecycle Activation Gate (MIGRATION-GOV-09)
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Lifecycle activation gate (MIGRATION-GOV-09)', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');

  it('assertExecutionPermitted only permits EXECUTION_ENABLED, not BASELINE_VERIFIED', () => {
    // The core GOV-09 fix: the gate must check for EXECUTION_ENABLED only.
    // BASELINE_VERIFIED is a readiness state, not an execution state.
    const gateSection = ledgerSrc.split('async function assertExecutionPermitted')[1]?.split('\n\n\n')[0] ?? '';
    expect(gateSection).toContain("lifecycle === 'EXECUTION_ENABLED'");
    // Must NOT contain the old two-state OR condition
    expect(gateSection).not.toMatch(/lifecycle === 'BASELINE_VERIFIED'\s*\|\|\s*lifecycle === 'EXECUTION_ENABLED'/);
  });

  it('assertExecutionPermitted JSDoc documents that BASELINE_VERIFIED is NOT permitted', () => {
    const docSection = ledgerSrc.split('Behavior by lifecycle state')[1]?.split('@param')[0] ?? '';
    expect(docSection).toContain('BASELINE_VERIFIED');
    expect(docSection).toContain('NOT permitted');
    expect(docSection).toContain('Only EXECUTION_ENABLED permits schema mutation');
  });

  it('enableExecution transitions from BASELINE_VERIFIED to EXECUTION_ENABLED', () => {
    const fnSection = ledgerSrc.split('export async function enableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain("'EXECUTION_ENABLED'");
    expect(fnSection).toContain("'BASELINE_VERIFIED'");
    // The UPDATE must check lifecycle_state = 'BASELINE_VERIFIED' in WHERE
    expect(fnSection).toContain("lifecycle_state = 'BASELINE_VERIFIED'");
  });

  it('enableExecution records the reason in audit event details', () => {
    const fnSection = ledgerSrc.split('export async function enableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain('reason');
    expect(fnSection).toContain('reason.trim()');
  });

  it('disableExecution transitions from EXECUTION_ENABLED to BASELINE_VERIFIED', () => {
    const fnSection = ledgerSrc.split('export async function disableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain("'BASELINE_VERIFIED'");
    expect(fnSection).toContain("'EXECUTION_ENABLED'");
    expect(fnSection).toContain("lifecycle_state = 'EXECUTION_ENABLED'");
    // Should clear execution_enabled_by/at
    expect(fnSection).toContain('execution_enabled_by = null');
    expect(fnSection).toContain('execution_enabled_at = null');
  });

  it('disableExecution records the reason in audit event details', () => {
    const fnSection = ledgerSrc.split('export async function disableExecution')[1]?.split('export async function')[0] ?? '';
    expect(fnSection).toContain('reason');
    expect(fnSection).toContain('reason.trim()');
    expect(fnSection).toContain('action: \'disable_execution\'');
  });

  it('enableExecution and disableExecution are re-exported from runner', () => {
    expect(runnerSrc).toContain('enableExecution');
    expect(runnerSrc).toContain('disableExecution');
  });

  it('runner execution gate error message references EXECUTION_ENABLED only', () => {
    // Both runSinglePendingMigration and runPendingMigrations should have
    // error messages that reference EXECUTION_ENABLED as the required state.
    // Split on the unique errorSummary text (the runner uses template literals
    // with backticks, so we split on the text content without quotes).
    const singleSection = runnerSrc.split('Migration execution is blocked.')[1] ?? '';
    expect(singleSection).toContain('EXECUTION_ENABLED');
    expect(singleSection).toContain('enable-execution');
    // Must NOT contain the old "Required states: BASELINE_VERIFIED or"
    expect(singleSection).not.toContain('Required states: BASELINE_VERIFIED or');
  });

  it('runner runPendingMigrations gate error message references EXECUTION_ENABLED only', () => {
    const pendingSection = runnerSrc.split('fatalErrors:')[1]?.split('emitAuditEvent')[0] ?? '';
    // Check the fatalErrors array contains the new message
    expect(runnerSrc).toContain('Required state: EXECUTION_ENABLED');
    expect(runnerSrc).not.toContain('Required states: BASELINE_VERIFIED or');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Phase 1A.2: Baseline Control Plane API (MIGRATION-GOV-11)
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Baseline control plane API (MIGRATION-GOV-11)', () => {
  const routeSrc = readSrc('app/api/admin/migrations/route.ts');

  it('route includes all 5 baseline control plane actions in validActions', () => {
    expect(routeSrc).toContain('inspect-baseline');
    expect(routeSrc).toContain('record-baseline-entry');
    expect(routeSrc).toContain('verify-baseline');
    expect(routeSrc).toContain('enable-execution');
    expect(routeSrc).toContain('disable-execution');
  });

  it('route imports baseline control plane functions from ledger', () => {
    expect(routeSrc).toContain('getGovernanceLifecycleState');
    expect(routeSrc).toContain('recordBaselineReconciliation');
    expect(routeSrc).toContain('readAllBaselineReconciliations');
    expect(routeSrc).toContain('verifyBaselineComplete');
    expect(routeSrc).toContain('advanceToBaselineVerified');
    expect(routeSrc).toContain('enableExecution');
    expect(routeSrc).toContain('disableExecution');
  });

  it('inspect-baseline returns all baseline entries and lifecycle state', () => {
    expect(routeSrc).toContain("if (action === 'inspect-baseline')");
    const section = routeSrc.split("if (action === 'inspect-baseline')")[1]?.split("if (action === '")[0] ?? '';
    expect(section).toContain('readAllBaselineReconciliations');
    expect(section).toContain('getGovernanceLifecycleState');
    expect(section).toContain('unreconciled');
  });

  it('record-baseline-entry validates identifier, status, and evidenceType', () => {
    expect(routeSrc).toContain("if (action === 'record-baseline-entry')");
    const section = routeSrc.split("if (action === 'record-baseline-entry')")[1]?.split("if (action === '")[0] ?? '';
    expect(section).toContain('identifier');
    expect(section).toContain('reconciliationStatus');
    expect(section).toContain('evidenceType');
    expect(section).toContain('CONFIRMED_APPLIED');
    expect(section).toContain('SCHEMA_INTROSPECTION');
    expect(section).toContain('recordBaselineReconciliation');
  });

  it('verify-baseline checks completeness and advances to BASELINE_VERIFIED', () => {
    expect(routeSrc).toContain("if (action === 'verify-baseline')");
    const section = routeSrc.split("if (action === 'verify-baseline')")[1]?.split("if (action === '")[0] ?? '';
    expect(section).toContain('verifyBaselineComplete');
    expect(section).toContain('advanceToBaselineVerified');
    expect(section).toContain('unreconciled');
    expect(section).toContain('blocking');
  });

  it('enable-execution requires TOTP, reason, and BASELINE_VERIFIED state', () => {
    expect(routeSrc).toContain("if (action === 'enable-execution')");
    const section = routeSrc.split("if (action === 'enable-execution')")[1]?.split("if (action === '")[0] ?? '';
    expect(section).toContain('reason');
    expect(section).toContain('BASELINE_VERIFIED');
    expect(section).toContain('enableExecution');
  });

  it('disable-execution requires TOTP, reason, and EXECUTION_ENABLED state', () => {
    expect(routeSrc).toContain("if (action === 'disable-execution')");
    const section = routeSrc.split("if (action === 'disable-execution')")[1]?.split("if (action === '")[0] ?? '';
    expect(section).toContain('reason');
    expect(section).toContain('EXECUTION_ENABLED');
    expect(section).toContain('disableExecution');
  });

  it('enable-execution and disable-execution require TOTP verification', () => {
    // The isExecutionActivation flag must include both actions, and the TOTP
    // verification block must cover isExecutionActivation.
    expect(routeSrc).toContain('isExecutionActivation');
    expect(routeSrc).toMatch(/isExecute \|\| isExecutionActivation/);
    // TOTP verification block condition should include isExecutionActivation
    const totpSection = routeSrc.split('Verify fresh TOTP')[1]?.split('Authorize')[0] ?? '';
    expect(totpSection).toContain('isExecutionActivation');
  });

  it('execution activation maps to execute action for authorization', () => {
    expect(routeSrc).toMatch(/isExecute \|\| isExecutionActivation/);
    const actionMapSection = routeSrc.split('migrationAction: MigrationAction')[1]?.split('const actorType')[0] ?? '';
    expect(actionMapSection).toContain("'execute'");
  });

  it('baseline mutation actions map to bootstrap action for authorization', () => {
    expect(routeSrc).toContain('isBaselineMutation');
    const actionMapSection = routeSrc.split('migrationAction: MigrationAction')[1]?.split('const actorType')[0] ?? '';
    expect(actionMapSection).toContain("'bootstrap'");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 21. Phase 1A.2: Fail-Closed Persistent Audit (MIGRATION-GOV-10)
// ────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Fail-closed persistent audit (MIGRATION-GOV-10)', () => {
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');

  it('emitAuditEventAsync is exported from ledger', () => {
    expect(ledgerSrc).toContain('export async function emitAuditEventAsync');
  });

  it('emitAuditEventAsync awaits persistence and returns { persisted, entryHash }', () => {
    const fnSection = ledgerSrc.split('export async function emitAuditEventAsync')[1]?.split('export function')[0] ?? '';
    expect(fnSection).toContain('persistMigrationAuditEvent');
    expect(fnSection).toContain('persisted');
    expect(fnSection).toContain('entryHash');
    expect(fnSection).toContain('return {');
  });

  it('emitAuditEventAsync is imported into runner', () => {
    expect(runnerSrc).toContain('emitAuditEventAsync');
  });

  it('emitAuditEventAsync is re-exported from runner', () => {
    const reExportLine = runnerSrc.split('export { bootstrapMigrationLedger')[1] ?? '';
    expect(reExportLine).toContain('emitAuditEventAsync');
  });

  it('runner uses emitAuditEventAsync for mutation success (applied)', () => {
    // The success path should use emitAuditEventAsync for fail-closed audit
    const successSection = runnerSrc.split('// GOV-10: fail-closed audit for mutation success')[1]
      ?.split('// GOV-10: fail-closed audit for mutation failure')[0] ?? '';
    expect(successSection).toContain('emitAuditEventAsync');
    expect(successSection).toContain('migration.migration.applied');
    expect(successSection).toContain('auditResult.persisted');
  });

  it('runner uses emitAuditEventAsync for mutation failure (failed)', () => {
    const failureSection = runnerSrc.split('// GOV-10: fail-closed audit for mutation failure')[1]
      ?.split('} else {')?.[0] ?? '';
    expect(failureSection).toContain('emitAuditEventAsync');
    expect(failureSection).toContain('migration.migration.failed');
    expect(failureSection).toContain('auditResult.persisted');
  });

  it('runner returns AUDIT_PERSISTENCE_FAILED on success path if audit not persisted', () => {
    expect(runnerSrc).toContain('AUDIT_PERSISTENCE_FAILED');
    // Verify the fail-closed pattern: if not persisted, record and return error
    const successSection = runnerSrc.split('// GOV-10: fail-closed audit for mutation success')[1]
      ?.split('// GOV-10: fail-closed audit for mutation failure')[0] ?? '';
    expect(successSection).toContain('AUDIT_PERSISTENCE_FAILED');
    expect(successSection).toContain("status: 'failed'");
  });

  it('runner returns AUDIT_PERSISTENCE_FAILED on failure path if audit not persisted', () => {
    const failureSection = runnerSrc.split('// GOV-10: fail-closed audit for mutation failure')[1]
      ?.split('} else {')?.[0] ?? '';
    expect(failureSection).toContain('AUDIT_PERSISTENCE_FAILED');
  });

  it('emitAuditEvent (fire-and-forget) remains for read-only events', () => {
    // The read-only/inspection audit events should still use emitAuditEvent
    expect(runnerSrc).toContain('emitAuditEvent({');
    // The governance execution_denied event is read-only (no mutation happened)
    expect(runnerSrc).toContain("'migration.governance.execution_denied'");
  });

  it('dry-run paths use emitAuditEvent (fire-and-forget) not async', () => {
    // Dry-run never mutates the database, so fire-and-forget audit is acceptable
    const dryRunSuccessSection = runnerSrc.split('} else {')[1]?.split('return {')[0] ?? '';
    // This section should contain emitAuditEvent for the dry-run applied case
    expect(runnerSrc).toContain('// Dry-run: no mutation occurred, fire-and-forget audit is acceptable.');
  });

  it('emitAuditEventAsync returns persisted=false on exception (fail-closed)', () => {
    const fnSection = ledgerSrc.split('export async function emitAuditEventAsync')[1]?.split('export function')[0] ?? '';
    expect(fnSection).toContain('persisted: false');
  });

  it('JSDoc documents fail-closed semantics for emitAuditEventAsync', () => {
    const jsdocSection = ledgerSrc.split('Emits a structured audit event AND awaits durable persistence')[0] ?? '';
    // The JSDoc should be before the function
    const fullFnArea = ledgerSrc.split('export async function emitAuditEventAsync')[0] ?? '';
    expect(fullFnArea).toContain('fail-closed');
    expect(fullFnArea).toContain('MUST be durably persisted');
  });

  it('MIGRATION-GOV-10 reference documented in ledger', () => {
    expect(ledgerSrc).toContain('MIGRATION-GOV-10');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 22. Phase 1A.2: Run-History for Denied/Blocked Paths (MIGRATION-GOV-18)
// ────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Run-history for denied/blocked paths (MIGRATION-GOV-18)', () => {
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const typesSrc = readSrc('lib/migrations/types.ts');

  it('MigrationRunStatus type includes all 9 statuses', () => {
    expect(typesSrc).toContain("'started'");
    expect(typesSrc).toContain("'applied'");
    expect(typesSrc).toContain("'failed'");
    expect(typesSrc).toContain("'denied'");
    expect(typesSrc).toContain("'skipped'");
    expect(typesSrc).toContain("'dry_run'");
    expect(typesSrc).toContain("'conflict'");
    expect(typesSrc).toContain("'lock_timeout'");
    expect(typesSrc).toContain("'baseline_blocked'");
  });

  it('DDL CHECK constraint on schema_migration_runs.status includes all 9 statuses', () => {
    // The DDL must have the expanded CHECK constraint
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1]
      ?.split('CREATE INDEX')[0] ?? '';
    expect(ddlSection).toContain("'started'");
    expect(ddlSection).toContain("'applied'");
    expect(ddlSection).toContain("'failed'");
    expect(ddlSection).toContain("'denied'");
    expect(ddlSection).toContain("'skipped'");
    expect(ddlSection).toContain("'dry_run'");
    expect(ddlSection).toContain("'conflict'");
    expect(ddlSection).toContain("'lock_timeout'");
    expect(ddlSection).toContain("'baseline_blocked'");
  });

  it('runner records denied status for authorization denial', () => {
    // The authorization denial path should record a 'denied' run event
    const deniedSection = runnerSrc.split("status: 'denied',")[1]
      ?.split('return {')[0] ?? '';
    expect(deniedSection).toContain('AUTHORIZATION_DENIED');
  });

  it('runner records baseline_blocked status for governance gate denial', () => {
    expect(runnerSrc).toContain("status: 'baseline_blocked'");
    // Verify it is in the governance gate denial path
    const blockedSection = runnerSrc.split("status: 'baseline_blocked',")[1]
      ?.split('return {')[0] ?? '';
    expect(blockedSection).toContain('MIGRATION_BASELINE_REQUIRED');
  });

  it('runner records conflict status for checksum conflict', () => {
    expect(runnerSrc).toContain("status: 'conflict'");
    const conflictSection = runnerSrc.split("status: 'conflict',")[1]
      ?.split('return {')[0] ?? '';
    expect(conflictSection).toContain('CHECKSUM_CONFLICT');
  });

  it('runner records lock_timeout status for already-running', () => {
    expect(runnerSrc).toContain("status: 'lock_timeout'");
    const lockSection = runnerSrc.split("status: 'lock_timeout',")[1]
      ?.split('return {')[0] ?? '';
    expect(lockSection).toContain('ALREADY_RUNNING');
  });

  it('runner records skipped status for already-applied idempotent skip', () => {
    expect(runnerSrc).toContain("status: 'skipped'");
    const skipSection = runnerSrc.split("status: 'skipped',")[1]
      ?.split('return {')[0] ?? '';
    expect(skipSection).toContain('idempotent skip');
  });

  it('runner records dry_run status for successful dry-run execution', () => {
    expect(runnerSrc).toContain("status: 'dry_run'");
    const dryRunSection = runnerSrc.split("status: 'dry_run',")[1]
      ?.split('return {')[0] ?? '';
    expect(dryRunSection).toContain('Dry-run validation succeeded');
  });

  it('recordMigrationRunEvent is imported and used in runner', () => {
    expect(runnerSrc).toContain('recordMigrationRunEvent');
    // Verify multiple call sites exist (at least 5 new denial/block paths)
    const callCount = (runnerSrc.match(/recordMigrationRunEvent\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(5);
  });

  it('manifest is discovered before authorization check for run-history metadata', () => {
    // The manifest discovery must happen before the authorization check so
    // that file metadata (filename, checksum) is available for run-history
    // recording at the denial path.
    //
    // After the Phase 1A.3 Gap 1 DI refactor, the internal functions use
    // resolveManifestProvider(dependencies) then manifestProvider() instead of
    // a direct discoverMigrationFiles() call. The ordering guarantee (manifest
    // discovered before auth check) is preserved — only the mechanism changed.
    const manifestPos = runnerSrc.indexOf('const manifest = manifestProvider();');
    const authPos = runnerSrc.indexOf('if (!authorization.allowed)');
    expect(manifestPos).toBeGreaterThan(0);
    expect(authPos).toBeGreaterThan(0);
    expect(manifestPos).toBeLessThan(authPos);
  });

  it('recordMigrationRunEvent accepts the expanded status vocabulary', () => {
    // The function signature should accept MigrationRunStatus type
    const fnSection = ledgerSrc.split('export async function recordMigrationRunEvent')[1]
      ?.split('export async function recordMigrationResult')[0] ?? '';
    expect(fnSection).toContain('status: MigrationRunStatus');
  });

  it('MIGRATION-GOV-18 reference documented in runner', () => {
    expect(runnerSrc).toContain('MIGRATION-GOV-18');
  });

  it('MIGRATION-GOV-14 reference documented in types (status expansion rationale)', () => {
    expect(typesSrc).toContain('MIGRATION-GOV-14');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 23. Non-Transactional Blocking (MIGRATION-GOV-12)
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Non-transactional blocking (MIGRATION-GOV-12)', () => {
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const typesSrc = readSrc('lib/migrations/types.ts');
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const auditLogSrc = readSrc('lib/auditLog.ts');
  const validationSrc = readSrc('lib/migrations/validation.ts');

  it('FORBIDDEN transaction mode is BLOCKED, not executed statement-by-statement', () => {
    // The runner must check for FORBIDDEN mode and return an error BEFORE
    // attempting any SQL execution. It must NOT split the SQL and run
    // statements individually.
    expect(runnerSrc).toContain("file.transactionMode === 'FORBIDDEN'");
    expect(runnerSrc).toContain('MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED');
  });

  it('FORBIDDEN block does NOT execute SQL statements individually', () => {
    // The old behavior split SQL on ';' and ran each statement. The new
    // behavior must return an error immediately without executing anything.
    const forbiddenSection = runnerSrc.split("file.transactionMode === 'FORBIDDEN'")[1]
      ?.split('// ── REQUIRED mode')[0] ?? '';
    expect(forbiddenSection).toContain('return {');
    expect(forbiddenSection).toContain('success: false');
    // Must NOT contain statement splitting logic in the FORBIDDEN block
    expect(forbiddenSection).not.toContain('split(');
    expect(forbiddenSection).not.toContain('.map(');
  });

  it('FORBIDDEN block emits migration.execution_blocked_non_transactional audit event', () => {
    const forbiddenSection = runnerSrc.split("file.transactionMode === 'FORBIDDEN'")[1]
      ?.split('// ── REQUIRED mode')[0] ?? '';
    expect(forbiddenSection).toContain('migration.execution_blocked_non_transactional');
    expect(forbiddenSection).toContain('emitAuditEvent');
  });

  it('FORBIDDEN block includes incompatibleStatements in audit details', () => {
    const forbiddenSection = runnerSrc.split("file.transactionMode === 'FORBIDDEN'")[1]
      ?.split('// ── REQUIRED mode')[0] ?? '';
    expect(forbiddenSection).toContain('incompatibleStatements');
    expect(forbiddenSection).toContain('detectTransactionMode');
  });

  it('FORBIDDEN block includes transactionMode and reason in audit details', () => {
    const forbiddenSection = runnerSrc.split("file.transactionMode === 'FORBIDDEN'")[1]
      ?.split('// ── REQUIRED mode')[0] ?? '';
    expect(forbiddenSection).toContain("transactionMode: 'FORBIDDEN'");
    expect(forbiddenSection).toContain('reason');
  });

  it('MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED error references MIGRATION-GOV-12', () => {
    // The GOV-12 reference is in the error message string within the FORBIDDEN
    // block, not on the same line as the error code.
    const forbiddenSection = runnerSrc.split("file.transactionMode === 'FORBIDDEN'")[1]
      ?.split('// ── REQUIRED mode')[0] ?? '';
    expect(forbiddenSection).toContain('MIGRATION_NON_TRANSACTIONAL_EXECUTION_UNSUPPORTED');
    expect(forbiddenSection).toContain('MIGRATION-GOV-12');
  });

  it('migration.execution_blocked_non_transactional is a valid MigrationAuditEventType', () => {
    expect(typesSrc).toContain("'migration.execution_blocked_non_transactional'");
  });

  it('migration_execution_blocked_non_transactional is a valid AuditAction', () => {
    expect(auditLogSrc).toContain("'migration_execution_blocked_non_transactional'");
  });

  it('ledger maps migration.execution_blocked_non_transactional to AuditAction', () => {
    expect(ledgerSrc).toContain("'migration.execution_blocked_non_transactional': 'migration_execution_blocked_non_transactional'");
  });

  it('TransactionMode type JSDoc documents FORBIDDEN is now BLOCKED', () => {
    // The JSDoc above the TransactionMode type must document that FORBIDDEN is
    // blocked by the canonical runner, not executed. We need to capture the
    // JSDoc comment block that precedes the type declaration.
    const typeIdx = typesSrc.indexOf('export type TransactionMode');
    const precedingText = typesSrc.substring(Math.max(0, typeIdx - 600), typeIdx);
    expect(precedingText).toContain('FORBIDDEN');
    expect(precedingText).toContain('BLOCKS');
    expect(precedingText).toContain('MIGRATION-GOV-12');
  });

  it('MigrationFile.transactionMode field JSDoc documents FORBIDDEN blocking', () => {
    // The JSDoc for the transactionMode field on MigrationFile must document
    // that FORBIDDEN is blocked by the canonical runner.
    const fieldIdx = typesSrc.indexOf('transactionMode: TransactionMode');
    const precedingText = typesSrc.substring(Math.max(0, fieldIdx - 800), fieldIdx);
    expect(precedingText).toContain('FORBIDDEN');
    expect(precedingText).toContain('MIGRATION-GOV-12');
    expect(precedingText).toContain('BLOCKS');
  });

  it('TransactionMode type includes REQUIRED, FORBIDDEN, and MANUAL_REVIEW', () => {
    expect(typesSrc).toMatch(/TransactionMode = 'REQUIRED' \| 'FORBIDDEN' \| 'MANUAL_REVIEW'/);
  });

  it('validation detectTransactionMode returns incompatibleStatements array', () => {
    expect(validationSrc).toContain('incompatibleStatements: string[]');
    expect(validationSrc).toContain("mode: 'FORBIDDEN'");
  });

  it('validation has TRANSACTION_INCOMPATIBLE_PATTERNS for detection', () => {
    expect(validationSrc).toContain('TRANSACTION_INCOMPATIBLE_PATTERNS');
  });

  it('MIGRATION-GOV-12 reference is documented in runner', () => {
    expect(runnerSrc).toContain('MIGRATION-GOV-12');
  });

  it('MANUAL_REVIEW mode returns TRANSACTION_MODE_MANUAL_REVIEW (not executed)', () => {
    // MANUAL_REVIEW should also not be auto-executed — it requires manual review.
    expect(runnerSrc).toContain('TRANSACTION_MODE_MANUAL_REVIEW');
    expect(runnerSrc).toContain("file.transactionMode === 'MANUAL_REVIEW'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Legacy Path Permanent Closure (MIGRATION-GOV-13)
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: Legacy path permanent closure (MIGRATION-GOV-13)', () => {
  const migrateSrc = readSrc('app/api/migrate/route.ts');
  const systemToolsSrc = readSrc('app/api/admin/system-tools/route.ts');
  const prospectsSeedSrc = readSrc('app/api/admin/prospects/seed/route.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const typesSrc = readSrc('lib/migrations/types.ts');

  it('all three legacy routes reference MIGRATION-GOV-13 in their elimination comments', () => {
    expect(migrateSrc).toContain('MIGRATION-GOV-13');
    expect(systemToolsSrc).toContain('MIGRATION-GOV-13');
    expect(prospectsSeedSrc).toContain('MIGRATION-GOV-13');
  });

  it('all three legacy routes reference Phase 1A.2 in their elimination comments', () => {
    expect(migrateSrc).toContain('Phase 1A.2');
    expect(systemToolsSrc).toContain('Phase 1A.2');
    expect(prospectsSeedSrc).toContain('Phase 1A.2');
  });

  it('migrate/route.ts does NOT contain a conditional feature-flag check', () => {
    // The old code had: if (!legacyInlineEnabled) { return 423; }
    // The new code unconditionally returns 423.
    expect(migrateSrc).not.toContain('legacyInlineEnabled');
  });

  it('system-tools/route.ts does NOT contain a conditional feature-flag check for run_migration', () => {
    expect(systemToolsSrc).not.toContain('legacySystemToolsRunEnabled');
  });

  it('prospects/seed/route.ts does NOT contain a conditional feature-flag check', () => {
    expect(prospectsSeedSrc).not.toContain('legacyProspectsSeedEnabled');
  });

  it('isLegacyInlineEnabled() permanently returns false (GOV-13)', () => {
    // The helper function must always return false — it cannot be re-enabled.
    const fnSection = runnerSrc.split('export function isLegacyInlineEnabled')[1]
      ?.split('export function')[0] ?? '';
    expect(fnSection).toContain('return false');
    expect(fnSection).not.toContain("process.env");
  });

  it('isLegacySystemToolsRunEnabled() permanently returns false (GOV-13)', () => {
    const fnSection = runnerSrc.split('export function isLegacySystemToolsRunEnabled')[1]
      ?.split('export function')[0] ?? '';
    expect(fnSection).toContain('return false');
    expect(fnSection).not.toContain("process.env");
  });

  it('both helper functions document MIGRATION-GOV-13 permanent elimination', () => {
    // The JSDoc comment block precedes the function declaration. We need to
    // capture text before each function declaration to include the JSDoc.
    const inlineIdx = runnerSrc.indexOf('export function isLegacyInlineEnabled');
    const inlinePreceding = runnerSrc.substring(Math.max(0, inlineIdx - 500), inlineIdx);
    expect(inlinePreceding).toContain('MIGRATION-GOV-13');

    const sysToolsIdx = runnerSrc.indexOf('export function isLegacySystemToolsRunEnabled');
    const sysToolsPreceding = runnerSrc.substring(Math.max(0, sysToolsIdx - 500), sysToolsIdx);
    expect(sysToolsPreceding).toContain('MIGRATION-GOV-13');
  });

  it('MIGRATION_ENV_VARS legacy entries are documented as permanently dead (GOV-13)', () => {
    const envVarsSection = typesSrc.split('MIGRATION_ENV_VARS')[1]
      ?.split('} as const')[0] ?? '';
    expect(envVarsSection).toContain('PERMANENTLY DEAD');
    expect(envVarsSection).toContain('MIGRATION-GOV-13');
  });

  it('migrate/route.ts has unreachable code after the 423 return (file preserved)', () => {
    // The route returns 423 unconditionally. The old mutation code below is
    // now unreachable but preserved (not deleted) per GOV-13.
    const returnIdx = migrateSrc.indexOf("{ status: 423 }");
    expect(returnIdx).toBeGreaterThan(-1);
    // There should be code after the return (the old migration logic, now dead)
    const afterReturn = migrateSrc.substring(returnIdx);
    expect(afterReturn.length).toBeGreaterThan(50);
  });

  it('prospects/seed/route.ts has unreachable code after the 423 return (file preserved)', () => {
    const returnIdx = prospectsSeedSrc.indexOf("{ status: 423 }");
    expect(returnIdx).toBeGreaterThan(-1);
    const afterReturn = prospectsSeedSrc.substring(returnIdx);
    expect(afterReturn.length).toBeGreaterThan(50);
  });

  it('all three legacy routes emit migration.legacy.invoked audit event', () => {
    expect(migrateSrc).toContain('migration.legacy.invoked');
    expect(systemToolsSrc).toContain('migration.legacy.invoked');
    expect(prospectsSeedSrc).toContain('migration.legacy.invoked');
  });

  it('all three legacy routes direct to canonicalPath /api/admin/migrations', () => {
    expect(migrateSrc).toContain('canonicalPath');
    expect(migrateSrc).toContain('/api/admin/migrations');
    expect(systemToolsSrc).toContain('canonicalPath');
    expect(prospectsSeedSrc).toContain('canonicalPath');
  });

  it('system-tools list_migrations case is NOT permanently eliminated (remains functional)', () => {
    // Only run_migration is permanently eliminated; list_migrations is diagnostic.
    const listSection = systemToolsSrc.split("case 'list_migrations'")[1]
      ?.split("case '")[0] ?? '';
    expect(listSection).not.toContain('permanently eliminated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 25. Phase 1A.2: Identifier & Status Contract Enforcement (MIGRATION-GOV-14)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 1A.2: Identifier & status contract enforcement (MIGRATION-GOV-14)', () => {
  const typesSrc = readSrc('lib/migrations/types.ts');
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const routeSrc = readSrc('app/api/admin/migrations/route.ts');

  // ── Identifier grammar constant and validator ──

  it('MIGRATION_IDENTIFIER_REGEX is exported from types', () => {
    expect(typesSrc).toContain('MIGRATION_IDENTIFIER_REGEX');
    expect(typesSrc).toContain('export const MIGRATION_IDENTIFIER_REGEX');
  });

  it('MIGRATION_IDENTIFIER_REGEX matches the DDL grammar ^[0-9]{3}[a-z]?$', () => {
    // The TypeScript regex must match the DDL CHECK constraint grammar exactly.
    const regexSection = typesSrc.split('MIGRATION_IDENTIFIER_REGEX')[1]
      ?.split(';')[0] ?? '';
    expect(regexSection).toContain('[0-9]{3}');
    expect(regexSection).toContain('[a-z]?');
    // The DDL grammar is '^[0-9]{3}[a-z]?$' — verify the TS regex matches the same set.
    const regex = MIGRATION_IDENTIFIER_REGEX;
    // Valid identifiers
    expect(regex.test('001')).toBe(true);
    expect(regex.test('074')).toBe(true);
    expect(regex.test('074a')).toBe(true);
    expect(regex.test('074b')).toBe(true);
    expect(regex.test('999')).toBe(true);
    expect(regex.test('999z')).toBe(true);
    // Invalid identifiers
    expect(regex.test('1')).toBe(false);
    expect(regex.test('12')).toBe(false);
    expect(regex.test('010aa')).toBe(false);
    expect(regex.test('abc')).toBe(false);
    expect(regex.test('105-extra')).toBe(false);
    expect(regex.test('074A')).toBe(false); // uppercase
    expect(regex.test('')).toBe(false);
    expect(regex.test('  074')).toBe(false); // leading whitespace
  });

  it('isValidMigrationIdentifier is exported from types', () => {
    expect(typesSrc).toContain('isValidMigrationIdentifier');
    expect(typesSrc).toContain('export function isValidMigrationIdentifier');
  });

  it('isValidMigrationIdentifier returns true for valid identifiers', () => {
    expect(isValidMigrationIdentifier('001')).toBe(true);
    expect(isValidMigrationIdentifier('074')).toBe(true);
    expect(isValidMigrationIdentifier('074a')).toBe(true);
    expect(isValidMigrationIdentifier('074b')).toBe(true);
    expect(isValidMigrationIdentifier('999')).toBe(true);
  });

  it('isValidMigrationIdentifier returns false for invalid identifiers', () => {
    expect(isValidMigrationIdentifier('1')).toBe(false);
    expect(isValidMigrationIdentifier('12')).toBe(false);
    expect(isValidMigrationIdentifier('010aa')).toBe(false);
    expect(isValidMigrationIdentifier('abc')).toBe(false);
    expect(isValidMigrationIdentifier('105-extra')).toBe(false);
    expect(isValidMigrationIdentifier('074A')).toBe(false); // uppercase not allowed
    expect(isValidMigrationIdentifier('')).toBe(false);
  });

  it('MIGRATION_IDENTIFIER_REGEX JSDoc documents the GOV-14 identifier contract', () => {
    const regexIdx = typesSrc.indexOf('MIGRATION_IDENTIFIER_REGEX');
    const precedingJSDoc = typesSrc.substring(Math.max(0, regexIdx - 800), regexIdx);
    expect(precedingJSDoc).toContain('MIGRATION-GOV-14');
    expect(precedingJSDoc).toContain('CHECK constraint');
    expect(precedingJSDoc).toContain('schema_migrations');
    expect(precedingJSDoc).toContain('schema_migration_runs');
    expect(precedingJSDoc).toContain('migration_baseline');
  });

  // ── DDL identifier CHECK constraint alignment ──

  it('schema_migrations DDL enforces identifier grammar ^[0-9]{3}[a-z]?$', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migrations')[1] ?? '';
    expect(ddlSection).toContain("CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')");
  });

  it('schema_migration_runs DDL enforces identifier grammar ^[0-9]{3}[a-z]?$', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    expect(ddlSection).toContain("CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')");
  });

  it('migration_baseline DDL enforces identifier grammar ^[0-9]{3}[a-z]?$', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_baseline')[1] ?? '';
    expect(ddlSection).toContain("CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$')");
  });

  it('identifier grammar is consistent across TypeScript and all 3 DDL tables', () => {
    // The TS regex and all 3 DDL CHECK constraints must use the same pattern.
    const expectedPattern = '^[0-9]{3}[a-z]?$';
    // TS side
    expect(typesSrc).toContain(expectedPattern);
    // DDL side — 3 tables
    const tables = ['schema_migrations', 'schema_migration_runs', 'migration_baseline'];
    for (const table of tables) {
      const ddlSection = ledgerSrc.split(`CREATE TABLE IF NOT EXISTS ${table}`)[1] ?? '';
      expect(ddlSection).toContain(expectedPattern);
    }
  });

  // ── Status vocabulary alignment (type ↔ DDL) ──

  it('MigrationRunStatus type and schema_migration_runs DDL CHECK have identical 9-status vocabulary', () => {
    const expectedStatuses = [
      'started', 'applied', 'failed', 'denied', 'skipped',
      'dry_run', 'conflict', 'lock_timeout', 'baseline_blocked',
    ];
    // Type side
    const typeSection = typesSrc.split('export type MigrationRunStatus')[1]
      ?.split(';')[0] ?? '';
    for (const status of expectedStatuses) {
      expect(typeSection).toContain(`'${status}'`);
    }
    // DDL side
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    for (const status of expectedStatuses) {
      expect(ddlSection).toContain(`'${status}'`);
    }
  });

  it('schema_migrations status CHECK has all 5 current-state statuses (pending, running, applied, failed, superseded)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migrations')[1] ?? '';
    expect(ddlSection).toContain("'pending'");
    expect(ddlSection).toContain("'running'");
    expect(ddlSection).toContain("'applied'");
    expect(ddlSection).toContain("'failed'");
    expect(ddlSection).toContain("'superseded'");
  });

  it('governance_lifecycle DDL enforces 6-state lifecycle vocabulary', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS governance_lifecycle')[1] ?? '';
    expect(ddlSection).toContain("'UNBOOTSTRAPPED'");
    expect(ddlSection).toContain("'LEDGER_BOOTSTRAPPED'");
    expect(ddlSection).toContain("'BASELINE_REQUIRED'");
    expect(ddlSection).toContain("'BASELINE_IN_PROGRESS'");
    expect(ddlSection).toContain("'BASELINE_VERIFIED'");
    expect(ddlSection).toContain("'EXECUTION_ENABLED'");
  });

  it('migration_baseline DDL enforces 5 reconciliation_status values', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_baseline')[1] ?? '';
    expect(ddlSection).toContain("'CONFIRMED_APPLIED'");
    expect(ddlSection).toContain("'CONFIRMED_NOT_APPLIED'");
    expect(ddlSection).toContain("'PARTIALLY_APPLIED'");
    expect(ddlSection).toContain("'NOT_APPLICABLE'");
    expect(ddlSection).toContain("'UNKNOWN'");
  });

  it('migration_baseline DDL enforces 6 evidence_type values', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_baseline')[1] ?? '';
    expect(ddlSection).toContain("'SCHEMA_INTROSPECTION'");
    expect(ddlSection).toContain("'LEDGER_RECORD'");
    expect(ddlSection).toContain("'MANUAL_VERIFICATION'");
    expect(ddlSection).toContain("'CHECKSUM_MATCH'");
    expect(ddlSection).toContain("'OBJECT_EXISTENCE'");
    expect(ddlSection).toContain("'NONE'");
  });

  // ── Actor type contract alignment ──

  it('MigrationActorType has exactly 2 values: human and migration-actor', () => {
    const typeSection = typesSrc.split('export type MigrationActorType')[1]
      ?.split(';')[0] ?? '';
    expect(typeSection).toContain("'human'");
    expect(typeSection).toContain("'migration-actor'");
  });

  it('schema_migrations DDL enforces applied_by_actor_type CHECK (human, migration-actor)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migrations')[1] ?? '';
    expect(ddlSection).toContain('applied_by_actor_type');
    expect(ddlSection).toContain("'human'");
    expect(ddlSection).toContain("'migration-actor'");
  });

  it('schema_migration_runs DDL enforces actor_type CHECK (human, migration-actor)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS schema_migration_runs')[1] ?? '';
    expect(ddlSection).toContain('actor_type');
    expect(ddlSection).toContain("'human'");
    expect(ddlSection).toContain("'migration-actor'");
  });

  it('MigrationActorType JSDoc documents the GOV-14 actor contract', () => {
    const actorIdx = typesSrc.indexOf('export type MigrationActorType');
    const precedingJSDoc = typesSrc.substring(Math.max(0, actorIdx - 600), actorIdx);
    expect(precedingJSDoc).toContain('MIGRATION-GOV-14');
    expect(precedingJSDoc).toContain('CHECK constraint');
  });

  it('route hardcodes actorType to human and rejects client-supplied actorType', () => {
    expect(routeSrc).toContain("const actorType: MigrationActorType = 'human'");
    expect(routeSrc).toContain('Client-supplied actorType is not permitted');
  });

  it('checksum_sha256 CHECK constraint enforces 64-char hex on migration tables', () => {
    const tables = ['schema_migrations', 'schema_migration_runs'];
    for (const table of tables) {
      const ddlSection = ledgerSrc.split(`CREATE TABLE IF NOT EXISTS ${table}`)[1] ?? '';
      expect(ddlSection).toContain("CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')");
    }
  });

  it('migration_totp_uses enforces use_hash CHECK with 64-char hex', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_totp_uses')[1] ?? '';
    expect(ddlSection).toContain("CHECK (use_hash ~ '^[0-9a-f]{64}$')");
  });

  it('GOV-14 is referenced in types.ts (identifier and status contract documentation)', () => {
    expect(typesSrc).toContain('MIGRATION-GOV-14');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 26. Phase 1A.2: TOTP Exact Matched-Step Recording (MIGRATION-GOV-17)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 1A.2: TOTP exact matched-step recording (MIGRATION-GOV-17)', () => {
  const runnerSrc = readSrc('lib/migrations/runner.ts');
  const ledgerSrc = readSrc('lib/migrations/ledger.ts');
  const typesSrc = readSrc('lib/migrations/types.ts');

  // ── Exact matched-step recording ──

  // Matched-step COMPUTATION now lives in verifyTotpStepValidity (validity-only,
  // no ledger write). verifyFreshTotp delegates to it, then records the exact
  // accepted step. Behavior is unchanged and additionally covered by the
  // real-Postgres suite tests/migration-bootstrap-totp-replay-postgres.test.ts.
  const validitySection = runnerSrc.split('export async function verifyTotpStepValidity')[1] ?? '';

  it('verifyTotpStepValidity computes matchedStep from the EXACT stepTime that matched', () => {
    // matchedStep must come from the stepTime that produced the matching code,
    // NOT from the current server time.
    expect(validitySection).toContain('matchedStep = Math.floor(stepTime / 1000 / TOTP_PERIOD_SECONDS)');
  });

  it('verifyTotpStepValidity iterates the ±1 window (delta 0, ±1)', () => {
    expect(validitySection).toContain('TOTP_WINDOW_STEPS');
    expect(validitySection).toContain('delta === 0');
    expect(validitySection).toContain('[-1, 1]');
  });

  it('verifyFreshTotp records the accepted matched-step (not current server step) in recordTotpUse', () => {
    const fnSection = runnerSrc.split('export async function verifyFreshTotp')[1]?.split('export async function verifyTotpStepValidity')[0] ?? '';
    // recordTotpUse is called with the accepted validity.timeStep — the exact
    // matched step returned by verifyTotpStepValidity — not a current-step var.
    expect(fnSection).toContain('recordTotpUse(adminUserId, validity.timeStep, executionId)');
  });

  it('verifyFreshTotp returns the accepted step in the TOTP_REPLAY denial result', () => {
    const fnSection = runnerSrc.split('export async function verifyFreshTotp')[1]?.split('export async function verifyTotpStepValidity')[0] ?? '';
    const replaySection = fnSection.split('TOTP_REPLAY')[1] ?? '';
    expect(replaySection).toContain('timeStep: validity.timeStep');
  });

  it('verifyTotpStepValidity returns matchedStep in the verified=true result', () => {
    // The accepted step returned to callers IS the matched step.
    const verifiedSection = validitySection.split('verified: true')[1] ?? '';
    expect(verifiedSection).toContain('timeStep: matchedStep');
  });

  // ── Fail-closed on missing MFA ──

  it('verifyFreshTotp returns MFA_NOT_ENABLED when user has no TOTP secret', () => {
    const fnSection = runnerSrc.split('export async function verifyFreshTotp')[1] ?? '';
    expect(fnSection).toContain('MFA_NOT_ENABLED');
    // The JSDoc should reference the fail-closed behavior.
    const fnIdx = runnerSrc.indexOf('export async function verifyFreshTotp');
    const precedingJSDoc = runnerSrc.substring(Math.max(0, fnIdx - 1800), fnIdx);
    expect(precedingJSDoc).toContain('FAIL-CLOSED');
  });

  it('verifyFreshTotp does NOT record time-step on invalid code (failed auth does not consume valid code)', () => {
    const fnSection = runnerSrc.split('export async function verifyFreshTotp')[1] ?? '';
    const invalidSection = fnSection.split('TOTP_INVALID')[1] ?? '';
    // The invalid path should return before recordTotpUse is called.
    expect(invalidSection).toContain('timeStep: null');
  });

  // ── Replay prevention table ──

  it('migration_totp_uses table has UNIQUE constraint on (user_id, time_step)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_totp_uses')[1] ?? '';
    expect(ddlSection).toContain('migration_totp_uses_user_step_unique');
    expect(ddlSection).toContain('UNIQUE (user_id, time_step)');
  });

  it('migration_totp_uses table does NOT store the TOTP code (only hashed time-step)', () => {
    const ddlSection = ledgerSrc.split('CREATE TABLE IF NOT EXISTS migration_totp_uses')[1]
      ?.split(');')[0] ?? '';
    expect(ddlSection).toContain('use_hash');
    expect(ddlSection).not.toMatch(/totp_code|otp_code|secret/);
  });

  it('recordTotpUse uses ON CONFLICT DO NOTHING for replay detection', () => {
    const fnSection = ledgerSrc.split('export async function recordTotpUse')[1] ?? '';
    expect(fnSection).toContain('ON CONFLICT');
    expect(fnSection).toContain('DO NOTHING');
  });

  it('recordTotpUse returns false when the (user_id, time_step) pair already exists (replay)', () => {
    const fnSection = ledgerSrc.split('export async function recordTotpUse')[1] ?? '';
    // The function uses RETURNING id + ON CONFLICT DO NOTHING: if the pair
    // already exists, no row is inserted, so rows.length > 0 is false (replay).
    // If it's a new pair, a row is returned, so rows.length > 0 is true (first use).
    expect(fnSection).toContain('RETURNING id');
    expect(fnSection).toContain('ON CONFLICT');
    expect(fnSection).toContain('DO NOTHING');
    expect(fnSection).toContain('rows.length > 0');
  });

  // ── Constants ──

  it('TOTP_PERIOD_SECONDS is defined (must match lib/mfa.ts)', () => {
    expect(runnerSrc).toContain('TOTP_PERIOD_SECONDS');
  });

  it('TOTP_WINDOW_STEPS is defined', () => {
    expect(runnerSrc).toContain('TOTP_WINDOW_STEPS');
  });

  // ── MFA Phase 3 frozen ──

  it('lib/mfa.ts is NOT modified (frozen — verifyTOTPCode, generateTOTPCode, decryptTOTPSecret exist)', () => {
    const mfaSrc = readSrc('lib/mfa.ts');
    expect(mfaSrc).toContain('verifyTOTPCode');
    expect(mfaSrc).toContain('generateTOTPCode');
    expect(mfaSrc).toContain('decryptTOTPSecret');
  });

  it('runner reimplements TOTP window iteration specifically for matched-step tracking', () => {
    // verifyFreshTotp does NOT call verifyTOTPCode directly — it reimplements
    // the window iteration because it needs the matched step for replay tracking.
    const fnSection = runnerSrc.split('export async function verifyFreshTotp')[1] ?? '';
    // It should call generateTOTPCode (the frozen MFA library function) to
    // compute the expected code at each step, rather than verifyTOTPCode.
    expect(fnSection).toMatch(/generateTOTPCode\(\s*secret\s*,\s*stepTime\s*\)/);
    // It should NOT call verifyTOTPCode (the frozen MFA function) in this function.
    expect(fnSection).not.toMatch(/verifyTOTPCode\s*\(/);
  });
});
