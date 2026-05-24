import type { CanonicalSurveyGeometryV1, ProfessionalSurveyAuthorityFlagsV1, SurveyCADReadinessV1 } from './professionalSurveyParser';
import type { GeometryIntelligenceReportV1 } from './geometryIntelligence';
import type { SurveyPhotoEvidenceBundleV1 } from './surveyPhotoEvidence';

export type RenderReadinessStateV1 = 'render_blocked' | 'render_review_required' | 'render_preview_ready' | 'render_demo_ready';
export type RenderLayerRecommendationTypeV1 =
  | 'roof_outlines'
  | 'roof_labels'
  | 'pitch_azimuth_overlays'
  | 'obstruction_overlays'
  | 'fire_setback_overlays'
  | 'module_layout_previews'
  | 'conduit_path_candidates'
  | 'equipment_markers'
  | 'msp_meter_markers'
  | 'evidence_review_callouts'
  | 'render_confidence_notes';
export type RenderLayerPriorityV1 = 'required' | 'recommended' | 'optional' | 'blocked';

export interface RenderReadinessV1 {
  schemaVersion: 'render_readiness_v1';
  mode: 'deterministic_render_assist_review_only';
  sourceSurveyId: string;
  sourceGeometryHash: string;
  sourceReadinessHash: string;
  sourceIntelligenceHash: string;
  sourcePhotoEvidenceHash: string;
  renderReadinessHash: string;
  state: RenderReadinessStateV1;
  renderConfidenceScore: number;
  blockers: string[];
  reviewItems: string[];
  coverage: {
    hasRenderableGeometry: boolean;
    hasTrustedGeometry: boolean;
    hasRoofOrMountPhotos: boolean;
    hasElectricalPhotos: boolean;
    hasObstructionPhotosWhenNeeded: boolean;
    unresolvedBlockerReview: boolean;
  };
  noAuthorityEnforcement: RenderNoAuthorityEnforcementV1;
  deterministicNotes: string[];
}

export interface RenderLayerRecommendationV1 {
  id: string;
  type: RenderLayerRecommendationTypeV1;
  priority: RenderLayerPriorityV1;
  enabledForPreview: boolean;
  confidence: number;
  sourceSignals: string[];
  evidencePhotoSlotKeys: string[];
  targetEntities: string[];
  operatorNote: string;
}

export interface ProfessionalRenderRecommendationReportV1 {
  schemaVersion: 'professional_render_recommendation_report_v1';
  mode: 'deterministic_render_layer_recommendations_review_only';
  sourceSurveyId: string;
  sourceRenderReadinessHash: string;
  recommendationHash: string;
  renderReadiness: RenderReadinessV1;
  recommendations: RenderLayerRecommendationV1[];
  summary: {
    recommendedLayerCount: number;
    previewEnabledLayerCount: number;
    requiredLayerCount: number;
    blockedLayerCount: number;
    topCommercialRenderLayers: RenderLayerRecommendationTypeV1[];
    renderConfidenceNotes: string[];
  };
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  noAuthorityEnforcement: RenderNoAuthorityEnforcementV1;
  deterministicNotes: string[];
}

export interface RenderNoAuthorityEnforcementV1 {
  readOnly: true;
  renderAssistOnly: true;
  automaticCadGenerationAllowed: false;
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  cadSolverExecutionAllowed: false;
  persistenceAllowed: false;
  downstreamEngineeringAllowed: false;
  downstreamPermitAllowed: false;
  downstreamBomAllowed: false;
  engineeringAuthorityAllowed: false;
}

const NO_AUTHORITY_FLAGS: ProfessionalSurveyAuthorityFlagsV1 = {
  persistenceAllowed: false,
  solverExecutionAllowed: false,
  cadMutationAllowed: false,
  canonicalGeometryMutationAllowed: false,
  engineeringAuthorityAllowed: false,
  necAuthorityAllowed: false,
  bomAuthorityAllowed: false,
  permitAuthorityAllowed: false,
  downstreamAuthority: false,
};

export function buildRenderReadiness(input: {
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  geometryIntelligence: GeometryIntelligenceReportV1;
  photoEvidence: SurveyPhotoEvidenceBundleV1;
}): RenderReadinessV1 {
  const blockers = buildRenderBlockers(input);
  const reviewItems = buildRenderReviewItems(input);
  const coverage = {
    hasRenderableGeometry: input.canonicalGeometry.readyForCADInput && input.cadReadiness.cadInputPreview !== null,
    hasTrustedGeometry: input.geometryIntelligence.scores.geometryConfidenceScore >= 82 && input.geometryIntelligence.scores.topologyIntegrityScore >= 82,
    hasRoofOrMountPhotos: input.photoEvidence.coverage.roofOrMountCoverage,
    hasElectricalPhotos: input.photoEvidence.coverage.electricalCoverage,
    hasObstructionPhotosWhenNeeded: !needsObstructionRenderEvidence(input) || input.photoEvidence.coverage.obstructionCoverage,
    unresolvedBlockerReview: input.geometryIntelligence.classification.reviewUrgency === 'blocker_review',
  };
  const renderConfidenceScore = scoreRenderConfidence(input, blockers, reviewItems, coverage);
  const state = classifyRenderState(renderConfidenceScore, blockers, reviewItems, coverage);
  const withoutHash = {
    schemaVersion: 'render_readiness_v1' as const,
    mode: 'deterministic_render_assist_review_only' as const,
    sourceSurveyId: input.geometryIntelligence.sourceSurveyId,
    sourceGeometryHash: input.canonicalGeometry.geometryHash,
    sourceReadinessHash: input.cadReadiness.readinessHash,
    sourceIntelligenceHash: input.geometryIntelligence.intelligenceHash,
    sourcePhotoEvidenceHash: input.photoEvidence.bundleHash,
    state,
    renderConfidenceScore,
    blockers,
    reviewItems,
    coverage,
    noAuthorityEnforcement: noAuthorityEnforcement(),
    deterministicNotes: [
      'RenderReadinessV1 evaluates commercial render preparedness from existing geometry/readiness/intelligence/photo evidence only.',
      'Render readiness is not CAD authority and does not execute solvers, mutate geometry, or trigger downstream permit/BOM/engineering flows.',
      'Photo evidence improves render confidence and callout planning, not canonical geometry authority.',
    ],
  };
  return { ...withoutHash, renderReadinessHash: deterministicHash(withoutHash) };
}

export function buildProfessionalRenderRecommendationReport(input: {
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  geometryIntelligence: GeometryIntelligenceReportV1;
  photoEvidence: SurveyPhotoEvidenceBundleV1;
  renderReadiness?: RenderReadinessV1;
}): ProfessionalRenderRecommendationReportV1 {
  const renderReadiness = input.renderReadiness ?? buildRenderReadiness(input);
  const recommendations = buildRecommendations(input, renderReadiness).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id));
  const withoutHash = {
    schemaVersion: 'professional_render_recommendation_report_v1' as const,
    mode: 'deterministic_render_layer_recommendations_review_only' as const,
    sourceSurveyId: renderReadiness.sourceSurveyId,
    sourceRenderReadinessHash: renderReadiness.renderReadinessHash,
    renderReadiness,
    recommendations,
    summary: {
      recommendedLayerCount: recommendations.length,
      previewEnabledLayerCount: recommendations.filter(item => item.enabledForPreview).length,
      requiredLayerCount: recommendations.filter(item => item.priority === 'required').length,
      blockedLayerCount: recommendations.filter(item => item.priority === 'blocked').length,
      topCommercialRenderLayers: recommendations.filter(item => item.enabledForPreview).slice(0, 6).map(item => item.type),
      renderConfidenceNotes: buildRenderConfidenceNotes(renderReadiness, recommendations),
    },
    authorityFlags: NO_AUTHORITY_FLAGS,
    noAuthorityEnforcement: noAuthorityEnforcement(),
    deterministicNotes: [
      'Layer recommendations are professional render-assist guidance for operators and demos.',
      'Recommendations do not mutate CAD previews, canonical geometry, module layouts, conduit paths, or equipment records.',
      'Evidence/review callouts are intentionally included when confidence is insufficient for polished render use.',
    ],
  };
  return { ...withoutHash, recommendationHash: deterministicHash(withoutHash) };
}

export function buildOperatorRenderIntelligenceSummary(report: ProfessionalRenderRecommendationReportV1) {
  return {
    schemaVersion: 'operator_render_intelligence_summary_v1' as const,
    renderReadinessState: report.renderReadiness.state,
    renderConfidenceScore: report.renderReadiness.renderConfidenceScore,
    renderBlockers: report.renderReadiness.blockers.slice(0, 8),
    renderReviewItems: report.renderReadiness.reviewItems.slice(0, 8),
    previewEnabledLayerCount: report.summary.previewEnabledLayerCount,
    requiredLayerCount: report.summary.requiredLayerCount,
    blockedLayerCount: report.summary.blockedLayerCount,
    topCommercialRenderLayers: report.summary.topCommercialRenderLayers,
    renderConfidenceNotes: report.summary.renderConfidenceNotes.slice(0, 6),
    nonAuthoritative: true as const,
  };
}

function buildRenderBlockers(input: {
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  geometryIntelligence: GeometryIntelligenceReportV1;
  photoEvidence: SurveyPhotoEvidenceBundleV1;
}): string[] {
  const blockers: string[] = [];
  if (!input.canonicalGeometry.readyForCADInput) blockers.push('Canonical geometry is not ready for CAD input preview.');
  if (input.cadReadiness.readinessStatus === 'blocked') blockers.push('CAD readiness is blocked by native survey validation.');
  if (input.geometryIntelligence.classification.reviewUrgency === 'blocker_review') blockers.push('Geometry intelligence requires blocker review before commercial render use.');
  if (!input.photoEvidence.coverage.roofOrMountCoverage) blockers.push('Missing roof/ground/fence visual coverage needed for credible render context.');
  return deterministicUnique(blockers);
}

function needsObstructionRenderEvidence(input: {
  geometryIntelligence: GeometryIntelligenceReportV1;
  photoEvidence: SurveyPhotoEvidenceBundleV1;
}): boolean {
  const intelligenceText = [
    input.geometryIntelligence.summaries.disagreementSummary,
    ...input.geometryIntelligence.summaries.reviewActions,
    ...input.geometryIntelligence.summaries.topologyConfidenceDegradation,
    ...input.geometryIntelligence.risks.map(risk => `${risk.category} ${risk.evidenceSummary}`),
  ].join(' ').toLowerCase();
  return input.photoEvidence.missingPhotoCategoryWarnings.some(warning => warning.toLowerCase().includes('obstruction'))
    || intelligenceText.includes('obstruction')
    || input.geometryIntelligence.scores.discrepancySeverityScore >= 8;
}

function buildRenderReviewItems(input: {
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  geometryIntelligence: GeometryIntelligenceReportV1;
  photoEvidence: SurveyPhotoEvidenceBundleV1;
}): string[] {
  const items = [
    ...input.photoEvidence.missingPhotoCategoryWarnings,
    ...input.photoEvidence.evidence.filter(item => item.classification.reviewStatus !== 'accepted_for_render_reference').map(item => `Review photo ${item.source.slotKey}: ${item.classification.category}, ${item.classification.confidence} confidence.`),
    ...input.geometryIntelligence.summaries.reviewActions.slice(0, 4),
  ];
  if (input.geometryIntelligence.scores.readinessTrustScore < 90) items.push(`Readiness trust score is ${input.geometryIntelligence.scores.readinessTrustScore}; keep render in review-assisted mode.`);
  if (input.geometryIntelligence.scores.discrepancySeverityScore >= 12) items.push('Geometry discrepancy severity warrants render callouts rather than polished-only overlays.');
  if (!input.photoEvidence.coverage.electricalCoverage) items.push('Electrical photos are missing; MSP/meter/equipment markers should be callout-only.');
  return deterministicUnique(items).slice(0, 12);
}

function scoreRenderConfidence(
  input: {
    geometryIntelligence: GeometryIntelligenceReportV1;
    photoEvidence: SurveyPhotoEvidenceBundleV1;
  },
  blockers: string[],
  reviewItems: string[],
  coverage: RenderReadinessV1['coverage'],
): number {
  const geometryScore = Math.round((input.geometryIntelligence.scores.geometryConfidenceScore + input.geometryIntelligence.scores.topologyIntegrityScore + input.geometryIntelligence.scores.readinessTrustScore) / 3);
  const photoScore = Math.min(100, input.photoEvidence.coverage.renderRelevantPhotoCount * 18 + input.photoEvidence.coverage.highConfidencePhotoCount * 10 + (coverage.hasRoofOrMountPhotos ? 20 : 0) + (coverage.hasElectricalPhotos ? 12 : 0) + (coverage.hasObstructionPhotosWhenNeeded ? 8 : 0));
  const penalty = blockers.length * 24 + Math.min(24, reviewItems.length * 3);
  return clamp(Math.round(geometryScore * 0.62 + photoScore * 0.38) - penalty, 0, 100);
}

function classifyRenderState(
  score: number,
  blockers: string[],
  reviewItems: string[],
  coverage: RenderReadinessV1['coverage'],
): RenderReadinessStateV1 {
  if (blockers.length > 0 || coverage.unresolvedBlockerReview) return 'render_blocked';
  if (score >= 88 && reviewItems.length <= 2 && coverage.hasElectricalPhotos) return 'render_demo_ready';
  if (score >= 70 && coverage.hasRenderableGeometry && coverage.hasRoofOrMountPhotos) return 'render_preview_ready';
  return 'render_review_required';
}

function buildRecommendations(
  input: {
    canonicalGeometry: CanonicalSurveyGeometryV1;
    cadReadiness: SurveyCADReadinessV1;
    geometryIntelligence: GeometryIntelligenceReportV1;
    photoEvidence: SurveyPhotoEvidenceBundleV1;
  },
  renderReadiness: RenderReadinessV1,
): RenderLayerRecommendationV1[] {
  const roofPlanes = input.canonicalGeometry.roofPlanes.map(plane => `roofPlane.${plane.planeId}`).sort();
  const obstructionEntities = input.photoEvidence.coverage.obstructionCoverage || needsObstructionRenderEvidence(input) ? ['survey.obstructionEvidence'] : [];
  const setbackEntities = input.cadReadiness.cadInputPreview ? input.canonicalGeometry.roofPlanes.map(plane => `fireSetback.${plane.planeId}`).sort() : [];
  const roofPhotoSlots = photoSlots(input.photoEvidence, ['roof_overview', 'roof_detail', 'ground_mount_area', 'fence_vertical_solar_area']);
  const obstructionPhotoSlots = photoSlots(input.photoEvidence, ['obstruction']);
  const electricalPhotoSlots = photoSlots(input.photoEvidence, ['meter', 'msp_electrical_panel', 'inverter_equipment']);
  const previewAllowed = renderReadiness.state === 'render_preview_ready' || renderReadiness.state === 'render_demo_ready';

  return [
    layer('roof-outlines', 'roof_outlines', roofPlanes.length > 0 ? 'required' : 'blocked', previewAllowed && roofPlanes.length > 0, confidence(input, 92), ['canonical roof polygon geometry', 'photo roof/mount coverage'], roofPhotoSlots, roofPlanes, 'Render roof/mount outlines as the primary commercial visual anchor.'),
    layer('roof-labels', 'roof_labels', roofPlanes.length > 0 ? 'recommended' : 'blocked', previewAllowed && roofPlanes.length > 0, confidence(input, 86), ['plane identifiers', 'canonical geometry'], roofPhotoSlots, roofPlanes, 'Show roof plane labels for operator and contractor trust.'),
    layer('pitch-azimuth-overlays', 'pitch_azimuth_overlays', input.geometryIntelligence.scores.geometryConfidenceScore >= 82 ? 'recommended' : 'optional', previewAllowed, confidence(input, 82), ['pitch/azimuth from canonical geometry', 'geometry confidence score'], roofPhotoSlots, roofPlanes, 'Overlay pitch and azimuth when geometry trust is sufficient; otherwise use review callouts.'),
    layer('obstruction-overlays', 'obstruction_overlays', obstructionEntities.length > 0 ? (input.photoEvidence.coverage.obstructionCoverage ? 'recommended' : 'optional') : 'optional', previewAllowed && obstructionEntities.length > 0 && input.photoEvidence.coverage.obstructionCoverage, confidence(input, input.photoEvidence.coverage.obstructionCoverage ? 82 : 62), ['photo obstruction evidence', 'geometry intelligence discrepancy signals'], obstructionPhotoSlots, obstructionEntities, 'Use obstruction overlays when obstruction photo evidence exists; missing evidence should create review callouts instead of inferred geometry.'),
    layer('fire-setback-overlays', 'fire_setback_overlays', setbackEntities.length > 0 ? 'recommended' : 'optional', previewAllowed && setbackEntities.length > 0, confidence(input, 78), ['CAD input preview surfaces', 'canonical roof geometry'], roofPhotoSlots, setbackEntities, 'Render fire setbacks as preview overlays for permit-plan credibility without asserting final NEC authority.'),
    layer('module-layout-previews', 'module_layout_previews', input.cadReadiness.cadInputPreview ? 'recommended' : 'blocked', previewAllowed && Boolean(input.cadReadiness.cadInputPreview), confidence(input, 76), ['CAD input preview exists', 'readiness trust score'], roofPhotoSlots, roofPlanes, 'Show module layout previews only as render assistance, not solved CAD authority.'),
    layer('conduit-path-candidates', 'conduit_path_candidates', input.photoEvidence.coverage.electricalCoverage ? 'optional' : 'blocked', previewAllowed && input.photoEvidence.coverage.electricalCoverage, confidence(input, 58), ['electrical photo coverage', 'meter/MSP markers'], electricalPhotoSlots, ['electrical.conduitCandidate'], 'Suggest conduit path candidates as operator callouts, never as final engineering routes.'),
    layer('equipment-markers', 'equipment_markers', input.photoEvidence.coverage.equipmentCoverage ? 'recommended' : 'optional', previewAllowed && input.photoEvidence.coverage.equipmentCoverage, confidence(input, 70), ['equipment photo evidence'], electricalPhotoSlots, ['electrical.equipment'], 'Place inverter/equipment markers when photo evidence supports them.'),
    layer('msp-meter-markers', 'msp_meter_markers', input.photoEvidence.coverage.electricalCoverage ? 'required' : 'blocked', previewAllowed && input.photoEvidence.coverage.electricalCoverage, confidence(input, 80), ['meter/MSP photo evidence'], electricalPhotoSlots, ['electrical.meter', 'electrical.mainServicePanel'], 'MSP/meter markers are high commercial value for plan-set/demo credibility.'),
    layer('evidence-review-callouts', 'evidence_review_callouts', renderReadiness.reviewItems.length > 0 || renderReadiness.blockers.length > 0 ? 'required' : 'optional', true, 100, ['review items', 'render blockers', 'photo confidence'], input.photoEvidence.reviewNeededPhotoSlotKeys, [...renderReadiness.reviewItems, ...renderReadiness.blockers].slice(0, 8), 'Always surface evidence/review callouts when render confidence is limited.'),
    layer('render-confidence-notes', 'render_confidence_notes', 'required', true, renderReadiness.renderConfidenceScore, ['render confidence score', 'geometry trust', 'photo coverage'], input.photoEvidence.renderSupportingPhotoSlotKeys, [renderReadiness.state], 'Show confidence notes so commercial demos remain transparent and review-first.'),
  ];
}

function layer(
  id: string,
  type: RenderLayerRecommendationTypeV1,
  priority: RenderLayerPriorityV1,
  enabledForPreview: boolean,
  confidenceValue: number,
  sourceSignals: string[],
  evidencePhotoSlotKeys: string[],
  targetEntities: string[],
  operatorNote: string,
): RenderLayerRecommendationV1 {
  return { id, type, priority, enabledForPreview, confidence: clamp(confidenceValue, 0, 100), sourceSignals: sourceSignals.sort(), evidencePhotoSlotKeys: evidencePhotoSlotKeys.sort(), targetEntities: targetEntities.sort(), operatorNote };
}

function confidence(input: { geometryIntelligence: GeometryIntelligenceReportV1 }, base: number): number {
  const trust = Math.round((input.geometryIntelligence.scores.geometryConfidenceScore + input.geometryIntelligence.scores.topologyIntegrityScore + input.geometryIntelligence.scores.readinessTrustScore) / 3);
  return clamp(Math.round(base * 0.55 + trust * 0.45), 0, 100);
}

function photoSlots(photoEvidence: SurveyPhotoEvidenceBundleV1, categories: string[]): string[] {
  return photoEvidence.evidence.filter(item => categories.includes(item.classification.category)).map(item => item.source.slotKey).sort();
}

function buildRenderConfidenceNotes(readiness: RenderReadinessV1, recommendations: RenderLayerRecommendationV1[]): string[] {
  return deterministicUnique([
    `Render readiness is ${readiness.state} with confidence ${readiness.renderConfidenceScore}.`,
    `${recommendations.filter(item => item.enabledForPreview).length} layer(s) are preview-enabled for commercial render support.`,
    ...(readiness.blockers.length > 0 ? [`Render blockers: ${readiness.blockers.join(' | ')}`] : []),
    ...(readiness.reviewItems.length > 0 ? [`Review items remain: ${readiness.reviewItems.slice(0, 3).join(' | ')}`] : []),
  ]);
}

function priorityRank(priority: RenderLayerPriorityV1): number {
  return priority === 'required' ? 0 : priority === 'recommended' ? 1 : priority === 'optional' ? 2 : 3;
}

function noAuthorityEnforcement(): RenderNoAuthorityEnforcementV1 {
  return {
    readOnly: true,
    renderAssistOnly: true,
    automaticCadGenerationAllowed: false,
    canonicalGeometryMutationAllowed: false,
    cadMutationAllowed: false,
    cadSolverExecutionAllowed: false,
    persistenceAllowed: false,
    downstreamEngineeringAllowed: false,
    downstreamPermitAllowed: false,
    downstreamBomAllowed: false,
    engineeringAuthorityAllowed: false,
  };
}

function deterministicUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicHash(value: unknown): string {
  const json = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
