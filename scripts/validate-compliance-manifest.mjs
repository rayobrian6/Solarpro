#!/usr/bin/env node
// scripts/validate-compliance-manifest.mjs
//
// Compliance manifest validator. Walks CONTROL_MATRIX.md, reads
// compliance/manifest.json, and enforces the structural contract:
//   1. Every control ID in the matrix is present in the manifest
//   2. Every control has at least one evidence_source, unless
//      marked not_applicable or not_assessed (in which case it MUST
//      be empty)
//   3. Every evidence_source has path_pattern, collector, and cadence,
//      and cadence is in the allowed set
//
// Exits 0 on success, 1 on failure with a clear error report.
//
// Run from repo root:  node scripts/validate-compliance-manifest.mjs
// Or with explicit paths:
//   node scripts/validate-compliance-manifest.mjs <matrix.md> <manifest.json>
//
// Designed to be importable as a module for the test suite
// (scripts/__tests__/validate-compliance-manifest.test.mjs).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const VALID_CADENCES = Object.freeze([
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'on-demand',
  'manual',
]);

// Recognized collectors. The six integration collectors + the planned
// compliance-* helper scripts + 'source-code' (for code-level evidence)
// and 'manual' (for human-maintained artifacts). Adding a new collector
// is intentional friction — extend this list in the same PR that adds
// the collector script.
export const VALID_COLLECTORS = Object.freeze([
  'github.mjs',
  'vercel.mjs',
  'render.mjs',
  'neon.mjs',
  'google-workspace.mjs',
  'db-internal.mjs',
  'compliance-uar.mjs',
  'compliance-monitoring.mjs',
  'compliance-trust.mjs',
  'compliance-vendor.mjs',
  'compliance-policies.mjs',
  'auditor-access.mjs',
  'source-code',
  'manual',
]);

// Control ID patterns accepted in the matrix. SOC 2 TSC ("CCx.y"),
// ISO 27001 Annex A ("A.5.x" / "A.8.x"), and ISO 27701 ("6.x.y" or
// "6.x.y / A.5.34" joint rows).
const CONTROL_ID_PATTERNS = [
  /^CC\d+\.\d+$/,
  /^A\.\d+\.\d+$/,
  /^6\.\d+\.[xy]$/,
  /^6\.\d+\.[xy]\s*\/\s*A\.\d+\.\d+$/,
  /^6\.\d+\.\d+\s*\/\s*A\.\d+\.\d+$/,
];

/**
 * Extract unique control IDs from a CONTROL_MATRIX.md text.
 * Looks at the first cell of every markdown table row.
 * Returns the IDs in the order they first appear.
 */
export function extractControlIdsFromMatrix(matrixText) {
  if (typeof matrixText !== 'string') {
    throw new TypeError('matrixText must be a string');
  }
  const ids = [];
  const seen = new Set();
  for (const line of matrixText.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const id = cells[0];
    if (CONTROL_ID_PATTERNS.some((re) => re.test(id))) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Validate a single evidence_source entry. Mutates `errors` (push).
 */
export function validateEvidenceSource(source, errors, controlId, idx) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    errors.push(`[${controlId}] evidence_sources[${idx}] must be an object`);
    return;
  }
  if (typeof source.path_pattern !== 'string' || source.path_pattern.trim() === '') {
    errors.push(`[${controlId}] evidence_sources[${idx}].path_pattern is missing or empty`);
  }
  if (typeof source.collector !== 'string' || source.collector.trim() === '') {
    errors.push(`[${controlId}] evidence_sources[${idx}].collector is missing or empty`);
  }
  if (typeof source.cadence !== 'string' || source.cadence.trim() === '') {
    errors.push(`[${controlId}] evidence_sources[${idx}].cadence is missing or empty`);
    return;
  }
  if (!VALID_CADENCES.includes(source.cadence)) {
    errors.push(
      `[${controlId}] evidence_sources[${idx}].cadence "${source.cadence}" is not in [${VALID_CADENCES.join(', ')}]`,
    );
  }
  // Collector validation is intentionally non-fatal: a warning lets
  // the manifest evolve ahead of the collector script being written.
  // The CI still reports unknown collectors so the team can decide.
  if (
    typeof source.collector === 'string' &&
    source.collector.trim() !== '' &&
    !VALID_COLLECTORS.includes(source.collector)
  ) {
    errors.push(
      `[${controlId}] evidence_sources[${idx}].collector "${source.collector}" is not in the known collector set; add it to VALID_COLLECTORS in scripts/validate-compliance-manifest.mjs if intentional`,
    );
  }
}

/**
 * Validate the full manifest against the matrix ID list.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateManifest(manifest, matrixIds) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['manifest root is not a JSON object'] };
  }
  if (typeof manifest.version !== 'number') {
    errors.push('manifest.version must be a number');
  }
  if (typeof manifest.generated_at !== 'string' || manifest.generated_at.trim() === '') {
    errors.push('manifest.generated_at must be an ISO 8601 string');
  }
  if (!Array.isArray(manifest.frameworks) || manifest.frameworks.length === 0) {
    errors.push('manifest.frameworks must be a non-empty array');
  }
  if (!manifest.controls || typeof manifest.controls !== 'object' || Array.isArray(manifest.controls)) {
    errors.push('manifest.controls must be an object');
    return { valid: errors.length === 0, errors };
  }

  // 1. Every matrix control ID must be present in the manifest.
  const manifestIds = new Set(Object.keys(manifest.controls));
  for (const id of matrixIds) {
    if (!manifestIds.has(id)) {
      errors.push(`Control ID "${id}" from CONTROL_MATRIX.md is missing from manifest.controls`);
    }
  }

  // 2. Every manifest control must have a well-formed body.
  for (const [id, control] of Object.entries(manifest.controls)) {
    if (!control || typeof control !== 'object' || Array.isArray(control)) {
      errors.push(`[${id}] control entry must be an object`);
      continue;
    }

    if (typeof control.title !== 'string' || control.title.trim() === '') {
      errors.push(`[${id}] title is missing or empty`);
    }
    if (!Array.isArray(control.framework) || control.framework.length === 0) {
      errors.push(`[${id}] framework must be a non-empty array`);
    }
    if (typeof control.current_state !== 'string' || control.current_state.trim() === '') {
      errors.push(`[${id}] current_state is missing or empty`);
    }

    const isNA = control.not_applicable === true;
    const isNotAssessed = control.not_assessed === true;

    if (!isNA && !isNotAssessed) {
      if (typeof control.not_applicable !== 'undefined' && control.not_applicable !== false) {
        errors.push(`[${id}] not_applicable must be boolean true/false, not ${typeof control.not_applicable}`);
      }
      if (typeof control.not_assessed !== 'undefined' && control.not_assessed !== false) {
        errors.push(`[${id}] not_assessed must be boolean true/false, not ${typeof control.not_assessed}`);
      }
    }

    if (!Array.isArray(control.evidence_sources)) {
      errors.push(`[${id}] evidence_sources must be an array`);
      continue;
    }

    if (control.evidence_sources.length === 0 && !isNA && !isNotAssessed) {
      errors.push(
        `[${id}] evidence_sources is empty but control is not marked not_applicable or not_assessed (current_state: ${control.current_state})`,
      );
      continue;
    }

    if (control.evidence_sources.length > 0 && (isNA || isNotAssessed)) {
      errors.push(
        `[${id}] evidence_sources is non-empty but control is marked not_applicable or not_assessed (should be empty)`,
      );
    }

    if (isNA && typeof control.not_applicable_reason !== 'string') {
      errors.push(`[${id}] not_applicable is true but not_applicable_reason is missing`);
    }
    if (isNotAssessed && typeof control.not_assessed_note !== 'string') {
      errors.push(`[${id}] not_assessed is true but not_assessed_note is missing`);
    }

    for (let i = 0; i < control.evidence_sources.length; i++) {
      validateEvidenceSource(control.evidence_sources[i], errors, id, i);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolve the default paths. If the matrix file is not at the given
 * path, fall back to the compliance-lead agent workspace (where the
 * canonical working copy lives today). This makes the script runnable
 * from the repo root in CI without requiring the matrix to be inside
 * the repo (it will be, once compliance/CONTROL_MATRIX.md is committed).
 */
export function resolvePaths(argv, cwd, home) {
  const matrixArg = argv[0];
  const manifestArg = argv[1];
  const manifestPath = manifestArg || path.join(cwd, 'compliance', 'manifest.json');
  let matrixPath = matrixArg || path.join(cwd, 'CONTROL_MATRIX.md');
  let matrixResolvedFrom = 'argv';
  if (!fs.existsSync(matrixPath)) {
    // Fall back to compliance/CONTROL_MATRIX.md (the in-repo copy)
    const inRepo = path.join(cwd, 'compliance', 'CONTROL_MATRIX.md');
    if (fs.existsSync(inRepo)) {
      matrixPath = inRepo;
      matrixResolvedFrom = 'compliance/CONTROL_MATRIX.md';
    } else if (home) {
      // Fall back to the compliance-lead agent workspace
      const ws = path.join(home, '.mavis', 'agents', 'compliance-lead', 'workspace', 'CONTROL_MATRIX.md');
      if (fs.existsSync(ws)) {
        matrixPath = ws;
        matrixResolvedFrom = '~/.mavis/agents/compliance-lead/workspace/CONTROL_MATRIX.md';
      }
    }
  }
  return { matrixPath, manifestPath, matrixResolvedFrom };
}

/**
 * CLI entry point. Reads files, runs validation, prints a report,
 * exits 0 on success, 1 on failure.
 */
export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const home = env.USERPROFILE || env.HOME || '';
  const { matrixPath, manifestPath, matrixResolvedFrom } = resolvePaths(argv, cwd, home);

  if (!fs.existsSync(matrixPath)) {
    console.error(`ERROR: CONTROL_MATRIX.md not found at ${matrixPath}`);
    console.error('Tried:');
    console.error(`  - ${matrixPath}`);
    console.error(`  - ${path.join(cwd, 'compliance', 'CONTROL_MATRIX.md')}`);
    if (home) console.error(`  - ${path.join(home, '.mavis', 'agents', 'compliance-lead', 'workspace', 'CONTROL_MATRIX.md')}`);
    return 1;
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: manifest not found at ${manifestPath}`);
    return 1;
  }

  const matrixText = fs.readFileSync(matrixPath, 'utf8');
  const matrixIds = extractControlIdsFromMatrix(matrixText);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: manifest is not valid JSON: ${err.message}`);
    return 1;
  }

  const result = validateManifest(manifest, matrixIds);

  console.log(`Matrix:        ${matrixPath} (${matrixResolvedFrom})`);
  console.log(`Manifest:      ${manifestPath}`);
  console.log(`Matrix IDs:    ${matrixIds.length}`);
  console.log(`Manifest IDs:  ${Object.keys(manifest.controls || {}).length}`);

  if (!result.valid) {
    console.error(`\nVALIDATION FAILED with ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  console.log(`\nVALIDATION PASSED - all ${matrixIds.length} controls have valid evidence mappings.`);
  return 0;
}

// Run main() when this file is executed directly.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const code = main();
  process.exit(code);
}
