import { describe, expect, it } from 'vitest';
import { buildCADReadinessMetadata } from './cadReadiness';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import type { SurveyEvidenceItem, SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';

function manifest(categories: SurveyEvidenceCategory[]): SurveyEvidenceManifest {
  return {
    manifestVersion: 1,
    projectId: 'project-cad-ready',
    surveyId: 'survey-cad-ready',
    generatedAt: '2025-01-01T00:00:00.000Z',
    sourceOfTruth: 'site_surveys+site_survey_files',
    surveyTechnician: 'Tech One',
    items: categories.map((category, index) => item(category, index)),
    coverage: [],
    requiredMissing: [],
    warnings: [],
    summary: {
      totalItems: categories.length,
      classifiedItems: categories.length,
      qualityCheckedItems: 0,
      duplicateCheckedItems: 0,
      aiProcessedItems: 0,
      engineeringReviewedItems: 0,
      permitConsumedItems: 0,
      confidence: 'medium',
      completeness: categories.length > 0 ? 'sufficient' : 'missing',
    },
    openSourceBoundaries: {
      webRuntime: [],
      pythonWorker: [],
      futureOnly: [],
    },
  };
}

function item(category: SurveyEvidenceCategory, index: number): SurveyEvidenceItem {
  return {
    evidenceId: `evidence-${index}`,
    projectId: 'project-cad-ready',
    surveyId: 'survey-cad-ready',
    siteSurveyFileId: `file-${index}`,
    projectFileId: null,
    fileUrl: `https://example.test/${category}.jpg`,
    blobKey: null,
    filename: `${category}.jpg`,
    mimeType: 'image/jpeg',
    submittedCategory: category,
    category,
    domain: 'site',
    processingStatus: 'uploaded',
    evidenceConfidence: 'medium',
    evidenceSource: 'site_survey_files',
    captureTimestamp: '2025-01-01T00:00:00.000Z',
    surveyTechnician: 'Tech One',
    image: {
      widthPx: null,
      heightPx: null,
      orientation: null,
    },
    quality: {
      blurScore: null,
      duplicateScore: null,
      warnings: [],
    },
    sceneGroup: null,
    processingHistory: [],
    aiExtractionStatus: 'not_started',
    engineeringUsageReferences: [],
  };
}

function evidenceSignals(): EngineeringSurveyEvidence {
  return {
    projectId: 'project-cad-ready',
    surveyId: 'survey-cad-ready',
    photos: [],
    rawPhotoCount: 0,
    canonicalEvidenceCount: 0,
    evidenceTruthSource: 'canonical_manifest_v1',
    fieldEvidence: {
      hasPhysicalData: true,
      hasRoofGeometry: true,
      hasElectricalData: true,
      hasStructuralData: true,
      roofPlaneCount: 2,
      obstructionCount: 1,
      usableAreaSqFt: 420,
      roofPitchDegrees: 27,
      roofMaterial: 'composition shingle',
      mainPanelRatingAmps: 200,
      busbarRatingAmps: 225,
      interconnectionPoint: 'load-side breaker',
      rafterSize: '2x6',
      rafterSpacingInches: 24,
    },
    requirementEvaluation: {
      readiness: 'needs_review',
      completeness: 'partial',
      confidenceSource: 'engineering_requirement_registry_v1',
      satisfiedRequirements: [],
      missingRequirements: [],
      partiallySatisfiedRequirements: [],
      blockedRequirements: [],
      informationalRequirements: [],
      inactiveRequirements: [],
      allRequirements: [],
      deterministicSummary: [],
    },
    missingCategories: [],
    completeness: 'partial',
    blockers: [],
    warnings: [],
    traceability: {
      evidenceTruthSource: 'canonical_manifest_v1',
      requirements: [],
      canonicalEvidence: [],
      surveyLineage: [],
      missingRequirements: [],
    },
    source: {
      pipelineVersion: 1,
      normalizedAt: '2025-01-01T00:00:00.000Z',
    },
  };
}

describe('CAD readiness metadata', () => {
  it('marks readiness from canonical evidence categories plus explicit survey signals', () => {
    const readiness = buildCADReadinessMetadata({
      canonicalManifest: manifest(['roof_plane', 'roof_edge', 'ridge', 'obstructions', 'main_service_panel', 'meter']),
      surveyEvidence: evidenceSignals(),
    });

    const roof = readiness.flags.find(flag => flag.flagId === 'roof-plane-ready');
    const routing = readiness.flags.find(flag => flag.flagId === 'routing-ready');
    const setback = readiness.flags.find(flag => flag.flagId === 'setback-ready');

    expect(readiness.modelVersion).toBe('cad_readiness_metadata_v1');
    expect(roof?.status).toBe('ready');
    expect(routing?.status).toBe('ready');
    expect(setback?.status).toBe('ready');
    expect(roof?.explicitSurveySignals).toEqual(expect.arrayContaining([
      'fieldEvidence.hasRoofGeometry',
      'fieldEvidence.roofMaterial',
      'fieldEvidence.roofPitchDegrees',
      'fieldEvidence.roofPlaneCount:2',
    ]));
    expect(routing?.explicitSurveySignals).toEqual(expect.arrayContaining([
      'fieldEvidence.hasElectricalData',
      'fieldEvidence.interconnectionPoint:load-side breaker',
      'fieldEvidence.mainPanelRatingAmps',
    ]));
  });

  it('blocks trench and detached readiness when explicit categories are absent', () => {
    const readiness = buildCADReadinessMetadata({
      canonicalManifest: manifest(['overview', 'roof_plane', 'main_service_panel']),
      surveyEvidence: evidenceSignals(),
    });

    expect(readiness.flags.find(flag => flag.flagId === 'trench-route-ready')?.status).toBe('blocked');
    expect(readiness.flags.find(flag => flag.flagId === 'detached-structure-ready')?.status).toBe('blocked');
    expect(readiness.blockedFlags).toEqual(expect.arrayContaining(['trench-route-ready', 'detached-structure-ready']));
  });

  it('does not expose runtime CAD, CV, OCR, YOLO, or image-byte behavior', () => {
    const readiness = buildCADReadinessMetadata();

    expect(readiness.prohibitedRuntimeBehavior).toEqual(expect.arrayContaining([
      'no operator-free plan-output creation',
      'no pixel inspection or image-byte inspection',
      'no text extraction runtime over survey imagery',
      'no computer-vision runtime dependency',
      'no vision model runtime dependency',
      'no geometry fabrication',
    ]));
    expect(readiness.deterministicNotes.join(' ')).toContain('metadata only');
    expect(readiness.flags.every(flag => ['ready', 'partial', 'blocked', 'not_applicable'].includes(flag.status))).toBe(true);
  });
});
