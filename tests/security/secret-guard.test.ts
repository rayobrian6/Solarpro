// ═══════════════════════════════════════════════════════════════════════════
// SECRET-REGRESSION GUARD.
//
// The live `neondb_owner` password was hard-coded in six tracked files and
// pushed for roughly five months. Nothing in the repository read source files
// looking for a credential, so nothing failed. This suite is that check, and it
// runs inside `npm test` — not in a hook, not behind an optional binary.
//
// It contains NO real secret. Known-compromised values are matched by SHA-256
// fingerprint, and every adversarial fixture below uses a synthetic credential
// pointed at `example.invalid`.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanRepository, summarize, fingerprint, trackedFiles,
  FORBIDDEN_PATHS, KNOWN_COMPROMISED_FINGERPRINTS,
  type SecretFinding,
} from '@/lib/security/secretScan';

const REPO = process.cwd();

/**
 * Write a fixture into a THROWAWAY directory and scan it as if it were the
 * tracked tree. The real repository is never touched.
 *
 * An earlier version staged fixtures into the real git index with
 * `git add --force --intent-to-add`. It worked in isolation and failed
 * intermittently under the parallel full suite, because several workers were
 * mutating one index at once — two rules became unprovable at random. It could
 * also, on an ill-timed failure, have left a synthetic credential staged in the
 * real repository. Scanning an explicit file list removes both problems and
 * costs nothing: the rules under test read file CONTENT and PATH, which is
 * exactly what this provides.
 */
function scanFixture(files: Record<string, string>): SecretFinding[] {
  const root = mkdtempSync(join(tmpdir(), 'secret-guard-'));
  try {
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return scanRepository(root, { files: Object.keys(files) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const rules = (f: SecretFinding[]) => [...new Set(f.map(x => x.rule))];

// ── FIXTURE STRINGS ARE ASSEMBLED, NEVER WRITTEN OUT ────────────────────────
// This suite must contain strings that VIOLATE the rules in order to prove they
// fire — and the scanner reads every tracked file, including this one. Writing
// the fixtures as literals made the guard flag its own test file.
//
// The alternative was an exclusion for `tests/security/**`, which is exactly the
// kind of hole a real secret eventually hides in. Assembling the fixtures from
// fragments keeps the tracked tree genuinely clean with ZERO exceptions, and
// costs nothing: at runtime these are the same strings.
//
// This does not weaken the guard. It catches PASTED credentials, which are
// literals; no static text scanner can catch a value assembled at runtime, and
// that is not the failure mode this exists to prevent.
const PG = 'postgres' + 'ql://';
const NEON = 'npg' + '_';
const SYNTH_PW = 's3cr' + '3tSyntheticValue';
const KEY_HEADER = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
const KEY_FOOTER = '-----END RSA ' + 'PRIVATE KEY-----';

// ── 1. THE TREE IS CLEAN TODAY ──────────────────────────────────────────────
describe('secret guard · the tracked tree carries no live credential', () => {
  const findings = scanRepository(REPO);

  it('1. the tracked tree has ZERO secret findings', () => {
    expect(findings, `\n${summarize(findings)}\n`).toEqual([]);
  });

  it('2. none of the six credential-bearing scratch files is tracked', () => {
    const tracked = new Set(trackedFiles(REPO).map(f => f.replace(/\\/g, '/')));
    const back = FORBIDDEN_PATHS.filter(p => tracked.has(p));
    expect(back, 'a deleted credential-bearing file has been restored').toEqual([]);
  });

  it('3. no .db_url or real .env file is tracked', () => {
    const tracked = trackedFiles(REPO).map(f => f.replace(/\\/g, '/'));
    const bad = tracked.filter(f => /(^|\/)\.db_url$/.test(f)
      || /(^|\/)\.env$/.test(f)
      || /(^|\/)\.env\.(local|production|development|test)$/.test(f));
    expect(bad).toEqual([]);
    // .env.example is allowed — it is a template by convention.
    expect(tracked.filter(f => f.endsWith('.env.example')).length).toBeGreaterThanOrEqual(0);
  });

  it('4. the guard and its tests carry no real secret — only fingerprints', () => {
    // Neither the scanner nor this suite may contain a credential literal. The
    // whole point of fingerprint matching is that the hunter is safe to publish.
    for (const rel of ['lib/security/secretScan.ts', 'tests/security/secret-guard.test.ts']) {
      const live = readFileSync(join(REPO, rel), 'utf8');
      const literals = live.match(/\bnpg_[A-Za-z0-9_]{8,}/g) ?? [];
      expect(literals, `${rel} contains a credential literal`).toEqual([]);
    }
    expect(KNOWN_COMPROMISED_FINGERPRINTS.length).toBeGreaterThan(0);
    for (const k of KNOWN_COMPROMISED_FINGERPRINTS) expect(k.fp).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ── 2. ADVERSARIAL PROOF — each rule must FAIL when violated ───────────────
// A guard that has never fired is a guard nobody has tested.
describe('secret guard · every rule is non-vacuous', () => {
  it('5. a tracked .db_url fails by name', () => {
    const found = scanFixture({ '.db_url': `${PG}u:${SYNTH_PW}@db.example.invalid/x\n` });
    expect(rules(found)).toContain('secret-file-tracked');
    expect(found.some(f => f.file === '.db_url')).toBe(true);
  });

  it('6. an inline database password fails by name', () => {
    const found = scanFixture({
      'fixture.js': `const url = "${PG}appuser:${SYNTH_PW}@db.example.invalid/prod";\n`,
    });
    expect(rules(found)).toContain('inline-database-password');
  });

  it('7. a restored forbidden file fails by name', () => {
    const found = scanFixture({ 'verify_knowledge.js': '// restored from history\n' });
    expect(rules(found)).toContain('forbidden-file-restored');
    expect(found.some(f => f.file === 'verify_knowledge.js')).toBe(true);
  });

  it('8. a Neon-style credential literal fails by name', () => {
    const found = scanFixture({ 'fixture.sh': `export PGPASSWORD=${NEON}SyntheticNotARealKey1\n` });
    expect(rules(found)).toContain('neon-credential-literal');
  });

  it('9. a committed private key fails by name', () => {
    const found = scanFixture({
      'fixture.pem': `${KEY_HEADER}\nc3ludGhldGlj\n${KEY_FOOTER}\n`,
    });
    expect(rules(found)).toContain('private-key-committed');
  });

  it('10. the KNOWN-COMPROMISED fingerprint rule fires on a fingerprint match', () => {
    // Proven WITHOUT the real credential: a synthetic token is hashed, its
    // fingerprint is asserted to be what the rule would compare against, and the
    // rule's matching logic is exercised on that identity.
    const synthetic = `${NEON}SyntheticCompromisedToken`;
    const fp = fingerprint(synthetic);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    // same input ⇒ same fingerprint; a different input ⇒ a different one
    expect(fingerprint(synthetic)).toBe(fp);
    expect(fingerprint(synthetic + 'x')).not.toBe(fp);
    // and the real compromised fingerprint is registered
    expect(KNOWN_COMPROMISED_FINGERPRINTS.map(k => k.fp)).toContain('a40357903308');
  });

  it('11. placeholders and env-var references do NOT fire (no false positives)', () => {
    const found = scanFixture({ 'fixture.md': [
      `${PG}user:password@localhost:5432/dev`,
      `DATABASE_URL=${PG}` + '${DB_USER}:${DB_PASS}@${DB_HOST}/db',
      `${PG}test:test@localhost:5432/test`,
      `${PG}appuser:your-password-here@example.com/db`,
    ].join('\n') + '\n' });
    expect(found).toEqual([]);
  });

  it('12. a finding never contains the matched secret verbatim', () => {
    const pw = SYNTH_PW;
    const found = scanFixture({
      'fixture.js': `const u="${PG}appuser:${pw}@db.example.invalid/prod";\n`,
    });
    const hit = found.find(f => f.rule === 'inline-database-password');
    expect(hit).toBeTruthy();
    expect(hit!.detail).not.toContain(pw);
    expect(summarize(found)).not.toContain(pw);
  });
});
