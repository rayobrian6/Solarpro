// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE MUTATION PROOFS, DRIVEN THROUGH THE PRODUCTION ENTRY POINTS.
//
// Ray, twice, in the words that decide what this file is allowed to be:
//
//   "A test directly calling `bomFromServiceTopology()` does not prove the BOM page/route uses it.
//    A test directly calling `pricedQuantitiesFromBom()` does not prove pricing uses it. Drive the
//    real route/function/component used in production."
//
//   "Do not declare success from helper tests. Production consumers are the acceptance surface."
//
// So nothing here calls a helper and declares victory. Every assertion goes through one of:
//
//   · `loadElectricalProject(projectId, userId)` — the one assembly all four server surfaces use,
//     against a REAL PostgreSQL (PGlite, in-process, no credential);
//   · `POST /api/engineering/bom` — the actual exported route handler;
//   · `POST /api/engineering/permit` — the actual exported route handler;
//   · `GET /api/dev/electrical-authority` — the actual exported route handler.
//
// The graph is never loaded from a fixture into a consumer. It is AUTHORED with the same functions
// the builder component calls, WRITTEN through the real persistence, and READ BACK — so a field that
// does not survive serialisation fails here rather than in front of Ray.
//
// Mutations 1–14 from the gauntlet are mapped onto describe blocks below. The three that are not
// provable at this layer say so by name and point at the file that does prove them, rather than
// being quietly omitted — an unproven mutation that looks proven is the failure mode this whole
// slice exists to correct.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

let db: PGlite;

function neonShim(pg: PGlite) {
  return (async (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof strings === 'string') {
      const r = await pg.query(strings, (values[0] as unknown[]) ?? []);
      return r.rows;
    }
    let text = '';
    const params: unknown[] = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) { params.push(values[i]); text += `$${params.length}`; }
    });
    const r = await pg.query(text, params);
    return r.rows;
  }) as unknown as never;
}

vi.mock('@/lib/db-neon', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDbReady: async () => neonShim(db),
}));

// 🚨 THE ONLY THING MOCKED BESIDES THE DATABASE IS WHO IS LOGGED IN. The routes under test run
// their real bodies — their real reads, their real composition, their real responses.
vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, email: 'ray@example.com', name: 'Ray' }),
}));

const noConcurrently = (s: string) => s.replace(/CONCURRENTLY/gi, '');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(noConcurrently(read('lib', 'migrations', '002_project_coordinates.sql')));
  // The canonical equipment store (migration 101) and the module count the loader reads.
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`);
  await db.exec(`ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`);

  // ══════════════════════════════════════════════════════════════════════════
  // 🚨 WARM THE ROUTE MODULES HERE, NOT INSIDE A 10-SECOND TEST.
  //
  // These suites drive REAL route handlers, and the SLD / permit / BOM / calculate modules pull in
  // most of the engineering codebase. The first `await import(...)` of one of them is a cold module
  // graph — cheap alone, but in the full suite (where module import is the single largest cost) it
  // can exceed the 10 s test timeout on its own. The suite then reports a timeout on an `it()` whose
  // assertions never ran, which reads as a broken guard and is not one.
  //
  // So the import happens in `beforeAll`, where the documented 60 s boot budget lives. The per-test
  // timeout stays at 10 s and now measures the TEST — a genuinely hung handler still fails fast.
  // ══════════════════════════════════════════════════════════════════════════
  await Promise.all([
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/permit/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
  ]);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address)
     VALUES ($1, $2, '400 A Tesla', 'lead', 'roof', '1 Test St')`,
    [PROJECT, USER_ID]);
});

// ── Authoring Ray's real job the way the screen authors it ────────────────────
/**
 * 🚨 NO FIXTURE. Every call is one the builder component makes, in the order an operator clicks:
 * the 400 A service, two 200 A branches, two MSPs, two domains each with its own Gateway 3 and two
 * Powerwall 3, a generation panel per system, the two inline 200 A isolation switches, then the
 * interconnection. This is `d2a8acb8`'s job: 4 full PW3, 0 expansions, 2 generation panels.
 */
async function authorRaysRealJob(): Promise<ServiceTopology> {
  const A = await import('@/lib/electrical/topologyAuthoring');
  const P = await import('@/lib/electrical/topologyPresets');

  let t = A.createServiceTopology({ ratedAmps: 400, utilityId: 'comed' });
  t = A.addServiceBranch(t, { ratedAmps: 200 }).topology;
  t = A.addServiceBranch(t, { ratedAmps: 200 }).topology;
  t = A.addPanel(t, { busbarRatingA: 200, mainBreakerA: 200 }).topology;
  t = A.addPanel(t, { busbarRatingA: 200, mainBreakerA: 200 }).topology;

  // Two independent systems, each its own Gateway 3 with TWO FULL Powerwall 3 and NO expansion —
  // the hardware as it stands after `d2a8acb8`.
  for (let i = 0; i < 2; i++) {
    const usedBranches = new Set(t.domains.map(d => d.branchId));
    const usedPanels = new Set(t.domains.flatMap(d => d.backedUpPanelIds));
    const branch = t.branches.find(b => !usedBranches.has(b.id))!;
    const panel = t.panels.find(p => !usedPanels.has(p.id))!;
    t = A.addBackupDomain(t, {
      branchId: branch.id,
      panelIds: [panel.id],
      gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: ['tesla-powerwall-3', 'tesla-powerwall-3'],
      expansionProductIds: [],
      storageConnection: 'gateway-panelboard',
    }).topology;
  }

  // Each pair lands in its OWN generation/combiner panel before its Gateway — not one shared panel.
  t = P.applyPerSystemGenerationPanels(t).topology;

  t = A.addProtectiveDevice(t, {
    label: '400 A service disconnect', roles: ['service-disconnect'],
    ratedAmps: 400, lockableOpen: true,
  }).topology;
  // 🚨 THE TWO INLINE 200 A ISOLATION SWITCHES — rated from the path they interrupt, not from the
  // 400 A parent service, and placed INLINE so they actually interrupt something.
  for (const branch of [...t.branches]) {
    t = A.addProtectiveDevice(t, {
      label: `200 A utility DER isolation — ${branch.label}`,
      roles: ['der-isolation-disconnect'],
      ratedAmps: 200, lockableOpen: true, visibleOpen: true,
      inlineOnNodeId: branch.id,
    }).topology;
  }

  t = A.setInterconnection(t, {
    meterCollarPermitted: false,
    meterCollarSelected: false,
    externalDerIsolationRequired: true,
  });
  t = A.setSolarCoupling(t, 'dc-coupled-storage');
  return t;
}

/** Author, persist through the real write path, and read back through the real read path. */
async function persistRaysJob(): Promise<ServiceTopology> {
  const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
  const authored = await authorRaysRealJob();
  const ok = await writeServiceTopology(PROJECT, USER_ID, authored);
  expect(ok, 'the real write path refused the authored graph').toBe(true);
  const stored = await readServiceTopology(PROJECT, USER_ID);
  expect(stored, 'the real read path returned nothing for a graph it just wrote').toBeTruthy();
  return stored!.topology;
}

/** Put a catalogue selection on the project, the way the equipment picker does. */
async function setSelectedEquipment(se: Record<string, unknown> | null): Promise<void> {
  await db.query(`UPDATE projects SET selected_equipment = $2 WHERE id = $1`,
    [PROJECT, se === null ? null : JSON.stringify(se)]);
}

/** Put a module count on the project, the way a saved layout does. */
async function setModuleCount(n: number): Promise<void> {
  await db.query(
    `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1, $2, $3)`,
    [PROJECT, USER_ID, n]);
}

/**
 * Total quantity of a PRODUCT across every BOM line, matched on manufacturer + model.
 *
 * 🚨 NOT BY PART NUMBER, deliberately. `lib/bom-engine-v4.ts` keys storage by the catalogue part
 * number ('PW3-US') and `lib/bom/topologyBom.ts` by the product id ('tesla-powerwall-3'); a test
 * that looks up one key cannot see a line sitting under the other, which is how a double count hid.
 */
function productTotal(
  items: Array<{ quantity: number; manufacturer?: string; model?: string }>,
  mfr: RegExp, model: RegExp,
): number {
  return items
    .filter(i => mfr.test(String(i.manufacturer ?? '')) && model.test(String(i.model ?? '')))
    .reduce((s, i) => s + i.quantity, 0);
}

const load = async () => {
  const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
  return loadElectricalProject(PROJECT, USER_ID);
};

// ── Driving the real route handlers ──────────────────────────────────────────
async function postBom(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

async function postPermit(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/permit/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/engineering/permit', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

async function getInspector(projectId = PROJECT) {
  const { GET } = await import('@/app/api/dev/electrical-authority/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(
    `http://localhost/api/dev/electrical-authority?projectId=${projectId}`);
  const res = await GET(req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the production assembly reads one project and answers once', () => {
  it('loadElectricalProject composes the real job off a real database', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    const loaded = await load();

    expect(loaded, 'the production entry point returned nothing').toBeTruthy();
    expect(loaded!.model.serviceRatedAmps).toBe(400);
    expect(loaded!.model.storage.invertingUnitCount).toBe(4);
    expect(loaded!.model.storage.expansionUnitCount).toBe(0);
    expect(loaded!.model.storage.gatewayCount).toBe(2);
    expect(loaded!.model.storage.perSystemGenerationPanelCount).toBe(2);
    expect(loaded!.model.solarCoupling).toBe('dc-coupled-storage');
    expect(loaded!.model.moduleCount).toBe(72);
    expect(loaded!.model.conflicts).toEqual([]);
    expect(loaded!.sources.serviceTopology).toBe('projects.service_topology');
    expect(loaded!.sources.moduleCount).toBe('layouts.total_panels');
    expect(loaded!.revision.startsWith('ELEC-')).toBe(true);
  });

  it('another user cannot read this project\'s electrical state', async () => {
    await persistRaysJob();
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    expect(await loadElectricalProject(PROJECT, OTHER_USER)).toBeNull();
  });

  it('a project with no graph resolves rather than erroring', async () => {
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' }, batteryCount: 2 });
    await setModuleCount(30);
    const loaded = await load();
    expect(loaded!.model.topology).toBeNull();
    expect(loaded!.model.solarCoupling).toBe('ac-coupled-inverter');
    expect(loaded!.model.storage.invertingUnitCount).toBe(2);
    expect(loaded!.model.storage.provenance.source).toBe('selected-equipment');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 13 — the actual 400 A Tesla fixture. Every production output must agree.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 13 — the real 400 A job, through every production surface', () => {
  beforeEach(async () => { await persistRaysJob(); await setModuleCount(72); });

  it('the canonical model states the job', async () => {
    const m = (await load())!.model;
    expect(m.serviceRatedAmps).toBe(400);
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.gatewayCount).toBe(2);
    expect(m.storage.perSystemGenerationPanelCount).toBe(2);
    expect(m.storage.expansionUnitCount).toBe(0);
    // 54.0 kWh — four 13.5 kWh cabinets.
    expect(m.storage.usableKwh).toBeCloseTo(54, 1);
    // 192 A configured AC — four units at the 11.5 kW / 48 A configuration.
    expect(m.storage.continuousOutputA).toBeCloseTo(192, 1);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
  });

  it('🚨 the BOM ROUTE counts four Powerwalls, two Gateways and two generation panels', async () => {
    // Deliberately POST a WRONG battery count, the way a stale page would.
    const { status, json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', batteryCount: 1,
      panelId: 'qcell-q6', moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    expect(status).toBe(200);
    const elec = json.electrical as Record<string, unknown>;
    expect(elec, 'the BOM route did not consume the canonical model').toBeTruthy();
    // 🚨 THE POSTED 1 LOST TO THE GRAPH'S 4.
    expect(elec.storageUnits).toBe(4);
    expect(elec.gateways).toBe(2);
    expect(elec.generationPanels).toBe(2);
    expect(elec.coupling).toBe('dc-coupled-storage');
    expect(String(elec.revision).startsWith('ELEC-')).toBe(true);

    // 🚨 AND PRICING AGREES WITH THE GRAPH — reconciliation is empty.
    expect(elec.quantityDisagreements,
      'the BOM and the service graph disagree on a quantity').toEqual([]);

    // The graph's own equipment reached the line items.
    const bom = json.bom as {
      items: Array<{ partNumber: string; quantity: number; derivedFrom?: string; description?: string }>;
    };
    // 🚨 COUNTED BY PRODUCT, NOT BY PART NUMBER. The graph's `tesla-powerwall-3` line folds into the
    // engine's catalogue `PW3-US` line (same product, two keying schemes), so a part-number lookup
    // for either key alone sees the wrong number. `productTotal` below is the honest count.
    expect(productTotal(bom.items, /tesla/i, /powerwall\s*3$/i),
      'four Powerwalls did not reach the BOM').toBe(4);
    expect(productTotal(bom.items, /tesla/i, /backup gateway 3/i),
      'two Gateways did not reach the BOM').toBe(2);

    // 🚨 AND THE ENGINE'S OWN BATTERY-DERIVED LINES FOLLOW THE GRAPH TOO.
    //
    // Found by restoring the defect: asserting only on the Powerwall quantity passed EVEN WITH the
    // canonical override deleted, because the service-graph merge corrects that line afterwards. The
    // override earns its place somewhere else — `lib/bom-engine-v4.ts` feeds `batteryCount` into
    // `resolveBatteryBranch(...)`, which sizes the BATTERY BRANCH OCPD, and emits a line whose
    // quantity IS the count. A test that could not see those was blind to the thing it was for.
    const batteryDerived = bom.items.filter(i => i.derivedFrom === 'batteryCount');
    expect(batteryDerived.length,
      'the engine emitted no batteryCount-derived line to check').toBeGreaterThan(0);
    for (const line of batteryDerived) {
      expect(line.quantity,
        `'${line.partNumber}' was sized from the POSTed 1 rather than the graph's 4`).toBe(4);
    }
  });

  it('🚨 and it orders FOUR Powerwalls, not four twice', async () => {
    // 🚨 THIS DEFECT WAS REAL AND WAS MINE. The engine keys its storage line by the catalogue part
    // number ('PW3-US'); the service-graph BOM keys by product id ('tesla-powerwall-3'). The first
    // version of the merge compared part-number strings, found no collision, and shipped EIGHT
    // cabinets on one BOM — four under each key, both priced. A quantity assertion on either key
    // alone passes happily while the total is double.
    //
    // So this counts by PRODUCT IDENTITY across every line, which is the only way to see it.
    const { json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', batteryCount: 1,
      panelId: 'qcell-q6', moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    const bom = json.bom as {
      items: Array<{ partNumber: string; quantity: number; manufacturer?: string; model?: string }>;
    };
    const totalFor = (mfr: RegExp, model: RegExp) => bom.items
      .filter(i => mfr.test(String(i.manufacturer ?? '')) && model.test(String(i.model ?? '')))
      .reduce((s, i) => s + i.quantity, 0);

    expect(totalFor(/tesla/i, /powerwall\s*3$/i),
      'the BOM ordered the Powerwalls twice under two different part numbers').toBe(4);
    expect(totalFor(/tesla/i, /backup gateway 3/i),
      'the BOM ordered the Gateways twice').toBe(2);

    // And no two lines name the same product under different part numbers.
    const seen = new Map<string, string>();
    for (const i of bom.items) {
      const id = `${String(i.manufacturer ?? '').toLowerCase()}|${String(i.model ?? '').toLowerCase()}`;
      if (id === '|') continue;
      const prior = seen.get(id);
      expect(prior === undefined || prior === i.partNumber,
        `'${i.manufacturer} ${i.model}' appears as both '${prior}' and '${i.partNumber}'`).toBe(true);
      seen.set(id, i.partNumber);
    }
  });

  it('🚨 pricing multiplies the graph\'s counts, because it prices those exact lines', async () => {
    const { json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', batteryCount: 1,
      panelId: 'qcell-q6', moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    const bom = json.bom as {
      items: Array<{
        partNumber: string; quantity: number; totalCost?: number; unitCost?: number;
        manufacturer?: string; model?: string;
      }>;
    };
    const pw = bom.items.filter(i =>
      /tesla/i.test(String(i.manufacturer ?? '')) && /powerwall\s*3$/i.test(String(i.model ?? '')));
    expect(pw.length).toBeGreaterThan(0);
    // Whatever the unit cost resolves to, the TOTAL must be the unit cost times the graph's four —
    // that is the whole point: pricing cannot count differently from the drawing because it is
    // multiplying the drawing's own line.
    for (const line of pw) {
      if (typeof line.unitCost === 'number' && typeof line.totalCost === 'number' && line.unitCost > 0) {
        expect(line.totalCost).toBeCloseTo(line.unitCost * line.quantity, 2);
        expect(line.quantity).toBe(4);
      }
    }
  });

  it('🚨 a POSTed 200 A does not beat the graph\'s 400 A service', async () => {
    // FOUND IN THE ADVERSARIAL SWEEP. `mainPanelAmps: Number(body.mainPanelAmps) || 200` fabricated a
    // 200 A service whenever the page posted nothing — and accepted a posted 200 over the graph's
    // 400 — so conductors, the 120% busbar allowance and the backfed breaker were all sized against
    // half the real service. A scalar that disagrees with the graph and wins is the whole defect
    // class, arriving at the BOM.
    // 🚨 THE OBSERVABLE, FOUND BY DIFFING THE REAL ROUTE AT 200 A AND AT 400 A. The first version of
    // this test asserted on descriptions mentioning "200 A service" and passed WITH THE DEFECT
    // RESTORED — nothing emits that phrase, so it proved nothing. What actually moves is the
    // NEC 705.12(B) backfeed breaker: a 200 A busbar allows 40 A of backfeed and the BOM orders a
    // QO40; the real 400 A busbar allows 80 A and it orders a QO80. Sizing that breaker from a stale
    // scalar is a safety-relevant error, not a cosmetic one.
    const { json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', panelId: 'qcell-q6',
      moduleCount: 72, totalPanels: 72, systemType: 'roof',
      mainPanelAmps: 200,                       // the stale scalar
      acOCPD: 200, backfeedAmps: 200,
    });
    const bom = json.bom as { items: Array<{ partNumber: string; description?: string }> };
    // The breaker line states the busbar it was sized against ("bus: 400A"); the warning-LABEL line
    // also says "backfeed breaker" and states no busbar, so it is excluded by the `bus:` requirement
    // rather than by name — a name filter would silently drift if the label text changed.
    const backfeed = bom.items.filter(i =>
      /backfeed breaker/i.test(String(i.description ?? '')) && /bus:/.test(String(i.description ?? '')));
    expect(backfeed.length, 'no backfeed breaker line states the busbar it was sized against')
      .toBeGreaterThan(0);
    for (const line of backfeed) {
      expect(line.description, 'the backfeed breaker was sized against the stale 200 A busbar')
        .toContain('bus: 400A');
      expect(line.description).not.toContain('bus: 200A');
    }
  });

  it('🚨 the PERMIT ROUTE receives the graph — the field that had two readers and no writer', async () => {
    // Proven through the production handler by its OWN behaviour: the permit route only reaches the
    // 409 below when it has loaded the canonical model, and the conflict payload it returns carries
    // the revision that load produced. A green path here would need a full PDF render; the refusal
    // path exercises the same load, the same composition and the same revision stamp.
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' } });
    const { status, json } = await postPermit({
      projectId: PROJECT,
      project: { projectId: PROJECT, clientName: 'Ray', address: '1 Test St' },
      system: { totalPanels: 72, inverters: [] },
    });
    expect(status).toBe(409);
    // 🚨 THE CODE CHANGED, AND THE REASON MATTERS. This project's conflict IS the coupling, so the
    // architecture-specific refusal takes precedence over the permit's generic one — Ray: "SLD/BOM/
    // permit should report ELECTRICAL ARCHITECTURE REQUIRES RESOLUTION." The generic
    // `ELECTRICAL_CONFLICT` still guards the sealed package against every OTHER contradiction; the
    // test below this one holds it.
    expect(json.code).toBe('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
    expect(json.error).toBe('ELECTRICAL ARCHITECTURE REQUIRES RESOLUTION');
    expect(String(json.electricalRevision).startsWith('ELEC-')).toBe(true);
  });

  it('🚨 a NON-COUPLING conflict still refuses the package with the generic code', async () => {
    // The architecture gate must not have REPLACED the broad refusal. A stale battery-count mirror
    // is not an architecture question — it does not block a drawing — but it is still a
    // contradiction, and a sealed package asserting it would be asserting something the project
    // itself denies. Ray: a permit is "a sealed assertion submitted to an AHJ".
    //
    // No separate inverter ⇒ no coupling conflict; a wrong `batteryCount` ⇒ the mirror conflict.
    await setSelectedEquipment({ batteryCount: 9 });
    const { status, json } = await postPermit({
      projectId: PROJECT,
      project: { projectId: PROJECT, clientName: 'Ray', address: '1 Test St' },
      system: { totalPanels: 72, inverters: [] },
    });
    expect(status).toBe(409);
    expect(json.code).toBe('ELECTRICAL_CONFLICT');
    const cs = json.conflicts as Array<{ fact: string }>;
    expect(cs.some(c => /how many storage units/i.test(c.fact))).toBe(true);
  });

  it('the authority inspector reports the job, its owners and its revision', async () => {
    const { status, json } = await getInspector();
    expect(status).toBe(200);
    const report = json.report as Record<string, unknown>;
    expect(String(report.electricalRevision).startsWith('ELEC-')).toBe(true);
    const rows = report.rows as Array<Record<string, unknown>>;
    const byField = (f: string) => rows.find(r => String(r.field).includes(f))!;
    expect(String(byField('Service rating').value)).toContain('400 A');
    expect(String(byField('Storage unit quantity').value)).toContain('4 inverting');
    expect(String(byField('Gateway quantity').value)).toContain('2 gateway');
    expect(String(byField('Generation / combiner panel').value)).toContain('2 per-system');
    expect(String(byField('solarCoupling').value)).toContain('dc-coupled-storage');

    // 🚨 THE ANSWER RAY SAID MUST BE "NO".
    expect(json.mirrorsThatCouldWin,
      'a legacy mirror exists with no stated mechanism preventing it from winning').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS 1–3 — the three architectures, each staying itself.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 1 — a pure Enphase project remains pure Enphase', () => {
  it('no storage, an Enphase inverter, no graph: nothing Tesla appears', async () => {
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' }, batteryCount: 0 });
    await setModuleCount(37);
    const m = (await load())!.model;
    expect(m.solarCoupling).toBe('ac-coupled-inverter');
    expect(m.hasExternalInverter).toBe(true);
    expect(m.storage.invertingUnitCount).toBe(0);
    expect(m.storage.gatewayCount).toBe(0);
    expect(m.storage.models).toEqual([]);
    expect(m.conflicts).toEqual([]);
    expect(JSON.stringify(m).toLowerCase()).not.toContain('powerwall');
  });
});

describe('🚨 MUTATION 2 — a DC-coupled Tesla project fabricates no inverter', () => {
  it('no inverter is invented, and no Enphase appears anywhere in the model', async () => {
    await persistRaysJob();
    await setSelectedEquipment(null);          // nothing has ever been selected
    await setModuleCount(72);
    const m = (await load())!.model;
    expect(m.hasExternalInverter).toBe(false);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    const blob = JSON.stringify(m).toLowerCase();
    for (const invented of ['enphase', 'iq8', 'solaredge', 'se7600']) {
      expect(blob, `the model invented '${invented}'`).not.toContain(invented);
    }
  });

  it('🚨 and the BOM ROUTE orders no microinverters for it', async () => {
    await persistRaysJob();
    await setSelectedEquipment(null);
    await setModuleCount(72);
    const { json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', panelId: 'qcell-q6',
      moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    const bom = json.bom as { items: Array<{ partNumber: string; manufacturer?: string }> };
    const enphase = bom.items.filter(i =>
      /enphase|iq8/i.test(`${i.partNumber} ${i.manufacturer ?? ''}`));
    expect(enphase.map(i => i.partNumber),
      'the BOM ordered Enphase equipment for a DC-coupled Tesla job').toEqual([]);
  });
});

describe('🚨 MUTATION 3 — Tesla storage + legitimate AC-coupled Enphase stays valid', () => {
  it('an AC-coupled graph with an Enphase inverter is NOT a conflict', async () => {
    const { writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const A = await import('@/lib/electrical/topologyAuthoring');
    // The same hardware, but the designer recorded that the PV has its own AC inverter.
    const t = A.setSolarCoupling(await authorRaysRealJob(), 'ac-coupled-inverter');
    await writeServiceTopology(PROJECT, USER_ID, t);
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' } });
    await setModuleCount(37);

    const m = (await load())!.model;
    expect(m.solarCoupling).toBe('ac-coupled-inverter');
    expect(m.hasExternalInverter).toBe(true);
    // 🚨 Tesla storage does NOT delete Enphase. Four Powerwalls and 37 micros coexist legitimately.
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.conflicts, 'a legitimate AC-coupled Tesla job was reported as a conflict').toEqual([]);
  });

  it('and the permit route generates for it rather than refusing', async () => {
    const { writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const A = await import('@/lib/electrical/topologyAuthoring');
    await writeServiceTopology(PROJECT, USER_ID,
      A.setSolarCoupling(await authorRaysRealJob(), 'ac-coupled-inverter'));
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' } });
    const { status, json } = await postPermit({
      projectId: PROJECT,
      project: { projectId: PROJECT, clientName: 'Ray', address: '1 Test St' },
      system: { totalPanels: 37, inverters: [] },
    });
    // It must NOT be the electrical-conflict refusal. Whatever else the permit route does with an
    // incomplete payload is not this slice's business — only that it was not stopped as conflicted.
    expect(json.code, 'a legitimate AC-coupled Tesla job was refused as conflicted')
      .not.toBe('ELECTRICAL_CONFLICT');
    expect(status).not.toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS 4–6 — legacy canonicalization, through the real persistence.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 4 — unambiguous legacy state canonicalises ONCE and persists', () => {
  /** Ray's project as it was persisted before `solarCoupling` existed. */
  async function persistLegacyNoCoupling(): Promise<void> {
    const { writeServiceTopology, serialiseServiceTopology } =
      await import('@/lib/db/serviceTopology');
    const t = await authorRaysRealJob();
    await writeServiceTopology(PROJECT, USER_ID, t);
    // Strip the field in the stored JSON, exactly as a schema-v3 row has it.
    const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(t))) as
      { schemaVersion: number; topology: Record<string, unknown> };
    delete stored.topology.solarCoupling;
    stored.schemaVersion = 3;
    await db.query(`UPDATE projects SET service_topology = $2 WHERE id = $1`,
      [PROJECT, JSON.stringify(stored)]);
  }

  it('the legacy row really is legacy', async () => {
    await persistLegacyNoCoupling();
    const { readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    expect(t.solarCoupling ?? null, 'the legacy setup did not actually strip the field').toBeNull();
    // 🚨 AND THE GRAPH SURVIVED THE STRIP. Four units still there.
    expect(t.storage.length).toBe(4);
  });

  it('it resolves to DC coupled with provenance, and asks to be written once', async () => {
    await persistLegacyNoCoupling();
    await setModuleCount(72);
    const loaded = (await load())!;
    expect(loaded.model.solarCoupling).toBe('dc-coupled-storage');
    expect(loaded.model.solarCouplingProvenance.source).toBe('derived');
    expect(loaded.model.canonicalizationPatch).toEqual({ solarCoupling: 'dc-coupled-storage' });
  });

  it('🚨 persisting it makes the derivation STOP — resolved once, not inferred forever', async () => {
    await persistLegacyNoCoupling();
    await setModuleCount(72);
    const { persistElectricalCanonicalization } =
      await import('@/lib/electrical/loadElectricalProject');

    const before = (await load())!;
    expect(await persistElectricalCanonicalization(before, USER_ID)).toBe('written');

    // Read again: the coupling is now RECORDED and there is nothing left to patch.
    const after = (await load())!;
    expect(after.model.solarCoupling).toBe('dc-coupled-storage');
    // 🚨 AND IT STILL REPORTS ITSELF AS DERIVED, because it is. This assertion used to read
    // 'service-topology' — "Recorded on the project by the designer" — which was a canonicalization
    // describing its own output as a human's decision. That misstatement is how Ray's project came
    // to assert `ac-coupled-inverter` through two acceptance runs with nothing able to question it.
    //
    // What persisting BUYS is the end of re-derivation (`canonicalizationPatch` is null below), not
    // a promotion to somebody's word. The value stands because the EVIDENCE still supports it; a
    // derived value the evidence contradicts is re-opened instead.
    expect(after.model.solarCouplingProvenance.source).toBe('derived');
    expect(after.model.architectureResolutionRequired,
      'a derived value the evidence AGREES with was re-opened').toBe(false);
    expect(after.model.canonicalizationPatch,
      'the model is still deriving after the decision was persisted').toBeNull();

    // Idempotent: a second run has nothing to do.
    expect(await persistElectricalCanonicalization(after, USER_ID)).toBe('nothing-to-do');
  });

  it('🚨 canonicalizing changes nothing else about the graph', async () => {
    await persistLegacyNoCoupling();
    await setModuleCount(72);
    const { persistElectricalCanonicalization } =
      await import('@/lib/electrical/loadElectricalProject');
    const before = (await load())!;
    const b = before.model;
    await persistElectricalCanonicalization(before, USER_ID);
    const a = (await load())!.model;
    expect(a.serviceRatedAmps).toBe(b.serviceRatedAmps);
    expect(a.storage.invertingUnitCount).toBe(b.storage.invertingUnitCount);
    expect(a.storage.gatewayCount).toBe(b.storage.gatewayCount);
    expect(a.storage.perSystemGenerationPanelCount).toBe(b.storage.perSystemGenerationPanelCount);
    expect(a.storage.usableKwh).toBe(b.storage.usableKwh);
  });
});

describe('🚨 MUTATION 5 — contradictory legacy state produces an explicit conflict', () => {
  beforeEach(async () => {
    await persistRaysJob();                                      // records dc-coupled-storage
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' } });
    await setModuleCount(37);
  });

  it('both claims are preserved with their sources, and nothing is merged', async () => {
    const m = (await load())!.model;
    const c = m.conflicts.find(x => x.fact === 'How the PV is coupled');
    expect(c, 'a contradictory project reported no conflict').toBeTruthy();
    expect(c!.claims.map(x => x.source).sort())
      .toEqual(['selected-equipment', 'service-topology']);
    expect(c!.question).toContain('separate AC PV inverter');
    // 🚨 NO SYNTHETIC ARCHITECTURE. Ray: "Do not merge Enphase + Tesla into a synthetic
    // architecture." Nothing is written away, and the recorded side still stands as recorded.
    expect(m.canonicalizationPatch).toBeNull();
    expect(m.solarCoupling).toBe('dc-coupled-storage');
  });

  it('🚨 unrelated engineering keeps operating', async () => {
    // Ray: "Other unrelated engineering must continue operating." An argument about the PV must not
    // stop the service engineering.
    const m = (await load())!.model;
    expect(m.serviceRatedAmps).toBe(400);
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.gatewayCount).toBe(2);
    expect(m.storage.perSystemGenerationPanelCount).toBe(2);
  });

  it('🚨 the PERMIT ROUTE refuses the sealed package, naming both claims', async () => {
    const { status, json } = await postPermit({
      projectId: PROJECT,
      project: { projectId: PROJECT, clientName: 'Ray', address: '1 Test St' },
      system: { totalPanels: 37, inverters: [] },
    });
    expect(status).toBe(409);
    expect(json.code).toBe('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
    // 🚨 AND THE REFUSAL CARRIES THE ANSWERS, not just the complaint. A refusal that states a
    // problem and offers no way to settle it is how Ray ended up being told to delete equipment by
    // hand.
    const choices = json.choices as Array<{ coupling: string; retiresExternalInverter: boolean }>;
    expect(choices.map(c => c.coupling).sort())
      .toEqual(['ac-coupled-inverter', 'dc-coupled-storage']);
    expect(choices.find(c => c.coupling === 'dc-coupled-storage')!.retiresExternalInverter).toBe(true);
    const conflicts = json.conflicts as Array<{ fact: string; claims: unknown[]; question: string }>;
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].claims.length).toBe(2);
    expect(conflicts[0].question).toBeTruthy();
  });

  it('and the inspector shows the conflict against the field it touches', async () => {
    const { json } = await getInspector();
    const report = json.report as { rows: Array<Record<string, unknown>>; conflicts: unknown[] };
    expect(report.conflicts.length).toBeGreaterThan(0);
    const coupling = report.rows.find(r => String(r.field).includes('solarCoupling'))!;
    expect(coupling.conflict, 'the inspector did not surface the conflict').toBeTruthy();
    expect(String(coupling.conflict)).toContain('service-topology');
    expect(String(coupling.conflict)).toContain('selected-equipment');
  });
});

describe('🚨 MUTATION 6 — a missing service rating preserves the graph', () => {
  it('the graph survives, and only the rating is NOT_EVALUATED', async () => {
    const { writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await authorRaysRealJob();
    await writeServiceTopology(PROJECT, USER_ID,
      { ...t, service: { ...t.service, ratedAmps: null } });
    await setModuleCount(72);

    const m = (await load())!.model;
    // 🚨 THE KILL-SWITCH IS GONE. This used to return null for the WHOLE graph.
    expect(m.topology, 'one missing number deleted the entire service graph').toBeTruthy();
    expect(m.serviceRatedAmps).toBeNull();
    expect(m.serviceProvenance.basis).toContain('NOT_EVALUATED');
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.gatewayCount).toBe(2);
    expect(m.storage.perSystemGenerationPanelCount).toBe(2);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
  });

  it('and the BOM ROUTE still orders the right equipment for it', async () => {
    const { writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await authorRaysRealJob();
    await writeServiceTopology(PROJECT, USER_ID,
      { ...t, service: { ...t.service, ratedAmps: null } });
    const { json } = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', panelId: 'qcell-q6',
      moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    const elec = json.electrical as Record<string, unknown>;
    expect(elec.storageUnits).toBe(4);
    expect(elec.gateways).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 8 — save → reload leaves the interpretation EXACTLY unchanged.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 8 — save and reload do not change the interpretation', () => {
  it('the whole model, byte for byte, and the revision with it', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    const first = (await load())!;

    // A second independent load: a fresh query, a fresh parse, a fresh composition.
    const second = (await load())!;
    expect(JSON.stringify(second.model), 'a reload changed the electrical interpretation')
      .toBe(JSON.stringify(first.model));
    expect(second.revision).toBe(first.revision);
  });

  it('🚨 and a REWRITE of the same graph is still the same revision', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    await persistRaysJob();
    await setModuleCount(72);
    const before = (await load())!;

    // Read it back and write it again — the round trip an edit-and-save performs.
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    await writeServiceTopology(PROJECT, USER_ID, t);

    const after = (await load())!;
    expect(after.revision,
      'a save of an unchanged graph marked every generated sheet stale').toBe(before.revision);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 9 — 4 PW3 → 2 PW3. Every production output must change.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 9 — four Powerwalls become two, everywhere at once', () => {
  /** Remove one Powerwall from each domain, through the real authoring + persistence. */
  async function dropToTwo(): Promise<void> {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    const drop = new Set(t.domains.map(d => d.storageUnitIds[d.storageUnitIds.length - 1]));
    await writeServiceTopology(PROJECT, USER_ID, {
      ...t,
      storage: t.storage.filter(s => !drop.has(s.id)),
      domains: t.domains.map(d => ({
        ...d, storageUnitIds: d.storageUnitIds.filter(id => !drop.has(id)),
      })),
      aggregationPanels: t.aggregationPanels.map(a => ({
        ...a, inputs: a.inputs.filter(i => !drop.has(String(i.sourceId))),
      })),
    });
  }

  it('the model, the revision, the BOM route, pricing and the inspector all move together', async () => {
    await persistRaysJob();
    await setModuleCount(72);

    const before = (await load())!;
    expect(before.model.storage.invertingUnitCount).toBe(4);
    const bomBefore = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', panelId: 'qcell-q6',
      moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });

    await dropToTwo();

    const after = (await load())!;
    // ── the canonical model
    expect(after.model.storage.invertingUnitCount, 'the model did not see the change').toBe(2);
    expect(after.model.storage.usableKwh).toBeCloseTo(27, 1);
    expect(after.model.storage.continuousOutputA).toBeCloseTo(96, 1);
    // ── the revision
    expect(after.revision, 'the revision did not move, so every sheet stays falsely CURRENT')
      .not.toBe(before.revision);
    // ── the gateways did NOT change: dropping a battery does not delete a domain
    expect(after.model.storage.gatewayCount).toBe(2);

    // ── the BOM route
    const bomAfter = await postBom({
      projectId: PROJECT, batteryId: 'tesla-powerwall-3', panelId: 'qcell-q6',
      moduleCount: 72, totalPanels: 72, systemType: 'roof',
    });
    const pwTotal = (r: typeof bomAfter) => productTotal(
      (r.json.bom as { items: Array<{ quantity: number; manufacturer?: string; model?: string }> }).items,
      /tesla/i, /powerwall\s*3$/i);
    expect(pwTotal(bomBefore)).toBe(4);
    expect(pwTotal(bomAfter), 'the BOM still orders four').toBe(2);
    expect((bomAfter.json.electrical as Record<string, unknown>).storageUnits).toBe(2);
    expect((bomAfter.json.electrical as Record<string, unknown>).quantityDisagreements).toEqual([]);

    // ── the inspector
    const insp = await getInspector();
    const rows = (insp.json.report as { rows: Array<Record<string, unknown>> }).rows;
    expect(String(rows.find(r => String(r.field).includes('Storage unit quantity'))!.value))
      .toContain('2 inverting');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 10 — DC-coupled Tesla → AC-coupled external inverter.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 10 — switching to an AC-coupled external inverter', () => {
  it('the DC projection disappears and the AC architecture appears, without a conflict', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    const before = (await load())!;
    expect(before.model.solarCoupling).toBe('dc-coupled-storage');
    expect(before.model.hasExternalInverter).toBe(false);

    // The designer records the change and selects the inverter — both halves, as a real change is.
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const A = await import('@/lib/electrical/topologyAuthoring');
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    await writeServiceTopology(PROJECT, USER_ID, A.setSolarCoupling(t, 'ac-coupled-inverter'));
    await setSelectedEquipment({ inverter: { id: 'enphase-iq8plus', type: 'micro' } });

    const after = (await load())!;
    expect(after.model.solarCoupling).toBe('ac-coupled-inverter');
    expect(after.model.hasExternalInverter).toBe(true);
    // 🚨 Changing the coupling is NOT a conflict — the stores now AGREE on AC coupling.
    expect(after.model.conflicts, 'a coherent AC-coupled change was reported as a conflict')
      .toEqual([]);
    expect(after.revision).not.toBe(before.revision);
    // The storage is unchanged: it is still four Powerwalls, now AC-coupled.
    expect(after.model.storage.invertingUnitCount).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 11 — generate, then change: the old artifact goes stale.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 11 — a generated artifact goes stale when the project moves', () => {
  it('stamped at A, project becomes B, freshness says STALE', async () => {
    const { electricalArtifactFreshness } = await import('@/lib/electrical/revision');
    await persistRaysJob();
    await setModuleCount(72);

    // "Generate" — whatever the drawing was, it carries this revision.
    const stampedAt = (await load())!.revision;
    expect(electricalArtifactFreshness(stampedAt, stampedAt)).toBe('CURRENT');

    // The project moves: the service rating is corrected.
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    await writeServiceTopology(PROJECT, USER_ID,
      { ...t, service: { ...t.service, ratedAmps: 320 } });

    const now = (await load())!.revision;
    expect(now).not.toBe(stampedAt);
    expect(electricalArtifactFreshness(stampedAt, now)).toBe('STALE');
    // 🚨 AND AN OLD UNSTAMPED SHEET IS NEVER REPORTED AS CURRENT.
    expect(electricalArtifactFreshness(null, now)).toBe('UNSTAMPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 12 — delete and recreate the topology; nothing duplicates.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 12 — deleting and rebuilding the topology duplicates nothing', () => {
  it('the equipment inventory is identical after a delete and a rebuild', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    const before = (await load())!;

    // Delete it the way the real delete path does.
    await db.query(`UPDATE projects SET service_topology = NULL WHERE id = $1`, [PROJECT]);
    const empty = (await load())!;
    expect(empty.model.topology, 'the graph survived a delete').toBeNull();
    expect(empty.model.storage.invertingUnitCount).toBe(0);

    // Rebuild it, same authoring calls.
    await persistRaysJob();
    const after = (await load())!;
    expect(after.model.storage.invertingUnitCount, 'the rebuild duplicated storage units').toBe(4);
    expect(after.model.storage.gatewayCount, 'the rebuild duplicated gateways').toBe(2);
    expect(after.model.storage.perSystemGenerationPanelCount,
      'the rebuild duplicated generation panels').toBe(2);
    expect(after.model.topology!.storage.length).toBe(4);
    expect(after.model.topology!.aggregationPanels.length).toBe(2);
    expect(after.model.topology!.domains.length).toBe(2);
    // The same job rebuilt is the same electrical state.
    expect(after.revision).toBe(before.revision);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION 14 — a stale legacy mirror cannot override the canonical model.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 MUTATION 14 — stale Enphase in a legacy store cannot beat canonical Tesla', () => {
  it('a stale engineering_config inverter array does not reach the model', async () => {
    await persistRaysJob();                       // canonical: DC-coupled, four Powerwalls
    await setModuleCount(72);
    // The legacy mirror: the Enphase design that was there before the hardware changed. Nothing
    // deletes it, so it is still sitting in the store.
    await db.query(`UPDATE projects SET engineering_config = $2 WHERE id = $1`, [PROJECT,
      JSON.stringify({
        inverters: Array.from({ length: 37 }, (_, i) => ({
          inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ panels: 1, id: `s${i}` }],
        })),
        subSystems: { roof: { inverterId: 'enphase-iq8plus' } },
      })]);

    const m = (await load())!.model;
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.hasExternalInverter, 'a legacy engineering_config array became an inverter selection')
      .toBe(false);
    expect(m.conflicts).toEqual([]);
    expect(JSON.stringify(m).toLowerCase()).not.toContain('enphase');
  });

  it('🚨 and the PERMIT ROUTE does not backfill it onto the package', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    await db.query(`UPDATE projects SET engineering_config = $2 WHERE id = $1`, [PROJECT,
      JSON.stringify({
        inverters: Array.from({ length: 37 }, (_, i) => ({
          inverterId: 'enphase-iq8plus', type: 'micro', strings: [{ panels: 1, id: `s${i}` }],
        })),
      })]);

    // The permit route's backfill reads `engineering_config.inverters` when the POSTed payload looks
    // like a placeholder — which is exactly this payload. The canonical coupling must stop it.
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
    try {
      await postPermit({
        projectId: PROJECT,
        project: { projectId: PROJECT, clientName: 'Ray', address: '1 Test St' },
        system: { totalPanels: 72, inverters: [] },
      });
    } finally { spy.mockRestore(); }

    const skipped = logs.find(l => l.includes('inverter backfill SKIPPED'));
    expect(skipped,
      'the permit route backfilled a legacy Enphase array onto a DC-coupled Tesla job').toBeTruthy();
    expect(skipped!).toContain('dc-coupled-storage');
    expect(logs.some(l => l.includes('Backfilled inverters from persisted design')),
      'the backfill ran anyway').toBe(false);
  });

  it('a stale selected_equipment.batteryCount raises a conflict instead of winning', async () => {
    await persistRaysJob();
    await setModuleCount(72);
    await setSelectedEquipment({ batteryId: 'tesla-powerwall-3', batteryCount: 2 });
    const m = (await load())!.model;
    // 🚨 The GRAPH answers four. The mirror's two becomes a question, not an answer.
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.provenance.source).toBe('service-topology');
    const c = m.conflicts.find(x => x.fact === 'How many storage units this project has');
    expect(c, 'a stale battery count passed silently').toBeTruthy();
    expect(c!.claims.find(x => x.source === 'selected-equipment')!.says).toContain('2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHAT THIS FILE DOES NOT PROVE, SAID OUT LOUD.
// ═══════════════════════════════════════════════════════════════════════════
describe('the mutations this file cannot reach', () => {
  it('names them rather than letting them look covered', () => {
    // Ray's rule cuts both ways: a test that looks like it covers a mutation and does not is worse
    // than an absent test, because it is believed. These three are proven elsewhere, by name:
    const elsewhere = {
      // Mutation 7 — switching Engineering tabs must not change the interpretation. That is a React
      // lifecycle fact, not a server fact: the defect was `ServiceTopologyBuilder` being mounted
      // inside `{activeTab === 'service' ? … : null}` while being the only writer of the page's
      // copy. Proven by a source guard against the real prior bytes plus the component tests.
      7: 'tests/electricalAuthorityLifecycle.test.ts',
      // Mutation 13's SLD half — the rendered sheet. Proven by the renderer suites, which compare
      // the drawn output rather than a route response.
      '13-sld': 'tests/professionalSldConsumesTheServiceGraph.test.ts',
      // The permit package's rendered schedule page. Proven by the permit schedule suite.
      '13-permit-schedule': 'tests/permitScheduleConsumesTheTopology.test.ts',
    };
    expect(Object.keys(elsewhere).length).toBe(3);
  });
});
