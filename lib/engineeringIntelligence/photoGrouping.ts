import type { SiteSurvey } from '@/lib/db/surveys';
import type {
  SurveyEvidenceCategory,
  SurveyEvidenceItem,
  SurveyEvidenceManifest,
} from '@/lib/survey/evidence/manifest';
import type { SurveySessionSummary } from '@/lib/survey/evidence/sessionTypes';
import type { CADReadinessFlag } from './cadReadiness';

export type DeterministicClusterType =
  | 'roof_side_candidate'
  | 'utility_evidence'
  | 'electrical_evidence'
  | 'routing_continuity'
  | 'detached_structure_candidate'
  | 'ground_mount_candidate'
  | 'obstruction_continuity'
  | 'general_exterior'
  | 'uncategorized';

export type DeterministicClusterConfidence = 'metadata_only_high' | 'metadata_only_medium' | 'metadata_only_low';
export type GroupedReadinessStatus = 'ready' | 'partial' | 'blocked' | 'not_applicable';

export interface SurveyTraversalOrderItem {
  sequenceIndex: number;
  evidenceId: string;
  surveyId: string;
  siteSurveyFileId: string | null;
  filename: string | null;
  category: SurveyEvidenceCategory;
  submittedCategory: string | null;
  captureTimestamp: string | null;
  uploadTimestamp: string | null;
  deterministicSortKey: string;
  metadataCompletenessScore: number;
  orientation: string | null;
  widthPx: number | null;
  heightPx: number | null;
}

export interface SurveyTraversalSegment {
  segmentId: string;
  sequenceStart: number;
  sequenceEnd: number;
  evidenceIds: string[];
  dominantClusterType: DeterministicClusterType;
  dominantCategories: SurveyEvidenceCategory[];
  continuityConfidence: DeterministicClusterConfidence;
  clusterBoundaryReasons: string[];
  clusterTransitionReasons: string[];
  probableMovementContext: string;
}

export interface EvidenceClusterModel {
  clusterId: string;
  clusterType: DeterministicClusterType;
  label: string;
  evidenceIds: string[];
  categories: SurveyEvidenceCategory[];
  sequenceStart: number;
  sequenceEnd: number;
  clusterConfidence: DeterministicClusterConfidence;
  clusterBoundaryReasons: string[];
  clusterTransitionReasons: string[];
  metadataCompletenessScore: number;
  readinessPromotionContext: string[];
}

export interface PhotoContinuityChain {
  chainId: string;
  evidenceIds: string[];
  chainType: DeterministicClusterType;
  sequenceStart: number;
  sequenceEnd: number;
  continuityConfidence: DeterministicClusterConfidence;
  deterministicReason: string;
}

export interface SurveySequenceBreakpoint {
  breakpointId: string;
  afterSequenceIndex: number;
  beforeEvidenceId: string;
  afterEvidenceId: string;
  reason: string;
}

export interface GroupedCADReadinessContext {
  contextId: string;
  label: string;
  status: GroupedReadinessStatus;
  linkedReadinessFlagIds: string[];
  supportingClusterIds: string[];
  blockingReasons: string[];
  deterministicReason: string;
}

export interface DeterministicPhotoGroupingModel {
  generatedAt: string;
  projectId: string | null;
  surveyId: string | null;
  source: 'canonical_manifest_metadata' | 'not_loaded';
  surveyTraversalOrder: SurveyTraversalOrderItem[];
  surveyTraversalSegments: SurveyTraversalSegment[];
  evidenceClusters: EvidenceClusterModel[];
  roofSideCandidateGroups: EvidenceClusterModel[];
  routingContinuityGroups: EvidenceClusterModel[];
  utilityEvidenceGroups: EvidenceClusterModel[];
  electricalEvidenceGroups: EvidenceClusterModel[];
  detachedStructureGroups: EvidenceClusterModel[];
  groundMountCandidateGroups: EvidenceClusterModel[];
  sequenceBreakpoints: SurveySequenceBreakpoint[];
  photoContinuityChains: PhotoContinuityChain[];
  metadataCompletenessScores: Array<{ evidenceId: string; score: number; missingFields: string[] }>;
  groupedCADReadiness: GroupedCADReadinessContext[];
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}

export function buildDeterministicPhotoGrouping(input: {
  projectId?: string | null;
  survey?: SiteSurvey | null;
  canonicalManifest?: SurveyEvidenceManifest | null;
  sessions?: SurveySessionSummary[];
  readinessFlags?: CADReadinessFlag[];
  generatedAt?: string;
}): DeterministicPhotoGroupingModel {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const manifest = input.canonicalManifest ?? null;
  const items = manifest?.items ?? [];

  if (!manifest || items.length === 0) {
    return emptyGroupingModel({ projectId: input.projectId ?? manifest?.projectId ?? null, surveyId: manifest?.surveyId ?? input.survey?.id ?? null, generatedAt });
  }

  const uploadTimestampByEvidenceId = buildUploadTimestampMap(input.survey, items);
  const ordered = orderItems(items, uploadTimestampByEvidenceId).map((item, index) => buildTraversalOrderItem(item, index, uploadTimestampByEvidenceId.get(item.evidenceId) ?? null));
  const breakpoints = buildBreakpoints(ordered);
  const segments = buildSegments(ordered, breakpoints);
  const clusters = buildClusters(segments, ordered);
  const chains = clusters.map(cluster => ({
    chainId: `chain:${cluster.clusterId}`,
    evidenceIds: cluster.evidenceIds,
    chainType: cluster.clusterType,
    sequenceStart: cluster.sequenceStart,
    sequenceEnd: cluster.sequenceEnd,
    continuityConfidence: cluster.clusterConfidence,
    deterministicReason: `Continuity chain follows adjacent survey order for ${cluster.clusterType}; no image content is inspected.`,
  } satisfies PhotoContinuityChain));
  const completeness = ordered.map(item => ({
    evidenceId: item.evidenceId,
    score: item.metadataCompletenessScore,
    missingFields: missingMetadataFields(item),
  }));
  const readiness = buildGroupedReadiness({ clusters, readinessFlags: input.readinessFlags ?? [] });

  return {
    generatedAt,
    projectId: input.projectId ?? manifest.projectId ?? null,
    surveyId: manifest.surveyId,
    source: 'canonical_manifest_metadata',
    surveyTraversalOrder: ordered,
    surveyTraversalSegments: segments,
    evidenceClusters: clusters,
    roofSideCandidateGroups: clusters.filter(cluster => cluster.clusterType === 'roof_side_candidate'),
    routingContinuityGroups: clusters.filter(cluster => cluster.clusterType === 'routing_continuity'),
    utilityEvidenceGroups: clusters.filter(cluster => cluster.clusterType === 'utility_evidence'),
    electricalEvidenceGroups: clusters.filter(cluster => cluster.clusterType === 'electrical_evidence'),
    detachedStructureGroups: clusters.filter(cluster => cluster.clusterType === 'detached_structure_candidate'),
    groundMountCandidateGroups: clusters.filter(cluster => cluster.clusterType === 'ground_mount_candidate'),
    sequenceBreakpoints: breakpoints,
    photoContinuityChains: chains,
    metadataCompletenessScores: completeness,
    groupedCADReadiness: readiness,
    deterministicNotes: [
      `Survey traversal order uses ${ordered.length} canonical manifest metadata row(s).`,
      'Grouping is based only on capture/upload timestamps, filename order, submitted category, canonical category, dimensions/orientation metadata, and stable ids.',
      'Probable side/continuity labels are metadata grouping context, not engineering truth or geometry.',
      'Sparse exterior-only surveys remain partial/blocked when required electrical, attic, trench, ESS, or detached-structure evidence is missing.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function emptyGroupingModel(input: { projectId: string | null; surveyId: string | null; generatedAt: string }): DeterministicPhotoGroupingModel {
  return {
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    surveyId: input.surveyId,
    source: 'not_loaded',
    surveyTraversalOrder: [],
    surveyTraversalSegments: [],
    evidenceClusters: [],
    roofSideCandidateGroups: [],
    routingContinuityGroups: [],
    utilityEvidenceGroups: [],
    electricalEvidenceGroups: [],
    detachedStructureGroups: [],
    groundMountCandidateGroups: [],
    sequenceBreakpoints: [],
    photoContinuityChains: [],
    metadataCompletenessScores: [],
    groupedCADReadiness: buildGroupedReadiness({ clusters: [], readinessFlags: [] }),
    deterministicNotes: [
      'No canonical manifest metadata was supplied for deterministic photo grouping.',
      'No traversal, cluster, or continuity state is fabricated from missing evidence.',
    ],
    prohibitedRuntimeBehavior: prohibitedRuntimeBehavior(),
  };
}

function buildUploadTimestampMap(survey: SiteSurvey | null | undefined, items: SurveyEvidenceItem[]) {
  const map = new Map<string, string | null>();
  const payloadPhotos = extractPayloadPhotos(survey?.surveyData);
  for (const item of items) {
    const payload = payloadPhotos.find(photo =>
      (photo.url && photo.url === item.fileUrl)
      || (photo.uploadKey && item.blobKey && photo.uploadKey === item.blobKey)
      || (photo.category && item.submittedCategory && photo.category === item.submittedCategory),
    );
    map.set(item.evidenceId, payload?.createdAt ?? payload?.timestamp ?? item.captureTimestamp ?? null);
  }
  return map;
}

function orderItems(items: SurveyEvidenceItem[], uploadTimestampByEvidenceId: Map<string, string | null>): SurveyEvidenceItem[] {
  return [...items].sort((a, b) => {
    const aTime = timestamp(a.captureTimestamp) || timestamp(uploadTimestampByEvidenceId.get(a.evidenceId));
    const bTime = timestamp(b.captureTimestamp) || timestamp(uploadTimestampByEvidenceId.get(b.evidenceId));
    if (aTime !== bTime) return aTime - bTime;
    const filename = (a.filename ?? '').localeCompare(b.filename ?? '');
    if (filename !== 0) return filename;
    const category = a.category.localeCompare(b.category);
    if (category !== 0) return category;
    return a.evidenceId.localeCompare(b.evidenceId);
  });
}

function buildTraversalOrderItem(item: SurveyEvidenceItem, index: number, uploadTimestamp: string | null): SurveyTraversalOrderItem {
  const score = metadataCompletenessScore(item);
  return {
    sequenceIndex: index + 1,
    evidenceId: item.evidenceId,
    surveyId: item.surveyId,
    siteSurveyFileId: item.siteSurveyFileId,
    filename: item.filename,
    category: item.category,
    submittedCategory: item.submittedCategory,
    captureTimestamp: item.captureTimestamp,
    uploadTimestamp,
    deterministicSortKey: [timestamp(item.captureTimestamp) || timestamp(uploadTimestamp), item.filename ?? '', item.category, item.evidenceId].join('|'),
    metadataCompletenessScore: score,
    orientation: item.image.orientation,
    widthPx: item.image.widthPx,
    heightPx: item.image.heightPx,
  };
}

function buildBreakpoints(items: SurveyTraversalOrderItem[]): SurveySequenceBreakpoint[] {
  const result: SurveySequenceBreakpoint[] = [];
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const reasons = transitionReasons(previous, current);
    if (reasons.length === 0) continue;
    result.push({
      breakpointId: `breakpoint:${previous.sequenceIndex}:${current.sequenceIndex}`,
      afterSequenceIndex: previous.sequenceIndex,
      beforeEvidenceId: previous.evidenceId,
      afterEvidenceId: current.evidenceId,
      reason: reasons.join('; '),
    });
  }
  return result;
}

function buildSegments(items: SurveyTraversalOrderItem[], breakpoints: SurveySequenceBreakpoint[]): SurveyTraversalSegment[] {
  if (items.length === 0) return [];
  const breakAfter = new Set(breakpoints.map(point => point.afterSequenceIndex));
  const segments: SurveyTraversalOrderItem[][] = [];
  let current: SurveyTraversalOrderItem[] = [];
  for (const item of items) {
    current.push(item);
    if (breakAfter.has(item.sequenceIndex)) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments.map((segmentItems, index) => {
    const dominantType = dominantClusterType(segmentItems);
    const categories = uniqueSorted(segmentItems.map(item => item.category));
    return {
      segmentId: `segment:${index + 1}:${segmentItems[0].sequenceIndex}-${segmentItems[segmentItems.length - 1].sequenceIndex}`,
      sequenceStart: segmentItems[0].sequenceIndex,
      sequenceEnd: segmentItems[segmentItems.length - 1].sequenceIndex,
      evidenceIds: segmentItems.map(item => item.evidenceId),
      dominantClusterType: dominantType,
      dominantCategories: categories,
      continuityConfidence: confidenceFor(segmentItems),
      clusterBoundaryReasons: boundaryReasonsFor(segmentItems),
      clusterTransitionReasons: index === 0 ? ['survey traversal start'] : ['new segment after deterministic sequence breakpoint'],
      probableMovementContext: movementContextFor(dominantType),
    } satisfies SurveyTraversalSegment;
  });
}

function buildClusters(segments: SurveyTraversalSegment[], ordered: SurveyTraversalOrderItem[]): EvidenceClusterModel[] {
  return segments.map(segment => {
    const segmentItems = ordered.filter(item => item.sequenceIndex >= segment.sequenceStart && item.sequenceIndex <= segment.sequenceEnd);
    const clusterType = segment.dominantClusterType;
    const clusterId = `cluster:${clusterType}:${segment.sequenceStart}-${segment.sequenceEnd}`;
    return {
      clusterId,
      clusterType,
      label: labelForClusterType(clusterType),
      evidenceIds: segment.evidenceIds,
      categories: segment.dominantCategories,
      sequenceStart: segment.sequenceStart,
      sequenceEnd: segment.sequenceEnd,
      clusterConfidence: segment.continuityConfidence,
      clusterBoundaryReasons: segment.clusterBoundaryReasons,
      clusterTransitionReasons: segment.clusterTransitionReasons,
      metadataCompletenessScore: average(segmentItems.map(item => item.metadataCompletenessScore)),
      readinessPromotionContext: readinessContextFor(clusterType, segment.dominantCategories),
    } satisfies EvidenceClusterModel;
  }).sort((a, b) => a.sequenceStart - b.sequenceStart || a.clusterId.localeCompare(b.clusterId));
}

function buildGroupedReadiness(input: { clusters: EvidenceClusterModel[]; readinessFlags: CADReadinessFlag[] }): GroupedCADReadinessContext[] {
  const clusters = input.clusters;
  const byType = (type: DeterministicClusterType) => clusters.filter(cluster => cluster.clusterType === type);
  return [
    readinessContext({
      contextId: 'grouped-readiness:roof-side-continuity',
      label: 'Roof-side continuity',
      clusters: byType('roof_side_candidate'),
      flags: input.readinessFlags.filter(flag => ['roof-plane-ready', 'setback-ready'].includes(flag.flagId)),
      readyReason: 'Roof-side metadata clusters exist, but roof geometry still depends on explicit canonical roof evidence and requirement evaluation.',
      blockedReason: 'No roof-side continuity cluster exists from ordered canonical metadata.',
    }),
    readinessContext({
      contextId: 'grouped-readiness:route-continuity',
      label: 'Route continuity',
      clusters: byType('routing_continuity'),
      flags: input.readinessFlags.filter(flag => flag.flagId === 'routing-ready'),
      readyReason: 'Routing metadata clusters exist adjacent to utility/electrical categories; route geometry is not fabricated.',
      blockedReason: 'No routing continuity cluster exists from ordered canonical metadata.',
    }),
    readinessContext({
      contextId: 'grouped-readiness:obstruction-continuity',
      label: 'Obstruction continuity',
      clusters: byType('obstruction_continuity'),
      flags: input.readinessFlags.filter(flag => flag.flagId === 'setback-ready'),
      readyReason: 'Obstruction metadata clusters exist and may support review context; setback geometry remains requirement-bound.',
      blockedReason: 'No obstruction continuity cluster exists from ordered canonical metadata.',
    }),
    readinessContext({
      contextId: 'grouped-readiness:setback-context-continuity',
      label: 'Setback context continuity',
      clusters: byType('roof_side_candidate'),
      flags: input.readinessFlags.filter(flag => flag.flagId === 'setback-ready'),
      readyReason: 'Roof-side metadata continuity exists for setback review context only.',
      blockedReason: 'No roof-side metadata continuity exists for setback review context.',
    }),
    readinessContext({
      contextId: 'grouped-readiness:trench-path-continuity',
      label: 'Trench-path continuity',
      clusters: byType('ground_mount_candidate'),
      flags: input.readinessFlags.filter(flag => flag.flagId === 'trench-route-ready'),
      readyReason: 'Explicit trench/ground-mount metadata cluster exists; trench path geometry is not generated.',
      blockedReason: 'No explicit trench_path/ground-mount metadata cluster exists.',
    }),
  ];
}

function readinessContext(input: {
  contextId: string;
  label: string;
  clusters: EvidenceClusterModel[];
  flags: CADReadinessFlag[];
  readyReason: string;
  blockedReason: string;
}): GroupedCADReadinessContext {
  const flagStatus = input.flags.some(flag => flag.status === 'blocked')
    ? 'blocked'
    : input.flags.some(flag => flag.status === 'partial')
      ? 'partial'
      : input.flags.some(flag => flag.status === 'ready')
        ? 'ready'
        : 'not_applicable';
  const status: GroupedReadinessStatus = input.clusters.length === 0 ? 'blocked' : flagStatus === 'ready' ? 'partial' : flagStatus;
  const blockingReasons = [
    ...(input.clusters.length === 0 ? [input.blockedReason] : []),
    ...input.flags.flatMap(flag => flag.status === 'ready' ? [] : [`${flag.flagId} remains ${flag.status}: missing ${flag.missingCategories.join(', ') || 'none'}`]),
  ];
  return {
    contextId: input.contextId,
    label: input.label,
    status,
    linkedReadinessFlagIds: input.flags.map(flag => flag.flagId).sort(),
    supportingClusterIds: input.clusters.map(cluster => cluster.clusterId).sort(),
    blockingReasons,
    deterministicReason: input.clusters.length > 0 ? input.readyReason : input.blockedReason,
  };
}

function transitionReasons(previous: SurveyTraversalOrderItem, current: SurveyTraversalOrderItem): string[] {
  const reasons: string[] = [];
  const minutes = Math.abs((timestamp(current.captureTimestamp) || timestamp(current.uploadTimestamp)) - (timestamp(previous.captureTimestamp) || timestamp(previous.uploadTimestamp))) / 60000;
  if (Number.isFinite(minutes) && minutes > 12) reasons.push(`timestamp gap ${minutes.toFixed(1)} minutes`);
  const previousType = clusterTypeForCategory(previous.category, previous.submittedCategory, previous.filename);
  const currentType = clusterTypeForCategory(current.category, current.submittedCategory, current.filename);
  if (previousType !== currentType) reasons.push(`category transition ${previousType} to ${currentType}`);
  if ((previous.captureTimestamp ?? previous.uploadTimestamp) === (current.captureTimestamp ?? current.uploadTimestamp)) reasons.push('duplicate timestamp tie resolved by filename/category/evidence id');
  return reasons;
}

function boundaryReasonsFor(items: SurveyTraversalOrderItem[]): string[] {
  const reasons = ['contiguous deterministic survey order'];
  if (items.some(item => item.captureTimestamp)) reasons.push('capture/upload timestamp metadata available');
  if (items.some(item => item.filename)) reasons.push('filename ordering available for tie breaks');
  if (items.some(item => item.orientation || item.widthPx || item.heightPx)) reasons.push('dimension/orientation metadata available');
  if (items.length === 1) reasons.push('single-photo segment; continuity remains low confidence');
  return uniqueSorted(reasons);
}

function dominantClusterType(items: SurveyTraversalOrderItem[]): DeterministicClusterType {
  const counts = new Map<DeterministicClusterType, number>();
  for (const item of items) {
    const type = clusterTypeForCategory(item.category, item.submittedCategory, item.filename);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'uncategorized';
}

function clusterTypeForCategory(category: SurveyEvidenceCategory, submittedCategory: string | null, filename: string | null): DeterministicClusterType {
  const text = `${category} ${submittedCategory ?? ''} ${filename ?? ''}`.toLowerCase();
  if (category === 'roof_plane' || category === 'roof_edge' || category === 'ridge' || category === 'roof_surface' || category === 'overview') return 'roof_side_candidate';
  if (category === 'obstructions') return 'obstruction_continuity';
  if (category === 'meter' || category === 'utility_access' || category === 'utility_connection') return 'utility_evidence';
  if (category === 'main_service_panel' || category === 'subpanel' || category === 'disconnect' || category === 'grounding') return 'electrical_evidence';
  if (category === 'inverter_location' || category === 'gateway_location' || text.includes('route') || text.includes('conduit')) return 'routing_continuity';
  if (category === 'detached_structures' || text.includes('detached')) return 'detached_structure_candidate';
  if (category === 'trench_path' || text.includes('trench') || text.includes('ground_mount') || text.includes('ground-mount')) return 'ground_mount_candidate';
  if (category === 'uncategorized') return 'uncategorized';
  return 'general_exterior';
}

function readinessContextFor(type: DeterministicClusterType, categories: SurveyEvidenceCategory[]): string[] {
  if (type === 'roof_side_candidate') return ['Supports roof-side review context only; does not prove roof geometry.', `Categories: ${categories.join(', ')}`];
  if (type === 'utility_evidence') return ['Supports utility-side grouping context only; does not prove routing path.'];
  if (type === 'electrical_evidence') return ['Supports electrical-side grouping context only; MSP truth still requires explicit electrical evidence rows.'];
  if (type === 'routing_continuity') return ['Supports routing continuity context only; no route path is fabricated.'];
  if (type === 'detached_structure_candidate') return ['Detached-structure grouping requires explicit metadata; no detached structure is assumed from generic exterior photos.'];
  if (type === 'ground_mount_candidate') return ['Ground/trench grouping requires explicit metadata; no trench path is fabricated.'];
  if (type === 'obstruction_continuity') return ['Supports obstruction review context only; no setback geometry is generated.'];
  return ['General exterior metadata group; no engineering readiness is promoted from generic exterior photos.'];
}

function movementContextFor(type: DeterministicClusterType): string {
  if (type === 'roof_side_candidate') return 'probable roof-side/perimeter evidence sequence from metadata categories';
  if (type === 'utility_evidence') return 'probable utility-side evidence sequence from metadata categories';
  if (type === 'electrical_evidence') return 'probable electrical-side evidence sequence from metadata categories';
  if (type === 'routing_continuity') return 'probable route-continuity sequence from metadata categories';
  if (type === 'detached_structure_candidate') return 'probable detached-structure sequence from explicit metadata categories';
  if (type === 'ground_mount_candidate') return 'probable ground-mount/trench sequence from explicit metadata categories';
  if (type === 'obstruction_continuity') return 'probable roof obstruction sequence from metadata categories';
  return 'general exterior/perimeter metadata sequence';
}

function labelForClusterType(type: DeterministicClusterType): string {
  return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function confidenceFor(items: SurveyTraversalOrderItem[]): DeterministicClusterConfidence {
  const averageScore = average(items.map(item => item.metadataCompletenessScore));
  if (items.length >= 2 && averageScore >= 0.7) return 'metadata_only_high';
  if (items.length >= 2 && averageScore >= 0.45) return 'metadata_only_medium';
  return 'metadata_only_low';
}

function metadataCompletenessScore(item: SurveyEvidenceItem): number {
  const fields = [
    Boolean(item.captureTimestamp),
    Boolean(item.siteSurveyFileId),
    Boolean(item.filename),
    Boolean(item.submittedCategory),
    Boolean(item.mimeType),
    Boolean(item.image.orientation || item.image.widthPx || item.image.heightPx),
  ];
  return Number((fields.filter(Boolean).length / fields.length).toFixed(2));
}

function missingMetadataFields(item: SurveyTraversalOrderItem): string[] {
  const missing: string[] = [];
  if (!item.captureTimestamp) missing.push('captureTimestamp');
  if (!item.siteSurveyFileId) missing.push('siteSurveyFileId');
  if (!item.filename) missing.push('filename');
  if (!item.submittedCategory) missing.push('submittedCategory');
  if (!item.orientation && !item.widthPx && !item.heightPx) missing.push('imageDimensionsOrOrientation');
  return missing;
}

function extractPayloadPhotos(surveyData: SiteSurvey['surveyData'] | null | undefined): Array<{ url?: string; uploadKey?: string; category?: string; timestamp?: string; createdAt?: string }> {
  if (!surveyData || typeof surveyData !== 'object') return [];
  const photos = (surveyData as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter((photo): photo is Record<string, unknown> => Boolean(photo) && typeof photo === 'object').map(photo => ({
    url: typeof photo.url === 'string' ? photo.url : undefined,
    uploadKey: typeof photo.uploadKey === 'string' ? photo.uploadKey : undefined,
    category: typeof photo.category === 'string' ? photo.category : undefined,
    timestamp: typeof photo.timestamp === 'string' ? photo.timestamp : undefined,
    createdAt: typeof photo.createdAt === 'string' ? photo.createdAt : undefined,
  }));
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function prohibitedRuntimeBehavior() {
  return [
    'no OCR',
    'no OpenCV',
    'no YOLO',
    'no TensorFlow',
    'no PyTorch',
    'no semantic scene classifier',
    'no image-byte inspection',
    'no roof segmentation',
    'no object detection',
    'no CAD generation',
    'no geometry hallucination',
    'no autonomous engineering decisions',
  ];
}
