import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import type { SurveyEvidenceManifest } from '@/lib/survey/evidence/manifest';

export type CADReadinessFlagId =
  | 'roof-plane-ready'
  | 'routing-ready'
  | 'setback-ready'
  | 'trench-route-ready'
  | 'detached-structure-ready';

export type CADReadinessStatus = 'ready' | 'partial' | 'blocked' | 'not_applicable';

export interface CADReadinessFlag {
  flagId: CADReadinessFlagId;
  status: CADReadinessStatus;
  satisfiedCategories: SurveyEvidenceCategory[];
  missingCategories: SurveyEvidenceCategory[];
  explicitSurveySignals: string[];
  deterministicReason: string;
}

export interface CADReadinessMetadataModel {
  modelVersion: 'cad_readiness_metadata_v1';
  projectId: string | null;
  surveyId: string | null;
  flags: CADReadinessFlag[];
  readyFlags: CADReadinessFlagId[];
  blockedFlags: CADReadinessFlagId[];
  partialFlags: CADReadinessFlagId[];
  deterministicNotes: string[];
  prohibitedRuntimeBehavior: string[];
}

interface CADReadinessRule {
  flagId: CADReadinessFlagId;
  requiredAnyCategories: SurveyEvidenceCategory[];
  supportiveCategories: SurveyEvidenceCategory[];
  surveySignal: (evidence: EngineeringSurveyEvidence | null | undefined) => string[];
  reason: string;
}

const RULES: CADReadinessRule[] = [
  {
    flagId: 'roof-plane-ready',
    requiredAnyCategories: ['roof_plane'],
    supportiveCategories: ['ridge', 'roof_edge', 'roof_surface', 'attic_access', 'rafters'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if (evidence?.fieldEvidence.hasRoofGeometry) signals.push('fieldEvidence.hasRoofGeometry');
      if ((evidence?.fieldEvidence.roofPlaneCount ?? 0) > 0) signals.push(`fieldEvidence.roofPlaneCount:${evidence?.fieldEvidence.roofPlaneCount}`);
      if (evidence?.fieldEvidence.roofPitchDegrees !== null && evidence?.fieldEvidence.roofPitchDegrees !== undefined) signals.push('fieldEvidence.roofPitchDegrees');
      if (evidence?.fieldEvidence.roofMaterial) signals.push('fieldEvidence.roofMaterial');
      return signals;
    },
    reason: 'Roof-plane readiness requires explicit roof-plane canonical evidence or explicit roof geometry fields, with supporting ridge/edge/surface/framing context when available.',
  },
  {
    flagId: 'routing-ready',
    requiredAnyCategories: ['main_service_panel', 'meter', 'utility_connection', 'disconnect', 'inverter_location', 'garage_interior_wall'],
    supportiveCategories: ['grounding', 'subpanel', 'utility_access', 'battery_location', 'gateway_location'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if (evidence?.fieldEvidence.hasElectricalData) signals.push('fieldEvidence.hasElectricalData');
      if (evidence?.fieldEvidence.interconnectionPoint) signals.push(`fieldEvidence.interconnectionPoint:${evidence.fieldEvidence.interconnectionPoint}`);
      if (evidence?.fieldEvidence.mainPanelRatingAmps !== null && evidence?.fieldEvidence.mainPanelRatingAmps !== undefined) signals.push('fieldEvidence.mainPanelRatingAmps');
      return signals;
    },
    reason: 'Routing readiness requires explicit electrical/service evidence and/or explicit interconnection fields sufficient to trace route context.',
  },
  {
    flagId: 'setback-ready',
    requiredAnyCategories: ['roof_edge', 'ridge', 'obstructions'],
    supportiveCategories: ['roof_plane', 'roof_surface'],
    surveySignal: evidence => {
      const signals: string[] = [];
      if ((evidence?.fieldEvidence.obstructionCount ?? 0) > 0) signals.push(`fieldEvidence.obstructionCount:${evidence?.fieldEvidence.obstructionCount}`);
      if (evidence?.fieldEvidence.usableAreaSqFt !== null && evidence?.fieldEvidence.usableAreaSqFt !== undefined) signals.push('fieldEvidence.usableAreaSqFt');
      return signals;
    },
    reason: 'Setback readiness requires explicit edge/ridge/obstruction categories or explicit usable-area/obstruction survey fields.',
  },
  {
    flagId: 'trench-route-ready',
    requiredAnyCategories: ['trench_path'],
    supportiveCategories: ['overview', 'utility_access', 'utility_connection', 'detached_structures'],
    surveySignal: () => [],
    reason: 'Trench-route readiness requires explicit trench-path evidence; it is never inferred from generic exterior photos alone.',
  },
  {
    flagId: 'detached-structure-ready',
    requiredAnyCategories: ['detached_structures'],
    supportiveCategories: ['overview', 'roof_plane', 'trench_path'],
    surveySignal: () => [],
    reason: 'Detached-structure readiness requires explicit detached-structure evidence or remains blocked/not applicable depending project scope.',
  },
];

export function buildCADReadinessMetadata(input: {
  projectId?: string | null;
  surveyId?: string | null;
  canonicalManifest?: SurveyEvidenceManifest | null;
  surveyEvidence?: EngineeringSurveyEvidence | null;
} = {}): CADReadinessMetadataModel {
  const categories = categoriesFrom(input.canonicalManifest, input.surveyEvidence);
  const flags = RULES.map(rule => evaluateRule(rule, categories, input.surveyEvidence));
  return {
    modelVersion: 'cad_readiness_metadata_v1',
    projectId: input.projectId ?? input.canonicalManifest?.projectId ?? input.surveyEvidence?.projectId ?? null,
    surveyId: input.surveyId ?? input.canonicalManifest?.surveyId ?? input.surveyEvidence?.surveyId ?? null,
    flags,
    readyFlags: flags.filter(flag => flag.status === 'ready').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    blockedFlags: flags.filter(flag => flag.status === 'blocked').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    partialFlags: flags.filter(flag => flag.status === 'partial').map(flag => flag.flagId).sort((a, b) => a.localeCompare(b)),
    deterministicNotes: [
      'CAD readiness metadata is deterministic metadata only; it does not run CAD generation.',
      'Readiness is derived from canonical evidence categories and explicit survey physical fields only.',
      'Image bytes, OCR, OpenCV, YOLO, semantic inference, and hallucinated geometry are not used.',
    ],
    prohibitedRuntimeBehavior: [
      'no autonomous CAD generation',
      'no image-byte analysis',
      'no OCR runtime',
      'no OpenCV runtime',
      'no YOLO runtime',
      'no hallucinated geometry',
    ],
  };
}

function evaluateRule(
  rule: CADReadinessRule,
  categories: SurveyEvidenceCategory[],
  evidence: EngineeringSurveyEvidence | null | undefined,
): CADReadinessFlag {
  const categorySet = new Set(categories);
  const satisfiedRequired = rule.requiredAnyCategories.filter(category => categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const supportive = rule.supportiveCategories.filter(category => categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const signals = rule.surveySignal(evidence).sort((a, b) => a.localeCompare(b));
  const missingCategories = rule.requiredAnyCategories.filter(category => !categorySet.has(category)).sort((a, b) => a.localeCompare(b));
  const hasPrimary = satisfiedRequired.length > 0;
  const hasExplicitSignal = signals.length > 0;
  const status: CADReadinessStatus = hasPrimary && (supportive.length > 0 || hasExplicitSignal)
    ? 'ready'
    : hasPrimary || hasExplicitSignal
      ? 'partial'
      : 'blocked';

  return {
    flagId: rule.flagId,
    status,
    satisfiedCategories: [...satisfiedRequired, ...supportive].sort((a, b) => a.localeCompare(b)),
    missingCategories,
    explicitSurveySignals: signals,
    deterministicReason: `${rule.reason} Status ${status} from categories [${[...satisfiedRequired, ...supportive].sort((a, b) => a.localeCompare(b)).join(', ') || 'none'}] and explicit signals [${signals.join(', ') || 'none'}].`,
  };
}

function categoriesFrom(
  manifest: SurveyEvidenceManifest | null | undefined,
  evidence: EngineeringSurveyEvidence | null | undefined,
): SurveyEvidenceCategory[] {
  return Array.from(new Set([
    ...(manifest?.items.map(item => item.category) ?? []),
    ...(evidence?.photos.map(photo => photo.category) ?? []),
  ])).sort((a, b) => a.localeCompare(b));
}
