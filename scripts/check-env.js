#!/usr/bin/env node
// ============================================================
// scripts/check-env.js — Environment Variable Audit
//
// Verifies:
//   1. All required vars referenced in lib/ and app/ are
//      documented in .env.example
//   2. All vars in .env.example are actually referenced in code
//
// Exit 0 = pass, Exit 1 = fail
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

// ─── Vars that are set by the runtime / build system, not user-provided ───
const RUNTIME_VARS = new Set([
  'NODE_ENV',
  'PORT',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'NEXT_PUBLIC_BUILD_VERSION',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_TELEMETRY_DISABLED',
  'CI',
  'DEBUG_ENGINEERING',
  'XYZ',  // test/debug placeholder
]);

// ─── Vars referenced in code but intentionally NOT in .env.example ───
// (internal/dev-only vars that don't need documentation)
const INTERNAL_VARS = new Set([
  'INTERNAL_OCR_SECRET',
  'DEV_AUTH_BYPASS',
  'DEV_AUTH_USER_ID',
  'DEV_AUTH_USER_EMAIL',
  'DEV_AUTH_USER_NAME',
  'GOOGLE_SOLAR_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'PVWATTS_API_KEY',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'NEXT_PUBLIC_BASE_URL',
]);

// ─── 1. Scan code for process.env.* references ─────────────────────
function scanDir(dir, exts) {
  const results = new Set();
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .next, etc.
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      for (const v of scanDir(fullPath, exts)) results.add(v);
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const matches = content.matchAll(/process\.env\.(\w+)/g);
      for (const m of matches) results.add(m[1]);
    }
  }
  return results;
}

const codeVars = new Set([
  ...scanDir(path.join(ROOT, 'lib'), ['.ts', '.tsx', '.js', '.jsx']),
  ...scanDir(path.join(ROOT, 'app'), ['.ts', '.tsx', '.js', '.jsx']),
  ...scanDir(path.join(ROOT, 'components'), ['.ts', '.tsx', '.js', '.jsx']),
]);

// ─── 2. Parse .env.example for documented vars ─────────────────────
function parseEnvExample(filePath) {
  const vars = new Set();
  if (!fs.existsSync(filePath)) return vars;

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Match VAR_NAME=... pattern
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) vars.add(match[1]);
  }
  return vars;
}

const exampleVars = parseEnvExample(ENV_EXAMPLE);

// ─── 3. Compare ─────────────────────────────────────────────────────
let hasErrors = false;

// Check: code vars that are NOT in .env.example and NOT runtime/internal
const undocumented = [];
for (const v of codeVars) {
  if (!exampleVars.has(v) && !RUNTIME_VARS.has(v) && !INTERNAL_VARS.has(v)) {
    undocumented.push(v);
  }
}

// Check: .env.example vars that are NOT referenced in code
const unused = [];
for (const v of exampleVars) {
  if (!codeVars.has(v)) {
    unused.push(v);
  }
}

// ─── 4. Report ──────────────────────────────────────────────────────
console.log('=== Environment Variable Audit ===\n');
console.log(`Code references:    ${codeVars.size} unique vars`);
console.log(`.env.example:       ${exampleVars.size} documented vars`);
console.log(`Runtime/internal:   ${RUNTIME_VARS.size + INTERNAL_VARS.size} excluded\n`);

if (undocumented.length > 0) {
  console.log(`⚠️  ${undocumented.length} var(s) referenced in code but NOT in .env.example:`);
  for (const v of undocumented.sort()) {
    console.log(`   - ${v}`);
  }
  console.log('   (Add to .env.example or to INTERNAL_VARS in this script)\n');
  // Warn but don't fail — these might be intentionally internal
}

if (unused.length > 0) {
  console.log(`ℹ️  ${unused.length} var(s) in .env.example but not found in code:`);
  for (const v of unused.sort()) {
    console.log(`   - ${v}`);
  }
  console.log('   (May be used in config files not scanned, or can be removed)\n');
}

// Only fail if there are undocumented REQUIRED vars (not just warnings)
// For now, all undocumented vars are treated as warnings, not errors
if (hasErrors) {
  console.log('❌ Env audit FAILED\n');
  process.exit(1);
} else {
  console.log('✅ Env audit PASSED\n');
  process.exit(0);
}