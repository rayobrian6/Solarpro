// ============================================================================
// Wave 5 Lane A — multi-lane SLD renderer + source-branch adapters.
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 5 / §1.7 / I-1 / I-6 / I-8.
//
// Covers:
//   1. LEGACY IDENTITY (I-1): sources absent / [] / single-branch ⇒ the legacy
//      single-source path BYTE-FOR-BYTE (extends the Wave-0 structural-marker
//      goldens, which continue to pin the legacy markers themselves).
//   2. MULTI-LANE STRUCTURE: a 3-lane hybrid (Enphase micro roof + Solis
//      string ground + SolFence optimizer fence — the I-3 golden shape) draws
//      3 array blocks with per-lane labels/counts, ONE POI, ONE service tail.
//   3. ADAPTERS: permit path (conductorAuthority.subSystems — the documented
//      single source of truth) and page path (computedMulti.subSystems).
//   4. EMPTY-FLEET SUB HANDLING: subs without a computed system / zero panels
//      never become lanes; <2 usable lanes ⇒ no sources (banner fallback).
//
// Determinism rule: literal values only; renders compared within one process
// (getBuildBadge is process-stable).
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  renderSLDProfessional,
  normalizeSourceBranches,
  type SLDProfessionalInput,
  type SLDSourceBranch,
} from '../../lib/sld-professional-renderer';
import {
  buildSourceBranchesFromAuthority,
  buildSourceBranchesFromComputedMulti,
  sanitizeClientSourceBranches,
  synthesizeFleetFromSubEquipment,
  generateLiveSLD,
} from '../../lib/permit/utils/sldAdapter';
import { buildConductorAuthority } from '../../lib/permit/utils/conductorAuthority';
import { computeMultiSystem } from '../../lib/computed-multi-system';
import { roofProject } from '../../test-fixtures/roofProject';
import { csMicroInput, csStringInput } from './wave0-fixtures';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

// ── Legacy single-source inputs (same shapes the Wave-0 golden pins) ────────
const BASE = {
  projectName: 'WAVE5A', clientName: 'Wave5 Client',
  address: '1 Hybrid Way, Phoenix AZ 85001', designer: 'Wave5A',
  drawingDate: '2026-07-12', drawingNumber: 'W5-001', revision: 'A',
  scale: 'NOT TO SCALE',
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT',
  mainPanelAmps: 200, utilityName: 'APS', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};

const legacyMicro = (): SLDProfessionalInput => ({
  ...BASE,
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 0, deviceCount: 20,
  dcOCPD: 0, inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
  acOutputKw: 5.8, acOutputAmps: 24.2, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: true,
} as SLDProfessionalInput);

const legacyString = (): SLDProfessionalInput => ({
  ...BASE,
  topologyType: 'STRING_INVERTER', ecosystemTopology: 'string', selectedBrand: 'fronius',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 2,
  dcOCPD: 20, inverterModel: 'Primo 8.2-1', inverterManufacturer: 'Fronius',
  acOutputKw: 7.6, acOutputAmps: 31.7, acWireGauge: '#8', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: false,
} as SLDProfessionalInput);

// ── 3-lane hybrid branches (contract I-3 golden shape) ──────────────────────
const roofBranch = (): SLDSourceBranch => ({
  key: 'roof', label: 'ROOF — 48 × Maxeon 6 400W',
  topologyType: 'MICROINVERTER', systemType: 'roof',
  totalModules: 48, panelModel: 'Maxeon 6 400W', panelWatts: 400,
  panelVoc: 42.1, panelIsc: 12.1,
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
  acKwPerDevice: 0.33, acOutputKw: 15.84, acOutputAmps: 66,
  acWireGauge: '#4 AWG', acConduitType: 'EMT', acOCPD: 90, backfeedAmps: 90,
  deviceCount: 48, rapidShutdownIntegrated: true,
  combinerLabel: 'Enphase IQ Combiner 6C',
  microBranches: [
    { branchIndex: 1, deviceCount: 13, branchCurrentA: 17.9, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
    { branchIndex: 2, deviceCount: 13, branchCurrentA: 17.9, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
    { branchIndex: 3, deviceCount: 12, branchCurrentA: 16.5, ocpdAmps: 25, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
    { branchIndex: 4, deviceCount: 10, branchCurrentA: 13.8, ocpdAmps: 20, conductorCallout: '#10 AWG THWN-2 + EGC', necReference: 'NEC 690.8(B)' },
  ],
});

const groundBranch = (): SLDSourceBranch => ({
  key: 'ground', label: 'GROUND — 20 × Tesla TSP-420',
  topologyType: 'STRING_INVERTER', systemType: 'ground',
  totalModules: 20, totalStrings: 2, panelsPerString: 10,
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  inverterManufacturer: 'Solis', inverterModel: 'S6-GR1P6K', inverterCount: 1,
  acOutputKw: 6.0, acOutputAmps: 25,
  acWireGauge: '#8 AWG', acConduitType: 'PVC Sch 40', acOCPD: 35, backfeedAmps: 35,
  dcOCPD: 20,
});

const fenceBranch = (): SLDSourceBranch => ({
  key: 'fence', label: 'FENCE — 17 × SolFence SF-BIF-400',
  topologyType: 'STRING_WITH_OPTIMIZER', systemType: 'fence',
  totalModules: 17, totalStrings: 1, panelsPerString: 17,
  panelModel: 'SolFence SF-BIF-400', panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6,
  inverterManufacturer: 'SolFence', inverterModel: 'SF-OPT-3800', inverterCount: 1,
  acOutputKw: 3.8, acOutputAmps: 15.8,
  acWireGauge: '#10 AWG', acConduitType: 'PVC Sch 40', acOCPD: 20, backfeedAmps: 20,
  integratedDcDisconnect: true, optimizerQty: 17, optimizerModel: 'SF-OPT',
});

const hybridInput = (): SLDProfessionalInput => ({
  ...BASE,
  topologyType: 'MICROINVERTER',
  totalModules: 85, totalStrings: 3, dcOCPD: 20,
  inverterModel: 'IQ8M', inverterManufacturer: 'Enphase',
  acOutputKw: 25.64, acOutputAmps: 107,
  acWireGauge: '#2 AWG', acConduitType: 'EMT',
  acOCPD: 150, backfeedAmps: 145, panelBusRating: 225,
  rapidShutdownIntegrated: true,
  sources: [roofBranch(), groundBranch(), fenceBranch()],
} as SLDProfessionalInput);

// ═════ 1. Legacy identity (I-1) ══════════════════════════════════════════════
describe('wave 5a — legacy single-source path byte identity', () => {
  it('absent vs [] vs single-branch sources render byte-identically (micro)', () => {
    const base = renderSLDProfessional(legacyMicro());
    expect(renderSLDProfessional({ ...legacyMicro(), sources: [] })).toBe(base);
    expect(renderSLDProfessional({ ...legacyMicro(), sources: [roofBranch()] })).toBe(base);
  });

  it('absent vs [] vs single-branch sources render byte-identically (string)', () => {
    const base = renderSLDProfessional(legacyString());
    expect(renderSLDProfessional({ ...legacyString(), sources: [] })).toBe(base);
    expect(renderSLDProfessional({ ...legacyString(), sources: [groundBranch()] })).toBe(base);
  });

  it('invalid-key / duplicate-key branches never trigger the multi-lane path', () => {
    const base = renderSLDProfessional(legacyMicro());
    const junk = [{ key: 'carport' } as unknown as SLDSourceBranch, roofBranch(), roofBranch()];
    expect(renderSLDProfessional({ ...legacyMicro(), sources: junk })).toBe(base);
  });
});

// ═════ 2. Multi-lane structure (3 lanes, ONE POI, ONE service tail) ═══════════
describe('wave 5a — 3-lane hybrid render', () => {
  const svg = renderSLDProfessional(hybridInput());

  it('is the multi-lane artifact (version stamp, not the legacy title)', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('SLD MULTI-LANE wave5a lanes=3 keys=roof+ground+fence');
    expect(svg).toContain('SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM (MULTI-SOURCE)');
  });

  it('draws 3 array blocks with per-lane labels and counts', () => {
    expect(count(svg, 'PV ARRAY PV-R')).toBe(1);
    expect(count(svg, 'PV ARRAY PV-G')).toBe(1);
    expect(count(svg, 'SOLAR FENCE ARRAY PV-F')).toBe(1);
    expect(svg).toContain('ROOF — 48 × Maxeon 6 400W');
    expect(svg).toContain('GROUND — 20 × Tesla TSP-420');
    expect(svg).toContain('FENCE — 17 × SolFence SF-BIF-400');
    expect(svg).toContain('48 × 400W');
    expect(svg).toContain('2 STRINGS × 10 MODULES');
    expect(svg).toContain('17 DC OPTIMIZERS — 1 PER MODULE');
  });

  it('each lane carries its OWN topology symbol set (I-3)', () => {
    expect(count(svg, 'AC COMBINER')).toBeGreaterThanOrEqual(1);      // micro lane only
    expect(count(svg, 'STRING INVERTER')).toBeGreaterThanOrEqual(1);  // ground lane
    expect(count(svg, 'STRING + OPTIMIZER')).toBeGreaterThanOrEqual(1); // fence lane
    expect(count(svg, '(N) DC DISCONNECT')).toBe(1);                  // ground lane only (fence integrated)
    expect(svg).toContain('48 × IQ8M');                               // per-lane device count
    // Stage C ruling (2398a260, Ray 2026-07-14): per-lane AC disconnects are
    // DEAD — every lane lands on the shared AC combiner panel and ONE system
    // disconnect follows it. The old per-lane assertions guarded the exact
    // 3-disconnect layout the ruling removed.
    expect(count(svg, '(N) AC DISCONNECT — SYSTEM')).toBe(1);
    expect(count(svg, '(N) AC DISCONNECT PV-R')).toBe(0);
    expect(count(svg, '(N) AC DISCONNECT PV-G')).toBe(0);
    expect(count(svg, '(N) AC DISCONNECT PV-F')).toBe(0);
  });

  it('joins at ONE POI and one service tail (I-6)', () => {
    expect(count(svg, 'POINT OF INTERCONNECTION')).toBe(2);           // schematic header + calc panel header
    expect(count(svg, 'MAIN SERVICE PANEL')).toBe(1);
    expect(count(svg, 'UTILITY METER')).toBe(1);
    expect(count(svg, 'UTILITY GRID')).toBe(1);
    // §1.7: 120% panel uses the aggregator-summed backfeed passed by the adapter
    expect(svg).toContain('Σ BACKFEED 145A — NEC 705.12(B)');
    expect(svg).toContain('Σ per-inverter rounded OCPDs');
  });

  it('roof-only rapid shutdown note (I-7) + per-lane backfeed contributions', () => {
    expect(svg).toContain('RAPID SHUTDOWN — NEC 690.12 (ROOF ARRAY PV-R)');
    // E-1 pro-pass (84c34bc6): the inline "PV-R: 90A" strings became rows of
    // the POINT OF INTERCONNECTION — NEC 705.12(B) table (label cell + value
    // cell). Assert each lane's row carries its own backfeed amps.
    expect(/PV-R Backfeed<[\s\S]{0,400}?>90 A</.test(svg)).toBe(true);
    expect(/PV-G Backfeed<[\s\S]{0,400}?>35 A</.test(svg)).toBe(true);
    expect(/PV-F Backfeed<[\s\S]{0,400}?>20 A</.test(svg)).toBe(true);
  });

  it('lane order is fixed roof > ground > fence regardless of caller order', () => {
    const shuffled = renderSLDProfessional({
      ...hybridInput(),
      sources: [fenceBranch(), roofBranch(), groundBranch()],
    } as SLDProfessionalInput);
    expect(shuffled).toContain('lanes=3 keys=roof+ground+fence');
    expect(shuffled.indexOf('PV ARRAY PV-R')).toBeLessThan(shuffled.indexOf('PV ARRAY PV-G'));
    expect(shuffled.indexOf('PV ARRAY PV-G')).toBeLessThan(shuffled.indexOf('SOLAR FENCE ARRAY PV-F'));
  });

  it('2-lane render works and stamps lanes=2', () => {
    const two = renderSLDProfessional({
      ...hybridInput(),
      sources: [roofBranch(), fenceBranch()],
    } as SLDProfessionalInput);
    expect(two).toContain('SLD MULTI-LANE wave5a lanes=2 keys=roof+fence');
    expect(count(two, 'MAIN SERVICE PANEL')).toBe(1);
    expect(count(two, 'UTILITY GRID')).toBe(1);
  });

  it('embedded mode (suppressTitleBlock) crops and drops the internal title panel', () => {
    const embedded = renderSLDProfessional({ ...hybridInput(), suppressTitleBlock: true } as SLDProfessionalInput);
    expect(embedded).not.toContain('SOLARPRO');
    expect(embedded).toContain('SLD MULTI-LANE wave5a lanes=3');
  });
});

// ═════ 3. normalizeSourceBranches contract ════════════════════════════════════
describe('wave 5a — normalizeSourceBranches', () => {
  it('validates keys, dedupes, and orders roof > ground > fence', () => {
    const out = normalizeSourceBranches([
      fenceBranch(), { key: 'bogus' } as unknown as SLDSourceBranch,
      groundBranch(), roofBranch(), fenceBranch(),
    ]);
    expect(out.map(b => b.key)).toEqual(['roof', 'ground', 'fence']);
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeSourceBranches(undefined)).toEqual([]);
    expect(normalizeSourceBranches(null)).toEqual([]);
    expect(normalizeSourceBranches([])).toEqual([]);
  });
});

// ═════ 4. Permit-path adapter (conductorAuthority.subSystems = SoT) ═══════════
// Same hybrid shape as wave2d-authority.test.ts: Enphase micro roof + Solis
// string ground + SolFence optimizer fence.
function mkHybridPermit() {
  const input: any = clone(roofProject);
  (input.project.panelPositions as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  if (input.layout?.panels) (input.layout.panels as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  input.system.inverters = [
    { manufacturer: 'Enphase', model: 'IQ8M', type: 'micro',
      acOutputKw: 0.33, maxDcVoltage: 60, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'roof', strings: [] },
    { manufacturer: 'Solis', model: 'S6-GR1P6K', type: 'string',
      acOutputKw: 6.0, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'ground',
      strings: [{ label: 'G-1', panelCount: 4, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
        panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03,
        wireGauge: '#10 AWG', wireLength: 80 }] },
    { manufacturer: 'SolFence', model: 'SF-OPT-3800', type: 'optimizer',
      acOutputKw: 3.8, maxDcVoltage: 480, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'fence',
      strings: [{ label: 'F-1', panelCount: 4, panelManufacturer: 'SolFence', panelModel: 'SF-BIF-400',
        panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6, isc: 13.6,
        wireGauge: '#10 AWG', wireLength: 60 }] },
  ];
  return input;
}

function mkHybridCad(): any {
  return {
    systemType: 'roof',
    totalPanels: 12,
    hybrid: {
      sections: [
        { key: 'roof',   totalPanels: 4, equipment: { topology: 'micro', inverterMfr: 'Enphase', inverterModel: 'IQ8M', acKwPerDevice: 0.33 } },
        { key: 'ground', totalPanels: 4, equipment: { topology: 'string', inverterMfr: 'Solis', inverterModel: 'S6-GR1P6K' } },
        { key: 'fence',  totalPanels: 4, equipment: { topology: 'optimizer', inverterMfr: 'SolFence', inverterModel: 'SF-OPT-3800', panelModel: 'SF-BIF-400', panelWatts: 400, voc: 37.1, isc: 13.6 } },
      ],
    },
  };
}

describe('wave 5a — permit-path adapter (buildSourceBranchesFromAuthority)', () => {
  it('single-system authority ⇒ undefined (legacy renderer path, I-1)', () => {
    const auth = buildConductorAuthority(clone(roofProject), null);
    expect(buildSourceBranchesFromAuthority(auth, clone(roofProject))).toBeUndefined();
  });

  it('hybrid ⇒ one branch per sub, each with ITS OWN topology/equipment (I-3)', () => {
    const input = mkHybridPermit();
    const auth = buildConductorAuthority(input, mkHybridCad());
    const branches = buildSourceBranchesFromAuthority(auth, input)!;
    expect(branches.map(b => b.key)).toEqual(['roof', 'ground', 'fence']);
    const [roof, ground, fence] = branches;
    expect(roof.topologyType).toBe('MICROINVERTER');
    expect(roof.deviceCount).toBe(4);
    expect(roof.microBranches!.length).toBeGreaterThan(0);
    expect(roof.rapidShutdownIntegrated).toBe(true);      // roofProject.rapidShutdown
    expect(ground.topologyType).toBe('STRING_INVERTER');
    expect(ground.inverterModel).toBe('S6-GR1P6K');
    expect(ground.totalStrings).toBe(1);
    expect(fence.topologyType).toBe('STRING_WITH_OPTIMIZER');
    expect(fence.integratedDcDisconnect).toBe(true);
    expect(fence.optimizerQty).toBe(4);
    expect(fence.rapidShutdownIntegrated).toBe(false);    // RSD scopes to buildings (I-7)
  });

  it('§1.7 backfeed: Σ per-physical-inverter rounded OCPDs, never one combined breaker', () => {
    const input = mkHybridPermit();
    const auth = buildConductorAuthority(input, mkHybridCad());
    const branches = buildSourceBranchesFromAuthority(auth, input)!;
    const ground = branches.find(b => b.key === 'ground')!;
    const fence = branches.find(b => b.key === 'fence')!;
    // Solis 6.0 kW → 25A × 1.25 = 31.25 → 35A; SolFence 3.8 kW → 19.8 → 20A
    expect(ground.backfeedAmps).toBe(35);
    expect(fence.backfeedAmps).toBe(20);
  });

  it('generateLiveSLD renders the hybrid as a REAL multi-lane E-1 (I-8)', () => {
    const svg = generateLiveSLD(mkHybridPermit(), mkHybridCad(), { embedded: true });
    expect(svg).toContain('SLD MULTI-LANE wave5a lanes=3 keys=roof+ground+fence');
    expect(count(svg, 'UTILITY GRID')).toBe(1);
    expect(count(svg, 'MAIN SERVICE PANEL')).toBe(1);
    expect(svg).toContain('SOLAR FENCE ARRAY PV-F');
  });

  it('generateLiveSLD single-system output is unchanged by the hybrid wiring', () => {
    const svg = generateLiveSLD(clone(roofProject), null);
    expect(svg).not.toContain('SLD MULTI-LANE');
    expect(count(svg, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM')).toBeGreaterThanOrEqual(1);
  });
});

// ═════ 5. Page-path adapter (computedMulti.subSystems) ════════════════════════
describe('wave 5a — page-path adapter (buildSourceBranchesFromComputedMulti)', () => {
  const multi = computeMultiSystem([
    { ...csMicroInput(), subSystemKey: 'roof' },
    { ...csStringInput(), rooftopTempAdderC: 0, subSystemKey: 'ground' },
  ]);

  it('builds one branch per computed sub with real engine values', () => {
    const branches = buildSourceBranchesFromComputedMulti(multi)!;
    expect(branches.map(b => b.key)).toEqual(['roof', 'ground']);
    const [roof, ground] = branches;
    expect(roof.topologyType).toBe('MICROINVERTER');
    expect(roof.totalModules).toBe(20);
    expect(roof.deviceCount).toBe(20);
    expect(roof.microBranches!.length).toBeGreaterThan(0);
    expect(roof.acKwPerDevice).toBeCloseTo(0.29, 2);
    expect(ground.topologyType).toBe('STRING_INVERTER');
    expect(ground.totalStrings).toBe(2);
    expect(ground.acOutputKw).toBeCloseTo(7.6, 2);
    expect(ground.backfeedAmps).toBeGreaterThan(0);
    expect(ground.acWireGauge).toBeTruthy();              // from the sub's own feeder run
    expect(ground.runs!.length).toBeGreaterThan(0);       // bare-id per-sub runs for lane callouts
  });

  it('renders through the multi-lane path with the AGGREGATE 120% total', () => {
    const branches = buildSourceBranchesFromComputedMulti(multi)!;
    const svg = renderSLDProfessional({
      ...BASE,
      topologyType: 'MICROINVERTER',
      totalModules: multi.aggregate.totalPanels,
      totalStrings: 2, dcOCPD: 20,
      inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
      acOutputKw: multi.aggregate.totalAcKw,
      acOutputAmps: Math.round(multi.aggregate.acOutputCurrentA),
      acWireGauge: '#4 AWG', acConduitType: 'EMT',
      acOCPD: multi.aggregate.acOcpdAmps,
      backfeedAmps: multi.aggregate.backfeedBreakerAmps,  // §1.7 aggregator sum
      rapidShutdownIntegrated: true,
      runs: multi.aggregate.runs,                          // namespaced ids
      sources: branches,
    } as SLDProfessionalInput);
    expect(svg).toContain('SLD MULTI-LANE wave5a lanes=2 keys=roof+ground');
    expect(svg).toContain(`Σ BACKFEED ${multi.aggregate.backfeedBreakerAmps}A`);
    // namespaced run ids print as R:/G: rows in the conduit schedule
    expect(svg).toContain('R:');
    expect(svg).toContain('G:');
  });

  it('EMPTY-FLEET SUB HANDLING: missing/zero-panel subs never become lanes', () => {
    // Sub present in keys but with no computed system ⇒ skipped; 1 usable lane
    // ⇒ undefined ⇒ page keeps the banner fallback (I-8).
    expect(buildSourceBranchesFromComputedMulti({
      subSystemKeys: ['roof', 'fence'],
      subSystems: { roof: multi.subSystems.roof },
    })).toBeUndefined();
    // Zero-panel computed sub ⇒ also skipped.
    expect(buildSourceBranchesFromComputedMulti({
      subSystemKeys: ['roof', 'fence'],
      subSystems: {
        roof: multi.subSystems.roof,
        fence: { ...multi.subSystems.ground!, totalPanels: 0 },
      },
    })).toBeUndefined();
  });
});

// ═════ 5b. Route-payload sanitizer (sld + sld/pdf routes) ═════════════════════
describe('wave 5a — sanitizeClientSourceBranches', () => {
  it('coerces untrusted payloads, drops junk, requires ≥2 usable lanes', () => {
    const lanes = sanitizeClientSourceBranches([
      { key: 'fence', totalModules: '17', acOCPD: '20', panelWatts: 400, label: 'FENCE — 17 × SF-BIF-400', integratedDcDisconnect: true },
      { key: 'roof', totalModules: 48, acOCPD: 90, backfeedAmps: 90, microBranches: [{ branchIndex: 1, deviceCount: 13, branchCurrentA: 17.9, ocpdAmps: 25, conductorCallout: '', necReference: '' }] },
      { key: 'carport', totalModules: 9 },      // invalid key — dropped
      { key: 'roof', totalModules: 999 },       // duplicate — dropped
    ])!;
    expect(lanes.map(l => l.key)).toEqual(['roof', 'fence']);
    expect(lanes[1].totalModules).toBe(17);     // string-coerced
    expect(lanes[1].acOCPD).toBe(20);
    expect(lanes[0].backfeedAmps).toBe(90);
    expect(lanes[0].microBranches).toHaveLength(1);
  });

  it('returns undefined for non-arrays / empty / single-lane payloads', () => {
    expect(sanitizeClientSourceBranches(undefined)).toBeUndefined();
    expect(sanitizeClientSourceBranches('junk')).toBeUndefined();
    expect(sanitizeClientSourceBranches([])).toBeUndefined();
    expect(sanitizeClientSourceBranches([{ key: 'roof', totalModules: 10 }])).toBeUndefined();
    expect(sanitizeClientSourceBranches([{ key: 'x' }, { key: 'y' }])).toBeUndefined();
  });
});

// ═════ 6. Empty-fleet synthesis helper (W4B must-fix support) ═════════════════
describe('wave 5a — synthesizeFleetFromSubEquipment', () => {
  it('builds a one-inverter fleet from the sub\'s OWN equipment record', () => {
    const fleet = synthesizeFleetFromSubEquipment('fence',
      { inverterId: 'solfence-sf-opt-3800', topology: 'optimizer', panelId: 'solfence-sf-bif-400' }, 17)!;
    expect(fleet).toHaveLength(1);
    expect(fleet[0].inverterId).toBe('solfence-sf-opt-3800');
    expect(fleet[0].type).toBe('optimizer');
    expect(fleet[0].subSystemKey).toBe('fence');
    expect(fleet[0].strings[0].panelCount).toBe(17);
    expect(fleet[0].strings[0].panelId).toBe('solfence-sf-bif-400');
  });

  it('no inverterId / no panels ⇒ null (caller excludes the sub + shows a hint — never a phantom default)', () => {
    expect(synthesizeFleetFromSubEquipment('ground', { panelId: 'x' }, 20)).toBeNull();
    expect(synthesizeFleetFromSubEquipment('ground', undefined, 20)).toBeNull();
    expect(synthesizeFleetFromSubEquipment('ground', { inverterId: 'solis-s6' }, 0)).toBeNull();
  });

  it('unknown topology falls back to string, never micro', () => {
    const fleet = synthesizeFleetFromSubEquipment('ground', { inverterId: 'solis-s6', topology: 'weird' }, 8)!;
    expect(fleet[0].type).toBe('string');
  });
});
