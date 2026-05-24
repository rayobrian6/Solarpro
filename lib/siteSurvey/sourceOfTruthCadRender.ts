import type { SystemDefinition } from '../system/systemDefinition';
import type { ProfessionalSurveyReadinessReportV1 } from './professionalSurveyReadinessReport';
import { buildEvidenceDerivedCadReconstruction, type EvidenceDerivedCadReconstructionV1 } from './evidenceDerivedCadReconstruction';

export type SourceOfTruthClassificationV1 =
  | 'survey_photo_truth'
  | 'survey_metadata_truth'
  | 'design_3d_truth'
  | 'design_layout_truth'
  | 'equipment_truth'
  | 'inferred_review_required'
  | 'fallback_placeholder';

export type SourceAuthorityLevelV1 = 'primary_survey_evidence' | 'secondary_design_intent' | 'metadata_reference' | 'review_inference' | 'fallback_only';

export interface SourceOfTruthDesignHandoffV1 {
  schemaVersion: 'source_of_truth_design_handoff_v1';
  sourceReference: string;
  systemDefinition?: SystemDefinition;
  design3d?: {
    sourceReference: string;
    installPlanes?: Array<{ planeId: string; azimuthDeg?: number; tiltDeg?: number; polygon?: Array<{ x: number; y: number }> }>;
    panelPlacements?: Array<{ panelId: string; planeId?: string; x?: number; y?: number; row?: number; col?: number; orientation?: 'portrait' | 'landscape' }>;
    equipmentPlacements?: Array<{ id: string; type: string; x?: number; y?: number; planeId?: string; confidence?: number }>;
  };
  layout?: {
    sourceReference: string;
    totalPanels?: number;
    arrays?: Array<{ arrayId: string; planeId?: string; panelCount: number; orientation?: 'portrait' | 'landscape'; azimuthDeg?: number; tiltDeg?: number; rowCount?: number; columnCount?: number }>;
    installAreaRefs?: string[];
  };
  notes?: string[];
}

export interface SourceTruthLayerProvenanceV1 {
  layerId: string;
  label: string;
  classification: SourceOfTruthClassificationV1;
  sourceType: 'survey_photo' | 'survey_metadata' | 'design_3d' | 'design_layout' | 'equipment' | 'inference' | 'fallback';
  sourceReferences: string[];
  confidence: number;
  authorityLevel: SourceAuthorityLevelV1;
  fallback: boolean;
  reviewRequired: boolean;
  evidenceLimitations: string[];
}

export interface DesignTruthModuleGroupV1 {
  groupId: string;
  source: 'design_layout' | 'design_3d' | 'fallback';
  planeId: string | null;
  panelCount: number;
  orientation: 'portrait' | 'landscape';
  panelWidthIn: number | null;
  panelHeightIn: number | null;
  wattage: number | null;
  rowCount: number;
  columnCount: number;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  sourceReferences: string[];
  confidence: number;
  fallback: boolean;
  reviewRequired: boolean;
}

export interface SourceOfTruthReconciliationV1 {
  status: 'aligned' | 'review_required' | 'fallback_only';
  warnings: string[];
  reviewRequiredFlags: string[];
  confidenceImpact: number;
  mismatchCount: number;
}

export interface SourceOfTruthCadRenderContextV1 {
  schemaVersion: 'source_of_truth_cad_render_context_v1';
  mode: 'preview_only_source_traceable_cad_render';
  sourceSurveyId: string;
  sourceGeometryHash: string;
  sourcePhotoEvidenceHash: string;
  designSourceReference: string | null;
  photoReconstruction: EvidenceDerivedCadReconstructionV1;
  designHandoff: SourceOfTruthDesignHandoffV1 | null;
  moduleGroups: DesignTruthModuleGroupV1[];
  layerProvenance: SourceTruthLayerProvenanceV1[];
  reconciliation: SourceOfTruthReconciliationV1;
  authenticity: {
    score: number;
    surveyPhotoTruthScore: number;
    surveyMetadataTruthScore: number;
    designTruthScore: number;
    provenanceCompletenessScore: number;
    fallbackPenalty: number;
  };
  noAuthorityEnforcement: {
    readOnly: true;
    renderPreviewOnly: true;
    photoExtractionEngineeringAuthority: false;
    canonicalGeometryMutationAllowed: false;
    designMutationAllowed: false;
    cadMutationAllowed: false;
    cadSolverExecutionAllowed: false;
    persistenceAllowed: false;
    downstreamEngineeringAllowed: false;
    downstreamPermitAllowed: false;
    downstreamBomAllowed: false;
  };
  contextHash: string;
  deterministicNotes: string[];
}

const BASE_A101_LAYERS: Array<Omit<SourceTruthLayerProvenanceV1, 'sourceReferences' | 'confidence'> & { baseConfidence: number; references: (report: ProfessionalSurveyReadinessReportV1, reconstruction: EvidenceDerivedCadReconstructionV1, design: SourceOfTruthDesignHandoffV1 | null) => string[] }> = [
  { layerId: 'sheet-background', label: 'Sheet background and title framing', classification: 'inferred_review_required', sourceType: 'inference', authorityLevel: 'review_inference', fallback: false, reviewRequired: true, evidenceLimitations: ['Drafting frame only; not source geometry.'], baseConfidence: 80, references: r => [r.source.surveyId] },
  { layerId: 'viewport-frame', label: 'Viewport frame and grid', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Diagrammatic drawing aid only.'], baseConfidence: 30, references: r => [r.source.surveyId] },
  { layerId: 'site-context', label: 'Site/parcel/driveway context', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Current site context is generated from viewport and roof bounds, not a property survey or image source.'], baseConfidence: 24, references: r => [r.source.surveyId] },
  { layerId: 'roof-outlines', label: 'Canonical roof outlines', classification: 'survey_metadata_truth', sourceType: 'survey_metadata', authorityLevel: 'metadata_reference', fallback: false, reviewRequired: true, evidenceLimitations: ['Survey-derived canonical geometry is preview metadata and remains non-authoritative.'], baseConfidence: 74, references: r => [r.canonicalGeometry.geometryHash] },
  { layerId: 'roof-articulation', label: 'Roof hatch and edge articulation', classification: 'survey_metadata_truth', sourceType: 'survey_metadata', authorityLevel: 'metadata_reference', fallback: false, reviewRequired: true, evidenceLimitations: ['Hatching is drafting style; only vertices are survey metadata.'], baseConfidence: 62, references: r => [r.canonicalGeometry.geometryHash] },
  { layerId: 'fire-setbacks', label: 'Fire setback preview', classification: 'inferred_review_required', sourceType: 'inference', authorityLevel: 'review_inference', fallback: false, reviewRequired: true, evidenceLimitations: ['Setback rectangles are simplified preview insets, not AHJ/code authority.'], baseConfidence: 48, references: r => [r.cadReadiness.readinessHash] },
  { layerId: 'module-layout', label: 'PV module layout', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['No design handoff detected; module layout must be disclosed fallback.'], baseConfidence: 25, references: (r, _recon, d) => d ? [d.sourceReference] : [r.source.surveyId] },
  { layerId: 'module-string-groups', label: 'Module grouping/string intent', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['String/group graphics require design/electrical truth or remain fallback.'], baseConfidence: 25, references: (r, _recon, d) => d ? [d.sourceReference] : [r.source.surveyId] },
  { layerId: 'rail-attachment-symbols', label: 'Rail and attachment symbols', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Attachment symbols are not engineering/racking authority.'], baseConfidence: 26, references: r => [r.source.surveyId] },
  { layerId: 'obstruction-symbols', label: 'Obstruction symbols', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Must be backed by photo obstruction candidate or design obstruction node.'], baseConfidence: 25, references: r => [r.source.surveyId] },
  { layerId: 'equipment-markers', label: 'Equipment/MSP/meter markers', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Electrical photo coverage alone is not a location anchor.'], baseConfidence: 25, references: r => [r.source.surveyId] },
  { layerId: 'conduit-candidates', label: 'Conduit candidate path', classification: 'fallback_placeholder', sourceType: 'fallback', authorityLevel: 'fallback_only', fallback: true, reviewRequired: true, evidenceLimitations: ['Route is candidate-only unless anchored by photo/design equipment locations.'], baseConfidence: 22, references: r => [r.source.surveyId] },
  { layerId: 'leader-callouts', label: 'Leader callouts and annotations', classification: 'inferred_review_required', sourceType: 'inference', authorityLevel: 'review_inference', fallback: false, reviewRequired: true, evidenceLimitations: ['Callouts explain preview layers and do not establish source truth.'], baseConfidence: 64, references: r => [r.source.surveyId] },
  { layerId: 'legend', label: 'Source-of-truth legend', classification: 'inferred_review_required', sourceType: 'inference', authorityLevel: 'review_inference', fallback: false, reviewRequired: true, evidenceLimitations: ['Legend summarizes provenance; it is not geometry.'], baseConfidence: 88, references: r => [r.source.surveyId] },
];

export function buildSourceOfTruthCadRenderContext(report: ProfessionalSurveyReadinessReportV1, designHandoff: SourceOfTruthDesignHandoffV1 | null = null): SourceOfTruthCadRenderContextV1 {
  const photoReconstruction = buildEvidenceDerivedCadReconstruction(report);
  const moduleGroups = buildModuleGroups(report, designHandoff);
  const layerProvenance = buildLayerProvenance(report, photoReconstruction, designHandoff, moduleGroups);
  const reconciliation = reconcile(report, photoReconstruction, designHandoff, moduleGroups, layerProvenance);
  const authenticity = scoreAuthenticity(report, photoReconstruction, designHandoff, layerProvenance, reconciliation);
  const withoutHash = {
    schemaVersion: 'source_of_truth_cad_render_context_v1' as const,
    mode: 'preview_only_source_traceable_cad_render' as const,
    sourceSurveyId: report.source.surveyId,
    sourceGeometryHash: report.canonicalGeometry.geometryHash,
    sourcePhotoEvidenceHash: report.photoEvidence.bundleHash,
    designSourceReference: designHandoff?.sourceReference ?? null,
    photoReconstruction,
    designHandoff,
    moduleGroups,
    layerProvenance,
    reconciliation,
    authenticity,
    noAuthorityEnforcement: noAuthority(),
    deterministicNotes: [
      'Source-of-truth CAD render context is read-only and preview-only.',
      'Survey photos are primary evidence truth but remain non-authoritative and review-required.',
      'Design/layout handoff is secondary placement/design truth and is never mutated by rendering.',
      'Fallback layers are explicit placeholders and reduce authenticity/quality scoring.',
    ],
  };
  return { ...withoutHash, contextHash: deterministicHash(withoutHash) };
}

function buildModuleGroups(report: ProfessionalSurveyReadinessReportV1, design: SourceOfTruthDesignHandoffV1 | null): DesignTruthModuleGroupV1[] {
  const panel = design?.systemDefinition?.panel;
  const sysLayout = design?.systemDefinition?.layout;
  const explicitArrays = design?.layout?.arrays ?? [];
  if (explicitArrays.length > 0) {
    return explicitArrays.map((array, index) => normalizeGroup({
      groupId: array.arrayId || `design-array-${index + 1}`,
      source: 'design_layout',
      planeId: array.planeId ?? null,
      panelCount: positiveInt(array.panelCount, 0),
      orientation: array.orientation ?? panel?.orientation ?? 'portrait',
      panelWidthIn: panel?.widthIn ?? null,
      panelHeightIn: panel?.heightIn ?? null,
      wattage: panel?.wattage ?? null,
      rowCount: array.rowCount,
      columnCount: array.columnCount,
      azimuthDeg: array.azimuthDeg ?? sysLayout?.azimuth ?? null,
      tiltDeg: array.tiltDeg ?? sysLayout?.tilt ?? null,
      sourceReferences: [design!.sourceReference, design!.layout?.sourceReference ?? 'design-layout'],
      confidence: 86,
      fallback: false,
      reviewRequired: false,
    }));
  }
  const designPanelCount = design?.layout?.totalPanels ?? sysLayout?.totalPanels;
  if (design && positiveInt(designPanelCount, 0) > 0) {
    return [normalizeGroup({
      groupId: 'design-layout-total-panels',
      source: 'design_layout',
      planeId: report.canonicalGeometry.roofPlanes[0]?.planeId ?? null,
      panelCount: positiveInt(designPanelCount, 0),
      orientation: panel?.orientation ?? 'portrait',
      panelWidthIn: panel?.widthIn ?? null,
      panelHeightIn: panel?.heightIn ?? null,
      wattage: panel?.wattage ?? null,
      rowCount: undefined,
      columnCount: undefined,
      azimuthDeg: sysLayout?.azimuth ?? null,
      tiltDeg: sysLayout?.tilt ?? null,
      sourceReferences: [design.sourceReference],
      confidence: 78,
      fallback: false,
      reviewRequired: true,
    })];
  }
  const fallbackCount = report.canonicalGeometry.roofPlanes.length > 0 ? Math.max(6, Math.min(18, report.canonicalGeometry.roofPlanes.length * 8)) : 0;
  return fallbackCount > 0 ? [normalizeGroup({
    groupId: 'fallback-module-placeholder',
    source: 'fallback',
    planeId: report.canonicalGeometry.roofPlanes[0]?.planeId ?? null,
    panelCount: fallbackCount,
    orientation: 'portrait',
    panelWidthIn: null,
    panelHeightIn: null,
    wattage: null,
    rowCount: undefined,
    columnCount: undefined,
    azimuthDeg: null,
    tiltDeg: null,
    sourceReferences: [report.source.surveyId],
    confidence: 22,
    fallback: true,
    reviewRequired: true,
  })] : [];
}

function normalizeGroup(group: Omit<DesignTruthModuleGroupV1, 'rowCount' | 'columnCount'> & { rowCount?: number; columnCount?: number }): DesignTruthModuleGroupV1 {
  const panelCount = positiveInt(group.panelCount, 0);
  const cols = positiveInt(group.columnCount, 0) || Math.max(1, Math.ceil(Math.sqrt(Math.max(1, panelCount))));
  const rows = positiveInt(group.rowCount, 0) || Math.max(1, Math.ceil(panelCount / cols));
  return { ...group, panelCount, rowCount: rows, columnCount: cols };
}

function buildLayerProvenance(report: ProfessionalSurveyReadinessReportV1, reconstruction: EvidenceDerivedCadReconstructionV1, design: SourceOfTruthDesignHandoffV1 | null, moduleGroups: DesignTruthModuleGroupV1[]): SourceTruthLayerProvenanceV1[] {
  const layers = BASE_A101_LAYERS.map(layer => ({
    layerId: layer.layerId,
    label: layer.label,
    classification: layer.classification,
    sourceType: layer.sourceType,
    sourceReferences: layer.references(report, reconstruction, design).filter(Boolean),
    confidence: layer.baseConfidence,
    authorityLevel: layer.authorityLevel,
    fallback: layer.fallback,
    reviewRequired: layer.reviewRequired,
    evidenceLimitations: [...layer.evidenceLimitations],
  }));

  promotePhotoLayer(layers, 'roof-outlines', reconstruction, ['roof_edge_candidates', 'install_area_candidates']);
  promotePhotoLayer(layers, 'obstruction-symbols', reconstruction, ['obstruction_candidates']);
  promotePhotoLayer(layers, 'equipment-markers', reconstruction, ['equipment_anchor_candidates']);
  promotePhotoLayer(layers, 'conduit-candidates', reconstruction, ['conduit_anchor_candidates']);

  if (moduleGroups.some(group => !group.fallback)) {
    promoteLayer(layers, 'module-layout', {
      classification: 'design_layout_truth', sourceType: 'design_layout', authorityLevel: 'secondary_design_intent', fallback: false, reviewRequired: moduleGroups.some(group => group.reviewRequired), confidence: Math.max(...moduleGroups.map(group => group.confidence)), sourceReferences: moduleGroups.flatMap(group => group.sourceReferences), evidenceLimitations: ['Panel layout intent is design-derived and must be field/survey reviewed.'],
    });
    promoteLayer(layers, 'module-string-groups', {
      classification: 'design_layout_truth', sourceType: 'design_layout', authorityLevel: 'secondary_design_intent', fallback: false, reviewRequired: true, confidence: 70, sourceReferences: moduleGroups.flatMap(group => group.sourceReferences), evidenceLimitations: ['String/group callouts are design intent unless explicit electrical string map is supplied.'],
    });
  }

  const equipmentRefs = designEquipmentRefs(design);
  if (equipmentRefs.length > 0) {
    promoteLayer(layers, 'equipment-markers', {
      classification: 'equipment_truth', sourceType: 'equipment', authorityLevel: 'secondary_design_intent', fallback: false, reviewRequired: true, confidence: 76, sourceReferences: equipmentRefs, evidenceLimitations: ['Equipment node is design/equipment truth and still requires survey/photo confirmation.'],
    });
  }

  const obstructionRefs = design?.systemDefinition?.obstructions?.map(item => item.id) ?? [];
  if (obstructionRefs.length > 0) {
    promoteLayer(layers, 'obstruction-symbols', {
      classification: 'equipment_truth', sourceType: 'equipment', authorityLevel: 'secondary_design_intent', fallback: false, reviewRequired: true, confidence: 72, sourceReferences: obstructionRefs, evidenceLimitations: ['Design obstruction node is not a fresh survey photo and requires review.'],
    });
  }

  return layers.sort((a, b) => a.layerId.localeCompare(b.layerId));
}

function promotePhotoLayer(layers: SourceTruthLayerProvenanceV1[], layerId: string, reconstruction: EvidenceDerivedCadReconstructionV1, candidateTypes: EvidenceDerivedCadReconstructionV1['candidates'][number]['layerType'][]): void {
  const matches = reconstruction.candidates.filter(candidate => candidateTypes.includes(candidate.layerType) && candidate.reviewStatus !== 'fallback_only');
  if (matches.length === 0) return;
  promoteLayer(layers, layerId, {
    classification: 'survey_photo_truth', sourceType: 'survey_photo', authorityLevel: 'primary_survey_evidence', fallback: false, reviewRequired: true, confidence: Math.max(...matches.map(match => match.confidence)), sourceReferences: matches.flatMap(match => match.sourcePhotoSlotKeys), evidenceLimitations: ['Photo-derived candidate is primary evidence truth but not measurement/CAD authority.'],
  });
}

function promoteLayer(layers: SourceTruthLayerProvenanceV1[], layerId: string, update: Partial<SourceTruthLayerProvenanceV1> & Pick<SourceTruthLayerProvenanceV1, 'classification' | 'sourceType' | 'authorityLevel' | 'fallback' | 'reviewRequired' | 'confidence' | 'sourceReferences' | 'evidenceLimitations'>): void {
  const layer = layers.find(item => item.layerId === layerId);
  if (!layer) return;
  layer.classification = update.classification;
  layer.sourceType = update.sourceType;
  layer.authorityLevel = update.authorityLevel;
  layer.fallback = update.fallback;
  layer.reviewRequired = update.reviewRequired;
  layer.confidence = Math.max(layer.confidence, update.confidence);
  layer.sourceReferences = unique([...layer.sourceReferences, ...update.sourceReferences]);
  layer.evidenceLimitations = unique([...layer.evidenceLimitations, ...update.evidenceLimitations]);
}

function reconcile(report: ProfessionalSurveyReadinessReportV1, reconstruction: EvidenceDerivedCadReconstructionV1, design: SourceOfTruthDesignHandoffV1 | null, moduleGroups: DesignTruthModuleGroupV1[], layers: SourceTruthLayerProvenanceV1[]): SourceOfTruthReconciliationV1 {
  const warnings: string[] = [];
  const flags: string[] = [];
  const designPanelCount = design?.layout?.totalPanels ?? design?.systemDefinition?.layout.totalPanels ?? null;
  const visiblePanelCount = moduleGroups.reduce((sum, group) => sum + group.panelCount, 0);
  if (!design) add('design_handoff_missing', 'No 3D design/layout handoff supplied; module/equipment placement remains fallback or survey-only review.');
  if (!designPanelCount) add('design_panel_count_missing', 'Design panel count is missing; fallback module count cannot be treated as design truth.');
  if (designPanelCount && visiblePanelCount && designPanelCount !== visiblePanelCount) add('panel_count_mismatch', `Design panel count ${designPanelCount} does not match rendered module count ${visiblePanelCount}.`);
  if (moduleGroups.some(group => group.fallback)) add('fallback_module_layout_used', 'A fallback module layout is visible on A-101.');
  if (!report.photoEvidence.coverage.roofOrMountCoverage) add('missing_install_area_photo_confirmation', 'No roof/mount survey photo coverage confirms install area.');
  if (!report.photoEvidence.coverage.obstructionCoverage && !(design?.systemDefinition?.obstructions?.length)) add('missing_obstruction_evidence', 'No obstruction photo evidence or design obstruction node is available.');
  const hasEquipmentPhoto = reconstruction.candidates.some(candidate => candidate.layerType === 'equipment_anchor_candidates' && candidate.reviewStatus !== 'fallback_only');
  const hasEquipmentDesign = designEquipmentRefs(design).length > 0;
  if (report.photoEvidence.coverage.electricalCoverage && !hasEquipmentPhoto) add('electrical_coverage_without_anchor', 'Electrical photo coverage exists but no accepted equipment anchor candidate was produced.');
  if (hasEquipmentDesign && !hasEquipmentPhoto) add('equipment_location_without_photo_support', 'Design equipment node exists without survey-photo anchor support.');
  if (design && report.canonicalGeometry.roofPlanes.length > 0) {
    const designAz = design.systemDefinition?.layout.azimuth ?? design.layout?.arrays?.[0]?.azimuthDeg;
    const designTilt = design.systemDefinition?.layout.tilt ?? design.layout?.arrays?.[0]?.tiltDeg;
    const plane = report.canonicalGeometry.roofPlanes[0];
    if (typeof designAz === 'number' && Math.abs(normalizeAngleDelta(designAz, plane.azimuthDeg)) > 35) add('install_plane_azimuth_mismatch', `Design azimuth ${designAz} differs from survey roof azimuth ${plane.azimuthDeg}.`);
    if (typeof designTilt === 'number' && Math.abs(designTilt - plane.pitchDeg) > 15) add('install_plane_tilt_pitch_mismatch', `Design tilt ${designTilt} differs from survey roof pitch ${plane.pitchDeg}.`);
  }
  const fallbackCount = layers.filter(layer => layer.fallback).length;
  if (fallbackCount > 0) add('visible_fallback_layers', `${fallbackCount} A-101 layer(s) are explicit fallback placeholders.`);
  const mismatchCount = flags.length;
  const status = !design && fallbackCount >= layers.length / 3 ? 'fallback_only' : mismatchCount > 0 ? 'review_required' : 'aligned';
  return { status, warnings, reviewRequiredFlags: flags, confidenceImpact: -Math.min(45, mismatchCount * 5 + fallbackCount * 2), mismatchCount };

  function add(flag: string, warning: string) {
    flags.push(flag);
    warnings.push(warning);
  }
}

function scoreAuthenticity(report: ProfessionalSurveyReadinessReportV1, reconstruction: EvidenceDerivedCadReconstructionV1, design: SourceOfTruthDesignHandoffV1 | null, layers: SourceTruthLayerProvenanceV1[], reconciliation: SourceOfTruthReconciliationV1) {
  const surveyPhotoTruthScore = Math.min(100, reconstruction.alignmentSummary.authenticityScore);
  const surveyMetadataTruthScore = report.canonicalGeometry.readyForCADInput ? 82 : report.canonicalGeometry.roofPlanes.length > 0 ? 58 : 18;
  const designTruthScore = design ? Math.min(100, 45 + (design.systemDefinition?.layout.totalPanels ? 20 : 0) + ((design.layout?.arrays?.length ?? 0) > 0 ? 20 : 0) + (designEquipmentRefs(design).length > 0 ? 10 : 0)) : 0;
  const provenanceCompletenessScore = Math.round((layers.filter(layer => layer.sourceReferences.length > 0 && layer.evidenceLimitations.length > 0).length / Math.max(1, layers.length)) * 100);
  const fallbackPenalty = Math.min(45, layers.filter(layer => layer.fallback).length * 5 + reconstruction.alignmentSummary.fallbackCandidateCount * 4 + (design ? 0 : 12));
  const score = clamp(Math.round(surveyPhotoTruthScore * 0.30 + surveyMetadataTruthScore * 0.20 + designTruthScore * 0.25 + provenanceCompletenessScore * 0.25 + reconciliation.confidenceImpact - fallbackPenalty), 0, 100);
  return { score, surveyPhotoTruthScore, surveyMetadataTruthScore, designTruthScore, provenanceCompletenessScore, fallbackPenalty };
}

function designEquipmentRefs(design: SourceOfTruthDesignHandoffV1 | null): string[] {
  return unique([...(design?.design3d?.equipmentPlacements?.map(item => item.id) ?? []), ...(design?.systemDefinition?.electricalNodes?.map(item => item.id) ?? [])]);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function normalizeAngleDelta(a: number, b: number): number {
  let delta = ((a - b + 540) % 360) - 180;
  if (delta === -180) delta = 180;
  return delta;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value && value.trim().length > 0))).sort();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function noAuthority(): SourceOfTruthCadRenderContextV1['noAuthorityEnforcement'] {
  return { readOnly: true, renderPreviewOnly: true, photoExtractionEngineeringAuthority: false, canonicalGeometryMutationAllowed: false, designMutationAllowed: false, cadMutationAllowed: false, cadSolverExecutionAllowed: false, persistenceAllowed: false, downstreamEngineeringAllowed: false, downstreamPermitAllowed: false, downstreamBomAllowed: false };
}

function deterministicHash(value: unknown): string {
  const json = stable(value);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h) ^ json.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
