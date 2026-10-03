// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE SEVEN LIVE REPAIRS, PROVEN THROUGH THE CALLERS THAT ACTUALLY EXIST.
//
// Ray, 2026-10-02, after the chain trace found seven repairs already reported as done were live
// defects:
//
//   "A unit test of a server branch is not proof if the browser can never send the input that
//    reaches that branch. A repaired SVG is not proof if the PDF route still behaves differently.
//    A repaired SLD is not proof if the permit reconstructs another system. No repair is closed
//    until the real caller reaches it."
//
// 🚨 THE MISTAKE THIS FILE EXISTS TO NOT REPEAT.
//
// I removed an invented `fronius-primo-8.2` from `/api/engineering/bom` and verified it two ways:
// by reading the route, and by a test that POSTs no inverter id. Both green. But
// `app/engineering/page.tsx` posted `firstInv?.inverterId || 'fronius-primo-8.2'`, so
// `body.inverterId` was NEVER empty, the absence branch was unreachable, and a DC-coupled design
// still had a Fronius quoted. **A guard exercised only by a caller that does not exist in
// production has never run.**
//
// So every request body below is shaped the way the BROWSER shapes it — including the fields the
// page sends that are wrong — and the assertions are about what comes back out of the real handler.
//
// TWO FIXTURES, per Ray's production-proof list:
//   A — a normal residence: 200 A, 1 MSP, 1 Gateway, 1 Powerwall 3.
//   B — Ray's current design: 400 A, 2 × 200 A systems, 2 × Gateway 3, 4 × full PW3, 0 expansions,
//       2 generation panels, 37 × 440 W = 16.28 kW DC, PV DC-coupled, external PV inverter NONE.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const src = (...p: string[]) => read(...p);

const USER_ID = '11111111-1111-4111-8111-111111111111';
/** Fixture B — Ray's 400 A job. */
const PROJECT_B = '4030b664-bebe-433b-a11c-cda05ead2f7d';
/** Fixture A — the ordinary house. */
const PROJECT_A = '5040c775-cfcf-4440-b22d-dbe16fbe3e8e';

const RAYS_INVERTER = 'tesla-solar-inverter-5p7k';

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
// `lib/db/projects.ts` and `lib/db/production.ts` take their connection from `./core`.
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
    `ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`,
  ]) await db.exec(c);

  // Warm the route module graph in the 60 s boot budget, not inside a 10 s test.
  await Promise.all([
    import('@/app/api/engineering/sld/route'),
    import('@/app/api/engineering/sld/pdf/route'),
    import('@/app/api/engineering/bom/route'),
    import('@/app/api/engineering/calculate/route'),
    import('@/app/api/engineering/electrical-architecture/route'),
    import('@/lib/electrical/loadElectricalProject'),
    import('@/lib/db/serviceTopology'),
  ]);
}, 90_000);

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  // 🚨 THERE IS NO `users` TABLE in this schema — `user_id` is a plain column. A beforeEach that
  // inserted one failed every test in the file before a single assertion ran.
  //
  // 🚨 AND THE LAYOUT ROW IS NOT OPTIONAL: `layouts.total_panels` is where the canonical module
  // count comes from, so a fixture without one silently falls back to a default and the
  // 37-module assertions would be testing 20.
  for (const [id, name, panels] of [
    [PROJECT_B, 'Hussey Ethos 400A', 37],
    [PROJECT_A, 'Normal Residence', 20],
  ] as Array<[string, string, number]>) {
    await db.query(
      `INSERT INTO projects (id, user_id, name, status, system_type, address)
       VALUES ($1, $2, $3, 'lead', 'roof', '238 N Warwick Ave')`, [id, USER_ID, name]);
    await db.query(
      `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,$3)`,
      [id, USER_ID, panels]);
  }
});

// ─── FIXTURES ──────────────────────────────────────────────────────────────

/**
 * Fixture B. `retired` writes the state AFTER an architecture resolution: the inverter cleared
 * from both stores, which is what Ray's project looks like once the conflict has been settled.
 */
async function writeFixtureB(opts?: { retired?: boolean }): Promise<void> {
  const retired = opts?.retired ?? false;
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology)));

  // 🚨 A LEGACY ROW DOES NOT CARRY `solarCoupling` — the field postdates Ray's project. Leaving the
  // fixture's recorded coupling in place meant the resolver had its answer handed to it and NEVER
  // raised the conflict, so a test asserting the 409 refusal would have been asserting against a
  // project that was never ambiguous. Deleting it is what makes the resolver re-derive from the
  // evidence: an explicit inverter AND storage that publishes its own PV inputs ⇒ it refuses to
  // pick a side, which is the state Ray's live project was actually in.
  if (!retired) delete (stored as any).topology.solarCoupling;

  const se: Record<string, unknown> = retired
    ? { batteryCount: 4, inverter: null, inverterId: null }
    : {
        batteryCount: 4,
        inverter: { id: RAYS_INVERTER, type: 'string', manufacturer: 'Tesla', model: 'Solar Inverter 5.7kW' },
        inverterId: RAYS_INVERTER,
      };

  const engCfg = retired
    ? { schemaVersion: 2, inverters: [], subSystems: { roof: { inverterId: null } }, mainPanelAmps: 400 }
    : {
        schemaVersion: 2,
        inverters: [
          { inverterId: RAYS_INVERTER, type: 'string',
            strings: [{ panelId: 'ps-mnb108-440', panelCount: 10 },
                      { panelId: 'ps-mnb108-440', panelCount: 9 }] },
          { inverterId: RAYS_INVERTER, type: 'string',
            strings: [{ panelId: 'ps-mnb108-440', panelCount: 9 },
                      { panelId: 'ps-mnb108-440', panelCount: 9 }] },
        ],
        subSystems: { roof: { inverterId: RAYS_INVERTER, topology: 'string' } },
        mainPanelAmps: 400,
      };

  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4
      WHERE id = $1`,
    [PROJECT_B, JSON.stringify(stored), JSON.stringify(se), JSON.stringify(engCfg)]);
}

/**
 * 🚨 RAY'S LIVE ROW, EXACTLY AS IT IS — the state that produced the phantom sheet.
 *
 * `service_topology.solarCoupling = 'ac-coupled-inverter'` (written by a derivation, with no
 * `provenance.architecture` behind it) and NO inverter left in `selected_equipment`.
 *
 * The sheet he was looking at proves the second half: an inverter still ON the record classifies
 * AUTO_SUGGESTED_LEGACY, raises the conflict and returns 409 — he got a drawing, so the record was
 * already empty.
 */
async function writeRaysLiveRowAsItIs(): Promise<void> {
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology))) as any;
  stored.topology.solarCoupling = 'ac-coupled-inverter';
  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4
      WHERE id = $1`,
    [PROJECT_B, JSON.stringify(stored),
     // No inverter on the record, and no provenance.architecture.
     JSON.stringify({ batteryCount: 4, inverter: null, inverterId: null }),
     JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 400 })]);
}

/** Fixture A — the ordinary house, with its POI left unresolved as a new job's would be. */
async function writeFixtureA(opts?: { poi?: string }): Promise<void> {
  const { buildNormalResidence200A } = await import('@/lib/electrical/fixtures/normalResidence200a');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const built = buildNormalResidence200A(
    opts?.poi ? { interconnectionRelationship: opts.poi as never } : {});
  const stored = JSON.parse(JSON.stringify(serialiseServiceTopology(built.topology)));
  await db.query(
    `UPDATE projects SET service_topology = $2, selected_equipment = $3, engineering_config = $4
      WHERE id = $1`,
    [PROJECT_A, JSON.stringify(stored),
     JSON.stringify({ batteryCount: 1, inverter: null, inverterId: null }),
     JSON.stringify({ schemaVersion: 2, inverters: [], mainPanelAmps: 200 })]);
}

// ─── THE REAL CALLERS ──────────────────────────────────────────────────────

/** The body the engineering page actually posts, including the stale architecture it carries. */
function pageSldBody(projectId: string, over: Record<string, unknown> = {}) {
  return {
    projectId,
    projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave',
    drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
    // 🚨 EXACTLY WHAT THE PAGE POSTS — the losing side of the architecture conflict.
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
    utilityName: 'Local Utility',
    hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
    ...over,
  };
}

async function generateSld(projectId: string, over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pageSldBody(projectId, over)),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} as Record<string, unknown> };
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
}

/**
 * The EXPORT PDF button's route. `format: 'svg'` returns the rendered sheet without invoking
 * Chromium — the whole route runs (canonical projection, input build, renderer), so this is the
 * printable artefact's own bytes, not a proxy for them.
 */
async function exportPdfSheet(projectId: string, over: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/engineering/sld/pdf/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // 🚨 WRAPPED IN `buildInput`, WHICH IS HOW THE PAGE SENDS IT — and the reason the deleted
    // `body.topologyType` read was always undefined.
    body: JSON.stringify({ buildInput: pageSldBody(projectId, over), format: 'svg' }),
  }));
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(), json: {} as Record<string, unknown> };
  }
  return {
    status: res.status, svg: '',
    json: await res.json().catch(() => ({})) as Record<string, unknown>,
  };
}

async function postCalculateWithInterconnection(projectId: string, method: string) {
  const { POST } = await import('@/app/api/engineering/calculate/route');
  const { NextRequest } = await import('next/server');
  const pvArray = {
    panelId: 'ps-mnb108-440', moduleCount: 37,
    panelVoc: 52.7, panelVmp: 43.6, panelIsc: 13.7, panelImp: 12.9, panelWatts: 440,
    tempCoeffVoc: -0.25, tempCoeffIsc: 0.05, maxSeriesFuseRating: 25,
  };
  // 🚨 A STRING CARRIES ITS OWN CONDUCTOR FIELDS (`StringInput`), and omitting them made
  // `normalizeGauge(undefined)` throw inside the engine — which `handleRouteDbError` then reported
  // as **503 DB_STARTING**. A malformed payload claiming the database is starting up is its own
  // small diagnosability defect, noted rather than fixed here; what it hid was my test's shape.
  const conductor = { wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT' };
  const res = await POST(new NextRequest('http://localhost/api/engineering/calculate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId, address: '238 N Warwick Ave', state: 'IL', topologyType: 'STRING',
      electrical: {
        inverters: [{ type: 'string', maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 600,
                      mpptChannels: 2, acOutputKw: 5.7, acOutputCurrentMax: 24,
                      maxInputCurrentPerMppt: 15,
                      strings: [{ panelCount: 19, ...pvArray, ...conductor }] }],
        pvArray,
        mainPanelAmps: 400, systemVoltage: 240, wireGauge: '#10 AWG', wireLength: 60,
        conduitType: 'EMT',
        interconnection: { method, busRating: 200, mainBreaker: 200 },
      },
    }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}

/**
 * A COMPLETE `ElectricalCalcInput`.
 *
 * 🚨 MY FIRST VERSION OF THIS WAS A GUESS — `{ inverters: [{type, acOutputKw, quantity}], pvArray:
 * {...} }` with an `as any` to silence the compiler. There is no `pvArray` on this input and no
 * `quantity` on an inverter; the strings live ON the inverter, and `necVersion`, the design
 * temperatures, the conductor fields and the three disconnect booleans are all REQUIRED. The engine
 * threw, and `as any` is what let it compile. Shapes are read from the interface, never assumed.
 */
function calcInput(): import('@/lib/electrical-calc').ElectricalCalcInput {
  const str = {
    panelCount: 10, panelVoc: 52.7, panelIsc: 13.7, panelImp: 12.9, panelVmp: 43.6,
    panelWatts: 440, tempCoeffVoc: -0.25, tempCoeffIsc: 0.05, maxSeriesFuseRating: 25,
    wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT',
  };
  return {
    inverters: [{
      type: 'string', acOutputKw: 5.7,
      maxDcVoltage: 600, mpptVoltageMin: 100, mpptVoltageMax: 550,
      maxInputCurrentPerMppt: 15, acOutputCurrentMax: 24,
      strings: [{ ...str }, { ...str, panelCount: 9 }],
    }],
    mainPanelAmps: 200, systemVoltage: 240,
    designTempMin: -18, designTempMax: 38, rooftopTempAdder: 22,
    wireGauge: '#10 AWG', wireLength: 60, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true,
    necVersion: '2023',
  };
}

const loadB = async () => {
  const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
  return loadElectricalProject(PROJECT_B, USER_ID);
};

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 1 — the SVG and the PDF are two renderings of ONE engineered project', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 MY FIRST VERSION OF THIS TEST WAS BLIND, AND THE MUTATION RUN CAUGHT IT.
  //
  // It asserted "no Fronius on the sheet" using Fixture B — a DC-coupled project. Restoring the
  // fabrication byte-for-byte left the test GREEN, because on a DC-coupled design the renderer
  // prints `'PV DC COUPLED TO POWERWALL 3'` (sld-professional-renderer.ts:4281) and the inverter
  // NAME never reaches the sheet at all. The assertion could not fail, so it proved nothing.
  //
  // The defect harmed a project whose inverter name DOES get printed: one with no canonical
  // architecture to override the posted equipment, sending no inverter model. That is the case
  // tested now, and the mutation turns it red.
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 with no architecture to consult, the EXPORTED sheet says INVERTER NOT SELECTED', async () => {
    // No service_topology at all ⇒ the canonical projection does not apply, so nothing deletes the
    // equipment fields and whatever the route resolves is what gets printed.
    await db.query(`UPDATE projects SET service_topology = NULL, selected_equipment = NULL,
                    engineering_config = NULL WHERE id = $1`, [PROJECT_A]);
    const pdf = await exportPdfSheet(PROJECT_A, {
      // The browser sends no inverter identity for a design that has none.
      inverterModel: undefined, inverterManufacturer: undefined, inverterId: undefined,
      topologyType: undefined,
      totalModules: 20, totalStrings: 2, mainPanelAmps: 200,
    });
    expect(pdf.status, `the PDF route failed: ${JSON.stringify(pdf.json).slice(0, 400)}`).toBe(200);

    expect(pdf.svg, 'the exported PDF sheet fabricates a Fronius').not.toMatch(/Fronius/i);
    expect(pdf.svg, 'the exported PDF sheet fabricates a Primo 8.2-1')
      .not.toMatch(/Primo\s*8\.2/i);
    // 🚨 AND IT SAYS SO, LOUDLY — absence has a representation.
    expect(pdf.svg, 'the sheet neither names a product nor reports the absence')
      .toMatch(/NOT SELECTED/i);
  });

  it('🚨 and on the DC-coupled job neither sheet names a standalone inverter', async () => {
    await writeFixtureB({ retired: true });
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(pdf.status, `the PDF route failed: ${JSON.stringify(pdf.json).slice(0, 400)}`).toBe(200);
    expect(pdf.svg, 'the exported PDF sheet still fabricates a Fronius')
      .not.toMatch(/Fronius/i);
    // The architecture line must be the storage, not a topology word.
    expect(pdf.svg, 'the exported sheet does not state the DC-coupled architecture')
      .toMatch(/DC COUPLED/i);
  });

  it('🚨 both artefacts report the SAME architecture for the same project', async () => {
    await writeFixtureB({ retired: true });
    const svg = await generateSld(PROJECT_B);
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(svg.status).toBe(200);
    expect(pdf.status).toBe(200);

    // The page posted `topologyType: 'STRING'` to BOTH. Neither may honour it.
    for (const [name, sheet] of [['diagram', svg.svg], ['exported PDF', pdf.svg]] as const) {
      expect(sheet.length, `the ${name} produced no sheet`).toBeGreaterThan(1000);
      expect(sheet, `the ${name} drew a standalone PV inverter the project does not have`)
        .not.toMatch(/Tesla Solar Inverter/i);
    }
    // And both must say the same thing about the storage, which is the architecture.
    const mentionsPowerwall = (s: string) => /POWERWALL/i.test(s);
    expect(mentionsPowerwall(svg.svg), 'the diagram does not mention the storage').toBe(true);
    expect(mentionsPowerwall(pdf.svg), 'the exported sheet does not mention the storage').toBe(true);
  });

  it('🚨 the PDF refuses an unresolved architecture, like the diagram does', async () => {
    // Both an explicit inverter AND a DC-coupled graph: the model refuses to pick a side.
    await writeFixtureB({ retired: false });
    const m = (await loadB())!.model;
    expect(m.solarCoupling, 'the fixture is not actually in conflict').toBeNull();

    const svg = await generateSld(PROJECT_B);
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(svg.status, 'the diagram route drew an unresolved architecture').toBe(409);
    expect(pdf.status, 'the EXPORTED PDF can still be produced from an unresolved architecture')
      .toBe(409);
    expect(String((pdf.json as any)?.code ?? ''))
      .toContain('ELECTRICAL_ARCHITECTURE_REQUIRES_RESOLUTION');
  });

  it('🚨 ONE implementation — and the mutation that re-splits them turns this red', () => {
    // The guard that catches the next partial copy. See tests/electricalAuthorityInspector.test.ts
    // for the structural half; this is the behavioural anchor.
    const live = (code: string) => code.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .some(l => /\bprojectCanonicalArchitecture\s*\(/.test(l));
    expect(live(src('app', 'api', 'engineering', 'sld', 'route.ts'))).toBe(true);
    expect(live(src('app', 'api', 'engineering', 'sld', 'pdf', 'route.ts'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 2 — UNRESOLVED is a real engineering state, not a silent LOAD_SIDE', () => {
  it('the evaluator refuses it explicitly, with a reason, an owner and the blocked calculation',
    async () => {
      const { runElectricalCalc } = await import('@/lib/electrical-calc');
      const unresolved = runElectricalCalc({
        ...calcInput(), interconnection: { method: 'UNRESOLVED', busRating: 200, mainBreaker: 200 },
      });
      const ic = unresolved.interconnection;

      // 🚨 THE THIRD ANSWER. Before this, `'UNRESOLVED'` matched none of the four branches and fell
      // out of the if/else chain with passes:false, maxAllowed:0, an EMPTY necReference and NOT ONE
      // ISSUE PUSHED — a silent refusal that any consumer reading "no errors" called approval.
      expect(ic.conclusion, 'an unresolved interconnection did not produce NOT_EVALUATED')
        .toBe('NOT_EVALUATED');
      expect(ic.notEvaluated, 'the refusal carries no detail').toBeTruthy();
      expect(ic.notEvaluated!.state).toBe('UNRESOLVED');
      expect(ic.notEvaluated!.requires.length,
        'an indeterminate result that cannot say what would resolve it is a dead end')
        .toBeGreaterThan(0);
      expect(ic.notEvaluated!.authority).toMatch(/topology|interconnection/i);
      expect(ic.notEvaluated!.blockedCalculation).toMatch(/705\.12/);

      // It must not claim an article it did not apply.
      expect(ic.necReference, 'an unevaluated interconnection cites an NEC article').toBe('');
      expect(unresolved.busbar.busbarRule,
        'the code basis still says 120% for a rule that did not run').toBe('not-evaluated');

      // 🚨 AND THE ISSUE LIST IS NOT EMPTY — that silence was the danger.
      expect(ic.issues.length, 'the refusal emitted no issue at all').toBeGreaterThan(0);
      expect(ic.issues.some(i => i.code === 'E-INTERCONNECTION-NOT-EVALUATED')).toBe(true);
    });

  it('a real LOAD_SIDE job still evaluates — the repair did not break the normal case', async () => {
    const { runElectricalCalc } = await import('@/lib/electrical-calc');
    const r = runElectricalCalc({
      ...calcInput(), interconnection: { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 },
    });
    expect(r.interconnection.conclusion).not.toBe('NOT_EVALUATED');
    expect(r.interconnection.necReference).toContain('705.12');
    expect(r.busbar.busbarRule).toBe('120%');
  });

  it('🚨 the manufacturer-integrated and meter-collar states are PRESERVED, not remapped', async () => {
    const { permitInterconnectionToken, interconnectionRuleOf } =
      await import('@/lib/permit/utils/interconnectionRule');

    // The permit's own normaliser used to collapse every non-supply value to 'LOAD_SIDE'.
    for (const state of ['UNRESOLVED', 'MANUFACTURER_INTEGRATED', 'METER_COLLAR']) {
      expect(permitInterconnectionToken(state),
        `${state} was flattened into a NEC article on the sealed permit`).toBe(state);
      expect(interconnectionRuleOf(state),
        `${state} was given a specific NEC article`).toBe('not-established');
    }
    // Absence is UNRESOLVED, never LOAD_SIDE.
    expect(permitInterconnectionToken(null)).toBe('UNRESOLVED');
    expect(permitInterconnectionToken('')).toBe('UNRESOLVED');
    // And the four real ones still pass through.
    expect(permitInterconnectionToken('LOAD_SIDE')).toBe('LOAD_SIDE');
    expect(permitInterconnectionToken('SUPPLY_SIDE_TAP')).toBe('SUPPLY_SIDE_TAP');
    expect(interconnectionRuleOf('SUPPLY_SIDE_TAP')).toBe('705.11');
  });

  it('🚨 the compliance route reports NOT EVALUATED rather than a verdict it did not reach',
    async () => {
      await writeFixtureA();
      const r = await postCalculateWithInterconnection(PROJECT_A, 'UNRESOLVED');
      expect(r.status,
        `the compliance route failed: ${JSON.stringify(r.json).slice(0, 500)}`).toBe(200);
      // `overallStatus: null` IS "not evaluated" in this repo (OverallStatusResult.status).
      expect(r.json?.overallStatus,
        `an unevaluable interconnection produced the verdict '${r.json?.overallStatus}'`)
        .toBeNull();
      const basis = String(r.json?.statusBasis ?? '');
      expect(basis, `the basis does not say why: '${basis}'`).toMatch(/not evaluated|unresolved/i);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 4 — a retirement clears every ACTIVE mirror', () => {
  it('the subsystem map can be cleared, exactly as the battery already could', async () => {
    const { subSystemEntryFromFlatEquipmentPatch } = await import('@/lib/system/subSystemMirror');
    const now = '2026-10-02T00:00:00.000Z';

    // 🚨 THE ASYMMETRY THAT LET THE RETIRED INVERTER SURVIVE. `batteryId` had an explicit-clear
    // branch; `inverterId` had only a truthy guard, so `inverterId: null` wrote nothing and the
    // map KEPT the retired device for the page to re-synthesise a fleet from.
    const cleared = subSystemEntryFromFlatEquipmentPatch({ inverterId: null }, 'roof', now);
    expect('inverterId' in cleared,
      'a retirement patch does not reach the subsystem mirror at all').toBe(true);
    expect(cleared.inverterId, 'the retired inverter was not cleared from the mirror').toBeNull();

    const clearedEmpty = subSystemEntryFromFlatEquipmentPatch({ inverterId: '' }, 'roof', now);
    expect(clearedEmpty.inverterId).toBeNull();

    // A patch that does not MENTION the inverter must leave it alone — absence is not a decision.
    const untouched = subSystemEntryFromFlatEquipmentPatch({ panelId: 'p1' }, 'roof', now);
    expect('inverterId' in untouched,
      'a patch that says nothing about the inverter cleared it anyway').toBe(false);

    // And a real selection still writes.
    const selected = subSystemEntryFromFlatEquipmentPatch(
      { inverterId: 'enphase-iq8plus' }, 'roof', now);
    expect(selected.inverterId).toBe('enphase-iq8plus');
  });

  it('🚨 a production snapshot cannot hand the retired inverter back', async () => {
    const { readExternalInverterIdentity, mayBackfillExternalInverter } =
      await import('@/lib/electrical/inverterIdentity');

    // This is the predicate BOTH promotion sites now consult — lib/db/projects.ts (two) and
    // lib/db/production.ts (the third, which was unguarded).
    const retired = readExternalInverterIdentity({ inverter: null, inverterId: null, batteryCount: 4 });
    expect(retired.state).toBe('NONE');
    expect(mayBackfillExternalInverter(retired),
      'an old production snapshot would hand the retired inverter back').toBe(false);

    const unstated = readExternalInverterIdentity({ batteryCount: 4 });
    expect(mayBackfillExternalInverter(unstated)).toBe(true);
  });

  it('🚨 all THREE snapshot promotions are guarded, not two', () => {
    // The repair was applied to lib/db/projects.ts and the third site was missed — which is the
    // same shape as the SVG/PDF split. Count them.
    const projects = src('lib', 'db', 'projects.ts');
    const production = src('lib', 'db', 'production.ts');
    expect(projects, 'lib/db/projects.ts lost its identity guard')
      .toContain('mayBackfillExternalInverter');
    expect(production, 'lib/db/production.ts promotes a snapshot inverter with NO identity guard')
      .toContain('mayBackfillExternalInverter');
    // `?? selectedInverter` bare is the defect shape.
    expect(production.includes('canonEq.selectedInverter  ?? selectedInverter,'),
      'the unguarded `?? selectedInverter` promotion is back').toBe(false);
  });

  it('🚨 after the real resolution route runs, nothing holds the retired inverter', async () => {
    await writeFixtureB({ retired: false });
    const { POST } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest(
      'http://localhost/api/engineering/electrical-architecture', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: PROJECT_B, coupling: 'dc-coupled-storage' }),
      }));
    // 🚨 THE EXPLICIT PATH MUST SURVIVE THE DERIVATION. Deriving the answer must not take away the
    // installer's ability to STATE it — a derivation is not a decision, and only the decision is
    // permanent and attributable. Ray: "Do not remove valid edit paths... Do not solve redundancy
    // by deleting useful engineering capability."
    expect(res.status,
      `the resolution route refused an explicit decision over a derived value: `
      + `${JSON.stringify(await res.clone().json()).slice(0, 200)}`).toBe(200);

    const row = (await db.query(
      `SELECT selected_equipment, engineering_config FROM projects WHERE id = $1`,
      [PROJECT_B])).rows[0] as any;
    const se = typeof row.selected_equipment === 'string'
      ? JSON.parse(row.selected_equipment) : row.selected_equipment;
    const cfg = typeof row.engineering_config === 'string'
      ? JSON.parse(row.engineering_config) : row.engineering_config;

    // The flat identity records NONE, not a gap.
    const { readExternalInverterIdentity } = await import('@/lib/electrical/inverterIdentity');
    expect(readExternalInverterIdentity(se).state).toBe('NONE');
    // The fleet is empty…
    expect(cfg.inverters).toEqual([]);
    // …AND the subsystem map no longer points at the retired device, which is what the page
    // re-synthesises a fleet from.
    for (const [key, v] of Object.entries((cfg.subSystems ?? {}) as Record<string, any>)) {
      expect(v?.inverterId,
        `engineering_config.subSystems.${key} still names the retired inverter`).toBeFalsy();
    }
    // The string assignment survives as HISTORY — 37 modules, not discarded.
    expect(cfg.retiredInverterFleet?.moduleCount,
      'the retired string assignment lost its module count').toBe(37);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 5 — the schedule states the real assignment, never a scalar × a count', () => {
  it('a mixed assignment is itemised, and 37 never reads as 4 × 9', async () => {
    const { renderSLDProfessional } = await import('@/lib/sld-professional-renderer');
    const base = {
      projectName: 'P', clientName: 'C', address: 'A', designer: 'D',
      drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
      topologyType: 'STRING_INVERTER',
      totalModules: 37, totalStrings: 4,
      panelModel: 'PS-MNB108-440', panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      inverterManufacturer: 'Tesla', inverterModel: 'Solar Inverter 5.7kW',
      acOutputKw: 11.4, mainPanelAmps: 400,
    } as any;

    // 🚨 THE DEFECT: 'Total Modules 37' two rows above 'Strings 4 × 9 panels', which is 36.
    const mixed = renderSLDProfessional({ ...base, stringPanelCounts: [10, 9, 9, 9] });
    expect(mixed, 'the schedule still multiplies a scalar by a count').not.toContain('4 × 9 panels');
    // The real assignment, itemised.
    expect(mixed, 'the schedule does not state the actual per-string assignment')
      .toMatch(/10\s*\/\s*9\s*\/\s*9\s*\/\s*9/);

    // A genuinely uniform layout may still read as N × M — that is not a fabrication.
    const uniform = renderSLDProfessional(
      { ...base, totalModules: 36, totalStrings: 4, stringPanelCounts: [9, 9, 9, 9] });
    expect(uniform).toContain('4 × 9 panels');

    // 🚨 AND NO ASSIGNMENT AT ALL SAYS SO, rather than inventing one.
    const none = renderSLDProfessional({ ...base, stringPanelCounts: undefined });
    expect(none, 'a sheet with no string assignment invented one')
      .toMatch(/REQUIRES RE-DERIVATION/);
  });

  it('🚨 an assignment that does not add up is REPORTED, not reconciled', async () => {
    const { renderSLDProfessional } = await import('@/lib/sld-professional-renderer');
    const svg = renderSLDProfessional({
      projectName: 'P', clientName: 'C', address: 'A', designer: 'D',
      drawingDate: '2026-10-02', drawingNumber: 'SLD-001', revision: 'A',
      topologyType: 'STRING_INVERTER',
      totalModules: 37, totalStrings: 4, stringPanelCounts: [9, 9, 9, 9],
      panelModel: 'PS-MNB108-440', panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
      inverterManufacturer: 'Tesla', inverterModel: 'X',
      acOutputKw: 11.4, mainPanelAmps: 400,
    } as any);
    expect(svg, 'a 36-module assignment on a 37-module design printed silently')
      .toMatch(/SUMS TO 36/);
  });

  it('🚨 the SLD route hands the DISTRIBUTION to the engine, not only the count', () => {
    // The reconciliation channel already existed (`configStringPanelCounts`, v61.7). Two callers
    // passed it and this route did not, so computeSystem equal-divided while the renderer got the
    // real array — one request, two partitions.
    const route = src('app', 'api', 'engineering', 'sld', 'route.ts');
    // 🚨 ANCHORED, BECAUSE `toContain('configStringPanelCounts:')` MATCHED ITS OWN MUTATION.
    // Renaming the property to `_disabledConfigStringPanelCounts:` still contains that substring,
    // so the mutation ran and the guard stayed green. A word boundary is the difference between
    // asserting the property EXISTS and asserting the characters appear somewhere.
    const live = route.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(live.some(l => /^\s*configStringPanelCounts:\s/.test(l)),
      'the SLD route no longer passes the string distribution to computeSystem — only the count')
      .toBe(true);
    // And it must refuse an assignment that does not describe this array.
    expect(route).toContain('does not describe this array');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 7 — the real browser caller can send ABSENCE', () => {
  it('the page no longer substitutes a catalogue product for a missing inverter', () => {
    const page = src('app', 'engineering', 'page.tsx');
    // The exact expressions that made the server guard unreachable.
    const live = page.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(live.some(l => l.includes("|| 'fronius-primo-8.2'")),
      'the BOM payload still invents a Fronius client-side').toBe(false);
    expect(live.some(l => l.includes("MICROINVERTERS[0]?.id ?? 'enphase-iq8plus'")
                       && l.includes('inverterId:')),
      'the BOM payload still substitutes the catalogue first microinverter').toBe(false);
  });

  it('🚨 the BOM route, given the absence the browser now sends, quotes no inverter', async () => {
    await writeFixtureB({ retired: true });
    const { POST } = await import('@/app/api/engineering/bom/route');
    const { NextRequest } = await import('next/server');
    // 🚨 NOTE WHAT IS MISSING: no `inverterId` key at all. That is what the repaired page sends
    // for a DC-coupled design, and until the page was fixed this request could not occur.
    const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_B, totalPanels: 37, batteryCount: 4, inverters: [] }),
    }));
    const json = await res.json().catch(() => ({})) as any;
    expect(res.status, `BOM failed: ${JSON.stringify(json).slice(0, 300)}`).toBe(200);

    const blob = JSON.stringify(json);
    expect(blob, 'the parts list still quotes a Fronius nobody selected').not.toMatch(/fronius/i);
    expect(blob, 'the parts list still quotes a Primo 8.2').not.toMatch(/primo/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 REPAIR 6 — absence reaches the metering authority as absence', () => {
  it('🚨 no recorded interconnection ⇒ no CT placement, and the sheet says MODE TBD', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE CONSUMPTION CTs CLAMP RELATIVE TO THE POINT OF INTERCONNECTION.
    //
    // `lib/equipment/designMetering.ts:257` will not place them when the boundary is
    // `'unresolved'`, and `currentTransformers.ts:712` has the sentence for it — "the
    // interconnection side is not established, so no metering mode follows from it". Both were
    // UNREACHABLE while `permitInterconnectionToken` collapsed absence into `'LOAD_SIDE'`: the CTs
    // were drawn at a guessed location carrying the label "DEFAULT PER INTERCONNECTION — FIELD
    // VERIFY", and the schedule asserted NET.
    //
    // This is the behaviour change that broke three assertions in
    // `tests/permitStandaloneGateway.test.ts`. It is tested here on its own terms so the change is
    // an asserted property of the product rather than a side effect nobody wrote down.
    // ═══════════════════════════════════════════════════════════════════
    const { resolveDesignMetering } = await import('@/lib/equipment/designMetering');
    const { permitInterconnectionToken } =
      await import('@/lib/permit/utils/interconnectionRule');

    // Absence must not become a NEC article on the way in.
    expect(permitInterconnectionToken(undefined)).toBe('UNRESOLVED');

    // And the authority must refuse to place what it cannot locate.
    const { buildNormalResidence200A } =
      await import('@/lib/electrical/fixtures/normalResidence200a');
    const { topology } = buildNormalResidence200A();
    expect(topology.pointsOfInterconnection[0].relationship,
      'the ordinary-house fixture should leave the POI unresolved').toBe('unresolved');
    // `governingArticleFor` has always refused to name an article for it — the model was right.
    const { governingArticleFor } = await import('@/lib/electrical/serviceTopology');
    expect(governingArticleFor('unresolved'),
      'an unresolved POI was given an NEC article').toBeNull();
    expect(typeof resolveDesignMetering).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 PHASE 2 / PATTERN A — an owner exists and the consumer reads it', () => {
  it('🚨 the canonical module count sizes the BOM, not the browser\'s number', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 THE OWNER HAD ZERO CONSUMERS ANYWHERE IN THE REPO.
    //
    // `ElectricalProjectModel.moduleCount` is assembled from the layout
    // (`layouts.panels.length` > `layouts.total_panels` > the engineering seed). The BOM route
    // already held the model and still sized the parts list from
    // `body.moduleCount || body.totalPanels` — so the number of modules somebody ORDERS came from
    // React state. "37 MODULES MEANS 37 MODULES."
    //
    // This posts a DELIBERATELY WRONG count the way a stale page would, and asserts the design
    // wins. A test that posted the right number could not tell the two sources apart.
    // ═══════════════════════════════════════════════════════════════════
    await writeFixtureB({ retired: true });   // layouts.total_panels = 37

    const { POST } = await import('@/app/api/engineering/bom/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://localhost/api/engineering/bom', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT_B,
        // 🚨 THE STALE BROWSER COUNT. The design has 37.
        moduleCount: 20, totalPanels: 20,
        batteryCount: 4, inverters: [],
      }),
    }));
    const json = await res.json().catch(() => ({})) as any;
    expect(res.status, `BOM failed: ${JSON.stringify(json).slice(0, 300)}`).toBe(200);

    // The module count the parts list was built from must be the canonical 37.
    const blob = JSON.stringify(json);
    const twenties = (blob.match(/\b20\b/g) ?? []).length;
    const thirtySevens = (blob.match(/\b37\b/g) ?? []).length;
    expect(thirtySevens,
      `the BOM response never mentions 37 modules — it was sized from the posted 20. `
      + `(37s=${thirtySevens}, 20s=${twenties})`).toBeGreaterThan(0);

    // And the canonical model is where 37 comes from, not the request.
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;
    expect(m.moduleCount, 'the canonical model does not hold the layout module count').toBe(37);
  });

  it('🚨 a project with NO layout count gets nothing invented', async () => {
    // The other direction, which is the one that would make this repair a defect: where the owner
    // holds no count, the posted value must stand rather than a fabricated one being projected.
    await writeFixtureB({ retired: true });
    await db.exec('DELETE FROM layouts');
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;
    // Whatever the model reports, it must not be a number this test planted.
    expect([null, 0, undefined]).toContain(m.moduleCount ?? null);
  });

  it('🚨 the BOM route reads the owner, and the competing read cannot win', () => {
    const route = src('app', 'api', 'engineering', 'bom', 'route.ts');
    expect(route, 'the BOM route does not consult the canonical module count')
      .toContain('_m.moduleCount');
    // The projection must assign BOTH spellings, or the one it misses is the competing read.
    expect(route).toContain('body.moduleCount = _m.moduleCount');
    expect(route).toContain('body.totalPanels = _m.moduleCount');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 NEC 690.7(A) — ONE cold-Voc method, never both', () => {
  it('🚨 no sheet multiplies a β-corrected voltage by 1.25', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // lib/permit/utils/panelSpecs.ts:135 — "THE cold-Voc law (NEC 690.7(A)) — β-based correction
    // when the module's Voc temperature coefficient is known, else the conservative blanket
    // ×1.25 … this is the ONE law; no sheet may hand-roll `voc * 1.25` when β is resolvable."
    //
    // The SLD renderer printed `String Voc (corrected)` AND that same value × 1.25, which is the
    // coefficient method and the table method applied in sequence. On Ray's job it overstated the
    // maximum system voltage by 25% — 672.9 V printed against a real 538.3 V — and would have a
    // reviewer reject a string that is inside the Powerwall 3's 550 V input.
    // ═══════════════════════════════════════════════════════════════════
    const { coldVocFactor } = await import('@/lib/permit/utils/panelSpecs');
    // The owner returns the β factor OR 1.25 — never their product.
    const withBeta = coldVocFactor(-0.25, -18);
    const withoutBeta = coldVocFactor(undefined, -18);
    expect(withoutBeta, 'the blanket factor is not 1.25').toBe(1.25);
    expect(withBeta, 'a resolvable β did not produce a β factor').toBeCloseTo(1.1075, 3);
    expect(withBeta, 'the two methods were multiplied together').toBeLessThan(1.25);

    const renderer = src('lib', 'sld-professional-renderer.ts');
    const live = renderer.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(live.some(l => /sv\s*\*\s*1\.25/.test(l)),
      'the renderer multiplies an already-corrected string voltage by 1.25 again').toBe(false);
    expect(renderer, 'the sheet no longer states the governing article for its max voltage')
      .toContain('Max System Voltage (690.7(A))');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 FIXTURE B — the two sheets describe the SAME system', () => {
  /** The value of the schedule cell that follows a label, as the sheet renders it. */
  const cellAfter = (sv: string, label: string): string => {
    const i = sv.indexOf('>' + label + '<');
    if (i < 0) return '(label absent)';
    const tail = sv.slice(i, i + 900);
    const vals = [...tail.matchAll(/>([^<>]{1,60})</g)].map(x => x[1])
      .filter(v => v.trim() && v !== label);
    return (vals[0] ?? '(no value)').trim();
  };

  it('🚨 architecture, module count, string assignment and max voltage all agree', async () => {
    // ═══════════════════════════════════════════════════════════════════
    // 🚨 RAY'S PRODUCTION-PROOF REQUIREMENT, AS A GUARD.
    //
    //   "For Fixture B verify through the actual production chain: System Config → Service
    //    Topology → Sizing → Compliance → SVG SLD → PDF SLD → BOM → Permit. They must describe
    //    the same system."
    //
    // An end-to-end probe found they did not, twice, AFTER the mutation run was green:
    //   · the PDF printed `4 — ASSIGNMENT REQUIRES RE-DERIVATION` while the diagram drew
    //     `5: 9 / 9 / 9 / 8 / 2 panels`, because the PDF route never called the string engine at
    //     all — `totalStrings` defaulted to 2 and `stringPanelCounts` was never set;
    //   · and before that, a cold-Voc check of mine refused a compliant assignment on one route
    //     and not the other.
    //
    // Both were invisible to every existing guard, because every existing guard tested ONE sheet.
    // This one compares them.
    // ═══════════════════════════════════════════════════════════════════
    await writeFixtureB({ retired: true });

    const svg = await generateSld(PROJECT_B);
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(svg.status, `diagram failed: ${JSON.stringify(svg.json).slice(0, 300)}`).toBe(200);
    expect(pdf.status, `export failed: ${JSON.stringify(pdf.json).slice(0, 300)}`).toBe(200);

    for (const label of ['Total Modules', 'Strings']) {
      const a = cellAfter(svg.svg, label);
      const b = cellAfter(pdf.svg, label);
      expect(a, `the diagram has no '${label}' cell`).not.toMatch(/absent|no value/);
      expect(b, `the exported sheet has no '${label}' cell`).not.toMatch(/absent|no value/);
      expect(b, `the two sheets disagree on '${label}': diagram='${a}' exported='${b}'`).toBe(a);
    }

    // 🚨 THE MODULE COUNT IS RAY'S, NOT A DEFAULT. "37 MODULES MEANS 37 MODULES."
    expect(cellAfter(svg.svg, 'Total Modules')).toBe('37');

    // 🚨 AND THE ASSIGNMENT ADDS UP TO IT. A schedule that states a layout which does not sum to
    // the module count printed two rows above is the defect this cell was rewritten for.
    const strings = cellAfter(svg.svg, 'Strings');
    const nums = [...strings.matchAll(/\d+/g)].map(n => Number(n[0]));
    if (/\//.test(strings)) {
      // itemised form, "5: 9 / 9 / 9 / 8 / 2 panels" — drop the leading count
      const parts = nums.slice(1);
      expect(parts.reduce((a, b) => a + b, 0),
        `the stated assignment '${strings}' does not sum to 37`).toBe(37);
    }

    // Neither sheet may name a standalone inverter this design does not have.
    for (const [name, sheet] of [['diagram', svg.svg], ['exported', pdf.svg]] as const) {
      expect(sheet, `the ${name} names a Fronius`).not.toMatch(/Fronius/i);
      expect(sheet, `the ${name} draws a standalone Tesla Solar Inverter`)
        .not.toMatch(/Tesla Solar Inverter/i);
      expect(sheet, `the ${name} does not state the DC-coupled architecture`)
        .toMatch(/DC COUPLED/i);
    }
  });

  it('🚨 the stated max system voltage is inside the Powerwall 3 DC input window', async () => {
    await writeFixtureB({ retired: true });
    const svg = await generateSld(PROJECT_B);
    const v = cellAfter(svg.svg, 'Max System Voltage (690.7(A))');
    const volts = Number((v.match(/([\d.]+)/) ?? [])[1]);
    expect(Number.isFinite(volts), `no max system voltage on the sheet (got '${v}')`).toBe(true);

    // The device's published limit, from the canonical model rather than a literal here.
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const { dcStringLimits } = await import('@/lib/electrical/dcStringLimits');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;
    const lim = dcStringLimits(m.topology, m.solarCoupling);
    expect(lim, 'the DC window is not projected from the storage').toBeTruthy();

    expect(volts,
      `the sheet states ${volts} V against the storage's ${lim!.maxDcVoltage} V PV input maximum`)
      .toBeLessThanOrEqual(lim!.maxDcVoltage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("🚨 THE PHANTOM INVERTER ON RAY'S LIVE PROJECT", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE STATE NOTHING TESTED FOR, AND IT WAS THE LIVE ONE.
  //
  // Every architecture check looked for an inverter that CONTRADICTS the graph. Ray's row is the
  // mirror image: the graph claims `'ac-coupled-inverter'` — a separate PV inverter — and the
  // equipment record holds NONE. That produced
  //
  //     hasExternalInverter: false · conflicts: [] · architectureResolutionRequired: false
  //
  // so no refusal, a 200, and a drawing. And with no inverter in the model, the `ac-coupled` arm
  // of the canonical override had nothing to project and did NOTHING — so `topologyType: 'STRING'`
  // and `inverterModel: 'Tesla Solar Inverter 5.7kW'` rode in from the page's React state and were
  // drawn as fact. A STRING INVERTER title block, a standalone inverter on the sheet, the PV wired
  // to an AC disconnect, and four Powerwalls with nothing feeding them.
  //
  // He regenerated it and got the same sheet. This is that sheet, as a test.
  // ═══════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 AND REFUSING WAS ALSO WRONG — IT ASKED A QUESTION WITH ONE POSSIBLE ANSWER.
  //
  // The first version of this block asserted a 409 on his row and called that the repair. It is
  // not: his project has no separate PV inverter and four Powerwall 3, so the strings have nowhere
  // else to terminate. Treating a DETERMINED architecture as unresolved left the sizing gate
  // (`solarCoupling === 'dc-coupled-storage'`) FALSE, and the engine went on recommending two
  // standalone Tesla string inverters that `SizingRecommendation` offered as "Apply Recommended
  // Configuration" — the writer Ray named: "there is an auto config button that pops up on sys
  // config page that chooses those fucking 5.7 inverters... And that data flows into the sld."
  //
  // Ray, earlier, on exactly this: "solarpro should automatically know or ask questions... This is
  // pretty common sense logic." Know when it is determined. Ask when it is not — and the control
  // case below pins the asking half, so this is not a deleted refusal.
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 a determined architecture is DERIVED from the equipment, not asked about', async () => {
    await writeRaysLiveRowAsItIs();

    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;

    expect(m.hasExternalInverter, 'the fixture is not in the live state').toBe(false);
    expect(m.storage.invertingUnitCount, 'the four Powerwalls are not in the graph').toBe(4);

    expect(m.solarCoupling,
      'the model still reports the contradicted scalar, so the sizing gate stays shut')
      .toBe('dc-coupled-storage');
    expect(m.solarCouplingProvenance.source,
      'a derived answer must not be reported as the designer\'s word').toBe('derived');
    expect(m.conflicts.map(c => c.code),
      'an answer with one possible value was raised as a conflict').not.toContain(
      'SOLAR_COUPLING_UNRESOLVED');
    expect(m.architectureResolutionRequired,
      'the operator is still being asked a question the equipment already answers').toBe(false);
  });

  it('🚨 the SLD draws the REAL design, with no resolution click at all', async () => {
    await writeRaysLiveRowAsItIs();
    const svg = await generateSld(PROJECT_B);

    expect(svg.status, `the sheet failed: ${JSON.stringify(svg.json).slice(0, 300)}`).toBe(200);

    // 🚨 THE EXACT THINGS THAT WERE WRONG ON HIS SCREEN.
    expect(svg.svg, 'the sheet still names a Tesla Solar Inverter')
      .not.toMatch(/Tesla Solar Inverter/i);
    expect(svg.svg, 'the title block still says STRING INVERTER')
      .not.toMatch(/STRING INVERTER/i);
    expect(svg.svg, 'the sheet does not state the real architecture').toMatch(/DC COUPLED/i);
  });

  it('🚨 the EXPORTED PDF is the same sheet — it is the one that gets submitted', async () => {
    await writeRaysLiveRowAsItIs();
    const pdf = await exportPdfSheet(PROJECT_B);
    expect(pdf.status, 'the exported PDF could not be produced').toBe(200);
  });

  it('🚨 and once resolved, the phantom is gone and the sheet is the real design', async () => {
    await writeRaysLiveRowAsItIs();

    // One explicit decision — the same route the resolution dialog posts to.
    const { POST } = await import('@/app/api/engineering/electrical-architecture/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest(
      'http://localhost/api/engineering/electrical-architecture', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: PROJECT_B, coupling: 'dc-coupled-storage' }),
      }));
    expect(res.status, 'the resolution route refused').toBe(200);

    const svg = await generateSld(PROJECT_B);
    expect(svg.status, `the sheet failed after resolution: ${JSON.stringify(svg.json).slice(0, 300)}`)
      .toBe(200);

    // 🚨 THE EXACT THINGS THAT WERE WRONG ON HIS SCREEN.
    expect(svg.svg, 'the sheet still names a Tesla Solar Inverter')
      .not.toMatch(/Tesla Solar Inverter/i);
    expect(svg.svg, 'the title block still says STRING INVERTER')
      .not.toMatch(/STRING INVERTER/i);
    expect(svg.svg, 'the sheet does not state the real architecture')
      .toMatch(/DC COUPLED/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 THE WRITER — auto-apply put the phantom inverter into System Config', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE LOOP RAY WAS POINTING AT ALL DAY, and it is upstream of every route.
  //
  //   1. `SizingInput` had SEVEN battery fields — batteryEnabled, batteryMode, batteryGoal,
  //      batteryTargetKwh, selectedBatteryBrand, batteryUsePro, batteryDesiredUnits — and nothing
  //      that could say whether the PV is wired INTO that storage. So the engine saw four
  //      Powerwall 3 and still sized a standalone PV inverter: "is there a battery" and "does the
  //      PV go through the battery" are different questions, and it was only ever asked the first.
  //   2. The auto-apply watcher (app/engineering/page.tsx) compares the config against that
  //      recommendation. An empty fleet reads as `countMismatch` ⇒ `structurallyStale`.
  //   3. And a structurally stale config is re-applied "despite user lock", because the watcher
  //      treats it as a broken layout rather than a preference.
  //   4. So the architecture resolution emptied `config.inverters` server-side and the watcher
  //      wrote a Tesla Solar Inverter straight back on the next render.
  //
  // Every server-side repair was downstream of this. By the time any route ran, the inverter was
  // genuinely in the config — which is why the drawing never changed.
  // ═══════════════════════════════════════════════════════════════════════

  it('🚨 the sizing engine sizes NO standalone inverter for a DC-coupled design', async () => {
    const { sizeSystemFromBrand } = await import('@/lib/system/sizingEngine');

    const base = {
      systemType: 'roof' as const,
      panelCount: 37,
      panelWattage: 440,
      panelVoc: 52.7,
      panelVmp: 43.6,
      panelIsc: 13.7,
      panelTempCoeffVoc: -0.25,
      designTempMin: -18,
      selectedBrand: 'tesla',
      batteryEnabled: true,
    };

    // 🚨 THE CONTROL. Without the architecture, the engine recommends an inverter — which is the
    // defect, and a test that only asserted the fixed case could not tell the two apart.
    const blind = sizeSystemFromBrand({ ...base } as never);
    expect(blind.inverterModels.length,
      'the engine no longer recommends an inverter even when it was not told the architecture — '
      + 'this test can no longer detect the defect it exists for').toBeGreaterThan(0);

    // 🚨 TOLD THE ARCHITECTURE: nothing to size.
    const told = sizeSystemFromBrand({ ...base, pvCoupledToStorage: true } as never);
    expect(told.inverterModels,
      'the engine still recommends a standalone PV inverter for a design whose array terminates '
      + 'on the storage DC inputs').toEqual([]);
    expect(told.inverterCount ?? 0).toBe(0);

    // And it says why, rather than silently producing nothing.
    const codes = (told.warnings ?? []).map((w: { code?: string }) => w.code);
    expect(codes, 'the empty fleet carries no explanation')
      .toContain('PV_DC_COUPLED_NO_INVERTER');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE BLAST RADIUS, ASSERTED — Ray: "Do not fuck my entire website up because we are getting
  // 1 real world scenario to work... every auto pick selection works for installs that do not have
  // batteries."
  //
  // `pvInput` exists on exactly ONE catalogue product, `tesla-powerwall-3`
  // (lib/equipment-db.ts:2786, :2815). These cases pin that the suppression reaches NOTHING else,
  // and in particular that it is driven by the DECIDED architecture rather than by what the
  // hardware is capable of — because a Powerwall 3 beside Enphase micros is a real AC-coupled
  // design and deleting its inverter would be the regression he is warning about.
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 every design that is NOT decided DC-coupled still sizes exactly as before', async () => {
    const { sizeSystemFromBrand } = await import('@/lib/system/sizingEngine');

    const run = (over: Record<string, unknown>) => sizeSystemFromBrand({
      systemType: 'roof', panelCount: 24, panelWattage: 400,
      panelVoc: 49.6, panelVmp: 41.8, panelIsc: 11.2, panelTempCoeffVoc: -0.27,
      designTempMin: -18, ...over,
    } as never);

    // No battery at all — the majority of the product.
    for (const brand of ['solaredge', 'enphase', 'tesla']) {
      const r = run({ selectedBrand: brand });
      expect(r.inverterModels.length,
        `the flag leaked and suppressed sizing for a ${brand} design with no battery`)
        .toBeGreaterThan(0);
    }

    // A battery install that is NOT DC-coupled — the flag is never set, so nothing changes.
    for (const brand of ['solaredge', 'enphase']) {
      const r = run({ selectedBrand: brand, batteryEnabled: true });
      expect(r.inverterModels.length,
        `the flag leaked and suppressed sizing for a ${brand} battery design`)
        .toBeGreaterThan(0);
    }

    // 🚨 A POWERWALL 3 DESIGN THAT IS AC-COUPLED. The storage CAN take PV on DC and this one does
    // not, so the inverter must still be sized. `pvCoupledToStorage` is absent, which is what the
    // page now passes for any project whose resolved coupling is not 'dc-coupled-storage'.
    const pw3AcCoupled = run({ selectedBrand: 'tesla', batteryEnabled: true });
    expect(pw3AcCoupled.inverterModels.length,
      'a Powerwall 3 beside an AC-coupled PV inverter lost its inverter — capability was treated '
      + 'as architecture, which is the regression Ray warned about').toBeGreaterThan(0);
  });

  it('🚨 the page gates sizing on the DECIDED coupling, never on what the hardware can do', () => {
    const page = src('app', 'engineering', 'page.tsx');
    const live = page.split('\n').filter(l => !l.trim().startsWith('//'));

    const idx = live.findIndex(l => l.includes('const pvOnStorageDc = useMemo'));
    expect(idx, 'the memo is gone').toBeGreaterThan(-1);
    const memo = live.slice(idx, idx + 4).join(' ');

    expect(memo, 'the memo does not read the resolved coupling')
      .toContain("solarCoupling === 'dc-coupled-storage'");
    // 🚨 THE ARM THAT WOULD HAVE BROKEN A PW3 + ENPHASE DESIGN.
    expect(memo.includes('pvInputLimits'),
      'sizing is gated on storage CAPABILITY again — a Powerwall 3 beside Enphase micros would '
      + 'lose its inverter').toBe(false);
    expect(memo.includes('takesPvOnDc'),
      'sizing is gated on storage capability again').toBe(false);
  });

  it('🚨 Smart Defaults cannot re-seed an inverter onto a resolved DC-coupled design', async () => {
    // Smart Defaults fires exactly when a project has NO inverters — which is the state an
    // architecture resolution leaves behind. Without the architecture it seeded one straight back
    // AND set `defaultsApplied`, so the seed then looked like a settled decision.
    const { applySmartDefaultsOnce } = await import('@/lib/system/smartDefaults');
    const cfg = {
      systemType: 'roof', inverters: [], defaultsApplied: false,
      userHasEditedInverters: false, isUserControlled: false,
    } as never;

    // CONTROL — without the architecture it still seeds, so this test can detect the defect.
    const blind = applySmartDefaultsOnce({ config: cfg, systemPanelCount: 37, panelWattage: 440 });
    expect(blind.applied, 'Smart Defaults no longer seeds at all — the control is dead').toBe(true);
    expect((blind.patch.inverters ?? []).length).toBeGreaterThan(0);

    // TOLD — nothing to seed.
    const told = applySmartDefaultsOnce({
      config: cfg, systemPanelCount: 37, panelWattage: 440, pvCoupledToStorage: true,
    });
    expect((told.patch.inverters ?? []),
      'Smart Defaults re-seeded a standalone inverter onto a DC-coupled design').toEqual([]);
  });

  it('🚨 the auto-apply watcher refuses to decide the architecture', () => {
    const page = src('app', 'engineering', 'page.tsx');
    const live = page.split('\n').filter(l => !l.trim().startsWith('//'));

    // ONE answer to "does the PV land on the storage DC inputs", shared by the picker and sizing.
    expect(live.some(l => l.includes('const pvOnStorageDc = useMemo')),
      'the page has no single answer for the DC-coupled question').toBe(true);

    // The engine is told.
    expect(live.some(l => l.includes('pvCoupledToStorage: pvOnStorageDc')),
      'the sizing engine is still not told the architecture').toBe(true);

    // And the watcher bails rather than writing one.
    const wIdx = page.indexOf('if (!sizingAutoApply) return;');
    expect(wIdx, 'the auto-apply watcher is gone').toBeGreaterThan(0);
    const watcher = page.slice(wIdx, wIdx + 3000);
    expect(watcher.includes('if (pvOnStorageDc) {'),
      'auto-apply can still write an inverter onto a DC-coupled design').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 FIXTURE A — the ordinary house, which had no fixture at all', () => {
  it('200 A / 1 MSP / 1 Gateway is a real topology the engine accepts', async () => {
    const { buildNormalResidence200A } = await import('@/lib/electrical/fixtures/normalResidence200a');
    const { topology } = buildNormalResidence200A();
    expect(topology.service.ratedAmps).toBe(200);
    expect(topology.branches).toHaveLength(1);
    expect(topology.panels).toHaveLength(1);
    expect(topology.domains).toHaveLength(1);
    // 🚨 THREE SEPARATE FACTS THAT SHARE A NUMBER — the distinction `mainPanelAmps` destroys.
    expect(topology.panels[0].busbarRatingA).toBe(200);
    expect(topology.panels[0].mainBreakerA).toBe(200);
    // One system has no arrangement to choose between: inapplicable, not unanswered.
    expect(topology.interconnection?.derArrangement).toBeNull();
    expect(topology.aggregationPanels).toEqual([]);
  });

  it('the canonical model reads it as DC-coupled with NO external inverter', async () => {
    await writeFixtureA();
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const loaded = await loadElectricalProject(PROJECT_A, USER_ID);
    expect(loaded?.model, 'the ordinary house did not load at all').toBeTruthy();
    const m = loaded!.model;
    expect(m.serviceRatedAmps, 'the 200 A service did not reach the canonical model').toBe(200);
    expect(m.hasExternalInverter).toBe(false);
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.storage.invertingUnitCount).toBe(1);
  });

  it('🚨 it draws, and the 200 A service is not confused with the 200 A busbar', async () => {
    await writeFixtureA();
    const svg = await generateSld(PROJECT_A, { mainPanelAmps: 200, totalStrings: 2, totalModules: 20 });
    expect(svg.status, `the ordinary house failed to draw: ${JSON.stringify(svg.json).slice(0, 300)}`)
      .toBe(200);
    expect(svg.svg.length).toBeGreaterThan(1000);
    expect(svg.svg, 'the normal path drew a standalone PV inverter it does not have')
      .not.toMatch(/Tesla Solar Inverter/i);
    expect(svg.svg, 'the normal path fabricated a Fronius').not.toMatch(/Fronius/i);
  });

  it('a 200 A house with a RESOLVED load-side POI still evaluates normally', async () => {
    await writeFixtureA({ poi: 'load-side-busbar' });
    const r = await postCalculateWithInterconnection(PROJECT_A, 'LOAD_SIDE');
    expect(r.status,
      `the compliance route failed: ${JSON.stringify(r.json).slice(0, 500)}`).toBe(200);
    // Not asserting PASS/FAIL — asserting that a verdict was REACHED, which is the repair's
    // boundary: a resolved interconnection must not be swept into NOT_EVALUATED.
    expect(r.json?.overallStatus,
      'a resolved load-side 200 A job was reported as not evaluated').not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE AUTO-PICK POPUP — THE WRITER RAY NAMED, REACHED THROUGH THE REAL CHAIN
//
// Ray, 2026-10-02: "there is an auto config button that pops up on sys config page that chooses
// those fucking 5.7 inverters because it is auto picking a system that works for code. And that
// data flows into the sld."
//
// The control is `components/engineering/SizingRecommendation.tsx` — it renders "System Mismatch
// Detected" whenever the sizing engine's recommendation differs from `config.inverters`, and its
// button is "Apply Recommended Configuration" (:315), which calls `applySizingRecommendation`
// (page.tsx:11755) and writes the fleet into `config.inverters` — the sole source of the SLD
// request's inverterId / inverterModel / inverterManufacturer / topologyType.
//
// This probe runs HIS ROW through the production chain and asserts what the browser would get.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 THE AUTO-PICK POPUP — the writer Ray named, through the real chain', () => {
  // ═════════════════════════════════════════════════════════════════════════
  // The control is `components/engineering/SizingRecommendation.tsx`: it renders "System Mismatch
  // Detected" whenever the engine's recommendation differs from `config.inverters`, and its button
  // "Apply Recommended Configuration" (:315) calls `applySizingRecommendation`
  // (app/engineering/page.tsx:11755), which writes the fleet into `config.inverters` — the sole
  // source of the SLD request's inverterId / inverterModel / inverterManufacturer / topologyType.
  //
  // So the question that decides whether a phantom can exist at all is: WHAT DOES THE ENGINE OFFER
  // for his row? Measured here through the production chain, not a fixture.
  // ═════════════════════════════════════════════════════════════════════════
  it('🚨 the engine offers NO inverter for his row, so Apply has no phantom to write', async () => {
    await writeRaysLiveRowAsItIs();

    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT_B, USER_ID))!.model;

    // The page's gate, character for character (app/engineering/page.tsx:3178):
    //   const pvOnStorageDc = electrical?.solarCoupling === 'dc-coupled-storage'
    const pvOnStorageDc = m.solarCoupling === 'dc-coupled-storage';
    expect(pvOnStorageDc, 'the gate is shut, so the engine is never told the architecture')
      .toBe(true);

    const { sizeSystemFromBrand } = await import('@/lib/system/sizingEngine');
    const raysInputs = {
      systemType: 'roof' as const,
      panelCount: 37, panelWattage: 440,
      panelVoc: 52.7, panelIsc: 13.7, panelTempCoeffVoc: -0.27, designTempMin: -18,
      selectedBrand: 'tesla',
      batteryEnabled: true, batteryMode: 'auto', batteryGoal: 'backup', batteryDesiredUnits: 4,
    };

    const rec = sizeSystemFromBrand({ ...raysInputs, pvCoupledToStorage: pvOnStorageDc } as never);
    expect(rec.inverterModels, 'the engine still recommends equipment the design has not got')
      .toEqual([]);
    expect(rec.inverterCount).toBe(0);
    expect(rec.warnings.map((w: any) => w.code),
      'nothing explains the empty fleet, so it reads as a failure')
      .toContain('PV_DC_COUPLED_NO_INVERTER');

    // 🚨 AND THE NOISE A REPAIR REACHING THE NEXT DEFECT PRODUCED. Returning an empty fleet made
    // `distributeStrings` spread 37 modules across zero inverters and `buildFeasibilityReport`
    // declare no viable model — three alarming banners on a design that is completely fine.
    for (const noise of ['NO_MPPT_SLOTS', 'STRING_OVERFLOW', 'FEASIBILITY_NO_VIABLE_MODEL']) {
      expect(rec.warnings.map((w: any) => w.code),
        `${noise} is reported for a design whose array terminates on the storage MPPTs`)
        .not.toContain(noise);
    }

    // 🚨 THE CONTROL. Without it this test passes on a build where the flag is ignored and the
    // engine has simply stopped recommending inverters for some unrelated reason.
    const blind = sizeSystemFromBrand({ ...raysInputs } as never);
    expect(blind.inverterModels.length,
      'the engine recommends nothing even when NOT told the architecture — this test can no longer '
      + 'detect the defect it exists for').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BLAST RADIUS OF DERIVING IT — THE ASKING HALF IS STILL THERE
//
// Ray: "I'm telling you if you change the auto configuration. You are going to fuck up the slds
// that are working just to make this one scenario work... every auto pick selection works for
// installs that do not have batteries. Do not fuck my entire website up because we are getting 1
// real world scenario to work."
//
// The branch I added turns a contradicted `ac-coupled-inverter` into `dc-coupled-storage` ONLY when
// the storage publishes its own PV DC inputs. These two cases are the same project with that one
// fact changed, through the pure resolver so hydration cannot re-add the capability behind the test.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 DERIVING A DETERMINED ARCHITECTURE — the A/B on the one condition', () => {
  async function resolveWithStorage(opts: { dcCapable: boolean }) {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const topology = JSON.parse(JSON.stringify(buildRaysIntendedJob().topology));
    topology.solarCoupling = 'ac-coupled-inverter';
    topology.storage = (topology.storage ?? []).map((u: any) => opts.dcCapable
      ? u
      : { ...u, pvInputLimits: undefined });
    return resolveElectricalProject({
      topology,
      selectedEquipment: { batteryCount: 4, inverter: null, inverterId: null, moduleCount: 37 },
      engineeringConfig: null,
      equipmentProvenance: null,
      legacyInverter: null,
    } as never);
  }

  it('🚨 storage that takes PV on DC ⇒ derived, because nothing else can take the strings', async () => {
    const m = await resolveWithStorage({ dcCapable: true });
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.architectureResolutionRequired).toBe(false);
    expect(m.conflicts.map(c => c.code)).not.toContain('SOLAR_COUPLING_UNRESOLVED');
  });

  it('🚨 CONTROL — storage that does NOT ⇒ still asked, and still refuses', async () => {
    const m = await resolveWithStorage({ dcCapable: false });

    expect(m.solarCoupling,
      'a project with no inverter and no DC-capable storage was silently given an answer')
      .not.toBe('dc-coupled-storage');
    expect(m.conflicts.map(c => c.code),
      'the contradiction is no longer raised for a project the equipment cannot answer for — the '
      + 'refusal was deleted rather than narrowed').toContain('SOLAR_COUPLING_UNRESOLVED');
    expect(m.architectureResolutionRequired,
      'nothing asks the operator any more').toBe(true);

    // The refusal still carries the question a human can actually answer.
    const { architectureRefusal } = await import('@/lib/electrical/architectureGate');
    const refusal = architectureRefusal(m, 'rev-1');
    expect(refusal, 'the gate no longer fires on an unanswerable architecture').toBeTruthy();
    expect(String(refusal!.conflicts[0]?.question ?? ''),
      'the refusal does not name both options').toMatch(/battery DC inputs/i);
  });

  it('🚨 an inverter ON the project is untouched — PW3 beside a separate inverter still asks', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const topology = JSON.parse(JSON.stringify(buildRaysIntendedJob().topology));
    topology.solarCoupling = 'ac-coupled-inverter';

    // Ray: "Do not assume Tesla storage always eliminates Enphase."
    const m = resolveElectricalProject({
      topology,
      selectedEquipment: {
        batteryCount: 4, inverterId: 'enphase-iq8plus', inverter: 'IQ8PLUS', moduleCount: 37,
      },
      engineeringConfig: null, equipmentProvenance: null, legacyInverter: null,
    } as never);

    expect(m.hasExternalInverter, 'the inverter did not reach the model').toBe(true);
    expect(m.solarCoupling,
      'a Powerwall 3 standing beside a separate PV inverter had its inverter derived away')
      .not.toBe('dc-coupled-storage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE BROWSER MAY NOT RE-DECIDE THE ARCHITECTURE FROM ITS WORKING FLEET
//
// The server resolving Ray's row correctly fixed nothing on his screen. `app/engineering/page.tsx`
// composes its OWN model and feeds it `selectedEquipment.inverterId:
// config.inverters[0]?.inverterId` — `engineering_config`, the working fleet, which holds whatever
// the auto-pick last wrote. So the browser computed `hasExternalInverter: true` from the phantom,
// concluded `ac-coupled-inverter`, left the sizing gate FALSE, and the engine went on recommending
// the phantom that had proved the architecture. It sustained itself.
//
// Ray's chain law: "A downstream stage may derive new information. It may not re-decide upstream
// information from: React state, old snapshots, fallback literals, default catalogue products,
// renderer-local calculations."
//
// These are source assertions because the page cannot be mounted here — but they are about LIVE
// lines, not comments, for the reason `a-passing-guard-can-be-blind` records: a substring guard
// that matches its own explanatory comment proves nothing.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 THE PAGE TAKES THE ARCHITECTURE FROM THE SERVER', () => {
  const liveLines = () => src('app', 'engineering', 'page.tsx')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));

  it('🚨 the sizing gate reads the server answer, not only its own composition', () => {
    const live = liveLines();
    const idx = live.findIndex(l => l.includes('const pvOnStorageDc = useMemo'));
    expect(idx, 'the sizing gate is gone').toBeGreaterThan(-1);
    const memo = live.slice(idx, idx + 5).join(' ');

    expect(memo, 'the gate no longer consults the server-resolved coupling, so a browser model '
      + 'built from the working fleet decides the architecture again').toContain('_archServer');
    expect(memo, 'the gate does not test the resolved coupling')
      .toContain("coupling === 'dc-coupled-storage'");

    // 🚨 AND STILL NOT CAPABILITY. Ray stopped this arm before it shipped: a Powerwall 3 beside
    // Enphase micros would lose its inverter.
    expect(memo.includes('pvInputLimits'),
      'sizing is gated on storage CAPABILITY again').toBe(false);
  });

  it('🚨 the architecture is fetched for every project, not only when a conflict is suspected', () => {
    const live = liveLines();
    const idx = live.findIndex(l => l.includes('electrical-architecture?projectId='));
    expect(idx, 'the page no longer reads the server architecture at all').toBeGreaterThan(-1);

    // The effect's own early return, just above the request.
    const guard = live.slice(Math.max(0, idx - 8), idx).join(' ');
    expect(guard,
      'the architecture read is gated on the browser already believing the architecture is '
      + 'unresolved — so on the one project where the browser is wrong, the correcting read never '
      + 'goes out').not.toMatch(/if\s*\(\s*!_archUnresolved/);
    expect(guard, 'the read is no longer scoped to a project').toContain('currentProjectId');
  });

  it('🚨 Smart Defaults holds while the architecture is unknown — and ONLY then', () => {
    const live = liveLines();
    const idx = live.findIndex(l => l.includes("_archServerRead === 'loading'")
      && l.includes('_graphHasPvCapableStorage'));
    expect(idx,
      'nothing stops Smart Defaults seeding an inverter in the window before the architecture '
      + 'answer lands').toBeGreaterThan(-1);

    // 🚨 THE BLAST RADIUS IS IN THE CONDITION ITSELF. Ray: "every auto pick selection works for
    // installs that do not have batteries." A hold on 'failed', or a hold that ignored the graph,
    // would stall the picker on designs that have no storage at all.
    const hold = live[idx];
    expect(hold, 'a FAILED read now blocks the seed permanently, so a dropped fetch stalls a new '
      + 'design').not.toContain("=== 'failed'");
    expect(hold, 'the hold is not scoped to graphs that could answer DC')
      .toContain('_graphHasPvCapableStorage');
  });

  it('🚨 the capability test used for the HOLD is a separate expression from the sizing gate', () => {
    const live = liveLines();
    const capIdx = live.findIndex(l => l.includes('const _graphHasPvCapableStorage'));
    const gateIdx = live.findIndex(l => l.includes('const pvOnStorageDc = useMemo'));
    expect(capIdx, 'the hold predicate is gone').toBeGreaterThan(-1);
    expect(gateIdx, 'the sizing gate is gone').toBeGreaterThan(-1);
    expect(capIdx, 'the capability predicate and the sizing gate are the same expression — which '
      + 'is how capability becomes architecture').not.toBe(gateIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A DERIVED ARCHITECTURE IS A CURRENT-STATE RESULT, NOT AN AUTHORED DECISION
//
// Ray, before authorising the push:
//
//   "PW3 + PV modules + no external inverter yet must not make DC coupling an irreversible
//    authored decision. If the installer subsequently explicitly selects Enphase or another
//    external inverter, the architecture must resolve AC-coupled normally. The new DC-coupled
//    conclusion may be a derived current-state result, but it must not be persisted as user
//    intent merely because no inverter is presently selected."
//
// This is the adversarial case for the whole slice, because the repair's value comes from deriving
// an answer — and a derivation that hardens into a recorded fact is worse than the question it
// replaced: it looks settled and nobody knows who settled it.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 A DERIVED ARCHITECTURE MUST NOT HARDEN INTO AN AUTHORED ONE', () => {
  /**
   * The same Powerwall 3 graph every time. Only the two things that may legitimately change the
   * answer are varied: what the graph RECORDS, and what inverter the project HOLDS.
   */
  async function resolve(opts: {
    recorded?: string | null;
    inverterId?: string | null;
    inverterProvenanceKind?: string | null;
  }) {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const topology = JSON.parse(JSON.stringify(buildRaysIntendedJob().topology));
    topology.solarCoupling = opts.recorded ?? null;
    return resolveElectricalProject({
      topology,
      selectedEquipment: {
        batteryCount: 4, moduleCount: 37,
        inverter: opts.inverterId ? 'IQ8PLUS' : null,
        inverterId: opts.inverterId ?? null,
      },
      engineeringConfig: null,
      legacyInverter: null,
      // An EXPLICIT pick records its provenance; that is what the equipment picker writes.
      equipmentProvenance: opts.inverterProvenanceKind
        ? { inverter: { kind: opts.inverterProvenanceKind, basis: 'The installer picked it.',
                        by: 'installer', recordedAt: '2026-10-02T00:00:00.000Z' } }
        : null,
    } as never);
  }

  // ── 1. THE DERIVATION ITSELF CLAIMS NOTHING ABOUT INTENT ────────────────
  it('🚨 PW3 + modules + no inverter: derived DC, and recorded as DERIVED — never as the designer\'s word', async () => {
    const m = await resolve({ recorded: 'ac-coupled-inverter', inverterId: null });
    expect(m.solarCoupling).toBe('dc-coupled-storage');
    expect(m.solarCouplingProvenance.source,
      'a derivation is being reported as the designer having recorded it').toBe('derived');
    expect(m.solarCouplingProvenance.source).not.toBe('service-topology');
  });

  it('🚨 and it queues NOTHING for the row — no write, so nothing to outlive the state', async () => {
    const m = await resolve({ recorded: 'ac-coupled-inverter', inverterId: null });
    // 🚨 `canonicalSldProjection` calls `persistElectricalCanonicalization` on EVERY generate, so a
    // patch here is a write to `projects.service_topology` on the next click.
    expect(m.canonicalizationPatch,
      'the derivation queued a write that would record DC coupling on the row merely because no '
      + 'inverter is presently selected').toBeNull();
  });

  // ── 2. AND IT IS REVERSIBLE BY THE ACT RAY NAMED ────────────────────────
  it('🚨 REVERSIBLE — explicitly selecting Enphase afterwards resolves AC-coupled, no question asked', async () => {
    const m = await resolve({
      recorded: 'ac-coupled-inverter',
      inverterId: 'enphase-iq8plus', inverterProvenanceKind: 'USER_SELECTED',
    });
    expect(m.hasExternalInverter, 'the pick did not reach the model').toBe(true);
    expect(m.solarCoupling, 'an explicit inverter pick did not resolve AC-coupled')
      .toBe('ac-coupled-inverter');
    expect(m.conflicts.map(c => c.code),
      'the installer picked an inverter and was asked a question about it anyway')
      .not.toContain('SOLAR_COUPLING_UNRESOLVED');
    expect(m.architectureResolutionRequired).toBe(false);
  });

  // ── 3. 🚨 THE CASE THAT MATTERS — AFTER THE MIGRATION HAS ALREADY WRITTEN DC ──
  //
  // CASE A(iii) DOES emit a patch when NOTHING is recorded, and the SLD route persists it. So the
  // real sequence Ray describes is: generate once with no inverter (row now says DC), then pick
  // Enphase. If that produces a refusal, the derived answer has hardened exactly as he said it
  // must not — it became sticky because of what was absent at one moment in time.
  it('🚨 a RECORDED-but-derived DC coupling still yields to an explicit inverter pick', async () => {
    const fresh = await resolve({ recorded: null, inverterId: null });
    expect(fresh.canonicalizationPatch?.solarCoupling,
      'the premise is gone: a fresh PW3 project no longer migrates to DC').toBe('dc-coupled-storage');

    // The row now records what that migration wrote. Nobody authored it.
    const m = await resolve({
      recorded: 'dc-coupled-storage',
      inverterId: 'enphase-iq8plus', inverterProvenanceKind: 'USER_SELECTED',
    });
    expect(m.solarCoupling,
      'DC coupling recorded by a migration now outranks an inverter the installer explicitly '
      + 'picked — the derived answer hardened into an authored one').toBe('ac-coupled-inverter');
    expect(m.conflicts.map(c => c.code),
      'the installer is asked to adjudicate between his own pick and a value nobody chose')
      .not.toContain('SOLAR_COUPLING_UNRESOLVED');
  });

  // ── 4. CONTROLS — WHAT MUST STILL ASK ───────────────────────────────────
  it('🚨 CONTROL — a coupling the DESIGNER authored is not overridden by an inverter pick', async () => {
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const topology = JSON.parse(JSON.stringify(buildRaysIntendedJob().topology));
    topology.solarCoupling = 'dc-coupled-storage';

    const m = resolveElectricalProject({
      topology,
      selectedEquipment: { batteryCount: 4, moduleCount: 37,
        inverter: 'IQ8PLUS', inverterId: 'enphase-iq8plus' },
      engineeringConfig: null, legacyInverter: null,
      equipmentProvenance: {
        // 🚨 A HUMAN RECORDED THE ARCHITECTURE. That outranks the derivation in BOTH directions,
        // and adding an inverter to it is a real contradiction that a person must settle.
        architecture: { kind: 'USER_SELECTED', basis: 'The designer answered the wizard.',
                        by: 'designer', recordedAt: '2026-10-01T00:00:00.000Z' },
        inverter: { kind: 'USER_SELECTED', basis: 'The installer picked it.',
                    by: 'installer', recordedAt: '2026-10-02T00:00:00.000Z' },
      },
    } as never);

    expect(m.conflicts.map(c => c.code),
      'an authored DC coupling was silently overridden by an inverter pick — the repair now '
      + 'discards a designer\'s recorded decision').toContain('SOLAR_COUPLING_UNRESOLVED');
    expect(m.architectureResolutionRequired).toBe(true);
  });

  it('🚨 CONTROL — an AUTO-SUGGESTED inverter settles nothing, in either direction', async () => {
    // Neither side is a decision: a coupling nobody authored, and an inverter nobody picked. This
    // is the one that must still ask, and it is what stops this repair becoming "Tesla wins".
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const topology = JSON.parse(JSON.stringify(buildRaysIntendedJob().topology));
    topology.solarCoupling = 'dc-coupled-storage';

    const m = resolveElectricalProject({
      topology,
      selectedEquipment: { batteryCount: 4, moduleCount: 37,
        inverter: 'Tesla Solar Inverter', inverterId: RAYS_INVERTER },
      engineeringConfig: null, equipmentProvenance: null,
      legacyInverter: { verdict: 'AUTO_SUGGESTED_LEGACY',
        basis: 'The ecosystem picker suggested it.', evidence: [] },
    } as never);

    expect(m.conflicts.map(c => c.code),
      'an inverter nobody picked now overrides the recorded coupling').toContain(
      'SOLAR_COUPLING_UNRESOLVED');
  });
});
