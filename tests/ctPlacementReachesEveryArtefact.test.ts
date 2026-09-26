// ============================================================================
// CT LOGIC, EVERYWHERE — Ray, 2026-09-25: "there is no ct logic whatsoever."
//
// The CT authority could always tell production from consumption and Net from
// Total, but nothing ever told it WHERE the consumption CTs clamp: every
// Enphase job printed "CONS (MODE TBD)", five call sites composed metering on
// their own, and no drawing showed a CT. One composer (designMetering) now
// feeds the engineering SLD, the SLD PDF, the permit E-1/E-1.1, PV-4A, both
// BOMs and the engineering page; the location defaults from the
// interconnection the designer already chose, is labelled a default, and can
// be changed with no questions asked.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../test-fixtures/roofProject';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import { consumptionCtBoundaryFor, defaultConsumptionCtLocation, deriveConsumptionMeteringMode } from '@/lib/equipment/currentTransformers';
import { getBosDevice } from '@/lib/equipment/integratedBos';
import { buildSLDInputFromPermit } from '@/lib/permit/utils/sldAdapter';
import { buildPermitDesignSnapshot } from '@/lib/permit/snapshot/build';
import { computeSnapshotDigest } from '@/lib/permit/snapshot/digest';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { interconnectionRuleOf, permitInterconnectionToken } from '@/lib/permit/utils/interconnectionRule';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { groundProject } from '../test-fixtures/groundProject';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { generatePermitHTML } from '@/lib/permit/generatePermit';
import { isSupplySideInterconnection } from '@/lib/permit/utils/helpers';

vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => { throw err instanceof Error ? err : new Error(String(err)); },
}));

const plan = (id: string) => {
  const d = getBosDevice(id)!;
  return { brains: { brand: d.brand, model: d.model, metering: (d as any).metering }, hasIntegratedGateway: true };
};
const FIVE_C = 'enphase-iq-combiner-5c';
const SIX_C = 'enphase-iq-combiner-6c';

describe('the location vocabulary — one table', () => {
  it('defaults follow Enphase: supply-side tap → between tap and main (Total); load-side → ahead of the main (Net)', () => {
    expect(defaultConsumptionCtLocation('supply-side')).toBe('between-tap-and-main');
    expect(defaultConsumptionCtLocation('load-side')).toBe('sec-line-side-of-main');
    expect(defaultConsumptionCtLocation('unresolved')).toBeNull();
    const m = (loc: any, side: any) => deriveConsumptionMeteringMode(consumptionCtBoundaryFor(loc, side), side);
    expect(m('between-tap-and-main', 'supply-side')).toBe('LOAD_ONLY');
    expect(m('sec-line-side-of-main', 'load-side')).toBe('LOAD_WITH_SOLAR');
    expect(m('main-breaker-load-side', 'supply-side')).toBe('LOAD_ONLY');
    expect(m('main-breaker-load-side', 'load-side')).toBe('LOAD_WITH_SOLAR');
    // refusals survive: no tap on a load-side job; CTs on the tapped span.
    expect(m('between-tap-and-main', 'load-side')).toBe('INDETERMINATE');
    expect(m('sec-line-side-of-main', 'supply-side')).toBe('INDETERMINATE');
  });
});

describe('Ray\'s job: IQ Combiner 5C, supply-side tap', () => {
  const met = resolveDesignMetering({ plan: plan(FIVE_C), interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
  it('resolves — no more MODE TBD', () => {
    expect(met.resolution!.consumptionMode).toBe('LOAD_ONLY');
    expect(met.scheduleValue).toBe('PROD (INT.) · CONS (TOTAL)');
    expect(met.resolution!.blockerCode).toBeNull();
  });
  it('places 2 in-box CTs between the tap and the main, said to be a default', () => {
    expect(met.placement).toMatchObject({ location: 'between-tap-and-main', basis: 'interconnection-default' });
    expect(met.drawing!.consumption).toMatchObject({ ctCount: 2, supplied: 'in-box', mode: 'LOAD_ONLY' });
    expect(met.drawing!.scheduleRow).toContain('TAP → MAIN');
    expect(met.drawing!.scheduleRow).toContain('DEFAULT — FIELD VERIFY');
    expect(met.drawing!.production!.where).toBe('combiner-integral');
    expect(met.drawing!.lead).toBeTruthy();
    expect(met.placementNote).toMatch(/Total/);
  });
});

describe('the designer can move them — and an impossible record refuses', () => {
  it('a recorded location is used and labelled as recorded', () => {
    const met = resolveDesignMetering({ plan: plan(FIVE_C), interconnectionRaw: 'SUPPLY_SIDE_TAP',
      consumptionCtLocation: 'main-breaker-load-side', systemVoltage: 240 });
    expect(met.placement.basis).toBe('designer-recorded');
    expect(met.drawing!.consumption!.location).toBe('main-breaker-load-side');
    expect(met.drawing!.scheduleRow).not.toContain('DEFAULT');
  });
  it('"between tap and main" on a job with no tap draws no CTs and says why', () => {
    const met = resolveDesignMetering({ plan: plan(FIVE_C), interconnectionRaw: 'LOAD_SIDE',
      consumptionCtLocation: 'between-tap-and-main', systemVoltage: 240 });
    expect(met.drawing?.consumption ?? null).toBeNull();
    expect(met.placementNote).toMatch(/does not exist on this interconnection/);
  });
  it('the 6C still buys its CTs (candidate SKU) and now has a mode', () => {
    const met = resolveDesignMetering({ plan: plan(SIX_C), interconnectionRaw: 'LOAD_SIDE', systemVoltage: 240 });
    expect(met.resolution!.lines.length).toBeGreaterThan(0);
    expect(met.resolution!.consumptionMode).toBe('LOAD_WITH_SOLAR');
    expect(met.drawing!.consumption!.supplied).toBe('order-separately');
  });
});

// ── The drawings ────────────────────────────────────────────────────────────
const BASE = {
  projectName: 'CT', clientName: 'Ray', address: '1 Test St', designer: 'T', drawingDate: '2026-09-25',
  drawingNumber: 'CT-1', revision: 'A', scale: 'NOT TO SCALE', panelModel: 'Tesla TSP-420', panelWatts: 420,
  panelVoc: 40.92, panelIsc: 13.03, dcWireGauge: '#10', dcConduitType: 'EMT', mainPanelAmps: 200,
  utilityName: 'Ameren', hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const microSld = (over: Partial<SLDProfessionalInput> = {}): SLDProfessionalInput => ({
  ...BASE, topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 32, totalStrings: 0, deviceCount: 32, dcOCPD: 0,
  inverterModel: 'IQ8+', inverterManufacturer: 'Enphase', acOutputKw: 9.28, acOutputAmps: 38.7,
  acWireGauge: '#8', acConduitType: 'EMT', acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  combinerHasIntegratedGateway: true, interconnection: 'SUPPLY_SIDE_TAP', ...over,
} as SLDProfessionalInput);

describe('the SLD draws the CTs', () => {
  const met = resolveDesignMetering({ plan: plan(FIVE_C), interconnectionRaw: 'SUPPLY_SIDE_TAP', systemVoltage: 240 });
  it('production CT, consumption CTs, the lead continuation, the schedule row and the legend', () => {
    const svg = renderSLDProfessional(microSld({ meteringChannels: met.scheduleValue, meteringDrawing: met.drawing! }));
    expect(svg).toContain('PCT');
    expect(svg).toContain('CT×2');
    expect(svg).toContain('CONSUMPTION CTs @ MSP');
    expect(svg).toContain('LOAD ONLY (TOTAL)');
    expect(svg).toContain('Consumption CTs');
    expect(svg).toContain('CT Secondary Leads');
  });
  it('without a metering drawing nothing CT-related is drawn (legacy byte-identity)', () => {
    const svg = renderSLDProfessional(microSld());
    expect(svg).not.toContain('CT×2');
    expect(svg).not.toContain('CT Secondary Leads');
  });
});

// ── The permit pipeline ─────────────────────────────────────────────────────
const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
const job = (over: Record<string, unknown> = {}) => {
  const p = JSON.parse(JSON.stringify(roofProject));
  p.project.selectedCombinerId = FIVE_C;
  p.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
  Object.assign(p.project, over);
  return p;
};

describe('the permit E-1 gets the same answer', () => {
  it('E-1 input carries the CT drawing and the TOTAL mode', () => {
    const sld = buildSLDInputFromPermit(job(), cad);
    expect(sld.meteringChannels).toBe('PROD (INT.) · CONS (TOTAL)');
    expect(sld.meteringDrawing?.consumption?.location).toBe('between-tap-and-main');
  });
  it('a recorded location reaches E-1', () => {
    const sld = buildSLDInputFromPermit(job({ consumptionCtLocation: 'main-breaker-load-side' }), cad);
    expect(sld.meteringDrawing?.consumption?.location).toBe('main-breaker-load-side');
  });
});

describe('digest: only an explicit record moves it', () => {
  const snap = (p: any) => buildPermitDesignSnapshot(p, cad, { projectId: 'p1', designVersionId: 'v1' }) as any;
  const digestOf = (p: any) => computeSnapshotDigest(snap(p));
  it('no record ⇒ no meteringTopology key at all (the snapshot shape is unchanged)', () => {
    for (const v of [undefined, null, '']) {
      const s = snap(job(v === undefined ? {} : { consumptionCtLocation: v }));
      expect(s.electrical.meteringTopology, String(v)).toBeUndefined();
    }
    expect(digestOf(job({ consumptionCtLocation: '' }))).toBe(digestOf(job()));
  });
  it('a recorded location is in the snapshot and moves the digest', () => {
    const p = job({ consumptionCtLocation: 'main-breaker-load-side' });
    expect(snap(p).electrical.meteringTopology).toMatchObject({ consumptionCtLocation: 'main-breaker-load-side', mode: 'LOAD_ONLY' });
    expect(digestOf(p)).not.toBe(digestOf(job()));
  });
});

// ── One interconnection rule per package (review, 2026-09-25) ──────────────
// The survey writes FREE TEXT into interconnectionMethod. The snapshot decides
// the rule from it; E-1, PV-1, the general notes, the permit BOM, the CT record,
// the legacy electrical calc and the computeSystem runs used to read the raw
// text as an exact token — so one surveyed supply-side package said
// "CONS (MODE TBD)" on E-1 and "CONS (TOTAL)" on PV-4A, routed its last run to
// the main panel instead of the tap, and printed the 705.12 backfeed note.
const SURVEY_TEXT: Array<[string, 'SUPPLY_SIDE_TAP' | 'LOAD_SIDE']> = [
  ['Supply-Side (NEC 705.11)', 'SUPPLY_SIDE_TAP'],
  ['Load-Side Breaker (NEC 705.12(B)(2)) — max NA', 'LOAD_SIDE'],
  ['Panel Upgrade Required', 'LOAD_SIDE'],
  ['See Electrical Engineer', 'LOAD_SIDE'],
];

/** Every leaf where two snapshots differ, as [path, a, b]. */
function leafDiff(a: unknown, b: unknown, path = '', out: Array<[string, unknown, unknown]> = []) {
  if (a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) { out.push([path, a, b]); return out; }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) leafDiff(ao[k], bo[k], `${path}.${k}`, out);
  return out;
}
const generated = (method: string) => {
  const p = job({ interconnectionMethod: method });
  const html = generatePermitHTML(p);
  return { html, snap: (p as { _snapshot?: Record<string, unknown> })._snapshot! };
};

describe("the interconnection rule is the snapshot's, everywhere", () => {
  it('tokens pass through; free text resolves by the one rule; a line-side tap is 705.11', () => {
    for (const t of ['LOAD_SIDE', 'SUPPLY_SIDE_TAP', 'MAIN_BREAKER_DERATE', 'PANEL_UPGRADE']) {
      expect(permitInterconnectionToken(t)).toBe(t);
    }
    for (const [text, token] of SURVEY_TEXT) expect(permitInterconnectionToken(text), text).toBe(token);
    for (const v of [undefined, null, '']) expect(permitInterconnectionToken(v)).toBe('LOAD_SIDE');
    expect(interconnectionRuleOf('Supply-Side (NEC 705.11)')).toBe('705.11');
    expect(interconnectionRuleOf(undefined)).toBe('705.12(B)');
    // The predicate the snapshot's tap topology, tap-connection authority and
    // tap-span grade always used — the rule line was the one that disagreed.
    expect(interconnectionRuleOf('LINE_SIDE_TAP')).toBe('705.11');
    expect(permitInterconnectionToken('LINE_SIDE_TAP')).toBe('SUPPLY_SIDE_TAP');
    expect(isSupplySideInterconnection({ project: { interconnectionMethod: 'Supply-Side (NEC 705.11)' } })).toBe(true);
    expect(isSupplySideInterconnection({ project: { interconnectionMethod: 'Panel Upgrade Required' } })).toBe(false);
  });

  it('E-1 states the same metering as PV-4A for every survey spelling, and for none', () => {
    for (const text of [...SURVEY_TEXT.map(s => s[0]), undefined, '']) {
      const p = job({ interconnectionMethod: text });
      const rule = snapOf(p).project.interconnection.rule;
      // PV-4A's own mapping (lib/permit/sections/electricalPages.ts).
      const pv4a = resolveDesignMetering({ plan: plan(FIVE_C),
        interconnectionRaw: rule === '705.11' ? 'SUPPLY_SIDE_TAP' : 'LOAD_SIDE', systemVoltage: 240 });
      const e1 = buildSLDInputFromPermit(p, cad);
      expect(e1.meteringChannels, String(text)).toBe(pv4a.scheduleValue);
      expect(e1.meteringChannels, String(text)).not.toContain('MODE TBD');
      expect(e1.meteringDrawing?.consumption?.location, String(text)).toBe(pv4a.drawing?.consumption?.location);
    }
  });

  it("E-1 draws the MSP for the snapshot's side", () => {
    const msp = (m: string) => buildSLDInputFromPermit(job({ interconnectionMethod: m }), cad).interconnection;
    expect(msp('Supply-Side (NEC 705.11)')).toBe('Supply Side Tap');
    expect(msp('LINE_SIDE_TAP')).toBe('Supply Side Tap');
    expect(msp('Load-Side Breaker (NEC 705.12(B)(2)) — max NA')).toBe('Load Side Tap');
    // tokens draw what they always drew
    expect(msp('SUPPLY_SIDE_TAP')).toBe('Supply Side Tap');
    expect(msp('LOAD_SIDE')).toBe('Load Side Tap');
    expect(msp('MAIN_BREAKER_DERATE')).toBe('MAIN_BREAKER_DERATE');
  });

  it("the permit BOM buys for the snapshot's side — equipment AND run lengths", () => {
    const key = (items: ReturnType<typeof generateBOMForPermit>) =>
      items.map(i => `${i.category}|${i.partNumber ?? ''}|${i.quantity}`).sort().join('\n');
    expect(key(generateBOMForPermit(job({ interconnectionMethod: 'Supply-Side (NEC 705.11)' }), cad)))
      .toBe(key(generateBOMForPermit(job({ interconnectionMethod: 'SUPPLY_SIDE_TAP' }), cad)));
  });

  it('a surveyed supply-side package IS the supply-side design: the snapshot differs only where it quotes the text', () => {
    const TEXT = 'Supply-Side (NEC 705.11)';
    const token = generated('SUPPLY_SIDE_TAP'), survey = generated(TEXT);
    const body = (s: Record<string, unknown>) => { const c = JSON.parse(JSON.stringify(s)); delete c.meta; return c; };
    const diffs = leafDiff(body(token.snap), body(survey.snap));
    // What USED to differ: the last run went to the MAIN SERVICE PANEL (15 ft)
    // instead of the tap (10 ft, design constraint), a TAP-CONDUCTOR-LENGTH
    // blocker appeared, and the legacy/canonical parity check disagreed.
    expect(diffs.length).toBeGreaterThan(0);
    for (const [path, a, b] of diffs) {
      expect(path, `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
        .toMatch(/^\.(project\.interconnection\.method|electrical\.poi\.method|electrical\.supplySideTapConnection\.interconnectionMethod|electrical\.parity\.checks\.\d+\.canonical)$/);
      expect([a, b]).toEqual(['SUPPLY_SIDE_TAP', TEXT]);
    }
    // …and the sheets say what the token package says.
    const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
    for (const re of [/supply-side tap per NEC 705\.11/g, /705\.12\(B\)\(2\)\(3\)\(b\)/g, /MODE TBD/g, /SUPPLY-SIDE TAP POINT/g]) {
      expect(count(survey.html, re), String(re)).toBe(count(token.html, re));
    }
    expect(count(survey.html, /supply-side tap per NEC 705\.11/g)).toBeGreaterThan(0);
  });
});

const snapOf = (p: any) => buildPermitDesignSnapshot(p, cad, { projectId: 'p1', designVersionId: 'v1' }) as any;

// ── Only a micro job draws CTs ─────────────────────────────────────────────
// A combiner selection is cleared only by an explicit DELETE, so a job switched
// from Enphase to a string inverter still carries one. Nothing on that sheet is
// a combiner or a gateway, so nothing on it may be a CT.
describe('a string job with a leftover combiner pick draws no CTs', () => {
  const stringJob = () => {
    const p = JSON.parse(JSON.stringify(groundProject));
    p.project.selectedCombinerId = FIVE_C;
    p.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    p.project.consumptionCtLocation = 'main-breaker-load-side';
    return p;
  };
  const stringCad = () => generateCADLayout(groundProject as any);

  it('the SLD PDF / page fields', () => {
    const f = sldCombinerFields({ inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US', isMicro: false,
      totalDevices: 40, branchCount: 0, hasBattery: false, selectedCombinerId: FIVE_C,
      interconnectionRaw: 'SUPPLY_SIDE_TAP', consumptionCtLocation: 'main-breaker-load-side' });
    expect(f.meteringDrawing).toBeNull();
    expect(f.combinerMeteringSummary).toBeUndefined();
  });
  it('the permit E-1', () => {
    const sld = buildSLDInputFromPermit(stringJob(), stringCad());
    expect(sld.meteringDrawing).toBeUndefined();
    expect(sld.meteringChannels).toBeUndefined();
  });
  it('the snapshot records nothing, so the recorded location cannot move the digest', () => {
    const s = buildPermitDesignSnapshot(stringJob(), stringCad(), { projectId: 'p1', designVersionId: 'v1' }) as any;
    expect(s.electrical.meteringTopology).toBeUndefined();
  });
});
