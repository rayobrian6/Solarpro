// ═══════════════════════════════════════════════════════════════════════════
// compliance/__tests__/validate-collector-output.test.mjs
//
// Verifies that each of the 6 evidence collectors, when run in DRY_RUN
// mode, returns a list of repo-relative paths that:
//   1. are strings
//   2. start with "compliance/evidence/<integration>/"
//   3. contain a YYYY-MM-DD date segment
//   4. match at least one path_pattern in compliance/manifest.json
//      (after {date} substitution with the same date)
//
// This is the regression guard that catches drift between the collectors
// and the manifest. If a collector's output path stops matching a
// manifest entry (or vice versa), an auditor-facing control mapping
// silently breaks. This test makes that silent break loud.
//
// The test runs in DRY_RUN so it doesn't need any API tokens and doesn't
// touch the network. It does write a small manifest in the working
// tree (the manifest is committed to the repo, not generated) and reads
// the same. So it's a pure read+import test, no filesystem mutations.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO, 'compliance', 'manifest.json');

const COLLECTORS = [
  { name: 'github.mjs', integration: 'github', modes: ['hourly', 'daily', 'weekly'] },
  { name: 'vercel.mjs', integration: 'vercel', modes: ['hourly', 'daily', 'weekly'] },
  { name: 'render.mjs', integration: 'render', modes: ['hourly', 'daily', 'weekly'] },
  { name: 'neon.mjs', integration: 'neon', modes: ['hourly', 'daily', 'weekly'] },
  { name: 'google-workspace.mjs', integration: 'google-workspace', modes: ['hourly', 'daily', 'weekly'] },
  { name: 'db-internal.mjs', integration: 'db', modes: ['hourly', 'daily', 'weekly'] },
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PATH_REGEX = /^compliance\/evidence\/([\w-]+)\/(\d{4}-\d{2}-\d{2})\/(.+)$/;

let manifest;
let manifestPatterns;

beforeAll(() => {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  // Collect every path_pattern in the manifest that uses {date}.
  manifestPatterns = new Set();
  for (const ctrl of Object.values(manifest.controls)) {
    if (!Array.isArray(ctrl.evidence_sources)) continue;
    for (const src of ctrl.evidence_sources) {
      if (typeof src.path_pattern === 'string') {
        manifestPatterns.add(src.path_pattern);
      }
    }
  }
});

describe('collector output paths (DRY_RUN)', () => {
  // Run each collector once per mode. We test ALL modes for ALL collectors
  // because the design doc assigns different cadences to different
  // collectors, and we want to catch drift in any of them.
  for (const c of COLLECTORS) {
    for (const mode of c.modes) {
      it(`${c.name} (${mode}) returns valid paths that match the manifest`, async () => {
        const mod = await import(path.join(REPO, 'compliance', 'collectors', c.name));
        if (typeof mod.collect !== 'function') {
          throw new Error(`${c.name}: export.collect is not a function`);
        }
        // DRY_RUN=1 ensures no API calls and no real writes
        const prevDryRun = process.env.DRY_RUN;
        process.env.DRY_RUN = '1';
        let paths;
        try {
          paths = await mod.collect(mode);
        } finally {
          if (prevDryRun === undefined) delete process.env.DRY_RUN;
          else process.env.DRY_RUN = prevDryRun;
        }
        expect(Array.isArray(paths)).toBe(true);
        expect(paths.length).toBeGreaterThan(0);

        for (const p of paths) {
          expect(typeof p).toBe('string');
          expect(p).toMatch(PATH_REGEX);
          const [, integration, date, filename] = p.match(PATH_REGEX);
          expect(integration).toBe(c.integration);
          expect(date).toMatch(DATE_REGEX);
          // No absolute paths, no Windows separators
          expect(p).not.toMatch(/^[A-Z]:\\/);
          expect(p).not.toMatch(/\\/);
          // The resolved path should match at least one {date}-templated
          // pattern in the manifest. The match is permissive: the pattern
          // may have additional {date} or {YYYY-Q#} tokens; we only
          // require the literal parts to align.
          const template = `compliance/evidence/${integration}/${date}/${filename}`;
          let matched = false;
          for (const pat of manifestPatterns) {
            // Substitute {date}, {YYYY-Q#} with a regex that matches
            // today's date, and any other {xxx} with a permissive regex.
            const re = new RegExp(
              '^' +
              pat
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\{date\\\}/g, '\\d{4}-\\d{2}-\\d{2}')
                .replace(/\\\{[A-Za-z0-9_-]+\\\}/g, '[^/]+') +
              '$',
            );
            if (re.test(template)) { matched = true; break; }
          }
          expect(matched, `${c.name} wrote "${p}" which does not match any path_pattern in the manifest`).toBe(true);
        }
      }, 15_000);
    }
  }
});

describe('collector output — shape invariants', () => {
  it('each collector exports a `collect(mode)` async function', async () => {
    for (const c of COLLECTORS) {
      const mod = await import(path.join(REPO, 'compliance', 'collectors', c.name));
      expect(typeof mod.collect).toBe('function');
    }
  });

  it('all 6 collectors are present in the manifest\'s evidence_sources', () => {
    // The manifest's _meta.evidence_pipeline says the collectors exist;
    // this test asserts that they are *referenced* by at least one
    // control. If a new collector is added to the codebase but never
    // wired into the manifest, this test catches it.
    const referenced = new Set();
    for (const ctrl of Object.values(manifest.controls)) {
      if (!Array.isArray(ctrl.evidence_sources)) continue;
      for (const src of ctrl.evidence_sources) {
        if (typeof src.collector === 'string') referenced.add(src.collector);
      }
    }
    for (const c of COLLECTORS) {
      expect(
        referenced.has(c.name),
        `${c.name} is not referenced in any control's evidence_sources in the manifest. ` +
        'Either add a control mapping in compliance/manifest.json, or remove the collector.',
      ).toBe(true);
    }
  });

  it('every (integration, filename) pair has a single canonical path_pattern', () => {
    // Multiple controls can legitimately share the same evidence file
    // (e.g. CC1.5 and CC2.1 both point at audit-log.ndjson). What we
    // *do* want to catch is a SINGLE control that lists the same file
    // twice with different path_patterns (copy-paste error), or two
    // different integrations writing to the same path (cross-contamination).
    // The check: the SET of (integration, filename) pairs is consistent
    // across all controls — no pair appears under two different paths.
    const pairToPattern = new Map();
    for (const [ctrlId, ctrl] of Object.entries(manifest.controls)) {
      if (!Array.isArray(ctrl.evidence_sources)) continue;
      for (const src of ctrl.evidence_sources) {
        if (typeof src.path_pattern !== 'string') continue;
        const m = src.path_pattern.match(/^compliance\/evidence\/([\w-]+)\/\{\w+\}\/(.+)$/);
        if (!m) continue;
        const [, integration, filename] = m;
        const key = `${integration}/${filename}`;
        if (pairToPattern.has(key)) {
          expect(
            pairToPattern.get(key),
            `[${ctrlId}] path_pattern "${src.path_pattern}" claims (${key}) but the canonical pattern is already "${pairToPattern.get(key)}"`,
          ).toBe(src.path_pattern);
        } else {
          pairToPattern.set(key, src.path_pattern);
        }
      }
    }
    // Sanity: at least the 6 integration-collector output paths exist.
    const expected = [
      'github/branch-protection.json',
      'github/dependabot-alerts.json',
      'github/secret-scanning.json',
      'vercel/projects.json',
      'vercel/deployments.json',
      'vercel/env-vars.json',
      'vercel/members.json',
      'render/deploys.json',
      'render/events.json',
      'render/env-vars.json',
      'render/members.json',
      'neon/project.json',
      'neon/branches.json',
      'neon/roles.json',
      'neon/pitr.json',
      'neon/consumption.json',
      'google-workspace/users-mfa.json',
      'google-workspace/admin-roles.json',
      'google-workspace/failed-login-spike.json',
      'google-workspace/login-audit.json',
      'google-workspace/drive-sharing.json',
      'google-workspace/token-audit.json',
      'db/audit-log.ndjson',
      'db/webhook-deliveries.ndjson',
      'db/users-summary.json',
      'db/organizations-summary.json',
    ];
    for (const e of expected) {
      expect(
        pairToPattern.has(e),
        `expected canonical path_pattern for "${e}" in the manifest — add it under at least one control`,
      ).toBe(true);
    }
  });
});
