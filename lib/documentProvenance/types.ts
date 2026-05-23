import type { CADModel, CADSystemType } from '@/lib/cad/types';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';
import type {
  EngineeringRequirementEvaluation,
  EngineeringRequirementId,
} from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import type { EvidenceTruthSource } from '@/lib/survey/evidence/provenance';
import type { EngineeringDecisionEvaluationBundle } from '@/lib/engineeringDecisionProvenance';
import type { PermitInput } from '@/lib/permit/types';

export type DocumentType =
  | 'permit_package'
  | 'permit_sheet'
  | 'permit_validation_sheet'
  | 'single_line_diagram'
  | 'plan_set'
  | 'bom'
  | 'engineering_report'
  | 'proposal'
  | 'render_context'
  | 'document_summary';

export type ProvenanceSource =
  | 'engineering_requirement_registry_v1'
  | 'survey_evidence_traceability_v1'
  | 'document_binding_registry_v1'
  | 'engineering_dependency_graph_v1'
  | 'render_context_v1'
  | 'legacy_design_input'
  | 'engineering_decision_registry_v1';

export type DocumentTruthSource =
  | EvidenceTruthSource
  | 'engineering_requirement_registry_v1'
  | 'document_binding_registry_v1'
  | 'cad_model_deterministic'
  | 'permit_input_canonical'
  | 'legacy_design_input';

export type MissingBehaviorPolicy =
  | 'render_with_registry_warning'
  | 'render_informational_only'
  | 'block_section_if_missing'
  | 'defer_to_engineering_review'
  | 'not_applicable_when_inactive';

export type BlockedRenderPolicy =
  | 'never_block_document'
  | 'block_section'
  | 'block_document'
  | 'warn_only';

export interface DocumentRenderInputs {
  inputKeys: string[];
  canonicalInputKeys: string[];
  cadPrimitiveIds: string[];
  legacyFallbackKeys: string[];
}

export interface DocumentProvenanceSection {
  documentId: string;
  documentType: DocumentType;
  sectionId: string;
  sectionLabel: string;
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  provenanceSource: ProvenanceSource;
  engineeringDependencyIds: string[];
  confidenceSource: EngineeringRequirementEvaluation['confidenceSource'] | 'document_binding_registry_v1' | 'missing_registry_evaluation';
  renderInputs: DocumentRenderInputs;
  truthSource: DocumentTruthSource;
  generatedAt: string;
  deterministicNotes: string[];
}

export interface DocumentProvenanceBundle {
  documentId: string;
  documentType: DocumentType;
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  provenanceSource: ProvenanceSource;
  engineeringDependencyIds: string[];
  confidenceSource: 'engineering_requirement_registry_v1' | 'missing_registry_evaluation';
  renderInputs: DocumentRenderInputs;
  truthSource: DocumentTruthSource;
  generatedAt: string;
  deterministicNotes: string[];
  sections: DocumentProvenanceSection[];
  auditGuards: DocumentAuditGuardResult[];
  dependencyGraph?: EngineeringDependencyGraph;
  decisionProvenance?: EngineeringDecisionEvaluationBundle;
}

export interface RequirementDocumentBinding {
  requirementId: EngineeringRequirementId;
  boundDocumentSections: Array<{
    documentType: DocumentType;
    sectionId: string;
    sectionLabel: string;
  }>;
  requiredEvidenceCategories: SurveyEvidenceCategory[];
  optionalEvidenceCategories: SurveyEvidenceCategory[];
  provenanceLinkage: 'canonical_evidence_ids' | 'registry_status_only' | 'inactive_future_binding';
  missingBehaviorPolicy: MissingBehaviorPolicy;
  blockedRenderPolicy: BlockedRenderPolicy;
  informationalOnlyPolicy: 'active_requirement' | 'informational_when_missing' | 'inactive_future_only';
  deterministicNotes: string[];
}

export type EngineeringDependencyNodeType =
  | 'engineering_requirement'
  | 'canonical_evidence'
  | 'permit_section'
  | 'sld_section'
  | 'bom_row'
  | 'cad_layout_primitive'
  | 'render_context'
  | 'engineering_assumption'
  | 'engineering_decision'
  | 'calculation'
  | 'render_output';

export interface EngineeringDependencyNode {
  id: string;
  nodeType: EngineeringDependencyNodeType;
  label: string;
  requirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  truthSource: DocumentTruthSource;
  deterministicNotes: string[];
}

export type EngineeringDependencyEdgeType =
  | 'satisfies_requirement'
  | 'binds_requirement_to_document'
  | 'feeds_render_context'
  | 'supports_geometry_assumption'
  | 'supports_electrical_assumption'
  | 'supports_structural_assumption'
  | 'documents_missing_requirement'
  | 'explains_engineering_decision'
  | 'decision_uses_requirement'
  | 'decision_uses_evidence'
  | 'decision_feeds_document'
  | 'decision_feeds_bom'
  | 'decision_feeds_sld'
  | 'decision_feeds_render_output';

export interface EngineeringDependencyEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: EngineeringDependencyEdgeType;
  deterministicReason: string;
}

export interface EngineeringDependencyGraph {
  graphId: string;
  generatedAt: string;
  nodes: EngineeringDependencyNode[];
  edges: EngineeringDependencyEdge[];
  deterministicHash: string;
  deterministicNotes: string[];
}

export interface EvidenceBackedGeometryInput {
  geometryInputId: string;
  systemType: CADSystemType | 'unknown';
  geometryAssumptionType:
    | 'roof_plane_boundary'
    | 'site_origin'
    | 'array_layout'
    | 'electrical_equipment_location'
    | 'structural_access_context'
    | 'generic_layout_context';
  linkedRequirementIds: EngineeringRequirementId[];
  canonicalEvidenceIds: string[];
  originatingSurveyIds: string[];
  cadPrimitiveIds: string[];
  renderContextIds: string[];
  truthSource: DocumentTruthSource;
  deterministicNotes: string[];
}

export type DocumentAuditGuardCode =
  | 'registry_evaluation_required'
  | 'canonical_truth_required'
  | 'raw_upload_count_not_render_truth'
  | 'section_provenance_required'
  | 'render_context_provenance_required'
  | 'decision_lineage_required'
  | 'document_sections_require_governing_rules'
  | 'fallback_assumptions_documented'
  | 'calculations_require_dependency_lineage'
  | 'render_outputs_require_decision_provenance';

export interface DocumentAuditGuardResult {
  guardCode: DocumentAuditGuardCode;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  deterministicNotes: string[];
}

export interface BuildDocumentProvenanceInput {
  documentId: string;
  documentType: DocumentType;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  cad?: CADModel | null;
  generatedAt?: string;
  renderInputs?: Partial<DocumentRenderInputs>;
  includeLegacyDesignInput?: boolean;
  permitInput?: PermitInput | null;
  decisionProvenance?: EngineeringDecisionEvaluationBundle | null;
}
