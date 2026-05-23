import type { CADModel } from '@/lib/cad/types';
import type { EngineeringRequirementEvaluation, EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import type { EngineeringSurveyEvidence } from '@/lib/engineering/surveyEvidence';
import {
  listRequirementDocumentBindings,
} from './requirementDocumentBindings';
import type {
  BuildDocumentProvenanceInput,
  DocumentProvenanceBundle,
  DocumentProvenanceSection,
  DocumentRenderInputs,
  DocumentTruthSource,
  EngineeringDependencyEdge,
  RequirementDocumentBinding,

  EngineeringDependencyGraph,
  EngineeringDependencyNode,
  EvidenceBackedGeometryInput,
} from './types';
import { runDocumentAuditGuards } from './guards';
import { buildEngineeringDecisionProvenanceBundle, type EngineeringDecisionEvaluationBundle } from '@/lib/engineeringDecisionProvenance';

const EMPTY_RENDER_INPUTS: DocumentRenderInputs = {
  inputKeys: [],
  canonicalInputKeys: [],
  cadPrimitiveIds: [],
  legacyFallbackKeys: [],
};

export function buildDocumentProvenanceBundle(input: BuildDocumentProvenanceInput): DocumentProvenanceBundle {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const surveyEvidence = input.surveyEvidence ?? null;
  const requirementEvaluation = surveyEvidence?.requirementEvaluation ?? null;
  const renderInputs = normalizeRenderInputs(input.renderInputs, input.cad, input.includeLegacyDesignInput ?? false);
  const bindings = listRequirementDocumentBindings();
  const sections = buildDocumentProvenanceSections({
    documentId: input.documentId,
    documentType: input.documentType,
    generatedAt,
    surveyEvidence,
    bindings,
    renderInputs,
  });
  const requirementIds = uniqueSorted(sections.flatMap(section => section.requirementIds)) as EngineeringRequirementId[];
  const canonicalEvidenceIds = uniqueSorted(sections.flatMap(section => section.canonicalEvidenceIds));
  const originatingSurveyIds = uniqueSorted(sections.flatMap(section => section.originatingSurveyIds));
  const decisionProvenance = input.decisionProvenance ?? (input.permitInput
    ? buildEngineeringDecisionProvenanceBundle({
        bundleId: `${input.documentId}.decision-provenance`,
        generatedAt,
        surveyEvidence,
        documentProvenance: null,
        cad: input.cad ?? null,
        permitInput: input.permitInput,
        renderContextIds: ['renderContext:primary'],
        includeDocumentMetadataDecisions: true,
      })
    : undefined);
  const dependencyGraph = buildEngineeringDependencyGraph({
    graphId: `${input.documentId}.dependency-graph`,
    generatedAt,
    surveyEvidence,
    sections,
    cad: input.cad ?? null,
    decisionProvenance: decisionProvenance ?? null,
  });
  const engineeringDependencyIds = uniqueSorted(dependencyGraph.nodes.map(node => node.id));

  const bundle: DocumentProvenanceBundle = {
    documentId: input.documentId,
    documentType: input.documentType,
    requirementIds,
    canonicalEvidenceIds,
    originatingSurveyIds,
    provenanceSource: requirementEvaluation ? 'document_binding_registry_v1' : 'legacy_design_input',
    engineeringDependencyIds,
    confidenceSource: requirementEvaluation ? 'engineering_requirement_registry_v1' : 'missing_registry_evaluation',
    renderInputs,
    truthSource: resolveDocumentTruthSource(surveyEvidence),
    generatedAt,
    deterministicNotes: [
      'DocumentProvenanceBundle v1 is built from Engineering Requirement Registry evaluations, survey evidence traceability, and deterministic document bindings.',
      'Canonical evidence ids are de-duplicated before document provenance is emitted, so duplicate uploads cannot inflate document provenance.',
      'Raw upload counts remain audit/history metadata and are not emitted as render truth.',
    ],
    sections,
    auditGuards: [],
    dependencyGraph,
    decisionProvenance: decisionProvenance ?? undefined,
  };
  bundle.auditGuards = runDocumentAuditGuards(bundle, { surveyEvidence });
  return bundle;
}

export function buildDocumentProvenanceSections(input: {
  documentId: string;
  documentType: DocumentProvenanceSection['documentType'];
  generatedAt: string;
  surveyEvidence: EngineeringSurveyEvidence | null;
  bindings: RequirementDocumentBinding[];
  renderInputs: DocumentRenderInputs;
}): DocumentProvenanceSection[] {
  const evaluations = input.surveyEvidence?.requirementEvaluation.allRequirements ?? [];
  const evaluationByRequirement = new Map<EngineeringRequirementId, EngineeringRequirementEvaluation>(
    evaluations.map(evaluation => [evaluation.requirementId, evaluation]),
  );

  const sections = input.bindings.flatMap(binding => {
    const evaluation = evaluationByRequirement.get(binding.requirementId) ?? null;
    const boundSections = binding.boundDocumentSections.filter(section =>
      section.documentType === input.documentType
      || input.documentType === 'permit_package'
      || input.documentType === 'render_context'
      || input.documentType === 'document_summary',
    );
    return boundSections.map(boundSection => {
      const canonicalEvidenceIds = uniqueSorted(evaluation?.canonicalEvidenceIds ?? []);
      const originatingSurveyIds = uniqueSorted(evaluation?.originatingSurveyIds.filter(Boolean) ?? []);
      const truthSource = resolveDocumentTruthSource(input.surveyEvidence);
      return {
        documentId: input.documentId,
        documentType: boundSection.documentType,
        sectionId: boundSection.sectionId,
        sectionLabel: boundSection.sectionLabel,
        requirementIds: [binding.requirementId],
        canonicalEvidenceIds,
        originatingSurveyIds,
        provenanceSource: evaluation ? 'document_binding_registry_v1' : 'legacy_design_input',
        engineeringDependencyIds: dependencyIdsForSection(boundSection.sectionId, binding.requirementId, canonicalEvidenceIds),
        confidenceSource: evaluation?.confidenceSource ?? 'missing_registry_evaluation',
        renderInputs: input.renderInputs,
        truthSource,
        generatedAt: input.generatedAt,
        deterministicNotes: [
          `Requirement ${binding.requirementId} binds deterministically to ${boundSection.sectionId}.`,
          `Missing behavior policy: ${binding.missingBehaviorPolicy}; blocked render policy: ${binding.blockedRenderPolicy}.`,
          canonicalEvidenceIds.length > 0
            ? `Canonical evidence ids linked: ${canonicalEvidenceIds.join(', ')}.`
            : 'No canonical evidence ids linked; section must render registry warning or informational status only.',
        ],
      } satisfies DocumentProvenanceSection;
    });
  });

  return sections.sort(compareSections);
}

export function buildEngineeringDependencyGraph(input: {
  graphId: string;
  generatedAt?: string;
  surveyEvidence?: EngineeringSurveyEvidence | null;
  sections?: DocumentProvenanceSection[];
  cad?: CADModel | null;
  decisionProvenance?: EngineeringDecisionEvaluationBundle | null;
}): EngineeringDependencyGraph {
  const generatedAt = input.generatedAt ?? new Date(0).toISOString();
  const nodes = new Map<string, EngineeringDependencyNode>();
  const edges = new Map<string, EngineeringDependencyEdge>();
  const evaluations = input.surveyEvidence?.requirementEvaluation.allRequirements ?? [];
  const sections = input.sections ?? [];
  const decisionRecords = input.decisionProvenance?.decisionRecords ?? [];

  for (const evaluation of evaluations) {
    putNode(nodes, {
      id: `requirement:${evaluation.requirementId}`,
      nodeType: 'engineering_requirement',
      label: evaluation.humanLabel,
      requirementIds: [evaluation.requirementId],
      canonicalEvidenceIds: uniqueSorted(evaluation.canonicalEvidenceIds),
      truthSource: 'engineering_requirement_registry_v1',
      deterministicNotes: evaluation.deterministicEvaluationNotes,
    });

    for (const evidenceId of uniqueSorted(evaluation.canonicalEvidenceIds)) {
      putNode(nodes, {
        id: `canonicalEvidence:${evidenceId}`,
        nodeType: 'canonical_evidence',
        label: evidenceId,
        requirementIds: [evaluation.requirementId],
        canonicalEvidenceIds: [evidenceId],
        truthSource: input.surveyEvidence?.evidenceTruthSource ?? 'canonical_manifest_v1',
        deterministicNotes: ['Canonical evidence node is sourced from survey evidence traceability, not raw upload count.'],
      });
      putEdge(edges, {
        id: `edge:${evidenceId}->${evaluation.requirementId}`,
        fromNodeId: `canonicalEvidence:${evidenceId}`,
        toNodeId: `requirement:${evaluation.requirementId}`,
        edgeType: 'satisfies_requirement',
        deterministicReason: `Canonical evidence ${evidenceId} contributes to requirement ${evaluation.requirementId}.`,
      });
    }
  }

  for (const section of sections) {
    putNode(nodes, {
      id: `documentSection:${section.sectionId}`,
      nodeType: section.sectionId.startsWith('SLD.') ? 'sld_section' : 'permit_section',
      label: section.sectionLabel,
      requirementIds: section.requirementIds,
      canonicalEvidenceIds: section.canonicalEvidenceIds,
      truthSource: section.truthSource,
      deterministicNotes: section.deterministicNotes,
    });
    for (const requirementId of section.requirementIds) {
      putEdge(edges, {
        id: `edge:requirement:${requirementId}->section:${section.sectionId}`,
        fromNodeId: `requirement:${requirementId}`,
        toNodeId: `documentSection:${section.sectionId}`,
        edgeType: section.canonicalEvidenceIds.length > 0 ? 'binds_requirement_to_document' : 'documents_missing_requirement',
        deterministicReason: `Requirement ${requirementId} is bound to document section ${section.sectionId}.`,
      });
    }
  }

  const geometryInputs = buildEvidenceBackedGeometryInputs({
    surveyEvidence: input.surveyEvidence ?? null,
    cad: input.cad ?? null,
  });
  for (const geometryInput of geometryInputs) {
    putNode(nodes, {
      id: `geometryInput:${geometryInput.geometryInputId}`,
      nodeType: 'cad_layout_primitive',
      label: geometryInput.geometryAssumptionType,
      requirementIds: geometryInput.linkedRequirementIds,
      canonicalEvidenceIds: geometryInput.canonicalEvidenceIds,
      truthSource: geometryInput.truthSource,
      deterministicNotes: geometryInput.deterministicNotes,
    });
    for (const requirementId of geometryInput.linkedRequirementIds) {
      putEdge(edges, {
        id: `edge:requirement:${requirementId}->geometry:${geometryInput.geometryInputId}`,
        fromNodeId: `requirement:${requirementId}`,
        toNodeId: `geometryInput:${geometryInput.geometryInputId}`,
        edgeType: 'supports_geometry_assumption',
        deterministicReason: `Requirement ${requirementId} supports deterministic geometry input ${geometryInput.geometryInputId}.`,
      });
    }
  }

  putNode(nodes, {
    id: 'renderContext:primary',
    nodeType: 'render_context',
    label: 'Primary RenderContext provenance carrier',
    requirementIds: uniqueSorted(evaluations.map(evaluation => evaluation.requirementId)) as EngineeringRequirementId[],
    canonicalEvidenceIds: uniqueSorted(evaluations.flatMap(evaluation => evaluation.canonicalEvidenceIds)),
    truthSource: 'document_binding_registry_v1',
    deterministicNotes: ['RenderContext carries provenance as additive metadata and does not make sizing or geometry decisions.'],
  });
  for (const section of sections) {
    putEdge(edges, {
      id: `edge:renderContext->section:${section.sectionId}`,
      fromNodeId: 'renderContext:primary',
      toNodeId: `documentSection:${section.sectionId}`,
      edgeType: 'feeds_render_context',
      deterministicReason: `RenderContext carries provenance metadata for ${section.sectionId}.`,
    });
  }


  for (const decision of decisionRecords) {
    putNode(nodes, {
      id: decision.decisionId,
      nodeType: decision.decisionCategory === 'calculation' ? 'calculation' : 'engineering_decision',
      label: `${decision.decisionType}: ${String(decision.selectedValue ?? 'none')}`,
      requirementIds: decision.requirementIds,
      canonicalEvidenceIds: decision.canonicalEvidenceIds,
      truthSource: decision.truthSource,
      deterministicNotes: decision.deterministicNotes,
    });
    for (const requirementId of decision.requirementIds) {
      putEdge(edges, {
        id: `edge:requirement:${requirementId}->${decision.decisionId}`,
        fromNodeId: `requirement:${requirementId}`,
        toNodeId: decision.decisionId,
        edgeType: 'decision_uses_requirement',
        deterministicReason: `Decision ${decision.decisionType} uses requirement ${requirementId}.`,
      });
    }
    for (const evidenceId of decision.canonicalEvidenceIds) {
      putEdge(edges, {
        id: `edge:canonicalEvidence:${evidenceId}->${decision.decisionId}`,
        fromNodeId: `canonicalEvidence:${evidenceId}`,
        toNodeId: decision.decisionId,
        edgeType: 'decision_uses_evidence',
        deterministicReason: `Decision ${decision.decisionType} is linked to canonical evidence ${evidenceId}.`,
      });
    }
    for (const sectionId of decision.documentSectionIds) {
      putNode(nodes, {
        id: `documentSection:${sectionId}`,
        nodeType: sectionId.startsWith('SLD.') ? 'sld_section' : 'permit_section',
        label: `${sectionId} decision-linked output`,
        requirementIds: decision.requirementIds,
        canonicalEvidenceIds: decision.canonicalEvidenceIds,
        truthSource: decision.truthSource,
        deterministicNotes: [`Decision-linked section node created for ${decision.decisionType} provenance when no explicit document binding node exists.`],
      });
      putEdge(edges, {
        id: `edge:${decision.decisionId}->section:${sectionId}`,
        fromNodeId: decision.decisionId,
        toNodeId: `documentSection:${sectionId}`,
        edgeType: sectionId.startsWith('SLD.') ? 'decision_feeds_sld' : sectionId.startsWith('BOM.') ? 'decision_feeds_bom' : 'decision_feeds_document',
        deterministicReason: `Decision ${decision.decisionType} feeds document section ${sectionId}.`,
      });
    }
    for (const renderContextId of decision.renderContextIds) {
      putEdge(edges, {
        id: `edge:${decision.decisionId}->render:${renderContextId}`,
        fromNodeId: decision.decisionId,
        toNodeId: renderContextId,
        edgeType: 'decision_feeds_render_output',
        deterministicReason: `Decision ${decision.decisionType} is carried through render context ${renderContextId}.`,
      });
    }
  }

  const sortedNodes = Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = Array.from(edges.values()).sort((a, b) => a.id.localeCompare(b.id));
  const deterministicHash = deterministicGraphHash(sortedNodes, sortedEdges);

  return {
    graphId: input.graphId,
    generatedAt,
    nodes: sortedNodes,
    edges: sortedEdges,
    deterministicHash,
    deterministicNotes: [
      'EngineeringDependencyGraph v1 is a deterministic mapping graph, not an AI reasoning graph.',
      'Nodes and edges are sorted and hashed from stable ids to prove deterministic output ordering.',
      'Graph links requirements, canonical evidence, document sections, geometry wrappers, render context metadata, and engineering decision nodes when supplied.',
    ],
  };
}

export function buildEvidenceBackedGeometryInputs(input: {
  surveyEvidence?: EngineeringSurveyEvidence | null;
  cad?: CADModel | null;
}): EvidenceBackedGeometryInput[] {
  const surveyEvidence = input.surveyEvidence ?? null;
  const cad = input.cad ?? null;
  const evaluations = surveyEvidence?.requirementEvaluation.allRequirements ?? [];
  const byRequirement = new Map<EngineeringRequirementId, EngineeringRequirementEvaluation>(
    evaluations.map(evaluation => [evaluation.requirementId, evaluation]),
  );
  const systemType = cad?.systemType ?? 'unknown';
  const roof = byRequirement.get('roof_overview');
  const msp = byRequirement.get('main_service_panel');
  const meter = byRequirement.get('utility_meter');
  const structural = byRequirement.get('structural_access') ?? byRequirement.get('attic_access');

  const inputs: EvidenceBackedGeometryInput[] = [];
  if (roof) {
    inputs.push(makeGeometryInput('geometry:roof-layout-context', systemType, 'roof_plane_boundary', ['roof_overview'], roof, cadPrimitiveIds(cad, 'roof')));
  }
  if (msp || meter) {
    inputs.push(makeGeometryInput(
      'geometry:electrical-equipment-context',
      systemType,
      'electrical_equipment_location',
      uniqueSorted([msp?.requirementId, meter?.requirementId].filter(Boolean)) as EngineeringRequirementId[],
      mergeEvaluations([msp, meter]),
      cadPrimitiveIds(cad, 'electrical'),
    ));
  }
  if (structural) {
    inputs.push(makeGeometryInput('geometry:structural-access-context', systemType, 'structural_access_context', [structural.requirementId], structural, cadPrimitiveIds(cad, 'structural')));
  }
  if (cad) {
    inputs.push({
      geometryInputId: 'geometry:cad-model-summary',
      systemType,
      geometryAssumptionType: 'generic_layout_context',
      linkedRequirementIds: uniqueSorted(evaluations.map(evaluation => evaluation.requirementId)) as EngineeringRequirementId[],
      canonicalEvidenceIds: uniqueSorted(evaluations.flatMap(evaluation => evaluation.canonicalEvidenceIds)),
      originatingSurveyIds: uniqueSorted(evaluations.flatMap(evaluation => evaluation.originatingSurveyIds.filter(Boolean))),
      cadPrimitiveIds: cadPrimitiveIds(cad, 'all'),
      renderContextIds: ['renderContext:primary'],
      truthSource: 'cad_model_deterministic',
      deterministicNotes: [
        'CADModel summary is linked to available registry evidence as provenance metadata only.',
        'No geometry extraction or non-deterministic visual analysis is performed.',
      ],
    });
  }
  return inputs.sort((a, b) => a.geometryInputId.localeCompare(b.geometryInputId));
}

function makeGeometryInput(
  geometryInputId: string,
  systemType: EvidenceBackedGeometryInput['systemType'],
  geometryAssumptionType: EvidenceBackedGeometryInput['geometryAssumptionType'],
  linkedRequirementIds: EngineeringRequirementId[],
  evaluation: EngineeringRequirementEvaluation,
  primitiveIds: string[],
): EvidenceBackedGeometryInput {
  return {
    geometryInputId,
    systemType,
    geometryAssumptionType,
    linkedRequirementIds,
    canonicalEvidenceIds: uniqueSorted(evaluation.canonicalEvidenceIds),
    originatingSurveyIds: uniqueSorted(evaluation.originatingSurveyIds.filter(Boolean)),
    cadPrimitiveIds: primitiveIds,
    renderContextIds: ['renderContext:primary'],
    truthSource: 'canonical_manifest_v1',
    deterministicNotes: [
      `Geometry wrapper links ${geometryAssumptionType} to registry requirement(s): ${linkedRequirementIds.join(', ')}.`,
      'Wrapper carries provenance only; it does not extract geometry, infer dimensions, or generate CAD.',
    ],
  };
}

function mergeEvaluations(evaluations: Array<EngineeringRequirementEvaluation | null | undefined>): EngineeringRequirementEvaluation {
  const present = evaluations.filter(Boolean) as EngineeringRequirementEvaluation[];
  const first = present[0];
  if (!first) throw new Error('mergeEvaluations requires at least one evaluation');
  return {
    ...first,
    canonicalEvidenceIds: uniqueSorted(present.flatMap(evaluation => evaluation.canonicalEvidenceIds)),
    originatingSurveyIds: uniqueSorted(present.flatMap(evaluation => evaluation.originatingSurveyIds.filter(Boolean))),
  };
}

function resolveDocumentTruthSource(surveyEvidence: EngineeringSurveyEvidence | null): DocumentTruthSource {
  if (!surveyEvidence) return 'legacy_design_input';
  return surveyEvidence.evidenceTruthSource;
}

function normalizeRenderInputs(
  partial: BuildDocumentProvenanceInput['renderInputs'],
  cad: CADModel | null | undefined,
  includeLegacyDesignInput: boolean,
): DocumentRenderInputs {
  return {
    inputKeys: uniqueSorted(partial?.inputKeys ?? ['PermitInput']),
    canonicalInputKeys: uniqueSorted(partial?.canonicalInputKeys ?? []),
    cadPrimitiveIds: uniqueSorted([...(partial?.cadPrimitiveIds ?? []), ...cadPrimitiveIds(cad ?? null, 'all')]),
    legacyFallbackKeys: uniqueSorted(includeLegacyDesignInput ? (partial?.legacyFallbackKeys ?? ['legacy_design_input']) : (partial?.legacyFallbackKeys ?? [])),
  };
}

function dependencyIdsForSection(sectionId: string, requirementId: EngineeringRequirementId, canonicalEvidenceIds: string[]): string[] {
  return uniqueSorted([
    `requirement:${requirementId}`,
    `documentSection:${sectionId}`,
    ...canonicalEvidenceIds.map(id => `canonicalEvidence:${id}`),
  ]);
}

function cadPrimitiveIds(cad: CADModel | null, family: 'roof' | 'electrical' | 'structural' | 'all'): string[] {
  if (!cad) return [];
  const ids: string[] = [`cad:${cad.systemType}:model`];
  if ((family === 'roof' || family === 'all') && cad.roof?.planes) ids.push(...cad.roof.planes.map(plane => `cad:roofPlane:${plane.id}`));
  if ((family === 'all') && cad.ground?.arrays) ids.push(...cad.ground.arrays.map(array => `cad:groundArray:${array.id}`));
  if ((family === 'all') && cad.fence?.segments) ids.push(...cad.fence.segments.map(segment => `cad:fenceSegment:${segment.id}`));
  if ((family === 'electrical' || family === 'all') && cad.electricalNodes) ids.push(...cad.electricalNodes.map(node => `cad:electricalNode:${node.id}`));
  if ((family === 'structural' || family === 'all') && cad.dimensions) ids.push(...cad.dimensions.map(dimension => `cad:dimension:${dimension.id}`));
  return uniqueSorted(ids);
}

function putNode(nodes: Map<string, EngineeringDependencyNode>, node: EngineeringDependencyNode): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, {
      ...node,
      requirementIds: uniqueSorted(node.requirementIds) as EngineeringRequirementId[],
      canonicalEvidenceIds: uniqueSorted(node.canonicalEvidenceIds),
    });
    return;
  }
  nodes.set(node.id, {
    ...existing,
    requirementIds: uniqueSorted([...existing.requirementIds, ...node.requirementIds]) as EngineeringRequirementId[],
    canonicalEvidenceIds: uniqueSorted([...existing.canonicalEvidenceIds, ...node.canonicalEvidenceIds]),
    deterministicNotes: uniqueSorted([...existing.deterministicNotes, ...node.deterministicNotes]),
  });
}

function putEdge(edges: Map<string, EngineeringDependencyEdge>, edge: EngineeringDependencyEdge): void {
  if (!edges.has(edge.id)) edges.set(edge.id, edge);
}

function compareSections(a: DocumentProvenanceSection, b: DocumentProvenanceSection): number {
  return `${a.documentType}:${a.sectionId}:${a.requirementIds.join(',')}`.localeCompare(`${b.documentType}:${b.sectionId}:${b.requirementIds.join(',')}`);
}

function deterministicGraphHash(nodes: EngineeringDependencyNode[], edges: EngineeringDependencyEdge[]): string {
  const payload = [
    ...nodes.map(node => `N|${node.id}|${node.nodeType}|${node.requirementIds.join(',')}|${node.canonicalEvidenceIds.join(',')}`),
    ...edges.map(edge => `E|${edge.id}|${edge.fromNodeId}|${edge.toNodeId}|${edge.edgeType}`),
  ].join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
  return `djb2-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))).sort((a, b) => a.localeCompare(b));
}
