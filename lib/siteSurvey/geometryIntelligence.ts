import {
  buildGeometryComparisonReport,
  type GeometryAdapterObservationV1,
  type GeometryComparisonReportV1,
} from './geometryComparisonAdapter';
import type {
  CanonicalSurveyGeometryV1,
  ProfessionalSiteSurveyEvidenceBundleV1,
  ProfessionalSurveyAuthorityFlagsV1,
  SurveyCADReadinessV1,
} from './professionalSurveyParser';

export type GeometryIntelligenceRiskCategory =
  | 'low_confidence_geometry'
  | 'topology_disagreement'
  | 'unsupported_polygon_structures'
  | 'overlapping_geometry'
  | 'malformed_obstruction_geometry'
  | 'missing_critical_orientation_data'
  | 'invalid_unit_normalization'
  | 'conflicting_survey_evidence'
  | 'near_zero_geometry_projections'
  | 'readiness_downgrade_conditions';

export type GeometryIntelligenceSeverity = 'info' | 'warning' | 'error';
export type GeometryRiskClassification = 'low' | 'moderate' | 'high' | 'critical';
export type GeometryReviewUrgency = 'none' | 'routine_review' | 'priority_review' | 'blocker_review';
export type GeometryReadinessImpact = 'none' | 'review_recommended' | 'readiness_trust_degraded' | 'native_blocked';

export interface GeometryRiskSignalV1 {
  category: GeometryIntelligenceRiskCategory;
  severity: GeometryIntelligenceSeverity;
  confidenceImpact: number;
  readinessImpact: GeometryReadinessImpact;
  affectedEntities: string[];
  recommendedReviewAction: string;
  evidenceSummary: string;
}

export interface DiscrepancySeverityScoreV1 {
  category: string;
  affectedEntities: string[];
  severity: GeometryIntelligenceSeverity;
  scoreImpact: number;
  readinessImpact: GeometryReadinessImpact;
  evidenceSummary: string;
}

export interface DiscrepancyClusterV1 {
  clusterId: string;
  categories: string[];
  affectedEntities: string[];
  highestSeverity: GeometryIntelligenceSeverity;
  scoreImpact: number;
  summary: string;
}

export interface GeometryIntelligenceReportV1 {
  schemaVersion: 'geometry_intelligence_v1';
  mode: 'deterministic_read_only_review_intelligence';
  sourceSurveyId: string;
  sourceBundleHash: string;
  sourceGeometryHash: string;
  sourceReadinessHash: string;
  sourceComparisonHash: string;
  intelligenceHash: string;
  scores: {
    geometryConfidenceScore: number;
    topologyIntegrityScore: number;
    readinessTrustScore: number;
    discrepancySeverityScore: number;
  };
  classification: {
    geometryRisk: GeometryRiskClassification;
    reviewUrgency: GeometryReviewUrgency;
    discrepancySeverity: GeometryIntelligenceSeverity;
  };
  risks: GeometryRiskSignalV1[];
  discrepancyScores: DiscrepancySeverityScoreV1[];
  discrepancyClusters: DiscrepancyClusterV1[];
  summaries: {
    integritySummary: string;
    disagreementSummary: string;
    falsePositiveTracking: string[];
    falseNegativeTracking: string[];
    topologyConfidenceDegradation: string[];
    reviewActions: string[];
  };
  authorityFlags: ProfessionalSurveyAuthorityFlagsV1;
  noAuthorityEnforcement: {
    readOnly: true;
    canonicalGeometryMutationAllowed: false;
    cadMutationAllowed: false;
    cadSolverExecutionAllowed: false;
    persistenceAllowed: false;
    readinessPromotionAllowed: false;
    engineeringAuthorityAllowed: false;
  };
  deterministicNotes: string[];
}

export interface BuildGeometryIntelligenceInputV1 {
  evidence: ProfessionalSiteSurveyEvidenceBundleV1;
  canonicalGeometry: CanonicalSurveyGeometryV1;
  cadReadiness: SurveyCADReadinessV1;
  comparisonReport?: GeometryComparisonReportV1;
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

const SEVERITY_RANK: Record<GeometryIntelligenceSeverity, number> = { info: 1, warning: 2, error: 3 };

export function buildGeometryIntelligenceReport(input: BuildGeometryIntelligenceInputV1): GeometryIntelligenceReportV1 {
  const comparisonReport = input.comparisonReport ?? buildGeometryComparisonReport(input.canonicalGeometry);
  const risks = dedupeRisks([
    ...risksFromEvidence(input.evidence),
    ...risksFromCanonicalGeometry(input.canonicalGeometry),
    ...risksFromReadiness(input.cadReadiness),
    ...risksFromComparison(comparisonReport),
  ]);
  const discrepancyScores = scoreDiscrepancies(comparisonReport.observations);
  const discrepancyClusters = clusterDiscrepancies(discrepancyScores);
  const scores = buildScores(input, comparisonReport, risks, discrepancyScores);
  const classification = classify(scores, risks);
  const summaries = buildSummaries(input, comparisonReport, risks, discrepancyScores, discrepancyClusters);

  const withoutHash = {
    schemaVersion: 'geometry_intelligence_v1' as const,
    mode: 'deterministic_read_only_review_intelligence' as const,
    sourceSurveyId: input.evidence.surveyId,
    sourceBundleHash: input.evidence.bundleHash,
    sourceGeometryHash: input.canonicalGeometry.geometryHash,
    sourceReadinessHash: input.cadReadiness.readinessHash,
    sourceComparisonHash: comparisonReport.resultHash,
    scores,
    classification,
    risks,
    discrepancyScores,
    discrepancyClusters,
    summaries,
    authorityFlags: NO_AUTHORITY_FLAGS,
    noAuthorityEnforcement: {
      readOnly: true as const,
      canonicalGeometryMutationAllowed: false as const,
      cadMutationAllowed: false as const,
      cadSolverExecutionAllowed: false as const,
      persistenceAllowed: false as const,
      readinessPromotionAllowed: false as const,
      engineeringAuthorityAllowed: false as const,
    },
    deterministicNotes: [
      'Geometry Intelligence V1 is deterministic, review-only, and non-authoritative.',
      'Scores describe trust and review urgency; they do not mutate canonical geometry, CAD previews, persistence, or readiness states.',
      'Native SolarPro parser, canonical geometry, CAD readiness, engineering, permit, and BOM authority remain primary.',
      'OSS comparison signals are used only as explanatory risk evidence and discrepancy intelligence.',
    ],
  };

  return { ...withoutHash, intelligenceHash: deterministicHash(withoutHash) };
}

export function buildOperatorGeometryIntelligenceSummary(report: GeometryIntelligenceReportV1) {
  return {
    schemaVersion: 'operator_geometry_intelligence_summary_v1' as const,
    geometryTrustScore: report.scores.geometryConfidenceScore,
    topologyIntegrityScore: report.scores.topologyIntegrityScore,
    readinessTrustScore: report.scores.readinessTrustScore,
    riskLevel: report.classification.geometryRisk,
    discrepancySeverity: report.classification.discrepancySeverity,
    reviewUrgency: report.classification.reviewUrgency,
    integritySummary: report.summaries.integritySummary,
    topRiskCategories: report.risks.slice(0, 5).map(risk => risk.category),
    reviewActions: report.summaries.reviewActions.slice(0, 5),
    nonAuthoritative: true as const,
  };
}

function risksFromEvidence(evidence: ProfessionalSiteSurveyEvidenceBundleV1): GeometryRiskSignalV1[] {
  const risks: GeometryRiskSignalV1[] = [];
  for (const candidate of evidence.roofGeometryCandidates) {
    if (candidate.confidence !== 'high') {
      risks.push({
        category: 'low_confidence_geometry',
        severity: candidate.confidence === 'low' ? 'warning' : 'info',
        confidenceImpact: candidate.confidence === 'low' ? 16 : 8,
        readinessImpact: candidate.confidence === 'low' ? 'readiness_trust_degraded' : 'review_recommended',
        affectedEntities: [candidate.planeId],
        recommendedReviewAction: 'Review roof plane source capture, pitch, azimuth, vertices, and area evidence before relying on geometry for CAD planning.',
        evidenceSummary: `Roof geometry candidate ${candidate.planeId} has ${candidate.confidence} parser confidence.`,
      });
    }
    if (candidate.vertexCount < 3 || candidate.hasSelfIntersection) {
      risks.push({
        category: 'unsupported_polygon_structures',
        severity: 'error',
        confidenceImpact: 30,
        readinessImpact: 'native_blocked',
        affectedEntities: [candidate.planeId],
        recommendedReviewAction: 'Recapture or manually inspect polygon vertices before CAD preview or downstream engineering review.',
        evidenceSummary: `Roof geometry candidate ${candidate.planeId} has unsupported polygon structure: ${candidate.issues.join('; ') || 'invalid vertex topology'}.`,
      });
    }
    if (!Number.isFinite(candidate.pitchDeg) || candidate.pitchDeg < 0 || candidate.pitchDeg > 75 || !Number.isFinite(candidate.azimuthDeg) || candidate.azimuthDeg < 0 || candidate.azimuthDeg >= 360) {
      risks.push({
        category: 'missing_critical_orientation_data',
        severity: 'warning',
        confidenceImpact: 18,
        readinessImpact: 'readiness_trust_degraded',
        affectedEntities: [candidate.planeId],
        recommendedReviewAction: 'Verify roof plane pitch and azimuth from survey evidence before layout or production modeling.',
        evidenceSummary: `Roof geometry candidate ${candidate.planeId} has missing or unsupported pitch/azimuth values.`,
      });
    }
  }

  if (!evidence.extractedFields.hasLocation) {
    risks.push({
      category: 'invalid_unit_normalization',
      severity: 'warning',
      confidenceImpact: 20,
      readinessImpact: 'readiness_trust_degraded',
      affectedEntities: ['survey.location'],
      recommendedReviewAction: 'Confirm site location and projection origin before trusting local XY geometry.',
      evidenceSummary: 'Survey lacks a complete latitude/longitude origin for projection and unit normalization.',
    });
  }

  if (evidence.missingRequiredFields.length > 0) {
    risks.push({
      category: 'conflicting_survey_evidence',
      severity: 'warning',
      confidenceImpact: Math.min(24, evidence.missingRequiredFields.length * 6),
      readinessImpact: 'readiness_trust_degraded',
      affectedEntities: evidence.missingRequiredFields,
      recommendedReviewAction: 'Resolve missing required survey fields before treating readiness as operationally reliable.',
      evidenceSummary: `Missing required fields: ${evidence.missingRequiredFields.join(', ')}.`,
    });
  }

  return risks;
}

function risksFromCanonicalGeometry(geometry: CanonicalSurveyGeometryV1): GeometryRiskSignalV1[] {
  const risks: GeometryRiskSignalV1[] = [];
  if (!geometry.origin) {
    risks.push({
      category: 'invalid_unit_normalization',
      severity: 'warning',
      confidenceImpact: 18,
      readinessImpact: 'readiness_trust_degraded',
      affectedEntities: ['canonicalGeometry.origin'],
      recommendedReviewAction: 'Verify source GPS and projection origin before using canonical geometry for CAD preview.',
      evidenceSummary: 'Canonical geometry has no projection origin.',
    });
  }

  for (const plane of geometry.roofPlanes) {
    if (!plane.valid) {
      risks.push({
        category: 'unsupported_polygon_structures',
        severity: 'error',
        confidenceImpact: 32,
        readinessImpact: 'native_blocked',
        affectedEntities: [plane.planeId],
        recommendedReviewAction: 'Correct or recapture invalid roof plane geometry through review workflow; do not auto-correct.',
        evidenceSummary: `Canonical plane ${plane.planeId} is invalid: ${plane.issues.join('; ') || 'unknown issue'}.`,
      });
    }
    if (plane.polygon.length >= 3 && polygonAreaAbs(plane.polygon) <= 1e-6) {
      risks.push({
        category: 'near_zero_geometry_projections',
        severity: 'warning',
        confidenceImpact: 22,
        readinessImpact: 'readiness_trust_degraded',
        affectedEntities: [plane.planeId],
        recommendedReviewAction: 'Review coordinate projection and source units; near-zero projected roof planes should not be trusted for layout decisions.',
        evidenceSummary: `Canonical plane ${plane.planeId} projects to near-zero local area (${polygonAreaAbs(plane.polygon).toExponential(3)} m²).`,
      });
    }
  }

  return risks;
}

function risksFromReadiness(readiness: SurveyCADReadinessV1): GeometryRiskSignalV1[] {
  if (readiness.readinessStatus === 'cad_ready' && readiness.blockingIssues.length === 0 && readiness.requiredReviewItems.length === 0) return [];
  return [{
    category: 'readiness_downgrade_conditions',
    severity: readiness.readinessStatus === 'blocked' ? 'error' : 'warning',
    confidenceImpact: readiness.readinessStatus === 'blocked' ? 34 : 16,
    readinessImpact: readiness.readinessStatus === 'blocked' ? 'native_blocked' : 'readiness_trust_degraded',
    affectedEntities: [...readiness.blockingIssues, ...readiness.requiredReviewItems].length > 0
      ? [...readiness.blockingIssues, ...readiness.requiredReviewItems]
      : ['cadReadiness'],
    recommendedReviewAction: 'Review readiness blockers and required review items before any downstream CAD or engineering phase.',
    evidenceSummary: `CAD readiness is ${readiness.readinessStatus}; canBuildCADInput=${readiness.canBuildCADInput}.`,
  }];
}

function risksFromComparison(comparison: GeometryComparisonReportV1): GeometryRiskSignalV1[] {
  const risks: GeometryRiskSignalV1[] = [];
  for (const observation of comparison.observations) {
    risks.push(riskFromObservation(observation));
  }

  for (const topology of comparison.comparisons) {
    const nearZero = topology.warnings.some(warning => warning.includes('zero or nearly zero'));
    if (nearZero) {
      risks.push({
        category: 'near_zero_geometry_projections',
        severity: 'warning',
        confidenceImpact: 22,
        readinessImpact: 'readiness_trust_degraded',
        affectedEntities: [topology.polygonId],
        recommendedReviewAction: 'Review projected polygon area and source unit assumptions before trusting geometry.',
        evidenceSummary: `OSS comparison flagged ${topology.polygonId} as zero or nearly zero projected area.`,
      });
    }
  }

  return risks;
}

function riskFromObservation(observation: GeometryAdapterObservationV1): GeometryRiskSignalV1 {
  const severity = observation.severity;
  const base = severity === 'error' ? 30 : severity === 'warning' ? 18 : 8;
  const category: GeometryIntelligenceRiskCategory = observation.category === 'overlap_mismatch' || observation.category === 'clipping_disagreement'
    ? 'overlapping_geometry'
    : observation.category === 'self_intersection_disagreement' || observation.category === 'polygon_validity_disagreement'
      ? 'topology_disagreement'
      : observation.category === 'duplicate_edge_disagreement'
        ? 'unsupported_polygon_structures'
        : 'topology_disagreement';
  return {
    category,
    severity,
    confidenceImpact: base,
    readinessImpact: observation.readinessImpact === 'would_block_native_if_authoritative'
      ? 'readiness_trust_degraded'
      : observation.readinessImpact === 'review_recommended'
        ? 'review_recommended'
        : 'none',
    affectedEntities: observation.affectedGeometryEntities,
    recommendedReviewAction: observation.recommendedReviewAction,
    evidenceSummary: observation.comparisonSummary,
  };
}

function scoreDiscrepancies(observations: GeometryAdapterObservationV1[]): DiscrepancySeverityScoreV1[] {
  return observations.map(observation => {
    const scoreImpact = observation.severity === 'error' ? 30 : observation.severity === 'warning' ? 18 : 8;
    return {
      category: observation.category,
      affectedEntities: observation.affectedGeometryEntities,
      severity: observation.severity,
      scoreImpact,
      readinessImpact: observation.readinessImpact === 'would_block_native_if_authoritative'
        ? 'readiness_trust_degraded'
        : observation.readinessImpact === 'review_recommended'
          ? 'review_recommended'
          : 'none',
      evidenceSummary: observation.comparisonSummary,
    };
  });
}

function clusterDiscrepancies(scores: DiscrepancySeverityScoreV1[]): DiscrepancyClusterV1[] {
  const groups = new Map<string, DiscrepancySeverityScoreV1[]>();
  for (const score of scores) {
    const key = score.affectedEntities.slice().sort().join('|') || 'survey';
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
  return Array.from(groups.entries()).map(([key, group], index) => {
    const categories = dedupe(group.map(item => item.category)).sort();
    const affectedEntities = dedupe(group.flatMap(item => item.affectedEntities)).sort();
    const highestSeverity = group.reduce<GeometryIntelligenceSeverity>((highest, item) => SEVERITY_RANK[item.severity] > SEVERITY_RANK[highest] ? item.severity : highest, 'info');
    const scoreImpact = clamp(Math.round(group.reduce((sum, item) => sum + item.scoreImpact, 0)), 0, 100);
    return {
      clusterId: `discrepancy_cluster_${index + 1}_${deterministicHash({ key, categories, affectedEntities }).slice(0, 8)}`,
      categories,
      affectedEntities,
      highestSeverity,
      scoreImpact,
      summary: `${group.length} discrepancy signal(s) affect ${affectedEntities.join(', ') || 'survey geometry'}: ${categories.join(', ')}.`,
    };
  }).sort((a, b) => b.scoreImpact - a.scoreImpact || a.clusterId.localeCompare(b.clusterId));
}

function buildScores(
  input: BuildGeometryIntelligenceInputV1,
  comparison: GeometryComparisonReportV1,
  risks: GeometryRiskSignalV1[],
  discrepancies: DiscrepancySeverityScoreV1[],
) {
  const evidencePenalty = input.evidence.roofGeometryCandidates.reduce((sum, candidate) => sum + (candidate.confidence === 'high' ? 0 : candidate.confidence === 'medium' ? 6 : 14), 0)
    + input.evidence.missingRequiredFields.length * 5
    + input.evidence.blockingIssues.length * 18;
  const geometryPenalty = input.canonicalGeometry.roofPlanes.filter(plane => !plane.valid).length * 24
    + input.canonicalGeometry.warnings.length * 6
    + (input.canonicalGeometry.origin ? 0 : 16);
  const ossPenalty = comparison.ossComparisonResult.invalidPolygonCount * 16
    + comparison.ossComparisonResult.selfIntersectingPolygonCount * 20
    + comparison.ossComparisonResult.duplicateEdgePolygonCount * 12
    + comparison.ossComparisonResult.overlappingPairCount * 14
    + comparison.ossComparisonResult.clippingFailureCount * 10;
  const riskPenalty = Math.min(42, Math.round(risks.reduce((sum, risk) => sum + risk.confidenceImpact, 0) * 0.35));
  const discrepancyPenalty = Math.min(70, discrepancies.reduce((sum, discrepancy) => sum + discrepancy.scoreImpact, 0));
  const readinessPenalty = input.cadReadiness.readinessStatus === 'blocked' ? 45 : input.cadReadiness.readinessStatus === 'review_required' ? 22 : input.cadReadiness.requiredReviewItems.length * 4;

  return {
    geometryConfidenceScore: clamp(100 - evidencePenalty - geometryPenalty - Math.round(ossPenalty * 0.6), 0, 100),
    topologyIntegrityScore: clamp(100 - geometryPenalty - ossPenalty - Math.round(discrepancyPenalty * 0.3), 0, 100),
    readinessTrustScore: clamp(100 - readinessPenalty - riskPenalty - Math.round(discrepancyPenalty * 0.25), 0, 100),
    discrepancySeverityScore: clamp(discrepancyPenalty, 0, 100),
  };
}

function classify(scores: GeometryIntelligenceReportV1['scores'], risks: GeometryRiskSignalV1[]): GeometryIntelligenceReportV1['classification'] {
  const minTrust = Math.min(scores.geometryConfidenceScore, scores.topologyIntegrityScore, scores.readinessTrustScore);
  const hasError = risks.some(risk => risk.severity === 'error');
  const geometryRisk: GeometryRiskClassification = hasError || minTrust < 35
    ? 'critical'
    : minTrust < 60
      ? 'high'
      : minTrust < 82
        ? 'moderate'
        : 'low';
  const reviewUrgency: GeometryReviewUrgency = geometryRisk === 'critical'
    ? 'blocker_review'
    : geometryRisk === 'high'
      ? 'priority_review'
      : geometryRisk === 'moderate'
        ? 'routine_review'
        : 'none';
  const discrepancySeverity: GeometryIntelligenceSeverity = scores.discrepancySeverityScore >= 30 ? 'error' : scores.discrepancySeverityScore >= 12 ? 'warning' : 'info';
  return { geometryRisk, reviewUrgency, discrepancySeverity };
}

function buildSummaries(
  input: BuildGeometryIntelligenceInputV1,
  comparison: GeometryComparisonReportV1,
  risks: GeometryRiskSignalV1[],
  discrepancies: DiscrepancySeverityScoreV1[],
  clusters: DiscrepancyClusterV1[],
): GeometryIntelligenceReportV1['summaries'] {
  const riskCategories = dedupe(risks.map(risk => risk.category));
  const integritySummary = risks.length === 0
    ? 'Geometry intelligence found no trust degradation signals; native readiness and OSS comparison are aligned for review purposes.'
    : `Geometry intelligence found ${risks.length} risk signal(s) across ${riskCategories.length} category(s): ${riskCategories.join(', ')}.`;
  const disagreementSummary = discrepancies.length === 0
    ? 'No native-vs-OSS discrepancy signals were observed.'
    : `${discrepancies.length} discrepancy signal(s) clustered into ${clusters.length} affected geometry group(s).`;
  const falsePositiveTracking = comparison.pairComparisons
    .filter(pair => pair.nativeOverlapExpected && !pair.ossOverlaps)
    .map(pair => `Native bounding-box overlap expected for ${pair.polygonIds.join(' + ')}, but OSS intersection area was zero; track as likely native heuristic false positive.`);
  const falseNegativeTracking = comparison.pairComparisons
    .filter(pair => !pair.nativeOverlapExpected && pair.ossOverlaps)
    .map(pair => `OSS detected overlap for ${pair.polygonIds.join(' + ')} where native heuristic did not expect overlap; track as possible native false negative.`);
  const topologyConfidenceDegradation = comparison.observations
    .filter(observation => observation.category === 'topology_confidence_degradation')
    .map(observation => observation.comparisonSummary);
  const reviewActions = dedupe([
    ...risks.map(risk => risk.recommendedReviewAction),
    ...input.cadReadiness.requiredReviewItems.map(item => `Resolve readiness review item: ${item}.`),
  ]);

  return {
    integritySummary,
    disagreementSummary,
    falsePositiveTracking,
    falseNegativeTracking,
    topologyConfidenceDegradation,
    reviewActions,
  };
}

function polygonAreaAbs(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum / 2);
}

function dedupeRisks(risks: GeometryRiskSignalV1[]): GeometryRiskSignalV1[] {
  const seen = new Set<string>();
  const result: GeometryRiskSignalV1[] = [];
  for (const risk of risks) {
    const key = `${risk.category}|${risk.severity}|${risk.affectedEntities.join(',')}|${risk.evidenceSummary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...risk, affectedEntities: dedupe(risk.affectedEntities).sort() });
  }
  return result.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidenceImpact - a.confidenceImpact || a.category.localeCompare(b.category));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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
