import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  generateMetadataRuntimeCandidates,
  getRegisteredOpenSourceTool,
  metadataRuntimeAdapter,
  validateOpenSourceToolDefinition,
} from './index';
import type { AssistedEvidenceSourceContext } from './index';

const sourceContext: AssistedEvidenceSourceContext = {
  sourceFileId: 'runtime-source-file-1',
  sourceUploadKey: 'uploads/project-runtime/survey-runtime/source-file-1.png',
  projectId: 'project-runtime',
  surveyId: 'survey-runtime',
  toolRunId: 'runtime-run-1',
  toolConfigHash: 'runtime-config-hash-1',
  sourceMetadataHash: 'runtime-source-metadata-hash-1',
  createdAt: '2025-03-01T00:00:00.000Z',
  createdBy: 'runtime-test-suite',
};

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84, 8, 153, 99, 248, 207, 192, 0, 0,
  3, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

describe('Controlled metadata runtime adapter pilot', () => {
  it('registers the sharp metadata runtime with review-only runtime pilot governance', () => {
    const tool = getRegisteredOpenSourceTool('sharp-metadata-runtime', '0.34.5');
    expect(tool.license).toBe('Apache-2.0');
    expect(tool.licensePosture).toBe('approved');
    expect(tool.runtimeCategory).toBe('image_metadata');
    expect(tool.allowedRuntimeBoundary).toBe('server_adapter_contract');
    expect(tool.enabledStatus).toBe('enabled_for_runtime_pilot');
    expect(tool.reviewRequired).toBe(true);
    expect(tool.canonicalMutationAllowed).toBe(false);
    expect(tool.requiresModelWeights).toBe(false);
  });

  it('rejects unsafe runtime registry definitions', () => {
    const tool = getRegisteredOpenSourceTool('sharp-metadata-runtime', '0.34.5');
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'blocked-runtime', license: 'AGPL-3.0' })).toThrow(/blocked/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'canonical-runtime', canonicalMutationAllowed: true as false })).toThrow(/canonical mutation/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'visual-runtime', runtimeCategory: 'visual_categorization_candidate' })).toThrow(/native binaries|visual categorization/i);
    expect(() => validateOpenSourceToolDefinition({ ...tool, toolName: 'browser-runtime', serverOnly: false })).toThrow(/server-only/i);
  });

  it('extracts deterministic metadata payloads from the same image bytes', async () => {
    const first = await metadataRuntimeAdapter.extractRuntimePayload(onePixelPng);
    const second = await metadataRuntimeAdapter.extractRuntimePayload(onePixelPng);

    expect(first).toEqual(second);
    expect(first.format).toBe('png');
    expect(first.width).toBe(1);
    expect(first.height).toBe(1);
    expect(first.runtimePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.derivedSignals.map(signal => signal.signalId)).toEqual([...first.derivedSignals.map(signal => signal.signalId)].sort());
  });

  it('generates stable review-required non-authoritative candidates with bounded confidence', async () => {
    const first = await generateMetadataRuntimeCandidates(sourceContext, onePixelPng);
    const second = await generateMetadataRuntimeCandidates(sourceContext, onePixelPng);

    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates.map(candidate => candidate.deterministicHash)).toEqual(second.candidates.map(candidate => candidate.deterministicHash));
    expect(first.candidates.map(candidate => `${candidate.candidateType}:${candidate.candidateSummary}`)).toEqual(
      [...first.candidates.map(candidate => `${candidate.candidateType}:${candidate.candidateSummary}`)].sort(),
    );

    for (const candidate of first.candidates) {
      expect(candidate.candidateStatus).toBe('review_required');
      expect(candidate.nonAuthoritative).toBe(true);
      expect(candidate.reviewRequired).toBe(true);
      expect(candidate.candidateConfidence).toBeGreaterThanOrEqual(0);
      expect(candidate.candidateConfidence).toBeLessThanOrEqual(1);
      expect(candidate.candidatePayload.runtimePilot).toBe(true);
      expect(candidate.candidatePayload.fixtureOnly).toBe(false);
      expect(candidate.candidatePayload.runtimeCategory).toBe('image_metadata');
      expect(candidate.candidateLimitations).toContain('runtime-pilot');
      expect(candidate.candidateLimitations).toContain('review-required');
      expect(candidate.candidateLimitations).toContain('non-authoritative');
      expect(candidate.candidateLimitations).toContain('no-engineering-authority');
      expect(candidate.provenance.deterministicInputs).toContain('runtime-payload');
      expect(candidate.provenance.notes.join(' ')).toContain('Controlled metadata runtime pilot output');
    }
  });

  it('keeps runtime output out of canonical, CAD, recommendation, and workflow authority', async () => {
    const result = await generateMetadataRuntimeCandidates(sourceContext, onePixelPng);
    const serialized = JSON.stringify(result.candidates);

    expect(serialized).not.toMatch(/buildSurveyEvidenceManifest|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration/);
    expect(result.candidates.every(candidate => candidate.candidatePayload.runtimePilot === true)).toBe(true);
    expect(result.candidates.every(candidate => candidate.candidateStatus === 'review_required')).toBe(true);
  });

  it('passes the assisted evidence boundary guard with runtime import containment', () => {
    const output = execFileSync('npm', ['run', 'check:assisted-evidence-boundaries'], { encoding: 'utf8' });
    expect(output).toContain('Assisted evidence boundary guard passed');
  });
});
