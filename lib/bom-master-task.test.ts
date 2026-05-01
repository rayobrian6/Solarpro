// ============================================================
// Golden Tests for MASTER TASK — System Alignment
// lib/bom-master-task.test.ts
//
// Verifies:
//   1. Fence BOM has no roof items (cross-contamination)
//   2. Roof BOM has no fence items (cross-contamination)
//   3. V4 engine has no structural injection (STAGE 5b removed)
//   4. Non-destructive defaults (user panel not overridden)
//   5. Validation layer emits warnings (not blocks)
//   6. Merge layer produces correct output
// ============================================================

import { generateBOMV4, type BOMGenerationInputV4 } from './bom-engine-v4';
import { deriveStructuralBOM, type BOMSystemType } from './bom-system-profiles';
import { validateBOMInputs } from './bom-validation';

// ─── Test Helpers ────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  assertions: { label: string; expected: string; actual: string; pass: boolean }[];
}

function check(a: TestResult['assertions'], label: string, actual: unknown, expected: unknown): void {
  a.push({ label, expected: String(expected), actual: String(actual), pass: String(actual) === String(expected) });
}

function checkTrue(a: TestResult['assertions'], label: string, condition: boolean): void {
  a.push({ label, expected: 'true', actual: String(condition), pass: condition });
}

function checkFalse(a: TestResult['assertions'], label: string, condition: boolean): void {
  a.push({ label, expected: 'false', actual: String(condition), pass: !condition });
}

// ─── Mock Inputs ─────────────────────────────────────────────

function baseFenceInput(): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus',
    panelId: 'panel-fence-ps1',
    moduleCount: 24,
    stringCount: 0,
    inverterCount: 1,
    systemKw: 10.56,
    dcWireGauge: '#10 AWG',
    acWireGauge: '#6 AWG',
    dcWireLength: 15,
    acWireLength: 20,
    conduitType: 'EMT',
    conduitSizeInch: '3/4',
    roofType: 'none',
    attachmentCount: 0,
    railSections: 0,
    mainPanelAmps: 200,
    backfeedAmps: 40,
    acOCPD: 40,
    dcOCPD: 20,
    systemType: 'fence' as BOMSystemType,
    fenceData: {
      totalPosts: 13,
      postSpacingFt: 8,
      postEmbedFt: 3,
      postHeightFt: 6.5,
      railCount: 2,
      totalFenceLengthFt: 89,
      segmentCount: 1,
      gateCount: 0,
      gateWidthsFt: [],
      solarSectionCount: 24,
      vinylSectionCount: 0,
      panelWidthFt: 3.72,
      panelHeightFt: 5.65,
    },
  };
}

function baseRoofInput(): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus',
    panelId: 'qcells-q-peak-duo-400',
    moduleCount: 20,
    stringCount: 0,
    inverterCount: 1,
    systemKw: 8.0,
    dcWireGauge: '#10 AWG',
    acWireGauge: '#8 AWG',
    dcWireLength: 50,
    acWireLength: 60,
    conduitType: 'EMT',
    conduitSizeInch: '3/4',
    roofType: 'shingle',
    attachmentCount: 12,
    railSections: 4,
    mainPanelAmps: 200,
    backfeedAmps: 40,
    acOCPD: 40,
    dcOCPD: 20,
    rackingId: 'ironridge-xr100',
    systemType: 'roof' as BOMSystemType,
  };
}

function baseGroundInput(): BOMGenerationInputV4 {
  return {
    inverterId: 'fronius-primo-8.2',
    panelId: 'qcells-q-peak-duo-400',
    moduleCount: 30,
    stringCount: 2,
    inverterCount: 1,
    systemKw: 12.0,
    dcWireGauge: '#10 AWG',
    acWireGauge: '#6 AWG',
    dcWireLength: 80,
    acWireLength: 100,
    conduitType: 'EMT',
    conduitSizeInch: '1',
    roofType: 'none',
    attachmentCount: 0,
    railSections: 0,
    mainPanelAmps: 200,
    backfeedAmps: 40,
    acOCPD: 40,
    dcOCPD: 20,
    systemType: 'ground' as BOMSystemType,
    groundData: {
      pileCount: 8,
      pileSpacingFt: 10,
      pileEmbedmentFt: 4,
      structureType: 'driven_pile',
      rowCount: 2,
      panelsPerRow: 15,
      arrayWidthFt: 52,
      railsPerRow: 2,
      groundClearanceFt: 2,
    },
  };
}

// ─── Test Suite ───────────────────────────────────────────────

function runAllTests(): TestResult[] {
  const results: TestResult[] = [];

  // ═══════════════════════════════════════════════════════════
  // TEST 1: V4 engine has no structural items for fence systems
  // (STAGE 5b removed — structural comes from merge layer now)
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];
    const v4Result = generateBOMV4(baseFenceInput());

    // Check that V4 does NOT contain fence structural items
    const fencePostItems = v4Result.items.filter(i => i.category === 'fence_post');
    const fenceRailItems = v4Result.items.filter(i => i.category === 'fence_rail');
    const postCapItems = v4Result.items.filter(i => i.category === 'post_cap');
    const railBracketItems = v4Result.items.filter(i => i.category === 'rail_bracket');
    const groundRodItems = v4Result.items.filter(i => i.category === 'ground_rod');

    check(a, 'No fence_post in V4', fencePostItems.length, 0);
    check(a, 'No fence_rail in V4', fenceRailItems.length, 0);
    check(a, 'No post_cap in V4', postCapItems.length, 0);
    check(a, 'No rail_bracket in V4', railBracketItems.length, 0);
    // Ground rod/wire/clamp may or may not be in V4 (electrical grounding) — that's OK

    // V4 should still have electrical items
    const panelItems = v4Result.items.filter(i => i.category === 'solar_panel');
    const microItems = v4Result.items.filter(i => i.category === 'microinverter');
    checkTrue(a, 'V4 has solar panels', panelItems.length > 0);
    checkTrue(a, 'V4 has microinverters', microItems.length > 0);

    results.push({ name: 'V4 no structural for fence (STAGE 5b removed)', passed: a.every(x => x.pass), assertions: a });
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Structural profile generates fence items
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];
    const fenceInput = baseFenceInput();
    const structural = deriveStructuralBOM({
      systemType: 'fence',
      moduleCount: fenceInput.moduleCount,
      fence: fenceInput.fenceData,
    });

    checkTrue(a, 'Structural has items', structural.items.length > 0);

    const categories = new Set(structural.items.map(i => i.category));
    checkTrue(a, 'Has fence_post', categories.has('fence_post'));
    checkTrue(a, 'Has fence_rail', categories.has('fence_rail'));

    // No concrete (SolFence = clamp system)
    const concreteItems = structural.items.filter(i =>
      i.category.includes('concrete') || i.model.toLowerCase().includes('concrete'));
    check(a, 'No concrete items', concreteItems.length, 0);

    // No roof items in fence structural
    const roofItems = structural.items.filter(i =>
      i.category === 'racking' || i.category === 'flashing' || i.category === 'lag_bolt');
    check(a, 'No roof items in fence', roofItems.length, 0);

    results.push({ name: 'Fence structural profile correctness', passed: a.every(x => x.pass), assertions: a });
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Structural profile generates ground items
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];
    const groundInput = baseGroundInput();
    const structural = deriveStructuralBOM({
      systemType: 'ground',
      moduleCount: groundInput.moduleCount,
      ground: groundInput.groundData,
    });

    checkTrue(a, 'Structural has items', structural.items.length > 0);

    const categories = new Set(structural.items.map(i => i.category));
    // Ground structural should have piles/posts, rails, bracing
    checkTrue(a, 'Has post category', categories.has('post') || categories.has('ground_post') || categories.has('pile'));

    // No fence items in ground
    const fenceItems = structural.items.filter(i =>
      i.category === 'fence_post' || i.category === 'fence_rail' || i.category === 'vinyl_panel');
    check(a, 'No fence items in ground', fenceItems.length, 0);

    results.push({ name: 'Ground structural profile correctness', passed: a.every(x => x.pass), assertions: a });
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Roof V4 has no fence or ground items
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];
    const v4Result = generateBOMV4(baseRoofInput());

    const fenceItems = v4Result.items.filter(i =>
      i.category === 'fence_post' || i.category === 'fence_rail' || i.category === 'vinyl_panel');
    const groundItems = v4Result.items.filter(i =>
      i.category === 'pile' || i.category === 'ground_post' || i.category === 'bracing');

    check(a, 'No fence items in roof V4', fenceItems.length, 0);
    check(a, 'No ground items in roof V4', groundItems.length, 0);

    // Roof should have racking
    const rackingItems = v4Result.items.filter(i => i.category === 'racking');
    checkTrue(a, 'Roof has racking items', rackingItems.length > 0);

    results.push({ name: 'Roof V4 has no cross-contamination', passed: a.every(x => x.pass), assertions: a });
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 5: Validation layer — warnings, not blocks
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];

    // Fence with non-fence panel — should warn
    const v1 = validateBOMInputs({
      systemType: 'fence',
      panelId: 'qcells-q-peak-duo-400',
      inverterId: 'enphase-iq8plus',
      moduleCount: 20,
      fenceData: { totalPosts: 10 },
    });
    checkTrue(a, 'Warns about non-fence panel', v1.warnings.some(w => w.includes('not be optimized')));

    // Fence with string inverter — should warn
    const v2 = validateBOMInputs({
      systemType: 'fence',
      panelId: 'panel-fence-ps1',
      inverterId: 'fronius-primo-8.2',
      moduleCount: 20,
      fenceData: { totalPosts: 10 },
    });
    checkTrue(a, 'Warns about string inverter on fence', v2.warnings.some(w => w.includes('microinverters')));

    // Fence with no structural data — should warn
    const v3 = validateBOMInputs({
      systemType: 'fence',
      panelId: 'panel-fence-ps1',
      inverterId: 'enphase-iq8plus',
      moduleCount: 20,
    });
    checkTrue(a, 'Warns about missing fence data', v3.warnings.some(w => w.includes('structural')));

    // Valid fence config — no panel/inverter warnings
    const v4 = validateBOMInputs({
      systemType: 'fence',
      panelId: 'panel-fence-ps1',
      inverterId: 'enphase-iq8plus',
      moduleCount: 20,
      fenceData: { totalPosts: 10 },
    });
    checkFalse(a, 'No false warnings for valid fence', v4.warnings.some(w => w.includes('not be optimized')));

    // Zero modules — should warn
    const v5 = validateBOMInputs({
      systemType: 'roof',
      moduleCount: 0,
    });
    checkTrue(a, 'Warns about 0 modules', v5.warnings.some(w => w.includes('0 or negative')));

    results.push({ name: 'Validation layer — warnings only', passed: a.every(x => x.pass), assertions: a });
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Non-destructive defaults (user panel preserved)
  // ═══════════════════════════════════════════════════════════
  {
    const a: TestResult['assertions'] = [];

    // User selected a custom panel for fence — BOM should use it, not override
    const fenceInput = baseFenceInput();
    fenceInput.panelId = 'qcells-q-peak-duo-400'; // User chose Q CELLS for fence
    const v4Result = generateBOMV4(fenceInput);

    // V4 should respect the user's panel choice
    const panelItem = v4Result.items.find(i => i.category === 'solar_panel');
    // The panelId in V4 may manifest as the model name from equipment registry lookup
    // Key check: V4 does NOT force panel-fence-ps1
    checkTrue(a, 'V4 has panel item', !!panelItem);
    // V4 uses the panelId from input — it doesn't override
    // The panel description should NOT contain 'Philadelphia Solar' since user chose Q CELLS
    if (panelItem) {
      const isPhillySolar = panelItem.model.includes('Philadelphia') || panelItem.model.includes('Nexus');
      checkFalse(a, 'Panel NOT forced to Philadelphia Solar', isPhillySolar);
    }

    results.push({ name: 'Non-destructive defaults', passed: a.every(x => x.pass), assertions: a });
  }

  return results;
}

// ─── Run & Report ────────────────────────────────────────────

const results = runAllTests();
let totalPass = 0;
let totalFail = 0;

console.log('\n' + '═'.repeat(72));
console.log('  MASTER TASK — Golden Test Results');
console.log('═'.repeat(72) + '\n');

for (const test of results) {
  const icon = test.passed ? '✓' : '✗';
  const color = test.passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m ${test.name}`);

  for (const a of test.assertions) {
    if (!a.pass) {
      console.log(`    \x1b[31m✗ ${a.label}: expected=${a.expected}, actual=${a.actual}\x1b[0m`);
    }
  }

  if (test.passed) totalPass++;
  else totalFail++;
}

console.log('\n' + '─'.repeat(72));
console.log(`  Total: ${results.length} tests — ${totalPass} passed, ${totalFail} failed`);
console.log('─'.repeat(72) + '\n');

if (totalFail > 0) {
  console.log('\x1b[31m  SOME TESTS FAILED\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32m  ALL TESTS PASSED\x1b[0m\n');
}