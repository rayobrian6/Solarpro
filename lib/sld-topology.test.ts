// ============================================================
// SLD Topology Unit Tests
// Ensures the NON-NEGOTIABLE rule is enforced:
//   Every device-to-device connection MUST have a RUN_SEGMENT
//   node between them. No direct device-to-device edges allowed.
// ============================================================

import {
  buildSLDTopologyGraph,
  SLDGraphInput,
  SLDTopologyGraph,
  SLDNode,
  SLDEdge,
} from './topology-engine';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeTestInput(overrides: Partial<SLDGraphInput> = {}): SLDGraphInput {
  return {
    topology: 'MICROINVERTER',
    totalModules: 20,
    totalStrings: 4,
    panelModel: 'REC400AA',
    panelWatts: 400,
    panelVoc: 37.8,
    panelIsc: 13.5,
    inverterManufacturer: 'Enphase',
    inverterModel: 'IQ8+',
    acOutputKw: 8.0,
    acOutputAmps: 33.3,
    mainPanelAmps: 200,
    backfeedAmps: 40,
    dcWireGauge: '#10 AWG',
    dcConduitType: 'EMT',
    acWireGauge: '#10 AWG',
    acConduitType: 'EMT',
    acWireLength: 50,
    dcOCPD: 20,
    acOCPD: 40,
    ...overrides,
  };
}

function assertNoDirectDeviceEdges(graph: SLDTopologyGraph, label: string): void {
  // INVARIANT: no edge may connect two non-RUN_SEGMENT nodes directly
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const violations: string[] = [];

  for (const edge of graph.edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) {
      violations.push(`Edge references unknown node: ${edge.from} → ${edge.to}`);
      continue;
    }

    if (fromNode.type !== 'RUN_SEGMENT' && toNode.type !== 'RUN_SEGMENT') {
      violations.push(
        `DIRECT DEVICE EDGE: ${edge.from} (${fromNode.type}) → ${edge.to} (${toNode.type})`
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `[${label}] NON-NEGOTIABLE RULE VIOLATED — Direct device-to-device edges found:\n` +
      violations.map(v => `  • ${v}`).join('\n')
    );
  }

  console.log(`  ✓ [${label}] No direct device-to-device edges — all connections via RUN_SEGMENT`);
}

function assertAllRunSegmentsHaveTwoEdges(graph: SLDTopologyGraph, label: string): void {
  // Every RUN_SEGMENT must have exactly 2 edges (one from, one to)
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const edgeCount = new Map<string, number>();

  for (const edge of graph.edges) {
    edgeCount.set(edge.from, (edgeCount.get(edge.from) ?? 0) + 1);
    edgeCount.set(edge.to, (edgeCount.get(edge.to) ?? 0) + 1);
  }

  const violations: string[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'RUN_SEGMENT') continue;
    const count = edgeCount.get(node.id) ?? 0;
    if (count !== 2) {
      violations.push(`RUN_SEGMENT '${node.id}' has ${count} edges (expected 2)`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `[${label}] RUN_SEGMENT connectivity violations:\n` +
      violations.map(v => `  • ${v}`).join('\n')
    );
  }

  console.log(`  ✓ [${label}] All RUN_SEGMENT nodes have exactly 2 edges`);
}

function assertTopologyChain(graph: SLDTopologyGraph, label: string): void {
  // Verify the graph forms a valid chain: PV_ARRAY at top, UTILITY_GRID at bottom
  // with alternating device/run_segment nodes
  const sortedNodes = [...graph.nodes].sort((a, b) => a.layoutOrder - b.layoutOrder);

  // Check first node is a device (PV_ARRAY)
  const firstNode = sortedNodes[0];
  if (firstNode?.type === 'RUN_SEGMENT') {
    throw new Error(`[${label}] First node should be a device, got RUN_SEGMENT: ${firstNode.id}`);
  }

  // Check last node is a device (UTILITY_GRID)
  const lastNode = sortedNodes[sortedNodes.length - 1];
  if (lastNode?.type === 'RUN_SEGMENT') {
    throw new Error(`[${label}] Last node should be a device, got RUN_SEGMENT: ${lastNode.id}`);
  }

  // Check alternating pattern: device, run, device, run, ...
  for (let i = 0; i < sortedNodes.length - 1; i++) {
    const curr = sortedNodes[i];
    const next = sortedNodes[i + 1];
    const currIsDevice = curr.type !== 'RUN_SEGMENT';
    const nextIsDevice = next.type !== 'RUN_SEGMENT';

    if (currIsDevice === nextIsDevice) {
      throw new Error(
        `[${label}] Non-alternating topology at positions ${i}/${i+1}: ` +
        `${curr.id} (${curr.type}) → ${next.id} (${next.type}). ` +
        `Expected device-run-device-run alternation.`
      );
    }
  }

  console.log(`  ✓ [${label}] Topology chain alternates device/run_segment correctly`);
}

function assertGraphValidation(graph: SLDTopologyGraph, label: string): void {
  if (graph.hasDirectDeviceEdges) {
    throw new Error(
      `[${label}] Graph self-reports hasDirectDeviceEdges=true. Errors:\n` +
      graph.validationErrors.map(e => `  • ${e}`).join('\n')
    );
  }
  console.log(`  ✓ [${label}] Graph self-validation passed (hasDirectDeviceEdges=false)`);
}

function assertRunSegmentsHaveData(graph: SLDTopologyGraph, label: string): void {
  const violations: string[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'RUN_SEGMENT') continue;
    if (!node.runSegment) {
      violations.push(`RUN_SEGMENT '${node.id}' has no runSegment data`);
      continue;
    }
    const seg = node.runSegment;
    if (!seg.conductorGauge) violations.push(`'${node.id}' missing conductorGauge`);
    if (!seg.conduitType) violations.push(`'${node.id}' missing conduitType`);
    if (!seg.conductorInsulation) violations.push(`'${node.id}' missing conductorInsulation`);
    if (!seg.color) violations.push(`'${node.id}' missing color`);
    if (seg.conductorCount < 1) violations.push(`'${node.id}' conductorCount < 1`);
  }

  if (violations.length > 0) {
    throw new Error(
      `[${label}] RUN_SEGMENT data violations:\n` +
      violations.map(v => `  • ${v}`).join('\n')
    );
  }
  console.log(`  ✓ [${label}] All RUN_SEGMENT nodes have required data fields`);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${(e as Error).message}`);
    failed++;
  }
}

console.log('\n=== SLD Topology Unit Tests ===\n');

// ─── Test 1: Microinverter topology ───────────────────────────────────────────
console.log('Test Group 1: Microinverter Topology');
{
  const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'MICROINVERTER' }));

  runTest('Microinverter: no direct device-to-device edges', () => {
    assertNoDirectDeviceEdges(graph, 'MICROINVERTER');
  });

  runTest('Microinverter: all RUN_SEGMENTs have 2 edges', () => {
    assertAllRunSegmentsHaveTwoEdges(graph, 'MICROINVERTER');
  });

  runTest('Microinverter: topology chain alternates device/run', () => {
    assertTopologyChain(graph, 'MICROINVERTER');
  });

  runTest('Microinverter: graph self-validation passes', () => {
    assertGraphValidation(graph, 'MICROINVERTER');
  });

  runTest('Microinverter: all RUN_SEGMENTs have required data', () => {
    assertRunSegmentsHaveData(graph, 'MICROINVERTER');
  });

  runTest('Microinverter: has ROOF_RUN segment', () => {
    const roofRun = graph.nodes.find(n => n.id === 'ROOF_RUN');
    if (!roofRun) throw new Error('ROOF_RUN node not found');
    if (roofRun.runSegment?.color !== 'dc') throw new Error('ROOF_RUN should be DC (color=dc)');
    console.log('  ✓ [MICROINVERTER] ROOF_RUN segment exists with DC color');
  });

  runTest('Microinverter: has BRANCH_RUN segment', () => {
    const branchRun = graph.nodes.find(n => n.id === 'BRANCH_RUN');
    if (!branchRun) throw new Error('BRANCH_RUN node not found');
    if (branchRun.runSegment?.color !== 'ac') throw new Error('BRANCH_RUN should be AC (color=ac)');
    console.log('  ✓ [MICROINVERTER] BRANCH_RUN segment exists with AC color');
  });

  runTest('Microinverter: has COMBINER_TO_DISCO_RUN', () => {
    const seg = graph.nodes.find(n => n.id === 'COMBINER_TO_DISCO_RUN');
    if (!seg) throw new Error('COMBINER_TO_DISCO_RUN node not found');
    console.log('  ✓ [MICROINVERTER] COMBINER_TO_DISCO_RUN segment exists');
  });

  runTest('Microinverter: has METER_TO_MSP_RUN', () => {
    const seg = graph.nodes.find(n => n.id === 'METER_TO_MSP_RUN');
    if (!seg) throw new Error('METER_TO_MSP_RUN node not found');
    console.log('  ✓ [MICROINVERTER] METER_TO_MSP_RUN segment exists');
  });

  runTest('Microinverter: PV_ARRAY is first node (layoutOrder=0)', () => {
    const pvArray = graph.nodes.find(n => n.id === 'PV_ARRAY');
    if (!pvArray) throw new Error('PV_ARRAY not found');
    if (pvArray.layoutOrder !== 0) throw new Error(`PV_ARRAY layoutOrder=${pvArray.layoutOrder}, expected 0`);
    console.log('  ✓ [MICROINVERTER] PV_ARRAY has layoutOrder=0 (top of diagram)');
  });

  runTest('Microinverter: UTILITY_GRID is last node', () => {
    const sorted = [...graph.nodes].sort((a, b) => a.layoutOrder - b.layoutOrder);
    const last = sorted[sorted.length - 1];
    if (last.id !== 'UTILITY_GRID') throw new Error(`Last node is ${last.id}, expected UTILITY_GRID`);
    console.log('  ✓ [MICROINVERTER] UTILITY_GRID is last node (bottom of diagram)');
  });
}

// ─── Test 2: String Inverter topology ─────────────────────────────────────────
console.log('\nTest Group 2: String Inverter Topology');
{
  const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'STRING_INVERTER' }));

  runTest('String Inverter: no direct device-to-device edges', () => {
    assertNoDirectDeviceEdges(graph, 'STRING_INVERTER');
  });

  runTest('String Inverter: all RUN_SEGMENTs have 2 edges', () => {
    assertAllRunSegmentsHaveTwoEdges(graph, 'STRING_INVERTER');
  });

  runTest('String Inverter: topology chain alternates device/run', () => {
    assertTopologyChain(graph, 'STRING_INVERTER');
  });

  runTest('String Inverter: graph self-validation passes', () => {
    assertGraphValidation(graph, 'STRING_INVERTER');
  });

  runTest('String Inverter: has DC_STRING_RUN (DC color)', () => {
    const seg = graph.nodes.find(n => n.id === 'DC_STRING_RUN');
    if (!seg) throw new Error('DC_STRING_RUN not found');
    if (seg.runSegment?.color !== 'dc') throw new Error('DC_STRING_RUN should be DC');
    console.log('  ✓ [STRING_INVERTER] DC_STRING_RUN exists with DC color');
  });

  runTest('String Inverter: has INV_TO_DISCO_RUN (AC color)', () => {
    const seg = graph.nodes.find(n => n.id === 'INV_TO_DISCO_RUN');
    if (!seg) throw new Error('INV_TO_DISCO_RUN not found');
    if (seg.runSegment?.color !== 'ac') throw new Error('INV_TO_DISCO_RUN should be AC');
    console.log('  ✓ [STRING_INVERTER] INV_TO_DISCO_RUN exists with AC color');
  });

  runTest('String Inverter: DC_DISCONNECT exists', () => {
    const node = graph.nodes.find(n => n.id === 'DC_DISCONNECT');
    if (!node) throw new Error('DC_DISCONNECT not found');
    console.log('  ✓ [STRING_INVERTER] DC_DISCONNECT device node exists');
  });
}

// ─── Test 3: Optimizer topology ───────────────────────────────────────────────
console.log('\nTest Group 3: Optimizer Topology');
{
  const graph = buildSLDTopologyGraph(makeTestInput({
    topology: 'STRING_WITH_OPTIMIZER',
    optimizerManufacturer: 'SolarEdge',
    optimizerModel: 'P401',
  }));

  runTest('Optimizer: no direct device-to-device edges', () => {
    assertNoDirectDeviceEdges(graph, 'STRING_WITH_OPTIMIZER');
  });

  runTest('Optimizer: all RUN_SEGMENTs have 2 edges', () => {
    assertAllRunSegmentsHaveTwoEdges(graph, 'STRING_WITH_OPTIMIZER');
  });

  runTest('Optimizer: graph self-validation passes', () => {
    assertGraphValidation(graph, 'STRING_WITH_OPTIMIZER');
  });
}

// ─── Test 4: Edge invariant enforcement ───────────────────────────────────────
console.log('\nTest Group 4: Edge Invariant Enforcement');
{
  runTest('Manually injected direct device edge is detected', () => {
    const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'MICROINVERTER' }));

    // Inject a direct device-to-device edge (simulating a bug)
    const badEdge: SLDEdge = { from: 'PV_ARRAY', to: 'MICROINVERTERS' };
    graph.edges.push(badEdge);

    // Re-run validation
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    let foundViolation = false;
    for (const edge of graph.edges) {
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (fromNode && toNode &&
          fromNode.type !== 'RUN_SEGMENT' && toNode.type !== 'RUN_SEGMENT') {
        foundViolation = true;
        break;
      }
    }

    if (!foundViolation) {
      throw new Error('Expected violation to be detected but it was not');
    }
    console.log('  ✓ [INVARIANT] Direct device-to-device edge correctly detected as violation');
  });

  runTest('All topologies produce valid graphs', () => {
    const topologies: Array<SLDGraphInput['topology']> = [
      'MICROINVERTER',
      'STRING_INVERTER',
      'STRING_WITH_OPTIMIZER',
    ];

    for (const topology of topologies) {
      const graph = buildSLDTopologyGraph(makeTestInput({ topology }));
      if (graph.hasDirectDeviceEdges) {
        throw new Error(`Topology ${topology} has direct device edges: ${graph.validationErrors[0]}`);
      }
    }
    console.log('  ✓ [INVARIANT] All 3 topologies produce valid graphs with no direct device edges');
  });
}

// ─── Test 5: Node count validation ────────────────────────────────────────────
console.log('\nTest Group 5: Node Count Validation');
{
  runTest('Microinverter graph has correct node count', () => {
    const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'MICROINVERTER' }));
    // Expected: PV_ARRAY, ROOF_RUN, MICROINVERTERS, BRANCH_RUN, AC_COMBINER,
    //           COMBINER_TO_DISCO_RUN, AC_DISCONNECT, DISCO_TO_METER_RUN,
    //           PRODUCTION_METER, METER_TO_MSP_RUN, MAIN_SERVICE_PANEL,
    //           MSP_TO_UTILITY_RUN, UTILITY_GRID = 13 nodes
    const expectedCount = 13;
    if (graph.nodes.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} nodes, got ${graph.nodes.length}`);
    }
    console.log(`  ✓ [MICROINVERTER] Correct node count: ${graph.nodes.length}`);
  });

  runTest('Microinverter graph has correct edge count', () => {
    const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'MICROINVERTER' }));
    // 13 nodes in a chain = 12 edges
    const expectedEdges = 12;
    if (graph.edges.length !== expectedEdges) {
      throw new Error(`Expected ${expectedEdges} edges, got ${graph.edges.length}`);
    }
    console.log(`  ✓ [MICROINVERTER] Correct edge count: ${graph.edges.length}`);
  });

  runTest('Microinverter: exactly 6 RUN_SEGMENT nodes', () => {
    const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'MICROINVERTER' }));
    const runNodes = graph.nodes.filter(n => n.type === 'RUN_SEGMENT');
    // ROOF_RUN, BRANCH_RUN, COMBINER_TO_DISCO_RUN, DISCO_TO_METER_RUN,
    // METER_TO_MSP_RUN, MSP_TO_UTILITY_RUN = 6
    if (runNodes.length !== 6) {
      throw new Error(`Expected 6 RUN_SEGMENT nodes, got ${runNodes.length}: ${runNodes.map(n => n.id).join(', ')}`);
    }
    console.log(`  ✓ [MICROINVERTER] Exactly 6 RUN_SEGMENT nodes`);
  });

  runTest('String Inverter: exactly 6 RUN_SEGMENT nodes', () => {
    const graph = buildSLDTopologyGraph(makeTestInput({ topology: 'STRING_INVERTER' }));
    const runNodes = graph.nodes.filter(n => n.type === 'RUN_SEGMENT');
    // DC_STRING_RUN, DC_DISCO_TO_INV_RUN, INV_TO_DISCO_RUN, DISCO_TO_METER_RUN,
    // METER_TO_MSP_RUN, MSP_TO_UTILITY_RUN = 6
    if (runNodes.length !== 6) {
      throw new Error(`Expected 6 RUN_SEGMENT nodes, got ${runNodes.length}: ${runNodes.map(n => n.id).join(', ')}`);
    }
    console.log(`  ✓ [STRING_INVERTER] Exactly 6 RUN_SEGMENT nodes`);
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  console.error(`\n✗ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\n✓ All ${passed} tests PASSED`);
  process.exit(0);
}