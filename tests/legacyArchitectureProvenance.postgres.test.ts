// ═══════════════════════════════════════════════════════════════════════════
// 🚨 RAY'S SECOND LIVE ACCEPTANCE FAILURE — the exact persisted project, through the real routes.
//
// The first repair was green on every surface and his live project still showed:
//
//     System Config            topology = String, Tesla Solar Inverter 5.7 kW × 2, 11.40 kW AC
//     Engineering Intelligence STRING INVERTER · 2 inverters · 37 modules · 16.28 kW DC
//     Service Topology         400 A, 2 × 200 A branches, 2 × Gateway 3, 4 × PW3, NO generation panels
//     Generated SLD            STRING INVERTER title block, a drawn standalone Tesla Solar Inverter,
//                              an inverter → AC disconnect chain, four PW3 beside it
//
// Ray: "Therefore persisted equipment existence alone does not prove installer intent. … Do not
// simply say: persisted inverter = intentional inverter, because this live project proves that
// statement false."
//
// 🚨 WHAT THE DIAGNOSIS TURNED OUT TO BE, and it is NOT what the first repair assumed.
//
// The canonical model was already RIGHT. For this row it returns `solarCoupling: null` with a
// `SOLAR_COUPLING_UNRESOLVED` conflict — it refuses to pick a side, exactly as designed. Two things
// then threw that away:
//
//   1. THE BADGE'S TERNARY. `null` fell through every arm to the last one, which is
//      `'STRING INVERTER'`. A refusal to answer was rendered as one of the two answers.
//   2. THE ROUTES NEVER ASKED. `body.topologyType` still said `'STRING'` from the page's React
//      state, so the SLD drew the losing side of a conflict as fact — and the BOM would have quoted
//      it, and the permit would have sealed it.
//
// So "prove which before changing code" (Ray) answers: the canonicalizer was sound, the PROJECTIONS
// were not. This file holds both halves plus the provenance layer that lets the conflict be settled
// once, by one click, instead of by Ray reconstructing the project by hand.
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

/**
 * 🚨 THE REAL PRODUCT ID, and getting it wrong would have cleared the project.
 *
 * `EcosystemPicker` auto-selected `kit.stringInverters[0]` — which for the Tesla ecosystem is
 * `tesla-solar-inverter-3p8k`. `lib/system/sizingEngine.ts` then found one unit insufficient for 37
 * modules and UPSIZED "to a bigger model in the same brand", landing on 5.7 kW × 2 — which is what
 * Ray's screen shows and what the row holds. A classifier that compared the stored id against the
 * auto-pick's id would therefore have found no match and declared the inverter deliberate.
 */
const RAYS_INVERTER = 'tesla-solar-inverter-5p7k';
const AUTO_PICK = 'tesla-solar-inverter-3p8k';

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
// 🚨 `lib/db/projects.ts` TAKES ITS CONNECTION FROM `./core`, NOT FROM `@/lib/db-neon`.
//
// The resolution route writes through `upsertSelectedEquipment`, which is the same merge-patch writer
// every other equipment decision uses — so the route is right and the HARNESS was short a boundary.
// Without this the route returned 500 ("DATABASE_URL is not set") and a test asserting a refusal
// would still have gone green on the status code for the wrong reason.
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
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`);
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
    import('@/app/api/engineering/calculate/route'),
    import('@/app/api/engineering/electrical-architecture/route'),
  ]);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address)
     VALUES ($1, $2, 'Hussey Ethos', 'lead', 'roof', '238 N Warwick Ave')`, [PROJECT, USER_ID]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,$3)`,
    [PROJECT, USER_ID, 37]);
});

/**
 * 🚨 WRITE RAY'S LIVE ROW. Not a simplification of it.
 *
 * Legacy in every way his is: no `solarCoupling` (the field postdates the project), no
 * `pvInputLimits` on the storage (likewise), the stale `ocpdA: 50`, NO generation panels, and —
 * the point of this file — `selected_equipment` holding an inverter with NO provenance block.
 */
async function writeRaysLiveRow(opts?: {
  generationPanels?: boolean;
  inverterId?: string | null;
  provenance?: Record<string, unknown> | null;
  pvCapableStorage?: boolean;
}): Promise<void> {
  const o = {
    generationPanels: false, inverterId: RAYS_INVERTER, provenance: null,
    pvCapableStorage: true, ...(opts ?? {}),
  };
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology))) as
    { schemaVersion: number; topology: Record<string, any> };

  delete stored.topology.solarCoupling;
  stored.schemaVersion = 3;
  for (const u of stored.topology.storage ?? []) {
    delete u.pvInputLimits; delete u.pvDcStcKw; delete u.outputConfigKw;
    if (u.role === 'inverter-unit') u.ocpdA = 50;
    // For the blast-radius case: storage whose product publishes no PV input at all.
    if (!o.pvCapableStorage) u.productId = 'enphase-iq-battery-5p';
  }
  if (!o.generationPanels) stored.topology.aggregationPanels = [];

  const se: Record<string, unknown> = { batteryCount: 4 };
  if (o.inverterId) {
    se.inverter = { id: o.inverterId, type: 'string', manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW' };
    se.inverterId = o.inverterId;
  }
  if (o.provenance) se.provenance = o.provenance;

  await db.query(`UPDATE projects SET service_topology = $2, selected_equipment = $3 WHERE id = $1`,
    [PROJECT, JSON.stringify(stored), JSON.stringify(se)]);
}

const load = async () => {
  const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
  return loadElectricalProject(PROJECT, USER_ID);
};

/** Drive the REAL route the Generate SLD button drives, posting the WRONG architecture as the page did. */
async function generateSld(): Promise<{ status: number; svg: string; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT,
      projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave',
      drawingDate: '2026-07-29', drawingNumber: 'SLD-001', revision: 'A',
      // 🚨 EXACTLY WHAT RAY'S PAGE POSTED.
      topologyType: 'STRING',
      inverterModel: 'Tesla Solar Inverter 5.7kW', inverterManufacturer: 'Tesla',
      inverterId: RAYS_INVERTER,
      totalModules: 37, totalStrings: 4,
      panelModel: 'Philadelphia Solar PS-MNB108(HCBF)-440W',
      panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20,
      acOutputKw: 11.4, acOutputAmps: 24, acOCPD: 60,
      acWireGauge: '#6 AWG', acConduitType: 'EMT', acWireLength: 60,
      backfeedAmps: 60, mainPanelAmps: 400,
      utilityName: 'Local Utility', interconnection: 'SUPPLY_SIDE_TAP',
      hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
    }),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} };
  }
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
}

async function postBom(): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT, totalPanels: 37, batteryCount: 4, inverters: [] }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function postPermit(): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/permit/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/permit', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT,
      project: { projectId: PROJECT, clientName: 'Ray', address: '238 N Warwick Ave' },
      system: { totalPanels: 37, inverters: [] },
    }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}


async function postCalculate(opts: { withFleet: boolean }): Promise<{ status: number; json: any }> {
  const { POST } = await import('@/app/api/engineering/calculate/route');
  const { NextRequest } = await import('next/server');
  // Philadelphia Solar PS-MNB108(HCBF)-440W — the panel on Ray's job.
  const pvArray = {
    panelId: 'ps-mnb108-440', moduleCount: 37,
    panelVoc: 52.7, panelVmp: 43.6, panelIsc: 13.7, panelImp: 12.9, panelWatts: 440,
    tempCoeffVoc: -0.25, maxSeriesFuseRating: 25,
  };
  const res = await POST(new NextRequest('http://localhost/api/engineering/calculate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT, address: '238 N Warwick Ave', state: 'IL',
      topologyType: 'STRING',
      electrical: {
        // 🚨 NO INVERTER FLEET — which is the whole point of a DC-coupled job.
        inverters: opts.withFleet
          ? [{ type: 'string', maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
               mpptChannels: 2, acOutputKw: 5.7,
               strings: [{ panelCount: 19, ...pvArray }] }]
          : [],
        pvArray,
        mainPanelAmps: 400, systemVoltage: 240, wireGauge: '#10 AWG', wireLength: 60,
        conduitType: 'EMT', interconnection: { method: 'SUPPLY_SIDE_TAP', busRating: 400, mainBreaker: 400 },
      },
    }),
  }));
  const j = await res.json().catch(() => ({}));
  return { status: res.status, json: j };
}

async function resolveArchitecture(coupling: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/electrical-architecture/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/electrical-architecture', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT, coupling }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function getArchitecture(): Promise<{ status: number; json: Record<string, unknown> }> {
  const { GET } = await import('@/app/api/engineering/electrical-architecture/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest(
    `http://localhost/api/engineering/electrical-architecture?projectId=${PROJECT}`));
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

const readRow = async () => {
  const r = (await db.query(
    `SELECT service_topology, selected_equipment FROM projects WHERE id = $1`, [PROJECT])).rows[0] as
    { service_topology: unknown; selected_equipment: unknown };
  const j = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v;
  return { st: j(r.service_topology) as any, se: j(r.selected_equipment) as any };
};

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the row is Rays live row', () => {
  it('holds the upsized inverter, no coupling, no provenance and no generation panels', async () => {
    await writeRaysLiveRow();
    const { st, se } = await readRow();
    expect(st.topology.solarCoupling, 'the fixture recorded a coupling').toBeUndefined();
    expect(st.topology.aggregationPanels, 'the fixture created generation panels').toEqual([]);
    expect(se.inverterId).toBe(RAYS_INVERTER);
    expect(se.provenance, 'the fixture stored provenance — then it is not a legacy row').toBeUndefined();
    expect(st.topology.domains.length, 'two 200 A systems').toBe(2);
    expect(st.topology.storage.filter((u: any) => u.role === 'inverter-unit').length).toBe(4);
  });

  it('🚨 the stored inverter is NOT the auto-picks id — the upsize moved it', async () => {
    // This is why the classifier tests REACHABILITY and not equality. If this assertion ever flips,
    // the evidence predicate below has become a tautology and must be re-derived.
    const { getEquipmentByEcosystem } = await import('@/lib/equipment-db');
    const ids = getEquipmentByEcosystem('tesla').stringInverters.map(i => i.id);
    expect(ids[0], 'the Tesla ecosystem auto-pick moved').toBe(AUTO_PICK);
    expect(RAYS_INVERTER).not.toBe(AUTO_PICK);
    expect(ids, 'the upsized model left the ecosystem list').toContain(RAYS_INVERTER);
  });
});

describe('🚨 WHICH LAYER WAS WRONG — proven, not assumed', () => {
  it('the canonicalizer was RIGHT: it refuses to pick a side', async () => {
    await writeRaysLiveRow();
    const m = (await load())!.model;
    expect(m.solarCoupling, 'the model picked a side').toBeNull();
    expect(m.solarCouplingProvenance.source).toBe('none');
    expect(m.canonicalizationPatch, 'a conflict was canonicalised away').toBeNull();
    expect(m.conflicts.map(c => c.code)).toContain('SOLAR_COUPLING_UNRESOLVED');
  });

  it('🚨 THE BADGE WAS WRONG: a null coupling must not render as STRING INVERTER', async () => {
    const { topologyBadge, ARCHITECTURE_UNRESOLVED_LABEL } =
      await import('@/lib/electrical/architectureLabel');
    await writeRaysLiveRow();
    const m = (await load())!.model;

    // The page's inputs on Ray's screen: a string inverter in `config.inverters[0]`, not hybrid.
    const badge = topologyBadge({
      architectureResolutionRequired: m.architectureResolutionRequired,
      solarCoupling: m.solarCoupling,
      isHybrid: false,
      firstInverterType: 'string',
    });
    expect(badge.label).toBe(ARCHITECTURE_UNRESOLVED_LABEL);
    expect(badge.label).not.toBe('STRING INVERTER');
  });

  it('🚨 and NO equipment state can produce a system label while the architecture is unresolved', async () => {
    const { topologyBadge, ARCHITECTURE_UNRESOLVED_LABEL } =
      await import('@/lib/electrical/architectureLabel');
    // The exhaustive truth table for the arm ordering — the defect was ORDER, so order is what is
    // asserted, across every input that used to be able to win.
    for (const isHybrid of [true, false]) {
      for (const t of ['micro', 'optimizer', 'string', null, undefined]) {
        for (const c of ['dc-coupled-storage', 'ac-coupled-inverter', 'storage-only', null] as const) {
          const b = topologyBadge({
            architectureResolutionRequired: true, solarCoupling: c, isHybrid, firstInverterType: t,
          });
          expect(b.label, `hybrid=${isHybrid} type=${t} coupling=${c}`)
            .toBe(ARCHITECTURE_UNRESOLVED_LABEL);
        }
      }
    }
    // And with nothing unresolved the existing labels are untouched — this must not have become a
    // badge that always shouts.
    expect(topologyBadge({ architectureResolutionRequired: false, solarCoupling: null,
      isHybrid: false, firstInverterType: 'string' }).label).toBe('STRING INVERTER');
    expect(topologyBadge({ architectureResolutionRequired: false, solarCoupling: null,
      isHybrid: false, firstInverterType: 'micro' }).label).toBe('MICROINVERTER');
    expect(topologyBadge({ architectureResolutionRequired: false, solarCoupling: null,
      isHybrid: true, firstInverterType: 'micro' }).label).toBe('HYBRID SYSTEM');
    expect(topologyBadge({ architectureResolutionRequired: false,
      solarCoupling: 'dc-coupled-storage', isHybrid: true, firstInverterType: 'micro' }).label)
      .toBe('PV DC COUPLED TO STORAGE');
  });
});

describe('🚨 PROVENANCE PARTICIPATES — existence is not intent', () => {
  it('classifies Rays inverter as a suggestion, citing the upsize', async () => {
    await writeRaysLiveRow();
    const m = (await load())!.model;
    const o = m.externalInverterOrigin!;
    expect(o.kind).toBe('AUTO_SUGGESTED_LEGACY');
    expect(o.isInstallerDecision).toBe(false);
    // The evidence must NAME the mechanism, or an operator cannot check the claim.
    const ev = o.evidence.join(' ');
    expect(ev).toContain('No provenance was stored');
    expect(ev).toContain(AUTO_PICK);
    expect(ev).toContain('upsized within the same brand');
    expect(ev).toContain('publish their own PV DC inputs');
  });

  it('🚨 a STORED provenance is read instead of analysed — and USER_SELECTED stands', async () => {
    await writeRaysLiveRow({ provenance: { inverter: {
      kind: 'USER_SELECTED', recordedAt: '2026-01-01T00:00:00.000Z',
      basis: 'The installer picked it.', by: 'equipment-picker',
    } } });
    const m = (await load())!.model;
    expect(m.externalInverterOrigin!.kind).toBe('USER_SELECTED');
    expect(m.externalInverterOrigin!.isInstallerDecision).toBe(true);
    expect(m.externalInverterOrigin!.evidence, 'a recorded provenance was re-analysed').toEqual([]);
    // 🚨 AND IT IS STILL A CONFLICT. A deliberate inverter beside DC-capable storage is a REAL
    // disagreement — Ray: "Do not assume Tesla storage always eliminates Enphase." What provenance
    // changes is what the operator is TOLD, not whether the question gets asked.
    expect(m.architectureResolutionRequired).toBe(true);
    expect(m.conflicts[0].claims.some(c => /is selected/.test(c.says))).toBe(true);
    expect(m.conflicts[0].claims.some(c => /does not stand as a decision/.test(c.says))).toBe(false);
  });

  it('🚨 an unknown provenance kind does NOT read as USER_SELECTED', async () => {
    await writeRaysLiveRow({ provenance: { inverter: { kind: 'DEFINITELY_FINE', basis: 'trust me' } } });
    const m = (await load())!.model;
    expect(m.externalInverterOrigin!.isInstallerDecision).toBe(false);
  });

  it('🚨 THE EVIDENCE CANNOT SETTLE INTENT — and the classifier says so in those words', async () => {
    // The justification for asking rather than inferring, asserted rather than asserted-in-prose:
    // the two histories produce the SAME BYTES. A deliberate click and the auto-picker both left a
    // row with an inverter and no provenance, so there is nothing to tell them apart.
    const { classifyLegacyInverterSelection } = await import('@/lib/electrical/equipmentProvenance');
    const ev = {
      provenanceRecorded: false, inverterId: RAYS_INVERTER,
      autoPickWouldHaveChosen: AUTO_PICK,
      ecosystemStringInverterIds: [AUTO_PICK, RAYS_INVERTER],
      ecosystemBrand: 'tesla', storageTakesPvOnDc: true, pvCapableUnitCount: 4,
    };
    const verdict = classifyLegacyInverterSelection(ev);
    expect(verdict.verdict).toBe('AUTO_SUGGESTED_LEGACY');
    expect(verdict.settlesIntent, 'the classifier claimed to settle intent').toBe(false);
    expect(verdict.basis).toContain('does not prove the opposite either');
    // Deterministic: the same evidence twice is the same verdict.
    expect(classifyLegacyInverterSelection(ev)).toEqual(verdict);
  });

  it('a product the ecosystem never published is INDETERMINATE, not USER_SELECTED', async () => {
    // The asymmetry: reachability convicts, non-reachability does not acquit. Catalogue membership
    // changes over time, so "not in the list today" cannot stand as "a human chose it".
    const { classifyLegacyInverterSelection } = await import('@/lib/electrical/equipmentProvenance');
    const v = classifyLegacyInverterSelection({
      provenanceRecorded: false, inverterId: 'solaredge-se7600h-us',
      autoPickWouldHaveChosen: AUTO_PICK, ecosystemStringInverterIds: [AUTO_PICK],
      ecosystemBrand: 'tesla', storageTakesPvOnDc: true, pvCapableUnitCount: 4,
    });
    expect(v.verdict).toBe('INDETERMINATE');
    expect(v.settlesIntent).toBe(false);
  });
});

describe('🚨 NO PRODUCTION SURFACE DRAWS A COMPETING SYSTEM', () => {
  it('the SLD route REFUSES, and names both answers', async () => {
    await writeRaysLiveRow();
    const { status, json } = await generateSld();
    expect(status).toBe(409);
    expect(json.code).toBe('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
    expect(json.error).toBe('ELECTRICAL ARCHITECTURE REQUIRES RESOLUTION');
    // 🚨 AND NO SVG CAME BACK. A permit-grade artefact that exists can be printed and submitted.
    expect(json.svg).toBeUndefined();
    const choices = json.choices as Array<{ coupling: string }>;
    expect(choices.map(c => c.coupling).sort()).toEqual(['ac-coupled-inverter', 'dc-coupled-storage']);
    const inv = json.externalInverter as { id: string; origin: { kind: string } };
    expect(inv.id).toBe(RAYS_INVERTER);
    expect(inv.origin.kind).toBe('AUTO_SUGGESTED_LEGACY');
    expect(String(json.electricalRevision).startsWith('ELEC-')).toBe(true);
    expect((json.resolveWith as { path: string }).path)
      .toBe('/api/engineering/electrical-architecture');
  });

  it('the BOM route REFUSES — a parts list is the same assertion in another format', async () => {
    await writeRaysLiveRow();
    const { status, json } = await postBom();
    expect(status).toBe(409);
    expect(json.code).toBe('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
  });

  it('the PERMIT route REFUSES the sealed package', async () => {
    await writeRaysLiveRow();
    const { status, json } = await postPermit();
    expect(status).toBe(409);
    expect(json.code).toBe('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
  });

  it('🚨 OTHER ENGINEERING KEEPS OPERATING — the refusal is scoped to the coupling', async () => {
    await writeRaysLiveRow();
    const m = (await load())!.model;
    expect(m.serviceRatedAmps).toBe(400);
    expect(m.storage.invertingUnitCount).toBe(4);
    expect(m.storage.gatewayCount).toBe(2);
    expect(m.moduleCount).toBe(37);
    // And a conflict that is NOT the architecture does not set the gate.
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const only = resolveElectricalProject({
      topology: m.topology, selectedEquipment: { batteryCount: 99, moduleCount: 37 },
    });
    expect(only.conflicts.map(c => c.code)).toContain('STORAGE_COUNT_MIRROR_STALE');
    expect(only.architectureResolutionRequired,
      'a stale battery-count mirror blocked the drawing').toBe(false);
  });
});

describe('🚨 ONE EXPLICIT DECISION, PERSISTED PERMANENTLY', () => {
  it('GET offers the question, the answers and the equipments origin', async () => {
    await writeRaysLiveRow();
    const { status, json } = await getArchitecture();
    expect(status).toBe(200);
    expect(json.resolutionRequired).toBe(true);
    expect(json.coupling).toBeNull();
    const inv = json.externalInverter as { origin: { kind: string; evidence: string[] } };
    expect(inv.origin.kind).toBe('AUTO_SUGGESTED_LEGACY');
    expect(inv.origin.evidence.length).toBeGreaterThan(0);
  });

  it('🚨 DC: the coupling is recorded, the inverter is RETIRED, history survives, modules do not move',
    async () => {
      await writeRaysLiveRow();
      const before = await readRow();
      const { status, json } = await resolveArchitecture('dc-coupled-storage');
      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.retiredExternalInverter).toBe(true);
      // Read back through the SAME load path, not from the response's own claim.
      expect(json.resolutionRequired).toBe(false);
      expect(json.couplingAfter).toBe('dc-coupled-storage');

      const { st, se } = await readRow();
      expect(st.topology.solarCoupling).toBe('dc-coupled-storage');
      // 🚨 DISAPPEARS FROM DESIGN AUTHORITY…
      expect(se.inverterId).toBeNull();
      expect(se.inverter).toBeNull();
      // …🚨 BUT THE HISTORY IS STILL THERE, with the full object and why it left.
      expect(se.retiredInverter.id).toBe(RAYS_INVERTER);
      expect(se.retiredInverter.record.model).toBe('Solar Inverter 5.7kW');
      expect(se.retiredInverter.originAtRetirement.kind).toBe('AUTO_SUGGESTED_LEGACY');
      expect(String(se.retiredInverter.retiredBecause)).toContain('DC coupled');
      expect(se.retiredInverterHistory.length).toBe(1);
      // 🚨 AND THE DECISION ITSELF IS RECORDED, so this can never be re-asked.
      expect(se.provenance.architecture.kind).toBe('USER_SELECTED');
      expect(se.provenance.architecture.by).toBe('architecture-resolution');

      // 🚨 "the 37 real modules remain … no module is lost or fabricated"
      const panels = (await db.query(
        `SELECT total_panels FROM layouts WHERE project_id = $1`, [PROJECT])).rows[0] as
        { total_panels: number };
      expect(panels.total_panels).toBe(37);
      // The graph's physical equipment is untouched apart from the coupling field.
      expect(st.topology.storage.length).toBe(before.st.topology.storage.length);
      expect(st.topology.domains.length).toBe(2);
    });

  it('🚨 and the model now reads DC coupled with its provenance naming the designer', async () => {
    await writeRaysLiveRow();
    await resolveArchitecture('dc-coupled-storage');
    const m = (await load())!.model;
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.solarCouplingProvenance.source).toBe('service-topology');
    expect(m.architectureResolutionRequired).toBe(false);
    expect(m.hasExternalInverter).toBe(false);
    expect(m.externalInverterOrigin).toBeNull();
    expect(m.conflicts.filter(c => c.code === 'SOLAR_COUPLING_UNRESOLVED')).toEqual([]);
  });

  it('🚨 AC: the inverter STAYS and stops being reported as a suggestion', async () => {
    await writeRaysLiveRow();
    const { status } = await resolveArchitecture('ac-coupled-inverter');
    expect(status).toBe(200);
    const { st, se } = await readRow();
    expect(st.topology.solarCoupling).toBe('ac-coupled-inverter');
    expect(se.inverterId, 'the AC answer retired the inverter it just confirmed').toBe(RAYS_INVERTER);
    expect(se.retiredInverter).toBeUndefined();
    expect(se.provenance.inverter.kind).toBe('USER_SELECTED');
    expect(se.provenance.inverter.by).toBe('architecture-resolution');

    const m = (await load())!.model;
    expect(m.architectureResolutionRequired).toBe(false);
    expect(m.externalInverterOrigin!.kind).toBe('USER_SELECTED');
    expect(m.externalInverterOrigin!.isInstallerDecision).toBe(true);
  });

  it('🚨 a SECOND resolution is refused — a stale tab cannot overwrite a settled architecture', async () => {
    await writeRaysLiveRow();
    expect((await resolveArchitecture('dc-coupled-storage')).status).toBe(200);
    const again = await resolveArchitecture('ac-coupled-inverter');
    expect(again.status).toBe(409);
    expect(again.json.refusal).toBe('NOTHING_TO_RESOLVE');
    const { st } = await readRow();
    expect(st.topology.solarCoupling, 'the second request changed the architecture')
      .toBe('dc-coupled-storage');
  });

  it('🚨 a STALE PAGE FLEET would re-raise the conflict — which is why the page clears it', async () => {
    // Two equipment stores, one question. The server empties `selected_equipment.inverter`; the
    // page's own `engineering_config.inverters` fleet is untouched by that write, and the browser
    // composes the canonical model from the FLEET. This asserts both halves of why
    // `resolveElectricalArchitecture` filters the retired inverter out of `config.inverters`.
    await writeRaysLiveRow();
    await resolveArchitecture('dc-coupled-storage');
    const loaded = (await load())!;
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');

    // From the STORE: settled.
    expect(loaded.model.architectureResolutionRequired).toBe(false);

    // From a STALE FLEET still naming the retired inverter: the conflict is back. Not a bug in the
    // model — the model is right, the fleet is stale, and the page corrects the fleet.
    const stale = resolveElectricalProject({
      topology: loaded.model.topology,
      selectedEquipment: { inverterId: RAYS_INVERTER, inverterType: 'string', moduleCount: 37 },
    });
    expect(stale.architectureResolutionRequired).toBe(true);

    // 🚨 AND A GENUINELY NEW PICK ON A SETTLED DC PROJECT MUST STILL RAISE IT. The fix clears the
    // stale fleet; it must not suppress the conflict, or choosing an inverter after resolving would
    // silently do nothing.
    const newPick = resolveElectricalProject({
      topology: loaded.model.topology,
      selectedEquipment: { inverterId: 'enphase-iq8plus', inverterType: 'micro', moduleCount: 37 },
    });
    expect(newPick.architectureResolutionRequired).toBe(true);
    expect(newPick.conflicts[0].code).toBe('SOLAR_COUPLING_UNRESOLVED');
  });

  it('a coupling that is not an offered answer is refused', async () => {
    await writeRaysLiveRow();
    const r = await resolveArchitecture('storage-only');
    expect(r.status).toBe(409);
    expect(r.json.refusal).toBe('NOT_AN_OFFERED_CHOICE');
  });

  it('🚨 AFTER THE DECISION THE SHEET DRAWS ONE SYSTEM — the DC one', async () => {
    await writeRaysLiveRow({ generationPanels: true });
    await resolveArchitecture('dc-coupled-storage');
    const { status, svg } = await generateSld();
    expect(status).toBe(200);
    expect(svg.length).toBeGreaterThan(5000);
    // The posted body still said STRING and still named the Tesla Solar Inverter. The recorded
    // architecture outranks it — that is the whole claim of this slice.
    expect(svg).toContain('DC COUPLED');
    expect(svg, 'the retired inverter is still drawn').not.toContain('Solar Inverter 5.7kW');
    expect(svg, 'an AC disconnect chain for an inverter that is not in the design')
      .not.toContain('DC Disconnect');
  });
});

describe('🚨 GENERATION PANELS — the second live failure', () => {
  it('Rays row has none, and that is a real state rather than a gap to fill', async () => {
    await writeRaysLiveRow();
    const m = (await load())!.model;
    expect(m.storage.perSystemGenerationPanelCount).toBe(0);
    // No migration invented them. Creating equipment to make a check pass is the defect, mirrored.
    const { st } = await readRow();
    expect(st.topology.aggregationPanels).toEqual([]);
  });

  it('🚨 ONE PANEL PER SYSTEM, each fed by ITS OWN batteries and feeding ITS OWN gateway', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { applyPerSystemGenerationPanels } = await import('@/lib/electrical/topologyPresets');
    const base = { ...buildRaysIntendedJob().topology, aggregationPanels: [] };
    const r = applyPerSystemGenerationPanels(base);
    const panels = (r.topology.aggregationPanels ?? []).filter(p => p.domainId);
    expect(panels.length).toBe(2);
    expect(new Set(panels.map(p => p.domainId)).size, 'one shared panel was built').toBe(2);
    for (const d of r.topology.domains) {
      const panel = panels.find(p => p.domainId === d.id)!;
      expect(panel.feedsNodeId, 'the panel does not feed its own gateway').toBe(d.gateway.id);
      // Its breakers are that system's inverting units — not the site's.
      const own = d.storageUnitIds.filter(id =>
        r.topology.storage.find(u => u.id === id && u.role === 'inverter-unit'));
      expect(panel.inputs.length).toBe(own.length);
      expect(panel.inputs.every(i => own.includes(i.sourceId))).toBe(true);
      expect(d.storageConnection).toBe('der-aggregation-panel');
    }
  });

  it('🚨 PER-SYSTEM: answering for one system does not unanswer the other', async () => {
    // Ray: "independently for each system or through a clearly stated apply-to-both action."
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { applyPerSystemGenerationPanels, clearPerSystemGenerationPanels } =
      await import('@/lib/electrical/topologyPresets');
    // 🚨 START FROM THE UNANSWERED STATE. The fixture is Ray's INTENDED job, so its domains already
    // claim `der-aggregation-panel`; stripping only the panels would leave the arrangement claimed
    // with nothing to back it (the inconsistency `d1f5c3b1` made a FAIL). What this test is about is
    // the step BEFORE either answer exists.
    const built = buildRaysIntendedJob().topology;
    const base = {
      ...built,
      aggregationPanels: [],
      domains: built.domains.map(d => ({ ...d, storageConnection: 'unresolved' as const })),
    };
    const [a, b] = base.domains.map(d => d.id);

    const justA = applyPerSystemGenerationPanels(base, [a]).topology;
    expect((justA.aggregationPanels ?? []).filter(p => p.domainId).length).toBe(1);
    expect(justA.domains.find(d => d.id === a)!.storageConnection).toBe('der-aggregation-panel');
    expect(justA.domains.find(d => d.id === b)!.storageConnection).not.toBe('der-aggregation-panel');

    // Now B as well — and A must survive it.
    const both = applyPerSystemGenerationPanels(justA, [b]).topology;
    expect((both.aggregationPanels ?? []).filter(p => p.domainId).length,
      'building system B deleted system A\'s panel').toBe(2);

    // Clearing B leaves A alone.
    const clearedB = clearPerSystemGenerationPanels(both, [b]);
    const left = (clearedB.aggregationPanels ?? []).filter(p => p.domainId);
    expect(left.length).toBe(1);
    expect(left[0].domainId).toBe(a);
    expect(clearedB.domains.find(d => d.id === a)!.storageConnection).toBe('der-aggregation-panel');
    expect(clearedB.domains.find(d => d.id === b)!.storageConnection).toBe('unresolved');
  });

  it('🚨 a claimed arrangement with no panel still FAILS — the guard from d1f5c3b1 is intact', async () => {
    await writeRaysLiveRow();
    const { evaluateServiceTopology } = await import('@/lib/electrical/serviceTopology');
    const m = (await load())!.model;
    const claimed = {
      ...m.topology!,
      domains: m.topology!.domains.map(d => ({ ...d, storageConnection: 'der-aggregation-panel' as const })),
      aggregationPanels: [],
    };
    const report = evaluateServiceTopology(claimed);
    const fails = report.checks.filter(c => c.conclusion === 'FAIL');
    expect(fails.length, 'an arrangement naming a panel that does not exist passed').toBeGreaterThan(0);
  });
});

describe('🚨 BLAST RADIUS — other brands and other scenarios are untouched', () => {
  it('a legacy project whose storage takes no PV on DC is NOT gated', async () => {
    // Ray's standing constraint: "Must not change the sld logic for other brands and other
    // scenarios." Storage that publishes no PV input leaves exactly one coherent placement for the
    // strings, so there is nothing to ask and nothing to block.
    await writeRaysLiveRow({ pvCapableStorage: false, generationPanels: true });
    const m = (await load())!.model;
    expect(m.architectureResolutionRequired).toBe(false);
    expect(m.solarCoupling).toBe('ac-coupled-inverter');
    expect(m.externalInverterOrigin!.kind).toBe('UNRECORDED');
    // 🚨 AND ITS ORIGIN IS NOT BADGED AS A SUGGESTION. `UNRECORDED` is true of every pre-provenance
    // project; treating it as suspect would put a conflict banner on every legacy job in the system.
    expect(m.externalInverterOrigin!.kind).not.toBe('AUTO_SUGGESTED_LEGACY');
  });

  it('a project with no separate inverter is unaffected and still canonicalises to DC', async () => {
    await writeRaysLiveRow({ inverterId: null, generationPanels: true });
    const m = (await load())!.model;
    expect(m.architectureResolutionRequired).toBe(false);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.canonicalizationPatch).toEqual({ solarCoupling: 'dc-coupled-storage' });
    expect(m.externalInverterOrigin).toBeNull();
  });

  it('🚨 an AS-ISSUED read is not re-classified or re-canonicalised', async () => {
    await writeRaysLiveRow();
    const { parseServiceTopology } = await import('@/lib/db/serviceTopology');
    const { st } = await readRow();
    const issued = parseServiceTopology(st, 'as-issued')!;
    // The parser normalises an absent coupling to `null` — "the project does not say" has one
    // representation inside the model, which is what lets the badge test above be exhaustive.
    expect(issued.topology.solarCoupling ?? null).toBeNull();
    expect(issued.refreshes).toEqual([]);
    for (const u of issued.topology.storage.filter(x => x.role === 'inverter-unit')) {
      expect(u.ocpdA, 'an issued drawing was rewritten by a later correction').toBe(50);
    }
  });

  it('🚨 resolving does not touch the issued read either', async () => {
    await writeRaysLiveRow();
    await resolveArchitecture('dc-coupled-storage');
    const { parseServiceTopology } = await import('@/lib/db/serviceTopology');
    const { st } = await readRow();
    // The row now RECORDS the coupling — that is the resolution. What must not change is that an
    // as-issued read reports the stored bytes rather than today's catalogue.
    const issued = parseServiceTopology(st, 'as-issued')!;
    expect(issued.topology.solarCoupling).toBe('dc-coupled-storage');
    for (const u of issued.topology.storage.filter(x => x.role === 'inverter-unit')) {
      expect(u.ocpdA).toBe(50);
    }
    const active = parseServiceTopology(st, 'active')!;
    expect(active.topology.storage.find(u => u.role === 'inverter-unit')!.ocpdA).toBe(60);
  });
});

describe('🚨 THE SIZING TAB AGREES WITH THE SHEET — Rays §11', () => {
  it('🚨 a DC-coupled job with NO inverter fleet now produces a string configuration', async () => {
    // Before: `if (firstStr && firstInv)` — `firstInv` is absent by design on a DC-coupled job, so
    // the Electrical Sizing tab produced NOTHING while the drawing showed 5 strings of 9.
    await writeRaysLiveRow({ inverterId: null, generationPanels: true });
    const m = (await load())!.model;
    expect(m.solarCoupling).toBe('dc-coupled-storage');

    const { status, json } = await postCalculate({ withFleet: false });
    expect(status).toBe(200);
    const sc = json.data?.stringConfig ?? json.stringConfig;
    expect(sc, 'the sizing tab still produces no string configuration for a DC-coupled job')
      .toBeTruthy();
    // 🚨 THE SAME GEOMETRY THE SHEET DRAWS: 5 strings of 9 for 37 modules on a Powerwall 3 array.
    expect(sc.totalStrings).toBe(5);
    expect(sc.panelsPerString).toBe(9);
    expect(sc.mpptChannels.length, '24 MPPT channels across four Powerwall 3').toBeGreaterThan(0);
  });

  it('🚨 and it sizes against the POWERWALLS 550 V input, not an inverters 600 V default', async () => {
    await writeRaysLiveRow({ inverterId: null, generationPanels: true });
    const { json } = await postCalculate({ withFleet: false });
    const sc = json.data?.stringConfig ?? json.stringConfig;

    // The published window: PW3 PV input 60–550 V, MPPT 60–480 V.
    const { dcStringLimits } = await import('@/lib/electrical/dcStringLimits');
    const m = (await load())!.model;
    const lim = dcStringLimits(m.topology, m.solarCoupling)!;
    expect(lim.maxDcVoltage).toBe(550);
    expect(lim.mpptVoltageMax).toBe(480);
    expect(lim.mpptChannels).toBe(24);          // 6 MPPTs × 4 units

    // 🚨 THE NUMBER THAT WOULD HAVE REACHED A ROOF. With the `?? 600` defaults this array was sized
    // at 2 strings of 19, whose cold string Voc is 1345.8 V — into a 550 V device. The corrected
    // string must fit the published input.
    expect(sc.stringVoc, `cold string Voc ${sc.stringVoc} V exceeds the Powerwall 3 550 V PV input`)
      .toBeLessThanOrEqual(550);
    expect(sc.stringVoc).toBeGreaterThan(0);
    expect(sc.panelsPerString, '19 panels per string is the 1345.8 V string').toBeLessThan(19);
    // And the array power is inside what the storage will accept on DC.
    expect(sc.totalDcPower / 1000).toBeLessThanOrEqual(lim.maxStcKw);
  });

  it('🚨 an AC-coupled job is UNTOUCHED — the DC branch is unreachable for it', async () => {
    // Blast radius, Ray's standing constraint: "must not change the SLD logic for other brands and
    // other scenarios." The new branch is guarded by `_dcLimits`, so proving it is NULL for every
    // other job is proving the branch cannot be entered — which is a stronger statement than
    // observing that one AC job still looks right.
    //
    // 🚨 HARNESS LIMIT, STATED RATHER THAN HIDDEN: this suite cannot assert the AC job's 200 from the
    // calculate route. A fleet-carrying call returns 503 (`DB_STARTING`) here even on a project with
    // no graph at all — the route's jurisdiction/structural path reaches a database this file does
    // not stand up. That is pre-existing and unrelated to this change; it is covered by the
    // route's own suites. What IS asserted here is the guard itself.
    await writeRaysLiveRow({ pvCapableStorage: false, generationPanels: true });
    const acModel = (await load())!.model;
    expect(acModel.solarCoupling).toBe('ac-coupled-inverter');

    const { dcStringLimits } = await import('@/lib/electrical/dcStringLimits');
    expect(dcStringLimits(acModel.topology, acModel.solarCoupling)).toBeNull();
    // Every other coupling, on a graph that DOES publish PV inputs: still null.
    await writeRaysLiveRow({ inverterId: null, generationPanels: true });
    const dcModel = (await load())!.model;
    expect(dcStringLimits(dcModel.topology, 'ac-coupled-inverter')).toBeNull();
    expect(dcStringLimits(dcModel.topology, 'storage-only')).toBeNull();
    expect(dcStringLimits(dcModel.topology, null)).toBeNull();
    expect(dcStringLimits(null, 'dc-coupled-storage')).toBeNull();
    // And non-null for exactly one combination.
    expect(dcStringLimits(dcModel.topology, 'dc-coupled-storage')).not.toBeNull();
  });

  it('🚨 ONE DERIVATION: the sizing route and the SLD route read the same window', async () => {
    // Not "both look right" — the same function. A second copy is how two surfaces come to disagree
    // about one device, which is the disease this whole slice treats.
    const src = readFileSync(join(ROOT, 'app/api/engineering/calculate/route.ts'), 'utf8');
    const sldSrc = readFileSync(join(ROOT, 'app/api/engineering/sld/route.ts'), 'utf8');
    expect(src).toContain("@/lib/electrical/dcStringLimits");
    expect(sldSrc).toContain("@/lib/electrical/dcStringLimits");
    // And neither route reconstructs the window from `pvInputLimits` itself any more.
    expect(sldSrc.includes('u.pvInputLimits!'),
      'the SLD route still has its own copy of the DC window').toBe(false);
  });

  it('a mixed-model DC-coupled graph gets NO projection rather than the first units window', async () => {
    const { dcStringLimits } = await import('@/lib/electrical/dcStringLimits');
    await writeRaysLiveRow({ inverterId: null, generationPanels: true });
    const m = (await load())!.model;
    const mixed = {
      ...m.topology!,
      storage: m.topology!.storage.map((u, i) => i === 0 && u.pvInputLimits
        ? { ...u, pvInputLimits: { ...u.pvInputLimits, mpptVdc: [60, 400] as [number, number] } }
        : u),
    };
    expect(dcStringLimits(mixed, 'dc-coupled-storage'),
      'a mixed-model graph took the window of whichever unit came first, making the answer depend on node order')
      .toBeNull();
  });
});
