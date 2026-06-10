// ============================================================================
// lib/siteSurveys/unifiedGeometry/canonicalToPermit.ts
//
// Maps an authoritative CanonicalBuildingModel's roof planes into the shape the
// permit planset consumes (PermitInput.project.roofPlanes — lat/lng vertices +
// pitch/azimuth/area/edgeTypes). Roadmap Phase 1: survey→canonical→planset.
//
// Pure + dependency-free so the mapping and the "is this model authoritative
// enough to drive the planset?" decision are unit-testable without a DB or the
// permit route. The permit route uses these to OVERRIDE design-body / placeholder
// roof planes ONLY when a promoted model exists — otherwise it's a no-op.
// ============================================================================

import type { CanonicalBuildingModel } from './types';

/** Permit planset roof plane (subset of PermitInput.project.roofPlanes). */
export interface PermitRoofPlane {
  id: string;
  vertices: { lat: number; lng: number }[];
  pitch?: number;
  azimuth?: number;
  area?: number;
  edgeTypes?: string[];
  source?: string;
  confirmed?: boolean;
}

/**
 * Whether a canonical model is authoritative enough to drive the planset.
 * Only promoted_canonical / cad_safe models qualify (operator-approved); raw or
 * review-only models must NOT override design geometry.
 */
export function isCanonicalUsableForPlanset(
  model: CanonicalBuildingModel | null | undefined,
): model is CanonicalBuildingModel {
  if (!model) return false;
  const s = model.authority.state;
  return s === 'promoted_canonical' || s === 'cad_safe';
}

/**
 * Map an authoritative canonical model's roof planes to permit roofPlanes.
 * Drops degraded planes and planes lacking a usable world (lat/lng) polygon —
 * the planset must never receive fabricated/placeholder geometry.
 *
 * Returns [] if the model has no usable roof planes; the caller then leaves the
 * existing (design/survey) roof planes untouched.
 */
export function canonicalToPermitRoofPlanes(
  model: CanonicalBuildingModel,
): PermitRoofPlane[] {
  return model.roofPlanes
    .filter(
      (p) =>
        !p.degradedNoGeometry &&
        p.worldPolygon != null &&
        Array.isArray(p.worldPolygon.vertices) &&
        p.worldPolygon.vertices.length >= 3,
    )
    .map((p) => ({
      id: p.id,
      vertices: p.worldPolygon!.vertices,
      pitch: p.pitchDegrees,
      azimuth: p.azimuthDegrees,
      area: p.areaSqM,
      edgeTypes: p.worldPolygon!.edgeTypes,
      source: 'aerial', // authoritative aerial/Solar geometry
      confirmed: true, // promoted_canonical = operator-approved
    }));
}
