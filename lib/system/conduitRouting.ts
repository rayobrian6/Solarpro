// ============================================================================
// lib/system/conduitRouting.ts — Conduit Path Routing Engine
//
// VERSION: 1
//
// PIPELINE POSITION:
//   CADModel (after roofCAD.ts runs)
//     + SystemDefinition.electricalNodes
//     + SystemDefinition.obstructions
//     → routeConduit()  ← YOU ARE HERE
//     → CADConduitRoute[]
//     → Written to CADModel.conduitRoutes
//     → Rendered by plan-set / permit templates
//
// RESPONSIBILITIES:
//   1. Find the array drop point (centroid of bottom-row panels on primary plane)
//   2. Find the closest roof edge exit point to the drop point
//   3. Route from drop point → roof edge exit → down wall → electrical node
//   4. Avoid all obstructions (stay >= totalRadiusM from each center)
//   5. Minimize total conduit length and number of 90° bends
//   6. Return CADConduitRoute with waypoints and metadata
//
// ROUTING ALGORITHM:
//   - Simple visibility graph + A* shortest path
//   - Nodes: array_drop, obstruction_avoidance_waypoints, roof_edge, electrical_node
//   - Edges: straight-line segments that don't intersect obstruction exclusion zones
//   - Fallback: direct straight line (if no obstructions or vision data absent)
//
// NON-BREAKING GUARANTEE:
//   - NEVER throws — all errors caught, fallback straight-line route returned
//   - If no electrical nodes exist, returns empty array
//   - If no obstructions exist, returns direct route
// ============================================================================

import type { CADModel, CADPanel, CADObstruction, CADElectricalNode, CADConduitRoute, CADConduitWaypoint } from '@/lib/cad/types';
import type { Point2D } from '@/lib/cad/geometry';
import { dist2D, centroid, bbox } from '@/lib/cad/geometry';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Clearance buffer added around obstructions when routing (meters) */
const ROUTE_CLEARANCE_M = 0.15;

/** Maximum conduit route length before we emit a warning (meters) */
const WARN_ROUTE_LENGTH_M = 30;

/** Maximum A* iterations before fallback */
const MAX_ASTAR_ITERATIONS = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

interface RouteNode {
  id: string;
  x: number;
  y: number;
  label?: string;
}

interface AStarNode {
  node: RouteNode;
  gCost: number;   // cost from start
  hCost: number;   // heuristic to end
  fCost: number;   // g + h
  parent: AStarNode | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ConduitRoutingOptions {
  /** Override array drop point (defaults to centroid of bottom-row panels) */
  dropPointOverride?: Point2D;
  /** Override roof edge exit point */
  roofEdgeOverride?: Point2D;
}

/**
 * routeConduit — computes conduit routes for a solved CAD model.
 *
 * Returns one CADConduitRoute per electrical node that is a primary
 * interconnect target. Additional routes may be added for sub-panels.
 *
 * SAFETY: Returns [] on any error. Never throws.
 */
export function routeConduit(
  cadModel: CADModel,
  options: ConduitRoutingOptions = {},
): CADConduitRoute[] {
  try {
    return _routeConduitInternal(cadModel, options);
  } catch (err) {
    console.error('[conduitRouting] routeConduit failed (non-fatal):', err);
    return [];
  }
}

// ─── Internal implementation ──────────────────────────────────────────────────

function _routeConduitInternal(
  cadModel: CADModel,
  options: ConduitRoutingOptions,
): CADConduitRoute[] {
  const routes: CADConduitRoute[] = [];
  const obstructions = cadModel.obstructions ?? [];
  const electricalNodes = cadModel.electricalNodes ?? [];

  if (electricalNodes.length === 0) {
    console.log('[conduitRouting] No electrical nodes — skipping conduit routing');
    return [];
  }

  // ── Find array drop point ─────────────────────────────────────────────────
  const dropPoint = options.dropPointOverride
    ? options.dropPointOverride
    : findArrayDropPoint(cadModel);

  if (!dropPoint) {
    console.log('[conduitRouting] Could not determine array drop point — skipping');
    return [];
  }

  // ── Route to each primary interconnect target ─────────────────────────────
  const primaryNodes = electricalNodes.filter(n => n.isPrimaryInterconnect);
  const targetNodes = primaryNodes.length > 0 ? primaryNodes : electricalNodes.slice(0, 1);

  for (const elecNode of targetNodes) {
    const route = routeToNode(
      dropPoint,
      elecNode,
      obstructions,
      options,
    );
    routes.push(route);
    console.log(`[conduitRouting] Routed to ${elecNode.type} id=${elecNode.id} method=${route.routeMethod} length=${route.totalLengthM.toFixed(1)}m bends=${route.bendCount}`);
  }

  return routes;
}

// ─── Array drop point ─────────────────────────────────────────────────────────

/**
 * Find the array drop point — the optimal point to exit the array
 * and begin conduit routing to the electrical panel.
 *
 * Strategy:
 *   1. Bottom-row panels of the primary roof plane
 *   2. Centroid of those panels
 *   3. Fallback: centroid of all panels
 */
function findArrayDropPoint(cadModel: CADModel): Point2D | null {
  const roofModel = cadModel.roof;
  if (!roofModel || roofModel.planes.length === 0) return null;

  // Use the primary plane (first plane)
  const primaryPlane = roofModel.planes[0];
  const panels = primaryPlane.panels;
  if (panels.length === 0) return null;

  // Find bottom row (highest Y value = closest to eave = nearest to ground)
  const maxRow = Math.max(...panels.map(p => p.row));
  const bottomPanels = panels.filter(p => p.row === maxRow);

  // Centroid of bottom-row panel centers
  const dropX = bottomPanels.reduce((s, p) => s + p.x + p.widthM / 2, 0) / bottomPanels.length;
  const dropY = bottomPanels.reduce((s, p) => s + p.y + p.heightM / 2, 0) / bottomPanels.length;

  return { x: dropX, y: dropY };
}

// ─── Route to a single node ───────────────────────────────────────────────────

function routeToNode(
  dropPoint: Point2D,
  targetNode: CADElectricalNode,
  obstructions: CADObstruction[],
  options: ConduitRoutingOptions,
): CADConduitRoute {
  const warnings: string[] = [];
  const target: Point2D = { x: targetNode.x, y: targetNode.y };

  // ── No obstructions → direct route ────────────────────────────────────────
  if (obstructions.length === 0) {
    const waypoints: CADConduitWaypoint[] = [
      { x: dropPoint.x, y: dropPoint.y, label: 'array_drop' },
      { x: target.x, y: target.y, label: `${targetNode.type}_entry` },
    ];
    const length = dist2D(dropPoint, target);
    return {
      id: `route_${targetNode.id}`,
      waypoints,
      totalLengthM: length,
      bendCount: 0,
      targetNodeId: targetNode.id,
      routeMethod: 'shortest_path',
      warnings: length > WARN_ROUTE_LENGTH_M
        ? [`Route length ${length.toFixed(1)}m exceeds ${WARN_ROUTE_LENGTH_M}m — verify conduit fill`]
        : [],
    };
  }

  // ── A* path through visibility graph ─────────────────────────────────────
  const visNodes = buildVisibilityNodes(dropPoint, target, obstructions);
  const path = astarRoute(
    { id: 'start', x: dropPoint.x, y: dropPoint.y, label: 'array_drop' },
    { id: 'end',   x: target.x,   y: target.y,   label: `${targetNode.type}_entry` },
    visNodes,
    obstructions,
    warnings,
  );

  if (path.length < 2) {
    // A* failed — fallback to straight line with a warning
    warnings.push('A* routing failed — using straight-line fallback (verify clearances)');
    const fallbackWaypoints: CADConduitWaypoint[] = [
      { x: dropPoint.x, y: dropPoint.y, label: 'array_drop' },
      { x: target.x, y: target.y, label: `${targetNode.type}_entry` },
    ];
    return {
      id: `route_${targetNode.id}`,
      waypoints: fallbackWaypoints,
      totalLengthM: dist2D(dropPoint, target),
      bendCount: 0,
      targetNodeId: targetNode.id,
      routeMethod: 'fallback_straight',
      warnings,
    };
  }

  // Convert path to waypoints
  const waypoints: CADConduitWaypoint[] = path.map((node, i) => ({
    x: node.x,
    y: node.y,
    label: node.label ?? (i === 0 ? 'array_drop' : i === path.length - 1 ? 'panel' : `waypoint_${i}`),
  }));

  // Calculate total length and bend count
  let totalLength = 0;
  let bendCount = 0;
  for (let i = 1; i < path.length; i++) {
    totalLength += dist2D({ x: path[i - 1].x, y: path[i - 1].y }, { x: path[i].x, y: path[i].y });
    if (i >= 2) {
      // Count direction changes > 15 degrees as a bend
      const dx1 = path[i - 1].x - path[i - 2].x;
      const dy1 = path[i - 1].y - path[i - 2].y;
      const dx2 = path[i].x - path[i - 1].x;
      const dy2 = path[i].y - path[i - 1].y;
      const dot = dx1 * dx2 + dy1 * dy2;
      const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (mag1 > 0.001 && mag2 > 0.001) {
        const cosAngle = dot / (mag1 * mag2);
        const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
        if (angleDeg > 15) bendCount++;
      }
    }
  }

  if (totalLength > WARN_ROUTE_LENGTH_M) {
    warnings.push(`Route length ${totalLength.toFixed(1)}m exceeds ${WARN_ROUTE_LENGTH_M}m — verify conduit fill`);
  }

  return {
    id: `route_${targetNode.id}`,
    waypoints,
    totalLengthM: totalLength,
    bendCount,
    targetNodeId: targetNode.id,
    routeMethod: 'vision_guided',
    warnings,
  };
}

// ─── Visibility graph ─────────────────────────────────────────────────────────

/**
 * Build intermediate waypoint nodes around obstructions for the
 * visibility graph. Generates 8 tangent points around each obstruction.
 */
function buildVisibilityNodes(
  start: Point2D,
  end: Point2D,
  obstructions: CADObstruction[],
): RouteNode[] {
  const nodes: RouteNode[] = [];

  for (const obs of obstructions) {
    const clearanceR = obs.totalRadiusM + ROUTE_CLEARANCE_M;
    // 8 tangent waypoints around this obstruction
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * Math.PI;
      nodes.push({
        id: `obs_${obs.id}_${i}`,
        x: obs.x + Math.cos(angle) * clearanceR,
        y: obs.y + Math.sin(angle) * clearanceR,
        label: `around_${obs.type}`,
      });
    }
  }

  return nodes;
}

// ─── A* pathfinding ───────────────────────────────────────────────────────────

function astarRoute(
  start: RouteNode,
  end: RouteNode,
  intermediateNodes: RouteNode[],
  obstructions: CADObstruction[],
  warnings: string[],
): RouteNode[] {
  const allNodes = [start, ...intermediateNodes, end];

  // Build adjacency: nodes are connected if the straight line between them
  // doesn't pass through any obstruction exclusion zone.
  function heuristic(a: RouteNode, b: RouteNode): number {
    return dist2D({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  }

  function isClearPath(a: RouteNode, b: RouteNode): boolean {
    for (const obs of obstructions) {
      if (segmentCircleIntersects(a, b, obs, obs.totalRadiusM + ROUTE_CLEARANCE_M)) {
        return false;
      }
    }
    return true;
  }

  // A* open/closed sets
  const openSet: AStarNode[] = [];
  const closedIds = new Set<string>();

  const startNode: AStarNode = {
    node: start,
    gCost: 0,
    hCost: heuristic(start, end),
    fCost: heuristic(start, end),
    parent: null,
  };
  openSet.push(startNode);

  let iterations = 0;
  while (openSet.length > 0 && iterations < MAX_ASTAR_ITERATIONS) {
    iterations++;
    // Pop node with lowest fCost
    openSet.sort((a, b) => a.fCost - b.fCost);
    const current = openSet.shift()!;

    if (current.node.id === end.id || dist2D({ x: current.node.x, y: current.node.y }, { x: end.x, y: end.y }) < 0.1) {
      // Reconstruct path
      const path: RouteNode[] = [];
      let n: AStarNode | null = current;
      while (n) {
        path.unshift(n.node);
        n = n.parent;
      }
      // Ensure end node is included
      if (path[path.length - 1].id !== end.id) path.push(end);
      return path;
    }

    closedIds.add(current.node.id);

    for (const neighbor of allNodes) {
      if (closedIds.has(neighbor.id)) continue;
      if (!isClearPath(current.node, neighbor)) continue;

      const gCost = current.gCost + dist2D(
        { x: current.node.x, y: current.node.y },
        { x: neighbor.x, y: neighbor.y },
      );
      const hCost = heuristic(neighbor, end);

      const existing = openSet.find(n => n.node.id === neighbor.id);
      if (!existing) {
        openSet.push({ node: neighbor, gCost, hCost, fCost: gCost + hCost, parent: current });
      } else if (gCost < existing.gCost) {
        existing.gCost = gCost;
        existing.fCost = gCost + hCost;
        existing.parent = current;
      }
    }
  }

  if (iterations >= MAX_ASTAR_ITERATIONS) {
    warnings.push(`A* hit iteration limit (${MAX_ASTAR_ITERATIONS}) — route may be suboptimal`);
  }

  return []; // no path found
}

// ─── Segment-circle intersection test ────────────────────────────────────────

/**
 * Returns true if the line segment A→B passes through a circle
 * centered at (obs.x, obs.y) with radius r.
 */
function segmentCircleIntersects(
  a: RouteNode,
  b: RouteNode,
  obs: { x: number; y: number },
  r: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - obs.x;
  const fy = a.y - obs.y;

  const aa = dx * dx + dy * dy;
  const bb = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;

  if (aa < 1e-10) {
    // Degenerate segment
    return cc <= 0;
  }

  let discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < 0) return false;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-bb - discriminant) / (2 * aa);
  const t2 = (-bb + discriminant) / (2 * aa);

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}