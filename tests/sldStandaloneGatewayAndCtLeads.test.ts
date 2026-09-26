// ============================================================================
// THE ENVOY ON ITS OWN WALL, AND THE CT LEADS DRAWN TO IT — Ray, 2026-09-26:
// "I would like to see CTs drawn from the Envoy to the MSP or wherever it is
// going to land. Also can I get a cool Envoy emblem that looks like an Envoy?"
//
// Two things the one-line could not say before:
//   1. "IQ Gateway (standalone) + PV AC combiner panel": the branches land on
//      2P breakers in a generic PV AC combiner panel, and the IQ Gateway is a
//      SEPARATE enclosure fed from its own 2P 15 A breaker in that panel. The
//      sheet drew the gateway INSIDE whatever box it drew, because
//      `combinerHasIntegratedGateway` was the only word it had.
//   2. The CT secondary leads were a "CT" bubble at each end. They are now
//      drawn — heavy dashed, CT to gateway, one per channel, as Enphase's own
//      line diagram (EN-IQ8-1PHN) draws them — each labelled once with the
//      composer's words (lib/equipment/designMetering.ts `leads`), never
//      crossing a label.
// Everything here is renderer-level: the input is what the adapters build.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderSLDProfessional, applyTypeFloor, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import type { ConsumptionCtLocation } from '@/lib/equipment/currentTransformers';

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

// The renderer narrates every anchor; keep the test output readable.
let logSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { logSpy.mockRestore(); });

const CT = '#6A1B9A';
const STANDALONE = 'enphase-iq-gateway-standalone';
const FIVE_C = 'enphase-iq-combiner-5c';

const BASE = {
  projectName: 'GW', clientName: 'Ray', address: '1 Test St', designer: 'T', drawingDate: '2026-09-26',
  drawingNumber: 'SLD-9', revision: 'A', scale: 'NOT TO SCALE', panelModel: 'Tesla TSP-420', panelWatts: 420,
  panelVoc: 40.92, panelIsc: 13.03, dcWireGauge: '#10', dcConduitType: 'EMT', mainPanelAmps: 200,
  utilityName: 'Ameren', hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};

/** The renderer input exactly as the PDF route builds it from the adapter. */
function sld(selected: string, interconnection: string, ctLocation: ConsumptionCtLocation | null = null,
  over: Partial<SLDProfessionalInput> = {}): SLDProfessionalInput {
  const f = sldCombinerFields({
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', isMicro: true,
    totalDevices: 30, branchCount: 3, hasBattery: false, selectedCombinerId: selected,
    interconnectionRaw: interconnection, ungroundedConductorCount: 2, consumptionCtLocation: ctLocation,
  });
  return {
    ...BASE, topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
    integratedDcDisconnect: false, totalModules: 30, totalStrings: 0, deviceCount: 30, dcOCPD: 0,
    inverterModel: 'IQ8+', inverterManufacturer: 'Enphase', acOutputKw: 8.7, acOutputAmps: 36.3,
    acWireGauge: '#8', acConduitType: 'EMT', acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
    interconnection,
    combinerLabel: f.combinerLabel, combinerModel: f.combinerModel,
    combinerHasIntegratedGateway: f.combinerHasIntegratedGateway,
    combinerProvidesAcDisconnect: f.combinerProvidesAcDisconnect,
    combinerSelectionIsDecided: f.combinerSelectionIsDecided,
    meteringChannels: f.combinerMeteringSummary,
    meteringDrawing: f.meteringDrawing ?? undefined,
    ...(f.standaloneGateway ? { standaloneGateway: f.standaloneGateway } : {}),
    ...over,
  } as SLDProfessionalInput;
}
const render = (i: SLDProfessionalInput) => applyTypeFloor(renderSLDProfessional(i));

// ── Geometry readers ────────────────────────────────────────────────────────
type Pt = [number, number];
const leadsOf = (svg: string): Pt[][] =>
  [...svg.matchAll(/<polyline points="([^"]+)" fill="none" stroke="#6A1B9A"/g)]
    .map(m => m[1].trim().split(/\s+/).map(p => p.split(',').map(Number) as Pt));
const ringsOf = (svg: string): Pt[] =>
  [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="(?:3\.8|3\.2)" fill="none" stroke="#6A1B9A"/g)]
    .map(m => [Number(m[1]), Number(m[2])]);
/** Each CT ring's bounding square. */
const ringBoxesOf = (svg: string): Array<[number, number, number, number]> =>
  [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="(3\.8|3\.2)" fill="none" stroke="#6A1B9A"/g)]
    .map(m => { const [x, y, r] = [Number(m[1]), Number(m[2]), Number(m[3])]; return [x - r, y - r, x + r, y + r]; });
const count = (s: string, needle: string) => s.split(needle).length - 1;

// ── The PRINTED face's advance widths ────────────────────────────────────────
// 'SolarPro Sans' is Liberation Sans (lib/permit/fonts/font-pack.manifest.json:
// "identical advance widths" to Arial). These are its advances in 1/1000 em,
// rounded UP, for ASCII 32–126 — read from the Arial hmtx, which is the metric
// Liberation Sans matches by design. A flat em factor was wrong both ways: at
// 0.6 em it passed a CT ring drawn on the 'E' of EXISTING SERVICE CONDUCTORS,
// and at 0.667 (a caps average) it failed the fixed ring, 4.5 uu clear, because
// that label's spaces and I's are 0.28 em. Italic advances equal regular here.
// Anything outside the table (⚡ and other symbols-face glyphs) counts a full em.
const ADV_REGULAR = [278,278,355,557,557,890,667,191,334,334,390,584,278,334,278,278,557,557,557,557,557,557,557,557,557,557,278,278,584,584,584,557,1016,667,667,723,723,667,611,778,723,278,500,667,557,834,723,778,667,778,723,667,611,723,667,944,667,667,611,278,278,278,470,557,334,557,557,500,557,557,278,557,557,223,223,500,223,834,557,557,557,557,334,500,278,557,500,723,500,500,500,334,260,334,584];
const ADV_BOLD = [278,334,475,557,557,890,723,238,334,334,390,584,278,334,278,278,557,557,557,557,557,557,557,557,557,557,334,334,584,584,584,611,976,723,723,723,723,667,611,778,723,278,557,723,611,834,723,778,667,778,723,667,611,723,667,944,667,667,611,334,278,334,584,557,334,557,611,557,611,557,334,611,611,278,278,557,278,890,611,611,611,611,390,557,334,611,557,778,557,557,500,390,280,390,584];
const ADV_EXTRA: Record<string, [number, number]> = {
  '—': [1000, 1000], '–': [557, 557], '×': [584, 584], 'Ω': [748, 802], '≤': [549, 549], '≥': [549, 549],
  '→': [1000, 1000], '·': [334, 334], 'Ø': [778, 778], '°': [400, 400], '±': [549, 549], '’': [223, 278],
};
function textWidth(t: string, bold: boolean, fs: number): number {
  let em = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    em += c >= 32 && c <= 126 ? (bold ? ADV_BOLD : ADV_REGULAR)[c - 32] / 1000
      : ADV_EXTRA[ch] ? ADV_EXTRA[ch][bold ? 1 : 0] / 1000 : 1;
  }
  return em * fs;
}

/**
 * Every schematic text box, in the printed face's metrics (above), excluding
 * text inside a nested transformed group (embedded symbol art, which no lead
 * goes near). Cap height 0.72 em (Liberation Sans: 0.716).
 */
function textBoxes(svg: string): Array<{ t: string; box: [number, number, number, number] }> {
  const out: Array<{ t: string; box: [number, number, number, number] }> = [];
  const stack: boolean[] = [];
  let seenScale = false;
  const re = /<(\/?)(g|text)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const [whole, close, tag] = m;
    if (tag === 'g') {
      if (close) { stack.pop(); continue; }
      const tr = /transform="/.test(whole);
      // The first transformed group is the schematic auto-scale — every lead
      // and every node label shares its frame, so it does not count as nested.
      if (tr && !seenScale) { seenScale = true; stack.push(false); } else stack.push(tr);
      continue;
    }
    if (tag === 'text' && !close) {
      if (stack.some(Boolean)) continue;
      const end = svg.indexOf('</text>', re.lastIndex);
      const raw = svg.slice(re.lastIndex, end);
      const a = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(whole)?.[1];
      const x = Number(a('x')), fs = Number(a('font-size'));
      const anc = a('text-anchor') ?? 'start';
      // The renderer writes "bold"; the device illustrations write "700".
      const bold = /font-weight="(?:bold|700)"/.test(whole);
      // A multi-line callout is one <text> of <tspan dy=…> lines: one box each.
      const spans = [...raw.matchAll(/<tspan x="[-\d.]+" dy="([-\d.]+)">([^<]*)<\/tspan>/g)];
      const lines = spans.length ? spans.map(s => ({ dy: Number(s[1]), t: s[2] })) : [{ dy: 0, t: raw }];
      let y = Number(a('y'));
      for (const l of lines) {
        y += l.dy;
        const t = l.t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const w = textWidth(t, bold, fs);
        const x0 = anc === 'middle' ? x - w / 2 : anc === 'end' ? x - w : x;
        if (t.trim()) out.push({ t, box: [x0, y - 0.72 * fs, x0 + w, y] });
      }
      re.lastIndex = end;
    }
  }
  return out;
}
/** Does the segment a→b pass through the box (shrunk by e)? Liang–Barsky. */
function crosses(a: Pt, b: Pt, [x0, y0, x1, y1]: [number, number, number, number], e = 0.4): boolean {
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - (x0 + e)], [dx, (x1 - e) - a[0]], [-dy, a[1] - (y0 + e)], [dy, (y1 - e) - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function leadsThroughText(svg: string): string[] {
  const boxes = textBoxes(svg);
  const hits: string[] = [];
  for (const lead of leadsOf(svg)) {
    for (let i = 1; i < lead.length; i++) {
      for (const b of boxes) if (crosses(lead[i - 1], lead[i], b.box)) hits.push(`${lead[i - 1]}→${lead[i]} × "${b.t}"`);
    }
  }
  return hits;
}
/** Does any CT ring (its bounding square, shrunk by e) overlap a text box? The
 *  lead check alone could not see a ring drawn on a label's first letter. */
function ringsOnText(svg: string, e = 0.4): string[] {
  const boxes = textBoxes(svg);
  const hits: string[] = [];
  for (const [rx0, ry0, rx1, ry1] of ringBoxesOf(svg)) {
    for (const b of boxes) {
      const [x0, y0, x1, y1] = b.box;
      if (rx1 - e > x0 && rx0 + e < x1 && ry1 - e > y0 && ry0 + e < y1) hits.push(`ring@${(rx0 + rx1) / 2},${(ry0 + ry1) / 2} × "${b.t}"`);
    }
  }
  return hits;
}

// ── The standalone gateway node ─────────────────────────────────────────────
describe('IQ Gateway (standalone) + PV AC combiner panel — the node', () => {
  const input = sld(STANDALONE, 'LOAD_SIDE');
  const svg = render(input);

  it('the adapter states the topology the renderer draws', () => {
    expect(input.standaloneGateway).toMatchObject({
      label: 'Enphase IQ Gateway', partNumber: 'ENV2-IQ-AM1-240', supplyBreakerA: 15,
      supplyConductor: '#14 AWG CU THWN-2 (L1, L2, N) + #14 EGC',
    });
    expect(input.combinerHasIntegratedGateway).toBe(false);
  });

  it('draws the gateway as its own enclosure, with the Envoy art, its model, part number and outdoor-enclosure note', () => {
    expect(svg).toContain('(N) MONITORING GATEWAY');
    expect(count(svg, 'data-device="enphase-iq-gateway"')).toBe(1);   // the node — nothing inside the panel
    expect(svg).toContain('Enphase IQ Gateway');
    expect(svg).toContain('P/N ENV2-IQ-AM1-240');
    expect(svg).toContain('NEMA 3R ENCL. IF OUTDOORS');
  });

  it('the combiner slot is the PV AC combiner panel — no integrated-gateway claim', () => {
    expect(svg).toContain(input.standaloneGateway!.landingLabel);
    expect(input.standaloneGateway!.landingLabel).toMatch(/PV AC Combiner Panel/);
    expect(svg).not.toContain('INTEGRATED GATEWAY / MONITORING');
  });

  it('draws the 2-pole 15 A supply breaker in the panel and the supply circuit with its conductor callout', () => {
    expect(svg).toContain('>15A 2P<');
    expect(svg).toContain('15A 2P — GATEWAY SUPPLY');
    expect(svg).toContain('#14 AWG CU THWN-2 (L1, L2, N) + #14 EGC');
  });

  it('the equipment schedule lists the gateway; the conductor schedule adds no row the permit schedule lacks', () => {
    expect(svg).toContain('Monitoring Gateway');
    expect(svg).toContain('Enphase IQ Gateway (ENV2-IQ-AM1-240) · 15A 2P SUPPLY');
    // The permit package prints PV-4B.1 (engine runs) instead of this band, and
    // no engine run carries the gateway circuit: a GW-1 row here alone made the
    // SLD PDF and the permit schedule disagree. The drawn callout states it.
    expect(svg).not.toContain('>GW-1<');
  });

  it('an absent standaloneGateway draws exactly what it drew before (absent ≡ undefined)', () => {
    const plain = sld(FIVE_C, 'LOAD_SIDE');
    expect(renderSLDProfessional({ ...plain, standaloneGateway: undefined }))
      .toBe(renderSLDProfessional({ ...plain }));
    expect(render(plain)).not.toContain('MONITORING GATEWAY');
    expect(render(plain)).not.toContain('>GW-1<');
  });
});

// ── The drawn CT leads ──────────────────────────────────────────────────────
describe('CT leads are drawn from the gateway to every CT, labelled once', () => {
  it('standalone: a production lead from the PCT in the PV panel and a consumption lead from the MSP CTs', () => {
    const input = sld(STANDALONE, 'LOAD_SIDE');
    const svg = render(input);
    const leads = leadsOf(svg);
    expect(leads).toHaveLength(2);
    const labels = input.meteringDrawing!.leads!.map(l => l.label);
    expect(labels).toEqual([
      'PCT LEAD 5 FT — DO NOT EXTEND',
      'CT LEADS 13 FT — EXTEND ≤1.5 Ω/WIRE, TWISTED PAIR IN RACEWAY',
    ]);
    for (const l of labels) expect(count(svg, `>${l}<`), l).toBe(1);
    // Each lead begins ON a CT ring.
    const rings = ringsOf(svg);
    for (const lead of leads) {
      const [x, y] = lead[0];
      expect(rings.some(([rx, ry]) => Math.hypot(rx - x, ry - y) <= 4.5), `lead starts at ${lead[0]}`).toBe(true);
    }
    // The legend names the drawn lead; the "CT" continuation bubble is gone.
    expect(svg).toContain('CT Secondary Leads (signal) — CT to gateway');
    expect(svg).not.toContain('continuation');
    expect(svg).not.toMatch(/>CT<\/text>/);
  });

  it('integrated IQ Combiner 5C: the consumption lead is drawn to the Envoy inside the combiner', () => {
    const input = sld(FIVE_C, 'LOAD_SIDE');
    const svg = render(input);
    expect(input.meteringDrawing!.leads!.map(l => l.channel)).toEqual(['consumption']);
    expect(leadsOf(svg)).toHaveLength(1);
    expect(count(svg, `>${input.meteringDrawing!.leads![0].label}<`)).toBe(1);
    // The gateway inside the combiner IS the Envoy — drawn as one.
    expect(count(svg, 'data-device="enphase-iq-gateway"')).toBe(1);
    expect(svg).toContain('INTEGRATED GATEWAY / MONITORING');
    expect(svg).not.toMatch(/>CT<\/text>/);
  });

  it('no metering drawing ⇒ no lead, no CT legend — the node is still drawn', () => {
    const svg = render(sld(STANDALONE, 'LOAD_SIDE', null, { meteringDrawing: undefined }));
    expect(leadsOf(svg)).toHaveLength(0);
    expect(svg).not.toContain('CT Secondary Leads');
    expect(svg).toContain('(N) MONITORING GATEWAY');
  });

  it('a drawing that states no leads keeps the legacy "CT" bubble continuation, unchanged', () => {
    const input = sld(FIVE_C, 'SUPPLY_SIDE_TAP');
    const { leads: _leads, ...legacy } = input.meteringDrawing!;
    const svg = render({ ...input, meteringDrawing: legacy });
    expect(leadsOf(svg)).toHaveLength(0);
    expect(svg).toMatch(/>CT<\/text>/);
    // The note keys the bubbles to the composer's one-line lead.
    expect(svg).toContain(`(CT) = ${legacy.lead!.label}`);
    // (The legend wraps this entry across two rows.)
    expect(svg).toContain('CT Secondary Leads (signal)');
    expect(svg).toContain('continuation');
    expect(svg).not.toContain('CT to gateway');
  });

  it('a drawn lead states ONE extension rule — the older one-line lead note is not repeated beside it', () => {
    for (const selected of [STANDALONE, FIVE_C]) {
      const input = sld(selected, 'LOAD_SIDE');
      const svg = render(input);
      const cons = input.meteringDrawing!.leads!.find(l => l.channel === 'consumption')!;
      expect(count(svg, `>${cons.label}<`), selected).toBe(1);             // ≤1.5 Ω/WIRE — on the lead
      expect(svg, selected).not.toContain(input.meteringDrawing!.lead!.label); // EXTEND / RACEWAY PER MFR
      expect(svg, selected).not.toContain('(CT) =');
    }
  });

  it('a brand with no gateway art: the drawn lead ends ON the plain gateway box, not in the air above it', () => {
    // Synthetic: no catalogue row pairs a non-Enphase combiner with metering
    // today, but the fallback box exists for one — and its lead must land.
    const input = sld(FIVE_C, 'LOAD_SIDE', null, {
      inverterManufacturer: 'Acme', combinerLabel: 'Acme Combiner X', combinerModel: 'Acme Combiner X',
    });
    const svg = render(input);
    expect(svg).not.toContain('data-device="enphase-iq-gateway"');
    const box = /<rect x="([-\d.]+)" y="([-\d.]+)" width="56" height="20" fill="#eef4fb"/.exec(svg);
    expect(box).not.toBeNull();
    const [bx, by] = [Number(box![1]), Number(box![2])];
    const leads = leadsOf(svg);
    expect(leads).toHaveLength(1);
    const [ex, ey] = leads[0][leads[0].length - 1];
    expect(ey).toBeCloseTo(by, 1);
    expect(ex).toBeGreaterThan(bx);
    expect(ex).toBeLessThan(bx + 56);
  });

  it('the CT tag states the composer\'s count, not a literal', () => {
    const input = sld(FIVE_C, 'LOAD_SIDE');
    const three = { ...input.meteringDrawing!, consumption: { ...input.meteringDrawing!.consumption!, ctCount: 3 } };
    expect(render({ ...input, meteringDrawing: three })).toContain('>CT×3<');
    expect(render(input)).toContain('>CT×2<');
  });
});

// ── Every placement, both topologies: a lead to every CT, through no text ──
describe('every CT location × every MSP drawing: one lead to the CTs, crossing no label', () => {
  const CASES: Array<[string, ConsumptionCtLocation | null]> = [
    ['LOAD_SIDE', null],                               // → sec-line-side-of-main
    ['LOAD_SIDE', 'main-breaker-load-side'],
    ['SUPPLY_SIDE_TAP', null],                         // → between-tap-and-main
    ['SUPPLY_SIDE_TAP', 'main-breaker-load-side'],
    // Designer-recorded; mode indeterminate, but drawn — its ring sat on the
    // same label as the load-side default's.
    ['SUPPLY_SIDE_TAP', 'sec-line-side-of-main'],
    ['BACKFED_BREAKER', null],                         // → sec-line-side-of-main
    ['BACKFED_BREAKER', 'main-breaker-load-side'],
  ];
  it('the crossing check itself can see a crossing (a guard that cannot fail proves nothing)', () => {
    const t = '<text x="100" y="100" font-size="8.67" text-anchor="middle">LABEL</text>';
    const through = `<svg>${t}<polyline points="100,120 100,80" fill="none" stroke="#6A1B9A"/></svg>`;
    const beside = `<svg>${t}<polyline points="130,120 130,80" fill="none" stroke="#6A1B9A"/></svg>`;
    const multi = '<svg><text x="100" y="100" font-size="8.67" text-anchor="middle"><tspan x="100" dy="0">A</tspan>'
      + '<tspan x="100" dy="9">LONG SECOND LINE</tspan></text><polyline points="120,112 120,104" fill="none" stroke="#6A1B9A"/></svg>';
    expect(leadsThroughText(through)).toHaveLength(1);
    expect(leadsThroughText(beside)).toEqual([]);
    expect(leadsThroughText(multi)).toHaveLength(1);    // hits the SECOND line, not the first
  });
  it('the ring check can see a ring on a label\'s first letter, measured in the printed face', () => {
    // The reported case, exactly: 'EXISTING SERVICE CONDUCTORS' centred at 1405
    // is 145.5 uu wide in Liberation Sans — its 'E' starts at 1332.3.
    const label = '<text x="1405" y="444" font-size="8.67" text-anchor="middle">EXISTING SERVICE CONDUCTORS</text>';
    const ring = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3.8" fill="none" stroke="#6A1B9A" stroke-width="1.2"/>`;
    expect(ringsOnText(`<svg>${label}${ring(1336, 437)}</svg>`)).toHaveLength(1);   // the old placement
    expect(ringsOnText(`<svg>${label}${ring(1324, 437)}</svg>`)).toEqual([]);       // 4.5 uu clear
    // A flat 0.6 em puts the 'E' at 1334.8 and would pass a ring at 1330,
    // which the printed face's 'E' does touch.
    expect(ringsOnText(`<svg>${label}${ring(1330, 437)}</svg>`)).toHaveLength(1);
  });
  for (const selected of [STANDALONE, FIVE_C]) {
    for (const [ic, loc] of CASES) {
      it(`${selected} · ${ic} · ${loc ?? 'default'}`, () => {
        const input = sld(selected, ic, loc);
        const svg = render(input);
        const leads = leadsOf(svg);
        expect(leads.length).toBe(input.meteringDrawing!.leads!.length);
        // The consumption lead starts on the consumption ring at the MSP (the
        // MSP is right of the combiner, so its lead starts furthest right).
        const cons = leads.reduce((a, b) => (a[0][0] > b[0][0] ? a : b));
        expect(ringsOf(svg).some(([x, y]) => Math.hypot(x - cons[0][0], y - cons[0][1]) <= 4.5)).toBe(true);
        expect(leadsThroughText(svg)).toEqual([]);
        expect(ringsOnText(svg)).toEqual([]);
      });
    }
  }
});

// ── The routes carry it ─────────────────────────────────────────────────────
describe('both SLD routes draw the standalone gateway', () => {
  const body = {
    format: 'svg', projectName: 'GW', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275',
    topologyType: 'MICROINVERTER', selectedBrand: 'enphase', systemType: 'roof',
    totalModules: 12, deviceCount: 12, totalStrings: 0,
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus',
    inverterAcKwPerDevice: 0.29, inverterAcCurrentMax: 1.21, acOutputKw: 12 * 0.29,
    panelModel: 'TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
    mainPanelAmps: 200, panelBusRating: 200, interconnection: 'LOAD_SIDE',
    inverterModulesPerDevice: 1, inverterBranchLimit: 13,
    selectedCombinerId: STANDALONE,
  };
  const post = async (mod: { POST: (r: never) => Promise<Response> }, b: Record<string, unknown>) => {
    const res = await mod.POST(new Request('http://solarpro.test/api/engineering/sld', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never);
    expect(res.status).toBe(200);
    return res.text();
  };

  it('the Diagram tab route (app/api/engineering/sld)', async () => {
    const svg = await post(await import('@/app/api/engineering/sld/route'), body);
    expect(svg).toContain('(N) MONITORING GATEWAY');
    expect(svg).toContain('P/N ENV2-IQ-AM1-240');
    expect(svg).toContain('PV AC Combiner Panel');
    expect(svg).not.toContain('INTEGRATED GATEWAY / MONITORING');
    expect(leadsOf(svg).length).toBeGreaterThan(0);
  }, 60_000);

  it('the export route (app/api/engineering/sld/pdf), svg format', async () => {
    const svg = await post(await import('@/app/api/engineering/sld/pdf/route'), body);
    expect(svg).toContain('(N) MONITORING GATEWAY');
    expect(svg).toContain('P/N ENV2-IQ-AM1-240');
    expect(leadsOf(svg).length).toBeGreaterThan(0);
  }, 60_000);

  it('the Diagram route prints the SAME gateway fields sldCombinerFields gives the export route', async () => {
    // The Diagram route resolves its own plan and builds StandaloneGatewayFields
    // itself (a copy of sldCombinerFields' mapping). Until that mapping is ONE
    // exported builder, this pins the two copies to the same printed strings.
    const f = sldCombinerFields({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: 'enphase-iq8plus', isMicro: true,
      totalDevices: 12, branchCount: 0, hasBattery: false, selectedCombinerId: STANDALONE,
      interconnectionRaw: 'LOAD_SIDE',
    });
    const sg = f.standaloneGateway!;
    expect(sg).toBeDefined();
    const svg = await post(await import('@/app/api/engineering/sld/route'), body);
    expect(svg).toContain(`>${sg.label}<`);
    expect(svg).toContain(`>P/N ${sg.partNumber}<`);
    expect(svg).toContain(`>${sg.supplyBreakerA}A 2P — GATEWAY SUPPLY<`);
    expect(svg).toContain(`>${sg.supplyConductor}<`);
    expect(svg).toContain(sg.landingLabel);
  }, 60_000);

  it('an IQ Combiner job through the same route draws no standalone node', async () => {
    const svg = await post(await import('@/app/api/engineering/sld/route'), { ...body, selectedCombinerId: FIVE_C });
    expect(svg).not.toContain('MONITORING GATEWAY');
    expect(svg).toContain('INTEGRATED GATEWAY / MONITORING');
  }, 60_000);
});
