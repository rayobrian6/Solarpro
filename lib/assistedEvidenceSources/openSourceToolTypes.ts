import type { AssistedEvidenceCandidateCategory, AssistedEvidenceCandidateType } from '@/lib/assistedEvidence';

export type OpenSourceToolLicensePosture = 'approved' | 'caution' | 'blocked';

export type OpenSourceRuntimeCategory =
  | 'fixture_only'
  | 'image_metadata'
  | 'ocr_text_candidate'
  | 'visual_categorization_candidate'
  | 'future_geometry_placeholder';

export type OpenSourceRuntimeBoundary = 'fixture_static' | 'server_adapter_contract' | 'browser_adapter_contract' | 'blocked_future_geometry';

export type OpenSourceToolRiskLevel = 'low' | 'moderate' | 'high' | 'blocked';

export type OpenSourceToolEnabledStatus = 'enabled_for_fixtures' | 'enabled_for_runtime_pilot' | 'disabled_pending_runtime_review' | 'blocked';

export type DeterministicReplaySupport = 'fixture_replay_only' | 'runtime_payload_hash_required' | 'blocked_not_replayable';

export interface OpenSourceToolDefinition {
  toolName: string;
  toolVersion: string;
  sourceUrl: string;
  license: string;
  runtimeCategory: OpenSourceRuntimeCategory;
  allowedCandidateTypes: AssistedEvidenceCandidateType[];
  allowedCandidateCategories: AssistedEvidenceCandidateCategory[];
  requiresImageBytes: boolean;
  requiresNativeBinaries: boolean;
  requiresModelWeights: boolean;
  browserCompatible: boolean;
  serverOnly: boolean;
  reviewRequired: true;
  canonicalMutationAllowed: false;
  allowedRuntimeBoundary: OpenSourceRuntimeBoundary;
  deterministicReplaySupport: DeterministicReplaySupport;
  riskLevel: OpenSourceToolRiskLevel;
  enabledStatus: OpenSourceToolEnabledStatus;
  maintainedStatus: 'maintained' | 'fixture_internal' | 'abandoned' | 'unknown';
  registryNotes: string[];
}

export interface ValidatedOpenSourceToolDefinition extends OpenSourceToolDefinition {
  licensePosture: OpenSourceToolLicensePosture;
}
