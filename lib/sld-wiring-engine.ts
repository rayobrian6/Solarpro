// ============================================================
// SLD Wiring Engine — Foundation v1.0
// Phase 3: Wire path generation from anchor points
// Phase 4: Line style system
//
// ADDITIVE ONLY — does not modify any existing file.
// Safe to import alongside all existing SLD infrastructure.
//
// GUARANTEES:
//   - Never throws — all errors are logged and skipped (fail-safe)
//   - No diagonal wires — horizontal + vertical (Manhattan) routing only
//   - Left-to-right primary flow
//   - Consistent gap between parallel runs
//   - All debug events logged with standard tags
//
// WIRE PATH FORMAT:
//   Array of {x, y} waypoints defining horizontal/vertical segments.
//   Renderer draws lines between consecutive points.
//   First point = anchor on source emblem (absolute px)
//   Last point  = anchor on destination emblem (absolute px)
// ============================================================

import {
  EmblemContract,
  AnchorPoint,
  WireType,
  FlowRule,
  getEmblemContract,
  resolveAnchor,
  EMBLEM_CONTRACT_REGISTRY,
} from './sld-emblem-contracts';

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — LINE STYLE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export interface WireStyle {
  /** Wire type identifier */
  type: WireType;
  /** Stroke color (CSS color string) */
  stroke: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** SVG stroke-dasharray value, or undefined for solid */
  strokeDasharray?: string;
  /** SVG stroke-linecap */
  strokeLinecap: 'round' | 'square' | 'butt';
  /** Rendering z-index priority (higher = drawn on top) */
  zPriority: number;
  /** Human label for legend */
  label: string;
  /** Description for documentation */
  description: string;
}

const WIRE_STYLES: Record<WireType, WireStyle> = {
  DC: {
    type:            'DC',
    stroke:          '#BF360C',   // deep orange-red — DC domain color
    strokeWidth:     1.5,
    strokeDasharray: undefined,   // solid
    strokeLinecap:   'square',
    zPriority:       2,
    label:           'DC Power',
    description:     '1.5px solid orange-red — DC string conductors',
  },
  AC: {
    type:            'AC',
    stroke:          '#0D3B7A',   // dark navy blue — AC domain color
    strokeWidth:     2.0,
    strokeDasharray: undefined,   // solid
    strokeLinecap:   'square',
    zPriority:       3,
    label:           'AC Power',
    description:     '2px solid navy — AC line-voltage conductors',
  },
  GROUND: {
    type:            'GROUND',
    stroke:          '#1B5E20',   // dark green — GND domain color
    strokeWidth:     1.5,
    strokeDasharray: '4,3',       // dashed green
    strokeLinecap:   'round',
    zPriority:       1,           // lowest — drawn under power wires
    label:           'Equipment Ground',
    description:     '1.5px dashed green — EGC conductors (NEC 250)',
  },
  COM: {
    type:            'COM',
    stroke:          '#555555',   // medium gray
    strokeWidth:     1.0,
    strokeDasharray: '6,4',       // long dash
    strokeLinecap:   'round',
    zPriority:       0,
    label:           'Communications',
    description:     '1px dashed gray — monitoring, RS-485, Zigbee',
  },
};

/**
 * Get the visual style for a wire type.
 * Always returns a valid style — never throws.
 */
export function getWireStyle(type: WireType): WireStyle {
  return WIRE_STYLES[type] ?? WIRE_STYLES['AC'];
}

/**
 * Get all wire styles (for legend rendering).
 */
export function getAllWireStyles(): WireStyle[] {
  return Object.values(WIRE_STYLES);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — WIRING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Placed Component ────────────────────────────────────────────────────────
/** A component placed on the SLD canvas at an absolute pixel position */
export interface PlacedComponent {
  /** Unique instance ID for this placement (e.g. "inverter_1", "msp_1") */
  instanceId: string;
  /** Emblem ID matching EmblemContract.id and SLDSymbol.id */
  emblemId: string;
  /** Absolute top-left corner on canvas (px) */
  x: number;
  y: number;
}

// ─── Wire Path ───────────────────────────────────────────────────────────────
/** A routed wire connecting two component anchors */
export interface WirePath {
  /** Source component instance ID */
  fromInstanceId: string;
  /** Source anchor name */
  fromAnchor: string;
  /** Destination component instance ID */
  toInstanceId: string;
  /** Destination anchor name */
  toAnchor: string;
  /** Electrical type */
  type: WireType;
  /**
   * Absolute waypoints in canvas coordinates.
   * Wire is drawn as horizontal/vertical segments between consecutive points.
   * [0] = source anchor position
   * [n] = destination anchor position
   */
  path: Array<{ x: number; y: number }>;
  /** Wire style (resolved from type) */
  style: WireStyle;
  /** NEC reference if applicable */
  necReference?: string;
  /** Human label for this wire */
  label?: string;
}

// ─── Wire Connection Request ──────────────────────────────────────────────────
/** Input to the wiring engine — describes one desired connection */
export interface WireConnectionRequest {
  fromInstanceId: string;
  fromAnchor:     string;
  toInstanceId:   string;
  toAnchor:       string;
  wireType:       WireType;
  necReference?:  string;
  label?:         string;
}

// ─── Wiring Engine Result ─────────────────────────────────────────────────────
export interface WiringEngineResult {
  wires: WirePath[];
  skipped: WireSkipRecord[];
  stats: {
    requested: number;
    routed: number;
    skipped: number;
  };
}

export interface WireSkipRecord {
  fromInstanceId: string;
  fromAnchor:     string;
  toInstanceId:   string;
  toAnchor:       string;
  reason:         string;
}

// ─── Manhattan Router ────────────────────────────────────────────────────────
/**
 * Routes a wire between two absolute anchor positions using Manhattan routing
 * (horizontal + vertical segments only).
 *
 * Routing strategy:
 *   - If both anchors are on horizontal edges (left/right): route via midpoint X
 *   - If both are on vertical edges (top/bottom): route via midpoint Y
 *   - Mixed edge cases: route with one elbow
 *
 * No diagonal wires. No overlapping detection in this foundation phase
 * (overlap avoidance is a future visual polish concern).
 */
function routeManhattan(
  from: { x: number; y: number; edge: AnchorPoint['edge'] },
  to:   { x: number; y: number; edge: AnchorPoint['edge'] },
  /** Optional offset for parallel wire separation (px) */
  parallelOffset = 0,
): Array<{ x: number; y: number }> {
  const fx = from.x;
  const fy = from.y;
  const tx = to.x;
  const ty = to.y;

  // Same point — degenerate case
  if (fx === tx && fy === ty) {
    return [{ x: fx, y: fy }];
  }

  // Both exits are horizontal (left/right → left/right)
  if (
    (from.edge === 'left' || from.edge === 'right') &&
    (to.edge === 'left'   || to.edge === 'right')
  ) {
    // Standard left-to-right: go horizontal to midpoint X, then vertical, then horizontal
    const midX = Math.round((fx + tx) / 2) + parallelOffset;
    if (fy === ty) {
      // Perfectly horizontal — straight line
      return [{ x: fx, y: fy }, { x: tx, y: ty }];
    }
    return [
      { x: fx,   y: fy },
      { x: midX, y: fy },
      { x: midX, y: ty },
      { x: tx,   y: ty },
    ];
  }

  // Both exits are vertical (top/bottom → top/bottom)
  if (
    (from.edge === 'top' || from.edge === 'bottom') &&
    (to.edge === 'top'   || to.edge === 'bottom')
  ) {
    const midY = Math.round((fy + ty) / 2) + parallelOffset;
    if (fx === tx) {
      return [{ x: fx, y: fy }, { x: tx, y: ty }];
    }
    return [
      { x: fx, y: fy   },
      { x: fx, y: midY },
      { x: tx, y: midY },
      { x: tx, y: ty   },
    ];
  }

  // Mixed: one horizontal, one vertical — single elbow
  if (from.edge === 'left' || from.edge === 'right') {
    // From exits horizontally, to exits vertically
    // Go horizontal to tx, then vertical to ty
    return [
      { x: fx, y: fy },
      { x: tx, y: fy },
      { x: tx, y: ty },
    ];
  } else {
    // From exits vertically, to exits horizontally
    // Go vertical to ty, then horizontal to tx
    return [
      { x: fx, y: fy },
      { x: fx, y: ty },
      { x: tx, y: ty },
    ];
  }
}

// ─── Core Wire Connector ─────────────────────────────────────────────────────
/**
 * Connect two placed components at their named anchors.
 * Returns null (and logs) if any data is missing — FAIL SAFE.
 */
function connectComponents(
  req:        WireConnectionRequest,
  components: Map<string, PlacedComponent>,
  parallelOffset = 0,
): WirePath | null {
  // Resolve source component
  const fromComp = components.get(req.fromInstanceId);
  if (!fromComp) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] Instance "${req.fromInstanceId}" not found in placement map`
    );
    return null;
  }

  // Resolve destination component
  const toComp = components.get(req.toInstanceId);
  if (!toComp) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] Instance "${req.toInstanceId}" not found in placement map`
    );
    return null;
  }

  // Resolve source contract
  const fromContract = getEmblemContract(fromComp.emblemId);
  if (!fromContract) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] No contract for emblem "${fromComp.emblemId}" (instance: ${req.fromInstanceId})`
    );
    return null;
  }

  // Resolve destination contract
  const toContract = getEmblemContract(toComp.emblemId);
  if (!toContract) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] No contract for emblem "${toComp.emblemId}" (instance: ${req.toInstanceId})`
    );
    return null;
  }

  // Resolve source anchor absolute position
  const fromAbsPos = resolveAnchor(fromContract, req.fromAnchor, { x: fromComp.x, y: fromComp.y });
  if (!fromAbsPos) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] Anchor "${req.fromAnchor}" not found on "${fromComp.emblemId}"`
    );
    return null;
  }

  // Resolve destination anchor absolute position
  const toAbsPos = resolveAnchor(toContract, req.toAnchor, { x: toComp.x, y: toComp.y });
  if (!toAbsPos) {
    console.warn(
      `[WIRE SKIPPED — MISSING ANCHOR] Anchor "${req.toAnchor}" not found on "${toComp.emblemId}"`
    );
    return null;
  }

  // Get anchor edge directions for routing
  const fromAnchorDef = fromContract.anchors[req.fromAnchor]!;
  const toAnchorDef   = toContract.anchors[req.toAnchor]!;

  // Route the wire
  const path = routeManhattan(
    { ...fromAbsPos, edge: fromAnchorDef.edge },
    { ...toAbsPos,   edge: toAnchorDef.edge },
    parallelOffset,
  );

  const wire: WirePath = {
    fromInstanceId: req.fromInstanceId,
    fromAnchor:     req.fromAnchor,
    toInstanceId:   req.toInstanceId,
    toAnchor:       req.toAnchor,
    type:           req.wireType,
    path,
    style:          getWireStyle(req.wireType),
    necReference:   req.necReference,
    label:          req.label,
  };

  console.log(
    `[WIRE ROUTE BUILT] ${req.fromInstanceId}.${req.fromAnchor} → ${req.toInstanceId}.${req.toAnchor}` +
    ` [${req.wireType}] ${path.length} waypoints`
  );

  return wire;
}

// ─── Main Wiring Engine ───────────────────────────────────────────────────────
/**
 * Run the wiring engine over a set of placed components and connection requests.
 *
 * FAIL SAFE:
 *   - Missing components → skip + log [WIRE SKIPPED — MISSING ANCHOR]
 *   - Missing anchors    → skip + log [WIRE SKIPPED — MISSING ANCHOR]
 *   - Invalid contracts  → skip + log
 *   - Never throws
 *
 * @param placements  - Array of components placed on canvas with absolute coords
 * @param connections - Array of wire connection requests
 * @returns WiringEngineResult with routed wires, skipped records, and stats
 */
export function runWiringEngine(
  placements:  PlacedComponent[],
  connections: WireConnectionRequest[],
): WiringEngineResult {
  console.log(
    `[WIRE CONNECT] Wiring engine started — ${placements.length} components, ${connections.length} connections requested`
  );

  // Build lookup map: instanceId → PlacedComponent
  const componentMap = new Map<string, PlacedComponent>();
  for (const p of placements) {
    componentMap.set(p.instanceId, p);
    const contract = getEmblemContract(p.emblemId);
    if (contract) {
      console.log(
        `[SLD ANCHOR INIT] Registered instance "${p.instanceId}" (${p.emblemId}) at (${p.x}, ${p.y}) — ` +
        `${Object.keys(contract.anchors).length} anchors`
      );
    } else {
      console.warn(
        `[SLD ANCHOR INIT] WARNING: No contract found for emblem "${p.emblemId}" (instance: ${p.instanceId})`
      );
    }
  }

  const wires:   WirePath[]      = [];
  const skipped: WireSkipRecord[] = [];

  // Route each connection request
  // Track offset for parallel wires on the same pair of anchors
  const pairCounts = new Map<string, number>();

  for (const req of connections) {
    const pairKey = `${req.fromInstanceId}:${req.fromAnchor}→${req.toInstanceId}:${req.toAnchor}`;
    const parallelIdx = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, parallelIdx + 1);

    // Stagger parallel wires by 8px to avoid full overlap
    const parallelOffset = parallelIdx * 8;

    const wire = connectComponents(req, componentMap, parallelOffset);

    if (wire) {
      wires.push(wire);
    } else {
      skipped.push({
        fromInstanceId: req.fromInstanceId,
        fromAnchor:     req.fromAnchor,
        toInstanceId:   req.toInstanceId,
        toAnchor:       req.toAnchor,
        reason:         'Missing component, contract, or anchor — see [WIRE SKIPPED] logs',
      });
    }
  }

  const result: WiringEngineResult = {
    wires,
    skipped,
    stats: {
      requested: connections.length,
      routed:    wires.length,
      skipped:   skipped.length,
    },
  };

  console.log(
    `[WIRE CONNECT] Wiring engine complete — ` +
    `${result.stats.routed}/${result.stats.requested} routed, ` +
    `${result.stats.skipped} skipped`
  );

  return result;
}

// ─── Auto-Wire from Flow Rules ────────────────────────────────────────────────
/**
 * Build connection requests automatically from FlowRules + placed components.
 *
 * Matches flow rules against placed components by emblemId.
 * For each matching pair, creates a WireConnectionRequest.
 *
 * If multiple instances of the same emblem exist (e.g., two PV arrays),
 * connects each instance of the source to each instance of the destination.
 * Wiring engine's fail-safe logging handles any mismatches.
 */
export function buildConnectionsFromFlowRules(
  placements: PlacedComponent[],
  flowRules:  FlowRule[],
): WireConnectionRequest[] {
  const requests: WireConnectionRequest[] = [];

  // Group placements by emblemId
  const byEmblem = new Map<string, PlacedComponent[]>();
  for (const p of placements) {
    const list = byEmblem.get(p.emblemId) ?? [];
    list.push(p);
    byEmblem.set(p.emblemId, list);
  }

  for (const rule of flowRules) {
    const fromList = byEmblem.get(rule.fromEmblemId) ?? [];
    const toList   = byEmblem.get(rule.toEmblemId)   ?? [];

    if (fromList.length === 0 || toList.length === 0) {
      // Silent skip — components not present in this diagram
      continue;
    }

    // Connect each source instance to matching destination instance
    // (by index for arrays, or all-to-all for single instances)
    const maxPairs = Math.max(fromList.length, toList.length);
    for (let i = 0; i < maxPairs; i++) {
      const fromComp = fromList[Math.min(i, fromList.length - 1)];
      const toComp   = toList[Math.min(i, toList.length - 1)];

      requests.push({
        fromInstanceId: fromComp.instanceId,
        fromAnchor:     rule.fromAnchor,
        toInstanceId:   toComp.instanceId,
        toAnchor:       rule.toAnchor,
        wireType:       rule.wireType,
        necReference:   rule.necReference,
        label:          rule.label,
      });
    }
  }

  return requests;
}

// ─── SVG Wire Renderer ────────────────────────────────────────────────────────
/**
 * Render a single WirePath as SVG polyline markup.
 * Returns empty string on invalid path — fail-safe.
 */
export function renderWireAsSVG(wire: WirePath): string {
  if (!wire.path || wire.path.length < 2) {
    console.warn(`[WIRE SKIPPED — MISSING ANCHOR] Wire ${wire.fromInstanceId}→${wire.toInstanceId} has < 2 waypoints`);
    return '';
  }

  const points = wire.path.map(p => `${p.x},${p.y}`).join(' ');
  const { stroke, strokeWidth, strokeDasharray, strokeLinecap } = wire.style;

  let svg = `<polyline` +
    ` points="${points}"` +
    ` fill="none"` +
    ` stroke="${stroke}"` +
    ` stroke-width="${strokeWidth}"` +
    ` stroke-linecap="${strokeLinecap}"`;

  if (strokeDasharray) {
    svg += ` stroke-dasharray="${strokeDasharray}"`;
  }

  svg += `/>`;
  return svg;
}

/**
 * Render all wires in a WiringEngineResult as SVG markup,
 * sorted by z-priority (ground first, AC on top).
 * Returns a string of SVG elements ready for embedding in an <svg> root.
 */
export function renderAllWiresAsSVG(result: WiringEngineResult): string {
  const sorted = [...result.wires].sort(
    (a, b) => a.style.zPriority - b.style.zPriority
  );
  return sorted.map(renderWireAsSVG).join('\n');
}

// ─── Auto-Layout Helper ───────────────────────────────────────────────────────
/**
 * Simple left-to-right layout engine.
 * Given an ordered list of emblem IDs, places them in sequence
 * with their preferred spacing, starting at (startX, startY).
 *
 * This is the FOUNDATION layout — not final. Visual polish is a future phase.
 *
 * Returns an array of PlacedComponents with instanceIds auto-assigned.
 */
export function autoLayoutLeftToRight(
  emblemIds: string[],
  startX = 40,
  startY = 200,
): PlacedComponent[] {
  const placements: PlacedComponent[] = [];
  let curX = startX;

  for (let i = 0; i < emblemIds.length; i++) {
    const emblemId = emblemIds[i];
    const contract = getEmblemContract(emblemId);

    if (!contract) {
      console.warn(`[SLD ANCHOR INIT] autoLayoutLeftToRight: No contract for "${emblemId}", skipping`);
      continue;
    }

    placements.push({
      instanceId: `${emblemId}_${i + 1}`,
      emblemId,
      x: curX,
      y: startY - Math.round(contract.height / 2), // vertically center on bus line
    });

    curX += contract.width + contract.layoutRules.preferredSpacingX;
  }

  return placements;
}

// ─── Full System Wire Builder ─────────────────────────────────────────────────
/**
 * High-level API: Given a topology (ordered list of emblem IDs) and
 * optional explicit connections, returns a complete WiringEngineResult.
 *
 * Usage:
 *   const result = buildFullSystemWiring(
 *     ['pv-array', 'dc-disconnect', 'inverter', 'ac-disconnect', 'msp', 'utility-meter'],
 *     ALL_FLOW_RULES,
 *     { startX: 40, startY: 300 }
 *   );
 *
 * FAIL SAFE: never throws. Returns empty result on any critical failure.
 */
export function buildFullSystemWiring(
  topologySequence: string[],
  flowRules:        FlowRule[],
  opts: {
    startX?: number;
    startY?: number;
    extraConnections?: WireConnectionRequest[];
  } = {}
): { placements: PlacedComponent[]; result: WiringEngineResult } {
  try {
    const placements = autoLayoutLeftToRight(
      topologySequence,
      opts.startX ?? 40,
      opts.startY ?? 300,
    );

    const autoConnections = buildConnectionsFromFlowRules(placements, flowRules);
    const allConnections  = [...autoConnections, ...(opts.extraConnections ?? [])];

    const result = runWiringEngine(placements, allConnections);

    return { placements, result };
  } catch (err) {
    console.error('[WIRE CONNECT] CRITICAL: buildFullSystemWiring failed unexpectedly:', err);
    return {
      placements: [],
      result: {
        wires:   [],
        skipped: [],
        stats:   { requested: 0, routed: 0, skipped: 0 },
      },
    };
  }
}

// ─── Topology Sequence Presets ────────────────────────────────────────────────
/**
 * Standard topology sequences for common SLD configurations.
 * Used by buildFullSystemWiring().
 */
export const TOPOLOGY_SEQUENCES = {
  /** Standard string inverter system */
  STRING_INVERTER: [
    'pv-array',
    'dc-disconnect',
    'inverter',
    'ac-disconnect',
    'msp',
    'utility-meter',
  ],
  /** Microinverter system with AC combiner */
  MICROINVERTER: [
    'pv-array',
    'junction-box',
    'ac-combiner',
    'ac-disconnect',
    'msp',
    'utility-meter',
  ],
  /** String inverter + DC-coupled battery */
  DC_COUPLED_BATTERY: [
    'pv-array',
    'dc-disconnect',
    'inverter',
    'battery-dc',
    'ac-disconnect',
    'msp',
    'utility-meter',
  ],
  /** String inverter + AC-coupled battery */
  AC_COUPLED_BATTERY: [
    'pv-array',
    'dc-disconnect',
    'inverter',
    'ac-disconnect',
    'msp',
    'battery-ac',
    'utility-meter',
  ],
  /** Generator + ATS backup */
  WITH_GENERATOR: [
    'pv-array',
    'dc-disconnect',
    'inverter',
    'ac-disconnect',
    'msp',
    'utility-meter',
    'generator',
    'ats',
  ],
} as const;