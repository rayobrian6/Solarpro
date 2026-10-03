// ═══════════════════════════════════════════════════════════════════════════
// SLD RUN AUTHORITY — DIRECT-TO-EQUIPMENT, TERMINAL-TO-TERMINAL.
//
// Ray: "no generic equipment boxes around equipment that has actual artwork; draw the actual device;
// conductors land on named terminals… route the line directly to the receiving equipment; print the
// conductor/raceway callout along that actual run." And: "Device artwork owns terminal coordinates.
// The engineered run owns source terminal + destination terminal. The renderer connects them."
//
// So: the Powerwall 3 and Gateway 3 art carry their own terminal tables; on the compact sheet they
// are drawn frameless; each storage circuit leaves its own unit's AC terminal for its own breaker;
// the generation feeder lands on the gateway's DER terminal, the backup feeder leaves its LOAD
// terminal, the branch feeder lands on its utility terminal; every callout is the run's own.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { renderTopologyServiceSection, type ServiceSectionResult } from '@/lib/sld-professional-renderer';
import { resolveDeviceIllustrationByModel, illustrationTerminal, illustrationBody } from '@/lib/sld-device-illustrations';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { setStoragePvInput } from '@/lib/electrical/topologyAuthoring';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import { engineerServiceRuns, runEnvironmentFrom, runCallout, type EngineeredRun } from '@/lib/electrical/electricalRuns';

const quietly = <T>(fn: () => T): T => {
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};
const raysLanded = (): ServiceTopology => {
  let t = buildRaysIntendedJob().topology;
  t.storage.filter(u => u.role === 'inverter-unit')
    .forEach((u, k) => { t = setStoragePvInput(t, u.id, k === 0 ? 8.36 : k === 2 ? 7.92 : 0); });
  return t;
};
const section = (t: ServiceTopology, runs?: EngineeredRun[]): ServiceSectionResult => quietly(() => renderTopologyServiceSection({
  topology: t,
  startX: 710, endX: 1974, busY: 479, minY: 100, maxY: 1070,
  utilityName: 'ComEd', calloutStart: 7, hasGenerator: false,
  notes: { x: 70, y: 715, w: 600, maxY: 1060 },
  compactDc: {
    region: { x0: 56, x1: 1974, y0: 92, y1: 1080 },
    pvBlock: { w: 482, h: 244, outDx: 458, outDy: 112 },
    totalStrings: 0, dcWireGauge: '#10', dcConduitType: 'EMT',
  },
  runs,
}));
const dots = (svg: string) => [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="1.9"[^>]*data-terminal="1"\/>/g)]
  .map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
const hasDotAt = (svg: string, q: { x: number; y: number }) => dots(svg).some(d => Math.abs(d.x - q.x) < 0.6 && Math.abs(d.y - q.y) < 0.6);
const lines = (svg: string) => [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)]
  .map(m => m.slice(1, 5).map(Number));
const endsAt = (svg: string, q: { x: number; y: number }) => lines(svg).some(([x1, y1, x2, y2]) =>
  (Math.abs(x1 - q.x) < 0.6 && Math.abs(y1 - q.y) < 0.6) || (Math.abs(x2 - q.x) < 0.6 && Math.abs(y2 - q.y) < 0.6));
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].replace(/&quot;/g, '"'));
const count = (xs: string[], s: string) => xs.filter(x => x === s).length;

/** A device's drawn art body, from the section's own box record (frameless ⇒ the box IS the art). */
const artBox = (s: ServiceSectionResult, id: string) => {
  const b = s.boxes.find(x => x.id === id);
  if (!b) throw new Error(`no box ${id}`);
  return b;
};
/** The art's terminal, computed from the art's own table and the box it was drawn in. */
const terminalOf = (model: string, b: { x: number; y: number; w: number; h: number }, id: string, facing?: 'L' | 'R') => {
  const ill = resolveDeviceIllustrationByModel(model)!;
  return illustrationTerminal(ill, id, b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, facing)!;
};

describe('the device art owns its terminals', () => {
  it('Powerwall 3: AC out of the bottom, the PV input bank on top', () => {
    const pw3 = resolveDeviceIllustrationByModel('Tesla Powerwall 3')!;
    expect(pw3.terminals).toEqual({ BATTERY_AC: [0.5, 1], PV_DC_IN: [0.5, 0] });
  });

  it('Gateway 3: utility on either flank, backed-up loads out of the bottom, DER in from the top', () => {
    const gw3 = resolveDeviceIllustrationByModel('Tesla Backup Gateway 3')!;
    expect(Object.keys(gw3.terminals ?? {}).sort()).toEqual(['DER_IN', 'GRID_IN@L', 'GRID_IN@R', 'LOAD_OUT']);
  });

  it('a terminal is a fraction of the drawn body, at any size, and the facing flank is honoured', () => {
    const gw3 = resolveDeviceIllustrationByModel('Tesla Backup Gateway 3')!;
    const body = illustrationBody(gw3, 100, 200, 64, 84);
    expect(illustrationTerminal(gw3, 'LOAD_OUT', 100, 200, 64, 84)).toEqual({ x: 100, y: body.y + body.h });
    expect(illustrationTerminal(gw3, 'GRID_IN', 100, 200, 64, 84, 'R')!.x).toBeCloseTo(body.x + body.w);
    expect(illustrationTerminal(gw3, 'GRID_IN', 100, 200, 64, 84, 'L')!.x).toBeCloseTo(body.x);
    // A device with no table has no terminals — the layout keeps its box.
    expect(illustrationTerminal({ aspectW: 1, aspectH: 1 }, 'LOAD_OUT', 0, 0, 10, 10)).toBeNull();
  });
});

describe('🚨 Ray\'s job, compact sheet: every conductor lands on the device it serves', () => {
  const t = raysLanded();
  const runs = engineerServiceRuns(t, runEnvironmentFrom({ state: 'IL', racewayType: 'EMT' }));
  const s = section(t, runs);
  const units = t.storage.filter(u => u.role === 'inverter-unit');

  it('the Powerwalls and Gateways are drawn as their artwork — no box around them', () => {
    for (const u of units) expect(artBox(s, `ess-${u.id}`).w, 'a Powerwall drawn in a box').toBeLessThan(60);
    for (const d of t.domains) expect(artBox(s, `gateway-${d.gateway.id}`).w, 'a gateway drawn in a box').toBeLessThan(70);
    // Their words are beside the art, not dropped.
    expect(texts(s.svg)).toContain('Tesla Powerwall 3 #1');
    expect(count(texts(s.svg), 'Tesla Backup Gateway 3')).toBe(2);
  });

  it('each Powerwall circuit leaves its OWN unit\'s AC terminal, for its OWN breaker — no shared collector', () => {
    for (const u of units) {
      const tAc = terminalOf('Tesla Powerwall 3', artBox(s, `ess-${u.id}`), 'BATTERY_AC');
      expect(hasDotAt(s.svg, tAc), `no terminal at ${u.id}'s AC terminal`).toBe(true);
      expect(endsAt(s.svg, tAc), `no conductor starts at ${u.id}'s AC terminal`).toBe(true);
    }
    // Two circuits land on each generation panel, at two distinct breaker positions on its top edge.
    for (const agg of t.aggregationPanels) {
      const gb = artBox(s, `aggregation-${agg.id}`);
      const onTop = dots(s.svg).filter(d => Math.abs(d.y - gb.y) < 0.6 && d.x > gb.x && d.x < gb.x + gb.w);
      expect(new Set(onTop.map(d => d.x.toFixed(1))).size, `${agg.label}: its circuits share one landing`).toBe(2);
    }
  });

  it('🚨 move a terminal in the ART and the conductor moves with it — the layout invents no position', () => {
    const pw3 = resolveDeviceIllustrationByModel('Tesla Powerwall 3')! as { terminals?: Record<string, readonly [number, number]> };
    const gw3 = resolveDeviceIllustrationByModel('Tesla Backup Gateway 3')! as { terminals?: Record<string, readonly [number, number]> };
    const was = { pw3: pw3.terminals, gw3: gw3.terminals };
    pw3.terminals = { ...was.pw3, BATTERY_AC: [0.2, 1] };
    gw3.terminals = { ...was.gw3, LOAD_OUT: [0.8, 1], DER_IN: [0.3, 0] };
    try {
      const s2 = section(t, runs);
      for (const u of units) {
        const q = terminalOf('Tesla Powerwall 3', artBox(s2, `ess-${u.id}`), 'BATTERY_AC');
        expect(endsAt(s2.svg, q), `${u.id}: the circuit did not follow the art's AC terminal`).toBe(true);
      }
      for (const d of t.domains) {
        const gb = artBox(s2, `gateway-${d.gateway.id}`);
        for (const id of ['LOAD_OUT', 'DER_IN']) {
          expect(endsAt(s2.svg, terminalOf('Tesla Backup Gateway 3', gb, id)), `${d.label}: ${id} did not follow the art`).toBe(true);
        }
      }
    } finally {
      pw3.terminals = was.pw3;
      gw3.terminals = was.gw3;
    }
  });

  it('the generation feeder lands on the gateway\'s DER terminal; the backup feeder leaves its LOAD terminal', () => {
    for (const d of t.domains) {
      const gb = artBox(s, `gateway-${d.gateway.id}`);
      for (const id of ['DER_IN', 'LOAD_OUT']) {
        const q = terminalOf('Tesla Backup Gateway 3', gb, id);
        expect(hasDotAt(s.svg, q) && endsAt(s.svg, q), `${d.label}: nothing lands on ${id}`).toBe(true);
      }
    }
  });

  it('the branch feeder lands on the gateway\'s utility terminal, on the flank facing the service', () => {
    const dist = artBox(s, 'service-distribution');
    for (const d of t.domains) {
      const gb = artBox(s, `gateway-${d.gateway.id}`);
      const facing = gb.x < dist.x ? 'R' : 'L';
      const q = terminalOf('Tesla Backup Gateway 3', gb, 'GRID_IN', facing);
      expect(hasDotAt(s.svg, q) && endsAt(s.svg, q), `${d.label}: the branch does not land on GRID_IN@${facing}`).toBe(true);
    }
  });

  it('the DC trunk lands on the PV input of exactly the units the design lands PV on', () => {
    const landed = units.filter(u => (u.pvDcStcKw ?? 0) > 0);
    for (const u of units) {
      const q = terminalOf('Tesla Powerwall 3', artBox(s, `ess-${u.id}`), 'PV_DC_IN');
      expect(hasDotAt(s.svg, q), `${u.id}: PV landing drawn = ${landed.includes(u)}`).toBe(landed.includes(u));
    }
  });

  it('every callout is the run\'s own words — the schedule\'s, the BOM\'s, PV-4B\'s', () => {
    const ts = texts(s.svg);
    // Each drawn conductor's callout, once — a branch feeder is two segments through its switch but
    // one conductor set, so one callout per branch. Runs of different kinds may share a first line
    // (the backup and branch feeders are both 3/0 sets), so lines are counted across kinds.
    const expected = new Map<string, number>();
    for (const r of runs) {
      if (r.role === 'branch-feeder' && r.source.deviceId !== 'service-distribution') continue;
      const first = runCallout(r)[0];
      expected.set(first, (expected.get(first) ?? 0) + 1);
    }
    for (const [first, n] of expected) expect(count(ts, first), first).toBe(n);
    expect(ts).toContain('2" EMT');
    expect(ts).not.toContain('BACKUP FEEDER — 200 A');
  });

  it('🚨 handed no runs, nothing on the drawing is sized: every callout says NOT EVALUATED', () => {
    const bare = section(t);
    const ts = texts(bare.svg);
    expect(count(ts, 'CONDUCTORS / RACEWAY — NOT EVALUATED')).toBe(4 + 2 + 2 + 2);
    expect(ts.some(x => /#\d+(\/0)? CU/.test(x)), 'a conductor size on a sheet nobody engineered').toBe(false);
  });
});
