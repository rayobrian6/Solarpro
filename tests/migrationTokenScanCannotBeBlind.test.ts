// ═══════════════════════════════════════════════════════════════════════════
// THE DESTRUCTIVE-TOKEN GATE COULD NOT REFUSE A SINGLE DESTRUCTIVE TOKEN
//
// `analyzeRegistryMigration` is the static gate every targeted migration must pass
// before an operator can fire it at the database. One of its three shapes — the
// index-only shape — built its forbidden-token pattern inside a TEMPLATE LITERAL
// with single backslashes, where its three siblings used double ones:
//
//     new RegExp(`\b${tok.replace(/\s+/g, '\s+')}\b`, 'i')     // as written
//
// In a template literal `\b` is U+0008 BACKSPACE and `\s` is a literal 's'.
// Measured: the built pattern's first character is char code 8;
// `/<BS>DROP<BS>/i.test('DROP TABLE projects;')` is FALSE where the escaped form is
// TRUE; and `CREATE OR REPLACE` degraded to `CREATEs+ORs+REPLACE`.
//
// So `forbiddenFound` was ALWAYS empty and `nonDestructive` ALWAYS true for that
// shape. Only migration 120 uses it today and 120 is genuinely index-only, so
// nothing reached a database through the hole — the gate was simply blind to
// whatever came next.
//
// 🚨 THIS IS THE FIFTH `\b`-BECOMES-BACKSPACE IN THIS REPOSITORY, so these cases
// assert BEHAVIOUR — does the scan actually find the token — and never the
// spelling of a pattern. A test that grepped the source for `\\b` would have
// passed against the broken line, because the broken line contains `\b`.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { findForbiddenTokens, analyzeRegistryMigration } from '@/lib/migrations/targetedRegistryDeployment';

const ALL_FORBIDDEN = [
  'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'UPDATE', 'INSERT',
  'GRANT', 'REVOKE', 'RENAME', 'COPY', 'VACUUM', 'CREATE OR REPLACE',
];

describe('🚨 the scan finds every token it is given', () => {
  it.each(ALL_FORBIDDEN)('finds %s in a statement that uses it', (tok) => {
    const sql = `CREATE INDEX IF NOT EXISTS i ON t(c);\n${tok} something;`;
    expect(findForbiddenTokens(sql, [tok]), `${tok} was not found`).toEqual([tok]);
  });

  it('finds a token on its own line, at the very start, and at the very end', () => {
    expect(findForbiddenTokens('DROP', ['DROP'])).toEqual(['DROP']);
    expect(findForbiddenTokens('DROP TABLE t;', ['DROP'])).toEqual(['DROP']);
    expect(findForbiddenTokens(';\nVACUUM', ['VACUUM'])).toEqual(['VACUUM']);
  });

  it('is case-insensitive, like the SQL it scans', () => {
    expect(findForbiddenTokens('drop table t;', ['DROP'])).toEqual(['DROP']);
    expect(findForbiddenTokens('DrOp table t;', ['DROP'])).toEqual(['DROP']);
  });

  it('🚨 matches a multi-word token across ANY whitespace, including a newline', () => {
    // The broken form turned this into `CREATEs+ORs+REPLACE`, which matches nothing.
    for (const sql of [
      'CREATE OR REPLACE FUNCTION f() ...',
      'CREATE  OR  REPLACE FUNCTION f() ...',
      'CREATE\nOR\nREPLACE FUNCTION f() ...',
      'CREATE\tOR\tREPLACE FUNCTION f() ...',
    ]) {
      expect(findForbiddenTokens(sql, ['CREATE OR REPLACE']), JSON.stringify(sql))
        .toEqual(['CREATE OR REPLACE']);
    }
  });
});

describe('and does NOT fire on a token buried inside an identifier', () => {
  // The reason the original wanted a word boundary at all. A scan that flags
  // `dropped_at` refuses legitimate migrations, which is its own kind of broken.
  it.each([
    ['DROP', 'CREATE INDEX i ON t(dropped_at);'],
    ['COPY', 'CREATE INDEX i ON t(no_copy_flag);'],
    ['DELETE', 'CREATE INDEX i ON t(deleted_at);'],
    ['INSERT', 'CREATE INDEX i ON t(inserted_by);'],
    ['UPDATE', 'CREATE INDEX i ON t(updated_at);'],
  ])('%s is not found in %s', (tok, sql) => {
    expect(findForbiddenTokens(sql, [tok])).toEqual([]);
  });

  it('a column literally named for a token still does not trip it', () => {
    expect(findForbiddenTokens('CREATE INDEX i ON t(updated_at, deleted_at, inserted_by);', ALL_FORBIDDEN))
      .toEqual([]);
  });
});

describe('🚨 the index-only shape now refuses a destructive migration', () => {
  // The end-to-end consequence, through the real gate rather than the helper.
  // Migration 120 is the only index-only spec today, so it is the identifier an
  // attacker-or-accident would be editing.
  const destructive = `
    CREATE INDEX IF NOT EXISTS idx_audit_chain_prev ON audit_log(prev_hash);
    DROP TABLE projects;
  `;

  it('reports the DROP', () => {
    // The index-only shape is selected by passing expectedIndexes — the same way
    // REGISTRY_DEPLOYMENT['120'] reaches it.
    const shape = analyzeRegistryMigration('120', destructive, [], undefined, ['audit_log'], undefined,
      [{ table: 'audit_log', index: 'idx_audit_chain_prev' }]);
    expect(shape.ok, 'a migration containing DROP TABLE passed the static gate').toBe(false);
    expect(JSON.stringify(shape.problems)).toMatch(/destructive|DROP/i);
  });

  it('and a clean index-only migration still passes', () => {
    // A gate that refuses everything is as useless as one that refuses nothing,
    // and would make the case above pass for the wrong reason.
    const clean = `
      CREATE INDEX IF NOT EXISTS idx_audit_chain_prev ON audit_log(prev_hash);
    `;
    const shape = analyzeRegistryMigration('120', clean, [], undefined, ['audit_log'], undefined,
      [{ table: 'audit_log', index: 'idx_audit_chain_prev' }]);
    expect(JSON.stringify(shape.problems)).not.toMatch(/destructive/i);
  });
});

describe('the scan exists exactly once', () => {
  it('🚨 no module hand-builds a word-boundary token pattern any more', async () => {
    // Four copies is how one of them drifted. The structural guard: no template
    // literal in the migrations layer may build a RegExp with a backslash-b in it.
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const ROOT = join(__dirname, '..', 'lib', 'migrations');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!name.endsWith('.ts')) continue;
        const src = readFileSync(p, 'utf8');
        // A RegExp built from a template literal containing a backslash-b — the
        // exact construct that produced a backspace. Matched on the SOURCE text,
        // which is the one place a spelling check is the right tool.
        if (/new RegExp\(`[^`]*\\b/.test(src)) offenders.push(name);
      }
    };
    walk(ROOT);
    expect(offenders,
      'a token pattern is being hand-built from a template literal again — that is how `\\b` became U+0008')
      .toEqual([]);
  });
});
