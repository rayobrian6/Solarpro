import type { CADModel, CADSystemType } from './types';
import { validatePlanSet, type ValidationResult } from '@/lib/drafting/validation';

export type CADModelExportSchemaVersion = 'cad_model_export_bundle_v1';
export type CADModelExportPersistenceMode = 'deterministic_dto_only_v1';
export type CADModelExportUnits = 'meters_local_xy';

export interface CADModelExportInput {
  exportedAt: string;
  exportedBy: string;
  exportReason?: string;
  sourceProjectId?: string | null;
  sourceSurveyId?: string | null;
  sourceCadRunId?: string | null;
  sourcePlanSetId?: string | null;
}

export interface CADModelExportAuthorityFlags {
  persistenceAllowed: false;
  solverExecutionAllowed: false;
  cadMutationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  planSetMutationAllowed: false;
  engineeringInfluenceAllowed: false;
  necInfluenceAllowed: false;
  bomInfluenceAllowed: false;
  routeInfluenceAllowed: false;
  workflowInfluenceAllowed: false;
  recommendationInfluenceAllowed: false;
  thirdPartyCadAuthorityAllowed: false;
  downstreamAuthority: false;
}

export interface CADModelExportBundle {
  exportSchemaVersion: CADModelExportSchemaVersion;
  persistenceMode: CADModelExportPersistenceMode;
  cadModelVersion: string;
  systemType: CADSystemType;
  exportedAt: string;
  exportedBy: string;
  exportReason: string | null;
  sourceProjectId: string | null;
  sourceSurveyId: string | null;
  sourceCadRunId: string | null;
  sourcePlanSetId: string | null;
  units: CADModelExportUnits;
  modelSummary: {
    totalPanels: number;
    totalDcKw: number;
    panelWidthM: number;
    panelHeightM: number;
    originLat: number;
    originLng: number;
    bounds: CADModel['bounds'];
    dimensionCount: number;
    warningCount: number;
    hasRoof: boolean;
    hasGround: boolean;
    hasFence: boolean;
    obstructionCount: number;
    electricalNodeCount: number;
    conduitRouteCount: number;
  };
  validation: ValidationResult;
  sanitizedModelSnapshot: CADModel;
  authorityFlags: CADModelExportAuthorityFlags;
  exportHash: string;
  deterministicNotes: string[];
}

export const CAD_MODEL_EXPORT_AUTHORITY_FLAGS: CADModelExportAuthorityFlags = {
  persistenceAllowed: false,
  solverExecutionAllowed: false,
  cadMutationAllowed: false,
  canonicalGeometryMutationAllowed: false,
  planSetMutationAllowed: false,
  engineeringInfluenceAllowed: false,
  necInfluenceAllowed: false,
  bomInfluenceAllowed: false,
  routeInfluenceAllowed: false,
  workflowInfluenceAllowed: false,
  recommendationInfluenceAllowed: false,
  thirdPartyCadAuthorityAllowed: false,
  downstreamAuthority: false,
};

export function buildCADModelExportBundle(cad: CADModel, input: CADModelExportInput): CADModelExportBundle {
  assertExportMetadata(input);
  assertSupportedSystemType(cad?.systemType);
  assertFiniteCadScalars(cad);

  const validation = validatePlanSet(cad, cad.systemType);
  if (!validation.valid) {
    throw new Error(`CAD model export requires a valid solved CAD model: ${validation.errors.join('; ')}`);
  }

  const sanitizedModelSnapshot = sanitizeCADModel(cad);
  const bundleWithoutHash = {
    exportSchemaVersion: 'cad_model_export_bundle_v1' as const,
    persistenceMode: 'deterministic_dto_only_v1' as const,
    cadModelVersion: sanitizedModelSnapshot.version,
    systemType: sanitizedModelSnapshot.systemType,
    exportedAt: input.exportedAt.trim(),
    exportedBy: input.exportedBy.trim(),
    exportReason: normalizeOptional(input.exportReason),
    sourceProjectId: normalizeOptional(input.sourceProjectId),
    sourceSurveyId: normalizeOptional(input.sourceSurveyId),
    sourceCadRunId: normalizeOptional(input.sourceCadRunId),
    sourcePlanSetId: normalizeOptional(input.sourcePlanSetId),
    units: 'meters_local_xy' as const,
    modelSummary: summarizeModel(sanitizedModelSnapshot),
    validation,
    sanitizedModelSnapshot,
    authorityFlags: CAD_MODEL_EXPORT_AUTHORITY_FLAGS,
    deterministicNotes: [
      'CAD model export bundle is a deterministic DTO-only handoff boundary for CAD artifact adapters.',
      'The export does not execute the CAD solver, persist artifacts, mutate the CAD model, mutate canonical geometry, or mutate plan-set output.',
      'Open-source CAD libraries may consume this bundle as rendering/export adapters only and do not become geometry, engineering, NEC, BOM, routing, workflow, recommendation, or permit authority.',
      'The sanitized model snapshot preserves solved local XY CAD geometry and removes unsupported non-JSON values before hashing.',
    ],
  } satisfies Omit<CADModelExportBundle, 'exportHash'>;

  return {
    ...bundleWithoutHash,
    exportHash: deterministicHash(bundleWithoutHash),
  };
}

function assertExportMetadata(input: CADModelExportInput): void {
  if (!input.exportedAt || input.exportedAt.trim().length === 0) throw new Error('CAD model export requires exportedAt metadata.');
  if (!input.exportedBy || input.exportedBy.trim().length === 0) throw new Error('CAD model export requires exportedBy metadata.');
}

function assertSupportedSystemType(systemType: unknown): asserts systemType is CADSystemType {
  if (systemType !== 'roof' && systemType !== 'ground_mount' && systemType !== 'solar_fence') {
    throw new Error('CAD model export requires systemType to be roof, ground_mount, or solar_fence.');
  }
}

function assertFiniteCadScalars(cad: CADModel | null | undefined): void {
  if (!cad) throw new Error('CAD model export requires a solved CAD model.');
  const scalarChecks: Array<[string, unknown]> = [
    ['totalPanels', cad.totalPanels],
    ['totalDcKw', cad.totalDcKw],
    ['panelWidthM', cad.panelWidthM],
    ['panelHeightM', cad.panelHeightM],
    ['originLat', cad.originLat],
    ['originLng', cad.originLng],
    ['bounds.minX', cad.bounds?.minX],
    ['bounds.minY', cad.bounds?.minY],
    ['bounds.maxX', cad.bounds?.maxX],
    ['bounds.maxY', cad.bounds?.maxY],
  ];

  for (const [label, value] of scalarChecks) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`CAD model export requires finite ${label}.`);
  }
}

function summarizeModel(cad: CADModel): CADModelExportBundle['modelSummary'] {
  return {
    totalPanels: cad.totalPanels,
    totalDcKw: cad.totalDcKw,
    panelWidthM: cad.panelWidthM,
    panelHeightM: cad.panelHeightM,
    originLat: cad.originLat,
    originLng: cad.originLng,
    bounds: cad.bounds,
    dimensionCount: cad.dimensions.length,
    warningCount: cad.warnings.length,
    hasRoof: Boolean(cad.roof),
    hasGround: Boolean(cad.ground),
    hasFence: Boolean(cad.fence),
    obstructionCount: cad.obstructions?.length ?? 0,
    electricalNodeCount: cad.electricalNodes?.length ?? 0,
    conduitRouteCount: cad.conduitRoutes?.length ?? 0,
  };
}

function sanitizeCADModel(cad: CADModel): CADModel {
  return sanitizeJsonValue(cad) as CADModel;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CAD model export cannot serialize non-finite numeric values.');
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b))) {
      const sanitized = sanitizeJsonValue((value as Record<string, unknown>)[key]);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
  }
  return undefined;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function deterministicHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = stableStringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
