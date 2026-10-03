// ═══════════════════════════════════════════════════════════════════════════
// System Config as an interview — `buildSystemConfigInterview` + the answer writers.
//
// Ray's UX law, each a case below:
//   · "Do not ask a question whose answer is already known."
//   · "Do not offer an answer the selected equipment cannot support."
//   · A 200 A house is easy: no multiple-systems, no backup-domain, no combined-path questions.
//   · 400 A asks how the service is distributed; two panels get two panel cards.
//   · Brand agnostic — questions key on capability (`pvInput`, `backupCapable`), not a name.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildSystemConfigInterview, type InterviewEquipment, type InterviewInput,
} from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerDistribution, answerPanel, answerBackup, answerInterconnection,
  answerIsolationRequired, answerPvLanding, answerStorageLanding, answerExistingService,
} from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';

const RAYS_MODULE = 'panel-fence-ps1';
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: RAYS_MODULE });
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });

const MICROS: InterviewEquipment = {
  pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
  storage: null, gateway: null,
};
const PW3_NO_INVERTER: InterviewEquipment = {
  pvInverter: { state: 'UNDECIDED' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};

const base = (over: Partial<InterviewInput>): InterviewInput => ({
  pvArray: pv20, topology: null, coupling: null, couplingIsDecision: false,
  architectureConflict: false, equipment: MICROS, evaluation: null, derivedStrings: null, ...over,
});
const ids = (iv: ReturnType<typeof buildSystemConfigInterview>) =>
  iv.sections.flatMap(s => s.items.map(i => i.id));
const item = (iv: ReturnType<typeof buildSystemConfigInterview>, id: string) =>
  iv.sections.flatMap(s => s.items).find(i => i.id === id);

describe('the ordinary 200 A house is easy', () => {
  it('before anything is entered, the first open question is the service rating — and the array is already known', () => {
    const iv = buildSystemConfigInterview(base({}));
    expect(item(iv, 'design.pv-array')?.state).toBe('answered');
    expect(item(iv, 'design.pv-array')?.answer).toContain('20 modules');
    expect(item(iv, 'design.pv-array')?.source).toBe('From Design');
    expect(iv.openQuestions[0].id).toBe('service.rating');
  });

  it('answering 200 A builds one main panel and asks nothing about systems, backup or combining', () => {
    const r = answerServiceRating(null, 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topology.panels).toHaveLength(1);
    expect(r.topology.panels[0].busbarRatingA).toBe(200);
    const iv = buildSystemConfigInterview(base({ topology: r.topology }));
    const asked = ids(iv);
    for (const never of ['service.distribution', 'behavior.systems', 'behavior.backup',
      'behavior.storage-landing', 'behavior.pv-landing', 'behavior.pv-connection']) {
      expect(asked, `a 200 A micro house was asked ${never}`).not.toContain(never);
    }
    // What IS still asked is real: whether the service equipment is existing or new (never assumed
    // new), where it connects, and the utility's disconnect rule.
    expect(iv.openQuestions.map(q => q.id)).toEqual(['service.existing', 'behavior.interconnection', 'behavior.isolation']);
  });

  it('three answers later it is release-ready (control: an unanswered interconnection blocks release)', () => {
    let t = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;
    const before = buildSystemConfigInterview(base({ topology: t, evaluation: evaluateServiceTopology(t) }));
    expect(before.release.releaseReady).toBe(false);
    t = (answerInterconnection(t, 'load-side-busbar') as { topology: ServiceTopology }).topology;
    t = (answerIsolationRequired(t, false) as { topology: ServiceTopology }).topology;
    // 🚨 Existing or new is the installer's answer, not a default: until it is given it stays open.
    expect(buildSystemConfigInterview(base({ topology: t })).openQuestions.map(q => q.id)).toEqual(['service.existing']);
    t = (answerExistingService(t, { existing: false }) as { topology: ServiceTopology }).topology;
    const iv = buildSystemConfigInterview(base({ topology: t }));
    expect(iv.openQuestions).toEqual([]);
    // With the engine's verdicts in hand, what is still owed is NAMED with its owner — the utility's
    // available fault current is not something the installer is silently missing.
    const withEval = buildSystemConfigInterview(base({ topology: t, evaluation: evaluateServiceTopology(t) }));
    const needs = withEval.sections.find(s => s.id === 'engineering')!.items.filter(i => i.id.startsWith('engineering.needs.'));
    expect(needs.some(n => /fault current/i.test(n.question) && /Utility/.test(n.owner ?? ''))).toBe(true);
    expect(withEval.release.releaseReady, 'release cannot be eligible while required checks are not evaluated').toBe(false);
    expect(item(iv, 'behavior.interconnection')?.answer).toBe('Breaker in the panel (load side)');
    expect(t.pointsOfInterconnection[0].relationship).toBe('load-side-busbar');
    expect(t.pointsOfInterconnection[0].connectedToNodeId).toBe(t.panels[0].id);
  });
});

describe('400 A asks how it is split, and two panels get two cards', () => {
  it('400 A creates the service and asks the distribution; two main panels make two panel cards', () => {
    const svc = answerServiceRating(null, 400);
    expect(svc.ok).toBe(true);
    if (!svc.ok) return;
    expect(svc.topology.panels).toHaveLength(0);
    let iv = buildSystemConfigInterview(base({ topology: svc.topology }));
    expect(iv.openQuestions[0].id).toBe('service.distribution');
    const two = answerDistribution(svc.topology, 'two-main-panels');
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    iv = buildSystemConfigInterview(base({ topology: two.topology }));
    expect(item(iv, 'service.distribution')?.answer).toBe('Two 200 A main panels');
    expect(ids(iv).filter(i => i.startsWith('service.panel.'))).toHaveLength(2);
    // The SERVICE stays 400 A; each PANEL is 200 A. Never collapsed.
    expect(two.topology.service.ratedAmps).toBe(400);
    expect(two.topology.panels.map(p => p.busbarRatingA)).toEqual([200, 200]);
  });

  it('a panel card edits that panel; the manufacturer is recorded on it', () => {
    const two = (answerDistribution((answerServiceRating(null, 400) as { topology: ServiceTopology }).topology,
      'two-main-panels') as { topology: ServiceTopology }).topology;
    const r = answerPanel(two, two.panels[1].id, { manufacturer: 'Eaton', busbarRatingA: 225 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topology.panels[1]).toMatchObject({ manufacturer: 'Eaton', busbarRatingA: 225 });
    expect(r.topology.panels[0].busbarRatingA).toBe(200);
  });

  it('re-distributing a service that already has systems on it is REFUSED, not silently rebuilt', () => {
    const rays = buildRaysIntendedJob().topology;
    const r = answerDistribution(rays, 'one-main-panel');
    expect(r.ok).toBe(false);
  });
});

describe('Ray\'s job: the answers already recorded are not asked again', () => {
  const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
  const iv = buildSystemConfigInterview(base({
    pvArray: pv37, topology: rays, coupling: 'dc-coupled-storage', couplingIsDecision: true,
    equipment: { ...PW3_NO_INVERTER, pvInverter: { state: 'NONE' } },
    evaluation: evaluateServiceTopology(rays), derivedStrings: [{ panelCount: 9 }, { panelCount: 9 },
      { panelCount: 9 }, { panelCount: 8 }, { panelCount: 2 }],
  }));

  it('PV inverter NONE — DC coupled, as an installer decision', () => {
    expect(item(iv, 'equipment.pv-inverter')?.answer).toBe('None — DC coupled to storage');
    expect(item(iv, 'equipment.pv-inverter')?.source).toBe('Installer decision');
    expect(item(iv, 'behavior.pv-connection')?.state).toBe('answered');
  });

  it('400 A · two 200 A main panels, two systems, the combining answer recorded', () => {
    expect(iv.sections.find(s => s.id === 'service')?.summary).toContain('400 A');
    expect(item(iv, 'service.distribution')?.answer).toBe('Two 200 A main panels');
    expect(item(iv, 'behavior.storage-landing')?.state).toBe('answered');
    expect(item(iv, 'behavior.systems')).toBeDefined();   // two systems ⇒ asked
  });

  it('which Powerwall receives each string is still OPEN — and SolarPro does not split it', () => {
    expect(item(iv, 'behavior.pv-landing')?.state).toBe('needs-answer');
    expect(iv.release.releaseReady).toBe(false);
  });

  it('landing every string records each unit, zero included; a landing that loses a module is refused', () => {
    const units = rays.storage.filter(u => u.role === 'inverter-unit').map(u => u.id);
    const bad = answerPvLanding(rays, { [units[0]]: [9, 9, 9] }, 440, 37);
    expect(bad.ok).toBe(false);
    const good = answerPvLanding(rays, { [units[0]]: [9, 9, 9, 8], [units[1]]: [2] }, 440, 37);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const kw = good.topology.storage.filter(u => u.role === 'inverter-unit').map(u => u.pvDcStcKw);
    expect(kw).toEqual([15.4, 0.88, 0, 0]);
    const after = buildSystemConfigInterview(base({
      pvArray: pv37, topology: good.topology, coupling: 'dc-coupled-storage', couplingIsDecision: true,
      equipment: { ...PW3_NO_INVERTER, pvInverter: { state: 'NONE' } },
    }));
    expect(item(after, 'behavior.pv-landing')?.state).toBe('answered');
  });
});

describe('capability, not brand, decides what is asked and offered', () => {
  const t200 = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;

  it('storage that takes PV on DC + no inverter chosen ⇒ "Where does the PV connect?" offers the battery inputs', () => {
    const iv = buildSystemConfigInterview(base({ topology: t200, equipment: PW3_NO_INVERTER }));
    const q = item(iv, 'behavior.pv-connection');
    expect(q?.state).toBe('needs-answer');
    expect(q?.options?.map(o => o.value)).toEqual(['dc-coupled-storage', 'ac-coupled-inverter']);
    expect(q?.options?.[0].label).toBe('Directly to Tesla Powerwall 3 PV inputs');
  });

  it('microinverters explicitly chosen beside the same battery ⇒ NOT asked whether they are secretly DC coupled', () => {
    const iv = buildSystemConfigInterview(base({
      topology: t200,
      equipment: { ...PW3_NO_INVERTER, pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' } },
    }));
    expect(item(iv, 'behavior.pv-connection')?.options).toBeUndefined();
    expect(iv.openQuestions.map(q => q.id)).not.toContain('behavior.pv-connection');
  });

  it('a battery with NO PV inputs never offers "directly to the battery"', () => {
    const iv = buildSystemConfigInterview(base({
      topology: t200,
      equipment: { pvInverter: { state: 'UNDECIDED' },
        storage: { label: 'Enphase IQ Battery 5P', count: 2, pvInput: false, backupCapable: true, requiresGateway: true },
        gateway: null },
    }));
    expect(item(iv, 'behavior.pv-connection')).toBeUndefined();
    // …and the PV inverter is genuinely open: every module must land on something.
    expect(item(iv, 'equipment.pv-inverter')?.state).toBe('needs-answer');
  });

  it('no storage ⇒ no battery, backup or landing questions at all', () => {
    const iv = buildSystemConfigInterview(base({ topology: t200 }));
    for (const id of ['behavior.backup', 'behavior.storage-landing', 'behavior.pv-landing', 'equipment.gateway']) {
      expect(ids(iv)).not.toContain(id);
    }
  });

  it('whole-home backup on a single panel puts every selected unit behind one gateway', () => {
    const r = answerBackup(t200, 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topology.domains).toHaveLength(1);
    expect(r.topology.storage.filter(u => u.role === 'inverter-unit')).toHaveLength(2);
    const landed = answerStorageLanding(r.topology, 'gateway-panelboard');
    expect(landed.ok && landed.topology.domains[0].storageConnection).toBe('gateway-panelboard');
  });

  it('whole-home backup on two panels never splits the batteries for the installer', () => {
    const two = (answerDistribution((answerServiceRating(null, 400) as { topology: ServiceTopology }).topology,
      'two-main-panels') as { topology: ServiceTopology }).topology;
    const r = answerBackup(two, 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // No per-panel counts given ⇒ zero per system, not an invented 2 + 2.
    expect(r.topology.storage).toHaveLength(0);
  });
});

describe('honesty', () => {
  it('an architecture conflict blocks drawing and release, and says so first', () => {
    const iv = buildSystemConfigInterview(base({ architectureConflict: true }));
    expect(iv.release.drawable).toBe(false);
    expect(iv.release.blockers[0]).toMatch(/conflict/i);
  });

  it('a recorded module that disagrees with the placed modules FAILS and blocks release, naming both', () => {
    const iv = buildSystemConfigInterview(base({
      pvArray: resolvePvArrayDesign({ placedModuleCount: 37, placedModuleWatts: 440, selectedPanelId: 'panel-cs2' }),
    }));
    expect(item(iv, 'design.module-conflict')?.state).toBe('fails');
    expect(item(iv, 'design.module-conflict')?.answer).toMatch(/440 W.*620 W/);
    expect(iv.sections.find(s => s.id === 'design')?.status).toBe('fails');
    expect(iv.release.releaseReady).toBe(false);
    expect(iv.release.blockers.join(' ')).toMatch(/Is the recorded module the one Design placed\? No/);
  });

  it('no module identity ⇒ not drawable, with the owner named', () => {
    const iv = buildSystemConfigInterview(base({ pvArray: resolvePvArrayDesign({ placedModuleCount: 20 }) }));
    expect(iv.release.drawable).toBe(false);
    expect(item(iv, 'design.pv-array')?.owner).toMatch(/Design/);
  });

  it('a meter collar the project prohibits is neither offered nor accepted', () => {
    const t = { ...(answerServiceRating(null, 200) as { topology: ServiceTopology }).topology };
    t.interconnection = { ...t.interconnection, meterCollarPermitted: false };
    const iv = buildSystemConfigInterview(base({ topology: t }));
    expect(item(iv, 'behavior.interconnection')?.options?.map(o => o.value)).not.toContain('meter-collar');
    expect(answerInterconnection(t, 'meter-collar').ok).toBe(false);
  });
});

describe('the Engineering Summary states the engineered project precisely (Ray\'s job)', () => {
  const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
  const iv = buildSystemConfigInterview(base({
    pvArray: pv37, topology: rays, coupling: 'dc-coupled-storage', couplingIsDecision: true,
    equipment: { ...PW3_NO_INVERTER, pvInverter: { state: 'NONE' } },
    evaluation: evaluateServiceTopology(rays),
    derivedStrings: [9, 9, 9, 8, 2].map(panelCount => ({ panelCount })),
  }));
  const fact = (label: string) => iv.summaryFacts.find(f => f.label === label);

  it('PV is the Design array; the PV inverter is NONE; storage and its AC output are separate lines', () => {
    expect(fact('PV modules')?.value).toBe('37');
    expect(fact('PV modules')?.source).toBe('From Design');
    expect(fact('PV DC size')?.value).toBe('16.28 kW');
    expect(fact('PV architecture')?.value).toBe('DC coupled to Tesla Powerwall 3');
    expect(fact('PV inverter')?.value).toBe('None — DC coupled to storage');
    expect(fact('PV strings')?.value).toBe('5 (9 / 9 / 9 / 8 / 2)');
    expect(fact('Storage')?.value).toBe('4 × Tesla Powerwall 3');
    expect(fact('ESS max continuous AC output')?.value).toMatch(/^46\.08 kW \(192 A\)$/);
    expect(fact('Backup controllers')?.value).toBe('2 × Tesla Gateway 3');
    expect(fact('Service')?.value).toBe('400 A');
    expect(fact('Distribution')?.value).toBe('2 × 200 A main panels');
  });

  it('strings with nothing chosen to land on are NOT stated as a SolarPro calculation (live browser finding)', () => {
    // The production page showed "PV STRINGS 2 (20 / 17) · SolarPro calculation" over "PV inverter:
    // Not chosen" — a partition sized against no input the project contains.
    const undecided = buildSystemConfigInterview(base({
      pvArray: pv37, equipment: { pvInverter: { state: 'UNDECIDED' }, storage: null, gateway: null },
      derivedStrings: [20, 17].map(panelCount => ({ panelCount })),
    }));
    const s = undecided.summaryFacts.find(f => f.label === 'PV strings');
    expect(s?.value).toMatch(/^Not derived/);
    expect(s?.source).toBe('Not established');
    expect(undecided.summaryFacts.find(f => f.label === 'Storage')?.value).toBe('None selected');
    // Control: the same strings ARE stated once the inverter they land on is chosen.
    const chosen = buildSystemConfigInterview(base({
      pvArray: pv37, equipment: { pvInverter: { state: 'SELECTED', label: 'SMA Sunny Boy 7.7', kind: 'string' }, storage: null, gateway: null },
      derivedStrings: [20, 17].map(panelCount => ({ panelCount })),
    }));
    expect(chosen.summaryFacts.find(f => f.label === 'PV strings')?.value).toBe('2 (20 / 17)');
  });

  it('the batteries are never named as the PV inverter, and PV size is never the ESS output', () => {
    expect(fact('PV inverter')?.value).not.toMatch(/Powerwall/);
    expect(fact('PV DC size')?.value).not.toBe(fact('ESS max continuous AC output')?.value);
  });

  it('on a system SolarPro has no single-phase relationship for, the ESS kW is not computed', () => {
    const t3 = { ...rays, service: { ...rays.service, phase: 'wye-208' as const, voltage: 208 } };
    const iv3 = buildSystemConfigInterview(base({
      pvArray: pv37, topology: t3, coupling: 'dc-coupled-storage', couplingIsDecision: true,
      equipment: { ...PW3_NO_INVERTER, pvInverter: { state: 'NONE' } }, evaluation: evaluateServiceTopology(t3),
    }));
    expect(iv3.summaryFacts.find(f => f.label === 'ESS max continuous AC output')?.value).toBe('192 A');
  });
});

describe('available fault current — the one number the SCCR chain waits on', () => {
  it('is asked of every recorded service, owned by the utility, and never assumed', () => {
    const t = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;
    const iv = buildSystemConfigInterview(base({ topology: t }));
    const q = item(iv, 'service.fault-current');
    expect(q?.state).toBe('needs-verification');
    expect(q?.answer).toBe('Not provided');
    expect(q?.owner).toMatch(/Utility/);
  });

  it('recording 10 kA answers it and is what the SCCR checks read', async () => {
    const { answerAvailableFaultCurrent } = await import('@/lib/electrical/systemConfigAnswers');
    const t = (answerServiceRating(null, 200) as { topology: ServiceTopology }).topology;
    const r = answerAvailableFaultCurrent(t, 10000);
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.topology.service.availableFaultCurrentA).toBe(10000);
    const iv = buildSystemConfigInterview(base({ topology: r.topology }));
    expect(item(iv, 'service.fault-current')?.answer).toBe('10 kA');
    expect(answerAvailableFaultCurrent(t, 0).ok).toBe(false);
  });
});

describe('existing service equipment is connected to, and verified on site — never assumed', () => {
  it('Ray\'s existing Eaton assembly reads "configuration to verify" until somebody reads it', async () => {
    const { answerExistingService } = await import('@/lib/electrical/systemConfigAnswers');
    const rays = buildRaysIntendedJob().topology;
    const withEx = answerExistingService(rays, { existing: true, manufacturer: 'Eaton' });
    if (withEx.ok === false) throw new Error(withEx.refused);
    let iv = buildSystemConfigInterview(base({ topology: withEx.topology }));
    expect(item(iv, 'service.existing')?.state).toBe('needs-verification');
    expect(item(iv, 'service.existing')?.answer).toContain('Eaton');
    const read = answerExistingService(withEx.topology, { existing: true, verified: true });
    if (read.ok === false) throw new Error(read.refused);
    iv = buildSystemConfigInterview(base({ topology: read.topology }));
    expect(item(iv, 'service.existing')?.answer).toContain('read on site');
    expect(read.topology.service.existingEquipment?.manufacturer).toBe('Eaton');
  });
});
