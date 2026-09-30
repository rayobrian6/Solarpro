// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PERMIT MUST NOT SAY "1 GATEWAY" WHILE THE SLD SAYS TWO.
//
// Ray: "The permit package must consume the same canonical `ServiceTopology` + physical equipment
// instances + `EngineeringCheck` conclusions used by Engineering, SLD, BOM and pricing... It must
// not collapse back to `1 main panel`, `1 gateway`, or `4 Powerwalls`."
//
// And on the schedule's semantics: "A Powerwall 3 Expansion is battery expansion equipment — not
// inverter, not independent ESS AC source, not another AC breaker contribution... MSP #1 and MSP #2
// must remain separately identifiable. Do not aggregate away topology merely because two devices
// have the same model/rating."
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import {
  serviceTopologyScheduleRows, serviceTopologyProcurement, serviceTopologyReleaseReadiness,
} from '@/lib/permit/utils/serviceTopologySchedule';

const job = (over = {}) => buildTesla400ATwoGateway({
  availableFaultCurrentA: 10_000, gatewaySccrA: 10_000,
  calculatedServiceDemandA: 310, branchDemandA: [160, 150],
  storageConnection: 'gateway-panelboard',
  ...over,
}).topology;

describe('🚨 the equipment schedule is one row per physical instance', () => {
  it('keeps TWO MSPs, TWO gateways, TWO Powerwalls and TWO Expansions', () => {
    const rows = serviceTopologyScheduleRows(job());
    const byType = (t: string) => rows.filter(r => r.deviceType === t);
    expect(byType('panelboard').map(r => r.tag), '2 MSP collapsed').toEqual(['MSP #1', 'MSP #2']);
    expect(byType('backup-gateway'), '2 gateways collapsed').toHaveLength(2);
    expect(byType('ess-ac-source'), 'the Powerwalls were merged').toHaveLength(2);
    expect(byType('battery-expansion'), 'the Expansions were merged').toHaveLength(2);
    expect(byType('service-branch').map(r => r.rating)).toEqual(['200 A', '200 A']);
    expect(byType('service')[0].rating).toContain('400 A');
  });

  it('🚨 two identical gateways are two rows, each naming its own domain', () => {
    const gws = serviceTopologyScheduleRows(job()).filter(r => r.deviceType === 'backup-gateway');
    // Same manufacturer, same model, same rating — and still two rows, because an inspector has to
    // be able to tell which enclosure is which.
    expect(gws[0].model).toBe(gws[1].model);
    expect(gws[0].rating).toBe(gws[1].rating);
    expect(new Set(gws.map(r => r.tag)).size).toBe(2);
    expect(gws.map(r => r.domain)).toEqual(['Domain A', 'Domain B']);
    // 🚨 THE NAME ON THE ENCLOSURE, NOT THE KEY IN THE DATABASE. This assertion used to require
    // 'branch-a' and 'msp-1' — it was PINNING the defect: an inspector reading the schedule was
    // being handed internal ids, exactly as the diagram once printed `TO DEVICE-1`.
    expect(gws[0].notes).toContain('Branch A');
    expect(gws[1].notes).toContain('Branch B');
    expect(gws[0].notes).toContain('MSP #1');
    expect(gws[1].notes).toContain('MSP #2');
    expect(gws[0].notes).not.toMatch(/\b(branch-a|msp-1)\b/);
  });

  it('🚨 an Expansion is battery expansion equipment — never an inverter or an AC source', () => {
    const rows = serviceTopologyScheduleRows(job());
    const exps = rows.filter(r => r.deviceType === 'battery-expansion');
    expect(exps).toHaveLength(2);
    for (const e of exps) {
      expect(e.deviceType).not.toBe('ess-ac-source');
      expect(e.ocpd, 'an Expansion was scheduled with a breaker').toMatch(/None/i);
      expect(e.notes).toMatch(/No inverter, no AC output, no ESS breaker/);
      expect(e.notes, 'the Expansion does not name the unit it extends').toMatch(/extending/);
      // Its rating is ENERGY. There is no current on this row at all.
      expect(e.rating).toMatch(/kWh/);
      expect(e.rating).not.toMatch(/\bA\b/);
    }
    // And exactly two rows on the sheet are AC sources.
    expect(rows.filter(r => r.deviceType === 'ess-ac-source')).toHaveLength(2);
  });

  it('the four disconnect roles are scheduled as themselves', () => {
    const d = serviceTopologyScheduleRows(job()).filter(r => r.deviceType === 'disconnect');
    expect(d).toHaveLength(2);
    expect(d[0].notes).toContain('Service disconnect');
    expect(d[1].notes).toContain('Utility DER isolation disconnect');
    expect(d[1].notes).toContain('lockable open');
    expect(d[1].notes).toContain('visible open');
  });

  it('🚨 procurement summarises the quantity and still names the instances', () => {
    const p = serviceTopologyProcurement(job());
    const byId = Object.fromEntries(p.map(l => [l.productId, l]));
    expect(byId['tesla-backup-gateway-3'].quantity).toBe(2);
    expect(byId['tesla-powerwall-3'].quantity).toBe(2);
    expect(byId['tesla-powerwall-3-expansion'].quantity).toBe(2);
    // A quantity with no tags behind it is how "2 gateways" becomes "a gateway".
    expect(byId['tesla-backup-gateway-3'].instanceTags).toHaveLength(2);
    expect(byId['tesla-powerwall-3-expansion'].deviceType).toBe('battery-expansion');
    // 🚨 NEVER "4 Powerwalls".
    expect(byId['tesla-powerwall-3'].quantity).not.toBe(4);
  });
});

describe('🚨 a drawable topology is not necessarily a releasable one', () => {
  it('the cell that would hold the fault current says what would fill it', () => {
    const rows = serviceTopologyScheduleRows(job({ availableFaultCurrentA: null }));
    expect(rows[0].notes).toBe('NOT EVALUATED — AVAILABLE FAULT CURRENT REQUIRED');
  });

  it('the multi-gateway manufacturer document is named as a requirement', () => {
    const r = serviceTopologyReleaseReadiness(job());
    expect(r.requirements.some(x => x.startsWith('MANUFACTURER DOCUMENT REQUIRED'))).toBe(true);
    expect(r.requirements.join(' ')).toContain('Multiple Backup Gateways on a Single Site');
  });

  it('🚨 drawable and releaseReady are separate answers', () => {
    const r = serviceTopologyReleaseReadiness(job());
    expect(r.drawable, 'a topology with unknowns still has a shape').toBe(true);
    expect(r.releaseReady, 'unresolved engineering read as release-ready').toBe(false);
    expect(r.indeterminate.length).toBeGreaterThan(0);
  });

  it('a fully resolved topology IS release-ready and asks for nothing', () => {
    // 🚨 "FULLY RESOLVED" NOW INCLUDES HOW THE DER REACHES THE SERVICE. That is a decision the
    // designer owes the drawing, and until it is made the topology is not release-ready — which is
    // exactly what this assertion went red to say when the check was added.
    const t = job({
      storageConnection: 'backed-up-panel-busbar',
      derArrangement: 'independent-branch',
    });
    t.interconnection.multiGatewayMeteringDoc = {
      title: 'Multiple Backup Gateways on a Single Site — Application Note',
      source: 'archived', present: true, governs: ['metering'],
    };
    for (const d of t.domains) d.backedUpDemandA = 100;
    for (const dev of t.devices) dev.sccrA = 22_000;
    for (const p of t.panels) { p.sccrA = 22_000; p.busbarRatingA = 225; p.mainBreakerA = 150; }
    // "Fully resolved" now also means the actual part was chosen and the utility ruled on the
    // isolation arrangement as drawn. A calculated minimum rating is not a purchase and a proven
    // traversal is not an approval, so a job with neither is not resolved.
    for (const dev of t.devices) dev.productId = 'eaton-dg224urk';
    t.interconnection.isolationArrangementAccepted = true;
    const r = serviceTopologyReleaseReadiness(t);
    expect(r.releaseReady).toBe(true);
    expect(r.requirements).toEqual([]);
    expect(r.failures).toEqual([]);
    // This fixture records its demand on the branches and domains directly, so there is no optional
    // calculation outstanding either. (`raysRealFourHundredAmpJob` covers the case where there is
    // one and it does NOT hold the sheet up — Ray's product decision.)
    expect(r.optional).toEqual([]);
  });

  it('a FAILURE is not the same as an unknown, and neither is release-ready', () => {
    const t = job({ selectMeterCollar: true });
    const r = serviceTopologyReleaseReadiness(t);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.releaseReady).toBe(false);
  });

  it('every requirement is phrased for a sheet cell, in capitals, naming the thing', () => {
    const r = serviceTopologyReleaseReadiness(job({ availableFaultCurrentA: null, gatewaySccrA: null }));
    expect(r.requirements.length).toBeGreaterThan(0);
    for (const req of r.requirements) {
      expect(req, `'${req}' does not name what is required`).toMatch(/REQUIRED/);
    }
  });
});

describe('🚨 the schedule sheet renders the instances, not a summary of them', () => {
  it('the SCHED page prints both gateways, both MSPs and both expansions', async () => {
    // The sheet builder is exercised through its own module rather than a full permit render:
    // what is under test is that the TOPOLOGY reaches the HTML, not the rest of the package.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('lib/permit/sections/structuralPages.ts', 'utf8'));
    // The renderer exists, is called from the schedule page, and reads the canonical input.
    expect(src).toContain('function renderServiceTopologySchedule');
    expect(src).toContain('${renderServiceTopologySchedule(input)}');
    expect(src).toContain('input.project?.serviceTopology');
    // 🚨 AND IT IS NOT A RELEASE BANNER. Ray's 2026-09-18 ruling took every release gate and
    // status stamp off the outbound planset; what goes on the sheet is the missing DATA.
    //
    // Scoped to THIS renderer, not the whole file: the file also carries the comments that record
    // that ruling, and a file-wide grep for its words fails on its own documentation.
    const fn = src.slice(src.indexOf('function renderServiceTopologySchedule'),
      src.indexOf('function renderHardwareSchedule'));
    for (const banned of ['DESIGN COMPLETE', 'RELEASE GATE', 'NOT FOR CONSTRUCTION', 'releaseReady']) {
      expect(fn, `'${banned}' was printed on the outbound sheet`).not.toContain(banned);
    }
    expect(fn).toContain('ENGINEERING INPUT REQUIRED');
  });
});
