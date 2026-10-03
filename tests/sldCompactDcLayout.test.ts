// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE DC-COUPLED SERVICE SECTION, COMPACT AND TOP DOWN — gauntlet step 10.
//
// Ray, on the live 400 A sheet: "much better architecturally but too spread out and visually
// primitive on the storage side... Do not leave huge whitespace because an inverter block was
// removed." His target, conceptually:
//
//            PV ARRAY  37 × 440 W  16.28 kW
//                      │
//                PW3 PV INPUTS
//                 /          \
//          GEN PANEL A      GEN PANEL B
//           PW3 #1 PW3 #2    PW3 #3 PW3 #4
//              │                 │
//          GATEWAY #1        GATEWAY #2
//              │                 │
//            MSP #1            MSP #2
//                 \           /
//                 400 A SERVICE → METER → UTILITY
//
// What this file holds the renderer to — requirements, not coordinates:
//
//   · the layout is CHOSEN only for a DC-coupled graph with domains (the gate), and every other sheet
//     is byte-identical (tests/sldNonDcSheetsUnchanged.test.ts);
//   · the audit finds ZERO overlaps or overflows on Ray's job and on the ordinary 200 A residence,
//     on every PV-chain variant and in the E-1 embed — measured on the REAL render, including where
//     the fitted drawing lands against the legend and the rapid-shutdown note;
//   · the PV array is ABOVE the systems, the systems are SIDE BY SIDE, each column runs storage →
//     generation panel → gateway → MSP, and the branches converge on the service equipment with the
//     service chain under it;
//   · no empty band crosses the drawing, in either direction;
//   · a DC conductor reaches ONLY the cabinets the design lands PV on, and none when nothing is
//     recorded (the trunk then ends at "STRING LANDING TO BE ASSIGNED");
//   · each utility isolation switch is drawn IN its own branch feeder, between its gateway and the
//     service equipment.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  renderSLDProfessional, renderTopologyServiceSection, auditServiceSectionLayout,
  compactDcServiceLayoutApplies, type SLDProfessionalInput, type ServiceSectionBox,
} from '@/lib/sld-professional-renderer';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import {
  addBackupDomain, addProtectiveDevice, placeDevice, removeBackupDomain, setStoragePvInput,
} from '@/lib/electrical/topologyAuthoring';
import { buildServiceFromPreset } from '@/lib/electrical/topologyPresets';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

// ── fixtures ────────────────────────────────────────────────────────────────

/** Ray's job as it reaches the renderer: 37 × 440 W, DC coupled, no PV inverter. */
const RAY = {
  projectName: 'RAY 400A TWO SYSTEMS', clientName: 'Ray', address: 'Chicago IL',
  designer: 'SolarPro', drawingDate: '2026-10-03', drawingNumber: 'E-1', revision: 'A',
  scale: 'NOT TO SCALE',
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 37, totalStrings: 0, deviceCount: 37,
  panelModel: 'Philadelphia Solar PS-M108-440', panelWatts: 440, panelVoc: 39.5, panelIsc: 13.9,
  dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
  inverterModel: 'NONE', inverterManufacturer: 'Tesla',
  acOutputKw: 46.08, acOutputAmps: 192, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const STRING_INT = { topologyType: 'STRING', ecosystemTopology: 'string', selectedBrand: 'solaredge',
  integratedDcDisconnect: true, totalStrings: 2, deviceCount: 2 };
const STRING_EXT = { ...STRING_INT, integratedDcDisconnect: false };
const E1 = { suppressTitleBlock: true, suppressScheduleBand: true, suppressCalcBand: true };

const raysJob = () => buildRaysIntendedJob().topology;
/** Ray's job with the landing RECORDED: 8.36 kW on PW3 #1, 7.92 kW on PW3 #3, nothing on the others. */
const raysLanded = (): ServiceTopology => {
  const t = raysJob();
  const inv = t.storage.filter(u => u.role === 'inverter-unit');
  let out = t;
  inv.forEach((u, k) => { out = setStoragePvInput(out, u.id, k === 0 ? 8.36 : k === 2 ? 7.92 : 0); });
  return out;
};
const normal = (powerwalls: number) => buildNormalResidence200A({ powerwalls }).topology;

/** The guided-builder job with an Expansion per system and two devices on the service chain. */
const presetDcJob = (): ServiceTopology => {
  let t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
  for (const p of t.panels) {
    const branch = t.branches.find(b => (b.panelIds ?? []).includes(p.id))!;
    t = addBackupDomain(t, { branchId: branch.id, panelIds: [p.id],
      gatewayProductId: 'tesla-backup-gateway-3', storageProductIds: ['tesla-powerwall-3'],
      expansionProductIds: ['tesla-powerwall-3-expansion'] }).topology;
  }
  t = addProtectiveDevice(t, { label: '400 A service disconnect', roles: ['service-disconnect'],
    ratedAmps: 400, lockableOpen: true, locationNote: 'Ahead of the service distribution.' }).topology;
  t = addProtectiveDevice(t, { label: 'Utility DER isolation disconnect',
    roles: ['der-isolation-disconnect'], ratedAmps: 400, lockableOpen: true, visibleOpen: true,
    locationNote: 'Adjacent to the revenue meter.' }).topology;
  return { ...t, solarCoupling: 'dc-coupled-storage' };
};

/** Every log line one render writes, with the render's own output discarded. */
const logsOf = (input: Record<string, unknown>) => {
  const lines: string[] = [];
  const log = console.log, warn = console.warn, error = console.error;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  console.warn = () => {}; console.error = () => {};
  let svg = '';
  try { svg = renderSLDProfessional(input as unknown as SLDProfessionalInput); }
  finally { console.log = log; console.warn = warn; console.error = error; }
  return { svg, lines };
};

// ── the section, laid out directly ──────────────────────────────────────────

/**
 * The compact section as the sheet asks for it: the region inside the schematic border above the
 * calc tables, and a PV group the size the renderer measures for this array (array, junction box,
 * their callouts and the J-box ground rail).
 */
const compactSection = (t: ServiceTopology) => renderTopologyServiceSection({
  topology: t,
  startX: 710, endX: 1974, busY: 479, minY: 100, maxY: 1070,
  utilityName: 'ComEd', calloutStart: 7, hasGenerator: false,
  notes: { x: 70, y: 715, w: 600, maxY: 1060 },
  compactDc: {
    region: { x0: 56, x1: 1974, y0: 92, y1: 1080 },
    pvBlock: { w: 482, h: 244, outDx: 458, outDy: 112 },
    totalStrings: 0, dcWireGauge: '#10', dcConduitType: 'EMT',
  },
});
const SHEET_BOUNDS = { minX: 40, maxX: 1994, minY: 80, maxY: 1090 };

const box = (s: { boxes: ServiceSectionBox[] }, id: string) => {
  const b = s.boxes.find(x => x.id === id);
  if (!b) throw new Error(`no box '${id}'`);
  return b;
};
const boxesWith = (s: { boxes: ServiceSectionBox[] }, prefix: string) =>
  s.boxes.filter(b => b.id.startsWith(prefix));
const cx = (b: ServiceSectionBox) => b.x + b.w / 2;
const cy = (b: ServiceSectionBox) => b.y + b.h / 2;

/** The widest strip, along one axis, that no box crosses — between the first box and the last. */
const widestEmptyBand = (boxes: ServiceSectionBox[], axis: 'x' | 'y') => {
  const iv = boxes.map(b => (axis === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h]))
    .sort((a, b) => a[0] - b[0]);
  let reach = iv[0][1], widest = 0;
  for (const [a, b] of iv.slice(1)) {
    widest = Math.max(widest, a - reach);
    reach = Math.max(reach, b);
  }
  return widest;
};

/** Every DC-coloured conductor's end points in a section's ink. */
const dcLines = (svg: string) => [...svg.matchAll(
  /<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" stroke="#E65100"/g)]
  .map(m => m.slice(1, 5).map(Number));

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the compact layout is chosen for a DC-coupled graph with domains, and for nothing else', () => {
  it('takes Ray\'s job, the ordinary 200 A residence and the guided-builder job', () => {
    expect(compactDcServiceLayoutApplies(raysJob())).toBe(true);
    expect(compactDcServiceLayoutApplies(normal(1))).toBe(true);
    expect(compactDcServiceLayoutApplies(normal(2))).toBe(true);
    expect(compactDcServiceLayoutApplies(presetDcJob())).toBe(true);
  });

  it('refuses every graph that is not DC coupled, or has no domain', () => {
    expect(compactDcServiceLayoutApplies(null)).toBe(false);
    expect(compactDcServiceLayoutApplies(buildRaysIntendedJob({ solarCoupling: 'ac-coupled-inverter' }).topology)).toBe(false);
    expect(compactDcServiceLayoutApplies(buildTesla400ATwoGateway().topology)).toBe(false);   // unrecorded
    const t = normal(1);
    expect(compactDcServiceLayoutApplies(removeBackupDomain(t, t.domains[0].id))).toBe(false);
  });

  it('refuses the DC shapes it cannot draw without inventing a connection', () => {
    // A site-wide DER aggregation group belongs to the shared chain the column layout draws.
    const shared = buildTesla400ATwoGateway({ derArrangement: 'common-aggregation', solarCoupling: 'dc-coupled-storage' }).topology;
    expect(compactDcServiceLayoutApplies(shared)).toBe(false);
    // So does a device placed on a DER path.
    const t = raysJob();
    const svc = t.devices.find(d => d.roles.includes('service-disconnect'))!;
    expect(compactDcServiceLayoutApplies(placeDevice(t, svc.id, t.domains[0].gateway.id))).toBe(false);
    // Three inverting units and an Expansion on one system: the harness would cross a cabinet.
    const crowded = buildRaysIntendedJob({ powerwallsPerSystem: 3, expansionsPerSystem: 1, generationPanelPerSystem: false }).topology;
    expect(compactDcServiceLayoutApplies(crowded)).toBe(false);
  });
});

describe('🚨 zero overlaps and overflows, measured on the REAL render', () => {
  const variants: Array<[string, Record<string, unknown>]> = [
    ['Ray / micro inputs', { ...RAY, serviceTopology: raysJob() }],
    ['Ray / string + integrated DC disconnect', { ...RAY, ...STRING_INT, serviceTopology: raysJob() }],
    ['Ray / string + external DC disconnect', { ...RAY, ...STRING_EXT, serviceTopology: raysJob() }],
    ['Ray / E-1 embed', { ...RAY, ...E1, serviceTopology: raysJob() }],
    ['Ray / landing recorded', { ...RAY, serviceTopology: raysLanded() }],
    ['Ray / one PW3 + one Expansion per system',
      { ...RAY, serviceTopology: buildRaysIntendedJob({ powerwallsPerSystem: 1, expansionsPerSystem: 1, generationPanelPerSystem: false }).topology }],
    ['guided-builder job / two chain devices', { ...RAY, serviceTopology: presetDcJob() }],
    ['200 A residence, 1 PW3', { ...RAY, totalModules: 20, serviceTopology: normal(1) }],
    ['200 A residence, 2 PW3', { ...RAY, totalModules: 20, serviceTopology: normal(2) }],
    ['200 A residence, 2 PW3 / E-1 embed', { ...RAY, ...E1, totalModules: 20, serviceTopology: normal(2) }],
  ];
  for (const [name, input] of variants) {
    it(name, () => {
      const { lines } = logsOf(input);
      const budget = lines.filter(l => l.includes('[SLD SERVICE SECTION BUDGET]'));
      expect(budget, 'the section reports its budget once').toHaveLength(1);
      expect(budget[0], 'the compact layout drew this sheet').toContain('layout=compact-dc');
      expect(budget[0]).toContain('defects=0');
      // Includes the post-fit checks against the LEGEND, the RAPID SHUTDOWN note and the border.
      expect(lines.filter(l => l.includes('LAYOUT DEFECT'))).toEqual([]);
    });
  }

  it('the section audit is clean for Ray\'s job and the 200 A residence, laid out directly', () => {
    for (const t of [raysJob(), raysLanded(), normal(1), normal(2), presetDcJob()]) {
      expect(auditServiceSectionLayout(compactSection(t).boxes, SHEET_BOUNDS)).toEqual([]);
    }
  });
});

describe('🚨 the shape Ray asked for: PV on top, systems side by side, converging on the service', () => {
  const s = compactSection(raysJob());
  const t = raysJob();
  const [gw1, gw2] = t.domains.map(d => box(s, `gateway-${d.gateway.id}`));
  const dist = box(s, 'service-distribution');
  const pv = box(s, 'pv-array-and-junction-box');

  it('the PV array and junction box sit ABOVE every cabinet they feed', () => {
    for (const ess of boxesWith(s, 'ess-')) expect(pv.y + pv.h).toBeLessThan(ess.y);
    expect(s.pvBlockAt).toEqual({ x: pv.x, y: pv.y });
  });

  it('the two systems are side by side, with the service equipment between them', () => {
    expect(Math.abs(gw1.y - gw2.y)).toBeLessThan(1);
    expect(cx(gw1)).toBeLessThan(cx(dist));
    expect(cx(dist)).toBeLessThan(cx(gw2));
    expect(Math.abs(cy(dist) - cy(gw1))).toBeLessThan(dist.h / 2);
  });

  it('each column runs storage → generation panel → gateway → MSP, top down', () => {
    t.domains.forEach((d, i) => {
      const gw = i === 0 ? gw1 : gw2;
      const ess = d.storageUnitIds.map(id => box(s, `ess-${id}`));
      const gen = box(s, `aggregation-${t.aggregationPanels.find(a => a.domainId === d.id)!.id}`);
      const msp = box(s, `panel-${d.backedUpPanelIds[0]}`);
      for (const e of ess) expect(e.y + e.h).toBeLessThan(gen.y);
      expect(gen.y + gen.h).toBeLessThan(gw.y);
      expect(gw.y + gw.h).toBeLessThan(msp.y);
      // In the same column: every box of a system straddles its gateway's centre line.
      for (const b of [gen, msp]) expect(Math.abs(cx(b) - cx(gw))).toBeLessThan(1);
      expect(Math.min(...ess.map(e => e.x))).toBeLessThan(cx(gw));
      expect(Math.max(...ess.map(e => e.x + e.w))).toBeGreaterThan(cx(gw));
    });
  });

  it('the service chain drops under the service equipment: disconnect, meter, utility', () => {
    const svc = box(s, `device-${t.devices.find(d => d.roles.includes('service-disconnect'))!.id}`);
    const meter = box(s, 'revenue-meter');
    const grid = box(s, 'utility-grid');
    expect(dist.y + dist.h).toBeLessThan(svc.y);
    expect(svc.y + svc.h).toBeLessThan(meter.y);
    expect(meter.y + meter.h).toBeLessThan(grid.y);
    for (const b of [svc, meter, grid]) expect(Math.abs(cx(b) - cx(dist))).toBeLessThan(1);
  });

  it('🚨 each utility isolation switch is IN its own branch feeder, gateway side of the service', () => {
    const knives = t.devices.filter(d => d.inlineOnNodeId);
    expect(knives).toHaveLength(2);
    for (const k of knives) {
      const domainIdx = t.domains.findIndex(d => d.gateway.id === k.inlineOnNodeId
        || d.branchId === k.inlineOnNodeId || d.backedUpPanelIds.includes(k.inlineOnNodeId!));
      const gw = domainIdx === 0 ? gw1 : gw2;
      const tag = box(s, `inline-device-${k.id}`);
      const [lo, hi] = domainIdx === 0 ? [gw.x + gw.w, dist.x] : [dist.x + dist.w, gw.x];
      expect(tag.x).toBeGreaterThanOrEqual(lo);
      expect(tag.x + tag.w).toBeLessThanOrEqual(hi);
    }
  });

  it('🚨 no empty band runs across the drawing, either way', () => {
    // The defect Ray named: a gap left where an inverter used to be. Every strip of the section,
    // across and down, is crossed by something drawn. Across is measured UNDER the top band — the
    // notes block spans the top of the sheet and would otherwise hide a gap between the systems.
    for (const job of [raysJob(), raysLanded(), normal(1), normal(2), presetDcJob()]) {
      const sec = compactSection(job);
      const pv = box(sec, 'pv-array-and-junction-box');
      const systems = sec.boxes.filter(b => b.y > pv.y + pv.h);
      expect(widestEmptyBand(systems, 'x'), 'a vertical empty band through the systems').toBeLessThan(60);
      expect(widestEmptyBand(sec.boxes, 'y'), 'a horizontal empty band').toBeLessThan(60);
    }
  });
});

describe('🚨 a DC conductor goes only where the design lands PV', () => {
  it('nothing recorded: the trunk ends at "STRING LANDING TO BE ASSIGNED" and reaches no cabinet', () => {
    const s = compactSection(raysJob());
    expect(s.dcLandingUnassigned).toBe(true);
    expect(s.dcEntries).toEqual([]);
    expect(s.svg).toContain('STRING LANDING TO BE ASSIGNED');
    const tops = boxesWith(s, 'ess-').map(b => [cx(b), b.y]);
    const fed = tops.filter(([x, y]) => dcLines(s.svg).some(([, , x2, y2]) =>
      Math.abs(x2 - x) < 0.5 && Math.abs(y2 - y) < 0.5));
    expect(fed).toEqual([]);
  });

  it('landing recorded: exactly the units with PV get a DC drop, into their own tops', () => {
    const t = raysLanded();
    const s = compactSection(t);
    const landed = t.storage.filter(u => (u.pvDcStcKw ?? 0) > 0).map(u => u.id);
    expect(landed).toHaveLength(2);
    expect(s.dcLandingUnassigned).toBe(false);
    expect(s.svg).not.toContain('LANDING TO BE ASSIGNED');
    const fedIds = boxesWith(s, 'ess-').filter(b => dcLines(s.svg).some(([, , x2, y2]) =>
      Math.abs(x2 - cx(b)) < 0.5 && Math.abs(y2 - b.y) < 0.5)).map(b => b.id.slice('ess-'.length));
    expect(fedIds.sort()).toEqual([...landed].sort());
    expect(s.dcEntries.map(e => e.label).sort()).toEqual(['Tesla Powerwall 3 #1', 'Tesla Powerwall 3 #3']);
  });
});

describe('🚨 the rendered sheet keeps every fact, and the PV group really moved', () => {
  it('Ray\'s sheet states what the column layout stated', () => {
    const { svg } = logsOf({ ...RAY, serviceTopology: raysJob() });
    for (const fact of ['MSP #1', 'MSP #2', 'GENERATION PANEL — SYSTEM 1', 'GENERATION PANEL — SYSTEM 2',
      'EXISTING 400 A SERVICE EQUIPMENT', 'CONFIGURATION TO VERIFY', 'N-G BOND — NEC 250.24',
      'REVENUE METER', 'TO TESLA POWERWALL 3 PV INPUTS — DC COUPLED', 'STRING LANDING TO BE ASSIGNED',
      'SERVICE ENGINEERING — INPUT REQUIRED', '37 × 440W']) {
      expect(svg, fact).toContain(fact);
    }
    for (const n of [1, 2, 3, 4]) expect(svg).toContain(`Tesla Powerwall 3 #${n}`);
    expect((svg.match(/200 A CONTINUOUS/g) ?? []).length).toBe(2);
    expect((svg.match(/>200 A OCPD</g) ?? []).length).toBe(2);
    expect((svg.match(/BACKUP FEEDER — 200 A/g) ?? []).length).toBe(2);
    expect((svg.match(/LANDING TO BE ASSIGNED/g) ?? []).length).toBe(5);
    expect(svg).not.toContain('AC DISCONNECT');
    expect(svg).not.toContain('PV PV STRING');
  });

  it('the PV array is drawn above the Powerwalls on the sheet itself', () => {
    const { svg } = logsOf({ ...RAY, serviceTopology: raysJob() });
    // The fit's scale group comes first; the PV group's own translation is the last one opened
    // before the array's name, and both are inside the same fit, so their y values compare directly.
    const pvGroupStart = svg.indexOf('>PV ARRAY<');
    const translations = [...svg.slice(0, pvGroupStart).matchAll(/<g transform="translate\((-?[\d.]+),(-?[\d.]+)\)">/g)];
    expect(translations.length, 'the PV group is wrapped in its own translation').toBeGreaterThan(0);
    const [, , dy] = translations[translations.length - 1].map(Number);
    const textY = (label: string) =>
      Number(new RegExp(`<text x="[\\d.-]+" y="([\\d.-]+)"[^>]*>${label}<`).exec(svg)![1]);
    const pw3Y = textY('Tesla Powerwall 3 #1');
    // The LOWEST line of the PV group — the module name under the array — clears the cabinets,
    // not merely its title.
    expect(textY('Philadelphia Solar PS-M108-440') + dy).toBeLessThan(pw3Y);
    // And the J-box's ground rail moved with it: its name is drawn in sheet coordinates by the
    // rail, outside the group, and it must not be left behind across the systems.
    expect(textY('EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43')).toBeLessThan(pw3Y);
  });
});
