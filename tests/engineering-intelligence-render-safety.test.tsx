/** @vitest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  CADReadinessWorkspace,
  ContextArbitrationWorkspace,
  ContextConfidenceBreakdownWorkspace,
  ContextConflictInspectorWorkspace,
  ContextDependencyGraphWorkspace,
  ContextInvalidationsWorkspace,
  ContextProvenanceWorkspace,
  ContextResolutionTimelineWorkspace,
  ContextStaleImpactsWorkspace,
  DependencyGraphViewer,
  FallbackChainInspectorWorkspace,
  PhotoGroupingWorkspace,
  ScenarioSimulationWorkspace,
  HypotheticalStateDeltaWorkspace,
  AffectedOutputSimulationWorkspace,
  StalePropagationSimulationWorkspace,
  ContextImpactSimulationWorkspace,
  RequirementImpactSimulationWorkspace,
  FallbackConflictDeltaViewer,
  RegenerationForecastWorkspace,
  ConfidenceDeltaTimelineWorkspace,
  SimulationDependencyTraversalWorkspace,
  ResolvedEngineeringContextsWorkspace,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
} from '@/app/admin/engineering-intelligence/components';
import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { DeterministicPhotoGroupingModel } from '@/lib/engineeringIntelligence/photoGrouping';
import type {
  ContextArbitrationWorkspaceModel,
  ContextConfidenceBreakdownWorkspaceModel,
  ContextConflictInspectorWorkspaceModel,
  ContextDependencyGraphWorkspaceModel,
  ContextInvalidationsWorkspaceModel,
  ContextProvenanceWorkspaceModel,
  ContextResolutionTimelineWorkspaceModel,
  ContextStaleImpactsWorkspaceModel,
  DependencyGraphViewerModel,
  FallbackChainInspectorWorkspaceModel,
  ResolvedEngineeringContextsWorkspaceModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
  EngineeringScenarioSimulationResult,
} from '@/lib/engineeringIntelligence';

describe('Engineering Intelligence workspace render safety', () => {
  it('renders real-project photo grouping metadata summaries without raw object React children', () => {
    const grouping = {
      generatedAt: new Date('2026-01-02T03:04:05Z'),
      projectId: 'project-real-uuid',
      surveyId: 'survey-real-uuid',
      source: 'canonical_manifest_metadata',
      surveyTraversalOrder: [{
        sequenceIndex: BigInt(1),
        evidenceId: { id: 'evidence-object', metadata: { nested: true } },
        surveyId: 'survey-real-uuid',
        siteSurveyFileId: null,
        filename: new Date('2026-01-02T03:04:05Z'),
        category: { canonical: 'roof' },
        submittedCategory: new Map([['submitted', 'roof-side']]),
        captureTimestamp: new Set(['2026-01-02T03:04:05Z']),
        uploadTimestamp: null,
        deterministicSortKey: 'sort-key',
        metadataCompletenessScore: 0.7,
        orientation: { exif: 'landscape' },
        widthPx: 1200,
        heightPx: undefined,
      }],
      surveyTraversalSegments: [{
        segmentId: { segment: 'segment-object' },
        sequenceStart: 1,
        sequenceEnd: 2,
        evidenceIds: [{ id: 'e1' }, 'e2'],
        dominantClusterType: 'roof_side_candidate',
        dominantCategories: [{ category: 'roof' }, 'utility'],
        continuityConfidence: { confidence: 'metadata_only_high' },
        clusterBoundaryReasons: [new Map([['reason', 'timestamp']])],
        clusterTransitionReasons: [new Set(['category-change'])],
        probableMovementContext: { summary: 'metadata-only movement context' },
      }],
      evidenceClusters: [{
        clusterId: { cluster: 'cluster-object' },
        clusterType: 'roof_side_candidate',
        label: { text: 'Roof cluster' },
        evidenceIds: [{ id: 'e1' }],
        categories: [{ category: 'roof' }],
        sequenceStart: 1,
        sequenceEnd: 2,
        clusterConfidence: { confidence: 'metadata_only_medium' },
        clusterBoundaryReasons: [{ reason: 'boundary' }],
        clusterTransitionReasons: [{ reason: 'transition' }],
        metadataCompletenessScore: 0.8,
        readinessPromotionContext: [{ flag: 'roof-ready' }],
      }],
      roofSideCandidateGroups: [],
      routingContinuityGroups: [],
      utilityEvidenceGroups: [],
      electricalEvidenceGroups: [],
      detachedStructureGroups: [{ clusterId: { nested: 'detached-cluster' } }],
      groundMountCandidateGroups: [{ clusterId: new Set(['ground-cluster']) }],
      sequenceBreakpoints: [{ breakpointId: { id: 'bp' }, reason: { nested: 'object reason' } }],
      photoContinuityChains: [{ chainId: { id: 'chain' }, sequenceStart: BigInt(1), sequenceEnd: 2, continuityConfidence: new Set(['metadata_only_low']) }],
      metadataCompletenessScores: [{ evidenceId: { id: 'e1' }, score: 0.5, missingFields: [{ field: 'timestamp' }, new Map([['field', 'orientation']])] }],
      groupedCADReadiness: [{
        contextId: { id: 'ctx' },
        label: { label: 'Grouped readiness' },
        status: new Map([['status', 'partial']]),
        linkedReadinessFlagIds: [{ flag: 'flag-a' }],
        supportingClusterIds: [new Set(['cluster-a'])],
        blockingReasons: [{ reason: 'missing electrical evidence' }],
        deterministicReason: { reason: 'metadata summary only' },
      }],
      deterministicNotes: [{ note: 'object note' }, new Set(['set note'])],
      prohibitedRuntimeBehavior: ['no OCR', { guard: 'no CV' }],
    } as unknown as DeterministicPhotoGroupingModel;

    expect(() => render(<PhotoGroupingWorkspace grouping={grouping} />)).not.toThrow();
    expect(screen.getByText('Deterministic Photo Grouping + Survey Sequence')).toBeInTheDocument();
    expect(screen.getAllByText(/object\(keys=/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Set\(/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Map\(/).length).toBeGreaterThan(0);
  });

  it('renders sparse and partial CAD readiness metadata without object children', () => {
    const readiness = {
      readyFlags: null,
      partialFlags: [{ flagId: 'partial' }],
      blockedFlags: undefined,
      flags: [{
        flagId: { flag: 'flag-object' },
        status: { status: 'partial' },
        deterministicReason: { reason: 'missing explicit metadata' },
        satisfiedCategories: new Set(['roof']),
        missingCategories: [{ category: 'electrical' }],
        explicitSurveySignals: [new Map([['signal', 'timestamp']])],
      }],
      prohibitedRuntimeBehavior: [{ guard: 'no autonomous CAD' }],
      deterministicNotes: [null, undefined, { note: 'partial readiness note' }],
    } as unknown as CADReadinessMetadataModel;

    expect(() => render(<CADReadinessWorkspace readiness={readiness} />)).not.toThrow();
    expect(screen.getByText('CAD Readiness Metadata')).toBeInTheDocument();
    expect(screen.getAllByText(/object\(keys=/).length).toBeGreaterThan(0);
  });

  it('renders graph, snapshot, and invalidation metadata summaries safely', () => {
    const graph = {
      nodes: [{
        nodeId: { node: 'node-object' },
        label: { label: 'Nested graph label' },
        nodeType: new Set(['evidence']),
        status: { status: 'current' },
        provenanceSummary: { source: 'snapshot' },
      }],
      edges: [{ edgeId: { edge: 'edge-object' }, sourceNodeId: { node: 'missing-source' }, targetNodeId: { node: 'missing-target' }, edgeType: 'depends_on' }],
      sourceGraph: { graphId: 'real-project-graph' },
      deterministicNotes: [{ note: 'graph metadata note' }],
    } as unknown as DependencyGraphViewerModel;

    const snapshots = {
      snapshots: [{
        snapshotId: { snapshot: 'snapshot-object' },
        generatedAt: new Date('2026-02-03T04:05:06Z'),
        previousSnapshotId: new Map([['previous', 'snapshot-a']]),
        supersededBySnapshotId: new Set(['snapshot-c']),
        snapshotHash: { hash: 'hash-object' },
        stateRefs: [{ state: 'ref-a' }],
        validStateIds: [{ state: 'valid-a' }],
        staleStateIds: new Set(['stale-a']),
        transitionEventIds: [BigInt(1)],
        deterministicNotes: [{ note: 'snapshot note' }],
      }],
      latestSnapshotId: { latest: 'snapshot-object' },
      snapshotHashes: [{ snapshotId: { id: 'snapshot-a' }, snapshotHash: { hash: 'hash-a' } }],
      diffs: [{ entries: [{ diffType: { type: 'changed' }, stateId: { id: 'state-a' } }] }],
      timeline: { staleStateIds: [{ id: 'stale-a' }] },
      transitionHistory: { transitionEvents: [{ eventType: { type: 'created' }, transitionEventId: { id: 'event-a' } }] },
      deterministicNotes: [{ note: 'timeline note' }],
    } as unknown as SnapshotTimelineWorkspaceModel;

    const stale = {
      staleOutputIds: [{ id: 'output-a' }],
      invalidationChains: [{
        eventId: { event: 'event-object' },
        stateId: { state: 'state-object' },
        reason: { reason: 'metadata changed' },
        triggeringEvidenceIds: [{ evidence: 'e1' }],
        triggeringDecisionIds: [new Map([['decision', 'd1']])],
        triggeringRequirementIds: [new Set(['r1'])],
        downstreamStateIds: [{ state: 'downstream' }],
      }],
      preservedOutputIds: null,
      regenerationScopeIds: undefined,
      deterministicNotes: [{ note: 'stale note' }],
    } as unknown as StaleInvalidationWorkspaceModel;

    expect(() => render(<DependencyGraphViewer graph={graph} />)).not.toThrow();
    expect(() => render(<SnapshotTimelineWorkspace snapshots={snapshots} />)).not.toThrow();
    expect(() => render(<StaleInvalidationWorkspace stale={stale} />)).not.toThrow();
    expect(screen.getByText('Dependency Graph Viewer')).toBeInTheDocument();
    expect(screen.getByText('Snapshot Timeline Workspace')).toBeInTheDocument();
    expect(screen.getByText('Stale-State / Invalidation Workspace')).toBeInTheDocument();
  });

  it('renders context resolution workspaces safely with hostile metadata values', () => {
    const resolvedContexts = {
      contexts: [{
        id: { id: 'context-object' },
        contextType: new Map([['type', 'roof_context']]),
        domain: new Set(['roof']),
        status: { status: 'conflicting' },
        confidence: {
          score: BigInt(42),
          band: { band: 'partial' },
          rank: new Date('2026-03-04T05:06:07Z'),
          factors: [{ factor: 'explicit primary' }, new Set(['supporting signal'])],
        },
        rankingReason: { reason: 'conflicting metadata preserved' },
        sourceSignalIds: [{ signal: 'roof-overview' }],
        supportingSignalIds: [new Map([['signal', 'attic-access']])],
        competingSignalIds: [new Set(['competing-signal'])],
        sourceEvidenceIds: [{ evidence: 'e1' }],
        sourceMetadataIds: [new Map([['metadata', 'm1']])],
        cadReadinessImpacts: [{ flag: 'roof-plane-ready' }],
        requirementImpacts: [new Set(['roof_overview'])],
        affectedOutputs: [{ output: 'layout' }],
        deterministicHash: { hash: 'hash-object' },
      }],
      authoritative: null,
      preferred: undefined,
      partial: [{ id: 'partial-context' }],
      conflicting: new Set(['conflict-a']),
      blocked: new Map([['blocked', 'context']]),
      unresolved: [{ id: 'unresolved-context' }],
      notApplicable: 'na-context',
      deterministicNotes: [{ note: 'context note' }, new Set(['set note'])],
    } as unknown as ResolvedEngineeringContextsWorkspaceModel;

    const arbitration = {
      rankings: [{
        contextId: { id: 'rank-context' },
        contextType: 'roof_context',
        domain: new Set(['roof']),
        status: { status: 'partial' },
        score: BigInt(55),
        rank: new Date('2026-03-04T05:06:07Z'),
        rankingReason: { reason: 'rank reason' },
        sourceSignalIds: [{ signal: 's1' }],
        supportingSignalIds: [new Map([['signal', 's2']])],
      }],
      deterministicNotes: [{ note: 'arbitration note' }],
    } as unknown as ContextArbitrationWorkspaceModel;

    const conflicts = {
      conflicts: [{
        conflictId: { conflict: 'conflict-object' },
        domain: new Set(['roof']),
        competingContextIds: [{ id: 'ctx-a' }],
        competingSignalIds: [new Map([['signal', 's1']])],
        conflictReasoning: [{ reason: 'competing evidence' }],
        deterministicResolutionPolicy: { policy: 'manual_review' },
      }],
      conflictingContextIds: [{ id: 'ctx-a' }],
      competingSignalIds: [new Set(['s1'])],
      deterministicNotes: [{ note: 'conflict note' }],
    } as unknown as ContextConflictInspectorWorkspaceModel;

    const fallback = {
      fallbackParticipation: [{
        contextId: { id: 'fallback-context' },
        fallback: new Map([['fallback', 'manual-review']]),
        deterministicReason: { reason: 'fallback is visible' },
      }],
      fallbackDependentContextIds: [{ id: 'fallback-context' }],
      fallbackConfidencePenalties: [{ contextId: { id: 'fallback-context' }, penalties: [new Set(['penalty'])] }],
      deterministicNotes: [{ note: 'fallback note' }],
    } as unknown as FallbackChainInspectorWorkspaceModel;

    const provenance = {
      chains: [{
        contextId: { id: 'provenance-context' },
        sourceSignalIds: [{ signal: 's1' }],
        sourceEvidenceIds: [new Map([['evidence', 'e1']])],
        sourceMetadataIds: [new Set(['m1'])],
        dependencyLineage: [{ dependency: 'dep1' }],
        invalidationLineage: [BigInt(2)],
        deterministicHash: { hash: 'provenance-hash' },
      }],
      deterministicNotes: [{ note: 'provenance note' }],
    } as unknown as ContextProvenanceWorkspaceModel;

    const dependencyGraph = {
      nodes: [{ nodeId: { node: 'ctx' }, label: new Set(['Context']), nodeType: { type: 'context' }, status: new Map([['status', 'source']]) }],
      edges: [{ edgeId: { edge: 'edge' }, sourceNodeId: { source: 's1' }, targetNodeId: new Set(['ctx']), edgeType: { type: 'supports' }, deterministicReason: { reason: 'edge reason' } }],
      deterministicNotes: [{ note: 'graph note' }],
    } as unknown as ContextDependencyGraphWorkspaceModel;

    const confidence = {
      confidenceBreakdown: [{
        contextId: { id: 'confidence-context' },
        status: new Map([['status', 'partial']]),
        score: BigInt(34),
        band: { band: 'low' },
        rank: new Date('2026-03-04T05:06:07Z'),
        factors: [{ factor: 'primary' }],
        penalties: [new Set(['fallback'])],
      }],
      deterministicNotes: [{ note: 'confidence note' }],
    } as unknown as ContextConfidenceBreakdownWorkspaceModel;

    const invalidations = {
      invalidations: [{
        contextId: { id: 'invalidated-context' },
        invalidationLineage: [{ invalidation: 'i1' }],
        staleImpactPropagation: [new Map([['state', 'stale']])],
        regenerationParticipation: [new Set(['candidate'])],
      }],
      deterministicNotes: [{ note: 'invalidation note' }],
    } as unknown as ContextInvalidationsWorkspaceModel;

    const staleImpacts = {
      staleImpacts: [{ contextId: { id: 'stale-context' }, staleClasses: [new Set(['STALE'])], invalidatedBy: [{ id: 'trigger' }] }],
      cadReadinessMappings: [{
        flagId: { flag: 'roof-plane-ready' },
        contextIds: [{ id: 'ctx' }],
        conflictingContextIds: [new Map([['ctx', 'conflict']])],
        blockedContextIds: [new Set(['blocked'])],
        unresolvedContextIds: [{ id: 'unresolved' }],
      }],
      deterministicNotes: [{ note: 'stale impact note' }],
    } as unknown as ContextStaleImpactsWorkspaceModel;

    const timeline = {
      events: [{
        eventId: { event: 'timeline-event' },
        contextId: new Map([['context', 'ctx']]),
        status: { status: 'partial' },
        deterministicReason: { reason: 'timeline reason' },
      }],
      deterministicNotes: [{ note: 'timeline note' }],
    } as unknown as ContextResolutionTimelineWorkspaceModel;

    expect(() => render(<ResolvedEngineeringContextsWorkspace model={resolvedContexts} />)).not.toThrow();
    expect(() => render(<ContextArbitrationWorkspace model={arbitration} />)).not.toThrow();
    expect(() => render(<ContextConflictInspectorWorkspace model={conflicts} />)).not.toThrow();
    expect(() => render(<FallbackChainInspectorWorkspace model={fallback} />)).not.toThrow();
    expect(() => render(<ContextProvenanceWorkspace model={provenance} />)).not.toThrow();
    expect(() => render(<ContextDependencyGraphWorkspace model={dependencyGraph} />)).not.toThrow();
    expect(() => render(<ContextConfidenceBreakdownWorkspace model={confidence} />)).not.toThrow();
    expect(() => render(<ContextInvalidationsWorkspace model={invalidations} />)).not.toThrow();
    expect(() => render(<ContextStaleImpactsWorkspace model={staleImpacts} />)).not.toThrow();
    expect(() => render(<ContextResolutionTimelineWorkspace model={timeline} />)).not.toThrow();

    expect(screen.getByText('Resolved Engineering Contexts')).toBeInTheDocument();
    expect(screen.getByText('Context Arbitration')).toBeInTheDocument();
    expect(screen.getByText('Context Conflict Inspector')).toBeInTheDocument();
    expect(screen.getByText('Fallback Chain Inspector')).toBeInTheDocument();
    expect(screen.getByText('Context Provenance')).toBeInTheDocument();
    expect(screen.getByText('Context Dependency Graph')).toBeInTheDocument();
    expect(screen.getByText('Context Confidence Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Context Invalidations')).toBeInTheDocument();
    expect(screen.getByText('Context Stale Impacts')).toBeInTheDocument();
    expect(screen.getByText('Context Resolution Timeline')).toBeInTheDocument();
    expect(screen.getAllByText(/object\(keys=/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Set\(/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Map\(/).length).toBeGreaterThan(0);
  });
  it('renders scenario simulation workspaces safely while preserving hypothetical truth boundary copy', () => {
    const simulation = {
      scenarioId: { id: 'scenario-object', nested: true },
      scenarioType: new Map([['scenarioType', 'evidence_change']]),
      mode: 'read_only_sandbox',
      operations: [{ operationId: { id: 'operation-object' }, deterministicReason: new Set(['what-if evidence changed']) }],
      affectedEvidenceIds: [{ evidence: 'e1' }],
      affectedContextIds: [{ context: 'ctx1' }],
      affectedRequirementIds: [new Map([['requirement', 'roof_overview']])],
      regenerationCandidateIds: [new Set(['output-layout'])],
      deterministicExplanation: [{ note: 'hypothetical explanation' }, new Set(['read-only sandbox'])],
      prohibitedRuntimeBehavior: ['no OCR', { guard: 'no production mutation' }],
      deltas: [{
        deltaId: 'delta:object-status',
        entityType: { type: 'signal' },
        entityId: { id: 'signal:main_service_panel_present' },
        deltaType: new Map([['delta', 'changed']]),
        previousStatus: { production: 'confirmed' },
        simulatedStatus: new Set(['blocked']),
        staleClass: { stale: 'engineering_required' },
        deterministicReason: { reason: 'hypothetical invalidation only' },
      }],
      fallbackDeltas: [{
        deltaId: 'delta:fallback',
        entityType: { type: 'context' },
        entityId: { id: 'context:preferred_routing_context' },
        deltaType: 'changed',
        previousStatus: 'fallback_available',
        simulatedStatus: 'fallback_removed',
        staleClass: 'engineering_review_required',
        deterministicReason: new Map([['reason', 'fallback removed in sandbox']]),
      }],
      conflictDeltas: [{
        deltaId: 'delta:conflict',
        entityType: 'signal',
        entityId: 'signal:routing_continuity_present',
        deltaType: 'changed',
        previousStatus: 'confirmed',
        simulatedStatus: 'conflicting',
        staleClass: 'engineering_review_required',
        deterministicReason: { reason: 'conflict introduced in sandbox' },
      }],
      confidenceDeltas: [{
        entityType: { type: 'context' },
        entityId: { id: 'context:preferred_msp_context' },
        previousScore: { score: 0.86 },
        simulatedScore: new Set([0.41]),
        delta: -0.45,
        deterministicReason: { reason: 'confidence lowered deterministically' },
      }],
      staleImpacts: [{
        entityId: { id: 'state:msp' },
        staleClasses: [new Set(['engineering_review_required'])],
        deterministicReason: { reason: 'stale propagated through explicit graph' },
      }],
      dependencyTraversalPaths: [{
        pathId: { id: 'path-object' },
        nodeIds: [{ node: 'source' }, new Map([['node', 'target']])],
        deterministicReason: new Set(['cycle-safe traversal']),
      }],
      hypothetical: {
        invalidationPropagation: {
          staleClassCounts: { engineering_review_required: BigInt(2), cad_update_required: { count: 1 } },
          affectedOutputs: [{
            impactId: 'impact:layout',
            outputId: { output: 'layout' },
            staleClass: new Set(['cad_update_required']),
            stateId: { state: 'state:layout' },
            outputType: new Map([['type', 'cad_layout']]),
            propagationPathIds: [{ path: 'path:layout' }],
            deterministicReason: { reason: 'metadata-only affected output forecast' },
          }],
        },
        contextResolution: {
          contexts: [{
            id: { id: 'context:preferred_msp_context' },
            status: 'blocked',
            confidence: { score: { value: 0.4 }, rank: BigInt(4) },
            fallbackLineage: [new Set(['manual_review'])],
            unresolvedDependencies: [new Map([['dependency', 'msp_photo']])],
          }],
        },
        regenerationPlan: {
          regenerationCandidateIds: [{ output: 'layout' }],
          reviewRequiredIds: [new Set(['review:msp'])],
          blockedDependencyIds: [new Map([['dependency', 'msp_context']])],
          missingEvidenceIds: [{ evidence: 'msp_photo' }],
          deterministicNotes: [{ note: 'metadata-only; never regenerates outputs' }],
        },
        dependencyTraversal: {
          visitedNodeIds: [{ node: 'source' }, { node: 'target' }],
          cycleDetected: false,
          truncated: false,
        },
      },
    } as unknown as EngineeringScenarioSimulationResult;

    expect(() => render(<ScenarioSimulationWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<HypotheticalStateDeltaWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<AffectedOutputSimulationWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<StalePropagationSimulationWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<ContextImpactSimulationWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<RequirementImpactSimulationWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<FallbackConflictDeltaViewer simulation={simulation} />)).not.toThrow();
    expect(() => render(<RegenerationForecastWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<ConfidenceDeltaTimelineWorkspace simulation={simulation} />)).not.toThrow();
    expect(() => render(<SimulationDependencyTraversalWorkspace simulation={simulation} />)).not.toThrow();

    expect(screen.getByText('Scenario Simulation Workspace')).toBeInTheDocument();
    expect(screen.getByText(/hypothetical Engineering Scenario Simulation V1 metadata only/)).toBeInTheDocument();
    expect(screen.getByText(/not production truth/)).toBeInTheDocument();
    expect(screen.getByText('Regeneration Forecast')).toBeInTheDocument();
    expect(screen.getAllByText(/object\(keys=/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Set\(/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Map\(/).length).toBeGreaterThan(0);
  });

});
