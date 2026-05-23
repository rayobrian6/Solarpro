import { classifyLicensePosture, licenseIsBlocked } from './openSourceToolLicenses';
import type { OpenSourceToolDefinition, ValidatedOpenSourceToolDefinition } from './openSourceToolTypes';

function assertNonEmptyString(value: string, field: string): void {
  if (!value || !value.trim()) throw new Error(`Open-source tool registry metadata is missing required field: ${field}.`);
}

export function validateOpenSourceToolDefinition(tool: OpenSourceToolDefinition): ValidatedOpenSourceToolDefinition {
  assertNonEmptyString(tool.toolName, 'toolName');
  assertNonEmptyString(tool.toolVersion, 'toolVersion');
  assertNonEmptyString(tool.sourceUrl, 'sourceUrl');
  assertNonEmptyString(tool.license, 'license');

  if (tool.reviewRequired !== true) throw new Error(`${tool.toolName} must be review-required.`);
  if (tool.canonicalMutationAllowed !== false) throw new Error(`${tool.toolName} cannot allow canonical mutation.`);
  if (tool.allowedCandidateTypes.length === 0) throw new Error(`${tool.toolName} must declare at least one allowed candidate type.`);
  if (tool.allowedCandidateCategories.length === 0) throw new Error(`${tool.toolName} must declare at least one allowed candidate category.`);
  if (licenseIsBlocked(tool.license)) throw new Error(`${tool.toolName} uses a blocked or unknown license posture.`);
  if (tool.maintainedStatus === 'abandoned' || tool.maintainedStatus === 'unknown') throw new Error(`${tool.toolName} is not allowed because maintenance status is ${tool.maintainedStatus}.`);
  if (tool.riskLevel === 'blocked' || tool.enabledStatus === 'blocked') throw new Error(`${tool.toolName} is blocked by registry risk policy.`);
  if (tool.runtimeCategory === 'visual_categorization_candidate') {
    if (tool.allowedRuntimeBoundary !== 'server_adapter_contract') throw new Error(`${tool.toolName} visual categorization runtime must use the server adapter contract boundary.`);
    if (tool.enabledStatus !== 'enabled_for_runtime_pilot') throw new Error(`${tool.toolName} visual categorization runtime must be explicitly enabled for runtime pilot execution.`);
    if (!tool.serverOnly) throw new Error(`${tool.toolName} visual categorization runtime must be server-only.`);
    if (tool.browserCompatible) throw new Error(`${tool.toolName} visual categorization runtime pilot must not be browser-executed.`);
    if (tool.requiresNativeBinaries) throw new Error(`${tool.toolName} visual categorization runtime cannot require native binaries.`);
    if (tool.requiresModelWeights) throw new Error(`${tool.toolName} visual categorization runtime cannot require model weights.`);
    if (!tool.allowedCandidateTypes.every(type => type === 'visual_category_candidate')) throw new Error(`${tool.toolName} visual categorization runtime may emit visual_category_candidate only.`);
  }
  if (tool.runtimeCategory === 'geometry_adjacency_candidate') {
    if (tool.allowedRuntimeBoundary !== 'server_adapter_contract') throw new Error(`${tool.toolName} geometry adjacency runtime must use the server adapter contract boundary.`);
    if (tool.enabledStatus !== 'enabled_for_runtime_pilot') throw new Error(`${tool.toolName} geometry adjacency runtime must be explicitly enabled for runtime pilot execution.`);
    if (!tool.serverOnly) throw new Error(`${tool.toolName} geometry adjacency runtime must be server-only.`);
    if (tool.browserCompatible) throw new Error(`${tool.toolName} geometry adjacency runtime pilot must not be browser-executed.`);
    if (tool.requiresNativeBinaries) throw new Error(`${tool.toolName} geometry adjacency runtime cannot require native binaries.`);
    if (tool.requiresModelWeights) throw new Error(`${tool.toolName} geometry adjacency runtime cannot require model weights.`);
    if (tool.deterministicReplaySupport !== 'runtime_payload_hash_required') throw new Error(`${tool.toolName} geometry adjacency runtime must require runtime payload hash replay support.`);
    if (!tool.allowedCandidateTypes.every(type => type === 'possible_obstruction_candidate')) throw new Error(`${tool.toolName} geometry adjacency runtime may emit possible_obstruction_candidate only.`);
    if (!tool.allowedCandidateCategories.every(category => category === 'roof_context')) throw new Error(`${tool.toolName} geometry adjacency runtime may emit roof_context candidates only.`);
  }
  if (tool.requiresNativeBinaries && tool.runtimeCategory !== 'fixture_only' && tool.runtimeCategory !== 'image_metadata') throw new Error(`${tool.toolName} requires unapproved native binaries.`);
  if (tool.requiresModelWeights && tool.runtimeCategory !== 'fixture_only') throw new Error(`${tool.toolName} requires unapproved model weights.`);
  if ((tool.runtimeCategory === 'image_metadata' || tool.runtimeCategory === 'ocr_text_candidate') && tool.allowedRuntimeBoundary !== 'server_adapter_contract') throw new Error(`${tool.toolName} runtime must use the server adapter contract boundary.`);
  if ((tool.runtimeCategory === 'image_metadata' || tool.runtimeCategory === 'ocr_text_candidate') && tool.enabledStatus !== 'enabled_for_runtime_pilot') throw new Error(`${tool.toolName} runtime must be explicitly enabled for runtime pilot execution.`);
  if ((tool.runtimeCategory === 'image_metadata' || tool.runtimeCategory === 'ocr_text_candidate') && !tool.serverOnly) throw new Error(`${tool.toolName} runtime must be server-only.`);
  if ((tool.runtimeCategory === 'image_metadata' || tool.runtimeCategory === 'ocr_text_candidate') && tool.requiresModelWeights) throw new Error(`${tool.toolName} runtime cannot require model weights.`);
  if (tool.runtimeCategory === 'ocr_text_candidate' && !tool.allowedCandidateTypes.every(type => type === 'text_region_candidate')) throw new Error(`${tool.toolName} OCR runtime may emit text_region_candidate only.`);
  if (tool.runtimeCategory === 'ocr_text_candidate' && tool.browserCompatible) throw new Error(`${tool.toolName} OCR runtime pilot must not be browser-executed.`);
  if (tool.allowedRuntimeBoundary === 'blocked_future_geometry') throw new Error(`${tool.toolName} is assigned a blocked future geometry boundary.`);
  if (tool.runtimeCategory === 'future_geometry_placeholder') throw new Error(`${tool.toolName} future geometry runtime is not approved in this phase.`);

  return { ...tool, licensePosture: classifyLicensePosture(tool.license) };
}

export function validateOpenSourceToolRegistry(tools: readonly OpenSourceToolDefinition[]): ValidatedOpenSourceToolDefinition[] {
  const seen = new Set<string>();
  return tools.map(tool => {
    const key = `${tool.toolName}@${tool.toolVersion}`;
    if (seen.has(key)) throw new Error(`Duplicate open-source tool registration: ${key}.`);
    seen.add(key);
    return validateOpenSourceToolDefinition(tool);
  });
}
