import { describe, expect, it } from 'vitest';
import type { EngineeringDependencyGraph } from '@/lib/documentProvenance';
import type { EngineeringStateRegistry, EngineeringInvalidationResult, EngineeringStateSnapshot, PersistentEngineeringStateGraph } from '@/lib/engineeringStateInvalidation';
import {
  buildEngineeringIntelligenceWorkspace,
  buildEngineeringRegenerationPlanV1,
  buildEngineeringSnapshotDeltaV1,
  computeEngineeringInvalidationPropagation,
  tracePropagation,
} from '@/lib/engineeringIntelligence';

const generatedAt = '2024-01-01T00:00:00.000Z';

function dependencyGraph(): EngineeringDependencyGraph {
  return {
    graphId: 'graph:v1',
    generatedAt,
    deterministicHash: 'graph-hash',
    deterministicNotes: ['fixture graph'],
    nodes: [
      { id: 'canonicalEvidence:e1', nodeType: 'canonical_evidence', label: 'Evidence 1', requirementIds: [], canonicalEvidenceIds: ['e1'], truthSource: 'document_binding_registry_v1', deterministicNotes: [] },
      { id: 'requirement:main_service_panel', nodeType: 'engineering_requirement', label: 'MSP', requirementIds: ['main_service_panel'], canonicalEvidenceIds: ['e1'], truthSource: 'engineering_requirement_registry_v1', deterministicNotes: [] },
      { id: 'decision:service_panel_rating', nodeType: 'engineering_decision', label: 'Decision', requirementIds: ['main_service_panel'], canonicalEvidenceIds: ['e1'], truthSource: 'engineering_requirement_registry_v1', deterministicNotes: [] },
      { id: 'section:msp', nodeType: 'permit_section', label: 'MSP Section', requirementIds: ['main_service_panel'], canonicalEvidenceIds: ['e1'], truthSource: 'document_binding_registry_v1', deterministicNotes: [] },
    ],
    edges: [
      { id: 'edge:e1:req', fromNodeId: 'canonicalEvidence:e1', toNodeId: 'requirement:main_service_panel', edgeType: 'satisfies_requirement', deterministicReason: 'evidence satisfies requirement' },
      { id: 'edge:req:decision', fromNodeId: 'requirement:main_service_panel', toNodeId: 'decision:service_panel_rating', edgeType: 'decision_uses_requirement', deterministicReason: 'requirement feeds decision' },
      { id: 'edge:decision:section', fromNodeId: 'decision:service_panel_rating', toNodeId: 'section:msp', edgeType: 'decision_feeds_document', deterministicReason: 'decision feeds section' },
      { id: 'edge:cycle', fromNodeId: 'section:msp', toNodeId: 'requirement:main_service_panel', edgeType: 'binds_requirement_to_document', deterministicReason: 'cycle fixture' },
      { id: 'edge:duplicate', fromNodeId: 'canonicalEvidence:e1', toNodeId: 'requirement:main_service_panel', edgeType: 'satisfies_requirement', deterministicReason: 'duplicate fixture' },
      { id: 'edge:missing', fromNodeId: 'section:msp', toNodeId: 'missing:node', edgeType: 'feeds_render_context', deterministicReason: 'missing fixture' },
    ],
  };
}

function registry(): EngineeringStateRegistry {
  return {
    registryId: 'registry:v1',
    generatedAt,
    stateIds: ['state:section:msp', 'state:render:primary'],
    generationHash: 'generation',
    provenanceHash: 'provenance',
    dependencyHash: 'dependency',
    deterministicHash: 'registry-hash',
    deterministicNotes: ['registry fixture'],
    auditGuards: [],
    stateRecords: [
      {
        stateId: 'state:section:msp',
        stateType: 'document_section',
        stateCategory: 'electrical',
        documentType: 'permit_sheet',
        renderContextId: 'renderContext:primary',
        dependencyNodeIds: ['section:msp', 'decision:service_panel_rating'],
        requirementIds: ['main_service_panel'],
        decisionIds: ['decision:service_panel_rating'],
        canonicalEvidenceIds: ['e1'],
        originatingSurveyIds: ['survey-1'],
        generationInputs: { inputKeys: ['i'], canonicalInputKeys: ['canonical:e1'], cadPrimitiveIds: [], legacyFallbackKeys: [], deterministicSources: ['fixture'] },
        generationHash: 'gen-a',
        provenanceHash: 'prov-a',
        dependencyHash: 'dep-a',
        staleStatus: 'stale',
        invalidationReason: 'fixture invalidation',
        invalidatedAt: generatedAt,
        truthSource: 'document_binding_registry_v1',
        deterministicNotes: ['stale fixture'],
      },
      {
        stateId: 'state:render:primary',
        stateType: 'render_context',
        stateCategory: 'rendering',
        documentType: 'render_context',
        renderContextId: 'renderContext:primary',
        dependencyNodeIds: ['renderContext:primary'],
        requirementIds: [],
        decisionIds: [],
        canonicalEvidenceIds: [],
        originatingSurveyIds: ['survey-1'],
        generationInputs: { inputKeys: ['i'], canonicalInputKeys: [], cadPrimitiveIds: [], legacyFallbackKeys: [], deterministicSources: ['fixture'] },
        generationHash: 'gen-b',
        provenanceHash: 'prov-b',
        dependencyHash: 'dep-b',
        staleStatus: 'current',
        truthSource: 'document_binding_registry_v1',
        deterministicNotes: ['current fixture'],
      },
    ],
  };
}

function invalidationResult(): EngineeringInvalidationResult {
  const reg = registry();
  return {
    resultId: 'invalidation:v1',
    generatedAt,
    trigger: {
      triggerId: 'trigger:e1',
      triggerType: 'canonical_evidence_changed',
      changedCanonicalEvidenceIds: ['e1'],
      changedRequirementIds: [],
      changedDecisionIds: [],
      changedDependencyNodeIds: [],
      triggeredAt: generatedAt,
      deterministicReason: 'fixture trigger',
    },
    affectedStateIds: ['state:section:msp'],
    unaffectedStateIds: ['state:render:primary'],
    updatedStateRecords: reg.stateRecords,
    deterministicHash: 'invalidation-hash',
    deterministicNotes: ['fixture invalidation'],
    auditGuards: [],
    invalidationEvents: [{
      eventId: 'event:state:section:msp',
      stateId: 'state:section:msp',
      staleStatus: 'stale',
      invalidationReason: 'fixture invalidation',
      triggeringDependencyIds: ['canonicalEvidence:e1'],
      triggeringRequirementIds: ['main_service_panel'],
      triggeringDecisionIds: ['decision:service_panel_rating'],
      triggeringCanonicalEvidenceIds: ['e1'],
      impactedDownstreamStateIds: ['state:section:msp'],
      lastValidGenerationHash: 'gen-a',
      lastValidProvenanceHash: 'prov-a',
      invalidatedAt: generatedAt,
      deterministicNotes: ['event fixture'],
    }],
  };
}

function snapshot(id: string, staleStateIds: string[]): EngineeringStateSnapshot {
  return {
    snapshotId: id,
    generatedAt,
    registryId: 'registry:v1',
    stateGraphId: 'state-graph:v1',
    hashVector: { dependencyGraphHash: 'dep', provenanceHash: 'prov', generationHash: id, invalidationHash: staleStateIds.join('|'), renderHash: 'render', decisionHash: 'decision', requirementHash: 'requirement' },
    stateRefs: registry().stateRecords.map(record => ({
      stateId: record.stateId,
      stateType: record.stateType,
      staleStatus: staleStateIds.includes(record.stateId) ? 'stale' : 'current',
      generationHash: record.generationHash,
      provenanceHash: record.provenanceHash,
      dependencyHash: record.dependencyHash,
      requirementIds: record.requirementIds,
      decisionIds: record.decisionIds,
      canonicalEvidenceIds: record.canonicalEvidenceIds,
      dependencyNodeIds: record.dependencyNodeIds,
    })),
    staleStateIds,
    validStateIds: registry().stateIds.filter(id => !staleStateIds.includes(id)),
    transitionEventIds: [],
    snapshotHash: `hash:${id}:${staleStateIds.join('|')}`,
    deterministicNotes: ['snapshot fixture'],
  };
}

function persistentGraph(): PersistentEngineeringStateGraph {
  return {
    graphId: 'persistent:v1',
    generatedAt,
    registryId: 'registry:v1',
    dependencyGraphId: 'graph:v1',
    nodes: [],
    edges: [],
    stateNodeIds: [],
    dependencyNodeIds: [],
    deterministicHash: 'persistent-hash',
    deterministicNotes: ['persistent fixture'],
  };
}

describe('Engineering Invalidation Propagation V1', () => {
  it('traces cyclic graphs deterministically with cycle and missing-node indicators', () => {
    const traversal = tracePropagation({ traversalId: 'test:traversal', seedNodeIds: ['canonicalEvidence:e1'], dependencyGraph: dependencyGraph(), maxDepth: 8 });
    expect(traversal.impactedNodeIds).toEqual(expect.arrayContaining(['requirement:main_service_panel', 'decision:service_panel_rating', 'section:msp']));
    expect(traversal.cycleDetected).toBe(true);
    expect(traversal.duplicateEdgeIdsSuppressed).toContain('edge:duplicate');
    expect(traversal.missingNodeIds).toContain('missing:node');
  });

  it('computes affected outputs and metadata-only regeneration plans without fabricating regeneration', () => {
    const propagation = computeEngineeringInvalidationPropagation({
      propagationId: 'propagation:v1',
      registry: registry(),
      invalidationResult: invalidationResult(),
      dependencyGraph: dependencyGraph(),
      persistentGraph: persistentGraph(),
      snapshots: [snapshot('baseline', []), snapshot('latest', ['state:section:msp'])],
    });
    expect(propagation.affectedStateIds).toEqual(['state:section:msp']);
    expect(propagation.affectedOutputs[0]?.staleClass).toBe('STALE');
    expect(propagation.deterministicNotes.join(' ')).toContain('No OCR');

    const plan = buildEngineeringRegenerationPlanV1({ planId: 'plan:v1', propagation, existingPlans: [] });
    expect(plan.regenerationCandidateIds).toEqual(['state:section:msp']);
    expect(plan.deterministicNotes.join(' ')).toContain('never regenerates');
  });

  it('builds snapshot delta and workspace sections for sparse/not-loaded transitions safely', () => {
    const propagation = computeEngineeringInvalidationPropagation({
      propagationId: 'propagation:v1',
      registry: registry(),
      invalidationResult: invalidationResult(),
      dependencyGraph: dependencyGraph(),
      snapshots: [snapshot('baseline', []), snapshot('latest', ['state:section:msp'])],
    });
    const delta = buildEngineeringSnapshotDeltaV1({
      deltaId: 'delta:v1',
      previousSnapshot: snapshot('baseline', []),
      nextSnapshot: snapshot('latest', ['state:section:msp']),
      propagation,
    });
    expect(delta.staleOutputsIntroduced).toEqual(['state:section:msp']);
    expect(delta.entries.some(entry => entry.deltaType === 'stale_output_introduced')).toBe(true);

    const plan = buildEngineeringRegenerationPlanV1({ planId: 'plan:v1', propagation });
    const workspace = buildEngineeringIntelligenceWorkspace({
      projectId: 'project-v1',
      snapshots: [snapshot('baseline', []), snapshot('latest', ['state:section:msp'])],
      invalidationResult: invalidationResult(),
      invalidationPropagation: propagation,
      regenerationPlanV1: plan,
      snapshotDelta: delta,
    });
    expect(workspace.invalidationPropagation.impactedOutputs).toContain('renderContext:primary');
    expect(workspace.dependencyTraversal.cycleProtectionIndicators).toContain('cycleDetected:true');
    expect(workspace.regenerationPlanningV1.wouldRegenerate).toContain('state:section:msp');
    expect(workspace.snapshotDelta.staleOutputsIntroduced).toContain('state:section:msp');
    expect(workspace.affectedOutputs.outputs.length).toBe(1);
    expect(workspace.staleStateTimeline.events).toEqual([]);
  });
});
