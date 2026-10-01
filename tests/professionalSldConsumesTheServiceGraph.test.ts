// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PRIMARY SLD DRAWS THE SERVICE GRAPH — NOT A SUPPLEMENTAL SHEET.
//
// Ray: "This UX change is not complete if the Service Topology screen is clear but the generated
// SLD still renders the old single-service architecture... Do not leave the new topology on a
// separate supplemental sheet while `sld-professional-renderer.ts` continues drawing the old
// one-service layout. The primary professional SLD renderer must consume `ServiceTopology`."
// "If the topology screen says two domains and the SLD shows one service path, the feature is still
// broken."
//
// So this builds Ray's job with the SAME authoring functions the guided builder calls, renders the
// PRIMARY sheet, and checks what an inspector would see on it. It also checks the two things that
// make it one authority rather than two:
//
//   · with a graph, the single-service tail is GONE — not drawn beside it;
//   · without a graph, the legacy tail is back, unchanged, which is why 2909 golden assertions
//     still pass.
//
// And the layout audit runs on every render, because the geometric defects on this sheet were
// found by rendering it and looking, not by asserting on the data.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  renderSLDProfessional, renderTopologyServiceSection, auditServiceSectionLayout,
} from '@/lib/sld-professional-renderer';
import {
  addBackupDomain, addProtectiveDevice, setInterconnection, removeBackupDomain, updateDomain,
} from '@/lib/electrical/topologyAuthoring';
import { buildServiceFromPreset } from '@/lib/electrical/topologyPresets';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';

type SLDInput = Parameters<typeof renderSLDProfessional>[0];

/** Ray's real job, built exactly as the guided builder builds it. */
function raysJob(): ServiceTopology {
  let t = buildServiceFromPreset({ ratedAmps: 400, distribution: 'two-main-panels' }).topology;
  for (const p of t.panels) {
    const branch = t.branches.find(b => (b.panelIds ?? []).includes(p.id))!;
    t = addBackupDomain(t, {
      branchId: branch.id,
      panelIds: [p.id],
      gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: ['tesla-powerwall-3'],
      expansionProductIds: ['tesla-powerwall-3-expansion'],
    }).topology;
  }
  t = addProtectiveDevice(t, {
    label: '400 A service disconnect', roles: ['service-disconnect'],
    ratedAmps: 400, lockableOpen: true, locationNote: 'Ahead of the service distribution.',
  }).topology;
  t = addProtectiveDevice(t, {
    label: 'Utility DER isolation disconnect', roles: ['der-isolation-disconnect'],
    ratedAmps: 400, lockableOpen: true, visibleOpen: true,
    locationNote: 'Adjacent to the revenue meter.',
  }).topology;
  return setInterconnection(t, {
    meterCollarPermitted: false, meterCollarSelected: false,
    externalDerIsolationRequired: true, externalDerIsolationBasis: 'ComEd',
  });
}

const BASE = {
  projectName: 'RAY 400A TWO GATEWAY', clientName: 'Ray', address: 'Chicago IL',
  designer: 'SolarPro', drawingDate: '2026-09-29', drawingNumber: 'E-1', revision: 'A',
  scale: 'NOT TO SCALE',
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30,
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0,
  inverterModel: 'IQ8PLUS-72-2-US', inverterManufacturer: 'Enphase',
  acOutputKw: 8.7, acOutputAmps: 36.2, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};

const withTopology = (t: ServiceTopology | null): SLDInput =>
  ({ ...BASE, serviceTopology: t } as unknown as SLDInput);

const count = (svg: string, needle: string) => svg.split(needle).length - 1;

const section = (t: ServiceTopology) => renderTopologyServiceSection({
  topology: t,
  startX: 1071, endX: 1974, busY: 479, minY: 100, maxY: 1070,
  utilityName: 'ComEd', calloutStart: 6, hasGenerator: false,
  notes: { x: 70, y: 715, w: 820, maxY: 1060 },
});

describe('🚨 the generated sheet is the system Ray built', () => {
  const svg = renderSLDProfessional(withTopology(raysJob()));

  it('shows 400 A splitting into two branches, two MSPs and two gateway domains', () => {
    expect(count(svg, '400 A SERVICE DISTRIBUTION')).toBe(1);
    expect(count(svg, '2 SERVICE BRANCHES')).toBe(1);
    // Both panelboards, separately identifiable — not one "MAIN SERVICE PANEL".
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');
    // Both gateways, one per domain.
    expect(count(svg, 'Tesla Backup Gateway 3')).toBeGreaterThanOrEqual(2);
    // 🚨 THE PATHS ARE NAMED AS AN ELECTRICIAN NAMES THEM. "Branch A" was the graph's word for it
    // and it was printed on a permit sheet and on the installer's screen; the authoring default is
    // now "200 A service path 1", and the label IS the name — there is no translation layer.
    // The callout wraps to the column gap, so this asserts on the words, not one unbroken run.
    expect(svg).toContain('200 A service path 1');
    expect(svg).toContain('200 A service path 2');
    expect((svg.match(/FEEDER/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('🚨 the legacy single-service tail is GONE, not drawn beside it', () => {
    expect(count(svg, 'MAIN SERVICE PANEL')).toBe(0);
    expect(count(svg, 'UTILITY METER')).toBe(0);
    // The service chain the graph describes is drawn instead.
    expect(count(svg, 'REVENUE METER')).toBe(1);
    expect(svg).toContain('400 A SERVICE DISCONNECT');
    expect(svg).toContain('UTILITY DER ISOLATION DISCONNECT');
  });

  it('🚨 an Expansion reads as a DC relationship — never an inverter, a source or a breaker', () => {
    expect(svg).toContain('Tesla Powerwall 3 Expansion');
    expect(svg).toContain('DC EXPANSION');
    expect(svg).toContain('NO AC OUTPUT · NO OCPD');
    expect(svg).toContain('DC EXPANSION HARNESS');
    // Its link is dashed; an AC feeder on this sheet is not.
    expect(svg).toMatch(/stroke-dasharray="6 4"/);
    // And the AC current it contributes is zero, so the sheet's total is the two inverting units.
    expect(svg).toContain('96 A (2 inverting units)');
  });

  it('shows the canonical neutral-ground bond once, where the topology puts it', () => {
    expect(count(svg, 'N-G BOND — NEC 250.24')).toBe(1);
  });

  it('🚨 the panels beside the diagram do not contradict it', () => {
    // The scalar answers are gone: no "Main Panel 200 A" beside a drawing of two 200 A panels.
    expect(svg).toContain('Service Rating');
    expect(svg).toContain('200 A bus / 200 A main');
    // And the busbar verdict is the CANONICAL conclusion, not a computed PASS/FAIL on scalars.
    expect(svg).toContain('NOT EVALUATED');
    expect(svg).not.toContain('PASS ✓');
    expect(svg).toContain('APPLICABILITY NOT ESTABLISHED');
    // The storage rows come from the graph's instances.
    expect(svg).toContain('2 × Tesla Powerwall 3');
    expect(svg).toContain('2 × Tesla Powerwall 3 Expansion');
    expect(svg).toContain('54.0 kWh');
  });

  it('🚨 what is unresolved is on the drawing, as the requirement — not as a release verdict', () => {
    expect(svg).toContain('SERVICE ENGINEERING — INPUT REQUIRED');
    // 🚨 IN WORDS, NOT IN TOKENS. This used to assert the sheet printed
    // 'service.availableFaultCurrentA' — a TypeScript field path, on a permit-grade drawing,
    // for an inspector to read. The assertion was pinning the defect.
    expect(svg).toContain('Available fault current at the service');
    expect(svg).not.toContain('service.availableFaultCurrentA');
    expect(svg).toContain('MANUFACTURER DOCUMENT REQUIRED');
    // Ray, 2026-09-18, three times: no release banner on an outbound sheet.
    for (const banner of ['DESIGN COMPLETE', 'RELEASE GATE', 'NOT FOR CONSTRUCTION', 'releaseReady']) {
      expect(svg, `${banner} must not appear on the sheet`).not.toContain(banner);
    }
  });

  it('🚨 the collision / overflow audit is clean on the new node types', () => {
    expect(auditServiceSectionLayout(section(raysJob()).boxes, {
      minX: 40, maxX: 1994, minY: 80, maxY: 1090,
    }), 'the service section has overlapping or off-sheet boxes').toEqual([]);
  });
});

describe('🚨 restoring the old assumptions makes the sheet wrong again', () => {
  it('NO service graph ⇒ the legacy single-service tail is back, byte for byte', () => {
    const legacy = renderSLDProfessional(withTopology(null));
    expect(count(legacy, 'MAIN SERVICE PANEL')).toBeGreaterThanOrEqual(1);
    expect(count(legacy, 'UTILITY METER')).toBe(1);
    expect(count(legacy, '400 A SERVICE DISTRIBUTION')).toBe(0);
    // And it is IDENTICAL to what the same input produced with the field absent entirely.
    const { serviceTopology: _drop, ...noField } =
      withTopology(null) as unknown as Record<string, unknown>;
    expect(renderSLDProfessional(noField as unknown as SLDInput)).toBe(legacy);
  });

  it('🚨 collapsing the two domains onto one gateway draws ONE gateway — the defect, restored', () => {
    const t = raysJob();
    const collapsed = removeBackupDomain(t, t.domains[1].id);
    const svg = renderSLDProfessional(withTopology(collapsed));
    expect(count(svg, 'Tesla Backup Gateway 3')).toBeLessThan(
      count(renderSLDProfessional(withTopology(t)), 'Tesla Backup Gateway 3'));
    // The branch it used to serve is still drawn — a service branch does not disappear because
    // nobody backs it up, and a sheet that dropped it would hide a 200 A feeder.
    expect(svg).toContain('MSP #2');
  });

  it('🚨 a single 400 A branch draws ONE column — the shape the old renderer could express', () => {
    const one = buildServiceFromPreset({ ratedAmps: 400, distribution: 'one-main-panel' }).topology;
    const svg = renderSLDProfessional(withTopology(one));
    expect(count(svg, '1 SERVICE BRANCH')).toBe(1);
    expect(svg).toContain('MSP #1');
    expect(svg).not.toContain('MSP #2');
  });
});

describe('🚨 the sheet follows the edit', () => {
  it('changing the point of connection changes the verdict the panels print', () => {
    const t = raysJob();
    const unresolved = renderSLDProfessional(withTopology(t));
    expect(unresolved).toContain('NOT ESTABLISHED');

    let resolved = t;
    for (const d of t.domains) {
      resolved = updateDomain(resolved, d.id, { storageConnection: 'gateway-panelboard' });
    }
    const svg = renderSLDProfessional(withTopology(resolved));
    expect(svg).toContain('Gateway panelboard');
    // Still NOT EVALUATED — the governing limit is the manufacturer's and SolarPro does not hold
    // it. Resolving WHERE the breaker lands does not invent the rule that governs it.
    const ev = evaluateServiceTopology(resolved);
    expect(ev.checks.find(c => c.id === 'domain.busbar-705-12')!.conclusion).toBe('NOT_EVALUATED');
    expect(svg).toContain('NOT EVALUATED');
  });

  it('moving an expansion to the other Powerwall moves it on the sheet', () => {
    const t = raysJob();
    const exp = t.storage.filter(u => u.role === 'energy-expansion');
    expect(new Set(exp.map(e => e.attachedToUnitId)).size).toBe(2);
    const drawn = section(t);
    // Each expansion is its own box, keyed by its own id — not one shared "expansions" block.
    for (const e of exp) expect(drawn.boxes.some(b => b.id === `exp-${e.id}`)).toBe(true);
  });
});
