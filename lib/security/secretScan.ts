// ═══════════════════════════════════════════════════════════════════════════
// secretScan — THE repository-native committed-secret scanner.
//
// WHY THIS EXISTS
// ──────────────────────────────────────────────────────────────────────────────
// The live `neondb_owner` database password sat hard-coded in SIX tracked files
// and was pushed to a remote for roughly five months before anyone looked. It
// was not caught by review, by CI, or by `.gitignore` — `.gitignore` covers
// `.env*`, and every one of those six files was a plain `.js` / `.sh` scratch
// script with the credential pasted straight into a connection string.
//
// So the gap was never "we lack a secret file convention". It was that NOTHING
// read the contents of ordinary source files looking for a credential. This
// module is that reader, and the test that drives it runs inside `npm test`, so
// it executes on every CI run rather than living in a hook someone can skip.
//
// WHAT IT WILL NOT DO
//   • It never contains a real secret. Known-compromised values are matched by
//     SHA-256 FINGERPRINT, so this file is safe to read, diff and publish.
//   • It never prints a matched secret — findings carry a file, a line, a rule
//     and a redacted excerpt.
//   • It scans TRACKED files only. Untracked local scratch is not a commit risk,
//     and scanning it would make the result depend on a developer's working
//     directory.
//
// The scanner is deliberately repository-native and dependency-free: an optional
// third-party scanner (gitleaks / trufflehog) is a fine ADDITION, but a critical
// check must not silently pass because an optional binary is missing.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface SecretFinding {
  rule: string;
  file: string;
  line: number;
  /** A redacted description. NEVER the matched secret. */
  detail: string;
}

/** SHA-256, first 12 hex — the only form in which a known-bad value is stored. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** Fingerprints of credentials known to be compromised. A token in the tree
 *  whose fingerprint appears here is a live exposure, not a style problem.
 *  Add to this list when a credential is burned — never the value itself. */
export const KNOWN_COMPROMISED_FINGERPRINTS: ReadonlyArray<{ fp: string; note: string }> = [
  { fp: 'a40357903308', note: 'neondb_owner password exposed 2026-03-05 (b583829a); rotation outstanding' },
];

/** Files deleted BECAUSE they carried a credential. If one reappears, someone has
 *  restored it from history or from a stale working copy, and the credential
 *  comes back with it. */
export const FORBIDDEN_PATHS: readonly string[] = [
  'check_is_global.js',
  'check_table_structure.js',
  'migrations/add_is_global_column.js',
  'test_knowledge_loading.js',
  'test_solardog_knowledge.sh',
  'verify_knowledge.js',
];

/** Local secret-bearing filenames that must never become tracked. */
const FORBIDDEN_TRACKED_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)\.db_url$/,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(local|production|development|test)$/,
  /(^|\/)db_url\.txt$/,
  /(^|\/)credentials?\.json$/,
  /(^|\/)secrets?\.json$/,
];

// ── PLACEHOLDER CLASSIFICATION ──────────────────────────────────────────────
// The first version of this tested the WHOLE match (and, for the credential
// literal rule, the whole LINE) against a word list containing 'example' and
// 'synthetic'. That is a false-NEGATIVE hole big enough to drive a real
// credential through: any live password sitting on a line that happens to
// mention "example" would have been silently skipped, and a host of
// `db.example.com` would have suppressed the finding outright.
//
// The decision now rests on the PASSWORD FIELD ITSELF (plus an explicit
// dev-host allowance), never on surrounding prose. A secret is presumed REAL
// unless the credential position is visibly a template.

/** The password position is a template, not a value. */
function isPlaceholderSecret(secret: string): boolean {
  const s = secret.trim();
  if (s.length === 0) return true;
  // ${VAR} / $VAR / <VAR> / [VAR] / {{VAR}} / %VAR%
  if (/^(\$\{.*\}|\$[A-Za-z_][\w]*|<[^>]*>|\[[^\]]*\]|\{\{.*\}\}|%[^%]*%)$/.test(s)) return true;
  // an inline code reference rather than a literal
  if (/(process\.env|secrets\.|env\[|ENV\[|os\.environ)/i.test(s)) return true;
  // masked or obviously fake values
  if (/^\*+$/.test(s) || /^x+$/i.test(s) || /^\.+$/.test(s)) return true;
  if (/^(pass|password|passwd|pwd|secret|token|changeme|redacted|placeholder|dummy|test|user|username|mypassword|yourpassword)$/i.test(s)) return true;
  if (/^(your|my|some|the)[-_]?(password|pass|secret|token|db)/i.test(s)) return true;
  if (/(xxx+|\*\*\*+|<redacted>|placeholder)/i.test(s)) return true;
  return false;
}

/** A non-production host: local development or an explicitly reserved name. */
function isDevHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)(:\d+)?$/i.test(host.trim());
}

/** A credential LITERAL that is visibly masked rather than a real value. */
function isMaskedLiteral(token: string): boolean {
  return /(xxx+|\*\*\*+|\.\.\.|<|\$\{|placeholder|redacted|example_?key)/i.test(token);
}

/** Binary / vendored / generated paths that are not review surfaces. */
const SKIP_PATH = /(^|\/)(node_modules|\.next|dist|build|coverage|__snapshots__)(\/|$)|\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz|lock)$/i;

const MAX_BYTES = 2_000_000;

/** Every file git currently tracks. */
export function trackedFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/** Redact a matched string so a finding can be printed safely. */
function redact(s: string): string {
  if (s.length <= 8) return `${s.slice(0, 2)}…(${s.length} chars)`;
  return `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`;
}

/**
 * Scan a set of files for committed secrets. Returns EVERY finding; the caller
 * decides what is fatal.
 *
 * `opts.files` overrides the file list instead of asking git. That exists so the
 * adversarial tests can prove each rule fires WITHOUT staging fixtures into the
 * shared git index — doing so raced against other workers under the parallel
 * full suite and made two rules intermittently unprovable. A guard whose proof
 * is flaky is a guard nobody will trust when it finally fires.
 */
export function scanRepository(
  repoRoot: string,
  opts?: { files?: readonly string[] },
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const tracked = opts?.files ? [...opts.files] : trackedFiles(repoRoot);
  const trackedSet = new Set(tracked.map(f => f.replace(/\\/g, '/')));

  // ── RULE 1 — a deleted secret-bearing file has come back ────────────────
  for (const p of FORBIDDEN_PATHS) {
    if (trackedSet.has(p)) {
      findings.push({
        rule: 'forbidden-file-restored', file: p, line: 0,
        detail: 'This file was deleted because it carried a live database credential. '
          + 'Restoring it re-commits the credential.',
      });
    }
  }

  // ── RULE 2 — a local secret file has become tracked ──────────────────────
  for (const f of tracked) {
    const norm = f.replace(/\\/g, '/');
    if (FORBIDDEN_TRACKED_PATTERNS.some(re => re.test(norm))) {
      findings.push({
        rule: 'secret-file-tracked', file: norm, line: 0,
        detail: 'Secret-bearing filename must never be tracked; add it to .gitignore.',
      });
    }
  }

  // ── CONTENT RULES ───────────────────────────────────────────────────────
  for (const f of tracked) {
    const norm = f.replace(/\\/g, '/');
    if (SKIP_PATH.test(norm)) continue;
    let text: string;
    try {
      const full = join(repoRoot, f);
      if (statSync(full).size > MAX_BYTES) continue;
      text = readFileSync(full, 'utf8');
    } catch { continue; }
    if (text.includes('\0')) continue;   // binary

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const at = i + 1;

      // RULE 3 — a token whose fingerprint is a KNOWN compromised credential.
      // Matched by hash, so this scanner never carries the value it hunts.
      for (const tok of line.match(/[A-Za-z0-9_\-]{8,}/g) ?? []) {
        const hit = KNOWN_COMPROMISED_FINGERPRINTS.find(k => k.fp === fingerprint(tok));
        if (hit) {
          findings.push({
            rule: 'known-compromised-credential', file: norm, line: at,
            detail: `Token matches a known-compromised fingerprint (${hit.fp}) — ${hit.note}`,
          });
        }
      }

      // RULE 4 — a database URL carrying an inline password. The verdict comes
      // from the PASSWORD FIELD and the HOST, never from surrounding prose.
      for (const m of line.matchAll(/postgres(?:ql)?:\/\/([^:\s'"]+):([^@\s'"]+)@([^/\s'")]+)/g)) {
        const [, user, secret, host] = m;
        if (isPlaceholderSecret(secret) || isDevHost(host)) continue;
        findings.push({
          rule: 'inline-database-password', file: norm, line: at,
          detail: `Connection string embeds a password for user "${user}" @ ${host} `
            + `(password ${redact(secret)}). Load it from the environment instead.`,
        });
      }

      // RULE 5 — a Neon-style owner credential literal anywhere in source. Judged
      // on the TOKEN, not the line: a real credential must not be excused by a
      // neighbouring word.
      for (const m of line.matchAll(/\bnpg_[A-Za-z0-9_]{8,}/g)) {
        if (isMaskedLiteral(m[0])) continue;
        findings.push({
          rule: 'neon-credential-literal', file: norm, line: at,
          detail: `Neon-style credential literal ${redact(m[0])} committed in source.`,
        });
      }

      // RULE 6 — a private key block.
      if (/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/.test(line)) {
        findings.push({
          rule: 'private-key-committed', file: norm, line: at,
          detail: 'A private key block is committed.',
        });
      }
    }
  }
  return findings;
}

/** Group findings by rule for a readable failure message. */
export function summarize(findings: SecretFinding[]): string {
  if (findings.length === 0) return 'no findings';
  const byRule = new Map<string, SecretFinding[]>();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  return [...byRule].map(([rule, fs]) =>
    `${rule} (${fs.length}):\n` + fs.map(f => `    ${f.file}:${f.line} — ${f.detail}`).join('\n'),
  ).join('\n');
}
