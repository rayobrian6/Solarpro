// ============================================================================
// CTs ON THE HYBRID SLDs — Ray, 2026-09-26: "add CTs to the hybrid SLDs too.
// Biggest issue I have with the sld is the word bleed and overlays. This should
// be cleaner to read!!"
//
// The multi-lane renderer (renderSLDMultiLane) drew no metering at all: a roof
// lane landing in an IQ Combiner 5C — two consumption CTs in the box — was drawn
// as though no CT existed. The lanes now arrive with their CTs already composed
// (lib/equipment/sldCombinerFields `hybridLaneMetering`, the ONE composer run on
// each lane's own plan), and the sheet draws them the way the single-lane sheet
// does, with the single-lane sheet's own helpers:
//   · the production CT at that lane's combiner — integral 'PCT' in an IQ
//     Combiner, or the 'landing-panel-field' ring on L1 with the standalone
//     gateway drawn as its own node, fed from its breaker in that panel;
//   · the site's consumption CTs at the shared MSP, where the composer says;
//   · the drawn dashed leads, gateway to CT, each labelled once, in a clear lane;
//   · the legend entry, the CT note line and the 'Consumption CTs' row.
//
// And because Ray's complaint is legibility, every assertion about a drawing is
// also an assertion that it adds NO collision (tests/support/sldGeometry.ts):
// against the same hybrid with its metering stripped, per class, and — for the
// CT ink itself — none at all.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderSLDProfessional, type SLDProfessionalInput, type SLDSourceBranch } from '@/lib/sld-professional-renderer';
import { hybridLaneMetering, sldCombinerFields, type MeteredSourceBranch } from '@/lib/equipment/sldCombinerFields';
import type { ConsumptionCtLocation } from '@/lib/equipment/currentTransformers';
import { parseSld, auditSld, countByClass, COLLISION_CLASS_ORDER, describeFinding, type Finding } from './support/sldGeometry';
import { buildSldVariantMatrix, applyRenderMode } from './support/sldVariantMatrix';
import { roofProject } from '../test-fixtures/roofProject';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildSLDInputFromPermit, generateLiveSLD } from '@/lib/permit/utils/sldAdapter';

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

// The renderer and the composers narrate every step; keep the output readable.
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

const CT = '#6A1B9A';
const FIVE_C = 'enphase-iq-combiner-5c';
const STANDALONE = 'enphase-iq-gateway-standalone';
type IC = 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE';

// ── Lanes as the page / the adapters build them ─────────────────────────────
const enphase = (key: 'roof' | 'ground' | 'fence', n = 12): SLDSourceBranch => ({
  key, topologyType: 'MICROINVERTER', systemType: key, inverterManufacturer: 'Enphase', inverterModel: 'IQ8M',
  totalModules: n, deviceCount: n, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9,
  acOutputKw: +(n * 0.325).toFixed(2), acOutputAmps: +(n * 1.35).toFixed(1), backfeedAmps: 20, acOCPD: 20,
  microBranches: [{ branchIndex: 1, deviceCount: n, branchCurrentA: 16.2, ocpdAmps: 20,
    conductorCallout: '#12 AWG THWN-2', necReference: 'NEC 690.8(B)' }],
});
const solarEdge = (key: 'roof' | 'ground'): SLDSourceBranch => ({
  key, topologyType: 'STRING_INVERTER', inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H',
  totalModules: 20, panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9, totalStrings: 2,
  acOutputKw: 7.6, acOutputAmps: 32, backfeedAmps: 40, acOCPD: 40,
});

/** The Diagram route's `_mlInput`, with its lanes through the one composer. */
function hybrid(raw: SLDSourceBranch[], o: { sel?: string | null; byLane?: Record<string, string>; ic: IC;
  ct?: ConsumptionCtLocation | null }): { input: SLDProfessionalInput; lanes: MeteredSourceBranch[] } {
  const r = hybridLaneMetering({ lanes: raw, selectedCombinerId: o.sel ?? null, selectedCombinerIdByLane: o.byLane ?? null,
    interconnectionRaw: o.ic, consumptionCtLocation: o.ct ?? null, systemVoltage: 240 });
  const input = {
    projectName: 'Hybrid CTs', clientName: 'Ray', address: '1 Test St', designer: 'T', drawingDate: '2026-09-26',
    drawingNumber: 'SLD-1', revision: 'A', scale: 'NTS', mainPanelAmps: 200, panelBusRating: 200,
    utilityName: 'Ameren Illinois', hasProductionMeter: true, acWireLength: 50, topologyType: 'HYBRID_MULTI_SOURCE',
    selectedCombinerId: o.sel ?? null, ...(o.byLane ? { selectedCombinerIdByLane: o.byLane } : {}),
    totalModules: raw.reduce((s, b) => s + (b.totalModules ?? 0), 0), totalStrings: 0,
    panelModel: 'PV', panelWatts: 430, panelVoc: 37.2, panelIsc: 13.9, dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 0,
    inverterModel: 'IQ8M', inverterManufacturer: 'Enphase', acOutputKw: 10, acOutputAmps: 42, acWireGauge: '#6 AWG',
    acConduitType: 'EMT', acOCPD: 60, backfeedAmps: raw.reduce((s, b) => s + (b.backfeedAmps ?? 0), 0),
    interconnection: o.ic, rapidShutdownIntegrated: true, hasBattery: false, batteryModel: '', batteryKwh: 0,
    sources: r.lanes,
  } as SLDProfessionalInput;
  return { input, lanes: r.lanes };
}
/** The same input with every lane's metering taken off — what the sheet drew before. */
const bare = (i: SLDProfessionalInput): SLDProfessionalInput => ({
  ...i,
  sources: i.sources!.map(l => {
    const { meteringDrawing: _m, standaloneGateway: _g, ...rest } = l as MeteredSourceBranch;
    return rest;
  }),
});
const E1 = { suppressTitleBlock: true, suppressScheduleBand: true, suppressCalcBand: true } as const;

// ── Geometry readers (the schematic's own frame: leads, rings and terminals
//    all sit inside the same fit group, so their coordinates compare) ────────
type Pt = [number, number];
const leadsOf = (svg: string): Pt[][] =>
  [...svg.matchAll(/<polyline points="([^"]+)" fill="none" stroke="#6A1B9A"/g)]
    .map(m => m[1].trim().split(/\s+/).map(p => p.split(',').map(Number) as Pt));
const ringsOf = (svg: string): Pt[] =>
  [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="(?:3\.8|3\.2)" fill="none" stroke="#6A1B9A"/g)]
    .map(m => [Number(m[1]), Number(m[2])]);
const terminalsOf = (svg: string): Pt[] =>
  [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="1\.8" fill="#6A1B9A"/g)]
    .map(m => [Number(m[1]), Number(m[2])]);
const count = (s: string, needle: string) => s.split(needle).length - 1;
const near = (a: Pt, b: Pt, d: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= d;

/**
 * Every collision that involves CT ink — a CT-coloured label, a CT lead, a CT
 * ring or terminal — or the standalone gateway's own labels. The CT drawing is
 * new ink on a crowded sheet; none of it may share ink with anything.
 */
function ctInkFindings(svg: string, extraTexts: string[] = []): Finding[] {
  const g = parseSld(svg);
  const mine = new Set([...g.texts.filter(t => t.fill.toLowerCase() === CT.toLowerCase()).map(t => t.text), ...extraTexts]);
  return auditSld(g).filter(f => mine.has(f.text) || (f.other.text != null && mine.has(f.other.text))
    || /purple.*\(CT/.test(f.other.desc));
}
/** The gateway node's own labels, as the sheet prints them. */
const gatewayTexts = (sg: NonNullable<MeteredSourceBranch['standaloneGateway']>) => [
  '(N) MONITORING GATEWAY', sg.label, ...(sg.partNumber ? [`P/N ${sg.partNumber}`] : []), 'NEMA 3R ENCL. IF OUTDOORS',
  `${sg.supplyBreakerA}A 2P — GATEWAY SUPPLY`, sg.supplyConductor,
];
/** Per class: the metered sheet may not have more of any class than the bare one. */
function worseThanBare(met: string, before: string): string[] {
  const a = countByClass(auditSld(met)), b = countByClass(auditSld(before));
  return COLLISION_CLASS_ORDER.filter(k => a[k] > b[k]).map(k => `${k}: ${b[k]} → ${a[k]}`);
}

// ═════ 0. The instrument can see a CT collision ══════════════════════════════
describe('the CT-ink check can fail (a guard that cannot fail proves nothing)', () => {
  const doc = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">${inner}</svg>`;
  const label = '<text x="200" y="100" font-family="SolarPro Sans, SolarPro Symbols" font-size="8.67" text-anchor="middle">MAIN SERVICE PANEL</text>';
  const lead = (x: number) => `<polyline points="${x},140 ${x},60" fill="none" stroke="${CT}" stroke-width="1.1" stroke-dasharray="4,2.5"/>`;
  it('a CT lead through a label, and not one beside it', () => {
    expect(ctInkFindings(doc(label + lead(200)))).toHaveLength(1);
    expect(ctInkFindings(doc(label + lead(300)))).toEqual([]);
  });
  it('a CT label on a line, and a gateway label on a line', () => {
    const tag = `<text x="200" y="100" font-size="8.67" text-anchor="middle" fill="${CT}">CT×2</text>`;
    const line = '<line x1="150" y1="98" x2="250" y2="98" stroke="#000" stroke-width="1"/>';
    expect(ctInkFindings(doc(tag + line))).toHaveLength(1);
    expect(ctInkFindings(doc(label + line))).toEqual([]);
    expect(ctInkFindings(doc(label + line), ['MAIN SERVICE PANEL'])).toHaveLength(1);
  });
});

// ═════ 1. No metering ⇒ nothing moves ═══════════════════════════════════════
describe('a hybrid with no lane metering is drawn exactly as before', () => {
  const matrix = buildSldVariantMatrix().filter(v => v.family === 'hybrid');

  it('the matrix really exercises metered lanes (a stripped copy would prove nothing otherwise)', () => {
    expect(matrix.length).toBe(12);
    for (const v of matrix) expect(v.build().sources!.some(l => (l as MeteredSourceBranch).meteringDrawing), v.id).toBe(true);
  });

  for (const v of matrix) {
    it(`${v.id}: no metering fields ⇒ no CT ink, and absent ≡ undefined`, () => {
      const input = bare(applyRenderMode(v.build(), v.mode));
      const svg = renderSLDProfessional(input);
      const undef = { ...input, sources: input.sources!.map(l => ({ ...l, meteringDrawing: undefined, standaloneGateway: undefined })) };
      expect(renderSLDProfessional(undef)).toBe(svg);
      expect(svg).not.toContain(CT);
      for (const s of ['MONITORING GATEWAY', 'STANDALONE GATEWAY', 'Consumption CTs', 'INTEGRATED GATEWAY / MONITORING']) {
        expect(svg, s).not.toContain(s);
      }
    });
  }

  it('a drawing on a STRING lane is ignored — only a micro lane draws the box its CTs belong to', () => {
    const { input } = hybrid([enphase('roof'), solarEdge('ground')], { sel: FIVE_C, ic: 'SUPPLY_SIDE_TAP' });
    const roofDrawing = (input.sources![0] as MeteredSourceBranch).meteringDrawing!;
    const b = bare(input);
    const forged = { ...b, sources: [b.sources![0], { ...b.sources![1], meteringDrawing: roofDrawing }] };
    expect(renderSLDProfessional(forged)).toBe(renderSLDProfessional(b));
  });
});

// ═════ 2. Every hybrid Ray can see: the CTs add no collision ════════════════
describe('every hybrid in the legibility matrix: the CTs add no collision', () => {
  for (const v of buildSldVariantMatrix().filter(x => x.family === 'hybrid')) {
    it(`${v.id}: no class rises against the same sheet without metering; no CT ink collides`, () => {
      const input = applyRenderMode(v.build(), v.mode);
      const svg = renderSLDProfessional(input);
      expect(worseThanBare(svg, renderSLDProfessional(bare(input)))).toEqual([]);
      const sg = input.sources!.map(l => (l as MeteredSourceBranch).standaloneGateway).find(Boolean);
      expect(ctInkFindings(svg, sg ? gatewayTexts(sg) : []).map(describeFinding)).toEqual([]);
    });
  }
});

// ═════ 3. IQ Combiner 5C lane ════════════════════════════════════════════════
describe('roof IQ Combiner 5C + ground string: the gateway in the combiner reads the MSP CTs', () => {
  const { input, lanes } = hybrid([enphase('roof'), solarEdge('ground')], { sel: FIVE_C, ic: 'SUPPLY_SIDE_TAP' });
  const md = lanes[0].meteringDrawing!;
  const svg = renderSLDProfessional(input);

  it('the composer states what is drawn: integral PCT, CT×2 between the tap and the main, one consumption lead', () => {
    expect(md.production!.where).toBe('combiner-integral');
    expect(md.consumption).toMatchObject({ location: 'between-tap-and-main', ctCount: 2 });
    expect(md.leads!.map(l => l.channel)).toEqual(['consumption']);
  });

  it('the IQ Gateway is drawn inside the combiner, with its integral PCT on the bus', () => {
    expect(count(svg, 'data-device="enphase-iq-gateway"')).toBe(1);
    expect(count(svg, '>INTEGRATED GATEWAY / MONITORING<')).toBe(1);
    expect(count(svg, '>PCT<')).toBe(1);
  });

  it('the consumption CTs at the shared MSP carry the composer\'s count', () => {
    expect(count(svg, '>CT×2<')).toBe(1);
    // Two rings: the PCT in the combiner and the consumption CTs at the MSP.
    expect(ringsOf(svg)).toHaveLength(2);
  });

  it('ONE lead, drawn from the MSP CT ring to a terminal on the gateway, labelled once in the composer\'s words', () => {
    const leads = leadsOf(svg);
    expect(leads).toHaveLength(1);
    const [lead] = leads;
    expect(ringsOf(svg).some(r => near(r, lead[0], 4.5)), `starts at ${lead[0]}`).toBe(true);
    const end = lead[lead.length - 1];
    expect(terminalsOf(svg).some(t => near(t, end, 0.2)), `ends at ${end}`).toBe(true);
    // It runs square: every segment horizontal or vertical.
    for (let i = 1; i < lead.length; i++) {
      expect(lead[i][0] === lead[i - 1][0] || lead[i][1] === lead[i - 1][1], `${lead[i - 1]} → ${lead[i]}`).toBe(true);
    }
    expect(count(svg, `>${md.leads![0].label}<`)).toBe(1);
    // One extension rule per lead: the older one-line lead note is not repeated beside it.
    expect(svg).not.toContain(md.lead!.label);
    expect(svg).not.toContain('(CT) =');
    expect(svg).not.toMatch(/>CT<\/text>/);
  });

  it('the legend entry, the CT note line and the schedule row — the single-lane sheet\'s words', () => {
    expect(count(svg, '>CT Secondary Leads (signal) — CT to gateway<')).toBe(1);
    expect(count(svg, `>CONSUMPTION CTs @ MSP: ${md.consumption!.label}  ·  ${md.consumption!.basisLabel}<`)).toBe(1);
    expect(count(svg, '>Consumption CTs<')).toBe(1);
    expect(count(svg, `>${md.scheduleRow}<`)).toBe(1);
  });

  it('the same words the single-lane sheet prints for the same composer answer', () => {
    const f = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8M', isMicro: true, totalDevices: 12, branchCount: 1,
      hasBattery: false, selectedCombinerId: FIVE_C, interconnectionRaw: 'SUPPLY_SIDE_TAP', ungroundedConductorCount: 2,
    });
    expect(f.meteringDrawing).toEqual(md);
    const single = renderSLDProfessional({
      ...input, sources: undefined, topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
      totalModules: 12, deviceCount: 12, combinerLabel: f.combinerLabel, combinerModel: f.combinerModel,
      combinerHasIntegratedGateway: f.combinerHasIntegratedGateway, combinerProvidesAcDisconnect: f.combinerProvidesAcDisconnect,
      meteringDrawing: f.meteringDrawing ?? undefined,
    } as SLDProfessionalInput);
    for (const s of [
      `>CONSUMPTION CTs @ MSP: ${md.consumption!.label}  ·  ${md.consumption!.basisLabel}<`,
      '>CT Secondary Leads (signal) — CT to gateway<', `>${md.leads![0].label}<`, `>${md.scheduleRow}<`, '>CT×2<',
    ]) {
      expect(count(single, s), `single-lane ${s}`).toBe(1);
      expect(count(svg, s), `hybrid ${s}`).toBe(1);
    }
  });
});

// ═════ 4. Standalone IQ Gateway lane ═════════════════════════════════════════
describe('roof standalone IQ Gateway + ground string: the gateway node, its supply and both leads', () => {
  const { input, lanes } = hybrid([enphase('roof'), solarEdge('ground')], { sel: STANDALONE, ic: 'LOAD_SIDE' });
  const sg = lanes[0].standaloneGateway!;
  const md = lanes[0].meteringDrawing!;
  const svg = renderSLDProfessional(input);

  it('draws the gateway as its own enclosure — Envoy art, model, part number, outdoor note — not inside the panel', () => {
    expect(sg).toMatchObject({ label: 'Enphase IQ Gateway', partNumber: 'ENV2-IQ-AM1-240', supplyBreakerA: 15 });
    expect(count(svg, '>(N) MONITORING GATEWAY<')).toBe(1);
    expect(count(svg, 'data-device="enphase-iq-gateway"')).toBe(1);
    expect(svg).toContain(`>P/N ${sg.partNumber}<`);
    expect(svg).toContain('>NEMA 3R ENCL. IF OUTDOORS<');
    expect(svg).not.toContain('INTEGRATED GATEWAY / MONITORING');
  });

  it('its 2-pole supply breaker in the panel and the supply circuit with its conductor callout', () => {
    expect(svg).toContain(`>${sg.supplyBreakerA}A 2P<`);
    expect(count(svg, `>${sg.supplyBreakerA}A 2P — GATEWAY SUPPLY<`)).toBe(1);
    expect(count(svg, `>${sg.supplyConductor}<`)).toBe(1);
  });

  it('two leads: the 5 ft PCT lead up from L1 in the panel, the consumption lead from the MSP — each labelled once', () => {
    expect(md.leads!.map(l => l.label)).toEqual([
      'PCT LEAD 5 FT — DO NOT EXTEND',
      'CT LEADS 13 FT — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY',
    ]);
    const leads = leadsOf(svg);
    expect(leads).toHaveLength(2);
    const rings = ringsOf(svg), terms = terminalsOf(svg);
    for (const lead of leads) {
      expect(rings.some(r => near(r, lead[0], 4.5)), `starts at ${lead[0]}`).toBe(true);
      expect(terms.some(t => near(t, lead[lead.length - 1], 0.2)), `ends at ${lead[lead.length - 1]}`).toBe(true);
    }
    // The PCT lead is the short straight rise; the consumption lead runs from the MSP (right).
    const [pct, cons] = [...leads].sort((a, b) => a[0][0] - b[0][0]);
    expect(pct).toHaveLength(2);
    expect(pct[0][0]).toBe(pct[1][0]);
    expect(cons[0][0]).toBeGreaterThan(pct[0][0]);
    for (const l of md.leads!) expect(count(svg, `>${l.label}<`), l.label).toBe(1);
  });

  it('the schedule lists the gateway, per source', () => {
    expect(count(svg, '>STANDALONE GATEWAY<')).toBe(1);
    expect(count(svg, `>${sg.label}<`)).toBe(2);   // the node's nameplate and the PV-R cell
  });

  it('the lane band makes room above the chain; its gateway and labels collide with nothing', () => {
    expect(ctInkFindings(svg, gatewayTexts(sg)).map(describeFinding)).toEqual([]);
    expect(worseThanBare(svg, renderSLDProfessional(bare(input)))).toEqual([]);
  });
});

// ═════ 5. Every placement × both topologies ══════════════════════════════════
describe('every CT location × every MSP drawing × IQ Combiner / standalone: a lead to every CT, crossing nothing', () => {
  const CASES: Array<[IC, ConsumptionCtLocation | null]> = [
    ['LOAD_SIDE', null],                               // → sec-line-side-of-main
    ['LOAD_SIDE', 'main-breaker-load-side'],
    ['SUPPLY_SIDE_TAP', null],                         // → between-tap-and-main
    ['SUPPLY_SIDE_TAP', 'main-breaker-load-side'],
    ['SUPPLY_SIDE_TAP', 'sec-line-side-of-main'],      // designer-recorded; mode indeterminate, drawn
    ['MAIN_BREAKER_DERATE', null],                     // the backfed MSP
    ['MAIN_BREAKER_DERATE', 'main-breaker-load-side'],
  ];
  for (const sel of [FIVE_C, STANDALONE]) {
    for (const [ic, ct] of CASES) {
      for (const mode of ['sheet', 'e1'] as const) {
        it(`${sel} · ${ic} · ${ct ?? 'default'} · ${mode}`, () => {
          const { input, lanes } = hybrid([enphase('roof'), solarEdge('ground')], { sel, ic, ct });
          const md = lanes[0].meteringDrawing!;
          expect(md.consumption, 'the composer drew consumption CTs').not.toBeNull();
          const i = mode === 'e1' ? { ...input, ...E1 } : input;
          const svg = renderSLDProfessional(i);
          const leads = leadsOf(svg);
          expect(leads.length).toBe(md.leads!.length);
          // The consumption lead starts on a ring at the MSP (the MSP is right of
          // the combiner, so its lead starts furthest right).
          const cons = leads.reduce((a, b) => (a[0][0] > b[0][0] ? a : b));
          expect(ringsOf(svg).some(r => near(r, cons[0], 4.5))).toBe(true);
          expect(count(svg, `>CT×${md.consumption!.ctCount}<`)).toBe(1);
          const sg = lanes[0].standaloneGateway;
          expect(ctInkFindings(svg, sg ? gatewayTexts(sg) : []).map(describeFinding)).toEqual([]);
          expect(worseThanBare(svg, renderSLDProfessional(bare(i)))).toEqual([]);
        });
      }
    }
  }
});

// ═════ 6. More than one Enphase lane; a lower primary lane ═══════════════════
describe('a site has ONE service: one set of consumption CTs, whichever lanes meter', () => {
  it('roof IQ Combiner 5C + ground standalone gateway: one consumption lead (roof); the ground gateway gets its PCT lead only', () => {
    const { input, lanes } = hybrid([enphase('roof'), enphase('ground', 10)],
      { byLane: { roof: FIVE_C, ground: STANDALONE }, ic: 'LOAD_SIDE' });
    expect(lanes[1].meteringDrawing).toMatchObject({ consumption: null, lead: null, scheduleRow: null });
    const svg = renderSLDProfessional(input);
    const leads = leadsOf(svg);
    expect(leads).toHaveLength(2);                                   // roof consumption + ground PCT
    expect(count(svg, '>CT×2<')).toBe(1);
    expect(count(svg, `>${lanes[0].meteringDrawing!.leads![0].label}<`)).toBe(1);
    expect(count(svg, '>PCT LEAD 5 FT — DO NOT EXTEND<')).toBe(1);
    expect(count(svg, '>(N) MONITORING GATEWAY<')).toBe(1);
    expect(count(svg, 'data-device="enphase-iq-gateway"')).toBe(2);   // in the roof 5C, and the ground node
    expect(ctInkFindings(svg, gatewayTexts(lanes[1].standaloneGateway!)).map(describeFinding)).toEqual([]);
    // Two micro lanes put the shared panel 50 uu from the combiners, and the
    // feeder callout sat on the gateway; the corridor makes it its own room.
    expect(auditSld(svg).length).toBeLessThanOrEqual(auditSld(renderSLDProfessional(bare(input))).length);
  });

  it('roof standalone gateway + ground IQ Combiner 5C: the ground combiner draws its integral PCT and no lead', () => {
    const { input, lanes } = hybrid([enphase('roof'), enphase('ground', 10)],
      { byLane: { roof: STANDALONE, ground: FIVE_C }, ic: 'SUPPLY_SIDE_TAP' });
    expect(lanes[1].meteringDrawing!.production!.where).toBe('combiner-integral');
    expect('leads' in lanes[1].meteringDrawing!).toBe(false);
    const svg = renderSLDProfessional(input);
    expect(leadsOf(svg)).toHaveLength(2);                            // both the roof gateway's
    expect(count(svg, '>PCT<')).toBe(2);                             // roof panel field PCT + ground integral PCT
    expect(ctInkFindings(svg, gatewayTexts(lanes[0].standaloneGateway!)).map(describeFinding)).toEqual([]);
    expect(auditSld(svg).length).toBeLessThanOrEqual(auditSld(renderSLDProfessional(bare(input))).length);
  });

  it('roof string + ground IQ Combiner 5C: the lanes above are in the way, so the lead is STATED, not drawn through them', () => {
    const { input, lanes } = hybrid([solarEdge('roof'), enphase('ground')], { sel: FIVE_C, ic: 'LOAD_SIDE' });
    const md = lanes[1].meteringDrawing!;
    expect(md.consumption).not.toBeNull();
    const svg = renderSLDProfessional(input);
    expect(leadsOf(svg)).toHaveLength(0);
    // The CTs are still drawn where they clamp, with their count — and no bubble,
    // because the composer states a lead: its words go in the note, named to the lane.
    expect(count(svg, '>CT×2<')).toBe(1);
    expect(svg).not.toMatch(/>CT<\/text>/);
    expect(count(svg, `>PV-G: ${md.leads![0].label}<`)).toBe(1);
    expect(svg).not.toContain('CT Secondary Leads');                  // nothing drawn, nothing in the legend
    expect(ctInkFindings(svg).map(describeFinding)).toEqual([]);
    expect(worseThanBare(svg, renderSLDProfessional(bare(input)))).toEqual([]);
  });

  it('roof string + ground standalone gateway: its PCT lead is drawn in its lane; the consumption lead is stated', () => {
    const { input, lanes } = hybrid([solarEdge('roof'), enphase('ground')], { sel: STANDALONE, ic: 'SUPPLY_SIDE_TAP' });
    const [prod, cons] = lanes[1].meteringDrawing!.leads!;
    const svg = renderSLDProfessional(input);
    expect(leadsOf(svg)).toHaveLength(1);
    expect(count(svg, `>${prod.label}<`)).toBe(1);
    expect(count(svg, `>PV-G: ${cons.label}<`)).toBe(1);
    expect(count(svg, '>CT Secondary Leads (signal) — CT to gateway<')).toBe(1);
    expect(ctInkFindings(svg, gatewayTexts(lanes[1].standaloneGateway!)).map(describeFinding)).toEqual([]);
    expect(worseThanBare(svg, renderSLDProfessional(bare(input)))).toEqual([]);
  });
});

// ═════ 7. A drawing that states no leads ════════════════════════════════════
describe('a drawing that states no leads keeps the single-lane "CT" bubble continuation', () => {
  it('bubbles at the gateway and the CTs, keyed in the note; the continuation legend entry', () => {
    const { input } = hybrid([enphase('roof'), solarEdge('ground')], { sel: FIVE_C, ic: 'LOAD_SIDE' });
    const legacy = {
      ...input,
      sources: input.sources!.map(l => {
        const md = (l as MeteredSourceBranch).meteringDrawing;
        if (!md) return l;
        const { leads: _leads, ...rest } = md;
        return { ...l, meteringDrawing: rest };
      }),
    };
    const md = (legacy.sources![0] as MeteredSourceBranch).meteringDrawing!;
    const svg = renderSLDProfessional(legacy);
    expect(leadsOf(svg)).toHaveLength(0);
    expect(count(svg, '>CT</text>')).toBe(2);
    expect(count(svg, `>(CT) = ${md.lead!.label}<`)).toBe(1);
    expect(svg).toContain('continuation');
    expect(svg).not.toContain('CT to gateway');
  });
});

// ═════ 8. The artefacts: permit E-1 and both SLD routes ═════════════════════
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
/** Roof Enphase IQ8M micro (6) + ground Solis string (6) from the roof fixture —
 *  tests/hybridMeteringReachesEveryArtefact.test.ts's hybrid. */
function permitHybrid(over: Record<string, unknown> = {}) {
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
/** Every CT-coloured label on a sheet, in order — what "the same CTs" means across artefacts. */
const ctTextsOf = (svg: string) =>
  parseSld(svg).texts.filter(t => t.fill.toLowerCase() === CT.toLowerCase()).map(t => t.text).sort();

describe('the artefacts draw them: permit E-1 and both SLD routes', () => {
  for (const sel of [FIVE_C, STANDALONE]) {
    it(`permit E-1 (generateLiveSLD) · ${sel}: the roof lane's CTs and lead(s), labelled, colliding with nothing`, () => {
      const p = permitHybrid({ selectedCombinerId: sel });
      const cad = generateCADLayout(clone(p));
      const lanes = buildSLDInputFromPermit(p, cad).sources as MeteredSourceBranch[];
      const md = lanes[0].meteringDrawing!;
      const svg = generateLiveSLD(permitHybrid({ selectedCombinerId: sel }), cad, { embedded: true, topologyOnly: true });
      expect(leadsOf(svg).length).toBe(md.leads!.length);
      for (const l of md.leads!) expect(count(svg, `>${l.label}<`), l.label).toBe(1);
      expect(count(svg, `>CT×${md.consumption!.ctCount}<`)).toBe(1);
      const sg = lanes[0].standaloneGateway;
      expect(ctInkFindings(svg, sg ? gatewayTexts(sg) : []).map(describeFinding)).toEqual([]);
    }, 60_000);
  }

  const body = {
    format: 'svg', projectName: 'HY', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275',
    topologyType: 'HYBRID_MULTI_SOURCE', totalModules: 32, mainPanelAmps: 200, panelBusRating: 200,
    selectedCombinerId: FIVE_C, interconnection: 'SUPPLY_SIDE_TAP',
    sources: [enphase('roof'), solarEdge('ground')], runs: [],
  };
  const post = async (mod: { POST: (r: never) => Promise<Response> }, b: Record<string, unknown>) => {
    const res = await mod.POST(new Request('http://solarpro.test/api/engineering/sld', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never);
    expect(res.status).toBe(200);
    return res.text();
  };

  it('the Diagram tab route and the SLD export route draw the same CTs, leads and words', async () => {
    const diagram = await post(await import('@/app/api/engineering/sld/route'), body);
    const exported = await post(await import('@/app/api/engineering/sld/pdf/route'),
      { format: 'svg', buildInput: { ...body, format: undefined } });
    const { lanes } = hybrid([enphase('roof'), solarEdge('ground')], { sel: FIVE_C, ic: 'SUPPLY_SIDE_TAP' });
    const md = lanes[0].meteringDrawing!;
    for (const svg of [diagram, exported]) {
      expect(leadsOf(svg)).toHaveLength(1);
      expect(count(svg, `>${md.leads![0].label}<`)).toBe(1);
      expect(count(svg, '>CT Secondary Leads (signal) — CT to gateway<')).toBe(1);
    }
    expect(ctTextsOf(exported)).toEqual(ctTextsOf(diagram));
  }, 60_000);
});
