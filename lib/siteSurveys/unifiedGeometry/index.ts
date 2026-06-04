// ============================================================================
// lib/siteSurveys/unifiedGeometry/index.ts
//
// Barrel export for the Unified Geometry module.
//
// This is the SINGLE entry point for all unified geometry types, authority
// contracts, bundle builders, pipeline adapters, and promotion workflows.
//
// All downstream consumers import from this module:
//   import { ... } from '@/lib/siteSurveys/unifiedGeometry';
// ============================================================================

// ─── Authority ──────────────────────────────────────────────────────────────
export type {
  UnifiedGeometryAuthorityState,
  UnifiedGeometryAuthority,
} from './authority';

export {
  VALID_AUTHORITY_TRANSITIONS,
  AUTHORITY_LEVEL,
  RAW_EVIDENCE_AUTHORITY,
  DERIVED_REVIEW_ONLY_AUTHORITY,
  REVIEWED_CANDIDATE_AUTHORITY,
  PROMOTED_CANONICAL_AUTHORITY,
  CAD_SAFE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
  getAuthorityForState,
  isValidAuthorityTransition,
  isCadConsumable,
  canTriggerPermitGeneration,
  canTriggerBomMutation,
  assertNoCadMutation,
} from './authority';

// ─── Canonical Types ────────────────────────────────────────────────────────
export type {
  GeometryCoordinateSystem,
  GeometryPoint2D,
  GeometryPolygon,
  GeometryBBox,
  GeometryLineSegment,
  GeometryNormalVector,
  UnifiedGeometryClass,
  RoofLineSubtype,
  ObstructionSubtype,
  ElectricalNodeSubtype,
  PlaneType,
  GeometrySourcePipeline,
  GeometryProvenance,
  UnifiedGeometryArtifact,
  ObstructionCadImpact,
  ObstructionMetadata,
  UnifiedGeometryEvidenceBundle,
  GeometryIntelligenceSummary,
  GeometryPromotionRecord,
  CanonicalBuildingModel,
  CanonicalRoofPlane,
  CanonicalWallPlane,
  CanonicalObstruction,
  CanonicalElectricalNode,
  CanonicalStructuralLine,
  CanonicalBuildingMetadata,
} from './types';

// ─── Pipeline Adapters ─────────────────────────────────────────────────────
export {
  adaptPhotoVisionCandidate,
  adaptGeometryReconArtifact,
  adaptGeometryCandidateSignal,
  adaptPhotoVisionBundle,
  adaptGeometryReconBundle,
} from './pipelineAdapters';

// ─── Bundle Builder ─────────────────────────────────────────────────────────
export {
  BundleBuilder,
  buildUnifiedEvidenceBundle,
} from './bundleBuilder';

export type {
  BundleBuilderConfig,
} from './bundleBuilder';

// ─── Promotion Workflow ─────────────────────────────────────────────────────
export {
  promoteArtifact,
  promoteToDerivedReviewOnly,
  promoteToReviewedCandidate,
  promoteToCanonical,
  promoteToCadSafe,
  promoteArtifacts,
  reviewArtifact,
  assertCadConsumable,
  assertCanonicalEligible,
  canPromote,
  PromotionError,
} from './promotion';

export type {
  PromotionResult,
  BatchPromotionResult,
} from './promotion';

// ─── Promotion Store ────────────────────────────────────────────────────────
export {
  insertPromotionRecord,
  insertPromotionRecords,
  getPromotionHistoryForArtifact,
  getPromotionRecordsForSurvey,
  getPromotionRecordsByUser,
  getPromotionCountsByState,
} from './promotionStore';

// ── Unified Artifact Store ─────────────────────────────────────────────────────────
export {
  getUnifiedArtifactsForSurvey,
  writeObstructionArtifact,
  writeUnifiedArtifact,
  writeUnifiedArtifacts,
  deleteUnifiedArtifactsByPipeline,
  deleteUnifiedArtifactsBySurvey,
} from './unifiedArtifactStore';

// ── Canonical Builder ────────────────────────────────────────────────────────
export {
  CanonicalModelBuilder,
  buildCanonicalModel,
  CanonicalBuilderError,
} from './canonicalBuilder';

export type {
  CanonicalBuilderConfig,
} from './canonicalBuilder';
