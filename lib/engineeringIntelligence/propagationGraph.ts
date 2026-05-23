import type { EngineeringDependencyEdge, EngineeringDependencyEdgeType, EngineeringDependencyGraph, EngineeringDependencyNode, EngineeringDependencyNodeType } from '@/lib/documentProvenance';
import type { PersistentEngineeringStateGraph, PersistentEngineeringStateGraphEdge, PersistentEngineeringStateGraphNode } from '@/lib/engineeringStateInvalidation';

export type EngineeringStaleClass = 'VALID' | 'PARTIAL' | 'STALE' | 'INVALIDATED' | 'BLOCKED' | 'NOT_LOADED' | 'REQUIRES_REVIEW';

export type PropagationTraversalDirection = 'downstream' | 'upstream';
export type PropagationSourceGraphType = 'document_dependency_graph' | 'persistent_state_graph' | 'merged_dependency_graph';
export type PropagationNodeKind = EngineeringDependencyNodeType | 'engineering_state' | 'dependency_graph_node' | 'snapshot' | 'unknown';
export type PropagationEdgeClassification =
  | EngineeringDependencyEdgeType
  | 'depends_on_dependency_node'
  | 'invalidates_state'
  | 'preserves_stale_state'
  | 'supersedes_snapshot'
  | 'reverse_lookup'
  | 'unknown';

export interface PropagationGraphNode {
  nodeId: string;
  nodeKind: PropagationNodeKind;
  label: string;
  sourceGraphType: PropagationSourceGraphType;
  deterministicNotes: string[];
}

export interface PropagationGraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: PropagationEdgeClassification;
  sourceGraphType: PropagationSourceGraphType;
  deterministicReason: string;
}

export interface PropagationTraversalPath {
  pathId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction: PropagationTraversalDirection;
  nodeIds: string[];
  edgeIds: string[];
  edgeTypes: PropagationEdgeClassification[];
  depth: number;
  cycleDetected: boolean;
  truncated: boolean;
  deterministicReason: string;
}

export interface PropagationTraversalResult {
  traversalId: string;
  sourceGraphTypes: PropagationSourceGraphType[];
  direction: PropagationTraversalDirection;
  seedNodeIds: string[];
  visitedNodeIds: string[];
  impactedNodeIds: string[];
  paths: PropagationTraversalPath[];
  maxDepth: number;
  traversalLimit: number;
  cycleDetected: boolean;
  truncated: boolean;
  duplicateEdgeIdsSuppressed: string[];
  missingNodeIds: string[];
  deterministicNotes: string[];
}

export interface TracePropagationInput {
  traversalId: string;
  seedNodeIds: string[];
  direction?: PropagationTraversalDirection;
  dependencyGraph?: EngineeringDependencyGraph | null;
  persistentGraph?: PersistentEngineeringStateGraph | null;
  maxDepth?: number;
  traversalLimit?: number;
}

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_TRAVERSAL_LIMIT = 750;

export function mergePropagationGraph(input: {
  dependencyGraph?: EngineeringDependencyGraph | null;
  persistentGraph?: PersistentEngineeringStateGraph | null;
}): { nodes: PropagationGraphNode[]; edges: PropagationGraphEdge[]; duplicateEdgeIdsSuppressed: string[]; missingNodeIds: string[]; sourceGraphTypes: PropagationSourceGraphType[] } {
  const nodes = new Map<string, PropagationGraphNode>();
  const edges = new Map<string, PropagationGraphEdge>();
  const duplicateEdgeIdsSuppressed = new Set<string>();
  const missingNodeIds = new Set<string>();
  const sourceGraphTypes = new Set<PropagationSourceGraphType>();

  for (const node of input.dependencyGraph?.nodes ?? []) {
    sourceGraphTypes.add('document_dependency_graph');
    const normalized = normalizeDependencyNode(node);
    if (!nodes.has(normalized.nodeId)) nodes.set(normalized.nodeId, normalized);
  }

  for (const edge of input.dependencyGraph?.edges ?? []) {
    sourceGraphTypes.add('document_dependency_graph');
    putEdge(edges, duplicateEdgeIdsSuppressed, normalizeDependencyEdge(edge));
  }

  for (const node of input.persistentGraph?.nodes ?? []) {
    sourceGraphTypes.add('persistent_state_graph');
    const normalized = normalizePersistentNode(node);
    if (!nodes.has(normalized.nodeId)) nodes.set(normalized.nodeId, normalized);
  }

  for (const edge of input.persistentGraph?.edges ?? []) {
    sourceGraphTypes.add('persistent_state_graph');
    putEdge(edges, duplicateEdgeIdsSuppressed, normalizePersistentEdge(edge));
  }

  for (const edge of edges.values()) {
    if (!nodes.has(edge.fromNodeId)) missingNodeIds.add(edge.fromNodeId);
    if (!nodes.has(edge.toNodeId)) missingNodeIds.add(edge.toNodeId);
  }

  return {
    nodes: sortBy([...nodes.values()], node => node.nodeId),
    edges: sortBy([...edges.values()], edge => edge.edgeId),
    duplicateEdgeIdsSuppressed: sortText([...duplicateEdgeIdsSuppressed]),
    missingNodeIds: sortText([...missingNodeIds]),
    sourceGraphTypes: sortText([...sourceGraphTypes]) as PropagationSourceGraphType[],
  };
}

export function tracePropagation(input: TracePropagationInput): PropagationTraversalResult {
  const merged = mergePropagationGraph(input);
  const direction = input.direction ?? 'downstream';
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const traversalLimit = input.traversalLimit ?? DEFAULT_TRAVERSAL_LIMIT;
  const seedNodeIds = sortText(unique(input.seedNodeIds));
  const nodeIds = new Set(merged.nodes.map(node => node.nodeId));
  const missingNodeIds = new Set(merged.missingNodeIds);
  for (const seed of seedNodeIds) if (!nodeIds.has(seed)) missingNodeIds.add(seed);

  const adjacency = buildAdjacency(merged.edges, direction);
  const queue: Array<{ nodeId: string; nodePath: string[]; edgePath: string[]; edgeTypes: PropagationEdgeClassification[] }> = seedNodeIds.map(nodeId => ({ nodeId, nodePath: [nodeId], edgePath: [], edgeTypes: [] }));
  const visited = new Set<string>(seedNodeIds);
  const paths = new Map<string, PropagationTraversalPath>();
  let cycleDetected = false;
  let truncated = false;
  let visitCount = 0;

  while (queue.length) {
    if (visitCount >= traversalLimit) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    visitCount += 1;
    if (current.nodePath.length - 1 >= maxDepth) {
      if ((adjacency.get(current.nodeId) ?? []).length) truncated = true;
      continue;
    }

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextNodeId = direction === 'downstream' ? edge.toNodeId : edge.fromNodeId;
      const nextNodePath = [...current.nodePath, nextNodeId];
      const nextEdgePath = [...current.edgePath, edge.edgeId];
      const nextEdgeTypes = [...current.edgeTypes, edge.edgeType];
      const pathHasCycle = current.nodePath.includes(nextNodeId);
      cycleDetected = cycleDetected || pathHasCycle;
      const pathId = stablePathId(input.traversalId, direction, current.nodePath[0], nextNodeId, nextEdgePath);
      if (!paths.has(pathId)) {
        paths.set(pathId, {
          pathId,
          sourceNodeId: current.nodePath[0],
          targetNodeId: nextNodeId,
          direction,
          nodeIds: nextNodePath,
          edgeIds: nextEdgePath,
          edgeTypes: nextEdgeTypes,
          depth: nextEdgePath.length,
          cycleDetected: pathHasCycle,
          truncated: nextEdgePath.length >= maxDepth && (adjacency.get(nextNodeId) ?? []).length > 0,
          deterministicReason: `Traversal ${direction} from ${current.nodePath[0]} reaches ${nextNodeId} through ${nextEdgePath.length} edge(s).`,
        });
      }
      if (!visited.has(nextNodeId)) {
        visited.add(nextNodeId);
        queue.push({ nodeId: nextNodeId, nodePath: nextNodePath, edgePath: nextEdgePath, edgeTypes: nextEdgeTypes });
      }
    }
  }

  return {
    traversalId: input.traversalId,
    sourceGraphTypes: merged.sourceGraphTypes,
    direction,
    seedNodeIds,
    visitedNodeIds: sortText([...visited]),
    impactedNodeIds: sortText([...visited].filter(nodeId => !seedNodeIds.includes(nodeId))),
    paths: sortBy([...paths.values()], path => path.pathId),
    maxDepth,
    traversalLimit,
    cycleDetected,
    truncated,
    duplicateEdgeIdsSuppressed: merged.duplicateEdgeIdsSuppressed,
    missingNodeIds: sortText([...missingNodeIds]),
    deterministicNotes: [
      `Traversal uses supplied dependency/persistent graph metadata only with maxDepth=${maxDepth} and traversalLimit=${traversalLimit}.`,
      'Visited-node cycle protection prevents recursive graph loops; detected cycles are reported instead of hidden.',
      'Missing nodes are reported as not-loaded metadata; no node or engineering state is fabricated.',
    ],
  };
}

function normalizeDependencyNode(node: EngineeringDependencyNode): PropagationGraphNode {
  return {
    nodeId: node.id,
    nodeKind: node.nodeType,
    label: node.label,
    sourceGraphType: 'document_dependency_graph',
    deterministicNotes: node.deterministicNotes,
  };
}

function normalizeDependencyEdge(edge: EngineeringDependencyEdge): PropagationGraphEdge {
  return {
    edgeId: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    edgeType: edge.edgeType,
    sourceGraphType: 'document_dependency_graph',
    deterministicReason: edge.deterministicReason,
  };
}

function normalizePersistentNode(node: PersistentEngineeringStateGraphNode): PropagationGraphNode {
  return {
    nodeId: node.nodeId,
    nodeKind: node.nodeKind === 'state_record' ? 'engineering_state' : 'dependency_graph_node',
    label: node.stateId ?? node.dependencyNodeId ?? node.nodeId,
    sourceGraphType: 'persistent_state_graph',
    deterministicNotes: node.deterministicNotes,
  };
}

function normalizePersistentEdge(edge: PersistentEngineeringStateGraphEdge): PropagationGraphEdge {
  return {
    edgeId: edge.edgeId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    edgeType: edge.edgeType,
    sourceGraphType: 'persistent_state_graph',
    deterministicReason: edge.deterministicReason,
  };
}

function putEdge(edges: Map<string, PropagationGraphEdge>, duplicateEdgeIdsSuppressed: Set<string>, edge: PropagationGraphEdge) {
  const signature = `${edge.fromNodeId}->${edge.toNodeId}:${edge.edgeType}`;
  const duplicate = [...edges.values()].find(existing => `${existing.fromNodeId}->${existing.toNodeId}:${existing.edgeType}` === signature);
  if (duplicate) {
    duplicateEdgeIdsSuppressed.add(edge.edgeId);
    return;
  }
  if (edges.has(edge.edgeId)) {
    duplicateEdgeIdsSuppressed.add(edge.edgeId);
    return;
  }
  edges.set(edge.edgeId, edge);
}

function buildAdjacency(edges: PropagationGraphEdge[], direction: PropagationTraversalDirection): Map<string, PropagationGraphEdge[]> {
  const adjacency = new Map<string, PropagationGraphEdge[]>();
  for (const edge of edges) {
    const key = direction === 'downstream' ? edge.fromNodeId : edge.toNodeId;
    adjacency.set(key, [...(adjacency.get(key) ?? []), edge]);
  }
  for (const [key, values] of adjacency) adjacency.set(key, sortBy(values, edge => edge.edgeId));
  return adjacency;
}

function stablePathId(prefix: string, direction: PropagationTraversalDirection, source: string, target: string, edgeIds: string[]): string {
  return `${prefix}:path:${direction}:${sanitize(source)}:${sanitize(target)}:${stableSmallHash(edgeIds)}`;
}

function stableSmallHash(values: string[]): string {
  const payload = values.join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 96);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value.length > 0)));
}

export function sortText<T extends string>(values: T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function sortBy<T>(values: T[], selector: (value: T) => string): T[] {
  return [...values].sort((a, b) => selector(a).localeCompare(selector(b)));
}
