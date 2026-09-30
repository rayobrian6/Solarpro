// ═══════════════════════════════════════════════════════════════════════════
// 🚨 SAVE IT, RELOAD IT, AND IT IS STILL TWO OF EVERYTHING. AGAINST A REAL POSTGRES.
//
// Ray: "`ServiceTopology` currently exists but has no authority until the rest of SolarPro consumes
// and persists it... Reload must not collapse `2 MSP → 1 MSP` or `2 gateways → shared gateway` or
// `2 domains → one battery scalar`. Restore the old scalar persistence path and the test must go
// red."
//
// PGlite is PostgreSQL 16 compiled to WASM, running in-process with no credential. The `projects`
// DDL is the shipped DDL, extracted from the migrate route rather than retyped, and the real
// `writeServiceTopology` / `readServiceTopology` run against it — including the
// `ADD COLUMN IF NOT EXISTS` self-heal, which is exercised here for real rather than assumed.
//
// THE SCALAR PATH IS IN THIS FILE, ON PURPOSE. `saveTheOldScalarWay` is the model this slice
// retires — `mainPanelAmps` + `batteryCount`, which is what `projects.selected_equipment` still
// holds. It is written out so the collapse can be MEASURED instead of described, and so the
// difference between the two paths is a test rather than a claim.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

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

/** Ray's job, fully specified, so nothing is null for an accidental reason. */
async function rayJob() {
  const { buildTesla400ATwoGateway } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { topology } = buildTesla400ATwoGateway({
    availableFaultCurrentA: 10_000,
    gatewaySccrA: 10_000,
    calculatedServiceDemandA: 310,
    branchDemandA: [160, 150],
    storageConnection: 'gateway-panelboard',
  });
  return topology;
}

/**
 * The same job with the DER side built: an aggregation panel, a point of interconnection, and the
 * utility isolation device PLACED on the aggregated feeder.
 *
 * 🚨 THE PLACEMENT IS WHY THIS FIXTURE EXISTS. `ProtectiveDevice.feedsNodeId` is what tells the
 * traversal that the disconnect sits on the DER feeder rather than on the service conductors, and a
 * parse that dropped it reloaded the device onto the default chain — which moves DER ISOLATION
 * COVERAGE from FAIL to PASS across a save. A safety check that gets safer by being saved is the
 * worst direction for one to move, and no fixture exercised the field until this one.
 */
async function rayJobAggregated() {
  const { applyDerArrangement } = await import('@/lib/electrical/topologyPresets');
  const { updatePointOfInterconnection } = await import('@/lib/electrical/topologyAuthoring');
  const built = applyDerArrangement(await rayJob(), 'common-aggregation').topology;
  return updatePointOfInterconnection(built, 'poi-1', {
    relationship: 'aggregation-to-supply-side', connectedToNodeId: 'svc-disco',
  });
}

describe('🚨 the DER side survives the save too', () => {
  it('the aggregation panel, its inputs, the POI and the device PLACEMENT all come back', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const before = await rayJobAggregated();
    expect(await writeServiceTopology(PROJECT, USER_ID, before)).toBe(true);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;

    expect(after.interconnection.derArrangement).toBe('common-aggregation');
    expect(after.aggregationPanels).toHaveLength(1);
    const agg = after.aggregationPanels[0];
    expect(agg.busbarRatingA).toBe(125);
    expect(agg.outputOcpdA).toBe(125);
    expect(agg.mainLugOnly).toBe(true);
    expect(agg.carriesPremisesLoad).toBe(false);
    expect(agg.inputs).toHaveLength(2);
    expect(agg.inputs.every(i => i.tap === 'der-output')).toBe(true);

    expect(after.pointsOfInterconnection).toHaveLength(1);
    expect(after.pointsOfInterconnection[0].relationship).toBe('aggregation-to-supply-side');
    expect(after.pointsOfInterconnection[0].connectedToNodeId).toBe('svc-disco');

    // 🚨 THE PLACEMENT.
    const iso = after.devices.find(d => d.roles.includes('der-isolation-disconnect'))!;
    expect(iso.feedsNodeId, 'the device reloaded onto the default service chain')
      .toBe('poi-1');
    expect(agg.feedsNodeId).toBe(iso.id);
    expect(after.domains.every(d => d.storageConnection === 'der-aggregation-panel')).toBe(true);
  });

  it('🚨 and the isolation-coverage VERDICT is the same after the reload', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const { derIsolationCoverage } = await import('@/lib/electrical/serviceTopology');
    const before = await rayJobAggregated();
    await writeServiceTopology(PROJECT, USER_ID, before);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    expect(derIsolationCoverage(before).conclusion).toBe('PASS');
    expect(derIsolationCoverage(after).conclusion).toBe('PASS');

    // And the same holds for a topology that FAILS it: a save must not launder a failure either.
    const { updateAggregationPanel } = await import('@/lib/electrical/topologyAuthoring');
    const bypassed = updateAggregationPanel(before, 'agg-1', { feedsNodeId: 'poi-1' });
    await writeServiceTopology(PROJECT, USER_ID, bypassed);
    const reloaded = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    expect(derIsolationCoverage(bypassed).conclusion).toBe('FAIL');
    expect(derIsolationCoverage(reloaded).conclusion).toBe('FAIL');
  });
});

describe('🚨 the arrangement Ray intends to install survives the save', () => {
  it('two per-path switches come back IN their paths, and coverage does not change', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { derIsolationCoverage } = await import('@/lib/electrical/serviceTopology');
    const before = buildRaysIntendedJob({ availableFaultCurrentA: 10_000, gatewaySccrA: 10_000 })
      .topology;

    expect(await writeServiceTopology(PROJECT, USER_ID, before)).toBe(true);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;

    const iso = after.devices.filter(d => d.roles.includes('der-isolation-disconnect'));
    expect(iso).toHaveLength(2);
    expect(iso.map(d => d.ratedAmps)).toEqual([200, 200]);
    // 🚨 THE LOAD SIDE. Without it each switch reloads BESIDE its conductor instead of IN it, and
    // both Powerwalls keep an untouched path to the utility across the save — a coverage FAIL
    // laundered into a PASS by nothing more than reopening the project.
    expect(iso.every(d => !!d.inlineOnNodeId),
      'a per-path switch reloaded with no load side').toBe(true);
    expect(new Set(iso.map(d => d.inlineOnNodeId)).size).toBe(2);
    expect(derIsolationCoverage(after).conclusion)
      .toBe(derIsolationCoverage(before).conclusion);
  });

  it('the existing assembly reloads UNVERIFIED, and the optional load stays absent', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveDemands } = await import('@/lib/electrical/serviceTopology');
    const before = buildRaysIntendedJob({
      existingServiceEquipment: { manufacturer: 'Eaton', catalogNumber: 'CH42B400' },
    }).topology;
    await writeServiceTopology(PROJECT, USER_ID, before);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;

    expect(after.service.existingEquipment?.manufacturer).toBe('Eaton');
    expect(after.service.existingEquipment?.catalogNumber).toBe('CH42B400');
    // 🚨 NOT VERIFIED, because nobody verified it. Reloading a half-read assembly as verified is
    // how "CONFIGURATION TO VERIFY" disappears without anybody going to site.
    expect(after.service.existingEquipment?.verified).toBe(false);
    expect(after.service.existingEquipment?.sccrA ?? null).toBeNull();
    // And an absent optional calculation is still absent — not defaulted into existence.
    expect(after.loads ?? null).toBeNull();
    expect(resolveDemands(after).source).toBe('none');
  });
});

describe('🚨 the service graph survives a save and a reload', () => {
  it('round-trips through a real PostgreSQL column with every part intact', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const before = await rayJob();

    expect(await writeServiceTopology(PROJECT, USER_ID, before), 'the write did not land').toBe(true);
    const stored = await readServiceTopology(PROJECT, USER_ID);
    expect(stored, 'nothing came back').toBeTruthy();
    const after = stored!.topology;

    // ── 1. the aggregate service ──────────────────────────────────────────
    expect(after.service.ratedAmps).toBe(400);
    expect(after.service.voltage).toBe(240);
    expect(after.service.phase).toBe('split-240');
    expect(after.service.availableFaultCurrentA).toBe(10_000);
    expect(after.calculatedServiceDemandA).toBe(310);

    // ── 2. TWO branches, with their own identities and their own loads ────
    expect(after.branches.map(b => b.id)).toEqual(['branch-a', 'branch-b']);
    expect(after.branches.map(b => b.ratedAmps)).toEqual([200, 200]);
    expect(after.branches.map(b => b.calculatedDemandA)).toEqual([160, 150]);

    // ── 3. TWO MSPs — the collapse Ray named first ────────────────────────
    expect(after.panels.map(p => p.id), '2 MSP became 1 MSP').toEqual(['msp-1', 'msp-2']);
    expect(after.panels.every(p => p.busbarRatingA === 200 && p.mainBreakerA === 200)).toBe(true);

    // ── 4. TWO domains, each owning its own gateway and its own panel ─────
    expect(after.domains.map(d => d.id)).toEqual(['domain-a', 'domain-b']);
    expect(after.domains.map(d => d.branchId)).toEqual(['branch-a', 'branch-b']);
    expect(after.domains.map(d => d.backedUpPanelIds)).toEqual([['msp-1'], ['msp-2']]);
    const gwIds = after.domains.map(d => d.gateway.id);
    expect(new Set(gwIds).size, '2 gateways became a shared gateway').toBe(2);
    expect(after.domains.every(d => d.gateway.productId === 'tesla-backup-gateway-3')).toBe(true);
    expect(after.domains.every(d => d.gateway.continuousRatingA === 200)).toBe(true);
    expect(after.domains.every(d => d.gateway.sccrA === 10_000)).toBe(true);

    // ── 5. FOUR storage units, and the PW↔Expansion pairing ──────────────
    expect(after.storage, '2 domains became one battery scalar').toHaveLength(4);
    const byId = new Map(after.storage.map(u => [u.id, u]));
    const expansions = after.storage.filter(u => u.role === 'energy-expansion');
    expect(expansions).toHaveLength(2);
    for (const e of expansions) {
      expect(e.attachedToUnitId, `${e.id} lost its host`).toBeTruthy();
      expect(byId.get(e.attachedToUnitId!)!.role).toBe('inverter-unit');
      expect(e.continuousOutputA, 'an Expansion came back with AC current').toBe(0);
    }
    expect(new Set(expansions.map(e => e.attachedToUnitId)).size,
      'both Expansions came back on the same host').toBe(2);

    // ── 6. the four disconnect ROLES ─────────────────────────────────────
    const roles = after.devices.map(d => d.roles);
    expect(roles).toEqual([['service-disconnect'], ['der-isolation-disconnect']]);
    const isolation = after.devices.find(d => d.roles.includes('der-isolation-disconnect'))!;
    expect(isolation.lockableOpen).toBe(true);
    expect(isolation.visibleOpen).toBe(true);

    // ── 7. the interconnection constraint, and the UNRESOLVED authority ──
    expect(after.interconnection.meterCollarPermitted).toBe(false);
    expect(after.interconnection.externalDerIsolationRequired).toBe(true);
    expect(after.interconnection.multiGatewayMeteringDoc, 'the manufacturer-document state was lost')
      .toBeTruthy();
    expect(after.interconnection.multiGatewayMeteringDoc!.present,
      'a reload quietly decided Tesla had told us after all').toBe(false);

    // ── 8. where the storage lands, which decides whether 705.12(B) applies
    expect(after.domains.every(d => d.storageConnection === 'gateway-panelboard')).toBe(true);
  });

  it('🚨 and the ENGINEERING of the reloaded graph is identical to the original', async () => {
    // The point of a round trip is not that the JSON matches — it is that the conclusions do.
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const before = await rayJob();
    await writeServiceTopology(PROJECT, USER_ID, before);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;

    const a = evaluateServiceTopology(before);
    const b = evaluateServiceTopology(after);
    expect(b.overall).toBe(a.overall);
    expect(b.storageSummary).toEqual(a.storageSummary);
    expect(b.bonding).toEqual(a.bonding);
    expect(b.checks.map(c => `${c.scope}/${c.id}=${c.conclusion}`))
      .toEqual(a.checks.map(c => `${c.scope}/${c.id}=${c.conclusion}`));
  });

  it('a second save overwrites rather than accumulating', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = await rayJob();
    await writeServiceTopology(PROJECT, USER_ID, t);
    t.service.ratedAmps = 600;
    t.branches.push({ id: 'branch-c', label: 'Branch C', ratedAmps: 200, ocpdAmps: 200, calculatedDemandA: 100 });
    await writeServiceTopology(PROJECT, USER_ID, t);
    const after = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    expect(after.service.ratedAmps).toBe(600);
    expect(after.branches).toHaveLength(3);
  });

  it('another user cannot read or write this project’s topology', async () => {
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    await writeServiceTopology(PROJECT, USER_ID, await rayJob());
    expect(await readServiceTopology(PROJECT, OTHER_USER)).toBeNull();
    expect(await writeServiceTopology(PROJECT, OTHER_USER, await rayJob())).toBe(false);
  });

  it('a project with no topology reads as null, not as an empty graph', async () => {
    const { readServiceTopology } = await import('@/lib/db/serviceTopology');
    expect(await readServiceTopology(PROJECT, USER_ID)).toBeNull();
  });

  it('a corrupt stored value is refused rather than half-parsed', async () => {
    const { readServiceTopology } = await import('@/lib/db/serviceTopology');
    await db.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`);
    for (const bad of ['{}', '{"topology":{}}', '{"topology":{"service":{}}}', '[]', '"nope"']) {
      await db.query(`UPDATE projects SET service_topology = $1::jsonb WHERE id = $2`, [bad, PROJECT]);
      expect(await readServiceTopology(PROJECT, USER_ID), `'${bad}' was accepted`).toBeNull();
    }
  });
});

describe('🚨 THE OLD SCALAR PATH, RESTORED — and what it destroys', () => {
  /**
   * The model this slice retires, written out so the loss is measurable.
   *
   * `projects.selected_equipment` holds `batteryCount` — ONE number for the site — and
   * `ElectricalEngineering` holds `mainPanelAmps` / `mainPanelBusAmps` / `mainBreakerAmps`. This is
   * the most faithful projection of Ray's job those fields can carry.
   */
  function saveTheOldScalarWay(t: Awaited<ReturnType<typeof rayJob>>) {
    const primaryPanel = t.panels[0];
    return {
      mainPanelAmps: primaryPanel?.busbarRatingA ?? null,
      mainPanelBusAmps: primaryPanel?.busbarRatingA ?? null,
      mainBreakerAmps: primaryPanel?.mainBreakerA ?? null,
      batteryId: t.storage[0]?.productId ?? null,
      batteryCount: t.storage.length,
      gatewayCount: t.domains.length,
    };
  }

  it('🚨 collapses 2 MSPs to one number, and cannot say which', async () => {
    const t = await rayJob();
    const scalar = saveTheOldScalarWay(t);
    expect(t.panels).toHaveLength(2);
    // Both are 200 A, so the number even LOOKS right — which is why this was survivable for years.
    expect(scalar.mainPanelAmps).toBe(200);
    // And there is nowhere for the second one to be.
    expect(Object.keys(scalar)).not.toContain('panels');
    expect(JSON.stringify(scalar)).not.toContain('msp-2');
  });

  it('🚨 turns 2 Powerwalls + 2 Expansions into "4 batteries" — the doubled-backfeed bug', async () => {
    const { resolveBatteryBranch } = await import('@/lib/equipment-db');
    const t = await rayJob();
    const scalar = saveTheOldScalarWay(t);
    expect(scalar.batteryCount).toBe(4);

    // Reloaded the old way, the site is four Powerwalls: the Expansions have become inverters.
    const asScalar = resolveBatteryBranch(scalar.batteryId!, scalar.batteryCount);
    const { summariseStorage } = await import('@/lib/electrical/serviceTopology');
    const graph = summariseStorage(t);
    expect(graph.inverterUnitCount, 'the graph knows there are two inverting units').toBe(2);
    expect(graph.totalContinuousOutputA).toBeCloseTo(96, 6);
    expect(graph.totalUsableKwh).toBeCloseTo(54, 6);
    // The scalar path has one count and one product id. There is no field in which "two of these
    // four units do not invert" could be written.
    expect(asScalar.unitCount).toBe(4);
    expect(asScalar.aggregateUsableKwh, 'four Powerwalls of energy, not two plus two expansions')
      .toBeCloseTo(54, 6);
  });

  it('🚨 loses the pairing, the roles, the bonding point and the missing manufacturer document',
    async () => {
      const t = await rayJob();
      const json = JSON.stringify(saveTheOldScalarWay(t));
      for (const lost of [
        'domain-a', 'domain-b',             // domain ownership
        'attachedToUnitId',                 // PW ↔ Expansion pairing
        'der-isolation-disconnect',         // the four semantic roles
        'service-disconnect',               // and therefore the bonding point
        'multiGatewayMeteringDoc',          // the unresolved manufacturer authority
        'gateway-panelboard',               // where the storage actually lands
      ]) {
        expect(json, `the scalar path somehow kept '${lost}'`).not.toContain(lost);
      }
    });

  it('🚨 and a gateway COUNT is not a gateway ASSIGNMENT', async () => {
    const t = await rayJob();
    const scalar = saveTheOldScalarWay(t);
    // Two gateways is the easy half. WHICH branch each one is on, and which panel it backs up, is
    // the half that decides whether the engineering is right — and a count cannot hold it.
    expect(scalar.gatewayCount).toBe(2);
    expect(t.domains.map(d => `${d.gateway.id}->${d.branchId}->${d.backedUpPanelIds.join()}`))
      .toEqual(['domain-a-gateway->branch-a->msp-1', 'domain-b-gateway->branch-b->msp-2']);
    expect(JSON.stringify(scalar)).not.toContain('branch-a');
  });
});
