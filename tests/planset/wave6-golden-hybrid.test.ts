// ============================================================================
// Wave 6 — GOLDEN 3-BRAND HYBRID FIXTURE (the contract's acceptance case).
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 6 + §2 invariants.
//
// Enphase IQ8 micro ROOF (48 × Canadian Solar CS6R-430MS)
//   + Solis string GROUND (26 × Tesla TSP-420, 2 strings × 13)
//   + SolFence optimizer FENCE (17 × SolFence SF-BIF-400)
// — three DIFFERENT panel models, three ecosystems, ONE point of
// interconnection — rendered END-TO-END through generatePermitHTML (real CAD
// engine, real manifest, real multi-lane E-1) plus the BOM engine's hybrid
// path with a SolFence/Tigo OPTIMIZER fence (I-3: fence topology from its
// OWN equipment).
//
// This suite is the CI backing for hybridReadiness.WAVE6_GOLDEN_FIXTURE_GREEN
// (the banner-retirement gate's third condition).
// ============================================================================
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { generateBOMV4, type BOMGenerationInputV4 } from '@/lib/bom-engine-v4';
import { hybridSubmissionGate, WAVE6_GOLDEN_FIXTURE_GREEN } from '@/lib/permit/sections/hybridReadiness';
import { SOLFENCE_MOUNTING_ID, synthesizeFromLegacyScalars, type SubSystemEquipment, type SubSystemKey } from '@/lib/system/subSystemEquipment';
import { RACKING_SYSTEMS } from '@/lib/equipment-db';
import { roofProject } from '../../test-fixtures/roofProject';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const count = (s: string, needle: string): number => s.split(needle).length - 1;

// ── The golden partition: 48 roof / 26 ground / 17 fence = 91 modules ───────
const ROOF_N = 48, GROUND_N = 26, FENCE_N = 17;

function buildGoldenPanels() {
  const panels: any[] = [];
  // Roof: 12 cols × 4 rows inside the fixture's roof plane.
  for (let i = 0; i < ROOF_N; i++) {
    panels.push({
      id: `roof-${i + 1}`,
      lat: 33.4484 + Math.floor(i / 12) * 0.00002,
      lng: -112.0740 + (i % 12) * 0.00002,
      x: (i % 12) * 1.1, y: Math.floor(i / 12) * 1.8,
      tilt: 22, azimuth: 180, wattage: 430,
      row: Math.floor(i / 12), col: i % 12,
      systemType: 'roof', orientation: 'portrait',
    });
  }
  // Ground: 2 rows × 13, south of the house.
  for (let i = 0; i < GROUND_N; i++) {
    panels.push({
      id: `ground-${i + 1}`,
      lat: 33.4480 + Math.floor(i / 13) * 0.00003,
      lng: -112.0741 + (i % 13) * 0.00002,
      x: (i % 13) * 1.1, y: 30 + Math.floor(i / 13) * 2.5,
      tilt: 25, azimuth: 180, wattage: 420,
      row: Math.floor(i / 13), col: i % 13,
      systemType: 'ground', orientation: 'landscape',
    });
  }
  // Fence: one collinear run along the property line.
  for (let i = 0; i < FENCE_N; i++) {
    panels.push({
      id: `fence-${i + 1}`,
      lat: 33.4478, lng: -112.0742 + i * 0.00001,
      x: i * 1.1, y: 50,
      tilt: 90, azimuth: 90, wattage: 400,
      row: 0, col: i,
      systemType: 'fence', placementType: 'FENCE', orientation: 'portrait',
    });
  }
  return panels;
}

/** The golden PermitInput: 3 brands, 3 panel models, tagged per-sub fleets. */
function mkGolden() {
  const input: any = clone(roofProject);
  input.project.projectName = 'Golden-Hybrid-Wave6';
  input.project.panelPositions = buildGoldenPanels();
  input.layout.panels = buildGoldenPanels();
  input.system.totalPanels = ROOF_N + GROUND_N + FENCE_N;                  // 91
  input.system.totalDcKw = (ROOF_N * 430 + GROUND_N * 420 + FENCE_N * 400) / 1000; // 38.36
  input.system.totalAcKw = ROOF_N * 0.33 + 8.0 + 3.8;                     // 27.64
  input.system.inverters = [
    {
      manufacturer: 'Enphase', model: 'IQ8M', type: 'micro',
      acOutputKw: 0.33, maxDcVoltage: 60, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'roof',
      strings: [{
        label: 'R-1', panelCount: ROOF_N, panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
        panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, isc: 13.85,
        wireGauge: '#10 AWG', wireLength: 45,
      }],
    },
    {
      manufacturer: 'Solis', model: 'S6-GR1P8K', type: 'string',
      acOutputKw: 8.0, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'ground',
      strings: [
        { label: 'G-1', panelCount: 13, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
          panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03,
          wireGauge: '#10 AWG', wireLength: 80 },
        { label: 'G-2', panelCount: 13, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
          panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03,
          wireGauge: '#10 AWG', wireLength: 80 },
      ],
    },
    {
      manufacturer: 'SolFence', model: 'SF-OPT-3800', type: 'optimizer',
      acOutputKw: 3.8, maxDcVoltage: 480, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'fence',
      strings: [{
        label: 'F-1', panelCount: FENCE_N, panelManufacturer: 'SolFence', panelModel: 'SF-BIF-400',
        panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6, isc: 13.6,
        wireGauge: '#10 AWG', wireLength: 60,
      }],
    },
  ];
  return input;
}

// One expensive render, shared by every suite below. generatePermitHTML
// mutates its input (stores per-sub structural runs) — keep the reference.
const goldenInput = mkGolden();
const html = generatePermitHTML(goldenInput);

const pageSeq = (h: string) =>
  [...h.matchAll(/class="tb-sheet-id">([^<]+)</g)].map(m => m[1].trim());

/** The one rendered page whose title block carries the given sheet id. */
function pageById(h: string, id: string): string {
  const chunks = h.split(/<div class="page(?:\s[^"]*)?">/);
  const hit = chunks.find(c => c.includes(`class="tb-sheet-id">${id}<`));
  expect(hit, `no rendered page with sheet id ${id}`).toBeTruthy();
  return hit as string;
}

// ═════ 0. Canonical SolFence id pin (Wave 6.1 constant ↔ equipment-db) ═══════
describe('wave 6 golden — canonical SolFence mounting id', () => {
  it('equipment-db carries the id the synthesis constant mirrors', () => {
    const entry = RACKING_SYSTEMS.find((m: any) => m.id === SOLFENCE_MOUNTING_ID) as any;
    expect(entry, `equipment-db entry ${SOLFENCE_MOUNTING_ID}`).toBeTruthy();
    expect(entry.systemType).toBe('fence');
    expect(entry.manufacturer).toBe('SolFence');
  });

  it('fence synthesis forces it; roof/ground keep the legacy scalar', () => {
    const cfg = { systemType: 'fence', mountingId: 'rooftech-mini', inverters: [] };
    expect(synthesizeFromLegacyScalars(cfg, 'fence').mountingId).toBe(SOLFENCE_MOUNTING_ID);
    expect(synthesizeFromLegacyScalars(cfg, 'roof').mountingId).toBe('rooftech-mini');
    expect(synthesizeFromLegacyScalars(cfg, 'ground').mountingId).toBe('rooftech-mini');
  });
});

// ═════ 1. Manifest — every per-sub sheet present, reading order kept ═════════
describe('wave 6 golden — sheet manifest', () => {
  const seq = pageSeq(html);
  const at = (id: string) => seq.indexOf(id);

  it('contains ALL sub sheets: PV-1G/PV-1F/PV-1BG/PV-1BF/PV-3G/PV-3F/PE-1G/PE-1F', () => {
    for (const id of ['PV-0', 'PV-1', 'PV-1G', 'PV-1F', 'PV-1B', 'PV-1BG', 'PV-1BF',
                      'PV-4A', 'PV-4B', 'E-1', 'PV-3', 'PV-3G', 'PV-3F',
                      'PE-1', 'PE-1G', 'PE-1F']) {
      expect(seq, `missing ${id} in ${seq.join(',')}`).toContain(id);
    }
  });

  it('reading order: plans → circuits → electrical → structural → letters', () => {
    expect(at('PV-1')).toBeLessThan(at('PV-1G'));
    expect(at('PV-1G')).toBeLessThan(at('PV-1F'));
    expect(at('PV-1BF')).toBeLessThan(at('PV-4A'));
    expect(at('E-1')).toBeLessThan(at('PV-3'));
    expect(at('PE-1')).toBeLessThan(at('PE-1G'));
    expect(at('PE-1G')).toBeLessThan(at('PE-1F'));
  });
});

// ═════ 2. Cover — 3 kW lines + 3 module rows + retired banner ════════════════
describe('wave 6 golden — cover sheet', () => {
  it('HYBRID headline + one kW line per sub with the sub\'s OWN equipment', () => {
    expect(html).toContain('HYBRID: ROOF + GROUND + FENCE PHOTOVOLTAIC SYSTEM');
    // Per-sub dcKw prorates the project total by panel count on the CAD
    // sections — assert the counts + equipment exactly, the kW loosely.
    expect(html).toMatch(/ROOF — [\d.]+ kW DC · 48 MODULES · .*ENPHASE IQ8M \(MICROINVERTER\)/);
    expect(html).toMatch(/GROUND — [\d.]+ kW DC · 26 MODULES · .*SOLIS S6-GR1P8K \(STRING INVERTER\)/);
    expect(html).toMatch(/FENCE — [\d.]+ kW DC · 17 MODULES · .*SOLFENCE SF-OPT-3800 \(POWER OPTIMIZER\)/);
  });

  it('SYSTEM SUMMARY: three module rows at subset counts, three DIFFERENT models', () => {
    expect(html).toMatch(/48 × Canadian Solar CS6R-430MS.* — ROOF/);
    expect(html).toMatch(/26 × Tesla TSP-420.* — GROUND/);
    expect(html).toMatch(/17 × SolFence SF-BIF-400.* — FENCE/);
    expect(html).not.toMatch(/91 × Canadian Solar/);   // never a project-wide winner row
  });

  it('Wave 6.3 gate PASSES: banner retired, neutral hybrid note in its place', () => {
    expect(html).toContain('HYBRID MULTI-SYSTEM SET — PER-SUB-SYSTEM DOCUMENTATION');
    expect(html).toContain('PER-SUB-SYSTEM STRUCTURAL &amp; ELECTRICAL AUTHORITY VERIFIED');
    expect(html).not.toContain('DO NOT SUBMIT');
    expect(html).not.toContain('HYBRID DESIGN — THIS SET IS NOT PERMIT-READY');
  });
});

// ═════ 3. E-1 — 3 lanes, ONE POI, Σ backfeed = Σ per-inverter OCPDs ══════════
describe('wave 6 golden — multi-lane E-1', () => {
  const e1 = pageById(html, 'E-1');

  it('renders the REAL multi-lane artifact with 3 lanes in fixed order', () => {
    expect(e1).toContain('SLD MULTI-LANE wave5a lanes=3 keys=roof+ground+fence');
    expect(count(e1, 'PV ARRAY PV-R')).toBe(1);
    expect(count(e1, 'PV ARRAY PV-G')).toBe(1);
    expect(count(e1, 'SOLAR FENCE ARRAY PV-F')).toBe(1);
    expect(e1).toContain('48 × IQ8M');
  });

  it('joins at ONE POI with one service tail (I-6)', () => {
    expect(count(e1, 'MAIN SERVICE PANEL')).toBe(1);
    expect(count(e1, 'UTILITY METER')).toBe(1);
    expect(count(e1, 'UTILITY GRID')).toBe(1);
  });

  it('Σ backfeed equals the sum of the per-lane contributions (§1.7)', () => {
    const sigma = /Σ BACKFEED (\d+)A — NEC 705\.12\(B\) \(Σ PER-INVERTER OCPDs\)/.exec(e1);
    expect(sigma, 'Σ BACKFEED marker').toBeTruthy();
    const lanes = ['PV-R', 'PV-G', 'PV-F'].map(tag => {
      const m = new RegExp(`${tag}: (\\d+)A`).exec(e1);
      expect(m, `${tag} contribution row`).toBeTruthy();
      return Number(m![1]);
    });
    expect(Number(sigma![1])).toBe(lanes[0] + lanes[1] + lanes[2]);
    expect(e1).toContain('Σ per-inverter rounded OCPDs');
  });

  it('rapid shutdown note scopes to the ROOF lane only (I-7)', () => {
    expect(e1).toContain('RAPID SHUTDOWN — NEC 690.12 (ROOF ARRAY PV-R)');
  });
});

// ═════ 4. PV-4A / PV-4B — per-sub schedules at the golden counts ═════════════
describe('wave 6 golden — electrical sheets', () => {
  it('PV-4A: one circuit schedule per sub, each from its OWN equipment (I-3)', () => {
    expect(html).toMatch(/AC Branch Circuit Schedule — ROOF — 48 MODULES — Enphase IQ8M \(MICRO\)/);
    expect(html).toMatch(/DC String Schedule — GROUND — 26 MODULES — Solis S6-GR1P8K \(STRING\)/);
    expect(html).toMatch(/DC String Schedule — FENCE — 17 MODULES — SolFence SF-OPT-3800 \(OPTIMIZER\)/);
  });

  it('no micro branch spans more than the roof sub\'s own 48 devices (I-4)', () => {
    const counts = [...html.matchAll(/(\d+) × microinverter/gi)].map(m => Number(m[1]));
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeLessThanOrEqual(ROOF_N);
  });

  it('PV-4B: per-sub feeders + ONE shared POI section + shared-trench note', () => {
    expect(html).toContain('ROOF AC Feeder');
    expect(html).toContain('GROUND AC Feeder');
    expect(html).toContain('FENCE AC Feeder');
    expect(html).toContain('SHARED SERVICE — POINT OF INTERCONNECTION (NEC 705)');
    // Addendum B: ground+fence coexist ⇒ shared trench, SEPARATE conduits.
    expect(html).toContain('SHARED TRENCH / SEPARATE CONDUITS (HYBRID)');
  });
});

// ═════ 5. PV-1F punch items — SolFence branding, real wind, own plan inset ═══
describe('wave 6 golden — PV-1F fence sheet (Wave 6.1/6.2 punch items)', () => {
  const pv1f = pageById(html, 'PV-1F');

  it('punch 1a: fence system is SolFence — the roof racking never prints', () => {
    expect(pv1f).toContain('FENCE SYSTEM: SOLFENCE VERTICAL SECTION SYSTEM');
    expect(pv1f).toContain('SOLFENCE VERTICAL SECTION SYSTEM');
    expect(pv1f).not.toContain('ROOF TECH');
    expect(pv1f).not.toContain('RT-MINI');
    expect(pv1f).not.toContain('IRONRIDGE');
    expect(pv1f).not.toContain('IronRidge');
  });

  it('punch 1b: WIND callout + schedule row agree with FENCE DATA (real design wind)', () => {
    expect(pv1f).toContain('WIND 115 MPH');
    expect(pv1f).toContain('WIND LOAD — 115 MPH (ASCE 7-22)');
    expect(pv1f).toContain('115 MPH Vult');
    expect(pv1f).not.toContain('WIND 90 MPH');
    expect(pv1f).not.toContain('90 MPH');
  });

  it('punch 1b: without ahj wind, the compliance design wind binds (never 90)', () => {
    const alt = mkGolden();
    delete alt.project.ahjWindSpeedMph;
    (alt.compliance.structural.wind as any).windSpeed = 105;
    const altHtml = generatePermitHTML(alt);
    const altPv1f = pageById(altHtml, 'PV-1F');
    expect(altPv1f).toContain('WIND 105 MPH');
    expect(altPv1f).not.toContain('WIND 90 MPH');
  });

  it('punch 1c: the SEGMENT PLAN inset is the fence\'s OWN plan, not the site plan', () => {
    expect(pv1f).toContain('SEGMENT PLAN — TOP VIEW');
    expect(pv1f).toContain('FENCE SEGMENT SCHEDULE');            // drawFencePlan marker
    expect(pv1f).not.toContain('ROOF PLAN WITH MODULES');        // drawRoofPlan marker
    // PV-1 (the real site plan) still carries the roof site drawing.
    expect(pageById(html, 'PV-1')).toContain('ROOF PLAN WITH MODULES');
  });

  it('punch 1c: elevation reads as a TYPICAL 2-bay detail of the full run', () => {
    expect(pv1f).toContain('TYPICAL 2-BAY ELEVATION');
    expect(pv1f).toContain('L.F. TOTAL RUN');
    expect(pv1f).toMatch(/2 BAYS \(TYP\. OF .* RUN\)/);
  });
});

// ═════ 6. PE letters — subset params, never the project totals ═══════════════
describe('wave 6 golden — per-sub PE letters', () => {
  it('PE-1 (roof) certifies 48 roof modules with roof equipment', () => {
    const p = pageById(html, 'PE-1');
    expect(p).toContain('Roof-Mounted Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">48</);
    expect(p).toContain('Canadian Solar CS6R-430MS');
    expect(p).not.toMatch(/Total Modules<\/td><td class="iv">91</);
  });

  it('PE-1G (ground) certifies 26 ground modules', () => {
    const p = pageById(html, 'PE-1G');
    expect(p).toContain('Ground Mount Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">26</);
    expect(p).toContain('Tesla TSP-420');
    expect(p).not.toContain('IronRidge');
  });

  it('PE-1F (fence) certifies 17 fence modules — no roof racking, no 91', () => {
    const p = pageById(html, 'PE-1F');
    expect(p).toContain('Solar Fence Array');
    expect(p).toMatch(/Total Modules<\/td><td class="iv">17</);
    expect(p).toContain('SolFence SF-BIF-400');
    expect(p).not.toContain('IronRidge');
    expect(p).not.toMatch(/Total Modules<\/td><td class="iv">91</);
  });
});

// ═════ 7. Structural authority — one V4 run per sub stored on the input ══════
describe('wave 6 golden — per-sub structural authority', () => {
  it('compliance.structural.subSystems carries all three runs (RSD basis)', () => {
    const subs = (goldenInput.compliance?.structural as any)?.subSystems ?? {};
    expect(Object.keys(subs).sort()).toEqual(['fence', 'ground', 'roof']);
  });

  it('hybridSubmissionGate: ready on this input; lists missing authority otherwise', () => {
    const cad = generateCADLayout(goldenInput) as any;
    expect(WAVE6_GOLDEN_FIXTURE_GREEN).toBe(true);
    const ready = hybridSubmissionGate(goldenInput, cad);
    expect(ready.ready).toBe(true);
    expect(ready.missing).toEqual([]);
    expect(ready.presentKeys).toEqual(['roof', 'ground', 'fence']);
    // Strip the structural authority ⇒ gate FAILS and names each missing sub.
    const stripped = { ...goldenInput, compliance: { ...goldenInput.compliance, structural: { ...goldenInput.compliance.structural, subSystems: { roof: {} } } } };
    const notReady = hybridSubmissionGate(stripped as any, cad);
    expect(notReady.ready).toBe(false);
    expect(notReady.missing.join(' ')).toContain('GROUND structural analysis');
    expect(notReady.missing.join(' ')).toContain('FENCE structural analysis');
    expect(notReady.missing.join(' ')).not.toContain('ROOF structural analysis');
  });
});

// ═════ 8. BOM — 3 module lines, per-brand trunk/BOS, ONE Stage-4, RSD scoped ═
describe('wave 6 golden — hybrid BOM (SolFence/Tigo OPTIMIZER fence, I-3)', () => {
  const NOW = '2026-07-12T00:00:00.000Z';
  const sub = (key: SubSystemKey, over: Partial<SubSystemEquipment>): SubSystemEquipment =>
    ({ key, source: 'engineering', updatedAt: NOW, ...over });

  const bom = generateBOMV4({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 91, deviceCount: 48, stringCount: 3, inverterCount: 50,
    systemKw: 38.36, acOutputKw: 27.64,
    dcWireGauge: '#10 AWG', acWireGauge: '#6 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 96, railSections: 24,
    mainPanelAmps: 200, backfeedAmps: 0, acOCPD: 60, dcOCPD: 30,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    includeTruckStock: false, includeSuggestedTools: false,
    subSystemCounts: { roof: ROOF_N, ground: GROUND_N, fence: FENCE_N },
    roofStringCount: 5,
    subSystemEquipment: {
      roof: sub('roof', {
        panelId: 'rec-alpha-pure-r-405', inverterId: 'enphase-iq8plus',
        topology: 'micro', ecosystemBrand: 'enphase',
        mountingId: 'ironridge-xr100', roofType: 'shingle',
        env: { rooftopTempAdderC: 30 },
      }),
      ground: sub('ground', {
        panelId: 'qcells-q-peak-duo-400', inverterId: 'solis-s6-eh1p-7p6k-us',
        topology: 'string', ecosystemBrand: 'solis',
        trenchRunLengthFt: 80, env: { rooftopTempAdderC: 0, wireLengthFt: 120 },
      }),
      fence: sub('fence', {
        panelId: 'panel-fence-ps1', inverterId: 'solis-s6-eh1p-5k-us',
        optimizerId: 'tigo-ts4-a-o', topology: 'optimizer',
        mountingId: SOLFENCE_MOUNTING_ID,
        trenchRunLengthFt: 40, env: { rooftopTempAdderC: 0, wireLengthFt: 60 },
      }),
    },
  } as BOMGenerationInputV4);

  it('THREE module lines at subset counts (48/26/17), each stamped', () => {
    const panels = bom.items.filter(i => i.category === 'solar_panel');
    expect(panels.map(p => `${p.subSystem}|${p.quantity}`)).toEqual([
      `roof|${ROOF_N}`, `ground|${GROUND_N}`, `fence|${FENCE_N}`,
    ]);
  });

  it('per-brand trunk: Enphase Q-cable sized to the roof\'s 48 devices, never 91', () => {
    const trunk = bom.items.filter(i => i.category === 'trunk_cable');
    expect(trunk).toHaveLength(1);
    expect(trunk[0].quantity).toBe(ROOF_N);
    expect(trunk[0].subSystem).toBe('roof');
  });

  it('fence topology from ITS OWN equipment: 17 Tigo optimizers, zero RSD add-ons', () => {
    const opt = bom.items.filter(i => i.category === 'optimizer');
    expect(opt).toHaveLength(1);
    expect(opt[0].quantity).toBe(FENCE_N);
    expect(opt[0].subSystem).toBe('fence');
    // IQ8 roof integrated + ground/fence off-building ⇒ no add-on RSD anywhere.
    expect(bom.items.filter(i => i.category === 'rapid_shutdown')).toHaveLength(0);
  });

  it('ONE Stage-4 service set on aggregate values (I-6)', () => {
    const acDiscos = bom.items.filter(i => i.stageId === 'ac' && i.category === 'disconnect');
    expect(acDiscos).toHaveLength(1);
    expect(acDiscos[0].subSystem).toBeUndefined();
    expect(bom.items.filter(i => i.partNumber === 'GR-5/8-8')).toHaveLength(1);
  });

  it('shared trench: ONE combined-trench note, separate per-sub conduits (Addendum B)', () => {
    expect(bom.complianceNotes.join(' ')).toContain('share ONE combined trench');
    const pvc = bom.items.filter(i => i.model.includes('PVC Sch 40'));
    expect(pvc.map(p => p.subSystem).sort()).toEqual(['fence', 'ground']);
  });
});

// ═════ 9. SCHED — per-sub module rows at golden counts ═══════════════════════
describe('wave 6 golden — equipment schedule', () => {
  it('module table: per-sub rows with a System column (one row per string)', () => {
    expect(html).toContain('Solar Modules — per sub-system (hybrid)');
    expect(html).toMatch(/<td class="fw7">ROOF<\/td>\s*<td>Canadian Solar<\/td><td>CS6R-430MS<\/td>\s*<td class="tr fw7">48<\/td>/);
    // Ground fleet = 2 strings × 13 → TWO Tesla rows of 13.
    const groundRows = html.match(/<td class="fw7">GROUND<\/td>\s*<td>Tesla<\/td><td>TSP-420<\/td>\s*<td class="tr fw7">13<\/td>/g) ?? [];
    expect(groundRows).toHaveLength(2);
    expect(html).toMatch(/<td class="fw7">FENCE<\/td>\s*<td>SolFence<\/td><td>SF-BIF-400<\/td>\s*<td class="tr fw7">17<\/td>/);
  });
});
