import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { DocumentAuditGuardResult, DocumentProvenanceBundle } from './types';

export class DocumentProvenanceAuditError extends Error {
  constructor(public readonly failures: DocumentAuditGuardResult[]) {
    super(failures.map(failure => failure.message).join('; '));
    this.name = 'DocumentProvenanceAuditError';
  }
}

export function runDocumentAuditGuards(
  bundle: DocumentProvenanceBundle,
  context: { surveyEvidence?: EngineeringSurveyEvidence | null } = {},
): DocumentAuditGuardResult[] {
  const surveyEvidence = context.surveyEvidence ?? null;
  const hasRegistryEvaluation = surveyEvidence?.requirementEvaluation?.confidenceSource === 'engineering_requirement_registry_v1';
  const hasCanonicalTruth = surveyEvidence?.evidenceTruthSource === 'canonical_manifest_v1';
  const hasSectionProvenance = bundle.sections.every(section =>
    section.provenanceSource !== 'legacy_design_input'
    && section.requirementIds.length > 0
    && section.engineeringDependencyIds.length > 0,
  );
  const rawCountOnly = Boolean(surveyEvidence)
    && (surveyEvidence?.rawPhotoCount ?? 0) > 0
    && (surveyEvidence?.canonicalEvidenceCount ?? 0) === 0;
  const renderContextHasProvenance = bundle.documentType !== 'render_context'
    || (bundle.sections.length > 0 && bundle.engineeringDependencyIds.includes('renderContext:primary'));

  return [
    {
      guardCode: 'registry_evaluation_required',
      passed: hasRegistryEvaluation,
      severity: hasRegistryEvaluation ? 'info' : 'error',
      message: hasRegistryEvaluation
        ? 'Registry evaluation is attached to document provenance.'
        : 'Document provenance requires Engineering Requirement Registry evaluation; legacy/raw fields cannot silently bypass it.',
      deterministicNotes: ['Guard checks the existing registry confidenceSource marker.'],
    },
    {
      guardCode: 'canonical_truth_required',
      passed: hasCanonicalTruth,
      severity: hasCanonicalTruth ? 'info' : 'warning',
      message: hasCanonicalTruth
        ? 'Document provenance uses canonicalManifest as downstream truth.'
        : 'Document provenance is not backed by canonicalManifest truth and must render only warnings/informational legacy status.',
      deterministicNotes: ['Guard distinguishes canonical_manifest_v1 from legacy_raw_photos_fallback.'],
    },
    {
      guardCode: 'raw_upload_count_not_render_truth',
      passed: !rawCountOnly,
      severity: rawCountOnly ? 'error' : 'info',
      message: rawCountOnly
        ? 'Raw upload count exists without canonical evidence; raw uploads cannot become render truth.'
        : 'No raw-upload-count-only render truth was detected.',
      deterministicNotes: ['Guard allows rawPhotoCount as audit metadata only when canonical evidence/provenance are present.'],
    },
    {
      guardCode: 'section_provenance_required',
      passed: hasSectionProvenance,
      severity: hasSectionProvenance ? 'info' : 'error',
      message: hasSectionProvenance
        ? 'Every document section carries requirement and dependency provenance.'
        : 'One or more document sections lost requirement/dependency provenance.',
      deterministicNotes: ['Guard verifies section-level requirement ids and engineering dependency ids.'],
    },
    {
      guardCode: 'render_context_provenance_required',
      passed: renderContextHasProvenance,
      severity: renderContextHasProvenance ? 'info' : 'error',
      message: renderContextHasProvenance
        ? 'RenderContext provenance carrier is present when required.'
        : 'RenderContext provenance was requested but did not retain provenance sections/dependencies.',
      deterministicNotes: ['Guard ensures render contexts remain provenance-aware.'],
    },
  ];
}

export function assertDocumentProvenanceGuards(bundle: DocumentProvenanceBundle): void {
  const failures = bundle.auditGuards.filter(guard => guard.severity === 'error' && !guard.passed);
  if (failures.length > 0) throw new DocumentProvenanceAuditError(failures);
}
