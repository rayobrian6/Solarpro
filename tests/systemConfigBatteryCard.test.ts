// ═══════════════════════════════════════════════════════════════════════════
// The Battery Storage card's pure model (System Config V3): what it reads from the service graph,
// the one answer it writes for every system, and the selection it mirrors from the graph.
//
//   · No backup system ⇒ no grouping: the project selection is still the battery record.
//   · Ray's job reads "System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3" per system, 4 batteries,
//     2 controllers, 54 kWh — the graph's totals, not the selection's.
//   · "Same controller / battery on every system" keeps EACH system's own count (never a split) and
//     refuses as a whole when the catalogue does not list the pairing — nothing written halfway.
//   · After a graph write the selection follows the graph: count, battery (with its catalogue
//     brand / model / kWh) and controller. A graph with no battery recorded changes nothing.
//   · Changing the battery before the graph exists keeps the controller only while the catalogue
//     lists the two together.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  answerEverySystemEquipment, batteryConfigMirror, batteryGroupingOf, batteryNeedsController,
  controllerAfterBatteryChange,
} from '@/lib/electrical/systemConfigBatteryCard';
import { answerServiceRating, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerSystemEquipment, systemEquipmentFacts } from '@/lib/electrical/systemConfigSystemEquipment';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const GW2 = 'tesla-backup-gateway-2';
const SC3 = 'enphase-iq-system-controller-3';
const IQ5P = 'enphase-iq-battery-5p';

const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};
const counts = (t: ServiceTopology) => t.domains.map(d => systemEquipmentFacts(t, d).inverting.length);
const products = (t: ServiceTopology) => t.domains.map(d => systemEquipmentFacts(t, d).storageProductId);
const gateways = (t: ServiceTopology) => t.domains.map(d => d.gateway.productId);

describe('what the card reads from the graph', () => {
  it('no topology, or a service with no backup system, is no grouping — the selection is the record', () => {
    expect(batteryGroupingOf(null)).toBeNull();
    expect(batteryGroupingOf(ok(answerServiceRating(null, 200)))).toBeNull();
  });

  it('Ray\'s job: one line per system, the graph\'s totals, one controller per system', () => {
    const g = batteryGroupingOf(buildRaysIntendedJob().topology)!;
    expect(g.systems.map(s => s.line)).toEqual([
      'System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3',
      'System 2 · 2 × Powerwall 3 · 1 × Backup Gateway 3',
    ]);
    expect([g.batteries, g.expansions, g.controllers]).toEqual([4, 0, 2]);
    expect(g.usableKwh).toBeCloseTo(54, 6);
    expect([g.commonStorageProductId, g.commonGatewayProductId]).toEqual([PW3, GW3]);
  });

  it('expansion packs are counted and named apart from the batteries, and add energy', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 1 }).topology;
    const g = batteryGroupingOf(t)!;
    expect(g.systems[0].line).toBe('System 1 · 1 × Powerwall 3 · 1 × Powerwall 3 Expansion · 1 × Backup Gateway 3');
    expect([g.batteries, g.expansions]).toEqual([2, 2]);
    expect(g.usableKwh).toBeCloseTo(4 * 13.5, 6);
  });

  it('systems with different controllers have no common controller', () => {
    const t = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-b', { gatewayProductId: GW2 }));
    const g = batteryGroupingOf(t)!;
    expect(g.commonGatewayProductId).toBeNull();
    expect(g.systems[1].line).toBe('System 2 · 2 × Powerwall 3 · 1 × Backup Gateway 2');
  });
});

describe('one answer for every system — the model and the controller, never the count', () => {
  it('the controller on every system, each system keeping its own count', () => {
    const uneven = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-a', { storageUnits: 3 }));
    const t = ok(answerEverySystemEquipment(uneven, { gatewayProductId: GW2 }));
    expect(gateways(t)).toEqual([GW2, GW2]);
    expect(counts(t)).toEqual([3, 2]);
  });

  it('an unlisted pairing refuses the whole answer — no system is re-equipped halfway', () => {
    const t = buildRaysIntendedJob().topology;
    const r = answerEverySystemEquipment(t, { storageProductId: IQ5P });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toMatch(/does not list/);
  });

  it('battery and controller moved together, every system keeps its own count', () => {
    const uneven = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-b', { storageUnits: 1 }));
    const t = ok(answerEverySystemEquipment(uneven, { storageProductId: IQ5P, gatewayProductId: SC3 }));
    expect(products(t)).toEqual([IQ5P, IQ5P]);
    expect(gateways(t)).toEqual([SC3, SC3]);
    expect(counts(t)).toEqual([2, 1]);
  });

  it('nothing to change is said, not written', () => {
    const r = answerEverySystemEquipment(buildRaysIntendedJob().topology, { gatewayProductId: GW3, storageProductId: PW3 });
    expect(r.ok).toBe(false);
  });
});

describe('the selection mirrored from the graph after a graph write', () => {
  const selection = { batteryId: PW3, batteryCount: 2, batteryKwh: 13.5, backupInterfaceId: '' };

  it('no backup system ⇒ nothing changes (the selection is still the record)', () => {
    expect(batteryConfigMirror(ok(answerServiceRating(null, 200)), selection)).toEqual({});
    expect(batteryConfigMirror(null, selection)).toEqual({});
  });

  it('Ray\'s job: the count and the controller follow the graph', () => {
    expect(batteryConfigMirror(buildRaysIntendedJob().topology, selection)).toEqual({ batteryCount: 4, backupInterfaceId: GW3 });
  });

  it('a per-system count change moves the selection\'s count to the graph\'s total', () => {
    const t = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-a', { storageUnits: 3 }));
    expect(batteryConfigMirror(t, { ...selection, batteryCount: 4, backupInterfaceId: GW3 })).toEqual({ batteryCount: 5 });
  });

  it('a re-equipped graph brings the battery\'s catalogue brand, model and per-unit kWh', () => {
    const t = ok(answerEverySystemEquipment(buildRaysIntendedJob().topology, { storageProductId: IQ5P, gatewayProductId: SC3 }));
    expect(batteryConfigMirror(t, { ...selection, batteryCount: 4, backupInterfaceId: GW3 })).toEqual({
      batteryId: IQ5P, batteryBrand: 'Enphase', batteryModel: 'IQ Battery 5P', batteryKwh: 5, backupInterfaceId: SC3,
    });
  });

  it('systems with no battery recorded yet change nothing — a count nobody typed is not zero on the project', () => {
    let t = buildRaysIntendedJob().topology;
    t = ok(answerSystemEquipment(t, 'domain-a', { storageUnits: 0 }));
    t = ok(answerSystemEquipment(t, 'domain-b', { storageUnits: 0 }));
    expect(batteryConfigMirror(t, { ...selection, batteryCount: 4 })).toEqual({});
  });

  it('a graph and a selection that agree change nothing', () => {
    expect(batteryConfigMirror(buildRaysIntendedJob().topology,
      { batteryId: PW3, batteryCount: 4, batteryKwh: 13.5, backupInterfaceId: GW3 })).toEqual({});
  });
});

describe('before the graph: the controller in the selection', () => {
  it('kept only while the catalogue lists it with the battery; never picked', () => {
    expect(controllerAfterBatteryChange(PW3, GW3)).toBe(GW3);
    expect(controllerAfterBatteryChange(IQ5P, GW3)).toBe('');
    expect(controllerAfterBatteryChange(IQ5P, '')).toBe('');
    expect(controllerAfterBatteryChange('', GW3)).toBe('');
  });

  it('asked where the catalogue says the battery needs one', () => {
    expect(batteryNeedsController(PW3)).toBe(true);
    expect(batteryNeedsController('enphase-iq-battery-10c')).toBe(false);
    expect(batteryNeedsController('')).toBe(false);
  });
});

describe('the page: the Battery card is the component, and the write handler mirrors the graph', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');

  it('writeInterviewAnswer merges the battery mirror into its patch before updateConfig', () => {
    const at = page.indexOf('const writeInterviewAnswer = async');
    expect(at).toBeGreaterThan(0);
    const body = page.slice(at, page.indexOf('\n  };', at));
    const mirror = body.indexOf('Object.assign(patch, batteryConfigMirror(next, config));');
    expect(mirror, 'the write handler no longer mirrors the battery selection from the graph').toBeGreaterThan(0);
    expect(body.indexOf('const ok = await writeTopology(next, what);')).toBeLessThan(mirror);
    expect(mirror).toBeLessThan(body.indexOf('if (Object.keys(patch).length > 0) updateConfig(patch);'));
  });

  it('the Battery Storage card (sc-card-battery) renders BatteryStorageCard on the one write path', () => {
    const card = page.slice(page.indexOf('id="sc-card-battery"'), page.indexOf('Generator & ATS — v57.5'));
    expect(card).toMatch(/<BatteryStorageCard \{\.\.\.interviewEditorContext\} interview=\{systemConfigInterview\}\s+controlMode=\{controlMode\} selection=\{config\}\s+onSelectionChange=\{updateConfig\}/);
    // The old in-page pickers are gone from the card — one control per fact.
    expect(card).not.toContain('<label className="eng-label">Units</label>');
  });
});
