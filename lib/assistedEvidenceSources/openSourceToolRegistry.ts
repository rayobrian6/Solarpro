import type { OpenSourceToolDefinition, ValidatedOpenSourceToolDefinition } from './openSourceToolTypes';
import { validateOpenSourceToolRegistry } from './openSourceToolValidation';

export const OPEN_SOURCE_FIXTURE_TOOLS: readonly OpenSourceToolDefinition[] = [
  {
    toolName: 'fixture-image-metadata-adapter',
    toolVersion: '1.0.0',
    sourceUrl: 'internal://solarpro/fixtures/image-metadata-adapter',
    license: 'MIT',
    runtimeCategory: 'fixture_only',
    allowedCandidateTypes: ['orientation_candidate', 'photo_quality_candidate', 'duplicate_similarity_candidate'],
    allowedCandidateCategories: ['orientation', 'quality', 'duplicate_hygiene'],
    requiresImageBytes: false,
    requiresNativeBinaries: false,
    requiresModelWeights: false,
    browserCompatible: false,
    serverOnly: false,
    reviewRequired: true,
    canonicalMutationAllowed: false,
    allowedRuntimeBoundary: 'fixture_static',
    deterministicReplaySupport: 'fixture_replay_only',
    riskLevel: 'low',
    enabledStatus: 'enabled_for_fixtures',
    maintainedStatus: 'fixture_internal',
    registryNotes: ['Fixture-only metadata adapter. No image bytes are inspected.'],
  },
  {
    toolName: 'fixture-ocr-text-adapter',
    toolVersion: '1.0.0',
    sourceUrl: 'internal://solarpro/fixtures/ocr-text-adapter',
    license: 'MIT',
    runtimeCategory: 'fixture_only',
    allowedCandidateTypes: ['text_region_candidate'],
    allowedCandidateCategories: ['field_context', 'electrical_context'],
    requiresImageBytes: false,
    requiresNativeBinaries: false,
    requiresModelWeights: false,
    browserCompatible: false,
    serverOnly: false,
    reviewRequired: true,
    canonicalMutationAllowed: false,
    allowedRuntimeBoundary: 'fixture_static',
    deterministicReplaySupport: 'fixture_replay_only',
    riskLevel: 'moderate',
    enabledStatus: 'enabled_for_fixtures',
    maintainedStatus: 'fixture_internal',
    registryNotes: ['Fixture-only OCR-like text adapter. No OCR runtime is executed.'],
  },
] as const;

export const OPEN_SOURCE_RUNTIME_TOOLS: readonly OpenSourceToolDefinition[] = [
  {
    toolName: 'sharp-metadata-runtime',
    toolVersion: '0.34.5',
    sourceUrl: 'https://github.com/lovell/sharp',
    license: 'Apache-2.0',
    runtimeCategory: 'image_metadata',
    allowedCandidateTypes: ['orientation_candidate', 'photo_quality_candidate', 'duplicate_similarity_candidate'],
    allowedCandidateCategories: ['orientation', 'quality', 'duplicate_hygiene'],
    requiresImageBytes: true,
    requiresNativeBinaries: true,
    requiresModelWeights: false,
    browserCompatible: false,
    serverOnly: true,
    reviewRequired: true,
    canonicalMutationAllowed: false,
    allowedRuntimeBoundary: 'server_adapter_contract',
    deterministicReplaySupport: 'runtime_payload_hash_required',
    riskLevel: 'low',
    enabledStatus: 'enabled_for_runtime_pilot',
    maintainedStatus: 'maintained',
    registryNotes: [
      'First controlled runtime pilot for metadata and photo quality extraction only.',
      'Uses sharp metadata APIs only; excluded capabilities remain outside this pilot by boundary policy.',
      'Runtime execution is server-only and adapter-contained.',
    ],
  },
] as const;

export const OPEN_SOURCE_ASSISTED_EVIDENCE_TOOLS: readonly OpenSourceToolDefinition[] = [
  ...OPEN_SOURCE_FIXTURE_TOOLS,
  ...OPEN_SOURCE_RUNTIME_TOOLS,
] as const;

export const VALIDATED_OPEN_SOURCE_FIXTURE_TOOLS: readonly ValidatedOpenSourceToolDefinition[] = validateOpenSourceToolRegistry(OPEN_SOURCE_FIXTURE_TOOLS);
export const VALIDATED_OPEN_SOURCE_RUNTIME_TOOLS: readonly ValidatedOpenSourceToolDefinition[] = validateOpenSourceToolRegistry(OPEN_SOURCE_RUNTIME_TOOLS);
export const VALIDATED_OPEN_SOURCE_ASSISTED_EVIDENCE_TOOLS: readonly ValidatedOpenSourceToolDefinition[] = validateOpenSourceToolRegistry(OPEN_SOURCE_ASSISTED_EVIDENCE_TOOLS);

export function getRegisteredOpenSourceTool(toolName: string, toolVersion: string): ValidatedOpenSourceToolDefinition {
  const tool = VALIDATED_OPEN_SOURCE_ASSISTED_EVIDENCE_TOOLS.find(candidate => candidate.toolName === toolName && candidate.toolVersion === toolVersion);
  if (!tool) throw new Error(`Unregistered open-source assisted evidence tool cannot execute: ${toolName}@${toolVersion}.`);
  return tool;
}

export function assertToolCanEmitCandidateType(tool: ValidatedOpenSourceToolDefinition, candidateType: string): true {
  if (!tool.allowedCandidateTypes.includes(candidateType as never)) {
    throw new Error(`${tool.toolName}@${tool.toolVersion} cannot emit candidate type ${candidateType}.`);
  }
  return true;
}
