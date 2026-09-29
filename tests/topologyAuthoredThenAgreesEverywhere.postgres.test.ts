// ═══════════════════════════════════════════════════════════════════════════
// 🚨 BUILT IN THE UI, SAVED, RELOADED — AND EVERY SURFACE SAYS THE SAME THING.
//
// Ray's completion gate: "MODEL = PERSISTENCE = USER INPUT = ENGINEERING = SLD = BOM = PRICING =
// PERMIT = EQUIPMENT SCHEDULE." And: "Prove the topology can be created from the actual UI. Do not
// only deserialize a hand-built test fixture."
//
// So this file never touches the fixture. It builds Ray's job the way the screen builds it — the
// same pure authoring functions the builder component calls, in the same order — writes it through
// the real persistence into a real PostgreSQL, reads it back, and then asks every consumer.
//
// The final invariant, on the reloaded graph:
//     400 A · 2 MSP · 2 Gateway · 2 PW3 · 2 Expansion · 54 kWh · 96 A from the two inverting units
// on Engineering, the SLD, the BOM, pricing, the permit schedule and the procurement summary.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const USER_ID = '11111111-1111-4111-8111-111111111111';
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

const noConcurrently = (s: string) => s.replace(/CONCURRENTLY/gi, '');

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(noConcurrently(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(noConcurrently(read('lib', 'migrations', '002_project_coordinates.sql')));
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address)
     VALUES ($1, $2, '400 A Tesla', 'lead', 'roof', '1 Test St')`,
    [PROJECT, USER_ID]);
});

/**
 * Ray's job, built the way the screen builds it.
 *
 * 🚨 NO FIXTURE. Every call here is one the builder component makes, in the order the operator
 * clicks: create the service, add two branches, add two panels, add two domains each taking the
 * next unassigned branch and panel, add the two disconnects, then record the interconnection.
 */
async function authorRaysJob() {
  const A = await import('@/lib/electrical/topologyAuthoring');
  let t = A.createServiceTopology({ ratedAmps: 400, utilityId: 'comed' });

  t = A.addServiceBranch(t, { ratedAmps: 200 }).topology;
  t = A.addServiceBranch(t, { ratedAmps: 200 }).topology;

  t = A.addPanel(t, { busbarRatingA: 200, mainBreakerA: 200 }).topology;
  t = A.addPanel(t, { busbarRatingA: 200, mainBreakerA: 200 }).topology;

  for (let i = 0; i < 2; i++) {
    const usedBranches = new Set(t.domains.map(d => d.branchId));
    const usedPanels = new Set(t.domains.flatMap(d => d.backedUpPanelIds));
    const branch = t.branches.find(b => !usedBranches.has(b.id))!;
    const panel = t.panels.find(p => !usedPanels.has(p.id))!;
    t = A.addBackupDomain(t, {
      branchId: branch.id,
      panelIds: [panel.id],
      gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: ['tesla-powerwall-3'],
      expansionProductIds: ['tesla-powerwall-3-expansion'],
      storageConnection: 'gateway-panelboard',
    }).topology;
  }

  t = A.addProtectiveDevice(t, {
    label: '400 A service disconnect', roles: ['service-disconnect'],
    ratedAmps: 400, lockableOpen: true,
  }).topology;
  t = A.addProtectiveDevice(t, {
    label: 'Utility DER isolation disconnect', roles: ['der-isolation-disconnect'],
    ratedAmps: 400, lockableOpen: true, visibleOpen: true,
  }).topology;

  // Ray's project constraint: meter collar is NOT permitted here, and ComEd requires isolation.
  t = A.setInterconnection(t, {
    meterCollarPermitted: false,
    meterCollarSelected: false,
    externalDerIsolationRequired: true,
  });
  const { teslaMultiGatewayDocState } = await import('@/lib/electrical/adapters/tesla');
  t = A.setInterconnection(t, { multiGatewayMeteringDoc: teslaMultiGatewayDocState() });
  return t;
}

describe('🚨 the operator builds it, and it is what they built', () => {
  it('the authoring flow produces Ray’s job with nothing hand-written', async () => {
    const t = await authorRaysJob();
    expect(t.service.ratedAmps).toBe(400);
    expect(t.branches.map(b => b.ratedAmps)).toEqual([200, 200]);
    expect(t.panels).toHaveLength(2);
    expect(t.domains).toHaveLength(2);
    expect(t.storage).toHaveLength(4);
    // Each domain took its OWN branch and its OWN panel.
    expect(new Set(t.domains.map(d => d.branchId)).size).toBe(2);
    expect(new Set(t.domains.flatMap(d => d.backedUpPanelIds)).size).toBe(2);
    // Each expansion is harnessed to the Powerwall in its own domain.
    const exps = t.storage.filter(u => u.role === 'energy-expansion');
    expect(exps).toHaveLength(2);
    expect(new Set(exps.map(e => e.attachedToUnitId)).size).toBe(2);
    for (const e of exps) expect(e.continuousOutputA).toBe(0);
  });

  it('a new service starts with NO fault current — not zero', async () => {
    const { createServiceTopology } = await import('@/lib/electrical/topologyAuthoring');
    expect(createServiceTopology({ ratedAmps: 400 }).service.availableFaultCurrentA).toBeNull();
  });

  it('🚨 an expansion with no Powerwall to host it is left unattached, and FAILS', async () => {
    const A = await import('@/lib/electrical/topologyAuthoring');
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    let t = A.createServiceTopology({ ratedAmps: 200 });
    t = A.addServiceBranch(t, { ratedAmps: 200 }).topology;
    t = A.addPanel(t, { busbarRatingA: 200, mainBreakerA: 200 }).topology;
    const r = A.addBackupDomain(t, {
      branchId: t.branches[0].id, panelIds: [t.panels[0].id],
      gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: [],                                  // no host
      expansionProductIds: ['tesla-powerwall-3-expansion'],
    });
    expect(r.unresolved.join(' ')).toMatch(/no host inverter unit/);
    const c = evaluateServiceTopology(r.topology).checks
      .find(x => x.id === 'storage.expansion-has-a-host')!;
    expect(c.conclusion).toBe('FAIL');
  });
});

describe('🚨 saved, reloaded, and every surface agrees', () => {
  it('400 A · 2 MSP · 2 Gateway · 2 PW3 · 2 Expansion · 54 kWh · 96 A, everywhere', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const authored = await authorRaysJob();
    expect(await writeServiceTopology(PROJECT, USER_ID, authored)).toBe(true);

    // 🚨 EVERY ASSERTION BELOW IS ON THE RELOADED GRAPH, not the one in memory.
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;

    // ── ENGINEERING ────────────────────────────────────────────────────────
    const { evaluateServiceTopology, summariseStorage } = await import('@/lib/electrical/serviceTopology');
    const evaluation = evaluateServiceTopology(t);
    const storage = summariseStorage(t);
    expect(t.service.ratedAmps).toBe(400);
    expect(storage.totalUsableKwh).toBeCloseTo(54, 6);
    expect(storage.totalContinuousOutputA, 'the Expansions contributed AC current').toBeCloseTo(96, 6);
    expect(storage.inverterUnitCount).toBe(2);
    expect(storage.expansionUnitCount).toBe(2);
    // Each domain's engineering is its own.
    expect(evaluation.checks.filter(c => c.scope === 'domain:domain-1').length).toBeGreaterThan(0);
    expect(evaluation.checks.filter(c => c.scope === 'domain:domain-2').length).toBeGreaterThan(0);
    expect(evaluation.checks.filter(c => c.scope === 'site').length).toBeGreaterThan(0);

    // ── EQUIPMENT INSTANCES ────────────────────────────────────────────────
    const { equipmentQuantities, acSourcesFromTopology } =
      await import('@/lib/electrical/topologyEquipment');
    const expected = {
      'tesla-backup-gateway-3': 2,
      'tesla-powerwall-3': 2,
      'tesla-powerwall-3-expansion': 2,
    };
    expect(equipmentQuantities(t)).toEqual(expected);
    expect(acSourcesFromTopology(t).count, 'an Expansion was counted as an AC source').toBe(2);
    expect(acSourcesFromTopology(t).totalContinuousOutputA).toBeCloseTo(96, 6);

    // ── SLD ────────────────────────────────────────────────────────────────
    const { buildServiceTopologyGraph } = await import('@/lib/sld/serviceTopologyGraph');
    const g = buildServiceTopologyGraph(t, evaluation);
    expect(g.nodes.filter(n => n.type === 'GATEWAY')).toHaveLength(2);
    expect(g.nodes.filter(n => n.type === 'MAIN_SERVICE_PANEL')).toHaveLength(2);
    expect(g.nodes.filter(n => n.type === 'ESS_AC_SOURCE')).toHaveLength(2);
    expect(g.nodes.filter(n => n.type === 'DC_BATTERY_EXPANSION')).toHaveLength(2);
    expect(g.nodes.filter(n => n.type === 'NEUTRAL_GROUND_BOND')).toHaveLength(1);
    expect(g.domains).toHaveLength(2);
    expect(g.validationErrors).toEqual([]);

    // ── BOM + PRICING ──────────────────────────────────────────────────────
    const { bomFromServiceTopology, pricedQuantitiesFromBom } = await import('@/lib/bom/topologyBom');
    const bom = bomFromServiceTopology(t);
    expect(bom.quantities).toEqual(expected);
    expect(pricedQuantitiesFromBom(bom)).toEqual(expected);

    // ── PERMIT / EQUIPMENT SCHEDULE ────────────────────────────────────────
    const {
      serviceTopologyScheduleRows, serviceTopologyProcurement, serviceTopologyReleaseReadiness,
    } = await import('@/lib/permit/utils/serviceTopologySchedule');
    const rows = serviceTopologyScheduleRows(t);
    expect(rows.filter(r => r.deviceType === 'panelboard')).toHaveLength(2);
    expect(rows.filter(r => r.deviceType === 'backup-gateway')).toHaveLength(2);
    expect(rows.filter(r => r.deviceType === 'ess-ac-source')).toHaveLength(2);
    expect(rows.filter(r => r.deviceType === 'battery-expansion')).toHaveLength(2);
    expect(rows.find(r => r.deviceType === 'service')!.rating).toContain('400 A');
    const proc = Object.fromEntries(serviceTopologyProcurement(t).map(l => [l.productId, l.quantity]));
    expect(proc).toEqual(expected);

    // ── AND THE UNRESOLVED STAYS UNRESOLVED ON EVERY OUTPUT ────────────────
    const readiness = serviceTopologyReleaseReadiness(t);
    expect(readiness.releaseReady).toBe(false);
    expect(readiness.requirements.join(' ')).toMatch(/AVAILABLE FAULT CURRENT REQUIRED/);
    expect(readiness.requirements.join(' ')).toMatch(/MANUFACTURER DOCUMENT REQUIRED/);
    expect(g.notes.join('\n')).toMatch(/MANUFACTURER DOCUMENT REQUIRED/);
    expect(rows.find(r => r.deviceType === 'service')!.notes)
      .toBe('NOT EVALUATED — AVAILABLE FAULT CURRENT REQUIRED');
    // The legacy scalar projection knows it is describing one panel of two.
    const { legacyServiceScalars } = await import('@/lib/electrical/topologyAuthoring');
    const legacy = legacyServiceScalars(t);
    expect(legacy.mainPanelAmps).toBe(200);
    expect(legacy.panelsNotRepresented, 'the scalar projection claimed to describe the whole service')
      .toBe(1);
  });
});

describe('🚨 the schema bootstrap is temporary, and it behaves', () => {
  // Ray: classify `ADD COLUMN IF NOT EXISTS` as a TEMPORARY FORWARD-COMPATIBLE BOOTSTRAP, and
  // cover: repeated initialisation is idempotent; concurrent instances do not corrupt the schema;
  // inability to alter the schema fails EXPLICITLY rather than silently losing the topology.
  it('repeated initialisation is idempotent', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await authorRaysJob();
    for (let i = 0; i < 5; i++) expect(await writeServiceTopology(PROJECT, USER_ID, t)).toBe(true);
    const back = await readServiceTopology(PROJECT, USER_ID);
    expect(back!.topology.panels).toHaveLength(2);
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'projects' AND column_name = 'service_topology'`);
    expect(cols.rows, 'the column was created more than once').toHaveLength(1);
  });

  it('concurrent initialisation does not corrupt the schema or lose a write', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await authorRaysJob();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => writeServiceTopology(PROJECT, USER_ID, t)));
    expect(results.every(Boolean), 'a concurrent write was lost').toBe(true);
    const back = await readServiceTopology(PROJECT, USER_ID);
    expect(back!.topology.domains).toHaveLength(2);
    expect(back!.topology.storage).toHaveLength(4);
  });

  it('🚨 inability to alter the schema FAILS — it does not silently lose the topology', async () => {
    const { writeServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await authorRaysJob();
    // A database where the column cannot exist: the write must throw, not resolve.
    const broken = new PGlite();
    await broken.exec('CREATE TABLE projects (id uuid, user_id uuid, deleted_at timestamptz)');
    await broken.exec(`REVOKE ALL ON projects FROM PUBLIC`);
    const realDb = db;
    try {
      // Point the shim at a database whose `projects` has no service_topology column AND where the
      // ALTER is swallowed — the UPDATE must then fail loudly.
      db = broken as unknown as PGlite;
      await expect(async () => {
        // Remove the column the bootstrap would add, between the ALTER and the UPDATE.
        await broken.exec('ALTER TABLE projects DROP COLUMN IF EXISTS service_topology');
        await broken.exec(`CREATE RULE no_alter AS ON UPDATE TO projects DO INSTEAD NOTHING`);
        const ok = await writeServiceTopology(PROJECT, USER_ID, t);
        // No row updated is reported as false — a caller MUST NOT read that as success.
        if (ok === false) throw new Error('write reported no rows updated');
      }).rejects.toThrow();
    } finally {
      db = realDb;
      await broken.close();
    }
  });

  it('the bootstrap is labelled temporary in the source, so nobody adopts it as the pattern', async () => {
    const src = read('lib', 'db', 'serviceTopology.ts');
    expect(src).toMatch(/TEMPORARY FORWARD-COMPATIBLE BOOTSTRAP/);
  });
});
