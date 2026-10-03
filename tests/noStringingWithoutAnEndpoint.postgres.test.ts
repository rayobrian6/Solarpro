// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A PROJECT WITH NOTHING FOR ITS STRINGS TO LAND ON: THE ROUTES CONSUME NO PARTITION.
//
// Closure brief §2/§4: "Projects already saved with a fabricated partition (e.g. 20/17 on a job with
// no endpoint) must not resurrect it: on load, and in the server routes (SLD / BOM / permit /
// equipment schedule), a partition with no valid endpoint is not consumed or displayed."
//
// The row is the fresh project as the production page left it: 37 × 440 W placed in Design, the
// module recorded, NO PV inverter, NO storage, no service graph — and `engineering_config` holding
// the fabricated inverter-less 20 / 17. The bodies are what the page posted before the fix. Driven
// through the real route handlers on real PostgreSQL (PGlite).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const FRESH = '7b3c2a10-4d5e-4f60-8a7b-1c2d3e4f5a6b';
const RAY = '4030b664-bebe-433b-a11c-cda05ead2f7d';
let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') return (await pg.query(strings, (values[0] as unknown[]) ?? [])).rows;
    let text = ''; const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    return (await pg.query(text, params)).rows;
  }) as unknown as never;
}
vi.mock('@/lib/db-neon', async (o) => ({
  ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/db/core', async (o) => ({
  ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db),
}));
vi.mock('@/lib/auth', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, email: 'ray@example.com', name: 'Ray' }),
}));

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  const nc = (s: string) => s.replace(/CONCURRENTLY/gi, '');
  await db.exec(nc(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(nc(read('lib', 'migrations', '002_project_coordinates.sql')));
  for (const c of [
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_updated_at TIMESTAMPTZ`,
    `ALTER TABLE layouts ADD COLUMN IF NOT EXISTS design_electrical JSONB`,
  ]) await db.exec(c);
  await Promise.all([
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/sld/pdf/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
  ]);
}, 90_000);
afterAll(async () => { await db?.close(); });

const placed = (n: number, wattage: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({
    id: `pnl-${i}`, layoutId: 'lo', lat: 0, lng: 0, x: 0, y: 0, tilt: 90, azimuth: 180,
    wattage, bifacialGain: 0, row: 0, col: i, systemType: 'fence',
  })));

/** The fabricated partition the production page autosaved on the fresh project. */
const STORED_20_17 = {
  schemaVersion: 2, mainPanelAmps: 200, selectedBrand: 'enphase', defaultsApplied: true, isUserControlled: true,
  inverters: [{
    id: 'inv-auto-0', inverterId: '', type: 'string', stringsPerInverter: 2, modulesPerString: 20,
    strings: [
      { id: 'str-auto-0', label: 'String 1', panelCount: 20, panelId: 'panel-fence-ps1' },
      { id: 'str-1', label: 'String 2', panelCount: 17, panelId: 'panel-fence-ps1' },
    ],
  }],
};

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment, engineering_config)
     VALUES ($1, $2, 'Fresh fence', 'lead', 'fence', '238 N Warwick Ave, Peoria, IL', $3, $4)`,
    [FRESH, USER_ID, JSON.stringify({ panelId: 'panel-fence-ps1', inverter: null, inverterId: null }),
     JSON.stringify(STORED_20_17)]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'fence',$3::jsonb,$4)`,
    [FRESH, USER_ID, placed(37, 440), 37]);
});

/** What the page posted for this project before the fix: a "String Inverter", 2 strings of 20 / 17,
 *  and a phantom 600 V / 2-MPPT window. */
function oldPageSldBody(over: Record<string, unknown> = {}) {
  return {
    projectId: FRESH, projectName: 'Fresh fence', clientName: 'Fresh', address: '238 N Warwick Ave, Peoria, IL',
    drawingDate: '2026-10-03', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: 'STRING_INVERTER', totalModules: 37, totalStrings: 2,
    inverterModel: 'String Inverter', inverterManufacturer: '', selectedInverterId: '',
    inverterMaxDcV: 600, maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600, mpptChannels: 2,
    stringDetails: [
      { stringIndex: 0, panelCount: 20, ocpdAmps: 20, wireGauge: '#10 AWG', voc: 0, isc: 0 },
      { stringIndex: 1, panelCount: 17, ocpdAmps: 20, wireGauge: '#10 AWG', voc: 0, isc: 0 },
    ],
    stringPanelCounts: [20, 17],
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20, acOutputKw: 7.6,
    acWireGauge: '#8 AWG', acConduitType: 'EMT', acWireLength: 50,
    mainPanelAmps: 200, utilityName: 'Ameren Illinois', interconnection: 'UNRESOLVED',
    systemType: 'fence', format: 'json',
    ...over,
  };
}

async function postSld(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const json = await res.json() as Record<string, any>;
  return { status: res.status, json, svg: String(json.svg ?? '') };
}

async function postPdfAsSvg(buildInput: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/sld/pdf/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildInput, format: 'svg' }),
  }));
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try { json = JSON.parse(text); } catch { /* svg */ }
  return { status: res.status, svg: json ? String(json.svg ?? '') : text, json };
}

async function postBom(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Record<string, any> };
}

const textOf = (svg: string) => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
type Line = { quantity: number; derivedFrom?: string; category?: string; description?: string; model?: string };
const bomLines = (json: Record<string, any>): Line[] => (json.bom?.items ?? []) as Line[];

describe('🚨 the fresh project — Design modules, no PV inverter, a stored 20 / 17', () => {
  it('the canonical load reads the module count from Design — never from the fabricated partition', async () => {
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const loaded = await loadElectricalProject(FRESH, USER_ID);
    expect(loaded!.pvArray.moduleCount).toBe(37);
    expect(loaded!.pvArray.moduleCountSource).toBe('design-placed-modules');
    expect(loaded!.pvArray.dcStcKw).toBeCloseTo(16.28, 2);
  });

  it('the Diagram route draws 37 × 440 W with its stringing PENDING — no 20 / 17, no derived strings, no String Inverter', async () => {
    const r = await postSld(oldPageSldBody());
    expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
    expect(r.json.stringingPending).toBe(true);
    expect(r.json.stringConfig).toBeNull();
    const t = textOf(r.svg);
    expect(t).toContain('37 × 440W');
    expect(t).toContain('STRINGING PENDING EQUIPMENT SELECTION');
    expect(t).toContain('PENDING EQUIPMENT SELECTION');
    expect(t).not.toMatch(/20\s*\/\s*17/);
    expect(t).not.toMatch(/\d+ STRINGS? (×|—)/);
    expect(t).not.toMatch(/Strings\s+\d+:/);
    expect(t).not.toContain('String Inverter');
    expect(t).not.toMatch(/Fronius|SE7600H|IQ8/);
  });

  it('the exported PDF route does the same with the same body', async () => {
    const r = await postPdfAsSvg(oldPageSldBody());
    expect(r.status, JSON.stringify(r.json ?? {}).slice(0, 400)).toBe(200);
    const t = textOf(r.svg);
    expect(t).toContain('37 × 440W');
    expect(t).toContain('PENDING EQUIPMENT SELECTION');
    expect(t).not.toMatch(/20\s*\/\s*17/);
    expect(t).not.toMatch(/Strings\s+\d+:/);
  });

  it('the BOM orders no string hardware for a partition nobody engineered, and says why', async () => {
    const r = await postBom({
      projectId: FRESH, systemType: 'fence', moduleCount: 37, totalPanels: 37,
      panelId: 'panel-fence-ps1', panelWatts: 440, systemKw: 16.28,
      stringCount: 2, topologyType: 'STRING_INVERTER', mainPanelAmps: 200,
    });
    expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
    const stringLines = bomLines(r.json).filter(l => /stringCount/.test(String(l.derivedFrom ?? '')) && l.quantity > 0);
    expect(stringLines.map(l => `${l.description} ×${l.quantity}`)).toEqual([]);
    expect((r.json.summary.warnings as string[]).join(' ')).toContain('Stringing pending equipment selection');
  });

  it('control: with a chosen PV inverter the same BOM DOES order per-string hardware (the guard is the endpoint, not the route)', async () => {
    const r = await postBom({
      projectId: FRESH, systemType: 'fence', moduleCount: 37, totalPanels: 37,
      panelId: 'panel-fence-ps1', panelWatts: 440, systemKw: 16.28, inverterId: 'fronius-primo-8.2',
      stringCount: 4, topologyType: 'STRING_INVERTER', mainPanelAmps: 200,
    });
    expect(r.status).toBe(200);
    const labels = bomLines(r.json).filter(l => /stringCount/.test(String(l.derivedFrom ?? '')));
    expect(labels.some(l => l.quantity === 8)).toBe(true);
  });
});

// 🚨 The permit package itself refuses later (it needs a layout and a module on a string), so the
// observable here is the route's own decision about the inverter fleet: what it drops and what it
// backfills from `engineering_config`. The control proves the same backfill still runs for a CHOSEN
// inverter — so "nothing backfilled" below is the guard, not a dead path.
describe('🚨 the permit route — the stored 20 / 17 is neither consumed nor backfilled', () => {
  async function postPermit(inverters: unknown[]) {
    const { POST } = await import('@/app/api/engineering/permit/route');
    const { NextRequest } = await import('next/server');
    const logs: string[] = [];
    const cap = (...a: unknown[]) => { logs.push(a.map(x => String(x)).join(' ')); };
    const spies = [vi.spyOn(console, 'log').mockImplementation(cap), vi.spyOn(console, 'warn').mockImplementation(cap)];
    try {
      const res = await POST(new NextRequest('http://localhost/api/engineering/permit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: FRESH,
          project: { projectId: FRESH, clientName: 'Fresh', address: '238 N Warwick Ave, Peoria, IL' },
          system: { totalPanels: 37, inverters },
        }),
      }));
      return { status: res.status, logs, body: await res.text() };
    } finally { spies.forEach(s => s.mockRestore()); }
  }
  const backfilled = (logs: string[]) => logs.filter(l => l.includes('Backfilled inverters from persisted design'));

  it('an empty post does not resurrect the stored inverter-less partition', async () => {
    const r = await postPermit([]);
    expect(backfilled(r.logs), r.logs.filter(l => /permit\/POST/.test(l)).join('\n').slice(0, 800)).toEqual([]);
    expect(r.logs.some(l => /stored inverter entry\(ies\) with no PV inverter not backfilled/.test(l))).toBe(true);
  });

  it('the old page post — a nameless "inverter" carrying 20 / 17 — is not consumed', async () => {
    const r = await postPermit([{
      manufacturer: '', model: '', type: 'string', acOutputKw: 0, maxDcVoltage: 480, efficiency: 97,
      ulListing: 'UL 1741',
      strings: [{ label: 'String 1', panelCount: 20 }, { label: 'String 2', panelCount: 17 }],
    }]);
    expect(r.logs.some(l => /posted inverter entry\(ies\) name no inverter/.test(l))).toBe(true);
    expect(backfilled(r.logs)).toEqual([]);
  });

  it('control: a stored CHOSEN inverter is still backfilled (the guard is the endpoint, not the store)', async () => {
    await db.query(`UPDATE projects SET engineering_config = $2 WHERE id = $1`, [FRESH, JSON.stringify({
      ...STORED_20_17,
      inverters: [{ ...STORED_20_17.inverters[0], inverterId: 'fronius-primo-8.2',
        strings: [10, 9, 9, 9].map((n, i) => ({ id: `s${i}`, label: `String ${i + 1}`, panelCount: n, panelId: 'panel-fence-ps1' })) }],
    })]);
    const r = await postPermit([]);
    expect(backfilled(r.logs).join(' ')).toMatch(/4 strings/);
  });
});

describe('control — Ray\'s DC-coupled job still strings against the Powerwall 3 inputs', () => {
  it('9 / 9 / 9 / 8 / 2 on the sheet; nothing pending', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(buildRaysIntendedJob().topology)));
    stored.topology.solarCoupling = 'dc-coupled-storage';
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address, service_topology, selected_equipment, engineering_config)
       VALUES ($1, $2, 'Hussey Ethos 400A', 'lead', 'fence', '238 N Warwick Ave, Peoria, IL', $3, $4, $5)`,
      [RAY, USER_ID, JSON.stringify(stored), JSON.stringify({
        batteryCount: 4, inverter: null, inverterId: null, panelId: 'panel-fence-ps1',
        provenance: { architecture: { kind: 'USER_SELECTED', recordedAt: '2026-10-02T22:00:00.000Z',
          basis: 'Inverter: None — PV direct to Powerwall 3', by: 'ecosystem-picker' } },
      }), JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 400 })]);
    await db.query(
      `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'fence',$3::jsonb,$4)`,
      [RAY, USER_ID, placed(37, 440), 37]);
    const r = await postSld(oldPageSldBody({ projectId: RAY, topologyType: 'DC_COUPLED_STORAGE',
      stringDetails: undefined, stringPanelCounts: undefined, totalStrings: 0, inverterModel: undefined,
      mainPanelAmps: 400, hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4 }));
    expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
    expect(r.json.stringingPending).toBe(false);
    const t = textOf(r.svg);
    const m = t.match(/Strings\s+(\d+):\s*([\d\s/]+)\s*panels/);
    expect(m, 'the schedule states the engineered strings').not.toBeNull();
    expect(m![2].split('/').map(x => Number(x.trim()))).toEqual([9, 9, 9, 8, 2]);
    expect(t).not.toContain('PENDING EQUIPMENT SELECTION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW FINDINGS — the endpoint is decided by ONE rule on every route, and every consumer draws the
// card's partition.
// ═══════════════════════════════════════════════════════════════════════════

/** The picker's fleet for `inverterId`, exactly as the page now writes and autosaves it. */
async function storeChosenFleet(inverterId: string) {
  const { canonicalFleetEntries } = await import('@/lib/system/fleetStringWriters');
  const { SOLAR_PANELS } = await import('@/lib/equipment-db');
  const { getThermalDesignBasis } = await import('@/lib/permit/utils/designTemps');
  const T = getThermalDesignBasis({ address: '238 N Warwick Ave, Peoria, IL' }).minDesignTempC;
  const r = canonicalFleetEntries({
    inverterId, inverterType: 'string', moduleCount: 37, designTempMin: T,
    panel: SOLAR_PANELS.find(p => p.id === 'panel-fence-ps1')!, stringFields: { panelId: 'panel-fence-ps1' },
    idPrefix: 'inv-pick',
  });
  expect(r.entries, `${inverterId} must be stringable for this fixture`).not.toBeNull();
  await db.query(`UPDATE projects SET engineering_config = $2 WHERE id = $1`, [FRESH,
    JSON.stringify({ schemaVersion: 2, selectedBrand: 'enphase', inverters: r.entries })]);
  return { entries: r.entries!, flat: r.entries!.flatMap(e => e.strings.map(s => s.panelCount)), T };
}

/** The SVG body the page posts now for a chosen inverter (selectedInverterId + its catalogue window). */
async function chosenSldBody(inverterId: string, over: Record<string, unknown> = {}) {
  const { getInverterById } = await import('@/lib/equipment-db');
  const inv = getInverterById(inverterId)!;
  return oldPageSldBody({
    selectedInverterId: inverterId, inverterId, inverterModel: `${inv.manufacturer} ${inv.model}`,
    inverterManufacturer: inv.manufacturer, inverterMaxDcV: inv.maxDcVoltage, maxDcVoltage: inv.maxDcVoltage,
    mpptVoltageMin: inv.mpptVoltageMin, mpptVoltageMax: inv.mpptVoltageMax, mpptChannels: inv.mpptChannels,
    maxInputCurrentPerMppt: inv.maxInputCurrentPerMppt, maxParallelStringsPerMppt: inv.maxParallelStringsPerMppt,
    acOutputKw: inv.acOutputKw, stringDetails: undefined, stringPanelCounts: undefined, totalStrings: undefined,
    panelId: 'panel-fence-ps1', ...over,
  });
}
const scheduleStrings = (svg: string): number[] | null => {
  const m = textOf(svg).match(/Strings\s+(\d+):\s*([\d\s/]+)\s*panels/);
  return m ? m[2].split('/').map(x => Number(x.trim())) : null;
};

describe('🚨 the endpoint is a catalogued id or the storage window — never a brand (SLD + PDF)', () => {
  for (const [label, over] of [
    ['the old page\'s selectedBrand \'enphase\' (the stored migration default)', { selectedBrand: 'enphase' }],
    ['a posted selectedBrand \'fronius\'', { selectedBrand: 'fronius' }],
    ['an inverter id the catalogue does not hold', { inverterId: 'not-in-the-catalogue', selectedInverterId: 'not-in-the-catalogue' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`SVG: ${label} ⇒ stringing pending, no partition drawn`, async () => {
      const r = await postSld(oldPageSldBody(over));
      expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
      expect(r.json.stringingPending).toBe(true);
      expect(scheduleStrings(r.svg)).toBeNull();
      expect(textOf(r.svg)).toContain('STRINGING PENDING EQUIPMENT SELECTION');
    });
    it(`PDF: ${label} ⇒ stringing pending, no partition drawn`, async () => {
      const r = await postPdfAsSvg(oldPageSldBody(over));
      expect(r.status).toBe(200);
      expect(scheduleStrings(r.svg)).toBeNull();
      expect(textOf(r.svg)).toContain('PENDING EQUIPMENT SELECTION');
    });
  }
});

describe('🚨 ONE partition: the picker\'s fleet = the SLD "Strings N:" line = the PDF = the BOM string count', () => {
  for (const inverterId of ['growatt-min-7600tl-xh-us', 'tesla-solar-inverter-7p6k', 'fronius-primo-8.2']) {
    it(`${inverterId}: card, Diagram, export and BOM state the same strings`, async () => {
      const { flat, T } = await storeChosenFleet(inverterId);
      // The Diagram tab (SVG route) draws the stored fleet — not `sizeSystemFromBrand`'s layout.
      const svg = await postSld(await chosenSldBody(inverterId));
      expect(svg.status, JSON.stringify(svg.json).slice(0, 300)).toBe(200);
      expect(svg.json.partitionSource).toBe('fleet');
      expect(scheduleStrings(svg.svg)).toEqual(flat);
      expect(svg.json.stringConfig.totalStrings).toBe(flat.length);
      // The exported PDF, posted the way the page's Export-PDF button posted it (identity only on
      // inverterSpecs[] — no selectedInverterId), draws the same strings: no false "pending".
      const pdf = await postPdfAsSvg(await chosenSldBody(inverterId, {
        selectedInverterId: undefined, inverterId: undefined, inverterSpecs: [{ inverterId }] }));
      expect(pdf.status).toBe(200);
      expect(textOf(pdf.svg)).not.toContain('PENDING EQUIPMENT SELECTION');
      expect(scheduleStrings(pdf.svg)).toEqual(flat);
      // The page's engine (configStringPanelCounts from the fleet) → the BOM's posted stringCount.
      const { computeSystem } = await import('@/lib/computed-system');
      const { resolvePvArrayDesign } = await import('@/lib/electrical/pvArrayDesign');
      const m = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' }).module!;
      const { getInverterById } = await import('@/lib/equipment-db');
      const inv = getInverterById(inverterId)!;
      const cs = computeSystem({
        topology: 'string', solarCoupling: null, totalPanels: 37, configStringPanelCounts: flat,
        panelWatts: m.watts, panelVoc: m.voc, panelIsc: m.isc, panelVmp: m.vmp, panelImp: m.imp,
        panelTempCoeffVoc: m.tempCoeffVoc, panelTempCoeffIsc: m.tempCoeffIsc, panelMaxSeriesFuse: m.maxSeriesFuseRating,
        panelModel: m.model, panelManufacturer: m.manufacturer, inverterManufacturer: inv.manufacturer,
        inverterModel: inv.model, inverterAcKw: inv.acOutputKw, inverterCount: 1, inverterMaxDcV: inv.maxDcVoltage,
        inverterMpptVmin: inv.mpptVoltageMin, inverterMpptVmax: inv.mpptVoltageMax,
        inverterMaxInputCurrentPerMppt: inv.maxInputCurrentPerMppt, inverterMpptChannels: inv.mpptChannels,
        inverterAcCurrentMax: inv.acOutputCurrentMax, inverterModulesPerDevice: 1, inverterBranchLimit: 16,
        designTempMin: T, ambientTempC: 35, rooftopTempAdderC: 0, runLengths: {}, conduitType: 'EMT',
        mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200, interconnectionMethod: 'LOAD_SIDE',
        systemType: 'fence', maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3, batteryIds: [],
      } as never);
      expect(cs.stringCount).toBe(flat.length);
      const bom = await postBom({
        projectId: FRESH, systemType: 'fence', moduleCount: 37, totalPanels: 37, panelId: 'panel-fence-ps1',
        panelWatts: 440, systemKw: 16.28, inverterId, stringCount: cs.stringCount, topologyType: 'STRING_INVERTER',
        mainPanelAmps: 200,
      });
      expect(bom.status).toBe(200);
      expect(bomLines(bom.json).some(l => /stringCount/.test(String(l.derivedFrom ?? '')) && l.quantity === 2 * flat.length))
        .toBe(true);
    });
  }

  it('a stored fleet for ANOTHER model is not drawn for this one — the engine strings the posted inverter', async () => {
    await storeChosenFleet('fronius-primo-8.2');
    const r = await postSld(await chosenSldBody('solark-12k-2p'));
    expect(r.status).toBe(200);
    expect(r.json.partitionSource).toBe('canonical');
    const { canonicalStringPartition, resolveStringEndpoint, stringModuleFacts } = await import('@/lib/electrical/canonicalStrings');
    const { SOLAR_PANELS } = await import('@/lib/equipment-db');
    const c = canonicalStringPartition({ moduleCount: 37, designTempMin: -23,
      module: stringModuleFacts(SOLAR_PANELS.find(p => p.id === 'panel-fence-ps1')),
      endpoint: resolveStringEndpoint({ inverterId: 'solark-12k-2p', inverterType: 'string' }) });
    expect(c.status).toBe('ENGINEERED');
    expect(scheduleStrings(r.svg)).toEqual((c as { strings: number[] }).strings);
  });

  it('a chosen inverter the engine cannot string is drawn with NO partition — not an equal split', async () => {
    const r = await postSld(await chosenSldBody('sma-sb-7.7'));
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    expect(r.json.stringsNotEngineered).toMatch(/Imp 10\.28 A exceeds the 10 A operating limit/);
    expect(scheduleStrings(r.svg)).toBeNull();
    expect(textOf(r.svg)).toContain('STRING ASSIGNMENT NOT ENGINEERED');
  });
});

describe('🚨 the permit route on a fresh Design Studio project — design_electrical present, no inverter', () => {
  it('backfills NO inverter from Design Studio\'s chunks (it backfilled se-7600h at 10/10/10/7)', async () => {
    const { assignStrings } = await import('@/lib/stringAssignment');
    const { buildDesignElectricalBlock } = await import('@/lib/system/designToEngineering');
    const panels = JSON.parse(placed(37, 440));
    const sa = assignStrings(panels, { modulesPerString: 10, topology: 'string', modulesPerDevice: 1 } as never);
    const byPanel: Record<string, number> = {};
    for (const pid in sa.byPanelId) byPanel[pid] = sa.byPanelId[pid].stringIndex;
    const de = buildDesignElectricalBlock({ panels, assignmentByPanelId: byPanel, topology: 'string',
      inverterBrand: 'SolarEdge', modulesPerString: 10, rackingId: 'ironridge-xr100', panelId: 'panel-fence-ps1',
      deviceCount: sa.deviceCount, generatedAt: '2026-10-03T00:00:00Z' } as never);
    expect(de.strings.map((s: { panelCount: number }) => s.panelCount)).toEqual([10, 10, 10, 7]);
    await db.query(`UPDATE layouts SET design_electrical = $2 WHERE project_id = $1`, [FRESH, JSON.stringify(de)]);
    // The state a fresh project persists now: no fleet entry at all.
    await db.query(`UPDATE projects SET engineering_config = $2 WHERE id = $1`, [FRESH,
      JSON.stringify({ schemaVersion: 2, selectedBrand: 'enphase', inverters: [] })]);
    const { POST } = await import('@/app/api/engineering/permit/route');
    const { NextRequest } = await import('next/server');
    const logs: string[] = [];
    const cap = (...a: unknown[]) => { logs.push(a.map(x => String(x)).join(' ')); };
    const spies = [vi.spyOn(console, 'log').mockImplementation(cap), vi.spyOn(console, 'warn').mockImplementation(cap)];
    try {
      await POST(new NextRequest('http://localhost/api/engineering/permit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: FRESH,
          project: { projectId: FRESH, clientName: 'Fresh', address: '238 N Warwick Ave, Peoria, IL' },
          system: { totalPanels: 37, inverters: [] } }),
      }));
    } finally { spies.forEach(s => s.mockRestore()); }
    expect(logs.filter(l => l.includes('Backfilled inverters from persisted design'))).toEqual([]);
    expect(logs.some(l => /design_electrical names no inverter/.test(l))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/se-7600h/);
  });
});
