import { collectEngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import { buildDecisionAwareBOMMetadata, buildDecisionAwareSLDMetadata } from '@/lib/engineeringDecisionProvenance';
import {
  buildEngineeringStateRegistry,
  buildEngineeringStateSnapshot,
  buildEngineeringStateTimeline,
  buildEngineeringStateTransitionHistory,
  buildInvalidationTrigger,
  buildPersistentEngineeringStateGraph,
  buildSelectiveRegenerationPlan,
  diffEngineeringStateSnapshots,
  engineeringStateSnapshotReference,
  invalidateEngineeringState,
  runEngineeringStateAuditGuards,
  type EngineeringInvalidationResult,
  type EngineeringStateSnapshot,
  type PersistentEngineeringStateGraph,
  type SelectiveRegenerationPlan,
} from '@/lib/engineeringStateInvalidation';
import { getSiteSurveyFiles, getSiteSurveysByProject, type SiteSurvey, type SiteSurveyFile } from '@/lib/db-neon';
import { buildCADReadinessMetadata, type CADReadinessMetadataModel } from './cadReadiness';
import { buildDeterministicPhotoGrouping, type DeterministicPhotoGroupingModel } from './photoGrouping';
import { computeEngineeringInvalidationPropagation, type EngineeringInvalidationPropagationResult } from './invalidationEngine';
import { buildEngineeringRegenerationPlanV1, type EngineeringRegenerationPlanV1 } from './regenerationPlanner';
import { buildEngineeringSnapshotDeltaV1, type EngineeringSnapshotDeltaV1 } from './snapshotDelta';
import { buildStructuredEngineeringSignals } from './signalExtraction';
import type { StructuredEngineeringSignalSummary } from './signalTypes';
import { buildEngineeringIntelligenceWorkspace } from './workspace';
import type { BuildEngineeringIntelligenceWorkspaceInput, EngineeringIntelligenceWorkspaceModel } from './types';
import { buildSurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';
import { buildProjectSurveyEvidenceHygiene } from '@/lib/survey/evidence/sessionGrouping';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import type { EnrichedSiteSurvey, RawSurveyPayload, SurveyPhotoRef } from '@/lib/siteSurvey/types';

export interface ProjectEngineeringHydrationSource {
  survey: SiteSurvey;
  files: SiteSurveyFile[];
}

export interface HydratedProjectEngineeringState {
  projectId: string;
  generatedAt: string;
  source: 'project_surveys' | 'not_loaded';
  surveyCount: number;
  canonicalSurveyId: string | null;
  surveyEvidence: EngineeringSurveyEvidence | null;
  workspaceInput: BuildEngineeringIntelligenceWorkspaceInput;
  workspace: EngineeringIntelligenceWorkspaceModel;
  stateGraph: PersistentEngineeringStateGraph | null;
  snapshots: EngineeringStateSnapshot[];
  invalidationResult: EngineeringInvalidationResult | null;
  regenerationPlans: SelectiveRegenerationPlan[];
  invalidationPropagation: EngineeringInvalidationPropagationResult | null;
  regenerationPlanV1: EngineeringRegenerationPlanV1 | null;
  snapshotDelta: EngineeringSnapshotDeltaV1 | null;
  cadReadiness: CADReadinessMetadataModel;
  photoGrouping: DeterministicPhotoGroupingModel;
  structuredSignals: StructuredEngineeringSignalSummary;
  deterministicNotes: string[];
}

export async function hydrateProjectEngineeringIntelligenceFromDb(input: {
  projectId: string;
  userId: string;
  generatedAt?: string;
}): Promise<HydratedProjectEngineeringState> {
  try {
    const surveys = await getSiteSurveysByProject(input.projectId, input.userId);
    const sources = await Promise.all(surveys.map(async survey => ({ survey, files: await getSiteSurveyFiles(survey.id) })));
    return hydrateProjectEngineeringIntelligence({ projectId: input.projectId, sources, generatedAt: input.generatedAt });
  } catch (error) {
    const generatedAt = input.generatedAt ?? new Date(0).toISOString();
    const cadReadiness = buildCADReadinessMetadata({ projectId: input.projectId });
    const photoGrouping = buildDeterministicPhotoGrouping({
      projectId: input.projectId,
      readinessFlags: cadReadiness.flags,
      generatedAt,
    });
    const structuredSignals = buildStructuredEngineeringSignals({ projectId: input.projectId, photoGrouping, cadReadiness, generatedAt });
    const signalAwareCADReadiness = buildCADReadinessMetadata({ projectId: input.projectId, structuredSignals });
    const workspaceInput: BuildEngineeringIntelligenceWorkspaceInput = {
      projectId: input.projectId,
      cadReadiness: signalAwareCADReadiness,
      photoGrouping,
      structuredSignals,
    };
    const workspace = buildEngineeringIntelligenceWorkspace(workspaceInput);
    return {
      projectId: input.projectId,
      generatedAt,
      source: 'not_loaded',
      surveyCount: 0,
      canonicalSurveyId: null,
      surveyEvidence: null,
      workspaceInput,
      workspace,
      stateGraph: null,
      snapshots: [],
      invalidationResult: null,
      regenerationPlans: [],
      invalidationPropagation: null,
      regenerationPlanV1: null,
      snapshotDelta: null,
      cadReadiness: signalAwareCADReadiness,
      photoGrouping,
      structuredSignals,
      deterministicNotes: [
        `Project engineering hydration could not load DB survey state: ${(error as Error).message}`,
        'Workspace remains registry/empty-state rather than fabricating project engineering state.',
      ],
    };
  }
}

export function hydrateProjectEngineeringIntelligence(input: {
  projectId: string;
  sources: ProjectEngineeringHydrationSource[];
  generatedAt?: string;
}): HydratedProjectEngineeringState {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const sortedSources = [...input.sources].sort((a, b) => {
    const date = (b.survey.createdAt ?? '').localeCompare(a.survey.createdAt ?? '');
    return date || b.survey.id.localeCompare(a.survey.id);
  });

  if (!sortedSources.length) {
    const cadReadiness = buildCADReadinessMetadata({ projectId: input.projectId });
    const photoGrouping = buildDeterministicPhotoGrouping({
      projectId: input.projectId,
      readinessFlags: cadReadiness.flags,
      generatedAt,
    });
    const structuredSignals = buildStructuredEngineeringSignals({ projectId: input.projectId, photoGrouping, cadReadiness, generatedAt });
    const signalAwareCADReadiness = buildCADReadinessMetadata({ projectId: input.projectId, structuredSignals });
    const workspaceInput: BuildEngineeringIntelligenceWorkspaceInput = {
      projectId: input.projectId,
      cadReadiness: signalAwareCADReadiness,
      photoGrouping,
      structuredSignals,
    };
    const workspace = buildEngineeringIntelligenceWorkspace(workspaceInput);
    return {
      projectId: input.projectId,
      generatedAt,
      source: 'not_loaded',
      surveyCount: 0,
      canonicalSurveyId: null,
      surveyEvidence: null,
      workspaceInput,
      workspace,
      stateGraph: null,
      snapshots: [],
      invalidationResult: null,
      regenerationPlans: [],
      invalidationPropagation: null,
      regenerationPlanV1: null,
      snapshotDelta: null,
      cadReadiness: signalAwareCADReadiness,
      photoGrouping,
      structuredSignals,
      deterministicNotes: [
        'No project survey records were supplied for live engineering hydration.',
        'Workspace uses explicit registry/empty state and does not synthesize evidence, geometry, or stale state.',
      ],
    };
  }

  const hygiene = buildProjectSurveyEvidenceHygiene({ projectId: input.projectId, surveys: sortedSources, generatedAt });
  const canonicalSurveyId = hygiene.canonicalSurveyId ?? sortedSources[0].survey.id;
  const canonicalSource = sortedSources.find(source => source.survey.id === canonicalSurveyId) ?? sortedSources[0];
  const canonicalManifest = buildSurveyEvidenceManifest({ survey: canonicalSource.survey, files: canonicalSource.files, generatedAt });
  const surveyEvidence = collectEngineeringSurveyEvidence(surveyToEnriched(canonicalSource.survey, canonicalSource.files), {
    normalizedAt: generatedAt,
    canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest,
    evidenceDuplicateGroups: hygiene.evidenceDuplicateGroups,
    sessions: hygiene.sessions,
  });

  const documentProvenance = surveyEvidence.documentProvenance ?? null;
  const decisionProvenance = surveyEvidence.decisionProvenance ?? null;
  const bomMetadata = decisionProvenance ? buildDecisionAwareBOMMetadata({ bomItems: [], decisionBundle: decisionProvenance }) : [];
  const sldMetadata = decisionProvenance ? buildDecisionAwareSLDMetadata({ decisionBundle: decisionProvenance }) : null;
  const registry = buildEngineeringStateRegistry({
    registryId: `engineering-intelligence:${input.projectId}:registry`,
    generatedAt,
    documentProvenance,
    decisionProvenance,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    renderContextIds: ['renderContext:primary'],
    bomMetadata,
    sldMetadata,
  });
  const baselineGraph = buildPersistentEngineeringStateGraph({
    graphId: `engineering-intelligence:${input.projectId}:graph:baseline`,
    generatedAt,
    registry,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
  });
  const baselineSnapshot = buildEngineeringStateSnapshot({
    snapshotId: `engineering-intelligence:${input.projectId}:snapshot:baseline`,
    generatedAt,
    registry,
    stateGraph: baselineGraph,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    decisionProvenance,
  });

  const triggerEvidenceId = selectInvalidationEvidenceId(surveyEvidence);
  const invalidationResult = triggerEvidenceId
    ? invalidateEngineeringState({
        resultId: `engineering-intelligence:${input.projectId}:invalidation:latest-evidence`,
        generatedAt,
        registry,
        dependencyGraph: documentProvenance?.dependencyGraph ?? null,
        trigger: buildInvalidationTrigger({
          triggerId: `engineering-intelligence:${input.projectId}:trigger:latest-canonical-evidence`,
          triggerType: 'canonical_evidence_changed',
          changedCanonicalEvidenceIds: [triggerEvidenceId],
          triggeredAt: generatedAt,
          deterministicReason: `Latest canonical evidence ${triggerEvidenceId} is modeled as a selective invalidation trigger for planning visualization only.`,
        }),
      })
    : null;
  const updatedRegistry = invalidationResult
    ? { ...registry, stateRecords: invalidationResult.updatedStateRecords, stateIds: invalidationResult.updatedStateRecords.map(record => record.stateId).sort((a, b) => a.localeCompare(b)) }
    : registry;
  const stateGraph = buildPersistentEngineeringStateGraph({
    graphId: `engineering-intelligence:${input.projectId}:graph:latest`,
    generatedAt,
    registry: updatedRegistry,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    invalidationResult,
  });
  const latestSnapshot = buildEngineeringStateSnapshot({
    snapshotId: `engineering-intelligence:${input.projectId}:snapshot:latest`,
    generatedAt,
    registry: updatedRegistry,
    stateGraph,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    decisionProvenance,
    previousSnapshot: baselineSnapshot,
    invalidationResult,
  });
  const snapshots = [baselineSnapshot, latestSnapshot];
  const diffs = [diffEngineeringStateSnapshots(baselineSnapshot, latestSnapshot)];
  const regenerationPlan = invalidationResult
    ? buildSelectiveRegenerationPlan({
        planId: `engineering-intelligence:${input.projectId}:plan:latest`,
        generatedAt,
        invalidationResult,
        dependencyGraph: documentProvenance?.dependencyGraph ?? null,
        snapshotReference: engineeringStateSnapshotReference(latestSnapshot),
      })
    : null;
  const regenerationPlans = regenerationPlan ? [regenerationPlan] : [];
  const transitionHistory = buildEngineeringStateTransitionHistory({
    historyId: `engineering-intelligence:${input.projectId}:history`,
    generatedAt,
    snapshots,
    diffs,
    invalidationResults: invalidationResult ? [invalidationResult] : [],
  });
  const timeline = buildEngineeringStateTimeline(transitionHistory, snapshots);
  const auditGuards = runEngineeringStateAuditGuards({
    records: updatedRegistry.stateRecords,
    invalidationResult,
    regenerationPlan,
    persistentGraph: stateGraph,
    snapshots,
    diffs,
    renderOutputExpected: false,
  });
  const baseCADReadiness = buildCADReadinessMetadata({ projectId: input.projectId, surveyId: canonicalSurveyId, canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest, surveyEvidence });
  const photoGrouping = buildDeterministicPhotoGrouping({
    projectId: input.projectId,
    survey: canonicalSource.survey,
    canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest,
    sessions: hygiene.sessions,
    readinessFlags: baseCADReadiness.flags,
    generatedAt,
  });
  const preliminarySignals = buildStructuredEngineeringSignals({
    projectId: input.projectId,
    surveyId: canonicalSurveyId,
    canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest,
    surveyEvidence,
    photoGrouping,
    cadReadiness: baseCADReadiness,
    invalidationResult,
    generatedAt,
  });
  const cadReadiness = buildCADReadinessMetadata({ projectId: input.projectId, surveyId: canonicalSurveyId, canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest, surveyEvidence, structuredSignals: preliminarySignals });
  const invalidationPropagation = computeEngineeringInvalidationPropagation({
    propagationId: `engineering-intelligence:${input.projectId}:propagation:v1`,
    registry: updatedRegistry,
    invalidationResult,
    dependencyGraph: documentProvenance?.dependencyGraph ?? null,
    persistentGraph: stateGraph,
    snapshots,
    cadReadiness,
  });
  const structuredSignals = buildStructuredEngineeringSignals({
    projectId: input.projectId,
    surveyId: canonicalSurveyId,
    canonicalManifest: hygiene.canonicalManifest ?? canonicalManifest,
    surveyEvidence,
    photoGrouping,
    cadReadiness,
    invalidationResult,
    invalidationPropagation,
    generatedAt,
  });
  const regenerationPlanV1 = buildEngineeringRegenerationPlanV1({
    planId: `engineering-intelligence:${input.projectId}:regeneration-plan:v1`,
    propagation: invalidationPropagation,
    existingPlans: regenerationPlans,
  });
  const snapshotDelta = buildEngineeringSnapshotDeltaV1({
    deltaId: `engineering-intelligence:${input.projectId}:snapshot-delta:v1`,
    previousSnapshot: baselineSnapshot,
    nextSnapshot: latestSnapshot,
    snapshotDiffs: diffs,
    previousGraph: baselineGraph,
    nextGraph: stateGraph,
    propagation: invalidationPropagation,
    cadReadiness,
  });
  const workspaceInput: BuildEngineeringIntelligenceWorkspaceInput = {
    projectId: input.projectId,
    surveyEvidence,
    cadReadiness,
    photoGrouping,
    structuredSignals,
    invalidationResult,
    snapshots,
    snapshotDiffs: diffs,
    transitionHistory,
    timeline,
    persistentGraph: stateGraph,
    regenerationPlans,
    invalidationPropagation,
    regenerationPlanV1,
    snapshotDelta,
    auditGuards,
  };
  const workspace = buildEngineeringIntelligenceWorkspace(workspaceInput);

  return {
    projectId: input.projectId,
    generatedAt,
    source: 'project_surveys',
    surveyCount: sortedSources.length,
    canonicalSurveyId,
    surveyEvidence,
    workspaceInput,
    workspace,
    stateGraph,
    snapshots,
    invalidationResult,
    regenerationPlans,
    invalidationPropagation,
    regenerationPlanV1,
    snapshotDelta,
    cadReadiness,
    photoGrouping,
    structuredSignals,
    deterministicNotes: [
      `Hydrated from ${sortedSources.length} project survey session(s) and canonical survey ${canonicalSurveyId}.`,
      'Canonical evidence, requirement evaluation, provenance, graph, snapshots, invalidation events, and regeneration plans are derived from deterministic project survey metadata.',
      'Selective invalidation and regeneration planning are metadata visualizations only; no autonomous regeneration is triggered.',
    ],
  };
}

function selectInvalidationEvidenceId(evidence: EngineeringSurveyEvidence): string | null {
  const electrical = evidence.requirementEvaluation.allRequirements.find(requirement => requirement.requirementId === 'main_service_panel')?.canonicalEvidenceIds[0];
  const utility = evidence.requirementEvaluation.allRequirements.find(requirement => requirement.requirementId === 'utility_meter')?.canonicalEvidenceIds[0];
  const roof = evidence.requirementEvaluation.allRequirements.find(requirement => requirement.requirementId === 'roof_overview')?.canonicalEvidenceIds[0];
  return electrical ?? utility ?? roof ?? evidence.photos[0]?.id ?? null;
}

function surveyToEnriched(survey: SiteSurvey, files: SiteSurveyFile[]): EnrichedSiteSurvey {
  const data = record(survey.surveyData);
  const raw: RawSurveyPayload = {
    id: survey.id,
    projectId: survey.projectId ?? 'unknown',
    location: rawLocation(data, survey),
    systemType: stringValue(data.systemType) || stringValue(data.mountType) || 'roof',
    geometry: rawGeometry(data),
    structural: rawStructural(data),
    electrical: rawElectrical(data),
    photos: files.filter(file => file.fileType === 'photo').map(fileToSurveyPhoto),
    installerNotes: survey.notes ?? stringValue(data.installerNotes) ?? null,
    inspectorName: survey.inspectorName ?? stringValue(data.inspectorName) ?? null,
    surveyedAt: survey.updatedAt ?? survey.createdAt ?? null,
  };
  return enrichSurvey(normalizeSurvey(raw));
}

function rawLocation(data: Record<string, unknown>, survey: SiteSurvey): RawSurveyPayload['location'] {
  const location = record(data.location);
  const siteOverview = record(data.siteOverview);
  return {
    lat: numberOrNull(location.lat),
    lng: numberOrNull(location.lng),
    elevation: numberOrNull(location.elevation),
    azimuthReference: numberOrNull(location.azimuthReference),
    address: survey.addressSnapshot ?? stringValue(location.address) ?? stringValue(siteOverview.siteAddress) ?? null,
  };
}

function rawGeometry(data: Record<string, unknown>): RawSurveyPayload['geometry'] {
  const geometry = record(data.geometry);
  const obstructions = record(data.obstructions);
  return {
    roofPlanes: arrayValue(geometry.roofPlanes),
    obstructions: arrayValue(geometry.obstructions) ?? arrayValue(obstructions.obstructions),
    setbacks: arrayValue(geometry.setbacks),
    usableAreaSqFt: numberOrNull(geometry.usableAreaSqFt),
  };
}

function rawStructural(data: Record<string, unknown>): RawSurveyPayload['structural'] {
  const structural = record(data.structural);
  const roofConditions = record(data.roofConditions);
  return {
    rafterSpacingIn: scalarValue(structural.rafterSpacingIn ?? roofConditions.rafterSpacing),
    rafterSize: stringValue(structural.rafterSize ?? roofConditions.rafterSize),
    deckingThicknessIn: scalarValue(structural.deckingThicknessIn ?? roofConditions.deckingThicknessIn),
    windExposure: stringValue(structural.windExposure),
    snowLoadPsf: numberOrNull(structural.snowLoadPsf),
    roofCondition: stringValue(structural.roofCondition ?? roofConditions.roofCondition),
    roofAgeYears: numberOrNull(structural.roofAgeYears ?? roofConditions.roofAgeYears),
    atticAccess: booleanOrNull(structural.atticAccess ?? roofConditions.atticAccess),
    roofMaterial: stringValue(structural.roofMaterial) ?? stringValue(roofConditions.roofMaterial),
    roofPitch: stringValue(structural.roofPitch ?? roofConditions.roofPitch),
    stories: stringValue(structural.stories) ?? stringValue(roofConditions.stories),
    structureType: stringValue(structural.structureType) ?? stringValue(roofConditions.structureType),
  };
}

function rawElectrical(data: Record<string, unknown>): RawSurveyPayload['electrical'] {
  const electrical = record(data.electrical);
  const electricalService = record(data.electricalService);
  return {
    mainPanelRatingAmps: scalarValue(electrical.mainPanelRatingAmps ?? electricalService.mainPanelRatingAmps ?? electricalService.panelRating),
    busbarRatingAmps: scalarValue(electrical.busbarRatingAmps ?? electricalService.busbarRatingAmps),
    breakerSpacesAvailable: scalarValue(electrical.breakerSpacesAvailable ?? electricalService.breakerSpacesAvailable),
    serviceEntrance: stringValue(electrical.serviceEntrance ?? electricalService.serviceEntrance),
    meterType: stringValue(electrical.meterType ?? electricalService.meterSocketType),
    interconnectionPoint: stringValue(electrical.interconnectionPoint ?? electricalService.interconnectionPoint),
    panelBrand: stringValue(electrical.panelBrand ?? electricalService.panelBrand),
    hasSubPanel: booleanOrNull(electrical.hasSubPanel ?? electricalService.hasSubPanel),
    subPanelRatingAmps: scalarValue(electrical.subPanelRatingAmps ?? electricalService.subPanelRating),
    availableBreakerSlots: stringValue(electrical.availableBreakerSlots) ?? stringValue(electricalService.availableBreakerSlots),
  };
}

function fileToSurveyPhoto(file: SiteSurveyFile): Partial<SurveyPhotoRef> {
  return {
    url: file.fileUrl,
    category: surveyPhotoCategory(file.label ?? file.filename),
    slotKey: file.label ?? file.id,
    capturedAt: file.createdAt,
    notes: file.filename ?? undefined,
  };
}

function surveyPhotoCategory(label: string | null): SurveyPhotoRef['category'] {
  const normalized = (label ?? '').toLowerCase();
  if (normalized.includes('roof') || normalized.includes('rafter') || normalized.includes('attic')) return 'roof';
  if (normalized.includes('panel') || normalized.includes('msp') || normalized.includes('disconnect') || normalized.includes('subpanel')) return 'panel';
  if (normalized.includes('meter') || normalized.includes('utility')) return 'meter';
  if (normalized.includes('obstruction') || normalized.includes('vent') || normalized.includes('chimney') || normalized.includes('skylight')) return 'obstruction';
  if (normalized.includes('overview') || normalized.includes('site') || normalized.includes('exterior')) return 'site';
  return 'other';
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function scalarValue(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
