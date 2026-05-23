import type {
  EngineeringDecisionAuditGuardResult,
  EngineeringDecisionEvaluationBundle,
  EngineeringDecisionProvenanceRecord,
} from './types';

export class EngineeringDecisionProvenanceAuditError extends Error {
  constructor(public readonly failures: EngineeringDecisionAuditGuardResult[]) {
    super(failures.map(failure => failure.message).join('; '));
    this.name = 'EngineeringDecisionProvenanceAuditError';
  }
}

export function runEngineeringDecisionAuditGuards(
  records: EngineeringDecisionProvenanceRecord[],
  context: { renderOutputExpected?: boolean } = {},
): EngineeringDecisionAuditGuardResult[] {
  const hasRecords = records.length > 0;
  const recordsHaveLineage = records.every(record =>
    record.dependencyNodeIds.length > 0
    && record.derivedFrom.length > 0
    && (record.requirementIds.length > 0 || record.documentSectionIds.length > 0 || record.governingRules.length > 0),
  );
  const fallbackRecords = records.filter(record => isFallbackRecord(record));
  const fallbacksDocumented = fallbackRecords.every(record =>
    record.deterministicNotes.some(note => note.toLowerCase().includes('fallback') || note.toLowerCase().includes('default'))
    || record.decisionInputs.some(input => input.deterministicRole === 'fallback_default'),
  );
  const calculationRecords = records.filter(record => record.decisionCategory === 'calculation');
  const calculationsHaveLineage = calculationRecords.every(record =>
    record.dependencyNodeIds.length > 0
    && record.governingRules.length > 0
    && record.decisionInputs.length > 0,
  );
  const sectionLinkedRecords = records.filter(record => record.documentSectionIds.length > 0);
  const sectionsHaveRules = sectionLinkedRecords.every(record => record.governingRules.length > 0);
  const renderHasDecisionProvenance = !context.renderOutputExpected || hasRecords;

  return [
    {
      guardCode: 'decision_lineage_required',
      passed: hasRecords && recordsHaveLineage,
      severity: hasRecords && recordsHaveLineage ? 'info' : 'error',
      message: hasRecords && recordsHaveLineage
        ? 'Engineering decisions retain deterministic lineage.'
        : 'Engineering decision provenance requires dependency, source, and requirement/document/rule lineage.',
      deterministicNotes: ['Guard checks decision dependencyNodeIds, derivedFrom, and explainability anchors.'],
    },
    {
      guardCode: 'document_sections_require_governing_rules',
      passed: sectionsHaveRules,
      severity: sectionsHaveRules ? 'info' : 'error',
      message: sectionsHaveRules
        ? 'Document-linked engineering decisions include governing-rule linkage.'
        : 'One or more document-linked engineering decisions is missing governing-rule linkage.',
      deterministicNotes: ['Guard prevents document sections from presenting engineering decisions without rule references.'],
    },
    {
      guardCode: 'fallback_assumptions_documented',
      passed: fallbacksDocumented,
      severity: fallbacksDocumented ? 'info' : 'error',
      message: fallbacksDocumented
        ? 'Fallback/default assumptions are explicit provenance events.'
        : 'Hidden fallback/default assumptions were detected in engineering decision provenance.',
      deterministicNotes: ['Guard checks fallback/default decision inputs and deterministic notes.'],
    },
    {
      guardCode: 'calculations_require_dependency_lineage',
      passed: calculationsHaveLineage,
      severity: calculationsHaveLineage ? 'info' : 'error',
      message: calculationsHaveLineage
        ? 'Calculation decisions include dependency and governing-rule lineage.'
        : 'Calculation decisions must include dependency lineage and governing-rule linkage.',
      deterministicNotes: ['Guard applies to calculation-category decisions only.'],
    },
    {
      guardCode: 'render_outputs_require_decision_provenance',
      passed: renderHasDecisionProvenance,
      severity: renderHasDecisionProvenance ? 'info' : 'error',
      message: renderHasDecisionProvenance
        ? 'Render output has decision provenance available when expected.'
        : 'Render output was requested without engineering decision provenance.',
      deterministicNotes: ['Guard is enabled by render/document integration call sites.'],
    },
  ];
}

export function assertEngineeringDecisionProvenanceGuards(bundle: EngineeringDecisionEvaluationBundle): void {
  const failures = bundle.auditGuards.filter(guard => guard.severity === 'error' && !guard.passed);
  if (failures.length > 0) throw new EngineeringDecisionProvenanceAuditError(failures);
}

function isFallbackRecord(record: EngineeringDecisionProvenanceRecord): boolean {
  return record.decisionCategory === 'fallback_default'
    || record.confidenceSource === 'explicit_default_policy_v1'
    || record.decisionInputs.some(input => input.deterministicRole === 'fallback_default');
}
