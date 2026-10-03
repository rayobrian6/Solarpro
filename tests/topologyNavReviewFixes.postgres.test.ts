// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1 — REVIEW FIXES, THROUGH THE REAL PATH.
//
// answer → PUT /api/projects/[id]/service-topology → real PostgreSQL (PGlite, in-process) → GET →
// the SLD / BOM / electrical-architecture routes. Each decision this slice moved into System Config
// reaches every consumer that prints it:
//   · a PW3's commissioned output setting → the conductor schedule's battery circuit (computeSystem);
//   · the generation panel's chosen part → the BOM;
//   · a CHANGE of a recorded PV coupling (DC onto the batteries) → the separate inverter retired, so
//     the architecture resolves and the SLD draws.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOUSE = '9d4e9a4f-2e3d-4b9a-9f77-5c1d0e9f8a99';
const MODULE = 'ps-mnb108-440';
const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') return (await pg.query(strings, (values[0] as unknown[]) ?? [])).rows;
    let text = ''; const params: unknown[] = [];
    strings.forEach((s, i) => { text += s; if (i < values.length) { params.push(values[i]); text += `$${params.length}`; } });
    return (await pg.query(text, params)).rows;
  }) as unknown as never;
}
vi.mock('@/lib/db-neon', async (o) => ({ ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db) }));
vi.mock('@/lib/db/core', async (o) => ({ ...(await o<Record<string, unknown>>()), getDbReady: async () => neonShim(db) }));
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
    `ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`,
  ]) await db.exec(c);
  await Promise.all([
    import('@/app/api/projects/[id]/service-topology/route'),
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/app/api/engineering/electrical-architecture/route'),
    import('@/lib/electrical/loadElectricalProject'),
  ]);
}, 120_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address, selected_equipment)
     VALUES ($1, $2, 'Probe', 'lead', 'roof', '238 N Warwick Ave', $3)`,
    [HOUSE, USER_ID, JSON.stringify({ panelId: MODULE, batteryId: PW3, batteryCount: 4, backupControllerId: GW3 })]);
  await db.query(`INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,37)`, [HOUSE, USER_ID]);
});

const ctx = { params: Promise.resolve({ id: HOUSE }) };
async function persist(r: AnswerResult | ServiceTopology) {
  const t = 'ok' in (r as object) ? (() => { const a = r as AnswerResult; if (a.ok === false) throw new Error(a.refused); return a.topology; })() : r as ServiceTopology;
  const { PUT } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await PUT(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topology: t }),
  }), ctx);
  expect(res.status, JSON.stringify(await res.clone().json()).slice(0, 300)).toBe(200);
}
async function reload(): Promise<ServiceTopology> {
  const { GET } = await import('@/app/api/projects/[id]/service-topology/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest(`http://localhost/api/projects/${HOUSE}/service-topology`), ctx);
  const json = await res.json() as { available: boolean; topology: ServiceTopology };
  return json.topology;
}
async function sld(over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: HOUSE, format: 'json', projectName: 'Probe', address: '238 N Warwick Ave',
      topologyType: 'DC_COUPLED', totalModules: 37,
      panelModel: 'Philadelphia Solar PS-MNB108(HCBF)-440W', panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      mainPanelAmps: 400, utilityName: 'Local Utility',
      hasBattery: true, batteryModel: 'Powerwall 3', batteryId: PW3, batteryCount: 4, backupInterfaceId: GW3,
      ...over,
    }),
  }));
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json, svg: String(json.svg ?? '') };
}
async function bom() {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: HOUSE, totalPanels: 37, batteryCount: 4, batteryId: PW3, inverters: [] }),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);

async function raysJob(): Promise<ServiceTopology> {
  const A = await import('@/lib/electrical/systemConfigAnswers');
  const ok = (r: AnswerResult) => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
  let t = ok(A.answerServiceRating(null, 400));
  t = ok(A.answerDistribution(t, 'two-main-panels'));
  t = ok(A.answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
    unitsPerPanel: { [t.panels[0].id]: 2, [t.panels[1].id]: 2 } }));
  t = { ...t, solarCoupling: 'dc-coupled-storage' };
  t = ok(A.answerStorageLanding(t, 'der-aggregation-panel'));
  t = ok(A.answerSystemsArrangement(t, 'independent-branch'));
  t = ok(A.answerInterconnection(t, 'manufacturer-integrated'));
  return t;
}


/** The conductor schedule's battery-circuit row, as printed: the cells after its run id. */
/**
 * The conductor schedule's storage-circuit rows. On a graph job these are the CANONICAL runs
 * (lib/electrical/electricalRuns.ts) — one row per Powerwall circuit, tagged E-n — not computeSystem's
 * single BATTERY_TO_BUI_RUN, which described one battery and one interface.
 */
const essRows = (svg: string): string[][] => {
  const t = texts(svg);
  const rows: string[][] = [];
  t.forEach((c, i) => { if (/^E-\d+$/.test(c)) rows.push(t.slice(i, i + 11)); });
  return rows;
};
const OCPD = 7;

describe('🚨 the commissioned output setting reaches the conductor schedule (computeSystem), not only the topology section', () => {
  it('both systems at 7.6 kW: the battery circuit row is 31.7 A on 40 A — and the setting survives the store', async () => {
    const { answerSystemEquipment, outputConfigOf } = await import('@/lib/electrical/systemConfigSystemEquipment');
    await persist(await raysJob());
    const at115 = await sld();
    expect(at115.status).toBe(200);
    const rows115 = essRows(at115.svg);
    expect(rows115, 'one schedule row per Powerwall circuit').toHaveLength(4);
    expect(rows115.map(r => r[OCPD]), 'the circuits at the published maximum').toEqual(['60A', '60A', '60A', '60A']);
    // The graph owns the storage side: computeSystem's one-battery pair is not scheduled beside it.
    expect(texts(at115.svg)).not.toContain('BATTERY_TO_BUI_RUN');

    let t = await reload();
    for (const d of t.domains) t = (r => { if (r.ok === false) throw new Error(r.refused); return r.topology; })(answerSystemEquipment(t, d.id, { outputConfigKw: 7.6 }));
    await persist(t);
    const back = await reload();
    expect(back.domains.map(d => outputConfigOf(back, d))).toEqual([7.6, 7.6]);

    const at76 = await sld();
    expect(at76.status).toBe(200);
    const rows76 = essRows(at76.svg);
    expect(rows76.map(r => r[OCPD]), 'the conductor schedule still sizes the 7.6 kW circuits at 11.5 kW')
      .toEqual(['40A', '40A', '40A', '40A']);
    // The same sheet's topology section says the same circuit.
    expect(texts(at76.svg)).toContain('40 A OCPD');
  }, 120_000);

  it('systems commissioned differently: each circuit row carries its OWN unit\'s setting', async () => {
    // computeSystem's single battery row could only show the LARGEST circuit; the canonical runs
    // have one row per circuit, so a 7.6 kW system and an 11.5 kW system each print their own OCPD.
    const { answerSystemEquipment } = await import('@/lib/electrical/systemConfigSystemEquipment');
    await persist(await raysJob());
    const t = await reload();
    const r = answerSystemEquipment(t, t.domains[0].id, { outputConfigKw: 7.6 });
    if (r.ok === false) throw new Error(r.refused);
    await persist(r.topology);
    const s = await sld();
    expect(s.status).toBe(200);
    const back = await reload();
    const panelOf = (domainId: string) => back.aggregationPanels.find(a => a.domainId === domainId)!.label;
    const rows = essRows(s.svg);
    const to = (domainId: string) => rows.filter(row => row[2] === panelOf(domainId)).map(row => row[OCPD]);
    expect(to(back.domains[0].id)).toEqual(['40A', '40A']);
    expect(to(back.domains[1].id)).toEqual(['60A', '60A']);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the PV coupling through the writer System Config chooses — production path', () => {
  async function arch() {
    const { GET } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(`http://localhost/api/engineering/electrical-architecture?projectId=${HOUSE}`));
    return await res.json() as Record<string, any>;
  }
  async function resolveRoute(coupling: string, change?: boolean) {
    const { POST } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://localhost/api/engineering/electrical-architecture', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: HOUSE, coupling, ...(change ? { change: true } : {}) }),
    }));
    return { status: res.status, json: await res.json() as Record<string, any> };
  }
  async function selectedEquipment(): Promise<Record<string, any>> {
    const r = await db.query(`SELECT selected_equipment FROM projects WHERE id = $1`, [HOUSE]);
    const v = (r.rows[0] as { selected_equipment: unknown }).selected_equipment;
    return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, any>;
  }
  /** What the page does on a PV-connection answer: `pvCouplingWritePath`, then that writer. */
  async function answerPvConnection(coupling: 'dc-coupled-storage' | 'ac-coupled-inverter') {
    const A = await import('@/lib/electrical/systemConfigAnswers');
    const a = await arch();
    const path = A.pvCouplingWritePath({
      coupling, decisionOnFile: a.couplingProvenance?.source === 'service-topology', hasGraph: true,
      hasExternalInverter: !!a.externalInverter,
    })!;
    if (path.writer === 'graph') { await persist(A.answerSolarCoupling(await reload(), coupling)); return { path, status: 200 }; }
    const r = await resolveRoute(coupling, path.change);
    return { path, status: r.status, json: r.json };
  }

  it('a recorded AC decision CHANGED to "PV onto the batteries": the inverter on file is retired, the architecture resolves, the SLD draws', async () => {
    await db.query(`UPDATE projects SET selected_equipment=$2 WHERE id=$1`, [HOUSE, JSON.stringify({
      panelId: MODULE, batteryId: PW3, batteryCount: 4,
      inverter: { id: 'tesla-solar-inverter-5p7k', type: 'string', manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW' },
      inverterId: 'tesla-solar-inverter-5p7k' })]);
    const t0 = await raysJob();
    await persist({ ...t0, solarCoupling: undefined } as unknown as ServiceTopology);
    // The first decision, AC, with the inverter on file — through the route, which confirms it.
    const first = await answerPvConnection('ac-coupled-inverter');
    expect(first.path).toEqual({ writer: 'architecture-route', change: false });
    expect(first.status).toBe(200);
    expect((await arch()).couplingProvenance.source).toBe('service-topology');

    // The installer changes it in System Config: the route, as a deliberate change.
    const change = await answerPvConnection('dc-coupled-storage');
    expect(change.path).toEqual({ writer: 'architecture-route', change: true });
    expect(change.status, JSON.stringify(change.json)).toBe(200);
    expect(change.json!.retiredExternalInverter).toBe(true);
    const after = await arch();
    expect(after.coupling).toBe('dc-coupled-storage');
    expect(after.resolutionRequired).toBe(false);
    expect(after.externalInverter).toBeNull();
    expect((await selectedEquipment()).retiredInverter?.id).toBe('tesla-solar-inverter-5p7k');
    const s = await sld();
    expect(s.status, JSON.stringify(s.json).slice(0, 300)).toBe(200);
  }, 120_000);

  it('control: the route still refuses to overwrite a recorded decision WITHOUT change intent (a stale tab)', async () => {
    await persist({ ...(await raysJob()), solarCoupling: undefined } as unknown as ServiceTopology);
    expect((await resolveRoute('dc-coupled-storage')).status).toBe(200);
    const again = await resolveRoute('ac-coupled-inverter');
    expect(again.status).toBe(409);
    expect(again.json.refusal).toBe('NOTHING_TO_RESOLVE');
  }, 120_000);

  it('🚨 a first AC answer with NO inverter on file writes no inverter provenance — on either writer', async () => {
    await db.query(`UPDATE projects SET selected_equipment=$2 WHERE id=$1`, [HOUSE, JSON.stringify({ panelId: MODULE })]);
    const A = await import('@/lib/electrical/systemConfigAnswers');
    await persist(A.answerServiceRating(null, 200));
    const r = await answerPvConnection('ac-coupled-inverter');
    expect(r.path).toEqual({ writer: 'graph' });
    let prov = (await selectedEquipment()).provenance ?? {};
    expect(prov.architecture?.kind).toBe('USER_SELECTED');
    expect(prov.inverter, 'an inverter provenance for an inverter that does not exist').toBeUndefined();
    // The route itself, called directly (a banner, an old tab): the same — the planner is guarded.
    await db.query(`UPDATE projects SET selected_equipment=$2 WHERE id=$1`, [HOUSE, JSON.stringify({ panelId: MODULE })]);
    await persist({ ...(await reload()), solarCoupling: undefined } as unknown as ServiceTopology);
    expect((await resolveRoute('ac-coupled-inverter')).status).toBe(200);
    prov = (await selectedEquipment()).provenance ?? {};
    expect(prov.architecture?.kind).toBe('USER_SELECTED');
    expect(prov.inverter).toBeUndefined();
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the generation panel part chosen in System Config is ordered — POST /api/engineering/bom', () => {
  it('chosen for one of the two panels: one BOM line, quantity 1; none chosen: no line is invented', async () => {
    const G = await import('@/lib/electrical/systemConfigGenerationPanels');
    await persist(await raysJob());
    const items = async () => {
      const b = await bom();
      expect(b.status).toBe(200);
      return ((b.json as any).bom?.items ?? []) as Array<{ partNumber: string; quantity: number; description?: string }>;
    };
    expect((await items()).filter(i => /der-aggregation|BR816/i.test(`${i.partNumber} ${i.description ?? ''}`))).toEqual([]);
    const t = await reload();
    await persist(G.answerGenerationPanelPart(t, t.aggregationPanels[0].id, { productId: 'Eaton BR816L125RP', busbarRatingA: 125, sccrA: 10_000 }));
    const line = (await items()).find(i => i.partNumber === 'Eaton BR816L125RP');
    expect(line, 'the chosen generation panel is not on the BOM').toBeTruthy();
    expect(line!.quantity).toBe(1);
    expect(line!.description).toMatch(/aggregation \/ AC generation panel/i);
  }, 120_000);
});
