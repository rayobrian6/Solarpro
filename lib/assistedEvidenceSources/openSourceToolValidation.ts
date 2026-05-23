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
  if (tool.requiresNativeBinaries && tool.runtimeCategory !== 'fixture_only') throw new Error(`${tool.toolName} requires unapproved native binaries.`);
  if (tool.requiresModelWeights && tool.runtimeCategory !== 'fixture_only') throw new Error(`${tool.toolName} requires unapproved model weights.`);
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
