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

const root = path.resolve(__dirname, '..');

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

  it('discovers 101 SQL files from lib/migrations/', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.count).toBe(101);
  });

  it('highest prefix is 104', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.highestPrefix).toBe('104');
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
      expect(file.fullPath).toContain('lib/migrations');
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
    // The recordTotpUse function hashes (user_id, time_step), not the code.
    expect(runnerSrc).toContain('matchedStep');
    // The code is compared in-memory only; it should not be passed to recordTotpUse.
    expect(runnerSrc).toMatch(/recordTotpUse\(adminUserId,\s*matchedStep/);
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

describe('Phase 1A: Legacy runner restriction', () => {
  const migrateSrc = readSrc('app/api/migrate/route.ts');
  const systemToolsSrc = readSrc('app/api/admin/system-tools/route.ts');

  it('legacy inline runner is gated behind MIGRATION_LEGACY_INLINE_ENABLED flag', () => {
    expect(migrateSrc).toContain('MIGRATION_LEGACY_INLINE_ENABLED');
    expect(migrateSrc).toContain('423'); // Locked status
  });

  it('legacy inline runner emits deprecation audit event when invoked', () => {
    expect(migrateSrc).toContain('migration.legacy.invoked');
    expect(migrateSrc).toContain('deprecated');
  });

  it('legacy inline runner directs to canonical path', () => {
    expect(migrateSrc).toContain('/api/admin/migrations');
  });

  it('legacy system-tools run_migration is gated behind feature flag', () => {
    expect(systemToolsSrc).toContain('MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED');
    expect(systemToolsSrc).toContain('423');
  });

  it('legacy system-tools run_migration emits deprecation audit event', () => {
    expect(systemToolsSrc).toContain('migration.legacy.invoked');
  });

  it('legacy system-tools list_migrations still functional (not gated)', () => {
    // list_migrations should NOT have the feature flag gate.
    const listSection = systemToolsSrc.split('case \'list_migrations\'')[1] ?? '';
    expect(listSection).not.toContain('MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED');
  });

  it('legacy runners are NOT deleted (files still exist)', () => {
    expect(fs.existsSync(path.join(root, 'app/api/migrate/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'app/api/admin/system-tools/route.ts'))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10b. Non-Canonical Execution Path Elimination (MIGRATION-GOV-07)
// ──────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.1: Non-canonical execution path elimination', () => {
  const prospectsSeedSrc = readSrc('app/api/admin/prospects/seed/route.ts');
  const migrateSrc = readSrc('app/api/migrate/route.ts');
  const systemToolsSrc = readSrc('app/api/admin/system-tools/route.ts');

  it('prospects/seed route is gated behind MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED flag (MIGRATION-GOV-07)', () => {
    // The prospects/seed route reads migration SQL files (092, 093) directly
    // and executes them without governance. It must be gated.
    expect(prospectsSeedSrc).toContain('MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED');
    expect(prospectsSeedSrc).toContain('423'); // Locked status
  });

  it('prospects/seed route emits migration.legacy.invoked deprecation audit event when disabled', () => {
    expect(prospectsSeedSrc).toContain('migration.legacy.invoked');
    expect(prospectsSeedSrc).toContain('deprecated');
  });

  it('prospects/seed route directs to canonical path /api/admin/migrations', () => {
    expect(prospectsSeedSrc).toContain('/api/admin/migrations');
    expect(prospectsSeedSrc).toContain('canonicalPath');
  });

  it('prospects/seed route checks the flag AFTER admin authentication (not before)', () => {
    // The gate must come after requireAdminApi so we can record the actor in the
    // audit event. Use the function-body occurrences (not import/comment refs).
    const adminCallIdx = prospectsSeedSrc.indexOf('await requireAdminApi');
    const flagCheckIdx = prospectsSeedSrc.indexOf('process.env.MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED');
    expect(adminCallIdx).toBeGreaterThan(-1);
    expect(flagCheckIdx).toBeGreaterThan(-1);
    expect(flagCheckIdx).toBeGreaterThan(adminCallIdx);
  });

  it('prospects/seed route is NOT deleted (file still exists)', () => {
    expect(fs.existsSync(path.join(root, 'app/api/admin/prospects/seed/route.ts'))).toBe(true);
  });

  it('all three non-canonical paths are gated behind feature flags', () => {
    // Every path that executes migration SQL outside the canonical governance
    // system must be gated behind a feature flag with 423 Locked.
    expect(migrateSrc).toContain('MIGRATION_LEGACY_INLINE_ENABLED');
    expect(migrateSrc).toContain('423');
    expect(systemToolsSrc).toContain('MIGRATION_LEGACY_SYSTEM_TOOLS_RUN_ENABLED');
    expect(systemToolsSrc).toContain('423');
    expect(prospectsSeedSrc).toContain('MIGRATION_LEGACY_PROSPECTS_SEED_ENABLED');
    expect(prospectsSeedSrc).toContain('423');
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

  it('migration 105 does NOT exist (highest is 104)', () => {
    const manifest = discoverMigrationFiles();
    expect(manifest.highestPrefix).toBe('104');
    const has105 = manifest.files.some((f: any) => f.prefix === '105');
    expect(has105).toBe(false);
  });

  it('legacy migrations/ directory is excluded from manifest', () => {
    const manifest = discoverMigrationFiles();
    // None of the manifest files should have paths containing the root migrations/ dir
    // (they should all be in lib/migrations/). We verify every occurrence of
    // "/migrations/" is preceded by "lib" — i.e., the canonical lib/migrations path.
    for (const file of manifest.files) {
      expect(file.fullPath).toContain('lib/migrations');
      // Every "/migrations/" segment must be preceded by "lib" (not a root-level
      // migrations/ directory). We strip all "lib/migrations" occurrences and check
      // that no bare "/migrations/" remains.
      const stripped = file.fullPath.replace(/lib\/migrations/g, '');
      expect(stripped).not.toMatch(/\/migrations\//);
    }
  });
});
