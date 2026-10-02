// ═══════════════════════════════════════════════════════════════════════════
// 🚨 RAY'S LIVE SLD FAILURE, REPRODUCED AND THEN PROVEN FIXED THROUGH THE REAL ROUTE.
//
// His live sheet, on a job that is 400 A / 2x200 A systems / 2 Gateway 3 / 4 full Powerwall 3 /
// 2 generation panels / PV DC-COUPLED, showed:
//
//   1. TOPOLOGY "STRING INVERTER" and a drawn standalone "Tesla Solar Inverter 5.7kW" with an AC
//      disconnect chain running "TO MSP #1". He never selected that inverter. It appeared after he
//      changed the ecosystem to Tesla to clear a previously-displayed Enphase architecture.
//   2. No generation / combiner panels.
//   3. "50 A OCPD" on every Powerwall, after the catalogue was corrected to Tesla's published 60 A.
//
// ONE CAUSE WITH TWO FACES: a persisted instance froze the catalogue at authoring time and nothing
// ever re-resolved it.
//   · ocpdA stayed 50 — the catalogue correction could never reach an existing project.
//   · pvInputLimits was ABSENT, because the field postdates the project — and `takesPvOnDc` tests
//     exactly that field, so the model could never derive `dc-coupled-storage`, fell through to
//     "an inverter is selected ⇒ ac-coupled", and the renderer drew an AC chain. It also emitted a
//     canonicalization patch, so generating once would have RECORDED the wrong architecture.
//
// Ray: "Drive the same route/action the Generate SLD button uses. Then inspect the exact SVG/PDF
// payload returned to the UI. Do not call the renderer helper directly and declare success."
//
// So every assertion below reads the SVG that `POST /api/engineering/sld` actually returned, for a
// LEGACY graph written to a real PostgreSQL — and the request deliberately POSTS THE WRONG
// ARCHITECTURE, because the page's React state is where the wrong architecture came from.
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
const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
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
vi.mock('@/lib/auth', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  getUserFromRequest: () => ({ id: USER_ID, email: 'ray@example.com', name: 'Ray' }),
}));

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  const nc = (s: string) => s.replace(/CONCURRENTLY/gi, '');
  await db.exec(nc(read('lib', 'migrations', '001_initial_schema.sql')));
  await db.exec(nc(read('lib', 'migrations', '002_project_coordinates.sql')));
  // `writeServiceTopology` self-heals this column, but this file writes the legacy row as raw JSON
  // on purpose — the write path serialises a graph that has already been through today's authoring,
  // and the whole point is a row that never was.
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_topology JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS selected_equipment JSONB`);
  await db.exec(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS engineering_config JSONB`);
  await db.exec(`ALTER TABLE layouts ADD COLUMN IF NOT EXISTS total_panels INTEGER`);
});
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec('DELETE FROM layouts');
  await db.exec('DELETE FROM projects');
  await db.query(
    `INSERT INTO projects (id, user_id, name, status, system_type, address)
     VALUES ($1, $2, '400 A Tesla', 'lead', 'roof', '1 Test St')`, [PROJECT, USER_ID]);
  await db.query(
    `INSERT INTO layouts (project_id, user_id, total_panels) VALUES ($1,$2,$3)`,
    [PROJECT, USER_ID, 37]);
});

/**
 * 🚨 WRITE THE ROW AS IT WAS SAVED BEFORE d2a8acb8 — the state Ray's project is actually in.
 *
 * No `solarCoupling` (the field postdates it), no `pvInputLimits`, no `outputConfigKw`, and
 * `ocpdA: 50` resolved from the catalogue as it read that day. Written as raw JSON rather than
 * through `writeServiceTopology`, because the write path serialises a graph that has already been
 * through today's authoring — and the whole point is a row that never was.
 */
async function writeLegacyRow(opts: { withGenerationPanels: boolean }): Promise<void> {
  const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
  const { serialiseServiceTopology } = await import('@/lib/db/serviceTopology');
  const stored = JSON.parse(JSON.stringify(
    serialiseServiceTopology(buildRaysIntendedJob().topology))) as
    { schemaVersion: number; topology: Record<string, any> };

  delete stored.topology.solarCoupling;
  stored.schemaVersion = 3;
  for (const u of stored.topology.storage ?? []) {
    delete u.pvInputLimits;
    delete u.pvDcStcKw;
    delete u.outputConfigKw;
    if (u.role === 'inverter-unit') u.ocpdA = 50;   // the stale catalogue value
  }
  if (!opts.withGenerationPanels) stored.topology.aggregationPanels = [];

  await db.query(`UPDATE projects SET service_topology = $2 WHERE id = $1`,
    [PROJECT, JSON.stringify(stored)]);
}

async function setSelectedEquipment(se: Record<string, unknown> | null): Promise<void> {
  await db.query(`UPDATE projects SET selected_equipment = $2 WHERE id = $1`,
    [PROJECT, se === null ? null : JSON.stringify(se)]);
}

/**
 * Drive the REAL route the Generate SLD button drives — and post the WRONG architecture, exactly as
 * the page's React state did on Ray's screen.
 */
async function generateSld(): Promise<{ status: number; svg: string; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/engineering/sld/route');
  const { NextRequest } = await import('next/server');
  const res = await POST(new NextRequest('http://localhost/api/engineering/sld', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT,
      projectName: 'Hussey Ethos', clientName: 'Hussey Ethos', address: '238 N Warwick Ave',
      drawingDate: '2026-07-29', drawingNumber: 'SLD-001', revision: 'A',
      // 🚨 THE WRONG ARCHITECTURE, POSTED. This is what the live page sent.
      topologyType: 'STRING',
      inverterModel: 'Tesla Solar Inverter 5.7kW',
      inverterManufacturer: 'Tesla',
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
  // The route answers with raw SVG or with JSON depending on the Accept/content negotiation, and
  // the page handles both — so this must too, or the test is driving a path the UI never takes.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('svg') || ct.includes('xml')) {
    return { status: res.status, svg: await res.text(),
      json: { electricalRevision: res.headers.get("X-Electrical-Revision") ?? undefined } };
  }
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, svg: String(json.svg ?? ''), json };
}

/** Count non-overlapping occurrences. */
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the legacy row is genuinely legacy', () => {
  it('writes with no coupling, no PV input limits, and the stale 50 A OCPD', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    const row = (await db.query(
      `SELECT service_topology FROM projects WHERE id = $1`, [PROJECT])).rows[0] as
      { service_topology: any };
    const raw = typeof row.service_topology === 'string'
      ? JSON.parse(row.service_topology) : row.service_topology;
    expect(raw.topology.solarCoupling).toBeUndefined();
    for (const u of raw.topology.storage.filter((x: any) => x.role === 'inverter-unit')) {
      expect(u.pvInputLimits, 'the legacy row was written with PV input limits').toBeUndefined();
      expect(u.ocpdA, 'the legacy row was not written with the stale OCPD').toBe(50);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE FOUR CLASSES, AND THE PROOF THAT CORRECTING ONE DOES NOT REWRITE HISTORY.
  //
  // Ray: "A current manufacturer correction such as PW3 OCPD 50 → 60 must reach an active editable
  // project. An issued historical drawing must remain traceable to the revision/data it was issued
  // with. Do not solve current-project correctness by destroying historical reproducibility."
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 an AS-ISSUED read returns the graph exactly as it was stored', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    const { parseServiceTopology } = await import('@/lib/db/serviceTopology');
    const row = (await db.query(`SELECT service_topology FROM projects WHERE id = $1`, [PROJECT]))
      .rows[0] as { service_topology: unknown };

    const issued = parseServiceTopology(row.service_topology, 'as-issued')!;
    for (const u of issued.topology.storage.filter(x => x.role === 'inverter-unit')) {
      expect(u.ocpdA, 'a historical read was rewritten by a later catalogue correction').toBe(50);
      expect(u.pvInputLimits, 'a historical read gained a field it was never issued with')
        .toBeFalsy();
    }
    expect(issued.refreshes, 'a historical read refreshed something').toEqual([]);

    // 🚨 THE SAME BYTES, READ AS THE ACTIVE PROJECT, GET THE CORRECTION.
    const active = parseServiceTopology(row.service_topology, 'active')!;
    for (const u of active.topology.storage.filter(x => x.role === 'inverter-unit')) {
      expect(u.ocpdA, 'the correction did not reach the active project').toBe(60);
    }
    // And the refresh is itemised, so "which number moved, and from what" is answerable.
    const ocpd = active.refreshes.filter(r => r.field === 'ocpdA');
    expect(ocpd.length).toBe(4);
    expect(ocpd[0].was).toBe('50');
    expect(ocpd[0].now).toBe('60');
    expect(ocpd[0].productId).toBe('tesla-powerwall-3');
  });

  it('🚨 an AS-SENT read does not alter the payload it is validating', async () => {
    // The write path shape-checks what the caller submitted. Refreshing there would store something
    // nobody sent — a different act from checking it.
    await writeLegacyRow({ withGenerationPanels: true });
    const { parseServiceTopology } = await import('@/lib/db/serviceTopology');
    const row = (await db.query(`SELECT service_topology FROM projects WHERE id = $1`, [PROJECT]))
      .rows[0] as { service_topology: unknown };
    const sent = parseServiceTopology(row.service_topology, 'as-sent')!;
    for (const u of sent.topology.storage.filter(x => x.role === 'inverter-unit')) {
      expect(u.ocpdA).toBe(50);
    }
    expect(sent.refreshes).toEqual([]);
  });

  it('a project already matching the catalogue refreshes nothing — no churn', async () => {
    // A non-empty `refreshes` must mean something. If every read reported changes, nobody could use
    // it to find the projects that actually predate a correction.
    const { writeServiceTopology, readServiceTopology } = await import('@/lib/db/serviceTopology');
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    await writeServiceTopology(PROJECT, USER_ID, buildRaysIntendedJob().topology);
    const stored = (await readServiceTopology(PROJECT, USER_ID))!;
    expect(stored.refreshes, 'a current project reported spurious refreshes').toEqual([]);
  });

  it('🚨 and reading it REFRESHES the manufacturer facts from the catalogue', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    const { readServiceTopology } = await import('@/lib/db/serviceTopology');
    const t = (await readServiceTopology(PROJECT, USER_ID))!.topology;
    const units = t.storage.filter(u => u.role === 'inverter-unit');
    expect(units.length).toBe(4);
    for (const u of units) {
      expect(u.ocpdA, 'the stale 50 A survived the read').toBe(60);
      expect(u.continuousOutputA).toBe(48);
      expect(u.pvInputLimits, 'the PV input limits were not restored').toBeTruthy();
    }
    // 🚨 AND THE DESIGN DECISIONS ARE UNTOUCHED.
    expect(t.storage.length).toBe(4);
    expect(t.domains.length).toBe(2);
    expect(t.domains.map(d => d.gateway.productId)).toEqual(
      ['tesla-backup-gateway-3', 'tesla-backup-gateway-3']);
    expect(t.service.ratedAmps).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 THE LIVE SHEET, through the real route, with the wrong architecture posted', () => {
  beforeEach(async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    await setSelectedEquipment(null);   // Ray never selected a standalone inverter
  });

  it('returns a sheet', async () => {
    const { status, svg } = await generateSld();
    expect(status).toBe(200);
    expect(svg.length).toBeGreaterThan(5000);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('live.svg', svg, 'utf8');
    writeFileSync('live-arial.svg', svg.replace(/SolarPro Sans/g, 'Arial'), 'utf8');
    writeFileSync('live-texts.txt',
      [...svg.matchAll(/>([^<>]{1,90})</g)].map(x => x[1].trim()).filter(Boolean).join('\n'), 'utf8');
  });

  it('🚨 contains NO invented inverter, in any of its four disguises', async () => {
    const { svg } = await generateSld();
    for (const forbidden of ['Enphase', 'MICROINVERTER', 'STRING INVERTER', 'Tesla Solar Inverter',
      'IQ8', 'SolarEdge']) {
      expect(svg.includes(forbidden),
        `the sheet names '${forbidden}' on a DC-coupled Powerwall job`).toBe(false);
    }
  });

  it('🚨 draws exactly four Powerwall 3, each at the corrected 60 A OCPD', async () => {
    const { svg } = await generateSld();
    // Counted by DISTINCT unit label: the sheet names each unit in its box and again in the
    // equipment schedule, so counting raw occurrences measures the sheet's layout rather than the
    // design. Four units, numbered #1..#4, each present.
    for (const n of [1, 2, 3, 4]) {
      expect(svg.includes(`Tesla Powerwall 3 #${n}`), `Powerwall #${n} is missing`).toBe(true);
    }
    expect(svg.includes('Tesla Powerwall 3 #5'), 'a fifth Powerwall appeared').toBe(false);
    expect(svg.includes('50 A OCPD'), 'the stale 50 A OCPD reached the drawing').toBe(false);
    expect(count(svg, '60 A OCPD'), 'the corrected 60 A did not reach all four').toBeGreaterThanOrEqual(4);
    // The hydrated continuous current, four units of 48 A.
    expect(svg).toContain('48 A AC');
  });

  it('🚨 draws exactly two Gateway 3 and two generation panels', async () => {
    const { svg } = await generateSld();
    expect(count(svg, 'Tesla Backup Gateway 3')).toBeGreaterThanOrEqual(2);
    expect(count(svg, 'GENERATION PANEL —'), 'the generation panels are missing').toBe(2);
  });

  it('🚨 draws two inline 200 A utility isolation switches', async () => {
    const { svg } = await generateSld();
    expect(count(svg, 'UTILITY'), 'the isolation switches are missing').toBeGreaterThanOrEqual(2);
    expect(svg).toContain('ISOLATION');
    expect(count(svg, 'LOCK/VIS OPEN')).toBe(2);
  });

  it('🚨 the DC string path terminates at the Powerwalls, not at an MSP', async () => {
    const { svg } = await generateSld();
    expect(svg).toContain('DC COUPLED');
    expect(svg).toContain('PV DC INPUT');
    // The AC-chain conductor that used to run "TO MSP #1" from an invented inverter.
    expect(svg.includes('TO MSP #1'),
      'a PV conductor still runs into the main service panel').toBe(false);
  });

  it('🚨 the backup feeder is not labelled as the service branch', async () => {
    // Tesla: "All loads and Tesla equipment breakers are downstream of the Gateway 3 contactor."
    // The Gateway→MSP run is the BACKUP feeder; calling it the service path asserted that the MSP
    // sat on the service branch, i.e. that the gateway was beside the path rather than in it.
    const { svg } = await generateSld();
    expect(svg).toContain('BACKUP FEEDER');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THE CALCULATION BLOCKS MUST DESCRIBE THE SYSTEM DRAWN ABOVE THEM.
  //
  // Ray, after reading the sheet: "the same drawing says 'PV DC coupled to PW3' at the top and
  // '11.40 kW string inverter / 60 A fused disconnect / ATS run' in the calculation blocks below.
  // That's exactly the kind of internally contradictory permit sheet we're trying to eliminate."
  // ═══════════════════════════════════════════════════════════════════════
  it('🚨 no ATS run, no ATS check, and no FAIL row for a project with no ATS', async () => {
    // The law: no physical path → no conductor run → no engineering check → no FAIL row.
    // The route derived an ATS rating from the SERVICE rating, so a 400 A service manufactured a
    // 400 A transfer switch, sized its feeder, failed the ampacity check, and printed the failure.
    const { svg } = await generateSld();
    for (const forbidden of ['ATS_TO_MSP_RUN', 'ATS LOAD TERMINALS', 'ATS LOAD TO MSP']) {
      expect(svg.includes(forbidden),
        `the sheet contains '${forbidden}' for a project with no transfer switch`).toBe(false);
    }
    // 🚨 AND NO FAILING ROW AT ALL. A permit sheet carrying a ✗ for equipment nobody has is worse
    // than one carrying no row: it sends an installer looking for a device that does not exist.
    expect(svg.includes('✗ FAIL'), 'the sheet prints a FAIL row').toBe(false);
  });

  it('🚨 the AC calculations describe the storage, not a phantom PV inverter', async () => {
    const { svg } = await generateSld();
    // The invented inverter's numbers, which were printed under "AC SYSTEM CALCULATIONS".
    expect(svg.includes('11.40 kW'), 'the phantom inverter output is still printed').toBe(false);
    expect(svg.includes('A FUSED DISCO'),
      'the sheet names a fused disconnect from the inverter chain').toBe(false);
    // What it says instead: the storage, from the same summary the equipment schedule uses.
    expect(svg).toContain('ESS AC Amps');
    expect(svg).toContain('192 A (4 inverting units)');
    expect(svg).toContain('ESS OCPD / unit');
  });

  it('🚨 DC/AC ratio is reported as not applicable, not recomputed with a new denominator', async () => {
    // Ray: "Do not simply replace 11.40 kW with 46 kW… Do not preserve a misleading metric merely
    // because the UI already has a box for it." The ratio measures clipping at a dedicated PV
    // inverter; there is none, so the row says so and the governing limit is stated instead.
    const { svg } = await generateSld();
    expect(svg).toContain('N/A — DC COUPLED');
    expect(svg).toContain('PV vs ESS DC input');
    // The published PV STC capacity of the four units — a manufacturer figure, not arithmetic.
    expect(svg).toContain('80.0 kW published');
  });

  it('🚨 the conductor schedule describes the system drawn above it', async () => {
    const { svg } = await generateSld();
    // Every AC conductor on the drawing has a row: cabinets → generation panel, panel → gateway,
    // gateway → backed-up panel. Excluding the engine's inverter-chain runs had left ONE row
    // describing only the DC strings, which is as contradictory as inventing rows.
    expect(svg).toContain('ESS PV DC INPUTS');
    expect(svg).toContain('ESS AC OUTPUT (2 UNITS)');
    expect(svg).toContain('Generation panel — System 1');
    expect(svg).toContain('Generation panel — System 2');
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');

    // 🚨 AND NO CONDUCTOR GAUGE SolarPro DID NOT SIZE. The backup feeder carries a 200 A panel;
    // borrowing the PV circuit's #6 AWG for it would be a gauge an installer pulls wire from.
    expect(svg).toContain('SIZE FOR 200 A — NOT EVALUATED');
    expect(svg).toContain('SIZE FOR 60 A — NOT EVALUATED');
    // The one the graph DOES record is printed as a real gauge.
    expect(svg).toContain('#1 AWG THWN-2');
  });

  it('🚨 the equipment schedule lists no disconnect this design does not have', async () => {
    // The DC-coupled block cleared "AC Disconnect" and left "DC Disconnect — 25A Fused" standing one
    // line away, so the schedule listed a fused DC switch on a sheet whose only DC conductor runs
    // from the roof J-box into the cabinets' integrated PV inputs. Found by reading the sheet.
    const { svg } = await generateSld();
    expect(svg.includes('A Fused'), 'the schedule lists a fused disconnect that is not installed')
      .toBe(false);
    // The DC side is governed by the published PV input limits, which the calc band states instead.
    expect(svg).toContain('PV vs ESS DC input');
  });

  it('🚨 every OCPD on the sheet names the device it protects', async () => {
    const { svg } = await generateSld();
    // The tap row used to borrow the PV inverter's breaker. It now names the generation panel's own
    // output OCPD, which is the device that actually performs that function here.
    expect(svg).toContain('GEN PANEL OUTPUT');
  });

  it('the sheet carries an electrical revision', async () => {
    const { json } = await generateSld();
    expect(String(json.electricalRevision ?? '').startsWith('ELEC-')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EXPORT PDF MUST DRAW THE SAME SYSTEM AS THE DIAGRAM TAB.
//
// Two rendering entry points. Before the migration this route had ZERO references to the service
// graph, so "Export PDF" drew the legacy single-service tail while the Diagram tab drew two 200 A
// systems — and the exported one is what reaches an AHJ.
//
// Driven with `format: 'svg'`, which is the route's own branch: same auth, same canonical load, same
// input assembly, same renderer. Only the Chrome step is skipped, and Chrome does not decide what
// the drawing says.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the PDF export route, on the same legacy project', () => {
  beforeEach(async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    await setSelectedEquipment(null);
  });

  async function exportPdfAsSvg(): Promise<string> {
    const { POST } = await import('@/app/api/engineering/sld/pdf/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(new NextRequest('http://localhost/api/engineering/sld/pdf', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'svg',
        buildInput: {
          projectId: PROJECT, projectName: 'Hussey Ethos', clientName: 'Hussey Ethos',
          address: '238 N Warwick Ave', drawingDate: '2026-07-29', drawingNumber: 'SLD-001',
          // The same wrong architecture the page posted.
          topologyType: 'STRING',
          inverterModel: 'Tesla Solar Inverter 5.7kW', inverterManufacturer: 'Tesla',
          totalModules: 37, totalStrings: 4,
          panelModel: 'Philadelphia Solar PS-MNB108(HCBF)-440W',
          panelWatts: 440, panelVoc: 52.7, panelIsc: 13.7,
          acOutputKw: 11.4, acOutputAmps: 24, acOCPD: 60,
          mainPanelAmps: 400, interconnection: 'SUPPLY_SIDE_TAP',
          hasBattery: true, batteryModel: 'Powerwall 3', batteryCount: 4,
        },
      }),
    }));
    expect(res.status, 'the PDF route refused the request').toBe(200);
    return await res.text();
  }

  it('the exported sheet is DC coupled, with no invented inverter', async () => {
    const svg = await exportPdfAsSvg();
    expect(svg).toContain('PV DC COUPLED TO POWERWALL 3');
    for (const forbidden of ['Tesla Solar Inverter', 'STRING INVERTER', 'Enphase', 'MICROINVERTER']) {
      expect(svg.includes(forbidden), `the exported PDF names '${forbidden}'`).toBe(false);
    }
  });

  it('🚨 it draws the same equipment the Diagram tab draws', async () => {
    const svg = await exportPdfAsSvg();
    for (const n of [1, 2, 3, 4]) expect(svg).toContain(`Tesla Powerwall 3 #${n}`);
    expect(count(svg, 'GENERATION PANEL —'), 'the export is missing the generation panels').toBe(2);
    expect(count(svg, 'LOCK/VIS OPEN'), 'the export is missing an isolation switch').toBe(2);
    expect(svg).toContain('BACKUP FEEDER');
    expect(svg.includes('50 A OCPD'), 'the export carries the stale OCPD').toBe(false);
  });

  it('🚨 and its calculation blocks do not describe a phantom inverter either', async () => {
    const svg = await exportPdfAsSvg();
    expect(svg.includes('11.40 kW'), 'the export prints the phantom inverter output').toBe(false);
    expect(svg.includes('A FUSED DISCO'), 'the export names a phantom fused disconnect').toBe(false);
    expect(svg.includes('ATS_TO_MSP_RUN'), 'the export carries the phantom ATS run').toBe(false);
    expect(svg.includes('✗ FAIL'), 'the export prints a FAIL row').toBe(false);
    expect(svg).toContain('N/A — DC COUPLED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the ecosystem change must not be able to invent an architecture', () => {
  it('a selected standalone inverter beside PV-capable storage is a CONFLICT, not a silent AC sheet', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    // Exactly the state Ray's project was left in after changing ecosystem.
    await setSelectedEquipment({ inverter: { id: 'tesla-solar-inverter-7-6', type: 'string' } });

    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const loaded = (await loadElectricalProject(PROJECT, USER_ID))!;

    expect(loaded.model.solarCoupling,
      'an ordering of two branches silently decided the architecture').toBeNull();
    const c = loaded.model.conflicts.find(x => x.fact === 'How the PV is coupled');
    expect(c, 'contradictory evidence produced no conflict').toBeTruthy();
    expect(c!.claims.map(x => x.source).sort()).toEqual(['selected-equipment', 'service-topology']);

    // 🚨 AND NOTHING IS PERSISTED. This patch is what would have recorded the wrong architecture on
    // Ray's project permanently, the first time he pressed Generate.
    expect(loaded.model.canonicalizationPatch).toBeNull();
  });

  it('🚨 the one-time canonicalization REFUSES to write while the project is conflicted', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    await setSelectedEquipment({ inverter: { id: 'tesla-solar-inverter-7-6', type: 'string' } });

    const { loadElectricalProject, persistElectricalCanonicalization } =
      await import('@/lib/electrical/loadElectricalProject');
    const loaded = (await loadElectricalProject(PROJECT, USER_ID))!;
    expect(await persistElectricalCanonicalization(loaded, USER_ID)).toBe('nothing-to-do');

    const { readServiceTopology } = await import('@/lib/db/serviceTopology');
    expect((await readServiceTopology(PROJECT, USER_ID))!.topology.solarCoupling,
      'a coupling was written onto a conflicted project').toBeNull();
  });

  it('with no inverter selected it canonicalises to DC coupled, once, and then stops deriving', async () => {
    await writeLegacyRow({ withGenerationPanels: true });
    await setSelectedEquipment(null);

    const { loadElectricalProject, persistElectricalCanonicalization } =
      await import('@/lib/electrical/loadElectricalProject');
    const before = (await loadElectricalProject(PROJECT, USER_ID))!;
    expect(before.model.solarCoupling).toBe('dc-coupled-storage');
    expect(before.model.canonicalizationPatch).toEqual({ solarCoupling: 'dc-coupled-storage' });

    expect(await persistElectricalCanonicalization(before, USER_ID)).toBe('written');

    const after = (await loadElectricalProject(PROJECT, USER_ID))!;
    expect(after.model.solarCoupling).toBe('dc-coupled-storage');
    expect(after.model.solarCouplingProvenance.source).toBe('service-topology');
    expect(after.model.canonicalizationPatch).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PART THAT IS RAY'S DATA, NOT A BUG — said out loud rather than papered over.
// ═══════════════════════════════════════════════════════════════════════════
describe('a project with no generation panels in its graph', () => {
  it('draws none, because there are none — the drawing is not where they went missing', async () => {
    await writeLegacyRow({ withGenerationPanels: false });
    await setSelectedEquipment(null);
    const { svg } = await generateSld();

    expect(count(svg, 'GENERATION PANEL —')).toBe(0);
    // Everything else is still right: the sheet is not broken, it is drawing a different design.
    for (const n of [1, 2, 3, 4]) expect(svg.includes(`Tesla Powerwall 3 #${n}`)).toBe(true);
    expect(svg.includes('Tesla Solar Inverter')).toBe(false);
    expect(svg).toContain('DC COUPLED');

    // The model agrees there are none — so the gap is in the PROJECT, and the fix is to record the
    // panels, not to make the renderer invent them.
    const { loadElectricalProject } = await import('@/lib/electrical/loadElectricalProject');
    const m = (await loadElectricalProject(PROJECT, USER_ID))!.model;
    expect(m.storage.perSystemGenerationPanelCount).toBe(0);
    expect(m.storage.invertingUnitCount).toBe(4);
  });
});
