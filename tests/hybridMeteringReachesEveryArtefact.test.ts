// ============================================================================
// CTs ON THE HYBRID SLDs TOO — Ray, 2026-09-26: "add CTs to the hybrid SLDs too."
//
// A hybrid (roof Enphase micro + ground string, say) drew NO CT anywhere. The
// Diagram route's multi-lane branch returned before its metering was composed,
// the SLD PDF export attached bare lanes, the permit's multi-lane E-1 builder
// composed nothing, PV-4A's hybrid path printed circuit tables and stopped, the
// snapshot excluded every hybrid, and the engineering page hid the Consumption
// CTs control on every hybrid. A roof lane landing in an IQ Combiner 5C — two
// consumption CTs in the box — was drawn and permitted as though none existed.
//
// Every artefact now asks ONE function (lib/equipment/sldCombinerFields.ts
// `hybridLaneMetering`), which runs the ONE composer (resolveDesignMetering) on
// each lane's OWN plan — the plan the multi-lane drawing itself resolves
// (acCollectionFromLanes, same selection) — and gives exactly one lane, the
// primary metering lane (roof > ground > fence), the site's consumption CTs.
//
// What is pinned here:
//   1. the composer on each lane: one consumption set per service; a string
//      lane is returned untouched (same object); a second Enphase lane is
//      production only; a standalone-gateway lane carries its gateway;
//   2. the Diagram route and the SLD PDF export hand the renderer those lanes
//      (the renderer's input is captured — the Renderer stage draws them);
//   3. the permit E-1 input carries them, PV-4A states the same answer, and the
//      snapshot records a hybrid placement ONLY when the designer recorded one;
//   4. DIGEST SAFETY: the hybrid fixtures' snapshot digests are CONSTANTS
//      recorded before this change (tsx probe, 2026-09-26, on a tree with no
//      tracked modifications — the roof fixture's digest reproduced the pin in
//      tests/permitStandaloneGateway.test.ts byte-for-byte). Whole-snapshot
//      hashes: an UNRELATED legitimate move fails them too — prove the move
//      with a leaf diff before regenerating a constant, and say so;
//   5. single-lane is untouched: the E-1 input key set is the golden one.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { acCollectionFromLanes, type SLDSourceBranch } from '@/lib/sld-professional-renderer';
import {
  hybridLaneMetering,
  sldCombinerFields,
  standaloneGatewayFieldsFor,
  type MeteredSourceBranch,
} from '@/lib/equipment/sldCombinerFields';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import { roofProject } from '../test-fixtures/roofProject';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildSLDInputFromPermit, buildHybridPermitMetering } from '@/lib/permit/utils/sldAdapter';
import { buildPermitDesignSnapshot } from '@/lib/permit/snapshot/build';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { pageNECCompliance } from '@/lib/permit/sections/electricalPages';
import { stripComments } from './support/stripSource';

// ── Capture what each route hands the renderer (the renderer itself still runs) ──
const { captured } = vi.hoisted(() => ({ captured: [] as Array<{ sources?: MeteredSourceBranch[] }> }));
vi.mock('@/lib/sld-professional-renderer', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/sld-professional-renderer')>();
  return {
    ...orig,
    renderSLDProfessional: (i: Parameters<typeof orig.renderSLDProfessional>[0]) => {
      captured.push(i as { sources?: MeteredSourceBranch[] });
      return orig.renderSLDProfessional(i);
    },
  };
});
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => ({ id: 'test-user' })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => { throw err instanceof Error ? err : new Error(String(err)); },
}));

// The renderer and the SYSDEF accessors narrate every step; keep the output readable.
let logSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { logSpy.mockRestore(); });

const FIVE_C = 'enphase-iq-combiner-5c';
const STANDALONE = 'enphase-iq-gateway-standalone';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const withConsumption = (lanes: readonly MeteredSourceBranch[]) =>
  lanes.filter(l => l.meteringDrawing?.consumption).map(l => l.key);

// ── Lanes as the page / the adapters build them ────────────────────────────
const enphaseLane = (key: 'roof' | 'ground' | 'fence' = 'roof'): SLDSourceBranch => ({
  key, topologyType: 'MICROINVERTER', systemType: key,
  inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
  totalModules: 12, deviceCount: 12, panelWatts: 430,
  acOutputKw: 3.96, acOutputAmps: 16.5, backfeedAmps: 25, acOCPD: 25,
  microBranches: [{ branchIndex: 1, deviceCount: 12, branchCurrentA: 16.5, ocpdAmps: 20,
    conductorCallout: '#10 AWG THWN-2', necReference: 'NEC 690.8(B)' }],
});
const stringLane = (): SLDSourceBranch => ({
  key: 'ground', topologyType: 'STRING_INVERTER', systemType: 'ground',
  inverterManufacturer: 'Solis', inverterModel: 'S6-GR1P6K', inverterCount: 1,
  totalModules: 12, totalStrings: 2, panelsPerString: 6, panelWatts: 420,
  acOutputKw: 6, acOutputAmps: 25, backfeedAmps: 35, acOCPD: 35, dcOCPD: 20,
});

// ═════ 1. The composer, on each lane's own plan ═════════════════════════════
describe('hybridLaneMetering — one composer, each lane its own plan', () => {
  it('roof Enphase micro + ground string: one consumption set, on the roof; the string lane is untouched', () => {
    const lanes = [enphaseLane('roof'), stringLane()];
    const r = hybridLaneMetering({ lanes, selectedCombinerId: FIVE_C, interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
    expect(r.primary?.key).toBe('roof');
    expect(withConsumption(r.lanes)).toEqual(['roof']);
    // A lane that meters nothing is the very object passed in — no new key.
    expect(r.lanes[1]).toBe(lanes[1]);
    expect('meteringDrawing' in r.lanes[1]).toBe(false);
    expect('standaloneGateway' in r.lanes[1]).toBe(false);
    expect(r.lanes[0].meteringDrawing!.consumption).toMatchObject({
      location: 'between-tap-and-main', mode: 'LOAD_ONLY', ctCount: 2, supplied: 'in-box' });
  });

  it("the roof lane's drawing IS the composer's answer for the plan the drawing resolves for that lane", () => {
    const lanes = [enphaseLane('roof'), stringLane()];
    const plan = acCollectionFromLanes(lanes, FIVE_C).perSource[0].plan!;
    expect(plan.brains?.model).toBe('IQ Combiner 5C');
    const direct = resolveDesignMetering({
      plan: { brains: plan.brains ?? null, hasIntegratedGateway: plan.hasIntegratedGateway },
      interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
    const r = hybridLaneMetering({ lanes, selectedCombinerId: FIVE_C, interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
    expect(r.lanes[0].meteringDrawing).toEqual(direct.drawing);
    expect(r.primary!.metering.placementNote).toBe(direct.placementNote);
    // …and the primary lane maps exactly as a single-lane design with that device maps.
    const single = sldCombinerFields({ inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', isMicro: true,
      totalDevices: 12, branchCount: 1, hasBattery: false, selectedCombinerId: FIVE_C,
      interconnectionRaw: 'SUPPLY_SIDE_TAP', ungroundedConductorCount: 2 });
    expect(r.primary!.fields.meteringDrawing).toEqual(single.meteringDrawing);
    expect(r.primary!.fields.combinerModel).toBe(single.combinerModel);
    expect(r.primary!.fields.combinerMeteringSummary).toBe(single.combinerMeteringSummary);
  });

  it('two Enphase lanes: ONE consumption set per service — the other lane records production only', () => {
    // Given fence-first on purpose: the primary lane is chosen by roof > ground > fence.
    const r = hybridLaneMetering({ lanes: [enphaseLane('fence'), enphaseLane('roof')], selectedCombinerId: FIVE_C,
      interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
    expect(r.primary?.key).toBe('roof');
    expect(withConsumption(r.lanes)).toEqual(['roof']);
    const fence = r.lanes.find(l => l.key === 'fence')!.meteringDrawing!;
    const roof = r.lanes.find(l => l.key === 'roof')!.meteringDrawing!;
    expect(fence.production).toEqual(roof.production);
    expect(fence).toMatchObject({ consumption: null, lead: null, scheduleRow: null });
    // The 5C's production CT is factory pre-wired, so the fence lane has no lead at all.
    expect('leads' in fence).toBe(false);
    expect(r.metered.map(m => [m.key, m.isPrimary])).toEqual([['fence', false], ['roof', true]]);
  });

  it('a standalone IQ Gateway lane carries its gateway; its production lead survives on a non-primary lane', () => {
    const lanes = [enphaseLane('roof'), enphaseLane('fence')];
    const r = hybridLaneMetering({ lanes, selectedCombinerId: STANDALONE, interconnectionRaw: 'LOAD_SIDE', systemVoltage: 240 });
    const plan = acCollectionFromLanes(lanes, STANDALONE).perSource[0].plan!;
    const [roof, fence] = r.lanes;
    expect(roof.standaloneGateway).toEqual(standaloneGatewayFieldsFor(plan));
    expect(roof.standaloneGateway?.label).toBe('Enphase IQ Gateway');
    expect(roof.meteringDrawing!.production!.where).toBe('landing-panel-field');
    expect(roof.meteringDrawing!.leads!.map(l => l.channel)).toEqual(['production', 'consumption']);
    expect(r.primary!.fields.standaloneGateway).toEqual(roof.standaloneGateway);
    // The fence gateway meters its own production; its 5 ft lead still lands on IT.
    expect(fence.standaloneGateway).toEqual(roof.standaloneGateway);
    expect(fence.meteringDrawing!.consumption).toBeNull();
    expect(fence.meteringDrawing!.leads!.map(l => l.channel)).toEqual(['production']);
  });

  it('a hybrid whose lanes meter nothing gets nothing — every lane is the object passed in', () => {
    const lanes = [{ ...enphaseLane('roof'), inverterManufacturer: 'APsystems', inverterModel: 'DS3-L' }, stringLane()];
    const r = hybridLaneMetering({ lanes, selectedCombinerId: null, interconnectionRaw: 'LOAD_SIDE' });
    expect(r.primary).toBeNull();
    expect(r.metered).toEqual([]);
    r.lanes.forEach((l, i) => expect(l).toBe(lanes[i]));
  });
});

// ═════ 2. The routes hand the renderer those lanes ══════════════════════════
describe('the Diagram route and the SLD PDF export', () => {
  const body = {
    format: 'svg', projectName: 'HY', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275',
    topologyType: 'HYBRID_MULTI_SOURCE', totalModules: 24, mainPanelAmps: 200, panelBusRating: 200,
    selectedCombinerId: FIVE_C, interconnection: 'SUPPLY_SIDE_TAP',
    sources: [enphaseLane('roof'), stringLane()], runs: [],
  };
  const post = async (mod: { POST: (r: never) => Promise<Response> }, b: Record<string, unknown>) => {
    captured.length = 0;
    const res = await mod.POST(new Request('http://solarpro.test/api/engineering/sld', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never);
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    return captured[0].sources!;
  };
  const expected = (over: { consumptionCtLocation?: string } = {}) => hybridLaneMetering({
    lanes: [enphaseLane('roof'), stringLane()], selectedCombinerId: FIVE_C,
    interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240, consumptionCtLocation: over.consumptionCtLocation ?? null,
  }).lanes;

  it('Diagram route: exactly one consumption drawing, on the roof lane; none on the string lane', async () => {
    const lanes = await post(await import('@/app/api/engineering/sld/route'), body);
    expect(lanes.map(l => l.key)).toEqual(['roof', 'ground']);
    expect(withConsumption(lanes)).toEqual(['roof']);
    expect(lanes[1].meteringDrawing).toBeUndefined();
    expect(lanes[0].meteringDrawing).toEqual(expected()[0].meteringDrawing);
  }, 60_000);

  it('Diagram route: a recorded location reaches the roof lane, said to be recorded', async () => {
    const lanes = await post(await import('@/app/api/engineering/sld/route'),
      { ...body, consumptionCtLocation: 'main-breaker-load-side' });
    expect(lanes[0].meteringDrawing!.consumption).toMatchObject({
      location: 'main-breaker-load-side', basisLabel: 'LOCATION RECORDED BY DESIGNER' });
    expect(lanes[0].meteringDrawing).toEqual(expected({ consumptionCtLocation: 'main-breaker-load-side' })[0].meteringDrawing);
  }, 60_000);

  it('a client cannot post a drawing of its own — the route composes it', async () => {
    const forged = { ...stringLane(), meteringDrawing: { consumption: { location: 'sec-line-side-of-main' } } };
    const lanes = await post(await import('@/app/api/engineering/sld/route'),
      { ...body, sources: [enphaseLane('roof'), forged] });
    expect(lanes[1].meteringDrawing).toBeUndefined();
    expect(withConsumption(lanes)).toEqual(['roof']);
  }, 60_000);

  it('SLD PDF export (svg format): the same lanes the Diagram route draws', async () => {
    const lanes = await post(await import('@/app/api/engineering/sld/pdf/route'),
      { format: 'svg', buildInput: { ...body, format: undefined } });
    expect(withConsumption(lanes)).toEqual(['roof']);
    expect(lanes[1].meteringDrawing).toBeUndefined();
    expect(lanes[0].meteringDrawing).toEqual(expected()[0].meteringDrawing);
  }, 60_000);
});

// ═════ 3. The permit: E-1, PV-4A, the snapshot ══════════════════════════════
/** Roof Enphase IQ8M micro (6) + ground Solis string (6), from the 12-panel
 *  roof fixture — the wave5b-sheets pattern, two lanes. */
function mkHybrid(over: Record<string, unknown> = {}) {
  const input: any = clone(roofProject);
  const tag = (p: any, i: number) => { p.systemType = i < 6 ? 'ground' : 'roof'; };
  (input.project.panelPositions as any[]).forEach(tag);
  if (input.layout?.panels) (input.layout.panels as any[]).forEach(tag);
  input.system.inverters = [
    { manufacturer: 'Enphase', model: 'IQ8M', type: 'micro', acOutputKw: 0.33, maxDcVoltage: 60,
      efficiency: 0.97, ulListing: 'UL 1741', subSystemKey: 'roof',
      strings: [{ label: 'R-1', panelCount: 6, panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
        panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, isc: 13.85, wireGauge: '#10 AWG', wireLength: 45 }] },
    { manufacturer: 'Solis', model: 'S6-GR1P6K', type: 'string', acOutputKw: 6.0, maxDcVoltage: 600,
      efficiency: 0.97, ulListing: 'UL 1741', subSystemKey: 'ground',
      strings: [{ label: 'G-1', panelCount: 6, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
        panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03, wireGauge: '#10 AWG', wireLength: 80 }] },
  ];
  input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
  Object.assign(input.project, over);
  return input;
}
/** The 3-lane hybrid of tests/planset/wave5b-sheets.test.ts (4 + 4 + 4). */
function mkHybrid3() {
  const input: any = clone(roofProject);
  const tag = (p: any, i: number) => { p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof'; };
  (input.project.panelPositions as any[]).forEach(tag);
  if (input.layout?.panels) (input.layout.panels as any[]).forEach(tag);
  input.system.inverters = [
    { manufacturer: 'Enphase', model: 'IQ8M', type: 'micro', acOutputKw: 0.33, maxDcVoltage: 60, efficiency: 0.97,
      ulListing: 'UL 1741', subSystemKey: 'roof',
      strings: [{ label: 'R-1', panelCount: 4, panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
        panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85, isc: 13.85, wireGauge: '#10 AWG', wireLength: 45 }] },
    { manufacturer: 'Solis', model: 'S6-GR1P6K', type: 'string', acOutputKw: 6.0, maxDcVoltage: 600, efficiency: 0.97,
      ulListing: 'UL 1741', subSystemKey: 'ground',
      strings: [{ label: 'G-1', panelCount: 4, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
        panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03, wireGauge: '#10 AWG', wireLength: 80 }] },
    { manufacturer: 'SolFence', model: 'SF-OPT-3800', type: 'optimizer', acOutputKw: 3.8, maxDcVoltage: 480,
      efficiency: 0.97, ulListing: 'UL 1741', subSystemKey: 'fence',
      strings: [{ label: 'F-1', panelCount: 4, panelManufacturer: 'SolFence', panelModel: 'SF-BIF-400',
        panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6, isc: 13.6, wireGauge: '#10 AWG', wireLength: 60 }] },
  ];
  return input;
}
const cadOf = (p: unknown) => generateCADLayout(clone(p) as any);
const snapOf = (p: any) => buildPermitDesignSnapshot(p, cadOf(p), { projectId: 'p1', designVersionId: 'v1' }) as any;

describe('the permit E-1 input', () => {
  it('carries exactly one consumption drawing, on the roof lane; the string lane has none', () => {
    const p = mkHybrid({ selectedCombinerId: FIVE_C });
    const sld = buildSLDInputFromPermit(p, cadOf(p));
    const lanes = sld.sources as MeteredSourceBranch[];
    expect(lanes.map(l => l.key)).toEqual(['roof', 'ground']);
    expect(withConsumption(lanes)).toEqual(['roof']);
    expect('meteringDrawing' in lanes[1]).toBe(false);
    expect(lanes[0].meteringDrawing!.consumption).toMatchObject({ location: 'between-tap-and-main', mode: 'LOAD_ONLY' });
    // PV-4A and the snapshot read this same answer.
    expect(lanes).toEqual(buildHybridPermitMetering(p, cadOf(p))!.lanes);
  });

  it('the hybrid E-1 input gains no top-level key — the CTs ride on the lane', () => {
    const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-fixtures/golden/golden.json'), 'utf-8'));
    const p = mkHybrid({ selectedCombinerId: FIVE_C });
    expect(Object.keys(buildSLDInputFromPermit(p, cadOf(p))).sort())
      .toEqual([...golden['sld-input-roof'].topLevelKeys, 'sources'].sort());
  });

  it('a recorded location reaches the roof lane', () => {
    const p = mkHybrid({ selectedCombinerId: FIVE_C, consumptionCtLocation: 'main-breaker-load-side' });
    const lanes = buildSLDInputFromPermit(p, cadOf(p)).sources as MeteredSourceBranch[];
    expect(lanes[0].meteringDrawing!.consumption!.location).toBe('main-breaker-load-side');
    expect(withConsumption(lanes)).toEqual(['roof']);
  });
});

describe('PV-4A states it', () => {
  it("the primary lane's disclosure and CT placement, quoted from the composer — not re-worded", () => {
    const p = mkHybrid({ selectedCombinerId: FIVE_C });
    const cad = cadOf(p);
    p._snapshot = buildPermitDesignSnapshot(p, cad, { projectId: 'p1', designVersionId: 'v1' });
    const html = pageNECCompliance(p, cad, 1, 1);
    const met = buildHybridPermitMetering(p, cad)!.primary!.metering;
    expect(html).toContain('METERING (NEC 690.4) — ROOF SUB-SYSTEM, ENPHASE IQ COMBINER 5C:');
    expect(html).toContain(met.resolution!.disclosure);
    expect(met.placementNote).toMatch(/Total \("Load only"\)/);
    expect(html).toContain(met.placementNote);
  });

  it('a second Enphase lane: E-1 draws it production only, and PV-4A says so', () => {
    const p = mkHybrid({ selectedCombinerId: FIVE_C });
    const roofInv = p.system.inverters[0];
    p.system.inverters[1] = { ...roofInv, subSystemKey: 'ground', strings: [{ ...roofInv.strings[0], label: 'G-1' }] };
    const cad = cadOf(p);
    const hm = buildHybridPermitMetering(p, cad)!;
    expect(hm.metered.map(m => [m.key, m.isPrimary])).toEqual([['roof', true], ['ground', false]]);
    const lanes = buildSLDInputFromPermit(p, cad).sources as MeteredSourceBranch[];
    expect(withConsumption(lanes)).toEqual(['roof']);
    expect(lanes[1].meteringDrawing).toMatchObject({ consumption: null, lead: null, scheduleRow: null });
    p._snapshot = buildPermitDesignSnapshot(p, cad, { projectId: 'p1', designVersionId: 'v1' });
    const html = pageNECCompliance(p, cad, 1, 1);
    expect(html).toContain('<strong>GROUND:</strong> Enphase IQ Combiner 5C — PCT (INTEGRAL) — PRODUCTION; production only'
      + " — the site's consumption CTs are read by the Enphase IQ Combiner 5C (one set per service).");
  });
});

describe('the snapshot — only an explicit record moves a hybrid digest', () => {
  // Recorded 2026-09-26 (tsx probe: buildPermitDesignSnapshot with generateCADLayout,
  // opts { projectId: 'p1', designVersionId: 'v1' }) BEFORE this change.
  const HEAD_HYBRID_DIGESTS: Array<[string, () => any, string]> = [
    ['roof micro + ground string, supply-side tap, no selection', () => mkHybrid(),
      '8ac028fc02093933c33730bc13cb20034e16c3ef1c2cf8073d404d01c33bd70c'],
    ['roof micro + ground string, supply-side tap, recorded 5C', () => mkHybrid({ selectedCombinerId: FIVE_C }),
      '8ac028fc02093933c33730bc13cb20034e16c3ef1c2cf8073d404d01c33bd70c'],
    ['the wave5b 3-lane hybrid (roof micro + ground string + fence optimizer)', mkHybrid3,
      'd21da184607f9f09f45d707f00cb34bdd21e09ce304ecf017efde11202ce0012'],
  ];
  for (const [name, mk, digest] of HEAD_HYBRID_DIGESTS) {
    it(`${name}: the digest is the one recorded before hybrid CTs existed`, () => {
      const s = snapOf(mk());
      expect(s.electrical.meteringTopology).toBeUndefined();
      expect(computeSnapshotDigest(s)).toBe(digest);
    });
  }

  it("a designer-recorded location is recorded — from the roof lane's composer answer — and moves only that digest", () => {
    const s = snapOf(mkHybrid({ selectedCombinerId: FIVE_C, consumptionCtLocation: 'main-breaker-load-side' }));
    expect(s.electrical.meteringTopology).toEqual({
      consumptionCtLocation: 'main-breaker-load-side', boundary: 'load-side-downstream-of-pv',
      mode: 'LOAD_ONLY', basis: 'designer-recorded' });
    expect(computeSnapshotDigest(s)).not.toBe(HEAD_HYBRID_DIGESTS[1][2]);
    // '' is "no record": no key, no move.
    expect(computeSnapshotDigest(snapOf(mkHybrid({ selectedCombinerId: FIVE_C, consumptionCtLocation: '' }))))
      .toBe(HEAD_HYBRID_DIGESTS[1][2]);
  });
});

// ═════ 4. Single-lane is untouched ═════════════════════════════════════════
describe('single-lane designs are byte-identical', () => {
  it('the roof fixture E-1 input key set is the golden one, with no lanes', () => {
    const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-fixtures/golden/golden.json'), 'utf-8'));
    const sld = buildSLDInputFromPermit(clone(roofProject) as any, generateCADLayout(clone(roofProject) as any));
    expect(Object.keys(sld).sort()).toEqual(golden['sld-input-roof'].topLevelKeys);
    expect(buildHybridPermitMetering(clone(roofProject) as any, generateCADLayout(clone(roofProject) as any))).toBeNull();
  });

  it('the engineering page: pageMetering is still the single-lane answer; only the CT control and CT-1 read the hybrid one', () => {
    const PAGE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));
    // The single-lane memo is unchanged — still null on a hybrid.
    expect(PAGE).toMatch(/if \(!micro \|\| !computedSystem\?\.isMicro \|\| subSystemCounts\.isHybrid\) return null;/);
    // The hybrid answer is the Diagram route's call on the lanes the page posts it.
    expect(PAGE).toMatch(/hybridLaneMetering\(\{\s*lanes: hybridSldSources,\s*selectedCombinerId: projectCombinerId,/);
    expect(PAGE).toMatch(/const pageCtMetering = pageMetering \?\? pageHybridMetering\?\.fields \?\? null;/);
    expect(PAGE).toMatch(/\{pageCtMetering\?\.metering \? \(/);
    expect(PAGE).toMatch(/\{pageCtMetering\?\.meteringDrawing\?\.consumption \? \(\(\) => \{/);
    // COMB-1, the SLD badge and ENVOY-1 still read the single-lane answer only.
    expect(PAGE).toMatch(/const _b = planLandingDevice\(pageMetering\.plan\)/);
  });

  // 🚨 A hybrid project could only hold a `consumptionCtLocation` from its
  // single-lane days (the control was hidden on every hybrid). Sent as the
  // hybrid's answer it recorded a `meteringTopology` the project never had and
  // moved its permit digest from a code change alone — retiring its PE
  // approval (review, 2026-09-26). A hybrid now reads and writes its OWN key,
  // set only by the control on the hybrid, and every request the page makes
  // carries the topology's own record.
  it('the page never sends a single-lane-era CT record as a hybrid\'s: one topology-scoped value everywhere', () => {
    const PAGE = stripComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));
    expect(PAGE).toMatch(/const ctLocationForRequests: ProjectConfig\['consumptionCtLocation'\] = subSystemCounts\.isHybrid\s*\?\s*_hybridCtLocation : \(config\.consumptionCtLocation \|\| ''\);/);
    // The hybrid composer reads the hybrid's own record.
    expect(PAGE).toMatch(/consumptionCtLocation: _hybridCtLocation \|\| null,/);
    // The control reads and writes through the scoped value.
    expect(PAGE).toMatch(/value=\{ctLocationForRequests \|\| ''\}/);
    expect(PAGE).toMatch(/onChange=\{e => setCtLocation\(/);
    // No request body sends the unscoped key any more (the single-lane
    // composer, pageMetering, still reads it: it is null on a hybrid).
    expect(PAGE).not.toMatch(/consumptionCtLocation:\s*config\.consumptionCtLocation(?: \|\| undefined|,)/);
    expect((PAGE.match(/consumptionCtLocation:\s*ctLocationForRequests \|\| undefined/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
