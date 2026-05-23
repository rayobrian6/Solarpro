/** @vitest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  CADReadinessWorkspace,
  DependencyGraphViewer,
  PhotoGroupingWorkspace,
  SnapshotTimelineWorkspace,
  StaleInvalidationWorkspace,
} from '@/app/admin/engineering-intelligence/components';
import type { CADReadinessMetadataModel } from '@/lib/engineeringIntelligence/cadReadiness';
import type { DeterministicPhotoGroupingModel } from '@/lib/engineeringIntelligence/photoGrouping';
import type {
  DependencyGraphViewerModel,
  SnapshotTimelineWorkspaceModel,
  StaleInvalidationWorkspaceModel,
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
});
