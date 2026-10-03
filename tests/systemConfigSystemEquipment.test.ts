// ═══════════════════════════════════════════════════════════════════════════
// System Config, per system: each backup system's controller / batteries / expansions, where each
// system's batteries land, and which panels are backed up — `systemConfigSystemEquipment.ts`.
//
// Ray's law, each a case below:
//   · "Do not ask a question whose answer is already known." One system ⇒ asked once, plainly; no
//     storage ⇒ not asked; one panel ⇒ no "which panels".
//   · "Do not offer an answer the selected equipment cannot support." A controller is offered only
//     when the catalogue lists it with the battery; an expansion only when the battery is its host;
//     no catalogue fact ⇒ NOT EVALUATED, nothing offered as verified.
//   · Capability, never a brand: the same code offers a different family's controller.
//   · Batteries are never split evenly by assumption.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildSystemConfigInterview, type InterviewEquipment, type InterviewInput,
} from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerDistribution, answerBackup, answerPvLanding, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  answerSystemEquipment, answerSystemLanding, answerBackedUpPanels, answerBackupChoice,
  controllersFor, expansionsFor, backupBatteries, systemEquipmentItemId, systemLandingItemId,
  NOT_EVALUATED_MFR,
} from '@/lib/electrical/systemConfigSystemEquipment';
import { addBackupDomain } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

const PW3 = 'tesla-powerwall-3';
const PW3_EXP = 'tesla-powerwall-3-expansion';
const GW3 = 'tesla-backup-gateway-3';
const GW2 = 'tesla-backup-gateway-2';

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });

const storageEq = (label: string, count: number, pvInput = false): InterviewEquipment => ({
  pvInverter: { state: 'UNDECIDED' },
  storage: { label, count, pvInput, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Gateway', count: 1 },
});
const PW3_EQ = storageEq('Tesla Powerwall 3', 4, true);
const MICROS: InterviewEquipment = {
  pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null,
};

const iv = (topology: ServiceTopology | null, equipment: InterviewEquipment = PW3_EQ, over: Partial<InterviewInput> = {}) =>
  buildSystemConfigInterview({
    pvArray: pv20, topology, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment, evaluation: null, derivedStrings: null, ...over,
  });
type IV = ReturnType<typeof iv>;
const all = (x: IV) => x.sections.flatMap(s => s.items);
const item = (x: IV, id: string) => all(x).find(i => i.id === id);
const mine = (x: IV) => all(x).filter(i => i.id.startsWith('equipment.system.'));
const sectionIds = (x: IV, s: string) => x.sections.find(z => z.id === s)!.items.map(i => i.id);

const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};
const refusedText = (r: AnswerResult): string => (r.ok === false ? r.refused : '');

const t200 = () => ok(answerServiceRating(null, 200));
const twoPanels = () => ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
/** One 200 A panel backed up whole by one system: controller + `n` units of `ess`. */
const oneSystem = (gw = GW3, ess = PW3, n = 2) => {
  const t = t200();
  return addBackupDomain(t, {
    branchId: t.branches[0].id, panelIds: [t.panels[0].id], gatewayProductId: gw,
    storageProductIds: Array.from({ length: n }, () => ess),
  }).topology;
};
const unitsOf = (t: ServiceTopology, domainId: string) => {
  const d = t.domains.find(x => x.id === domainId)!;
  return d.storageUnitIds.map(id => t.storage.find(u => u.id === id)!);
};

describe('asked only where it applies', () => {
  it('no storage ⇒ nothing per system is asked, on a 200 A micro house', () => {
    const x = iv(t200(), MICROS);
    expect(mine(x)).toEqual([]);
    expect(item(x, 'behavior.backup')).toBeUndefined();
  });

  it('storage chosen but no backed-up system made yet ⇒ nothing per system yet; one panel ⇒ no "which panels"', () => {
    const x = iv(t200());
    expect(mine(x)).toEqual([]);
    expect(item(x, 'behavior.backup')?.options?.map(o => o.value)).toEqual(['whole', 'none']);
  });

  it('one system ⇒ asked ONCE, without "per system" wording, after the storage questions', () => {
    const x = iv(oneSystem());
    const q = mine(x);
    expect(q.map(i => i.id)).toEqual([systemEquipmentItemId('domain-1')]);
    expect(q[0].question).toBe('Which backup controller, batteries and expansion units are installed?');
    expect(q[0].question).not.toMatch(/System 1/);
    expect(q[0].state).toBe('answered');
    expect(q[0].answer).toBe('Tesla Backup Gateway 3 · 2 × Tesla Powerwall 3');
    const eq = sectionIds(x, 'equipment');
    expect(eq.indexOf(q[0].id)).toBeGreaterThan(eq.indexOf('equipment.storage'));
    // One system ⇒ the all-systems landing question is the only landing question.
    expect(all(x).some(i => i.id.startsWith('equipment.system.landing.'))).toBe(false);
  });

  it('two systems ⇒ each is asked by the name the job uses, and each landing is its own question', () => {
    const rays = buildRaysIntendedJob().topology;
    const x = iv(rays, PW3_EQ, { pvArray: pv37 });
    const equip = mine(x).filter(i => i.section === 'equipment');
    expect(equip.map(i => i.question)).toEqual([
      'System 1: which backup controller, batteries and expansion units?',
      'System 2: which backup controller, batteries and expansion units?',
    ]);
    expect(equip.every(i => i.answer === 'Tesla Backup Gateway 3 · 2 × Tesla Powerwall 3')).toBe(true);
    const behavior = sectionIds(x, 'behavior');
    const at = behavior.indexOf('behavior.storage-landing');
    expect(behavior.slice(at + 1, at + 3)).toEqual([systemLandingItemId('domain-a'), systemLandingItemId('domain-b')]);
    // The "same for every system" answer is still there and still answered.
    expect(item(x, 'behavior.storage-landing')?.state).toBe('answered');
  });
});

describe('only what the catalogue says fits is offered — keyed on capability, never a brand', () => {
  it('the controllers offered for a battery are the ones the catalogue lists with it', () => {
    const x = iv(oneSystem());
    expect(item(x, systemEquipmentItemId('domain-1'))?.options?.map(o => o.value).sort()).toEqual([GW2, GW3]);
    expect(controllersFor(PW3).options.map(o => o.value)).not.toContain('enphase-iq-system-controller-3');
  });

  it('the same code, another family: its listed controller, and no expansion question where none is catalogued', () => {
    const t = oneSystem('enphase-iq-system-controller-3', 'enphase-iq-battery-5p', 2);
    const q = item(iv(t, storageEq('Enphase IQ Battery 5P', 2)), systemEquipmentItemId('domain-1'))!;
    expect(q.options?.map(o => o.value)).toEqual(['enphase-iq-system-controller-3']);
    expect(q.question).toBe('Which backup controller and batteries are installed?');
    expect(q.state).toBe('answered');
    expect(expansionsFor('enphase-iq-battery-5p').options).toEqual([]);
    expect(expansionsFor(PW3).options.map(o => o.value)).toEqual([PW3_EXP]);
  });

  it('no compatibility fact in the catalogue ⇒ NOT EVALUATED, and nothing is offered as though verified', () => {
    const t = oneSystem(GW3, 'franklin-apower-15', 1);
    const q = item(iv(t, storageEq('FranklinWH aPower 2', 1)), systemEquipmentItemId('domain-1'))!;
    expect(q.state).toBe('needs-verification');
    expect(q.answer).toContain(NOT_EVALUATED_MFR);
    expect(q.options).toEqual([]);
    const r = answerSystemEquipment(t, 'domain-1', { gatewayProductId: GW2 });
    expect(r.ok).toBe(false);
    expect(refusedText(r)).toContain(NOT_EVALUATED_MFR);
    expect(backupBatteries().map(o => o.value)).not.toContain('franklin-apower-15');
  });

  it('a recorded controller the catalogue does not list for the battery is an OPEN question, not a pass', () => {
    const t = oneSystem('enphase-iq-system-controller-3', PW3, 2);
    const q = item(iv(t), systemEquipmentItemId('domain-1'))!;
    expect(q.state).toBe('needs-answer');
    expect(q.why).toMatch(/does not list Enphase IQ System Controller 3 as compatible with Tesla Powerwall 3/);
    expect(iv(t).openQuestions.map(o => o.id)).toContain(q.id);
  });

  it('a system with no batteries is asked — never filled by splitting the selection', () => {
    const t = ok(answerBackup(twoPanels(), 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4 }));
    expect(t.storage).toHaveLength(0);
    const q = mine(iv(t)).filter(i => i.section === 'equipment');
    expect(q).toHaveLength(2);
    expect(q.every(i => i.state === 'needs-answer' && /no batteries recorded/.test(i.answer ?? ''))).toBe(true);
  });
});

describe('the per-system equipment answer, through setDomainEquipment', () => {
  it('count and expansions are recorded on THAT system; a later count change keeps the expansions', () => {
    let t = ok(answerSystemEquipment(oneSystem(), 'domain-1', { storageUnits: 3, expansionProductId: PW3_EXP, expansionUnits: 1 }));
    let u = unitsOf(t, 'domain-1');
    expect(u.filter(x => x.role === 'inverter-unit')).toHaveLength(3);
    const exp = u.filter(x => x.role === 'energy-expansion');
    expect(exp).toHaveLength(1);
    expect(u.find(x => x.id === exp[0].attachedToUnitId)?.role).toBe('inverter-unit');
    expect(item(iv(t), systemEquipmentItemId('domain-1'))?.answer)
      .toBe('Tesla Backup Gateway 3 · 3 × Tesla Powerwall 3 · 1 × Tesla Powerwall 3 Expansion');
    t = ok(answerSystemEquipment(t, 'domain-1', { storageUnits: 2 }));
    u = unitsOf(t, 'domain-1');
    expect(u.filter(x => x.role === 'inverter-unit')).toHaveLength(2);
    expect(u.filter(x => x.role === 'energy-expansion'), 'a battery-count change dropped the expansions').toHaveLength(1);
  });

  it('refuses what the equipment cannot support, and says why', () => {
    const t = oneSystem();
    expect(refusedText(answerSystemEquipment(t, 'domain-1', { gatewayProductId: 'enphase-iq-system-controller-3' })))
      .toMatch(/does not list Enphase IQ System Controller 3 as compatible/);
    expect(refusedText(answerSystemEquipment(t, 'domain-1', { expansionProductId: PW3_EXP, expansionUnits: 3 })))
      .toMatch(/at most 2/);
    expect(refusedText(answerSystemEquipment(t, 'domain-1', { storageProductId: PW3_EXP })))
      .toMatch(/expansion unit/);
    expect(answerSystemEquipment(t, 'domain-1', { storageUnits: 1.5 }).ok).toBe(false);
    expect(answerSystemEquipment(t, 'domain-1', {}).ok).toBe(false);
    const iq = oneSystem('enphase-iq-system-controller-3', 'enphase-iq-battery-5p', 2);
    expect(refusedText(answerSystemEquipment(iq, 'domain-1', { expansionProductId: PW3_EXP, expansionUnits: 1 })))
      .toMatch(/does not list Tesla Powerwall 3 Expansion as an expansion for Enphase IQ Battery 5P/);
  });

  it('two battery models in one system are never homogenised by a count change — the installer is asked', () => {
    const base = t200();
    const t = addBackupDomain(base, {
      branchId: base.branches[0].id, panelIds: [base.panels[0].id], gatewayProductId: GW2,
      storageProductIds: [PW3, 'tesla-powerwall-2'],
    }).topology;
    expect(item(iv(t), systemEquipmentItemId('domain-1'))?.state).toBe('needs-answer');
    expect(refusedText(answerSystemEquipment(t, 'domain-1', { storageUnits: 3 }))).toMatch(/more than one battery/);
    const one = ok(answerSystemEquipment(t, 'domain-1', { storageProductId: PW3 }));
    expect(unitsOf(one, 'domain-1').map(u => u.productId)).toEqual([PW3, PW3]);
  });

  it('moving to another family in one answer: battery and its listed controller together', () => {
    const iq = oneSystem('enphase-iq-system-controller-3', 'enphase-iq-battery-5p', 2);
    // The battery alone would leave an unlisted controller behind — refused, not half-applied.
    expect(answerSystemEquipment(iq, 'domain-1', { storageProductId: PW3 }).ok).toBe(false);
    const t = ok(answerSystemEquipment(iq, 'domain-1', { storageProductId: PW3, gatewayProductId: GW3 }));
    expect(t.domains[0].gateway.productId).toBe(GW3);
    expect(unitsOf(t, 'domain-1').map(u => u.productId)).toEqual([PW3, PW3]);
  });

  it('a different controller is a different instance: its breaker and interrupting rating are not carried over', () => {
    const base = oneSystem();
    const t = { ...base, domains: base.domains.map(d => ({ ...d, gateway: { ...d.gateway, sccrA: 22000, mainBreakerA: 175 } })) };
    const same = ok(answerSystemEquipment(t, 'domain-1', { storageUnits: 3 }));
    expect(same.domains[0].gateway).toMatchObject({ productId: GW3, sccrA: 22000, mainBreakerA: 175 });
    const moved = ok(answerSystemEquipment(t, 'domain-1', { gatewayProductId: GW2 }));
    expect(moved.domains[0].gateway.productId).toBe(GW2);
    expect(moved.domains[0].gateway.sccrA, 'the old controller\'s interrupting rating was carried onto the new one').toBeNull();
    expect(moved.domains[0].gateway.mainBreakerA).toBe(200);   // Backup Gateway 2's own catalogue main
  });

  it('the commissioned output setting survives a re-equip that keeps the battery', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 2, expansionsPerSystem: 0, outputConfigKw: 10 }).topology;
    expect(unitsOf(t, 'domain-a').map(u => u.continuousOutputA)).toEqual([41.7, 41.7]);
    const next = ok(answerSystemEquipment(t, 'domain-a', { expansionProductId: PW3_EXP, expansionUnits: 1 }));
    const inv = unitsOf(next, 'domain-a').filter(u => u.role === 'inverter-unit');
    expect(inv.map(u => u.continuousOutputA), 'the 10 kW setting silently became the 11.5 kW top row').toEqual([41.7, 41.7]);
    expect(inv.every(u => u.outputConfigKw === 10)).toBe(true);
  });

  it('the PV landed on each battery survives a controller change, and is asked again when the batteries change', () => {
    const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
    const units = rays.storage.filter(u => u.role === 'inverter-unit').map(u => u.id);
    const landed = ok(answerPvLanding(rays, { [units[0]]: [9, 9, 9, 8], [units[2]]: [2] }, 440, 37));
    const input = { pvArray: pv37, coupling: 'dc-coupled-storage' as const, couplingIsDecision: true };
    expect(item(iv(landed, PW3_EQ, input), 'behavior.pv-landing')?.state).toBe('answered');

    const gw = ok(answerSystemEquipment(landed, 'domain-a', { gatewayProductId: GW2 }));
    const kw = (t: ServiceTopology) => Object.fromEntries(t.storage.filter(u => u.role === 'inverter-unit')
      .map(u => [u.id, u.pvDcStcKw ?? null]));
    expect(kw(gw)).toEqual(kw(landed));
    expect(kw(landed)[units[0]]).toBe(15.4);
    expect(item(iv(gw, PW3_EQ, input), 'behavior.pv-landing')?.state).toBe('answered');

    const more = ok(answerSystemEquipment(landed, 'domain-a', { storageUnits: 3 }));
    expect(unitsOf(more, 'domain-a').every(u => (u.pvDcStcKw ?? null) === null)).toBe(true);
    expect(item(iv(more, PW3_EQ, input), 'behavior.pv-landing')?.state).toBe('needs-answer');
  });

  it('a system landing in its own generation panel gets the panel rebuilt — never fewer circuits than batteries', () => {
    const rays = buildRaysIntendedJob().topology;
    const agg = ok(answerSystemLanding(rays, 'domain-a', 'der-aggregation-panel'));
    const panelOf = (t: ServiceTopology) => (t.aggregationPanels ?? []).find(a => a.domainId === 'domain-a')!;
    expect(panelOf(agg).inputs).toHaveLength(2);
    const three = ok(answerSystemEquipment(agg, 'domain-a', { storageUnits: 3 }));
    expect(panelOf(three).inputs, 'the third battery is not on its generation panel').toHaveLength(3);
    const ids = new Set(three.storage.map(u => u.id));
    expect(panelOf(three).inputs.every(i => ids.has(i.sourceId))).toBe(true);
    expect(three.domains.find(d => d.id === 'domain-a')?.storageConnection).toBe('der-aggregation-panel');
  });
});

describe('per-system battery landing', () => {
  it('answering System 2 leaves System 1 alone', () => {
    const t = buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 0 }).topology;
    let x = iv(t);
    expect(item(x, systemLandingItemId('domain-a'))?.state).toBe('needs-answer');
    expect(item(x, systemLandingItemId('domain-a'))?.question).toBe('System 1: where do its battery AC circuits land?');
    const next = ok(answerSystemLanding(t, 'domain-b', 'gateway-panelboard'));
    expect(next.domains.map(d => d.storageConnection)).toEqual(['unresolved', 'gateway-panelboard']);
    x = iv(next);
    expect(item(x, systemLandingItemId('domain-b'))?.state).toBe('answered');
    expect(item(x, systemLandingItemId('domain-b'))?.answer).toBe('Inside its gateway’s own panelboard');
    expect(item(x, systemLandingItemId('domain-a'))?.state).toBe('needs-answer');
    expect(answerSystemLanding(t, 'no-such-system', 'gateway-panelboard').ok).toBe(false);
  });
});

describe('which panels are backed up', () => {
  const sel = { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4 };

  it('two panels ⇒ "Only the panels I choose" is offered; one panel ⇒ it is not', () => {
    expect(item(iv(twoPanels()), 'behavior.backup')?.options?.map(o => o.value)).toEqual(['whole', 'panels', 'none']);
    expect(item(iv(t200()), 'behavior.backup')?.options?.map(o => o.value)).toEqual(['whole', 'none']);
  });

  it('only MSP #2: one system behind MSP #2 with the batteries named for it; MSP #1 is outside the island', () => {
    const two = twoPanels();
    const t = ok(answerBackedUpPanels(two, ['msp-2'], { ...sel, unitsPerPanel: { 'msp-2': 2 } }));
    expect(t.domains).toHaveLength(1);
    expect(t.domains[0].backedUpPanelIds).toEqual(['msp-2']);
    expect(unitsOf(t, t.domains[0].id).filter(u => u.role === 'inverter-unit')).toHaveLength(2);
    expect(t.panels.map(p => p.backedUp)).toEqual([false, true]);
    const x = iv(t);
    expect(item(x, 'behavior.backup')).toMatchObject({ state: 'answered', answer: 'MSP #2 backed up', value: 'panels' });
    // One system ⇒ its equipment question is asked once, plainly.
    expect(mine(x).find(i => i.section === 'equipment')?.question).toMatch(/^Which backup controller/);
  });

  it('a panel nobody named a count for gets ZERO batteries — never a share of the selection', () => {
    const t = ok(answerBackedUpPanels(twoPanels(), ['msp-1', 'msp-2'], { ...sel, unitsPerPanel: { 'msp-1': 3 } }));
    const counts = t.domains.map(d => unitsOf(t, d.id).length);
    expect(counts).toEqual([3, 0]);
  });

  it('taking MSP #1 out removes its bare system; putting it back names the new system uniquely', () => {
    const both = ok(answerBackupChoice(twoPanels(), 'whole', { ...sel, unitsPerPanel: { 'msp-1': 1, 'msp-2': 2 } }));
    expect(both.domains.map(d => d.label)).toEqual(['System 1', 'System 2']);
    const only2 = ok(answerBackedUpPanels(both, ['msp-2'], sel));
    expect(only2.domains.map(d => d.label)).toEqual(['System 2']);
    expect(only2.storage).toHaveLength(2);          // System 1's battery went with it
    const again = ok(answerBackupChoice(only2, 'whole', { ...sel, unitsPerPanel: { 'msp-1': 1 } }));
    const labels = again.domains.map(d => d.label);
    expect(new Set(labels).size, `duplicate system names: ${labels.join(', ')}`).toBe(labels.length);
    expect(again.domains.map(d => [d.backedUpPanelIds[0], unitsOf(again, d.id).length]))
      .toEqual([['msp-2', 2], ['msp-1', 1]]);
  });

  it('a system with its own connection, generation panel or switch is not deleted by a checkbox — refused', () => {
    const rays = buildRaysIntendedJob().topology;
    const r = answerBackedUpPanels(rays, ['msp-1'], sel);
    expect(r.ok).toBe(false);
    expect(refusedText(r)).toMatch(/System 2 .*Advanced/);
    expect(refusedText(answerBackupChoice(rays, 'none', sel))).toMatch(/No backup/);
    // A bare system (nothing connected to it yet) is removed by "No backup" as before.
    const bare = ok(answerBackedUpPanels(twoPanels(), ['msp-2'], { ...sel, unitsPerPanel: { 'msp-2': 2 } }));
    expect(ok(answerBackupChoice(bare, 'none', sel)).domains).toEqual([]);
  });

  it('one panel: whole means every selected unit; "which panels" is refused', () => {
    const t = ok(answerBackupChoice(t200(), 'whole', sel));
    expect(t.storage).toHaveLength(4);
    expect(answerBackedUpPanels(t200(), ['msp-1'], sel).ok).toBe(false);
  });
});
