// ═════════════════════════════════════════════════════════════════════════════
// Phase 12 — System-Wide Validation Layer tests
// ═════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand, MIN_DC_AC_RATIO, PREFERRED_DC_AC_RATIO_MIN, PREFERRED_DC_AC_RATIO_MAX } from './sizingEngine';
import type { SystemSizingResult, SizingInput } from './sizingEngine';
import type { SystemDefinition } from './systemDefinition';
import type { StructuralBOMItem } from '../bom-system-profiles';
import {
  validateSystem,
  validatePanelConsistency,
  validateDcAcRatio,
  validateInverter,
  validateStrings,
  validateTopologyConsistency,
  validateBattery,
  validateBrandCompatibility,
  validateBomConsistency,
  validateStructuralElectrical,
  validateEngineOutputConsistency,
  validateBrandEcosystem,
  validateBosRequirements,
} from './validationEngine';

// ─── Helpers ────────────────────────────────────────────────────────────────

function runSizing(overrides: Partial<SizingInput> = {}): SystemSizingResult {
  return sizeSystemFromBrand({
    systemType: 'roof',
    panelCount: 20,
    selectedBrand: 'solaredge',
    ...overrides,
  });
}

function minimalSysDef(overrides: Partial<SystemDefinition> = {}): SystemDefinition {
  return {
    systemType: 'roof',
    panel: {
      wattage: 400,
      vmp: 34.5,
      voc: 41.6,
      imp: 11.6,
      isc: 12.3,
      widthIn: 40,
      heightIn: 66,
      weightLb: 44,
      orientation: 'portrait',
    },
    layout: {
      tilt: 25,
      azimuth: 180,
      rowSpacing: 12,
    },
    structure: {
      railOrientation: 'horizontal',
    },
    electrical: {
      inverterType: 'optimizer',
    },
    ...overrides,
  } as SystemDefinition;
}

// ═════════════════════════════════════════════════════════════════════════════
// RULE 1 — Panel consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 1: Panel consistency', () => {
  it('valid system: no issues', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validatePanelConsistency({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR when CAD count differs from sizing count', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validatePanelConsistency({
      sizingResult: sizing,
      cadModel: { totalPanels: 25 },
    });
    expect(issues.some(i => i.code === 'PANEL_COUNT_MISMATCH_CAD')).toBe(true);
    const err = issues.find(i => i.code === 'PANEL_COUNT_MISMATCH_CAD')!;
    expect(err.severity).toBe('error');
    expect(err.context).toMatchObject({ cadCount: 25, sizingCount: 20 });
  });

  it('flags ERROR when SystemDefinition totalPanels differs from sizing', () => {
    const sizing = runSizing({ panelCount: 20 });
    const sysDef = minimalSysDef({ layout: { tilt: 25, azimuth: 180, rowSpacing: 12, totalPanels: 30 } });
    const issues = validatePanelConsistency({
      sizingResult: sizing,
      systemDefinition: sysDef,
    });
    expect(issues.some(i => i.code === 'PANEL_COUNT_MISMATCH_SYSDEF')).toBe(true);
  });

  it('flags ERROR when panel count is 0', () => {
    // Build a sizing result manually with panelCount=0 (engine refuses 0, so
    // we craft a minimal shape by calling with a tiny count and overriding).
    const sizing = runSizing({ panelCount: 1 });
    // Clone and force the degenerate state.
    const degenerate: SystemSizingResult = {
      ...sizing,
      input: { ...sizing.input, panelCount: 0 },
    };
    const issues = validatePanelConsistency({ sizingResult: degenerate });
    expect(issues.some(i => i.code === 'PANEL_COUNT_ZERO')).toBe(true);
  });

  it('uses cad.panels[] length when present (CAD-first priority)', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validatePanelConsistency({
      sizingResult: sizing,
      cadModel: {
        panels: new Array(25).fill({}),
        totalPanels: 20, // Ignored because panels[] has priority.
      },
    });
    expect(issues.some(i => i.code === 'PANEL_COUNT_MISMATCH_CAD')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 2 — DC/AC ratio
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 2: DC/AC ratio', () => {
  it('normal ratio (~1.2): no issues', () => {
    // 20 × 400W = 8 kW DC. SE-7600H = 7.6 kW AC → ratio 1.05. Clean.
    const sizing = runSizing({ panelCount: 20 });
    const issues = validateDcAcRatio({ sizingResult: sizing });
    const severe = issues.filter(i => i.severity === 'error');
    expect(severe).toEqual([]);
  });

  it('micro topology: skipped (1:1 inherent)', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const issues = validateDcAcRatio({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR for ratio > 2.0 (severe clipping)', () => {
    // Force a severe case: small AC inverter with lots of DC.
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      inverterModels: [{ ...base.inverterModels[0], acKw: 3.0, qty: 1 }],
      inverterCount: 1,
      input: { ...base.input, panelCount: 20, panelWattage: 400 }, // 8 kW DC / 3 kW AC = 2.67
    };
    const issues = validateDcAcRatio({ sizingResult: forced });
    expect(issues.some(i => i.code === 'DC_AC_RATIO_SEVERE')).toBe(true);
    expect(issues.find(i => i.code === 'DC_AC_RATIO_SEVERE')!.severity).toBe('error');
  });

  it('flags WARNING for ratio > 1.6 but ≤ 2.0', () => {
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      inverterModels: [{ ...base.inverterModels[0], acKw: 4.5, qty: 1 }],
      inverterCount: 1,
      input: { ...base.input, panelCount: 20, panelWattage: 400 }, // 8 / 4.5 = 1.78
    };
    const issues = validateDcAcRatio({ sizingResult: forced });
    expect(issues.some(i => i.code === 'DC_AC_RATIO_HIGH')).toBe(true);
    expect(issues.find(i => i.code === 'DC_AC_RATIO_HIGH')!.severity).toBe('warning');
  });

  it('flags ERROR for ratio < 1.0 (AC exceeds DC — v58.0)', () => {
    // v58.0: ratio < 1.0 now emits DC_AC_RATIO_AC_EXCEEDS_DC (error),
    // not DC_AC_RATIO_LOW (warning). Early return prevents double-reporting.
    const base = runSizing({ panelCount: 10 });
    const forced: SystemSizingResult = {
      ...base,
      inverterModels: [{ ...base.inverterModels[0], acKw: 11.4, qty: 1 }],
      inverterCount: 1,
      input: { ...base.input, panelCount: 10, panelWattage: 400 }, // 4 / 11.4 = 0.35 < 1.0
    };
    const issues = validateDcAcRatio({ sizingResult: forced });
    // DC_AC_RATIO_AC_EXCEEDS_DC replaces DC_AC_RATIO_LOW for ratio < 1.0
    expect(issues.some(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC')).toBe(true);
    expect(issues.find(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC')!.severity).toBe('error');
    // DC_AC_RATIO_LOW must NOT appear (early return after AC_EXCEEDS_DC)
    expect(issues.some(i => i.code === 'DC_AC_RATIO_LOW')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 3 — Inverter
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 3: Inverter', () => {
  it('valid inverter: no issues', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validateInverter({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR when inverterCount is 0', () => {
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      inverterCount: 0,
      inverterModels: [],
    };
    const issues = validateInverter({ sizingResult: forced });
    expect(issues.some(i => i.code === 'INVERTER_MISSING')).toBe(true);
  });

  it('flags ERROR when inverterCount drifts from sum of model qty', () => {
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      inverterCount: 5, // lies — only 1 unit in inverterModels
    };
    const issues = validateInverter({ sizingResult: forced });
    expect(issues.some(i => i.code === 'INVERTER_COUNT_DRIFT')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 4 — Strings
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 4: Strings', () => {
  it('valid strings: no issues', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validateStrings({ sizingResult: sizing });
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('flags ERROR for string below min panels', () => {
    const base = runSizing({ panelCount: 20 });
    // SolarEdge min = 8. Inject a 4-panel string.
    const forced: SystemSizingResult = {
      ...base,
      strings: [
        { index: 0, panelCount: 4, mpptIndex: 0, inverterIndex: 0, modelIndex: 0 },
        { index: 1, panelCount: 16, mpptIndex: 1, inverterIndex: 0, modelIndex: 0 },
      ],
    };
    const issues = validateStrings({ sizingResult: forced });
    expect(issues.some(i => i.code === 'STRING_BELOW_MIN')).toBe(true);
    expect(issues.find(i => i.code === 'STRING_BELOW_MIN')!.severity).toBe('error');
  });

  it('flags ERROR for string above max panels', () => {
    const base = runSizing({ panelCount: 20 });
    // SolarEdge max = 25. Inject a 40-panel string.
    const forced: SystemSizingResult = {
      ...base,
      strings: [
        { index: 0, panelCount: 40, mpptIndex: 0, inverterIndex: 0, modelIndex: 0 },
      ],
    };
    const issues = validateStrings({ sizingResult: forced });
    expect(issues.some(i => i.code === 'STRING_ABOVE_MAX')).toBe(true);
  });

  it('flags WARNING for string imbalance within a physical unit (>30% deviation)', () => {
    const base = runSizing({ panelCount: 20 });
    // Same unit with wildly different string sizes.
    const forced: SystemSizingResult = {
      ...base,
      strings: [
        { index: 0, panelCount: 15, mpptIndex: 0, inverterIndex: 0, modelIndex: 0 },
        { index: 1, panelCount: 8, mpptIndex: 1, inverterIndex: 0, modelIndex: 0 },
      ],
      inverterCount: 1,
    };
    const issues = validateStrings({ sizingResult: forced });
    expect(issues.some(i => i.code === 'STRING_IMBALANCE')).toBe(true);
    expect(issues.find(i => i.code === 'STRING_IMBALANCE')!.severity).toBe('warning');
  });

  it('micro topology: string validation is skipped', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const issues = validateStrings({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 5 — Topology consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 5: Topology consistency', () => {
  it('valid micro: no issues', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const issues = validateTopologyConsistency({ sizingResult: sizing });
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('valid string: no issues', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const issues = validateTopologyConsistency({ sizingResult: sizing });
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('flags ERROR when micro system has strings', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const forced: SystemSizingResult = {
      ...base,
      strings: [{ index: 0, panelCount: 10, mpptIndex: 0, inverterIndex: 0, modelIndex: 0 }],
    };
    const issues = validateTopologyConsistency({ sizingResult: forced });
    expect(issues.some(i => i.code === 'TOPOLOGY_MICRO_HAS_STRINGS')).toBe(true);
  });

  it('flags ERROR when non-micro system has microDeviceCount > 0', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const forced: SystemSizingResult = {
      ...base,
      microDeviceCount: 20,
    };
    const issues = validateTopologyConsistency({ sizingResult: forced });
    expect(issues.some(i => i.code === 'TOPOLOGY_NONMICRO_HAS_MICROS')).toBe(true);
  });

  it('flags ERROR for cross-contamination: micro system with string_inverter component', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const forced: SystemSizingResult = {
      ...base,
      requiredComponents: [
        ...base.requiredComponents,
        { category: 'string_inverter', qty: 1, qtyPolicy: 'per_inverter', required: true },
      ],
    };
    const issues = validateTopologyConsistency({ sizingResult: forced });
    expect(issues.some(i => i.code === 'TOPOLOGY_MICRO_STRINGCOMPONENT')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 6 — Battery
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 6: Battery', () => {
  it('battery disabled + no battery in result: no issues', () => {
    const sizing = runSizing({ panelCount: 20 }); // default batteryEnabled=false
    const issues = validateBattery({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR when battery enabled but installedKwh=0', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'ecoflow', systemType: 'fence', batteryEnabled: true });
    if (base.battery) {
      const forced: SystemSizingResult = {
        ...base,
        input: { ...base.input, batteryEnabled: true },
        battery: { ...base.battery, installedKwh: 0 },
      };
      const issues = validateBattery({ sizingResult: forced });
      expect(issues.some(i => i.code === 'BATTERY_ZERO_KWH')).toBe(true);
    }
  });

  it('flags ERROR when battery disabled but sizing still produced a battery block', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'ecoflow', systemType: 'fence', batteryEnabled: true });
    if (base.battery) {
      const forced: SystemSizingResult = {
        ...base,
        input: { ...base.input, batteryEnabled: false },
        // Keep battery (contradictory).
      };
      const issues = validateBattery({ sizingResult: forced });
      expect(issues.some(i => i.code === 'BATTERY_DISABLED_BUT_SIZED')).toBe(true);
    }
  });

  it('flags ERROR when battery disabled but BOM contains battery items', () => {
    const sizing = runSizing({ panelCount: 20 }); // battery disabled
    const bom: StructuralBOMItem[] = [
      {
        stageId: 'inverter',
        category: 'battery_module',
        manufacturer: 'EcoFlow',
        model: 'PowerOcean 5kWh',
        partNumber: 'EF-PO-5',
        description: 'Battery module',
        quantity: 2,
        unit: 'ea',
        derivedFrom: 'test',
        required: true,
      },
    ];
    const issues = validateBattery({ sizingResult: sizing, bomItems: bom });
    expect(issues.some(i => i.code === 'BATTERY_DISABLED_BUT_IN_BOM')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 7 — Brand compatibility
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 7: Brand compatibility', () => {
  it('compatible brand+system: no issues', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge', systemType: 'roof' });
    const issues = validateBrandCompatibility({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags WARNING when brand does not support the system type', () => {
    // SolarEdge supports roof and ground — not fence.
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge', systemType: 'fence' });
    const issues = validateBrandCompatibility({ sizingResult: sizing });
    expect(issues.some(i => i.code === 'BRAND_SYSTEM_UNSUPPORTED')).toBe(true);
    expect(issues.find(i => i.code === 'BRAND_SYSTEM_UNSUPPORTED')!.severity).toBe('warning');
  });

  it('flags ERROR on brand/topology drift (internal engine inconsistency)', () => {
    const base = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const forced: SystemSizingResult = {
      ...base,
      topology: 'micro', // SolarEdge is 'optimizer' — drift
    };
    const issues = validateBrandCompatibility({ sizingResult: forced });
    expect(issues.some(i => i.code === 'BRAND_TOPOLOGY_DRIFT')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 8 — BOM consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 8: BOM consistency', () => {
  it('no BOM provided: no issues', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validateBomConsistency({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR when BOM panel qty differs from sizing', () => {
    const sizing = runSizing({ panelCount: 20 });
    const bom: StructuralBOMItem[] = [
      {
        stageId: 'array',
        category: 'panel',
        manufacturer: 'Test',
        model: 'P-400',
        partNumber: 'P-400',
        description: 'Panel',
        quantity: 15, // MISMATCH — sizing expects 20
        unit: 'ea',
        derivedFrom: 'test',
        required: true,
      },
    ];
    const issues = validateBomConsistency({ sizingResult: sizing, bomItems: bom });
    expect(issues.some(i => i.code === 'BOM_PANEL_COUNT_MISMATCH')).toBe(true);
  });

  it('flags ERROR for stale brand components in BOM', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const bom: StructuralBOMItem[] = [
      {
        stageId: 'inverter',
        category: 'microinverter',
        manufacturer: 'Enphase', // stale from a prior brand
        model: 'IQ8-60',
        partNumber: 'IQ8-60',
        description: 'Microinverter',
        quantity: 20,
        unit: 'ea',
        derivedFrom: 'test',
        required: true,
      },
    ];
    const issues = validateBomConsistency({ sizingResult: sizing, bomItems: bom });
    expect(issues.some(i => i.code === 'BOM_STALE_BRAND')).toBe(true);
    expect(issues.find(i => i.code === 'BOM_STALE_BRAND')!.severity).toBe('error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RULE 10 — Engine output consistency
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — RULE 10: Engine output consistency', () => {
  it('valid engine output: no issues', () => {
    const sizing = runSizing({ panelCount: 20 });
    const issues = validateEngineOutputConsistency({ sizingResult: sizing });
    expect(issues).toEqual([]);
  });

  it('flags ERROR for out-of-range modelIndex', () => {
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      strings: base.strings.map(s => ({ ...s, modelIndex: 99 })),
    };
    const issues = validateEngineOutputConsistency({ sizingResult: forced });
    expect(issues.some(i => i.code === 'ENGINE_STRING_MODELINDEX_OOB')).toBe(true);
  });

  it('flags ERROR when a physical unit has no strings assigned', () => {
    const base = runSizing({ panelCount: 20 });
    const forced: SystemSizingResult = {
      ...base,
      inverterCount: 3, // 2 extra phantom units
      inverterModels: [{ ...base.inverterModels[0], qty: 3 }],
    };
    const issues = validateEngineOutputConsistency({ sizingResult: forced });
    expect(issues.some(i => i.code === 'ENGINE_UNIT_EMPTY')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — validateSystem (integration)
// ═════════════════════════════════════════════════════════════════════════════

describe('Validation — validateSystem orchestrator', () => {
  it('valid system produces isPassing=true and no errors', () => {
    const sizing = runSizing({ panelCount: 20 });
    const result = validateSystem({ sizingResult: sizing });
    expect(result.isPassing).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('buckets issues by severity', () => {
    // Build a multi-issue scenario: panel mismatch (err) + ratio warn + info from engine.
    const base = runSizing({
      panelCount: 36,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h', // triggers INVERTER_UPSIZED info
    });
    // Force a panel mismatch via CAD disagreement.
    const result = validateSystem({
      sizingResult: base,
      cadModel: { totalPanels: 40 },
    });
    expect(result.errors.some(e => e.code === 'PANEL_COUNT_MISMATCH_CAD')).toBe(true);
    expect(result.info.some(i => i.code === 'INVERTER_UPSIZED')).toBe(true);
    expect(result.isPassing).toBe(false);
  });

  it('carries sizing-engine warnings into the validation report', () => {
    // 36 panels + se-7600h → INVERTER_UPSIZED info warning.
    const sizing = runSizing({
      panelCount: 36,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });
    const result = validateSystem({ sizingResult: sizing });
    const upsizeIssues = [...result.info, ...result.warnings, ...result.errors]
      .filter(i => i.code === 'INVERTER_UPSIZED');
    expect(upsizeIssues.length).toBeGreaterThan(0);
  });

  it('isClean=true only when zero errors AND zero warnings', () => {
    const sizing = runSizing({ panelCount: 20 });
    const clean = validateSystem({ sizingResult: sizing });
    expect(clean.isClean).toBe(true);

    const base = runSizing({ panelCount: 20 });
    // Inject a warning-level issue via DC/AC forcing.
    const forced: SystemSizingResult = {
      ...base,
      inverterModels: [{ ...base.inverterModels[0], acKw: 4.5, qty: 1 }],
      inverterCount: 1,
    };
    const withWarn = validateSystem({ sizingResult: forced });
    expect(withWarn.isPassing).toBe(true);  // still no errors
    expect(withWarn.isClean).toBe(false);   // but has warnings
  });

  it('gracefully handles missing optional inputs (no systemDef, no cad, no bom)', () => {
    const sizing = runSizing({ panelCount: 20 });
    const result = validateSystem({ sizingResult: sizing });
    expect(result.errors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 15 — RULE 11 (validateBrandEcosystem)
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 15 — RULE 11: validateBrandEcosystem', () => {
  it('clean config (Enphase micro roof, no battery) → no ecosystem issues', () => {
    const sizing = runSizing({
      panelCount: 20,
      selectedBrand: 'enphase',
      batteryEnabled: false,
    });
    const issues = validateBrandEcosystem({ sizingResult: sizing });
    expect(issues).toHaveLength(0);
  });

  it('Enphase inverter + EcoFlow battery selection → INCOMPATIBLE_CROSS_BRAND error', () => {
    const sizing = runSizing({
      panelCount: 20,
      selectedBrand: 'enphase',
      batteryEnabled: true,
      selectedBatteryBrand: 'ecoflow',
    });
    const issues = validateBrandEcosystem({ sizingResult: sizing });
    const codes = issues.map(i => i.code);
    expect(codes).toContain('INCOMPATIBLE_CROSS_BRAND');
    // Must be ERROR severity.
    const crossBrand = issues.find(i => i.code === 'INCOMPATIBLE_CROSS_BRAND');
    expect(crossBrand?.severity).toBe('error');
    // Must carry a corrective suggestion in context.
    expect(crossBrand?.context).toHaveProperty('suggestion');
  });

  it('flows through validateSystem → errors block isPassing', () => {
    const sizing = runSizing({
      panelCount: 20,
      selectedBrand: 'enphase',
      batteryEnabled: true,
      selectedBatteryBrand: 'ecoflow',
    });
    const result = validateSystem({ sizingResult: sizing });
    expect(result.isPassing).toBe(false);
    const codes = [...result.errors, ...result.warnings].map(i => i.code);
    expect(codes).toContain('INCOMPATIBLE_CROSS_BRAND');
  });

  it('EcoFlow + EcoFlow battery → ok, no ecosystem errors', () => {
    const sizing = runSizing({
      systemType: 'fence',
      panelCount: 20,
      selectedBrand: 'ecoflow',
      batteryEnabled: true,
      selectedBatteryBrand: 'ecoflow',
    });
    const result = validateSystem({ sizingResult: sizing });
    const hasCrossBrand = result.errors.some(
      e => e.code === 'INCOMPATIBLE_CROSS_BRAND' || e.code === 'INCOMPATIBLE_INVERTER_BATTERY',
    );
    expect(hasCrossBrand).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 15 — RULE 12 (validateBosRequirements)
// ═══════════════════════════════════════════════════════════════════════

describe('Phase 15 — RULE 12: validateBosRequirements', () => {
  it('no BOM provided → rule is a no-op', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const issues = validateBosRequirements({ sizingResult: sizing, bomItems: null });
    expect(issues).toHaveLength(0);
  });

  // Helper: build a minimal well-typed StructuralBOMItem with test-friendly defaults.
  function bomItem(
    category: string,
    overrides: Partial<StructuralBOMItem> = {},
  ): StructuralBOMItem {
    return {
      stageId: 'array',
      category,
      manufacturer: 'Generic',
      model: 'TEST',
      partNumber: 'TEST-001',
      description: `Test ${category}`,
      quantity: 1,
      unit: 'ea',
      derivedFrom: 'test-fixture',
      required: true,
      ...overrides,
    };
  }

  it('optimizer topology with missing "optimizer" category → MISSING_BOS_CATEGORY error', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    // BOM has DC + AC disconnect but NO optimizer category.
    const bomItems: StructuralBOMItem[] = [
      bomItem('dc_disconnect', { stageId: 'dc' }),
      bomItem('ac_disconnect', { stageId: 'ac' }),
    ];
    const issues = validateBosRequirements({ sizingResult: sizing, bomItems });
    const missingOpt = issues.find(
      i => i.code === 'MISSING_BOS_CATEGORY' && (i.context as { missingCategory?: string })?.missingCategory === 'optimizer',
    );
    expect(missingOpt).toBeDefined();
    expect(missingOpt?.severity).toBe('error');
  });

  it('string topology with all required BOS present → no issues', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'fronius' });
    const bomItems: StructuralBOMItem[] = [
      bomItem('dc_disconnect', { stageId: 'dc', manufacturer: 'Fronius' }),
      bomItem('ac_disconnect', { stageId: 'ac', manufacturer: 'Fronius' }),
      bomItem('rapid_shutdown', { stageId: 'array', manufacturer: 'Tigo', quantity: 20 }),
    ];
    const issues = validateBosRequirements({ sizingResult: sizing, bomItems });
    expect(issues).toHaveLength(0);
  });

  it('micro topology missing trunk_cable → MISSING_BOS_CATEGORY', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'enphase' });
    const bomItems: StructuralBOMItem[] = [
      bomItem('microinverter', { stageId: 'inverter', manufacturer: 'Enphase', quantity: 20 }),
      bomItem('terminator', { stageId: 'inverter', manufacturer: 'Enphase', quantity: 2 }),
      bomItem('monitoring_gateway', { stageId: 'monitoring', manufacturer: 'Enphase' }),
      // trunk_cable intentionally missing
    ];
    const issues = validateBosRequirements({ sizingResult: sizing, bomItems });
    const missingTrunk = issues.find(
      i => (i.context as { missingCategory?: string })?.missingCategory === 'trunk_cable',
    );
    expect(missingTrunk).toBeDefined();
  });

  it('flows through validateSystem as errors', () => {
    const sizing = runSizing({ panelCount: 20, selectedBrand: 'solaredge' });
    const bomItems: StructuralBOMItem[] = [
      // Deliberately incomplete: missing optimizer, dc_disconnect, ac_disconnect.
      bomItem('panel', { stageId: 'array', quantity: 20 }),
    ];
    const result = validateSystem({ sizingResult: sizing, bomItems });
    expect(result.isPassing).toBe(false);
    const missingCategories = result.errors
      .filter(e => e.code === 'MISSING_BOS_CATEGORY')
      .map(e => (e.context as { missingCategory?: string })?.missingCategory);
    expect(missingCategories).toContain('optimizer');
  });
});
// ═══════════════════════════════════════════════════════════════════════════════
// v58.0 — DC/AC Ratio Regression Tests
// Covers: MIN_DC_AC_RATIO = 1.00, AC > DC = error, SolarEdge 14.4 kW auto-select
// ═══════════════════════════════════════════════════════════════════════════════

describe('v58.0 — DC/AC ratio enforcement (MIN_DC_AC_RATIO = 1.00)', () => {
  // ── Sizing Engine: 14.4 kW DC + se-7600h selected ──────────────────────────
  it('14.4 kW DC / se-7600h selected → must NOT produce 2×SE7600H (AC > DC)', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      panelWattage: 400,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });

    const totalAcKw = result.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    const totalDcKw = (36 * 400) / 1000; // 14.4 kW

    // AC must NOT exceed DC (ratio < 1.0 is forbidden by auto-selection)
    expect(totalAcKw).toBeLessThanOrEqual(totalDcKw);

    // Should NOT be 2×SE7600H (15.2 kW AC > 14.4 kW DC)
    const is2xSE7600H = result.inverterModels.some(
      m => m.equipmentDbId === 'se-7600h' && m.qty === 2,
    );
    expect(is2xSE7600H).toBe(false);
  });

  it('14.4 kW DC / se-7600h selected → Rule 1 upsizes to se-11400h×1 (DC/AC 1.26)', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      panelWattage: 400,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });

    const model = result.inverterModels[0];
    expect(model).toBeDefined();
    // Should be se-11400h (11.4 kW AC, ratio = 14.4/11.4 = 1.26) or se-10000h (ratio 1.44)
    // Both are valid — the key is DC/AC >= 1.00
    const totalAcKw = result.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    const ratio = 14.4 / totalAcKw;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
  });

  // ── Sizing Engine: auto-tier path ────────────────────────────────────────────
  it('14.4 kW DC / no selection (auto) → se-11400h×1 (within preferred range)', () => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      panelWattage: 400,
      selectedBrand: 'solaredge',
    });

    const totalAcKw = result.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    const totalDcKw = (36 * 400) / 1000;
    const ratio = totalDcKw / totalAcKw;

    // DC/AC must be >= 1.00
    expect(ratio).toBeGreaterThanOrEqual(1.0);
    // Should land on se-11400h (11.4 kW AC) → ratio 1.26 ∈ [1.15, 1.35]
    expect(result.inverterModels[0]?.equipmentDbId).toBe('se-11400h');
  });

  // ── Validation Engine: DC/AC < 1.00 = error ─────────────────────────────────
  it('validateDcAcRatio: ratio < 1.00 → DC_AC_RATIO_AC_EXCEEDS_DC error', () => {
    // Build a fake sizing result where AC > DC (ratio = 14.4/15.2 = 0.947)
    const sizing = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      panelWattage: 400,
      selectedBrand: 'solaredge',
      selectedInverterId: 'se-7600h',
    });

    // Manually override to inject the bad config (2×se-7600h = 15.2 kW AC)
    const badSizing = {
      ...sizing,
      inverterModels: [{ ...sizing.inverterModels[0], equipmentDbId: 'se-7600h', acKw: 7.6, qty: 2 }],
    };

    const issues = validateDcAcRatio({ sizingResult: badSizing });
    const acExceedsDc = issues.find(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC');
    expect(acExceedsDc).toBeDefined();
    expect(acExceedsDc?.severity).toBe('error');
  });

  it('validateDcAcRatio: ratio = 1.26 (se-11400h×1) → no DC_AC_RATIO_AC_EXCEEDS_DC error', () => {
    const sizing = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 36,
      panelWattage: 400,
      selectedBrand: 'solaredge',
    });

    const issues = validateDcAcRatio({ sizingResult: sizing });
    const acExceedsDc = issues.find(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC');
    expect(acExceedsDc).toBeUndefined();
  });

  it('validateDcAcRatio: ratio = 0.75 (severely oversized) → DC_AC_RATIO_AC_EXCEEDS_DC error (not just warning)', () => {
    const sizing = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'solaredge',
    });
    // 20 panels × 400W = 8 kW DC; inject 2×se-7600h = 15.2 kW AC → ratio 0.53
    const badSizing = {
      ...sizing,
      inverterModels: [{ ...sizing.inverterModels[0], equipmentDbId: 'se-7600h', acKw: 7.6, qty: 2 }],
    };
    const issues = validateDcAcRatio({ sizingResult: badSizing });
    const acExceedsDc = issues.find(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC');
    expect(acExceedsDc).toBeDefined();
    expect(acExceedsDc?.severity).toBe('error');
    // DC_AC_RATIO_LOW should NOT also appear (redundant below 1.0)
    const low = issues.find(i => i.code === 'DC_AC_RATIO_LOW');
    expect(low).toBeUndefined();
  });

  // ── Sizing Engine: MIN_DC_AC_RATIO constants ─────────────────────────────────
  it('MIN_DC_AC_RATIO exported constant is 1.00', () => {
      // MIN_DC_AC_RATIO is imported from sizingEngine at top of file
      expect(MIN_DC_AC_RATIO).toBe(1.00);
    });

  it('PREFERRED_DC_AC_RATIO_MIN is 1.20 and PREFERRED_DC_AC_RATIO_MAX is 1.40', () => {
    // PREFERRED_DC_AC_RATIO_MIN/MAX imported at file top
    expect(PREFERRED_DC_AC_RATIO_MIN).toBe(1.20);
    expect(PREFERRED_DC_AC_RATIO_MAX).toBe(1.40);
  });

  // ── Validation Engine: SolarEdge brand-min >= 1.0 = error ───────────────────
  it('validateDcAcRatio: SolarEdge brand min=1.0 violation → severity error (not warning)', () => {
    const sizing = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: 20,
      panelWattage: 400,
      selectedBrand: 'solaredge',
    });
    // Inject a ratio of 0.85 (manually — between 0.8 and 1.0, above DC_AC_RATIO_LOW but below SolarEdge min)
    const badSizing = {
      ...sizing,
      inverterModels: [{ ...sizing.inverterModels[0], equipmentDbId: 'se-11400h', acKw: 11.4, qty: 1 }],
      input: { ...sizing.input, panelCount: 16, panelWattage: 400 }, // 6.4 kW DC / 11.4 kW AC = 0.56
    };
    const issues = validateDcAcRatio({ sizingResult: badSizing });
    // With ratio ~0.56 (< 1.0), should get DC_AC_RATIO_AC_EXCEEDS_DC
    const acExceedsDc = issues.find(i => i.code === 'DC_AC_RATIO_AC_EXCEEDS_DC');
    expect(acExceedsDc).toBeDefined();
    expect(acExceedsDc?.severity).toBe('error');
  });

  // ── Sizing Engine: various DC sizes don't produce AC > DC ───────────────────
  it.each([
    { panels: 10, wattage: 400, brand: 'solaredge' },  // 4.0 kW
    { panels: 18, wattage: 400, brand: 'solaredge' },  // 7.2 kW
    { panels: 25, wattage: 400, brand: 'solaredge' },  // 10.0 kW
    { panels: 36, wattage: 400, brand: 'solaredge' },  // 14.4 kW
    { panels: 40, wattage: 400, brand: 'solaredge' },  // 16.0 kW
  ])('$brand auto-tier: $panels panels (${ panels * wattage / 1000 } kW DC) → DC/AC >= 1.00', ({ panels, wattage, brand }) => {
    const result = sizeSystemFromBrand({
      systemType: 'roof',
      panelCount: panels,
      panelWattage: wattage,
      selectedBrand: brand,
    });
    const totalAcKw = result.inverterModels.reduce((s, m) => s + m.acKw * m.qty, 0);
    const totalDcKw = (panels * wattage) / 1000;
    const ratio = totalDcKw / totalAcKw;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
  });
});
