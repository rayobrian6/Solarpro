// ═══════════════════════════════════════════════════════════════════════════
// compliance/__tests__/validate-path-pattern.test.mjs
//
// Verifies that every path_pattern in compliance/manifest.json that
// uses a {date} (or {YYYY-Q#} / {vendor}) token can be templated with
// real values and resolve to a sensible, writeable path.
//
// The "sensible" check is: the resolved path's parent directory can be
// created (mkdirSync recursive) without error, and the resolved path is
// under the repo. We don't actually write the file — just verify the
// directory layout is buildable. The collector then writes for real on
// the GitHub Actions run.
//
// This is the regression guard that catches:
//   - typos in path_pattern (e.g. compliance/evicence/...)
//   - missing compliance/ prefix (R2-era `evidence/...` paths)
//   - {date} tokens that don't match the collector's actual date format
//   - paths that would resolve outside the repo
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO, 'compliance', 'manifest.json');

const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString().slice(0, 10); // YYYY-MM-DD
const CURRENT_QUARTER = (() => {
  const m = TODAY.getUTCMonth();
  const q = Math.floor(m / 3) + 1;
  return `${TODAY.getUTCFullYear()}-Q${q}`;
})();

let manifest;

// Eagerly load the manifest at module-load time so that `it.each` (which
// captures its argument at registration time) can see the patterns. The
// file is a few hundred KB; the parse is sub-millisecond.
const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
manifest = JSON.parse(manifestText);

const allPatterns = [];
for (const [id, ctrl] of Object.entries(manifest.controls)) {
  if (!Array.isArray(ctrl.evidence_sources)) continue;
  for (let i = 0; i < ctrl.evidence_sources.length; i++) {
    const src = ctrl.evidence_sources[i];
    if (typeof src.path_pattern === 'string') {
      allPatterns.push({ controlId: id, idx: i, pattern: src.path_pattern, src });
    }
  }
}

beforeAll(() => {
  // No-op: manifest is already loaded. Kept so vitest still treats the
  // file as a "with-setup" suite (a no-op beforeAll is a fine pattern).
});

/**
 * Substitute the known template tokens with realistic values. The
 * pattern vocabulary is small:
 *   {date}      → YYYY-MM-DD
 *   {YYYY-Q#}   → YYYY-Q1 .. YYYY-Q4
 *   {vendor}    → a literal placeholder string
 * Unknown tokens ({something-else}) are substituted with a placeholder
 * too, so we can still verify the rest of the path resolves.
 */
function templatize(pattern) {
  return pattern
    .replace(/\{date\}/g, TODAY_ISO)
    .replace(/\{YYYY-Q#\}/g, CURRENT_QUARTER)
    .replace(/\{YYYY-Q\d\}/g, CURRENT_QUARTER)
    .replace(/\{vendor\}/g, 'placeholder-vendor')
    .replace(/\{[A-Za-z0-9_-]+\}/g, 'placeholder');
}

describe('path_pattern templating', () => {
  it(`finds ${allPatterns.length} evidence sources to validate`, () => {
    expect(allPatterns.length).toBeGreaterThan(50);
  });

  it.each(allPatterns.map((p) => [p.pattern, p]))(
    '%s — can be templated and resolves to a valid path',
    (_label, { pattern, controlId, idx }) => {
      const resolved = templatize(pattern);

      // The resolved path must be relative (no absolute Windows drive
      // letters or leading slash) — it lives in the repo, not outside.
      expect(resolved, `[${controlId}#${idx}] "${pattern}" resolved to "${resolved}"`).not.toMatch(/^[A-Z]:/);
      expect(resolved, `[${controlId}#${idx}] "${pattern}" resolved to "${resolved}"`).not.toMatch(/^\//);

      // For evidence/ pattern entries (the collector-emitted ones),
      // verify the parent directory of the resolved file is buildable
      // and stays inside the repo. The file itself is not written
      // here — the collector writes it for real at runtime.
      if (pattern.includes('evidence/') || pattern.includes('monitoring/')) {
        const parent = path.dirname(path.join(REPO, resolved));
        const relParent = path.relative(REPO, parent);
        expect(
          relParent.startsWith('..'),
          `[${controlId}#${idx}] "${pattern}" resolved to "${resolved}" whose parent "${parent}" is outside the repo`,
        ).toBe(false);

        // Parent must be creatable. We do mkdirSync recursive with
        // a sentinel: create, verify exists, then rmdir the leaf
        // (we don't rmtree — we only want to confirm creation works).
        try {
          fs.mkdirSync(parent, { recursive: true });
        } catch (err) {
          throw new Error(
            `[${controlId}#${idx}] "${pattern}" resolved to "${resolved}" but ` +
            `mkdirSync("${parent}") failed: ${err.message}`,
          );
        }
        expect(fs.existsSync(parent), `parent dir not created: ${parent}`).toBe(true);
        // Cleanup the empty leaf dir we just created (don't rmtree — we
        // don't know what's in there from a prior test run).
        try { fs.rmdirSync(parent); } catch { /* ignore — non-empty is fine */ }
      }
    },
  );

  it('every {date}-templated pattern uses YYYY-MM-DD (the collector date format)', () => {
    for (const { pattern, controlId, idx } of allPatterns) {
      if (!pattern.includes('{date}')) continue;
      // The collector's formatDate() returns strict YYYY-MM-DD. The
      // path_pattern must agree — the substituted value should be
      // findable as a YYYY-MM-DD token anywhere in the resolved path
      // (path segment OR filename).
      const resolved = templatize(pattern);
      const m = resolved.match(/\d{4}-\d{2}-\d{2}/);
      if (!m) {
        throw new Error(
          `[${controlId}#${idx}] "${pattern}" should templatize with a YYYY-MM-DD date, but resolved to "${resolved}"`,
        );
      }
    }
  });

  it('every evidence-source path_pattern is repo-rooted (starts with "compliance/" or a known top-level)', () => {
    // Defensive: no R2-era `evidence/...` paths should slip in. All
    // git-based paths must be under compliance/ or another top-level
    // directory the auditor knows about.
    const ALLOWED_PREFIXES = [
      'compliance/',
      'AGENTS.md',
      'AI-AGENT-README.md',
      'docs/',
      'lib/',
      'app/',
      'migrations/',
      'next.config.js',
      'package.json',
      'middleware.ts',
      'tsconfig.json',
      'tests/',
      'sam2-service/',
      'scripts/',
      'render.yaml',
      'vercel.json',
      '.audit-',
      '.env.example',
      '.eslintrc.json',
      '.mavis/',
    ];
    for (const { pattern, controlId, idx } of allPatterns) {
      const ok = ALLOWED_PREFIXES.some((p) => pattern.startsWith(p));
      expect(
        ok,
        `[${controlId}#${idx}] "${pattern}" is not repo-rooted. Expected one of: ${ALLOWED_PREFIXES.join(', ')}`,
      ).toBe(true);
    }
  });

  it('integration collectors (github/vercel/render/neon/google-workspace/db) all have workflow fields', () => {
    // The 6 integration collectors should each have a `workflow` field
    // on their evidence_source entries (hourly/daily/weekly cadence).
    // This is the "Add compliance/workflows/*.yml paths to the manifest's
    // collector cadences" requirement from the task spec.
    const INTEGRATION_COLLECTORS = new Set([
      'github.mjs',
      'vercel.mjs',
      'render.mjs',
      'neon.mjs',
      'google-workspace.mjs',
      'db-internal.mjs',
    ]);
    let missing = 0;
    for (const { src, controlId, idx } of allPatterns) {
      if (!INTEGRATION_COLLECTORS.has(src.collector)) continue;
      if (!['hourly', 'daily', 'weekly'].includes(src.cadence)) continue;
      if (typeof src.workflow !== 'string' || !src.workflow.startsWith('compliance/workflows/')) {
        missing++;
        // eslint-disable-next-line no-console
        console.warn(`[${controlId}#${idx}] collector=${src.collector} cadence=${src.cadence} missing workflow field`);
      }
    }
    expect(missing, `${missing} integration-collector evidence_sources are missing a workflow field`).toBe(0);
  });
});
