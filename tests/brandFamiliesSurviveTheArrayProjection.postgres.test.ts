// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EVERY BRAND FAMILY SURVIVES THE ARRAY PROJECTION — THROUGH THE REAL SLD ROUTES.
//
// Gauntlet step 14. The PV-array repair (140bccf) projects the module count and the module from
// Design inside `projectCanonicalArchitecture`, which BOTH SLD routes call for EVERY project — not
// only Ray's DC-coupled Powerwall job it was written for. Ray's standing constraint: "Do not fuck my
// entire website up because we are getting 1 real world scenario to work… every auto pick selection
// works for installs that do not have batteries." So each family below is written to PGlite the way
// the product stores it (projects.service_topology / selected_equipment / engineering_config + a
// layouts row of N placed modules) and the body the engineering page posts goes through the real
// handlers — POST /api/engineering/sld (format json) and POST /api/engineering/sld/pdf (format svg).
//
//   1  Enphase IQ8+ micros, no storage, no graph            4  Powerwall 3 beside a SELECTED SE7600H
//   2  Fronius Primo string inverter, no storage            5  Ray's DC-coupled PW3 job (no inverter)
//   3a SMA Sunny Boy + Powerwall 2 (AC-coupled)             6  plain 200 A house, SMA, no storage
//   3b Enphase IQ8M + IQ Battery 5P (AC-coupled)
//
// Each family is posted twice: once with the body the page builds today, once with a STALE body
// whose `totalModules` is three short (an old tab, a fleet that drifted). Design must win both times.
//
// 🚨 WHAT THESE FIXTURES FOUND (both repaired in lib/electrical/canonicalSldProjection.ts):
//
//   · AC-COUPLED STORAGE LOST ITS SELECTED INVERTER ON THE DIAGRAM TAB. Rule Eleven's
//     `ac-coupled-inverter` arm clears the posted inverter name and claimed "the route resolves the
//     display name from the id"; the SVG route never did. Families 3a, 3b and 4 printed
//     ⚠ INVERTER NOT SELECTED on the Diagram tab while the PDF named the Sunny Boy / IQ8M / SE7600H.
//   · A STALE BODY GOT HALF-CORRECTED ON THE EXPORTED PDF. The projection fixed the module count and
//     left the posted micro `deviceCount`, so family 1 exported `24 × 405W` beside `21 × IQ8+`.
//
// Mutation proof (run by hand, recorded in the commit): making `projectPvArray` return immediately
// turns every stale-count assertion red and leaves the control green.
//
// NOT COVERED HERE, deliberately: a dual-module micro (APsystems DS3) exported from the page's
// CURRENT body prints one micro per module, because the page's PDF request posts
// `deviceCount: totalPanels`. That is a page-side defect with a correct module count, so it is not
// this projection's to repair, and a family asserting it would be red for a reason outside this file.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '6b2f8d3e-1d2c-4a8f-8e66-4bac9d8e7f12';
const CONTROL = '7c3a9e4f-2e3d-4b9a-9f77-5cbdae9f8a23';
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
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
    import('@/lib/equipment-db'),
  ]);
}, 90_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  for (const [id, name] of [[PROJECT, 'Brand Family'], [CONTROL, 'Control Residence']]) {
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address)
       VALUES ($1, $2, $3, 'lead', 'roof', '238 N Warwick Ave, Peoria, IL')`, [id, USER_ID, name]);
  }
});

// ─── THE FAMILIES ──────────────────────────────────────────────────────────

type InverterKind = 'micro' | 'string' | 'optimizer';
interface Family {
  key: string;
  title: string;
  modules: number;
  panelId: string;
  /** The SELECTED PV inverter. Null ⇒ none on the project (Ray's DC-coupled job). */
  inverter: { id: string; kind: InverterKind; brand: string } | null;
  storage?: { batteryId: string; gatewayId: string };
  /**
   * 'none'       — no service graph (most residential jobs).
   * 'ac-coupled' — a graph authored with the wizard's helpers, solarCoupling 'ac-coupled-inverter'.
   * 'rays-dc'    — Ray's fixture, solarCoupling 'dc-coupled-storage'.
   */
  graph: 'none' | 'ac-coupled' | 'rays-dc';
  /** Record `provenance.architecture` (a designer answered the coupling question). */
  architectureDecided?: boolean;
  serviceAmps: number;
  /** What this family's sheet must and must not say, beyond the array itself. */
  sheet: { has: Array<string | RegExp>; hasNot: Array<string | RegExp> };
}

const NO_STORAGE: Array<string | RegExp> = [/Powerwall/, /\bkWh\b/, /IQ Battery/, 'DC COUPLED'];

const FAMILIES: Family[] = [
  {
    key: '1-micro', title: 'MICROINVERTER — Enphase IQ8+, no storage, no graph',
    modules: 24, panelId: 'rec-alpha-pure-405',
    inverter: { id: 'enphase-iq8plus', kind: 'micro', brand: 'enphase' },
    graph: 'none', serviceAmps: 200,
    sheet: { has: ['MICROINVERTER', 'IQ8+', 'Battery Storage NONE'],
      hasNot: [...NO_STORAGE, 'INPUT REQUIRED', 'INVERTER NOT SELECTED'] },
  },
  {
    key: '2-string', title: 'CONVENTIONAL STRING INVERTER — Fronius Primo 7.6-1, no storage',
    modules: 20, panelId: 'trina-vertex-s-435',
    inverter: { id: 'fronius-primo-7.6', kind: 'string', brand: 'fronius' },
    graph: 'none', serviceAmps: 200,
    sheet: { has: ['STRING INVERTER', 'Primo 7.6-1', 'Battery Storage NONE'],
      hasNot: [...NO_STORAGE, 'INVERTER NOT SELECTED'] },
  },
  {
    key: '3a-ac-pw2', title: 'AC-COUPLED STORAGE — SMA Sunny Boy 7.7 + Powerwall 2 (no PV input)',
    modules: 22, panelId: 'pan-evervolt-410',
    inverter: { id: 'sma-sb-7.7', kind: 'string', brand: 'sma' },
    storage: { batteryId: 'tesla-powerwall-2', gatewayId: 'tesla-backup-gateway-2' },
    // Recorded coupling WITHOUT a designer's provenance — the derived-and-written shape.
    graph: 'ac-coupled', architectureDecided: false, serviceAmps: 200,
    sheet: { has: ['Sunny Boy 7.7-US', 'Powerwall 2'],
      hasNot: ['DC COUPLED', 'INVERTER NOT SELECTED', 'Powerwall 3'] },
  },
  {
    key: '3b-ac-enphase', title: 'AC-COUPLED STORAGE — Enphase IQ8M + IQ Battery 5P (no PV input)',
    modules: 18, panelId: 'silfab-sil430',
    inverter: { id: 'enphase-iq8m', kind: 'micro', brand: 'enphase' },
    storage: { batteryId: 'enphase-iq-battery-5p', gatewayId: 'enphase-iq-system-controller-3' },
    graph: 'ac-coupled', architectureDecided: true, serviceAmps: 200,
    sheet: { has: ['MICROINVERTER', 'IQ8M', 'IQ Battery 5P'],
      hasNot: ['DC COUPLED', 'INVERTER NOT SELECTED', /Powerwall/] },
  },
  {
    key: '4-pw3-ac', title: 'POWERWALL 3 BESIDE A SELECTED SolarEdge SE7600H (AC-coupled PW3)',
    modules: 26, panelId: 'tesla-tsp-415',
    inverter: { id: 'se-7600h', kind: 'optimizer', brand: 'solaredge' },
    storage: { batteryId: 'tesla-powerwall-3', gatewayId: 'tesla-backup-gateway-3' },
    graph: 'ac-coupled', architectureDecided: true, serviceAmps: 200,
    sheet: { has: ['SE7600H-US', 'Powerwall 3'],
      hasNot: ['DC COUPLED', 'INVERTER NOT SELECTED'] },
  },
  {
    key: '5-dc-pw3', title: 'DC-COUPLED STORAGE — Ray\'s 400 A job, PV into four Powerwall 3, no inverter',
    modules: 37, panelId: 'panel-fence-ps1',
    inverter: null,
    storage: { batteryId: 'tesla-powerwall-3', gatewayId: 'tesla-backup-gateway-3' },
    graph: 'rays-dc', architectureDecided: true, serviceAmps: 400,
    // "No standalone inverter name" is checked against the whole catalogue in the test body.
    sheet: { has: ['DC COUPLED'], hasNot: ['INVERTER NOT SELECTED'] },
  },
  {
    key: '6-simple', title: 'NO STORAGE, NO GRAPH — a plain 200 A house, SMA Sunny Boy 5.0, 16 modules',
    modules: 16, panelId: 'tesla-tsp-420',
    inverter: { id: 'sma-sb-5.0', kind: 'string', brand: 'sma' },
    graph: 'none', serviceAmps: 200,
    sheet: { has: ['Sunny Boy 5.0-US', 'Battery Storage NONE', /SERVICE 200 ?A/],
      hasNot: [...NO_STORAGE, 'INVERTER NOT SELECTED', 'INPUT REQUIRED'] },
  },
];

// ─── CATALOGUE ─────────────────────────────────────────────────────────────

async function catalogue(f: Family) {
  const eq = await import('@/lib/equipment-db');
  const panel = eq.getPanelById(f.panelId);
  if (!panel) throw new Error(`fixture module '${f.panelId}' is not in the catalogue`);
  const inv = f.inverter
    ? (f.inverter.kind === 'micro' ? eq.getMicroinverterById(f.inverter.id) : eq.getInverterById(f.inverter.id))
    : null;
  if (f.inverter && !inv) throw new Error(`fixture inverter '${f.inverter.id}' is not in the catalogue`);
  const battery = f.storage ? eq.getBatteryById(f.storage.batteryId) : null;
  if (f.storage && !battery) throw new Error(`fixture battery '${f.storage.batteryId}' is not in the catalogue`);
  const mpd = f.inverter?.kind === 'micro' ? ((inv as { modulesPerDevice?: number }).modulesPerDevice ?? 1) : null;
  return { panel, inv: inv as (null | { manufacturer: string; model: string; [k: string]: any }), battery, mpd };
}

/** `n` placed modules, as Design writes them — each stamped with its wattage. */
const placed = (n: number, wattage: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({
    id: `pnl-${i}`, layoutId: 'lo', lat: 0, lng: 0, x: 0, y: 0, tilt: 20, azimuth: 180,
    wattage, bifacialGain: 0, row: 0, col: i, systemType: 'roof',
  })));

const decided = (basis: string) =>
  ({ kind: 'USER_SELECTED', recordedAt: '2026-10-01T15:00:00.000Z', basis, by: 'test-fixture' });

/** Write the family to the project row exactly as the product stores it. */
async function writeFamilyRow(f: Family) {
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const { panel, inv } = await catalogue(f);

  let stored: unknown = null;
  if (f.graph === 'rays-dc') {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const s = JSON.parse(JSON.stringify(serialiseServiceTopology(buildRaysIntendedJob().topology)));
    s.topology.solarCoupling = 'dc-coupled-storage';
    stored = s;
  } else if (f.graph === 'ac-coupled') {
    // The wizard's own authoring path — the same helpers the Service Topology builder calls.
    const { buildServiceFromPreset } = await import('@/lib/electrical/topologyPresets');
    const { addBackupDomain, setSolarCoupling } = await import('@/lib/electrical/topologyAuthoring');
    const t0 = buildServiceFromPreset({ ratedAmps: f.serviceAmps, distribution: 'one-main-panel' }).topology;
    const d = addBackupDomain(t0, {
      branchId: t0.branches[0].id, panelIds: [t0.panels[0].id],
      gatewayProductId: f.storage!.gatewayId, storageProductIds: [f.storage!.batteryId],
    });
    stored = serialiseServiceTopology(setSolarCoupling(d.topology, 'ac-coupled-inverter'));
  }

  const se: Record<string, unknown> = {
    panelId: f.panelId,
    ...(f.inverter && inv
      ? { inverter: { id: f.inverter.id, type: f.inverter.kind, manufacturer: inv.manufacturer, model: inv.model },
          inverterId: f.inverter.id }
      : { inverter: null, inverterId: null }),
    ...(f.storage ? { batteries: [{ id: f.storage.batteryId }], batteryCount: 1 } : {}),
    ...(f.graph === 'rays-dc' ? { batteryCount: 4 } : {}),
    provenance: {
      ...(f.inverter ? { inverter: decided('Picked in the equipment selector') } : {}),
      ...(f.architectureDecided
        ? { architecture: decided(f.graph === 'rays-dc'
            ? 'Inverter: None — PV direct to Powerwall 3' : 'PV on its own AC inverter') }
        : {}),
    },
  };

  // The string assignment as Inverters & Strings holds it: one inverter whose strings cover the
  // design (two strings for a string inverter, one branch group for micros); none on the DC job.
  const half = Math.ceil(f.modules / 2);
  const ec = {
    schemaVersion: 2, mainPanelAmps: f.serviceAmps,
    inverters: f.inverter ? [{
      inverterId: f.inverter.id, type: f.inverter.kind,
      strings: f.inverter.kind === 'micro'
        ? [{ panelId: f.panelId, panelCount: f.modules }]
        : [{ panelId: f.panelId, panelCount: half }, { panelId: f.panelId, panelCount: f.modules - half }],
    }] : [],
  };

  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4 WHERE id = $1`,
    [PROJECT, stored ? JSON.stringify(stored) : null, JSON.stringify(se), JSON.stringify(ec)]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, system_type, panels, total_panels) VALUES ($1,$2,'roof',$3::jsonb,$4)`,
    [PROJECT, USER_ID, placed(f.modules, panel.watts), f.modules]);
}

// ─── THE PAGE'S REQUESTS ───────────────────────────────────────────────────

/** `sldRequestTopology` on the engineering page, for this family. */
const pageTopology = (f: Family) =>
  f.graph === 'rays-dc' ? 'DC_COUPLED_STORAGE'
    : f.inverter?.kind === 'micro' ? 'MICROINVERTER'
      : f.inverter?.kind === 'optimizer' ? 'STRING_WITH_OPTIMIZER'
        : f.inverter ? 'STRING_INVERTER' : 'UNRESOLVED';

/**
 * The Diagram tab's body (`fetchSLDSvg`), with `totalModules` as given — the page's own count, or a
 * stale one. Everything the page derives FROM its count (strings, micro devices) is derived from that
 * same count, because that is what an out-of-date page actually sends.
 */
async function pageSldBody(f: Family, totalModules: number) {
  const { panel, inv, battery, mpd } = await catalogue(f);
  return {
    projectId: PROJECT,
    projectName: 'Brand Family', clientName: 'Brand Family', address: '238 N Warwick Ave, Peoria, IL',
    drawingDate: '2026-10-03', drawingNumber: 'SLD-001', revision: 'A',
    topologyType: pageTopology(f),
    totalModules,
    totalStrings: f.inverter?.kind === 'micro' ? 1 : 2,
    deviceCount: mpd ? Math.ceil(totalModules / mpd) : undefined,
    panelModel: `${panel.manufacturer} ${panel.model}`,
    panelWatts: panel.watts, panelVoc: panel.voc, panelIsc: panel.isc,
    panelVmp: panel.vmp, panelImp: panel.imp, tempCoeffVoc: panel.tempCoeffVoc,
    maxSeriesFuse: panel.maxSeriesFuseRating,
    dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
    // Exactly the page's spellings — including 'String Inverter' when there is no fleet.
    inverterModel: inv ? `${inv.manufacturer} ${inv.model}` : 'String Inverter',
    inverterManufacturer: inv?.manufacturer ?? '',
    inverterId: f.inverter?.id,
    acOutputKw: inv?.acOutputKw ?? 7.6,
    inverterMaxDcV: inv?.maxDcVoltage || 600, maxDcVoltage: inv?.maxDcVoltage || 600,
    mpptVoltageMin: inv?.mpptVoltageMin || 100, mpptVoltageMax: inv?.mpptVoltageMax || 600,
    mpptChannels: inv?.mpptChannels || 2,
    acWireGauge: '#8 AWG', acConduitType: 'EMT', acWireLength: 60,
    mainPanelAmps: f.serviceAmps, utilityName: 'Ameren Illinois', interconnection: 'LOAD_SIDE',
    hasBattery: !!battery,
    batteryBrand: battery?.manufacturer, batteryModel: battery ? `${battery.manufacturer} ${battery.model}` : undefined,
    batteryKwh: battery?.usableCapacityKwh, batteryId: battery?.id,
    backupInterfaceId: f.storage?.gatewayId,
    inverterModulesPerDevice: mpd ?? 1,
    selectedBrand: f.inverter?.brand, selectedInverterId: f.inverter?.id,
    panelId: f.panelId, systemType: 'roof', panelTempCoeffVoc: panel.tempCoeffVoc,
  };
}

/** The Export PDF button's `buildInput` — its own shape (model without the brand, inverterSpecs). */
async function pagePdfBuildInput(f: Family, totalModules: number) {
  const { panel, inv, battery } = await catalogue(f);
  return {
    projectId: PROJECT,
    projectName: 'Brand Family', clientName: 'Brand Family', address: '238 N Warwick Ave, Peoria, IL',
    date: '2026-10-03', systemVoltage: 240, mainPanelAmps: f.serviceAmps,
    utilityName: 'Ameren Illinois', interconnection: 'LOAD_SIDE', interconnectionType: 'LOAD_SIDE',
    topologyType: pageTopology(f),
    totalModules,
    totalStrings: f.inverter?.kind === 'micro' ? 0 : 2,
    inverterManufacturer: inv?.manufacturer, inverterModel: inv?.model,
    acOutputKw: inv?.acOutputKw ?? 7.6,
    panelId: f.panelId, panelModel: `${panel.manufacturer} ${panel.model}`,
    panelWatts: panel.watts, panelVoc: panel.voc, panelIsc: panel.isc,
    panelVmp: panel.vmp, panelImp: panel.imp, tempCoeffVoc: panel.tempCoeffVoc,
    maxSeriesFuse: panel.maxSeriesFuseRating,
    hasBattery: !!battery,
    batteryBrand: battery?.manufacturer, batteryModel: battery ? `${battery.manufacturer} ${battery.model}` : undefined,
    batteryKwh: battery?.usableCapacityKwh, batteryId: battery?.id,
    backupInterfaceId: f.storage?.gatewayId,
    // 🚨 The page posts `deviceCount: totalPanels` for a micro export — derived from its own count.
    deviceCount: f.inverter?.kind === 'micro' ? totalModules : undefined,
    inverterSpecs: inv ? [{ inverterId: f.inverter!.id, manufacturer: inv.manufacturer, model: inv.model,
      acOutputKw: inv.acOutputKw ?? 0 }] : [],
    panelSpecs: f.inverter ? [{ panelId: f.panelId, manufacturer: panel.manufacturer, model: panel.model,
      watts: panel.watts, voc: panel.voc, isc: panel.isc }] : [],
  };
}

async function postSld(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, format: 'json' }),
  }));
  const json = await res.json() as Record<string, any>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
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

/** Text content of an SVG with tags stripped, so assertions read what a human reads. */
const textOf = (svg: string) => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const ROUTES = [
  { name: 'Diagram tab (POST /api/engineering/sld)',
    post: async (f: Family, n: number) => postSld(await pageSldBody(f, n)) },
  { name: 'Export PDF (POST /api/engineering/sld/pdf)',
    post: async (f: Family, n: number) => postPdfAsSvg(await pagePdfBuildInput(f, n)) },
] as const;

/** The array, as the sheet must state it: Design's count, Design's module, Design's DC size. */
async function expectDesignArray(t: string, f: Family) {
  const { panel, mpd } = await catalogue(f);
  const stale = f.modules - 3;
  expect(t, 'the PV array label').toContain(`${f.modules} × ${panel.watts}W`);
  expect(t, 'the equipment schedule').toContain(`Total Modules ${f.modules}`);
  expect(t, 'the array the stale body described').not.toContain(`${stale} × ${panel.watts}W`);
  expect(t).not.toContain(`Total Modules ${stale}`);
  if (mpd) {
    // One IQ8 per module: a micro count that disagrees with the module count is a different array.
    const devices = Math.ceil(f.modules / mpd);
    expect(t, 'the microinverter count follows the modules Design placed')
      .toContain(`Microinverters ${devices} units`);
    expect(t).not.toContain(`Microinverters ${Math.ceil(stale / mpd)} units`);
  }
}

function expectFamilySheet(t: string, f: Family) {
  for (const s of f.sheet.has) {
    if (typeof s === 'string') expect(t, `${f.key}: sheet must say '${s}'`).toContain(s);
    else expect(t, `${f.key}: sheet must match ${s}`).toMatch(s);
  }
  for (const s of f.sheet.hasNot) {
    if (typeof s === 'string') expect(t, `${f.key}: sheet must not say '${s}'`).not.toContain(s);
    else expect(t, `${f.key}: sheet must not match ${s}`).not.toMatch(s);
  }
}

// ─── THE FIXTURES, THROUGH BOTH ROUTES ─────────────────────────────────────

for (const f of FAMILIES) {
  describe(`🚨 ${f.key} · ${f.title}`, () => {
    for (const route of ROUTES) {
      it(`${route.name}: the page's body draws Design's ${f.modules}-module array and this family's equipment`, async () => {
        await writeFamilyRow(f);
        const r = await route.post(f, f.modules);
        expect(r.status, JSON.stringify(r.json ?? {}).slice(0, 400)).toBe(200);
        const t = textOf(r.svg);
        await expectDesignArray(t, f);
        expectFamilySheet(t, f);
        if (f.graph === 'rays-dc') {
          // No standalone inverter of ANY brand is named on a design that has none.
          const { STRING_INVERTERS, MICROINVERTERS } = await import('@/lib/equipment-db');
          const named = [...STRING_INVERTERS, ...MICROINVERTERS].map(p => p.model).filter(m => t.includes(m));
          expect(named, 'a standalone inverter is named on a DC-coupled sheet').toEqual([]);
          expect(t).not.toContain('String Inverter');
        }
      });

      it(`${route.name}: a STALE body (totalModules ${f.modules - 3}) still draws Design's ${f.modules}`, async () => {
        await writeFamilyRow(f);
        const r = await route.post(f, f.modules - 3);
        expect(r.status, JSON.stringify(r.json ?? {}).slice(0, 400)).toBe(200);
        const t = textOf(r.svg);
        await expectDesignArray(t, f);
        // The correction is to the array only — the family's equipment is untouched by it.
        expectFamilySheet(t, f);
      });
    }
  });
}

describe('🚨 a stale brand hint cannot re-architect an AC-coupled job (same class as the DC-coupled browser finding)', () => {
  it('SMA Sunny Boy + Powerwall 2 posted with the migration default selectedBrand "enphase" stays a Sunny Boy string sheet', async () => {
    // On Ray's DC-coupled job the production page posted `selectedBrand: 'enphase'` — a migration
    // default — and the route's brand engine turned the sheet into a microinverter path. The
    // projection now asserts the recorded inverter as the sizing hint on AC-coupled jobs too, so
    // the brand engine sizes the inverter the project actually holds.
    const f = FAMILIES.find(x => x.key === '3a-ac-pw2')!;
    await writeFamilyRow(f);
    const r = await postSld({ ...(await pageSldBody(f, f.modules)), selectedBrand: 'enphase', selectedInverterId: '' });
    expect(r.status, JSON.stringify(r.json ?? {}).slice(0, 400)).toBe(200);
    const t = textOf(r.svg);
    expect(t).toContain('Sunny Boy 7.7-US');
    expect(t, 'the stale brand hint drew a microinverter path').not.toMatch(/MICROINVERTER/);
  });
});

describe('🚨 the plain house is never asked for a battery', () => {
  it('no graph and no storage ⇒ 200 on both routes, and the only storage text is "NONE"', async () => {
    const f = FAMILIES.find(x => x.key === '6-simple')!;
    await writeFamilyRow(f);
    for (const route of ROUTES) {
      const r = await route.post(f, f.modules);
      expect(r.status, `${route.name}: ${JSON.stringify(r.json ?? {}).slice(0, 300)}`).toBe(200);
      const rest = textOf(r.svg).replace('Battery Storage NONE', '');
      expect(rest, `${route.name} mentions storage on a house that has none`)
        .not.toMatch(/batter|powerwall|storage|\bESS\b|kWh/i);
    }
  });
});

describe('control — no Design layout and no selected module: the posted array stands', () => {
  it('both routes draw exactly the complete body they were sent', async () => {
    // The store has no answer for this project (no layout row, no panelId, no string assignment),
    // so nothing may be projected. Without this control a projection that overwrote every request
    // would also pass every case above — and under the mutation it stays green, which is the point.
    await db.query(
      `UPDATE projects SET selected_equipment = $2, engineering_config = $3 WHERE id = $1`,
      [CONTROL,
       JSON.stringify({ inverter: { id: 'fronius-primo-7.6', type: 'string' }, inverterId: 'fronius-primo-7.6' }),
       JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 200 })]);
    const f = FAMILIES.find(x => x.key === '2-string')!;
    const svgBody = { ...(await pageSldBody(f, 14)), projectId: CONTROL };
    const pdfBody = { ...(await pagePdfBuildInput(f, 14)), projectId: CONTROL };
    for (const [name, r] of [
      ['Diagram tab', await postSld(svgBody)],
      ['Export PDF', await postPdfAsSvg(pdfBody)],
    ] as const) {
      expect(r.status, `${name}: ${JSON.stringify(r.json ?? {}).slice(0, 300)}`).toBe(200);
      const t = textOf(r.svg);
      expect(t, name).toContain('14 × 435W');
      expect(t, name).toContain('Total Modules 14');
      expect(t, name).toContain('Primo 7.6-1');
    }
  });
});
