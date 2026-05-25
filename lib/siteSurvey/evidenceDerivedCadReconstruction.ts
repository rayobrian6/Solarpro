import type { ProfessionalSurveyReadinessReportV1 } from './professionalSurveyReadinessReport';
import type { SurveyPhotoEvidenceCategoryV1, SurveyPhotoEvidenceV1 } from './surveyPhotoEvidence';

export type EvidenceReconstructionLayerTypeV1 =
  | 'photo_registration'
  | 'roof_edge_candidates'
  | 'install_area_candidates'
  | 'obstruction_candidates'
  | 'equipment_anchor_candidates'
  | 'conduit_anchor_candidates'
  | 'module_alignment_cues'
  | 'orientation_depth_cues'
  | 'fallback_disclosure';

export interface EvidenceReconstructionNoAuthorityV1 {
  readOnly: true;
  reviewOnly: true;
  automaticCadGenerationAllowed: false;
  automaticGeometryExtractionAuthoritative: false;
  canonicalGeometryMutationAllowed: false;
  cadMutationAllowed: false;
  cadSolverExecutionAllowed: false;
  persistenceAllowed: false;
  downstreamEngineeringAllowed: false;
  downstreamPermitAllowed: false;
  downstreamBomAllowed: false;
}

export interface EvidencePhotoFrameV1 {
  frameId: string;
  sourceSlotKey: string;
  category: SurveyPhotoEvidenceCategoryV1;
  confidence: SurveyPhotoEvidenceV1['classification']['confidence'];
  renderUsefulnessScore: number;
  normalizedFilename: string;
  imageSpace: { width: number; height: number; coordinateSystem: 'normalized_photo_space_0_1000' };
  ossAdapterSignals: string[];
}

export interface EvidenceDerivedCandidateV1 {
  candidateId: string;
  layerType: EvidenceReconstructionLayerTypeV1;
  sourcePhotoSlotKeys: string[];
  targetEntities: string[];
  confidence: number;
  reviewStatus: 'accepted_for_preview_reference' | 'operator_review_required' | 'fallback_only';
  imageRegion: { x: number; y: number; width: number; height: number; perspectiveSkewDeg: number };
  drawingRegion: { x: number; y: number; width: number; height: number; rotationDeg: number };
  label: string;
  evidenceSignals: string[];
  limitations: string[];
}

export interface EvidenceDerivedCadReconstructionV1 {
  schemaVersion: 'evidence_derived_cad_reconstruction_v1';
  mode: 'review_only_photo_aligned_spatial_candidates';
  sourceSurveyId: string;
  sourcePhotoEvidenceHash: string;
  sourceGeometryHash: string;
  photoFrames: EvidencePhotoFrameV1[];
  candidates: EvidenceDerivedCandidateV1[];
  fallbackDisclosures: string[];
  alignmentSummary: {
    acceptedPhotoFrameCount: number;
    evidenceAlignedCandidateCount: number;
    fallbackCandidateCount: number;
    geometryCorrelationScore: number;
    photoConsistencyScore: number;
    authenticityScore: number;
  };
  ossAdapters: Array<{ name: 'sharp' | 'exif-reader' | 'tesseract.js'; role: string; authoritative: false; loadedInThisPass: false }>;
  noAuthorityEnforcement: EvidenceReconstructionNoAuthorityV1;
  reconstructionHash: string;
  deterministicNotes: string[];
}

const CATEGORY_LAYER: Record<SurveyPhotoEvidenceCategoryV1, EvidenceReconstructionLayerTypeV1> = {
  roof_overview: 'roof_edge_candidates',
  roof_detail: 'roof_edge_candidates',
  obstruction: 'obstruction_candidates',
  meter: 'equipment_anchor_candidates',
  msp_electrical_panel: 'equipment_anchor_candidates',
  inverter_equipment: 'equipment_anchor_candidates',
  attic_rafter: 'orientation_depth_cues',
  ground_mount_area: 'install_area_candidates',
  fence_vertical_solar_area: 'install_area_candidates',
  unknown_review_needed: 'fallback_disclosure',
};

export function buildEvidenceDerivedCadReconstruction(report: ProfessionalSurveyReadinessReportV1): EvidenceDerivedCadReconstructionV1 {
  const accepted = report.photoEvidence.evidence.filter(photo => photo.classification.reviewStatus === 'accepted_for_render_reference');
  const usable = accepted.length > 0 ? accepted : report.photoEvidence.evidence.filter(photo => photo.classification.renderRelevance !== 'not_render_relevant');
  const photoFrames = usable.map((photo, index) => buildFrame(photo, index));
  const candidates = photoFrames.flatMap((frame, index) => buildCandidatesForFrame(report, frame, index));
  const fallbackDisclosures = buildFallbackDisclosures(report, photoFrames, candidates);
  const withFallback = fallbackDisclosures.length === 0 ? candidates : [...candidates, ...fallbackDisclosures.map((disclosure, index) => fallbackCandidate(report, disclosure, index))];
  const evidenceAlignedCandidateCount = withFallback.filter(candidate => candidate.reviewStatus === 'accepted_for_preview_reference').length;
  const fallbackCandidateCount = withFallback.filter(candidate => candidate.reviewStatus === 'fallback_only').length;
  const geometryCorrelationScore = scoreGeometryCorrelation(report, withFallback);
  const photoConsistencyScore = scorePhotoConsistency(report, photoFrames, withFallback);
  const authenticityScore = clamp(Math.round(geometryCorrelationScore * 0.38 + photoConsistencyScore * 0.42 + Math.min(100, evidenceAlignedCandidateCount * 14) * 0.20 - fallbackCandidateCount * 8), 0, 100);
  const withoutHash = {
    schemaVersion: 'evidence_derived_cad_reconstruction_v1' as const,
    mode: 'review_only_photo_aligned_spatial_candidates' as const,
    sourceSurveyId: report.source.surveyId,
    sourcePhotoEvidenceHash: report.photoEvidence.bundleHash,
    sourceGeometryHash: report.canonicalGeometry.geometryHash,
    photoFrames,
    candidates: withFallback,
    fallbackDisclosures,
    alignmentSummary: {
      acceptedPhotoFrameCount: accepted.length,
      evidenceAlignedCandidateCount,
      fallbackCandidateCount,
      geometryCorrelationScore,
      photoConsistencyScore,
      authenticityScore,
    },
    ossAdapters: [
      { name: 'sharp' as const, role: 'bounded image metadata, dimension normalization, and future edge-map preprocessing behind adapter boundaries', authoritative: false as const, loadedInThisPass: false as const },
      { name: 'exif-reader' as const, role: 'bounded EXIF orientation/capture metadata parsing when binary photo payloads are supplied', authoritative: false as const, loadedInThisPass: false as const },
      { name: 'tesseract.js' as const, role: 'bounded OCR assist for equipment labels and panel placards when explicitly invoked for review', authoritative: false as const, loadedInThisPass: false as const },
    ],
    noAuthorityEnforcement: noAuthority(),
    deterministicNotes: [
      'Legacy reconstruction V1 emits only review-only synthetic fallback spatial cues from photo categories and canonical geometry labels; it does not execute pixel CV or infer authoritative geometry.',
      'Real image-byte CV candidates, when available, come from the separate open-source photo vision worker bundle and are rendered with source tool/version/run hash labels.',
      'Candidates in this legacy module are fallback-only drawing aids, not CAD geometry, not measurements, and not permit/engineering authority.',
      'OSS utilities listed here are adapter boundaries only and are not loaded in this deterministic reconstruction pass.',
    ],
  };
  return { ...withoutHash, reconstructionHash: deterministicHash(withoutHash) };
}

function buildFrame(photo: SurveyPhotoEvidenceV1, index: number): EvidencePhotoFrameV1 {
  return {
    frameId: `photo-frame-${String(index + 1).padStart(2, '0')}`,
    sourceSlotKey: photo.source.slotKey,
    category: photo.classification.category,
    confidence: photo.classification.confidence,
    renderUsefulnessScore: photo.renderUsefulnessScore,
    normalizedFilename: photo.source.normalizedFilename,
    imageSpace: { width: 1000, height: 1000, coordinateSystem: 'normalized_photo_space_0_1000' },
    ossAdapterSignals: [
      'sharp adapter boundary available for deterministic image metadata/dimensions',
      'exif-reader adapter boundary available for orientation metadata',
      photo.classification.category === 'msp_electrical_panel' || photo.classification.category === 'meter' ? 'tesseract.js adapter boundary available for equipment label OCR review' : 'ocr adapter not requested for this category',
    ].sort(),
  };
}

function buildCandidatesForFrame(report: ProfessionalSurveyReadinessReportV1, frame: EvidencePhotoFrameV1, index: number): EvidenceDerivedCandidateV1[] {
  const layerType = CATEGORY_LAYER[frame.category];
  if (layerType === 'fallback_disclosure') return [];
  const base = baseRegion(frame.category, index);
  const targets = targetEntities(report, frame.category);
  const confidence = candidateConfidence(report, frame, targets.length);
  const reviewStatus: EvidenceDerivedCandidateV1['reviewStatus'] = 'fallback_only';
  const fallbackLimitations = legacySyntheticFallbackLimitations();
  const primary: EvidenceDerivedCandidateV1 = {
    candidateId: `${layerType}-${index + 1}`,
    layerType,
    sourcePhotoSlotKeys: [frame.sourceSlotKey],
    targetEntities: targets,
    confidence,
    reviewStatus,
    imageRegion: base.imageRegion,
    drawingRegion: base.drawingRegion,
    label: `LEGACY SYNTHETIC FALLBACK - ${labelFor(frame.category)}`,
    evidenceSignals: [
      `legacy synthetic normalized region for ${frame.category} photo slot ${frame.sourceSlotKey}`,
      `render usefulness ${frame.renderUsefulnessScore}/100 used only to order fallback review cues`,
      `correlated targets retained as labels only: ${targets.join(', ') || 'none'}`,
      'no real pixel CV detection was executed by this legacy reconstruction module',
      'real open-source photo vision candidates, when present, are rendered through the separate persisted worker bundle',
      ...frame.ossAdapterSignals.slice(0, 2).map(signal => `adapter boundary only: ${signal}`),
    ].sort(),
    limitations: fallbackLimitations,
  };
  const extras: EvidenceDerivedCandidateV1[] = [];
  if (frame.category === 'roof_overview' || frame.category === 'roof_detail' || frame.category === 'ground_mount_area' || frame.category === 'fence_vertical_solar_area') {
    extras.push({
      ...primary,
      candidateId: `module-alignment-cues-${index + 1}`,
      layerType: 'module_alignment_cues',
      confidence: clamp(confidence - 8, 0, 100),
      label: 'LEGACY SYNTHETIC FALLBACK - MODULE ALIGNMENT CUE',
      imageRegion: { x: base.imageRegion.x + 60, y: base.imageRegion.y + 80, width: Math.max(160, base.imageRegion.width - 120), height: Math.max(120, base.imageRegion.height - 160), perspectiveSkewDeg: base.imageRegion.perspectiveSkewDeg },
      drawingRegion: { x: base.drawingRegion.x + 42, y: base.drawingRegion.y + 44, width: Math.max(120, base.drawingRegion.width - 84), height: Math.max(90, base.drawingRegion.height - 88), rotationDeg: base.drawingRegion.rotationDeg },
      evidenceSignals: [...primary.evidenceSignals, 'synthetic module cue is category-based fallback only, not a detected module alignment'].sort(),
      limitations: fallbackLimitations,
    });
  }
  if (frame.category === 'meter' || frame.category === 'msp_electrical_panel' || frame.category === 'inverter_equipment') {
    extras.push({
      ...primary,
      candidateId: `conduit-anchor-candidates-${index + 1}`,
      layerType: 'conduit_anchor_candidates',
      confidence: clamp(confidence - 12, 0, 100),
      label: 'LEGACY SYNTHETIC FALLBACK - CONDUIT ANCHOR CUE',
      imageRegion: { x: 520, y: 460, width: 260, height: 320, perspectiveSkewDeg: 8 },
      drawingRegion: { x: 708, y: 628, width: 126, height: 88, rotationDeg: -18 },
      evidenceSignals: [...primary.evidenceSignals, 'synthetic conduit cue is category-based fallback only, not a detected electrical route or endpoint'].sort(),
      limitations: fallbackLimitations,
    });
  }
  return [primary, ...extras];
}

function baseRegion(category: SurveyPhotoEvidenceCategoryV1, index: number) {
  const jitter = (index % 3) * 22;
  if (category === 'meter' || category === 'msp_electrical_panel' || category === 'inverter_equipment') {
    return { imageRegion: { x: 590 - jitter, y: 250 + jitter, width: 250, height: 390, perspectiveSkewDeg: 4 + index }, drawingRegion: { x: 738 - jitter, y: 666 - jitter, width: 72, height: 64, rotationDeg: 0 } };
  }
  if (category === 'obstruction') {
    return { imageRegion: { x: 620 - jitter, y: 360, width: 180, height: 160, perspectiveSkewDeg: 11 }, drawingRegion: { x: 612 - jitter, y: 308 + jitter, width: 74, height: 52, rotationDeg: 6 } };
  }
  if (category === 'fence_vertical_solar_area') {
    return { imageRegion: { x: 120, y: 300 + jitter, width: 780, height: 260, perspectiveSkewDeg: 16 }, drawingRegion: { x: 148, y: 210 + jitter, width: 690, height: 242, rotationDeg: -8 } };
  }
  if (category === 'ground_mount_area') {
    return { imageRegion: { x: 120, y: 260 + jitter, width: 760, height: 440, perspectiveSkewDeg: 13 }, drawingRegion: { x: 132, y: 188 + jitter, width: 630, height: 408, rotationDeg: 0 } };
  }
  return { imageRegion: { x: 150, y: 170 + jitter, width: 700, height: 620, perspectiveSkewDeg: 9 }, drawingRegion: { x: 132, y: 150 + jitter, width: 626, height: 458, rotationDeg: 0 } };
}

function legacySyntheticFallbackLimitations(): string[] {
  return [
    'LEGACY SYNTHETIC FALLBACK ONLY / REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'Region coordinates are deterministic category-based placeholders, not detected from image pixels.',
    'This candidate cannot be accepted as evidence-derived CAD, cannot create measurements, and cannot mutate canonical geometry.',
    'Use the separate Open-Source Photo Vision Pass for actual image-byte review candidates with source tool/version/run hash.',
  ];
}

function targetEntities(report: ProfessionalSurveyReadinessReportV1, category: SurveyPhotoEvidenceCategoryV1): string[] {
  if (category === 'roof_overview' || category === 'roof_detail') return report.canonicalGeometry.roofPlanes.map(plane => `roofPlane.${plane.planeId}`).sort();
  if (category === 'ground_mount_area') return ['mountingSurface.ground'];
  if (category === 'fence_vertical_solar_area') return ['mountingSurface.fence'];
  if (category === 'obstruction') return report.summaries.obstructionCount > 0 ? ['survey.obstructionEvidence'] : ['photo.obstructionCandidate'];
  if (category === 'meter') return ['electrical.meter'];
  if (category === 'msp_electrical_panel') return ['electrical.mainServicePanel'];
  if (category === 'inverter_equipment') return ['electrical.inverterEquipment'];
  if (category === 'attic_rafter') return ['structural.rafters', 'structural.depthContext'];
  return [];
}

function candidateConfidence(report: ProfessionalSurveyReadinessReportV1, frame: EvidencePhotoFrameV1, targetCount: number): number {
  const confidenceBase = frame.confidence === 'high' ? 72 : frame.confidence === 'medium' ? 58 : 36;
  const geometryBonus = report.canonicalGeometry.readyForCADInput ? 12 : -10;
  const targetBonus = Math.min(12, targetCount * 4);
  const usefulness = Math.round(frame.renderUsefulnessScore * 0.18);
  return clamp(confidenceBase + geometryBonus + targetBonus + usefulness, 0, 100);
}

function labelFor(category: SurveyPhotoEvidenceCategoryV1): string {
  if (category === 'roof_overview' || category === 'roof_detail') return 'ROOF EDGE REVIEW CUE';
  if (category === 'ground_mount_area') return 'GROUND INSTALL AREA REVIEW CUE';
  if (category === 'fence_vertical_solar_area') return 'FENCE INSTALL RUN REVIEW CUE';
  if (category === 'obstruction') return 'OBSTRUCTION REVIEW CUE';
  if (category === 'meter' || category === 'msp_electrical_panel' || category === 'inverter_equipment') return 'EQUIPMENT ANCHOR REVIEW CUE';
  return 'ORIENTATION / DEPTH REVIEW CUE';
}

function buildFallbackDisclosures(report: ProfessionalSurveyReadinessReportV1, frames: EvidencePhotoFrameV1[], candidates: EvidenceDerivedCandidateV1[]): string[] {
  const disclosures: string[] = [];
  if (frames.length === 0) disclosures.push('No accepted survey photos available; A-101 geometry is existing survey/canonical fallback only.');
  if (!candidates.some(candidate => candidate.layerType === 'roof_edge_candidates' || candidate.layerType === 'install_area_candidates')) disclosures.push('No real worker roof/install-area candidate is available in this legacy reconstruction pass; mounting outline is fallback geometry only.');
  if (!candidates.some(candidate => candidate.layerType === 'equipment_anchor_candidates')) disclosures.push('No real worker equipment anchor is available in this legacy reconstruction pass; MSP/meter marker is evidence-coverage or placeholder fallback only.');
  if (report.summaries.obstructionCount > 0 && !candidates.some(candidate => candidate.layerType === 'obstruction_candidates')) disclosures.push('Survey has obstruction metadata without real worker obstruction candidates; obstruction drafting must remain review-only fallback.');
  return disclosures.sort();
}

function fallbackCandidate(report: ProfessionalSurveyReadinessReportV1, disclosure: string, index: number): EvidenceDerivedCandidateV1 {
  return {
    candidateId: `fallback-disclosure-${index + 1}`,
    layerType: 'fallback_disclosure',
    sourcePhotoSlotKeys: [],
    targetEntities: report.canonicalGeometry.roofPlanes.map(plane => `roofPlane.${plane.planeId}`).slice(0, 3),
    confidence: 0,
    reviewStatus: 'fallback_only',
    imageRegion: { x: 0, y: 0, width: 0, height: 0, perspectiveSkewDeg: 0 },
    drawingRegion: { x: 100 + index * 22, y: 610 + index * 28, width: 260, height: 24, rotationDeg: 0 },
    label: 'EXPLICIT FALLBACK DISCLOSURE',
    evidenceSignals: [disclosure],
    limitations: ['Synthetic or existing geometry fallback cannot increase evidence-alignment quality score.'],
  };
}

function scoreGeometryCorrelation(report: ProfessionalSurveyReadinessReportV1, candidates: EvidenceDerivedCandidateV1[]): number {
  const targetHits = candidates.filter(candidate => candidate.targetEntities.length > 0 && candidate.reviewStatus === 'accepted_for_preview_reference').length;
  const geometryBase = report.canonicalGeometry.readyForCADInput ? 48 : 22;
  return clamp(geometryBase + targetHits * 9 + Math.min(16, report.canonicalGeometry.roofPlanes.length * 4), 0, 100);
}

function scorePhotoConsistency(report: ProfessionalSurveyReadinessReportV1, frames: EvidencePhotoFrameV1[], candidates: EvidenceDerivedCandidateV1[]): number {
  const coverage = report.photoEvidence.coverage;
  const coverageBase = (coverage.roofOrMountCoverage ? 26 : 0) + (coverage.electricalCoverage ? 18 : 0) + (coverage.obstructionCoverage ? 10 : 0);
  const frameScore = Math.min(30, frames.length * 8 + coverage.highConfidencePhotoCount * 4);
  const candidateScore = Math.min(26, candidates.filter(candidate => candidate.reviewStatus === 'accepted_for_preview_reference').length * 5);
  return clamp(coverageBase + frameScore + candidateScore - coverage.reviewNeededPhotoCount * 4, 0, 100);
}

function noAuthority(): EvidenceReconstructionNoAuthorityV1 {
  return {
    readOnly: true,
    reviewOnly: true,
    automaticCadGenerationAllowed: false,
    automaticGeometryExtractionAuthoritative: false,
    canonicalGeometryMutationAllowed: false,
    cadMutationAllowed: false,
    cadSolverExecutionAllowed: false,
    persistenceAllowed: false,
    downstreamEngineeringAllowed: false,
    downstreamPermitAllowed: false,
    downstreamBomAllowed: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicHash(value: unknown): string {
  const json = stable(value);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = ((h << 5) + h) ^ json.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}
