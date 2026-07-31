// scripts/__tests__/validate-compliance-manifest.test.mjs
//
// Unit tests for scripts/validate-compliance-manifest.mjs.
//
// Uses vitest. Run with: npx vitest run scripts/__tests__/validate-compliance-manifest.test.mjs
//
// The test suite covers:
//   1. extractControlIdsFromMatrix — regex/parsing correctness
//   2. validateManifest — happy path
//   3. validateManifest — missing matrix control fails loudly
//   4. validateManifest — empty evidence_sources without N/A flag fails
//   5. validateManifest — invalid cadence fails
//   6. validateManifest — N/A controls require empty evidence_sources
//   7. validateManifest — not_assessed controls require empty evidence_sources
//   8. validateManifest — duplicate control IDs in matrix are deduplicated
//   9. validateManifest — unknown collector is reported as a warning-class error
//  10. validateManifest — top-level manifest shape (version, generated_at, frameworks)

import { describe, it, expect } from 'vitest';
import {
  extractControlIdsFromMatrix,
  validateManifest,
  validateEvidenceSource,
  VALID_CADENCES,
  VALID_COLLECTORS,
} from '../validate-compliance-manifest.mjs';

// ─────────────────────────────────────────────────────────────────────
// Sample fixtures
// ─────────────────────────────────────────────────────────────────────

const SAMPLE_MATRIX = `
# Test control matrix

## SOC 2

| Control ID | Framework | Description | Current state |
|---|---|---|---|
| CC1.1 | SOC 2 | Integrity and ethics | Partial |
| CC1.2 | SOC 2 | Board oversight | Not assessed |
| CC6.4 | SOC 2, ISO A.8.1 | Physical access | Not applicable |
| CC6.6 | SOC 2, ISO A.5.15 | Logical access | Gap |
| CC8.1 | SOC 2 | Change management | Gap |

## ISO 27001

| Control ID | Framework | Description | Current state |
|---|---|---|---|
| A.5.1 | ISO 27001 | Information security policy | Partial |
| A.5.10 | ISO 27001 | Acceptable use | Not assessed |
| A.5.34 | ISO 27001 | PII protection | Partial |
| A.8.23 | ISO 27017 | Web filtering | Not applicable |

## ISO 27701

| Control ID | Framework | Description | Current state |
|---|---|---|---|
| 6.2.1 / A.5.34 | ISO 27701 | PII inventory | Partial |
| 6.3.x | ISO 27701 | Data subject rights | Implemented |
| 6.5.x | ISO 27701 | PII sharing | Gap |
| 6.6.x | ISO 27701 | Breach notification | Not assessed |
`;

// Build a valid manifest covering every ID in SAMPLE_MATRIX.
function makeValidManifest(overrides = {}) {
  return {
    version: 1,
    generated_at: '2026-07-30T22:00:00Z',
    frameworks: ['SOC 2', 'ISO 27001', 'ISO 27701', 'ISO 27017'],
    controls: {
      'CC1.1': {
        title: 'Integrity and ethics',
        framework: ['SOC 2 CC1.1'],
        current_state: 'Partial',
        evidence_sources: [
          { path_pattern: 'compliance/policies/01.md', collector: 'manual', cadence: 'annual' },
        ],
      },
      'CC1.2': {
        title: 'Board oversight',
        framework: ['SOC 2 CC1.2'],
        current_state: 'Not assessed',
        not_assessed: true,
        not_assessed_note: 'No board charter in repo.',
        evidence_sources: [],
      },
      'CC6.4': {
        title: 'Physical access',
        framework: ['SOC 2 CC6.4', 'ISO 27017 A.8.1'],
        current_state: 'Not Applicable',
        not_applicable: true,
        not_applicable_reason: 'Cloud-only; physical access is the cloud provider SOC 2 evidence.',
        evidence_sources: [],
      },
      'CC6.6': {
        title: 'Logical access',
        framework: ['SOC 2 CC6.6', 'ISO 27001 A.5.15'],
        current_state: 'Gap',
        evidence_sources: [
          { path_pattern: 'lib/auth.ts', collector: 'source-code', cadence: 'on-demand' },
          { path_pattern: 'evidence/github/{date}/branch-protection.json', collector: 'github.mjs', cadence: 'daily' },
        ],
      },
      'CC8.1': {
        title: 'Change management',
        framework: ['SOC 2 CC8.1'],
        current_state: 'Gap',
        evidence_sources: [
          { path_pattern: 'lib/migrations/runner.ts', collector: 'source-code', cadence: 'on-demand' },
        ],
      },
      'A.5.1': {
        title: 'Information security policy',
        framework: ['ISO 27001 A.5.1'],
        current_state: 'Partial',
        evidence_sources: [
          { path_pattern: 'compliance/policies/01-information-security.md', collector: 'manual', cadence: 'annual' },
        ],
      },
      'A.5.10': {
        title: 'Acceptable use',
        framework: ['ISO 27001 A.5.10'],
        current_state: 'Not assessed',
        not_assessed: true,
        not_assessed_note: 'No AUP documented.',
        evidence_sources: [],
      },
      'A.5.34': {
        title: 'PII protection',
        framework: ['ISO 27001 A.5.34'],
        current_state: 'Partial',
        evidence_sources: [
          { path_pattern: 'lib/survey/', collector: 'source-code', cadence: 'on-demand' },
        ],
      },
      'A.8.23': {
        title: 'Web filtering',
        framework: ['ISO 27001 A.8.23', 'ISO 27017 A.8.23'],
        current_state: 'Not Applicable',
        not_applicable: true,
        not_applicable_reason: 'SaaS, not a corporate network.',
        evidence_sources: [],
      },
      '6.2.1 / A.5.34': {
        title: 'PII inventory',
        framework: ['ISO 27701 6.2.1', 'ISO 27001 A.5.34'],
        current_state: 'Partial',
        evidence_sources: [
          { path_pattern: 'lib/survey/', collector: 'source-code', cadence: 'on-demand' },
        ],
      },
      '6.3.x': {
        title: 'Data subject rights',
        framework: ['ISO 27701 6.3.x'],
        current_state: 'Implemented',
        evidence_sources: [
          { path_pattern: 'app/api/auth/delete-account/route.ts', collector: 'source-code', cadence: 'on-demand' },
        ],
      },
      '6.5.x': {
        title: 'PII sharing',
        framework: ['ISO 27701 6.5.x'],
        current_state: 'Gap',
        evidence_sources: [
          { path_pattern: 'compliance/vendors/openai/dpa.pdf', collector: 'manual', cadence: 'annual' },
        ],
      },
      '6.6.x': {
        title: 'Breach notification',
        framework: ['ISO 27701 6.6.x'],
        current_state: 'Not assessed',
        not_assessed: true,
        not_assessed_note: 'No breach runbook.',
        evidence_sources: [],
      },
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('extractControlIdsFromMatrix', () => {
  it('parses SOC 2, ISO 27001, and ISO 27701 control IDs from a sample matrix', () => {
    const ids = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    expect(ids).toEqual([
      'CC1.1',
      'CC1.2',
      'CC6.4',
      'CC6.6',
      'CC8.1',
      'A.5.1',
      'A.5.10',
      'A.5.34',
      'A.8.23',
      '6.2.1 / A.5.34',
      '6.3.x',
      '6.5.x',
      '6.6.x',
    ]);
  });

  it('deduplicates IDs that appear in multiple tables', () => {
    const text = `
| Control ID | Framework | Description | Current state |
|---|---|---|---|
| A.5.34 | ISO 27001 | PII | Partial |
| A.5.34 | ISO 27001 | PII (second row) | Partial |
| CC1.1 | SOC 2 | Ethics | Implemented |
| CC1.1 | SOC 2 | Ethics (second row) | Implemented |
`;
    const ids = extractControlIdsFromMatrix(text);
    expect(ids).toEqual(['A.5.34', 'CC1.1']);
  });

  it('ignores non-data table rows (separators, blanks, non-table lines)', () => {
    const text = `
# Header line
|---|---|---|---|
| not-a-control | x | y | z |
| 6.6.x | ISO 27701 | Breach | Not assessed |
random prose line
| A.8.23 | ISO 27017 | Web filtering | Not applicable |
`;
    const ids = extractControlIdsFromMatrix(text);
    expect(ids).toEqual(['6.6.x', 'A.8.23']);
  });

  it('rejects non-string input', () => {
    expect(() => extractControlIdsFromMatrix(null)).toThrow(TypeError);
    expect(() => extractControlIdsFromMatrix(undefined)).toThrow(TypeError);
    expect(() => extractControlIdsFromMatrix(42)).toThrow(TypeError);
  });
});

describe('validateManifest', () => {
  it('passes a valid manifest that covers every matrix control', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when a matrix control is missing from the manifest', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    delete manifest.controls['CC6.6'];
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC6.6') && e.includes('missing'))).toBe(true);
  });

  it('fails when evidence_sources is empty and control is not N/A or not_assessed', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['CC1.1'].evidence_sources = [];
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC1.1') && e.includes('empty'))).toBe(true);
  });

  it('fails when cadence is not in the allowed set', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['CC1.1'].evidence_sources[0].cadence = 'every-so-often';
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC1.1') && e.includes('every-so-often'))).toBe(true);
  });

  it('fails when an N/A control has non-empty evidence_sources', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['CC6.4'].evidence_sources = [
      { path_pattern: 'whatever', collector: 'manual', cadence: 'annual' },
    ];
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC6.4') && e.includes('non-empty'))).toBe(true);
  });

  it('fails when a not_assessed control has non-empty evidence_sources', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['6.6.x'].evidence_sources = [
      { path_pattern: 'whatever', collector: 'manual', cadence: 'annual' },
    ];
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('6.6.x') && e.includes('non-empty'))).toBe(true);
  });

  it('fails when an N/A control is missing not_applicable_reason', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    delete manifest.controls['CC6.4'].not_applicable_reason;
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC6.4') && e.includes('not_applicable_reason'))).toBe(true);
  });

  it('fails when a not_assessed control is missing not_assessed_note', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    delete manifest.controls['CC1.2'].not_assessed_note;
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC1.2') && e.includes('not_assessed_note'))).toBe(true);
  });

  it('fails on missing top-level fields (version, generated_at, frameworks)', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    delete manifest.version;
    delete manifest.generated_at;
    delete manifest.frameworks;
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
    expect(result.errors.some((e) => e.includes('generated_at'))).toBe(true);
    expect(result.errors.some((e) => e.includes('frameworks'))).toBe(true);
  });

  it('fails when evidence_sources is not an array', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['CC1.1'].evidence_sources = 'not-an-array';
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CC1.1') && e.includes('must be an array'))).toBe(true);
  });

  it('reports an unknown collector as an error (so the team adds it to VALID_COLLECTORS deliberately)', () => {
    const matrixIds = extractControlIdsFromMatrix(SAMPLE_MATRIX);
    const manifest = makeValidManifest();
    manifest.controls['CC1.1'].evidence_sources[0].collector = 'mystery-collector.mjs';
    const result = validateManifest(manifest, matrixIds);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('mystery-collector.mjs'))).toBe(true);
  });

  it('rejects a manifest root that is not an object', () => {
    const result = validateManifest('not-an-object', []);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateEvidenceSource (unit)', () => {
  it('passes a fully-populated source with valid cadence and known collector', () => {
    const errors = [];
    validateEvidenceSource(
      { path_pattern: 'lib/auth.ts', collector: 'source-code', cadence: 'on-demand' },
      errors,
      'TEST.1',
      0,
    );
    expect(errors).toEqual([]);
  });

  it('reports each missing field individually', () => {
    const errors = [];
    validateEvidenceSource({}, errors, 'TEST.2', 0);
    // path_pattern missing, collector missing, cadence missing
    expect(errors.length).toBe(3);
    expect(errors.every((e) => e.includes('TEST.2'))).toBe(true);
  });

  it('reports non-object source', () => {
    const errors = [];
    validateEvidenceSource('not-an-object', errors, 'TEST.3', 0);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('TEST.3');
  });
});

describe('constants', () => {
  it('VALID_CADENCES contains the eight documented cadences', () => {
    expect(VALID_CADENCES).toEqual([
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'quarterly',
      'annual',
      'on-demand',
      'manual',
    ]);
  });

  it('VALID_COLLECTORS includes the six integration collectors and the helper collectors', () => {
    for (const c of [
      'github.mjs',
      'vercel.mjs',
      'render.mjs',
      'neon.mjs',
      'google-workspace.mjs',
      'db-internal.mjs',
      'compliance-uar.mjs',
      'compliance-monitoring.mjs',
      'auditor-access.mjs',
      'source-code',
      'manual',
    ]) {
      expect(VALID_COLLECTORS).toContain(c);
    }
  });
});
