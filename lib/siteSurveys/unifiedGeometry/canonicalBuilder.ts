// ============================================================================
// lib/siteSurveys/unifiedGeometry/canonicalBuilder.ts
//
// Canonical Building Model Builder — constructs the CanonicalBuildingModel
// (the SINGLE SOURCE OF TRUTH for building geometry) from promoted artifacts.
//
// NON-NEGOTIABLE:
//   1. Only promoted_canonical or cad_safe artifacts can feed this builder
//   2. Mock artifacts are BLOCKED from the canonical model
//   3. Every element in the model links back to its source artifact
//   4. The builder validates all inputs before constructing the model
//   5. The model's authority matches the minimum authority of its inputs
//   6. CanonicalObstruction.source is ALWAYS 'promoted_canonical' (no 'vision')
//   7. CanonicalElectricalNode.source is ALWAYS 'promoted_canonical'
// ============================================================================

import { v4 as uuid } from 'uuid';
import { AUTHORITY_LEVEL } from './authority';
import type { UnifiedGeometryAuthority, UnifiedGeometryAuthorityState } from './authority';
import { assertCanonicalEligible, assertNoContradictionBlock } from './promotion';
import type {
  UnifiedGeometryArtifact,
  CanonicalBuildingModel,
  CanonicalRoofPlane,
  CanonicalWallPlane,
  CanonicalObstruction,
  CanonicalElectricalNode,
  CanonicalStructuralLine,
  CanonicalBuildingMetadata,
  GeometryPolygon,
  GeometryPoint2D,
  GeometryNormalVector,
  GeometryLineSegment,
  ObstructionSubtype,
  ElectricalNodeSubtype,
  RoofLineSubtype,
  PlaneType,
} from './types';
import type { DepthContradictionReport } from '../geometryReconstruction/types';

// ─── Builder Configuration ──────────────────────────────────────────────────

export interface CanonicalBuilderConfig {
  /** Survey ID */
  surveyId: string;
  /** Default setback for eaves (meters) */
  defaultEaveSetbackM: number;
  /** Default setback for ridges (meters) */
  defaultRidgeSetbackM: number;
  /** Default setback for rakes (meters) */
  defaultRakeSetbackM: number;
  /** Depth-class contradiction reports (Phase 0, P0-4.2).
   *  When provided, the builder checks each artifact against these reports
   *  before adding it to the model. Artifacts with blocking contradictions
   *  (severity 'moderate' or 'major') are rejected when the
   *  PHASE0_CONTRADICTION_PROMOTION_GATE flag is active.
   *  Defaults to empty array (no contradiction checks). */
  contradictionReports?: DepthContradictionReport[];
}

const DEFAULT_CONFIG: CanonicalBuilderConfig = {
  surveyId: '',
  defaultEaveSetbackM: 0.35,
  defaultRidgeSetbackM: 0.15,
  defaultRakeSetbackM: 0.20,
};

// ─── Builder Error ──────────────────────────────────────────────────────────

export class CanonicalBuilderError extends Error {
  constructor(message: string) {
    super(`[CANONICAL_BUILDER_ERROR] ${message}`);
    this.name = 'CanonicalBuilderError';
  }
}

// ─── Canonical Building Model Builder ───────────────────────────────────────

/**
 * Builder for CanonicalBuildingModel.
 *
 * Usage:
 *   const model = new CanonicalModelBuilder({ surveyId: 'survey-123' })
 *     .addArtifact(roofPlane1)
 *     .addArtifact(roofPlane2)
 *     .addArtifact(obstruction1)
 *     .addArtifacts(moreArtifacts)
 *     .build();
 */
export class CanonicalModelBuilder {
  private readonly config: CanonicalBuilderConfig;
  private readonly artifacts: UnifiedGeometryArtifact[] = [];
  private readonly promotionRecordIds: string[] = [];
  private readonly contradictionReports: DepthContradictionReport[];

  constructor(config: Partial<CanonicalBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.surveyId) {
      throw new CanonicalBuilderError('surveyId is required');
    }
    this.contradictionReports = config.contradictionReports ?? [];
  }

  /**
   * Add a promoted artifact to the model.
   * Only promoted_canonical or cad_safe artifacts are accepted.
   * Mock artifacts are always rejected.
   *
   * Phase 0 (P0-4.2): When PHASE0_CONTRADICTION_PROMOTION_GATE is active,
   * artifacts with blocking depth contradictions (severity 'moderate' or
   * 'major') are rejected from the canonical model. This prevents geometry
   * derived from contradicted depth estimates from contaminating the
   * CanonicalBuildingModel and CAD output.
   */
  addArtifact(artifact: UnifiedGeometryArtifact): this {
    // Validate authority — must be promoted_canonical or cad_safe
    assertCanonicalEligible(artifact);

    // Phase 0 (P0-4.2): Contradiction-aware promotion gate
    // Check artifact against contradiction reports before adding.
    // When the flag is OFF, this is a no-op (assertNoContradictionBlock
    // returns immediately). When the flag is ON, artifacts with blocking
    // contradictions are rejected with CANONICAL_MODEL_VIOLATION.
    assertNoContradictionBlock(artifact, this.contradictionReports);

    // Validate survey ID consistency
    if (artifact.surveyId !== this.config.surveyId) {
      throw new CanonicalBuilderError(
        `Artifact surveyId '${artifact.surveyId}' does not match builder surveyId '${this.config.surveyId}'`,
      );
    }

    this.artifacts.push(artifact);
    return this;
  }

  /**
   * Add multiple promoted artifacts.
   */
  addArtifacts(artifacts: UnifiedGeometryArtifact[]): this {
    for (const artifact of artifacts) {
      this.addArtifact(artifact);
    }
    return this;
  }

  /**
   * Add promotion record IDs for provenance tracking.
   */
  addPromotionRecordIds(ids: string[]): this {
    this.promotionRecordIds.push(...ids);
    return this;
  }

  /**
   * Build the CanonicalBuildingModel from the added artifacts.
   *
   * Groups artifacts by geometry class and constructs the appropriate
   * canonical types for each group.
   */
  build(): CanonicalBuildingModel {
    if (this.artifacts.length === 0) {
      throw new CanonicalBuilderError(
        'Cannot build CanonicalBuildingModel with no artifacts. ' +
        'Add at least one promoted_canonical or cad_safe artifact.',
      );
    }

    // Group by geometry class
    const roofPlanes = this.artifacts.filter(a => a.geometryClass === 'roof_plane');
    const wallPlanes = this.artifacts.filter(a => a.geometryClass === 'wall_plane');
    const obstructions = this.artifacts.filter(a => a.geometryClass === 'obstruction');
    const electricalNodes = this.artifacts.filter(a => a.geometryClass === 'electrical_node');
    const roofLines = this.artifacts.filter(a => a.geometryClass === 'roof_line');
    const consensusPlanes = this.artifacts.filter(a => a.geometryClass === 'consensus_plane');

    // Build canonical types
    const canonicalRoofPlanes = roofPlanes.map(a => this.buildCanonicalRoofPlane(a));
    const canonicalWallPlanes = wallPlanes.map(a => this.buildCanonicalWallPlane(a));
    const canonicalObstructions = obstructions.map(a => this.buildCanonicalObstruction(a));
    const canonicalElectricalNodes = electricalNodes.map(a => this.buildCanonicalElectricalNode(a));
    const canonicalStructuralLines = roofLines.map(a => this.buildCanonicalStructuralLine(a));

    // Merge consensus planes into roof/wall planes
    // (consensus planes are multi-photo fusion results — treat as roof planes)
    for (const cp of consensusPlanes) {
      canonicalRoofPlanes.push(this.buildCanonicalRoofPlane(cp));
    }

    // Build metadata from available artifacts
    const metadata = this.buildMetadata(roofPlanes, wallPlanes);

    // Compute model authority = minimum authority of all input artifacts
    const modelAuthority = this.computeModelAuthority();

    // Build provenance
    const provenance = {
      artifactIds: this.artifacts.map(a => a.id),
      promotionRecordIds: this.promotionRecordIds,
      builtAt: new Date().toISOString(),
      builtBy: 'automated' as const,
    };

    return {
      schemaVersion: 'canonical_building_model_v1',
      surveyId: this.config.surveyId,
      authority: modelAuthority,
      roofPlanes: canonicalRoofPlanes,
      wallPlanes: canonicalWallPlanes,
      obstructions: canonicalObstructions,
      electricalNodes: canonicalElectricalNodes,
      structuralLines: canonicalStructuralLines,
      metadata,
      provenance,
    };
  }

  // ─── Private Builders ────────────────────────────────────────────────────

  private buildCanonicalRoofPlane(artifact: UnifiedGeometryArtifact): CanonicalRoofPlane {
    // Use polygon if available; otherwise construct from bbox
    const polygon = artifact.polygon ?? this.inferPolygonFromBBox(artifact);

    // Phase 1: authoritative real-world (lat/lng) outline from aerial/Solar or an
    // operator trace. This is the geometry the permit planset actually consumes;
    // a plane that has it is NOT degraded even without an image-space polygon.
    const worldPolygon = artifact.worldPolygon ?? undefined;

    // CRITICAL: Do NOT silently fabricate a 100×100 placeholder polygon.
    // That garbage geometry would flow into CAD without any warning, producing
    // nonsensical panel layouts. Instead, mark the plane as degraded so
    // downstream consumers (CAD bridge, permit engine) can reject or flag it.
    if (!polygon && !worldPolygon) {
      console.error(
        `[CANONICAL_BUILDER] Roof plane artifact ${artifact.id} has no polygon, bbox, or worldPolygon — ` +
        'marking as degraded. Downstream consumers MUST NOT use this geometry for CAD/permit output.'
      );
    }

    return {
      id: uuid(),
      polygon: polygon ?? undefined,
      worldPolygon,
      degradedNoGeometry: !polygon && !worldPolygon,
      pitchDegrees: artifact.pitchDegrees ?? 0,
      azimuthDegrees: artifact.azimuthDegrees ?? 0,
      areaSqM: artifact.areaSqM ?? 0,
      normalVector: artifact.normalVector ?? { x: 0, y: 0, z: 1 },
      sourceArtifactId: artifact.id,
      setbackDefaults: {
        eaveM: this.config.defaultEaveSetbackM,
        ridgeM: this.config.defaultRidgeSetbackM,
        rakeM: this.config.defaultRakeSetbackM,
      },
    };
  }

  private buildCanonicalWallPlane(artifact: UnifiedGeometryArtifact): CanonicalWallPlane {
    const polygon = artifact.polygon ?? this.inferPolygonFromBBox(artifact);

    // Same as roof planes: do NOT silently fabricate placeholder geometry.
    if (!polygon) {
      console.error(
        `[CANONICAL_BUILDER] Wall plane artifact ${artifact.id} has neither polygon nor bbox — ` +
        'marking as degraded. Downstream consumers MUST NOT use this geometry for CAD/permit output.'
      );
    }

    return {
      id: uuid(),
      polygon: polygon ?? undefined,
      degradedNoGeometry: !polygon,
      estimatedHeightM: null,
      facingDirection: null,
      sourceArtifactId: artifact.id,
    };
  }

  private buildCanonicalObstruction(artifact: UnifiedGeometryArtifact): CanonicalObstruction {
    // CRITICAL: source is ALWAYS 'promoted_canonical' — never 'vision' or 'manual'
    // This is the key fix for the CADObstruction.source='vision' bypass
    return {
      id: uuid(),
      type: artifact.obstructionSubtype ?? 'unknown_obstruction',
      center: artifact.center ?? (artifact.bbox
        ? { x: artifact.bbox.x + artifact.bbox.width / 2, y: artifact.bbox.y + artifact.bbox.height / 2, coordinateSystem: 'normalized_image_0_1000' as const }
        : { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' as const }),
      radiusM: artifact.radiusM ?? 0.3,
      setbackM: artifact.setbackM ?? 0.15,
      totalRadiusM: (artifact.radiusM ?? 0.3) + (artifact.setbackM ?? 0.15),
      heightFt: artifact.heightFt ?? 1,
      roofPlaneId: artifact.roofPlaneId,
      source: 'promoted_canonical', // ONLY this value — no 'vision' or 'manual'
      confidence: artifact.confidence,
      sourceArtifactId: artifact.id,
      cadImpact: artifact.cadImpact,
    };
  }

  private buildCanonicalElectricalNode(artifact: UnifiedGeometryArtifact): CanonicalElectricalNode {
    // CRITICAL: source is ALWAYS 'promoted_canonical' — never 'vision' or 'manual'
    return {
      id: uuid(),
      type: artifact.electricalSubtype ?? 'unknown_electrical',
      center: artifact.center ?? (artifact.bbox
        ? { x: artifact.bbox.x + artifact.bbox.width / 2, y: artifact.bbox.y + artifact.bbox.height / 2, coordinateSystem: 'normalized_image_0_1000' as const }
        : { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' as const }),
      story: artifact.story ?? 1,
      isPrimaryInterconnect: artifact.isPrimaryInterconnect ?? false,
      source: 'promoted_canonical', // ONLY this value
      confidence: artifact.confidence,
      sourceArtifactId: artifact.id,
    };
  }

  private buildCanonicalStructuralLine(artifact: UnifiedGeometryArtifact): CanonicalStructuralLine {
    return {
      id: uuid(),
      lineSubtype: artifact.lineSubtype ?? 'ridge',
      lineSegment: artifact.lineSegment ?? {
        start: { x: 0, y: 0, coordinateSystem: 'normalized_image_0_1000' },
        end: { x: 100, y: 0, coordinateSystem: 'normalized_image_0_1000' },
        coordinateSystem: 'normalized_image_0_1000',
      },
      estimatedLengthM: artifact.estimatedLengthM,
      sourceArtifactId: artifact.id,
    };
  }

  private buildMetadata(
    roofPlanes: UnifiedGeometryArtifact[],
    wallPlanes: UnifiedGeometryArtifact[],
  ): CanonicalBuildingMetadata {
    // Infer roof type from the number of roof planes and their pitch
    const roofType = this.inferRoofType(roofPlanes);
    const primaryPitch = roofPlanes.length > 0
      ? roofPlanes.reduce((best, a) => (a.pitchDegrees ?? 0) > (best.pitchDegrees ?? 0) ? a : best, roofPlanes[0]).pitchDegrees
      : null;
    const primaryAzimuth = roofPlanes.length > 0
      ? roofPlanes.reduce((best, a) => (a.confidence) > (best.confidence) ? a : best, roofPlanes[0]).azimuthDegrees
      : null;

    return {
      buildingType: 'residential', // default — should be set by UI
      stories: 1, // default
      roofType,
      primaryPitchDegrees: primaryPitch,
      primaryAzimuthDegrees: primaryAzimuth,
      footprintAreaSqM: roofPlanes.reduce((sum, a) => sum + (a.areaSqM ?? 0), 0) || null,
      addressSnapshot: null,
      latitude: null,
      longitude: null,
    };
  }

  private inferRoofType(roofPlanes: UnifiedGeometryArtifact[]): CanonicalBuildingMetadata['roofType'] {
    if (roofPlanes.length === 0) return 'unknown';
    if (roofPlanes.length === 1) return 'shed';
    if (roofPlanes.length === 2) return 'gable';
    if (roofPlanes.length <= 4) return 'hip';
    return 'unknown'; // complex — needs human classification
  }

  private inferPolygonFromBBox(artifact: UnifiedGeometryArtifact): GeometryPolygon | null {
    if (!artifact.bbox) return null;
    const { x, y, width, height } = artifact.bbox;
    const cs = artifact.bbox.coordinateSystem;
    return {
      vertices: [
        { x, y, coordinateSystem: cs },
        { x: x + width, y, coordinateSystem: cs },
        { x: x + width, y: y + height, coordinateSystem: cs },
        { x, y: y + height, coordinateSystem: cs },
      ],
      coordinateSystem: cs,
    };
  }

  private computeModelAuthority(): UnifiedGeometryAuthority {
    let minLevel = Infinity;
    let minAuthority: UnifiedGeometryAuthority = {
      state: 'promoted_canonical',
      reviewOnly: false,
      nonAuthoritative: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: true,
      bomMutationAllowed: true,
      canonicalMutationAllowed: true,
      engineeringWorkflowMutationAllowed: true,
      mockArtifact: false,
      cadConsumable: false,
    };

    for (const artifact of this.artifacts) {
      const level = AUTHORITY_LEVEL[artifact.authority.state];
      if (level < minLevel) {
        minLevel = level;
        minAuthority = artifact.authority;
      }
    }

    return { ...minAuthority };
  }
}

// ─── Convenience Factory ────────────────────────────────────────────────────

/**
 * Build a CanonicalBuildingModel from an array of promoted artifacts.
 *
 * This is the primary entry point for the CAD engine to get building geometry.
 * All artifacts must be at promoted_canonical or cad_safe authority.
 *
 * Phase 0 (P0-4.2): When contradiction reports are provided and the
 * PHASE0_CONTRADICTION_PROMOTION_GATE flag is active, artifacts with
 * blocking depth contradictions are rejected from the model.
 */
export function buildCanonicalModel(
  surveyId: string,
  promotedArtifacts: UnifiedGeometryArtifact[],
  promotionRecordIds: string[] = [],
  config: Partial<CanonicalBuilderConfig> = {},
): CanonicalBuildingModel {
  return new CanonicalModelBuilder({ ...config, surveyId })
    .addArtifacts(promotedArtifacts)
    .addPromotionRecordIds(promotionRecordIds)
    .build();
}
