#!/usr/bin/env node
/**
 * scripts/check-env.js
 *
 * Standalone environment variable audit script.
 * Runs in GitHub Actions CI and can be run locally.
 *
 * What it checks:
 *   1. All REQUIRED_VARS are referenced somewhere in lib/ or app/ TypeScript files
 *   2. All REQUIRED_VARS are documented in .env.example
 *   3. All RECOMMENDED_VARS are documented in .env.example
 *   4. No required var has a placeholder value in the current process.env
 *      (catches CI misconfiguration where stub values were forgotten)
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (blocks deployment in CI)
 *
 * Usage:
 *   node scripts/check-env.js              # audit docs + code references
 *   node scripts/check-env.js --runtime    # also check process.env for placeholders
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
];

const RECOMMENDED_VARS = [
  'OPENAI_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'RESEND_API_KEY',
  'NEXT_PUBLIC_BASE_URL',
];

const ALL_VARS = [...REQUIRED_VARS, ...RECOMMENDED_VARS];

// Placeholder values that indicate a var is "set" but not actually configured
const PLACEHOLDER_PATTERNS = [
  'YOUR_NEON_DATABASE_URL_HERE',
  're_YOUR_RESEND_API_KEY_HERE',
  'sk-YOUR_OPENAI_KEY_HERE',
  'YOUR_GOOGLE_MAPS_KEY_HERE',
  'ci-test-secret',
  'ci-build-secret',
  'test-placeholder',
  'postgresql://test:test@localhost',
];

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');
const SEARCH_DIRS = [
  path.join(ROOT, 'lib'),
  path.join(ROOT, 'app'),
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHECK  = '✓';
const CROSS  = '✗';
const WARN   = '⚠';

let failures = 0;
let warnings = 0;

function pass(msg)  { console.log(`  ${CHECK} ${msg}`); }
function fail(msg)  { console.error(`  ${CROSS} ${msg}`); failures++; }
function warn(msg)  { console.warn(`  ${WARN} ${msg}`); warnings++; }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`); }

/**
 * Recursively collect all .ts and .tsx files under a directory.
 */
function collectTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
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
 * Read all TS source files from SEARCH_DIRS into a single concatenated string.
 * Used for substring search — fast enough for a < 500 file codebase.
 */
function readAllSourceCode() {
  const files = SEARCH_DIRS.flatMap(collectTsFiles);
  return files.map(f => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).join('\n');
}

// ── Check 1: Code references ──────────────────────────────────────────────────

section('Check 1: Env vars referenced in source code');

const sourceCode = readAllSourceCode();

for (const v of ALL_VARS) {
  if (sourceCode.includes(v)) {
    pass(`${v} is referenced in lib/ or app/`);
  } else {
    fail(`${v} is NOT referenced in lib/ or app/ — it may be unused or miscategorised`);
  }
}

// ── Check 2: .env.example completeness ───────────────────────────────────────

section('Check 2: .env.example documents all vars');

if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
  fail('.env.example file not found — create it at the repo root');
} else {
  const envExample = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');

  for (const v of REQUIRED_VARS) {
    if (envExample.includes(v)) {
      pass(`${v} is documented in .env.example`);
    } else {
      fail(`${v} is missing from .env.example — add it so developers know it is required`);
    }
  }

  for (const v of RECOMMENDED_VARS) {
    if (envExample.includes(v)) {
      pass(`${v} is documented in .env.example`);
    } else {
      warn(`${v} is not in .env.example — add it (recommended var, not required)`);
    }
  }
}

// ── Check 3: Runtime placeholder detection (--runtime flag) ───────────────────

if (process.argv.includes('--runtime')) {
  section('Check 3: Runtime env var values (placeholder detection)');
  console.log('  Note: CI stub values are expected and allowed in build jobs.');

  for (const v of REQUIRED_VARS) {
    const val = process.env[v];
    if (!val) {
      fail(`${v} is not set in process.env`);
    } else {
      const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => val.includes(p));
      if (isPlaceholder) {
        warn(`${v} appears to be a placeholder/stub value — OK in CI build, NOT OK in production`);
      } else {
        pass(`${v} is set with a non-placeholder value`);
      }
    }
  }

  for (const v of RECOMMENDED_VARS) {
    const val = process.env[v];
    if (!val) {
      warn(`${v} is not set — affected features will degrade`);
    } else {
      pass(`${v} is set`);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

section('Summary');

if (failures === 0 && warnings === 0) {
  console.log(`  ${CHECK} All environment variable checks passed.\n`);
  process.exit(0);
} else if (failures === 0) {
  console.log(`  ${WARN} ${warnings} warning(s), 0 failures — build can proceed but review warnings.\n`);
  process.exit(0);
} else {
  console.error(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.error(`║         ENV AUDIT FAILED                                     ║`);
  console.error(`╚══════════════════════════════════════════════════════════════╝`);
  console.error(`  ${failures} failure(s), ${warnings} warning(s)`);
  console.error(`  Fix the failures above before deploying.\n`);
  process.exit(1);
}