// ═══════════════════════════════════════════════════════════════════════════
// ONE ENGINEERED RUN, EVERY CONSUMER. Ray: "The exact same engineered run must feed SLD, conductor
// schedule, BOM, permit…" — the SLD schedule band, the SLD calculation block, the BOM's conductor
// lines and the permit's PV-4B rows all print `runScheduleCells` of the SAME runs, and none of them
// prints a gauge the engine did not produce.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { setStoragePvInput, setServiceExistingOrNew } from '@/lib/electrical/topologyAuthoring';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  engineerServiceRuns, runEnvironmentFrom, runScheduleCells, runTags, type EngineeredRun,
} from '@/lib/electrical/electricalRuns';
import { bomLinesFromRuns } from '@/lib/bom/topologyBom';
import { applyDistributorPricing } from '@/lib/bom/distributorPricing';
import { serviceRunRowsHtml } from '@/lib/permit/sections/electricalPages';
import type { PermitInput } from '@/lib/permit/types';

const BASE = {
  projectName: 'RUNS', clientName: 'Ray', address: 'Chicago IL', designer: 'SolarPro',
  drawingDate: '2026-10-03', drawingNumber: 'E-1', revision: 'A', scale: 'NOT TO SCALE',
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 37, totalStrings: 0, deviceCount: 37,
  panelModel: 'Philadelphia Solar PS-M108-440', panelWatts: 440, panelVoc: 39.5, panelIsc: 13.9,
  dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0, inverterModel: 'NONE', inverterManufacturer: 'Tesla',
  acOutputKw: 46.08, acOutputAmps: 192, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const quietly = <T>(fn: () => T): T => {
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};
const raysJob = (): ServiceTopology => {
  let t = buildRaysIntendedJob().topology;
  t.storage.filter(u => u.role === 'inverter-unit')
    .forEach((u, k) => { t = setStoragePvInput(t, u.id, k === 0 ? 8.36 : k === 2 ? 7.92 : 0); });
  return setServiceExistingOrNew(t, 'existing');
};
const ENV = runEnvironmentFrom({ state: 'IL', racewayType: 'EMT' });
const sheet = (t: ServiceTopology, electricalRuns?: EngineeredRun[] | null) =>
  quietly(() => renderSLDProfessional({ ...BASE, serviceTopology: t, electricalRuns } as unknown as SLDProfessionalInput));
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
  .map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
/** The schedule band's rows, as cell arrays, from the RUN ID column onward. */
const scheduleRows = (svg: string): string[][] => {
  const ts = texts(svg);
  const start = ts.indexOf('RUN ID');
  const cells = ts.slice(start + 11);
  const rows: string[][] = [];
  for (let i = 0; i + 10 < cells.length && /^[A-Z]-\d+$|^…$/.test(cells[i]); i += 11) rows.push(cells.slice(i, i + 11));
  return rows;
};

describe('the SLD prints the engine\'s runs — and only them', () => {
  const t = raysJob();
  const runs = engineerServiceRuns(t, ENV);
  const svg = sheet(t, runs);
  const rows = scheduleRows(svg);
  const tags = runTags(runs);

  it('one schedule row per canonical run, tagged as the permit tags it, with the engine\'s words', () => {
    runs.forEach((r, k) => {
      const row = rows.find(x => x[0] === tags[k]);
      expect(row, `no schedule row for ${tags[k]} (${r.id})`).toBeDefined();
      const c = runScheduleCells(r);
      expect(row![3]).toBe(c.conductors);
      expect(row![4]).toBe(c.raceway);
      expect(row![10]).toBe(r.evaluationStatus === 'ENGINEERED' ? '✓ PASS' : 'NOT EVAL.');
    });
  });

  it('🚨 no storage row carries the PV feeder\'s borrowed gauge, and no feeder is sized off a breaker', () => {
    expect(svg).not.toContain('#6 THWN-2 + 1×#10 GRN');
    expect(svg).not.toContain('SIZE FOR ');
    expect(svg).not.toMatch(/ESS AC OUTPUT \(\d+ UNITS?\)/);
  });

  it('the calculation block names the graph\'s runs instead of a PV AC wire gauge that does not exist', () => {
    const ts = texts(svg);
    const at = (k: string) => ts[ts.indexOf(k) + 1];
    expect(at('ESS Circuit Conductors')).toBe('2 #4 CU THWN-2 + #10 EGC');
    expect(at('Generation Feeder')).toBe('2 #1 CU THWN-2 + #6 EGC');
    expect(at('Backup Feeder')).toBe('2 #3/0 CU THWN-2 + #3/0 N + #6 EGC');
    expect(ts).not.toContain('AC Wire Gauge');
  });

  it('🚨 handed no runs, the renderer sizes nothing: every graph row is NOT EVALUATED', () => {
    const bare = scheduleRows(sheet(t, null)).filter(r => /^[EGBF]-\d+$/.test(r[0]));
    expect(bare).toHaveLength(12);
    for (const r of bare) {
      expect(r[3]).toBe('NOT EVALUATED');
      expect(r[10]).toBe('NOT EVAL.');
    }
  });
});

describe('the BOM lists the same runs', () => {
  const runs = engineerServiceRuns(raysJob(), ENV);
  const lines = bomLinesFromRuns(runs);

  it('identical runs fold into one line; its words are the schedule cell\'s', () => {
    expect(lines.map(l => l.model)).toEqual([
      '60 A ESS AC CIRCUIT', '125 A GENERATION FEEDER', '200 A BACKUP FEEDER', '200 A SERVICE BRANCH FEEDER',
    ]);
    const backup = lines.find(l => l.model === '200 A BACKUP FEEDER')!;
    const r = runs.find(x => x.role === 'backup-feeder')!;
    expect(backup.description).toBe(`${runScheduleCells(r).conductors} · ${runScheduleCells(r).raceway}`);
    expect(backup.affectedRouteIds).toEqual(['backup-feeder:domain-a:msp-1', 'backup-feeder:domain-b:msp-2']);
  });

  it('🚨 no recorded length ⇒ no footage: the quantity is PENDING and nothing is ordered or priced', () => {
    for (const l of lines) {
      expect(l.nonOrderable).toBe(true);
      expect(l.quantityState).toBe('pending');
      expect(l.quantity).toBe(0);
      expect(l.quantitySource).toBe('unknown');
    }
    expect(lines[0].quantityStateLabel).toBe('LENGTH REQUIRED — 4 RUNS');
    const priced = applyDistributorPricing(lines);
    expect(priced.totalBomCost).toBe(0);
  });

  it('a run the engine could not engineer says NOT EVALUATED and names what it needs', () => {
    const none = bomLinesFromRuns(engineerServiceRuns(raysJob(), runEnvironmentFrom({ racewayType: 'EMT' })));
    for (const l of none) {
      expect(l.description).toBe('CONDUCTORS / RACEWAY — NOT EVALUATED');
      expect(l.nonOrderableReason).toContain('the project location (state) is not established');
    }
  });
});

describe('the permit\'s PV-4B prints the same runs', () => {
  it('rows tagged and worded as the SLD schedule, from the project\'s own location and raceway', () => {
    const t = raysJob();
    const input = { project: { serviceTopology: t, state: 'IL', address: 'Chicago', conduitType: 'EMT' } } as unknown as PermitInput;
    const html = serviceRunRowsHtml(input);
    const runs = engineerServiceRuns(t, ENV);
    const tags = runTags(runs);
    runs.forEach((r, k) => {
      expect(html).toContain(`${tags[k]} · ${r.name}`);
      expect(html).toContain(runScheduleCells(r).conductors);
    });
    expect(html).toContain('SERVICE &amp; STORAGE CONDUCTORS — ENGINEERED RUNS');
  });

  it('no service graph ⇒ no section', () => {
    expect(serviceRunRowsHtml({ project: { serviceTopology: null } } as unknown as PermitInput)).toBe('');
  });
});

describe('🚨 consumers never size a conductor themselves', () => {
  it('none of them imports the breaker-to-gauge shortcut for these runs', () => {
    for (const f of ['lib/bom/topologyBom.ts', 'lib/electrical/electricalRuns.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/wireGaugeForOcpd\s*\(/);
    }
  });
});
