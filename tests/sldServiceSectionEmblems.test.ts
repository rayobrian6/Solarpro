// ═══════════════════════════════════════════════════════════════════════════
// Every box in the service section carries the schematic glyph for WHAT IT IS — the service
// equipment, the service disconnect and each main panel included, not only the storage, gateways and
// generation panels — and applied 120% remedy work carries the plan-set new-work mark. A glyph never
// costs a title its wholeness, and no line of a box runs past its border.
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

describe('every service-section box carries the glyph for what it is', () => {
  const svg = sheet(raysJob());

  it('the service equipment, the service disconnect and both main panels have one — not only the DER side', () => {
    expect(count(svg, 'data-glyph="service"'), 'service equipment').toBe(1);
    expect(count(svg, 'data-glyph="breaker"'), 'service disconnect').toBe(1);
    // Two MSPs + two generation panels.
    expect(count(svg, 'data-glyph="panelboard"'), 'MSP #1, MSP #2 and the two generation panels').toBe(4);
    expect(count(svg, 'data-glyph="controller"')).toBe(2);
    expect(count(svg, 'data-glyph="battery-inverter"')).toBe(4);
  });

  it('a title is never split to make room for its glyph', () => {
    const t = texts(svg);
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
    expect(count(applied, 'data-glyph="panelboard"')).toBeGreaterThanOrEqual(1);
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
