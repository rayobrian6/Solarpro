// ═══════════════════════════════════════════════════════════════════════════
// Ray, on the live sheet: "These aren't emblems." Every device the service graph draws carries the
// sheet's device ARTWORK (lib/sld-symbols.ts, and a manufacturer illustration only when it is that
// exact product) — not a text box with a corner glyph. The art carries no words: a baked
// "200A / 240V" or "NEC 690.17" would be a wrong fact beside the box's real ones. Applied 120% remedy
// work carries the plan-set new-work mark; titles stay whole; no line runs past its border.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { renderSLDProfessional, type SLDProfessionalInput } from '@/lib/sld-professional-renderer';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import { setStoragePvInput, setServiceExistingOrNew } from '@/lib/electrical/topologyAuthoring';
import { answerBusbarRemedy, answerRemoveBusbarRemedy, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const BASE = {
  projectName: 'EMBLEMS', clientName: 'Ray', address: 'Chicago IL', designer: 'SolarPro',
  drawingDate: '2026-10-03', drawingNumber: 'E-1', revision: 'A', scale: 'NOT TO SCALE',
  topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 37, totalStrings: 0, deviceCount: 37,
  panelModel: 'Philadelphia Solar PS-M108-440', panelWatts: 440, panelVoc: 39.5, panelIsc: 13.9,
  dcWireGauge: '#10', dcConduitType: 'EMT', dcOCPD: 0, inverterModel: 'NONE', inverterManufacturer: 'Tesla',
  acOutputKw: 46.08, acOutputAmps: 192, acWireGauge: '#6', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true,
  mainPanelAmps: 200, utilityName: 'ComEd', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const quietly = <T>(fn: () => T): T => {
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};
const sheet = (t: ServiceTopology) =>
  quietly(() => renderSLDProfessional({ ...BASE, serviceTopology: t } as unknown as SLDProfessionalInput));
const count = (svg: string, attr: string) => (svg.match(new RegExp(attr, 'g')) ?? []).length;
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

/** Ray's job: 400 A, two 200 A paths, a Gateway 3 and two Powerwall 3 per path, generation panels. */
const raysJob = (): ServiceTopology => {
  let t = buildRaysIntendedJob().topology;
  t.storage.filter(u => u.role === 'inverter-unit')
    .forEach((u, k) => { t = setStoragePvInput(t, u.id, k === 0 ? 8.36 : k === 2 ? 7.92 : 0); });
  return setServiceExistingOrNew(t, 'existing');
};
/** One Powerwall 3 on a 200 A bus with a 200 A main fails the 120% rule; the derate is applied. */
const failing = () => buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;
const derated = () => ok(answerBusbarRemedy(failing(), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 150 }));

describe('every service-section device carries its emblem', () => {
  const svg = sheet(raysJob());
  const emblems = (kind: string) => count(svg, `data-emblem="${kind}"`);

  it('Ray\'s job: Powerwall 3 art on the Powerwalls, and artwork on every other device', () => {
    expect(emblems('tesla-powerwall-3'), 'the four Powerwall 3 units').toBe(4);
    expect(emblems('ac-combiner'), 'the two generation panels').toBe(2);
    expect(emblems('msp'), 'the service equipment and MSP #1 / MSP #2').toBe(3);
    expect(emblems('breaker'), 'the service disconnect').toBe(1);
    expect(emblems('ac-disconnect'), 'the two per-path utility isolation switches').toBe(2);
    expect(emblems('utility-meter'), 'the revenue meter').toBe(1);
    expect(count(svg, 'data-glyph='), 'a device left with a corner glyph instead of its emblem').toBe(0);
  });

  it('🚨 a Gateway 3 is drawn as a Gateway 3 — never with the Gateway 2 picture', () => {
    expect(emblems('tesla-backup-gateway-3')).toBe(2);
    expect(emblems('tesla-backup-gateway-2')).toBe(0);
    expect(svg).toContain('data-device="tesla-gateway-3"');
    expect(svg).not.toContain('data-device="tesla-gateway-2"');
  });

  it('a controller with no illustration of its own gets the generic transfer switch', () => {
    const t = raysJob();
    const other: ServiceTopology = { ...t, domains: t.domains.map(d => ({ ...d, gateway: { ...d.gateway, label: 'Acme Backup Interface 9' } })) };
    expect(count(sheet(other), 'data-emblem="ats"')).toBe(2);
  });

  it('🚨 manufacturer art only for the exact product: a Powerwall 2 gets the generic AC battery', () => {
    const t = raysJob();
    const first = t.storage.find(u => u.role === 'inverter-unit')!;
    const pw2: ServiceTopology = { ...t, storage: t.storage.map(u => (u.id === first.id ? { ...u, label: 'Tesla Powerwall 2' } : u)) };
    const s2 = sheet(pw2);
    expect(count(s2, 'data-emblem="tesla-powerwall-3"')).toBe(3);
    expect(count(s2, 'data-emblem="battery-ac"')).toBe(1);
  });

  it('🚨 the art carries no words — no baked rating, code article or caption reaches the sheet', () => {
    const groups = [...svg.matchAll(/<g data-emblem="[^"]*">([\s\S]*?)<\/g>(?=<|$)/g)].map(m => m[1]);
    expect(groups.length).toBeGreaterThan(10);
    for (const g of groups) expect(g, 'an emblem printed its own text').not.toMatch(/<text\b/);
    for (const baked of ['200A / 240V', 'NEC 690.17', 'MAIN SERVICE PANEL', 'TRANSFER SWITCH', 'REV GRADE', 'AC COMBINER']) {
      expect(texts(svg), baked).not.toContain(baked);
    }
  });

  it('the meter keeps its M; a title is never split by its emblem', () => {
    const t = texts(svg);
    expect(t).toContain('M');
    expect(t).toContain('EXISTING 400 A SERVICE EQUIPMENT');
    expect(t).toContain('400 A SERVICE DISCONNECT');
    expect(t).toContain('MSP #1');
    expect(t).toContain('MSP #2');
  });
});

describe('applied 120% remedy work is marked as new work', () => {
  it('the derated panel carries the new-work mark; the same panel without the remedy does not', () => {
    const applied = sheet(derated());
    expect(count(applied, 'data-mark="new-work"')).toBe(1);
    expect(count(applied, 'data-emblem="msp"')).toBeGreaterThanOrEqual(1);
    expect(count(sheet(failing()), 'data-mark="new-work"')).toBe(0);
    expect(count(sheet(ok(answerRemoveBusbarRemedy(derated(), 'msp-1'))), 'data-mark="new-work"')).toBe(0);
  });

  it('🚨 the remedy line wraps inside its box, and the code citation stays whole', () => {
    const t = texts(sheet(derated()));
    expect(t, 'the remedy line was drawn as one line — it ran past both edges of the panel box')
      .not.toContain('MAIN BREAKER DERATE (NEC 705.12(B))');
    expect(t).toContain('MAIN BREAKER DERATE');
    expect(t, 'the NEC citation was split across lines').toContain('(NEC 705.12(B))');
  });
});
