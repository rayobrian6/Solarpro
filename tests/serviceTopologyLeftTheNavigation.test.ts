// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1 — SERVICE TOPOLOGY LEFT THE NORMAL NAVIGATION; NO INSTALLER DECISION LEFT WITH IT.
//
// Ray (engineering closure gauntlet): "Remove Service Topology from normal Engineering navigation once
// you verify no required user input exists only on that page… If any remaining topology-page control
// represents a real installer decision, move that decision into the relevant existing System Config
// card. If it is derivable, internal, diagnostic or graph-management-only, do not recreate it."
//
// What the audit found the tab was the ONLY home of, and where each now lives:
//   · the generation / combiner panel's part, busbar and SCCR   → Battery card [Select Equipment]
//   · a panelboard's SCCR, off its label                        → Service card panel row / Answer Next
//   · "How does the new solar connect?" on a job no question asks it, and CHANGING a recorded one
//     (the architecture route refuses a second decision)        → Answer Next / Inverters & Strings
// and the one decision the tab never had a control for but whose writer silently reset it — a PW3's
// commissioned output setting — now in the Battery card's per-system editor.
//
// Pure tests here (writers, consumers, the interview rebuilt from the written graph, the store's
// round trip) and the page source (no tab, no entry point, the graph still loaded by the page).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import {
  ADVANCED_EDITOR, answerAvailableFaultCurrent, answerBackup, answerDistribution, answerPanel, answerServiceRating,
  answerSolarCoupling, answerStorageLanding, answerSystemsArrangement, answerInterconnection,
  answerIsolationRequired, answerIsolationArrangement, answerExistingService, pvCouplingWritePath, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  answerSystemEquipment, answerBackedUpPanels, outputConfigOf, outputConfigurationsFor, systemEquipmentFacts,
} from '@/lib/electrical/systemConfigSystemEquipment';
import { answerDisconnectPart } from '@/lib/electrical/systemConfigUtilityDisconnects';
import {
  GENERATION_PANELS_ITEM_ID, answerGenerationPanelPart,
} from '@/lib/electrical/systemConfigGenerationPanels';
import { findInterviewItem, homeOf, nextActionLabel, requiredQueue } from '@/lib/electrical/systemConfigPlacement';
import { hasItemEditor } from '@/components/engineering/systemConfig/ItemEditor';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { parseServiceTopology, serialiseServiceTopology } from '@/lib/db/serviceTopology';
import { renderTopologyServiceSection } from '@/lib/sld-professional-renderer';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const refused = (r: AnswerResult): string => (r.ok === false ? r.refused : '');
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const PW3_EQ: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const interviewOf = (t: ServiceTopology, eq: InterviewEquipment = PW3_EQ, dc = true) => buildSystemConfigInterview({
  pvArray: pv37, topology: t, coupling: dc ? 'dc-coupled-storage' : null, couplingIsDecision: dc,
  architectureConflict: false, equipment: eq, evaluation: evaluateServiceTopology(t),
  derivedStrings: [9, 9, 9, 8, 2].map(panelCount => ({ panelCount })),
});
const rays = () => buildRaysIntendedJob().topology;
const units = (t: ServiceTopology, domainId: string) => systemEquipmentFacts(t, t.domains.find(d => d.id === domainId)!).inverting;
/** The store's own round trip: serialise → JSON → parse (active read, hydrated from the catalogue). */
const reload = (t: ServiceTopology): ServiceTopology =>
  parseServiceTopology(JSON.stringify(serialiseServiceTopology(t)), 'active')!.topology;

/** Ray's job as an installer would build it in System Config alone — no tab, no fixture. */
function raysJobThroughSystemConfig(): ServiceTopology {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
    unitsPerPanel: { [t.panels[0].id]: 2, [t.panels[1].id]: 2 } }));
  t = { ...t, solarCoupling: 'dc-coupled-storage' };
  t = ok(answerStorageLanding(t, 'der-aggregation-panel'));
  t = ok(answerSystemsArrangement(t, 'independent-branch'));
  t = ok(answerInterconnection(t, 'manufacturer-integrated'));
  t = ok(answerIsolationRequired(t, true));
  return ok(answerIsolationArrangement(t, 'one-per-path'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE COMMISSIONED OUTPUT SETTING (PW3) — Battery card, per system
// ═══════════════════════════════════════════════════════════════════════════

describe('a battery\'s commissioned output setting is the installer\'s, per system, and every consumer follows it', () => {
  it('offered only where the manufacturer publishes settings (capability, not brand)', () => {
    expect(outputConfigurationsFor(PW3).map(o => o.value)).toEqual(['5.8', '7.6', '10', '11.5']);
    expect(outputConfigurationsFor(PW3)[1].detail).toBe('31.7 A continuous · 40 A OCPD');
    expect(outputConfigurationsFor('enphase-iq-battery-5p')).toEqual([]);
    expect(outputConfigurationsFor(null)).toEqual([]);
  });

  it('writes THAT system\'s units through the graph writer; the other system is untouched; PV landings kept', () => {
    const before = rays();
    const withPv = { ...before, storage: before.storage.map(u => (u.role === 'inverter-unit' ? { ...u, pvDcStcKw: 4 } : u)) };
    const next = ok(answerSystemEquipment(withPv, 'domain-a', { outputConfigKw: 7.6 }));
    for (const u of units(next, 'domain-a')) {
      expect(u).toMatchObject({ outputConfigKw: 7.6, continuousOutputA: 31.7, ocpdA: 40, pvDcStcKw: 4 });
    }
    for (const u of units(next, 'domain-b')) expect(u).toMatchObject({ outputConfigKw: 11.5, continuousOutputA: 48, ocpdA: 60 });
    // The generation panel circuits protecting System 1's batteries follow the configured OCPD.
    const aggA = next.aggregationPanels.find(a => a.domainId === 'domain-a')!;
    const ids = new Set(units(next, 'domain-a').map(u => u.id));
    expect(aggA.inputs.filter(i => ids.has(i.sourceId)).map(i => i.ocpdA)).toEqual([40, 40]);
    expect(next.aggregationPanels.find(a => a.domainId === 'domain-b')!.inputs.map(i => i.ocpdA)).toEqual([60, 60]);
  });

  it('🚨 consumers: the busbar / ESS arithmetic, the Engineering Summary, the SLD — and it survives the store and a rebuilt interview', () => {
    const next = ok(answerSystemEquipment(rays(), 'domain-a', { outputConfigKw: 7.6 }));
    expect(evaluateServiceTopology(next).storageSummary.totalContinuousOutputA).toBeCloseTo(2 * 31.7 + 2 * 48, 5);
    const ess = interviewOf(next).summaryFacts.find(f => f.label === 'ESS max continuous AC output')!;
    expect(ess.value).toBe('38.26 kW (159.4 A)');
    const svg = renderTopologyServiceSection({
      topology: next, startX: 1071, endX: 1974, busY: 479, minY: 100, maxY: 1070,
      utilityName: 'ComEd', calloutStart: 6, hasGenerator: false, notes: { x: 70, y: 715, w: 820, maxY: 1060 },
    }).svg;
    expect(svg).toContain('7.6 kW CONFIGURED');
    // Saved and read back (the active read re-hydrates from the catalogue): the decision and the
    // figures that follow from it are still there; rebuilding the interview reads them back.
    const back = reload(next);
    expect(outputConfigOf(back, back.domains[0])).toBe(7.6);
    expect(units(back, 'domain-a').map(u => u.continuousOutputA)).toEqual([31.7, 31.7]);
    expect(interviewOf(back).summaryFacts.find(f => f.label === 'ESS max continuous AC output')!.value).toBe('38.26 kW (159.4 A)');
  });

  it('refuses a setting the manufacturer does not publish (with the published list); null clears to the published maximum', () => {
    expect(refused(answerSystemEquipment(rays(), 'domain-a', { outputConfigKw: 9 })))
      .toBe('Tesla Powerwall 3 has no 9 kW output setting. The published settings are 5.8 kW, 7.6 kW, 10 kW, 11.5 kW.');
    expect(refused(answerSystemEquipment(rays(), 'domain-a', { outputConfigKw: 11.5 }))).toBe('Nothing to change on System 1.');
    const cleared = ok(answerSystemEquipment(rays(), 'domain-a', { outputConfigKw: null }));
    expect(outputConfigOf(cleared, cleared.domains[0])).toBeNull();
    expect(units(cleared, 'domain-a').map(u => u.continuousOutputA)).toEqual([48, 48]);
  });

  it('a battery whose manufacturer publishes no settings is refused, never rounded to a row', () => {
    let t = ok(answerServiceRating(null, 200));
    t = ok(answerBackup(t, 'whole', { gatewayProductId: 'enphase-iq-system-controller-3',
      storageProductId: 'enphase-iq-battery-5p', totalUnits: 2 }));
    expect(refused(answerSystemEquipment(t, t.domains[0].id, { outputConfigKw: 10 })))
      .toMatch(/publishes no output settings to choose from/);
  });

  it('another battery product starts unrecorded unless the same answer names a setting', () => {
    const t = ok(answerSystemEquipment(rays(), 'domain-a', { outputConfigKw: 7.6 }));
    // Same product, a different count: the setting is kept.
    const more = ok(answerSystemEquipment(t, 'domain-a', { storageUnits: 3 }));
    expect(units(more, 'domain-a').every(u => u.outputConfigKw === 7.6)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE GENERATION / COMBINER PANELS — Battery card [Select Equipment]
// ═══════════════════════════════════════════════════════════════════════════

describe('the generation panels the AC aggregation answer built: part, busbar, SCCR — answered in System Config', () => {
  it('one item, homed on the Battery card, standing for the needs the tab used to be the only place to answer', () => {
    const iv = interviewOf(raysJobThroughSystemConfig());
    const item = findInterviewItem(iv, GENERATION_PANELS_ITEM_ID)!;
    expect(item).toBeTruthy();
    expect(item.state).toBe('needs-answer');
    expect(homeOf(item.id)).toBe('battery');
    expect(nextActionLabel(item)).toBe('Choose the generation panel part and its busbar');
    const ids = iv.sections.flatMap(s => s.items).map(i => i.id);
    expect(ids).not.toContain('engineering.needs.aggregation.productId');
    expect(ids.filter(i => /^engineering\.needs\.sccr:agg-/.test(i))).toEqual([]);
    expect(requiredQueue(iv).map(i => i.id)).toContain(GENERATION_PANELS_ITEM_ID);
  });

  it('🚨 a new part brings its own numbers: naming it clears the sized busbar and the SCCR until they are read off it', () => {
    const t = raysJobThroughSystemConfig();
    const agg = t.aggregationPanels[0];
    expect(agg.busbarRatingA).toBe(125);               // the sizing's copy, before any part
    const named = ok(answerGenerationPanelPart(t, agg.id, { productId: 'Eaton BR816L125RP' }));
    expect(named.aggregationPanels[0]).toMatchObject({ productId: 'Eaton BR816L125RP', busbarRatingA: null, sccrA: null });
    const read = ok(answerGenerationPanelPart(named, agg.id, { busbarRatingA: 125 }));
    const full = ok(answerGenerationPanelPart(read, agg.id, { sccrA: 10_000 }));
    // The engine's verdicts on that panel: selection and SCCR are no longer waiting on anyone.
    const checks = evaluateServiceTopology(full).checks.filter(c => c.scope === `aggregation:${agg.id}`);
    expect(checks.find(c => c.id === 'aggregation.selection')).toBeUndefined();
    expect(checks.find(c => c.id === 'aggregation.sccr')).toBeUndefined();
    expect(checks.find(c => c.id === 'aggregation.busbar')!.conclusion).toBe('PASS');
    // And the part survives the store.
    expect(reload(full).aggregationPanels[0]).toMatchObject({ productId: 'Eaton BR816L125RP', busbarRatingA: 125, sccrA: 10_000 });
  });

  it('a part whose busbar is below the requirement FAILS the item — never written over by the sizing', () => {
    const t = raysJobThroughSystemConfig();
    let next = t;
    for (const a of t.aggregationPanels) {
      next = ok(answerGenerationPanelPart(next, a.id, { productId: 'small-100', busbarRatingA: 100, sccrA: 10_000 }));
    }
    const item = findInterviewItem(interviewOf(next), GENERATION_PANELS_ITEM_ID)!;
    expect(item.state).toBe('fails');
    expect(nextActionLabel(item)).toBe('Replace the generation panel — its rating does not fit');
  });

  it('refusals: an unknown panel, a non-positive rating, nothing to change', () => {
    const t = raysJobThroughSystemConfig();
    expect(refused(answerGenerationPanelPart(t, 'agg-9', { productId: 'x' }))).toBe("No generation panel 'agg-9'.");
    expect(refused(answerGenerationPanelPart(t, t.aggregationPanels[0].id, { sccrA: 0 }))).toMatch(/positive number of amperes/);
    expect(refused(answerGenerationPanelPart(t, t.aggregationPanels[0].id, {}))).toMatch(/^Nothing to change/);
  });

  it('no generation panel ⇒ no item (the plain 200 A house asks nothing about one)', () => {
    const t = ok(answerServiceRating(null, 200));
    expect(findInterviewItem(interviewOf(t, MICROS, false), GENERATION_PANELS_ITEM_ID)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · A PANELBOARD'S SCCR — Service card panel row / Answer Next
// ═══════════════════════════════════════════════════════════════════════════

describe('a panelboard\'s interrupting rating is read off its label and recorded in System Config', () => {
  it('answerPanel records it; the engine\'s chain stops waiting on that panel; refusals for a non-number', () => {
    let t = ok(answerServiceRating(null, 200));
    t = ok(answerAvailableFaultCurrent(t, 10_000));
    const need = `engineering.needs.sccr:${t.panels[0].id}`;
    const iv = interviewOf(t, MICROS, false);
    expect(findInterviewItem(iv, need)).toBeTruthy();
    expect(hasItemEditor(findInterviewItem(iv, need)!, t)).toBe(true);
    const next = ok(answerPanel(t, t.panels[0].id, { sccrA: 22_000 }));
    expect(next.panels[0].sccrA).toBe(22_000);
    expect(findInterviewItem(interviewOf(next, MICROS, false), need)).toBeNull();
    expect(refused(answerPanel(t, t.panels[0].id, { sccrA: 0 }))).toMatch(/positive number read off the panel label/);
    expect(reload(next).panels[0].sccrA).toBe(22_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · "HOW DOES THE NEW SOLAR CONNECT?" — where no question asks it, and changing a recorded one
// ═══════════════════════════════════════════════════════════════════════════

describe('the PV coupling is answerable in System Config on every job', () => {
  it('the engine\'s need carries only the answers the equipment supports', () => {
    const t = ok(answerServiceRating(null, 200));
    const need = (eq: InterviewEquipment, pvCount = 37) => {
      const iv = buildSystemConfigInterview({
        pvArray: resolvePvArrayDesign({ placedModuleCount: pvCount, selectedPanelId: 'panel-fence-ps1' }),
        topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false, equipment: eq,
        evaluation: evaluateServiceTopology(t),
      });
      return findInterviewItem(iv, 'engineering.needs.interconnection.solarCoupling');
    };
    // A chosen microinverter: the PV has its own inverter — the one answer, asked as one.
    expect(need(MICROS)!.options!.map(o => o.value)).toEqual(['ac-coupled-inverter']);
    expect(hasItemEditor(need(MICROS)!, t)).toBe(true);
    // No inverter chosen, storage with PV inputs: either.
    expect(need({ ...PW3_EQ, pvInverter: { state: 'UNDECIDED' } })!.options!.map(o => o.value))
      .toEqual(['dc-coupled-storage', 'ac-coupled-inverter']);
    // No inverter chosen and nothing else to land on: choosing the inverter IS the answer — no
    // one-option question about an inverter that does not exist.
    expect(need({ ...MICROS, pvInverter: { state: 'UNDECIDED' } })!.options).toBeUndefined();
    // No PV, storage: storage only.
    expect(need(PW3_EQ, 0)!.options!.map(o => o.value)).toEqual(['storage-only']);
    // In conflict it is resolved where the conflict is raised — no second control.
    expect(need({ ...MICROS, pvInverter: { state: 'CONFLICT' } })!.options).toBeUndefined();
  });

  it('answerSolarCoupling writes the graph\'s one coupling; the engine\'s check passes on it and it survives the store', () => {
    const t = ok(answerServiceRating(null, 200));
    const next = ok(answerSolarCoupling(t, 'ac-coupled-inverter'));
    expect(next.solarCoupling).toBe('ac-coupled-inverter');
    expect(evaluateServiceTopology(next).checks.find(c => c.id === 'pv.coupling')!.conclusion).toBe('PASS');
    expect(reload(next).solarCoupling).toBe('ac-coupled-inverter');
    expect(refused(answerSolarCoupling(t, 'nonsense' as never))).toMatch(/is not a PV coupling/);
  });

  it('🚨 the writer is chosen by what is on file — a recorded decision is CHANGED, never refused into a dead end', () => {
    const w = (coupling: 'dc-coupled-storage' | 'ac-coupled-inverter' | 'storage-only', decisionOnFile: boolean, hasExternalInverter: boolean, hasGraph = true) =>
      pvCouplingWritePath({ coupling, decisionOnFile, hasGraph, hasExternalInverter });
    // A separate inverter on file: the route records the coupling AND retires (DC) / confirms (AC) it…
    expect(w('dc-coupled-storage', false, true)).toEqual({ writer: 'architecture-route', change: false });
    expect(w('ac-coupled-inverter', false, true)).toEqual({ writer: 'architecture-route', change: false });
    // …and a decision already recorded is changed through it deliberately, never on the graph alone
    // (that left the inverter on file and the architecture unresolved).
    expect(w('dc-coupled-storage', true, true)).toEqual({ writer: 'architecture-route', change: true });
    // No inverter on file: nothing to retire or confirm — the graph's coupling is the whole answer.
    expect(w('ac-coupled-inverter', false, false)).toEqual({ writer: 'graph' });
    expect(w('dc-coupled-storage', true, false)).toEqual({ writer: 'graph' });
    // The route does not accept "storage only" at all.
    expect(w('storage-only', false, true)).toEqual({ writer: 'graph' });
    expect(w('dc-coupled-storage', false, true, false)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · THE PARITY GUARD — no required answer is left with only a graph editor to answer it
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Required items that NO surface — the old tab included — could ever answer: documents only a
 * manufacturer can supply, a calculation SolarPro does not perform yet, and the gateway's SCCR (which
 * depends on the main breaker fitted in it; the tab never had a control for it either). Named, so
 * the list can only shrink.
 */
const NO_INSTALLER_CONTROL_ANYWHERE = (id: string) =>
  /^engineering\.needs\.manufacturer-(document|limit):/.test(id)
  || id === 'engineering.disconnect.multi-gateway-doc'
  || /^engineering\.needs\.sccr:.*-gateway$/.test(id)
  || id === 'engineering.needs.poi.supplySideTapConductors'
  || id === 'engineering.needs.poi.connectedToNodeId';

describe('🚨 every required answer on a job built through System Config alone has a System Config editor', () => {
  const jobs: Array<[string, () => { t: ServiceTopology; eq: InterviewEquipment; dc: boolean }]> = [
    ['Ray\'s 400 A / 2 × 200 A / 4 PW3 job, fault current unknown', () => ({ t: raysJobThroughSystemConfig(), eq: PW3_EQ, dc: true })],
    ['the same job after the utility, the site visit and the disconnect parts', () => {
      let t = ok(answerAvailableFaultCurrent(raysJobThroughSystemConfig(), 22_000));
      t = ok(answerExistingService(t, { existing: true, manufacturer: 'Eaton', catalogNumber: 'X', mainArrangement: 'two 200 A mains',
        feederArrangement: 'two', sccrA: 42_000, verified: true }));
      for (const d of t.devices) t = ok(answerDisconnectPart(t, d.id, { productId: 'DG324URB', ratedAmps: 200, sccrA: 65_000 }));
      return { t, eq: PW3_EQ, dc: true };
    }],
    ['the fixture of Ray\'s intended job', () => ({ t: { ...rays(), solarCoupling: 'dc-coupled-storage' as const }, eq: PW3_EQ, dc: true })],
    ['a plain 200 A microinverter house, fault current known', () => {
      let t = ok(answerServiceRating(null, 200));
      t = ok(answerInterconnection(t, 'load-side-busbar'));
      t = ok(answerIsolationRequired(t, false));
      return { t: ok(answerAvailableFaultCurrent(t, 10_000)), eq: MICROS, dc: false };
    }],
    ['a 200 A house with one Powerwall 3 system', () => {
      let t = ok(answerServiceRating(null, 200));
      t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 1 }));
      t = ok(answerStorageLanding(t, 'gateway-panelboard'));
      return { t: { ...t, solarCoupling: 'dc-coupled-storage' as const }, eq: { ...PW3_EQ, storage: { ...PW3_EQ.storage!, count: 1 } }, dc: true };
    }],
    ['partial backup — only MSP #1', () => {
      let t = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
      t = ok(answerBackedUpPanels(t, [t.panels[0].id], { gatewayProductId: GW3, storageProductId: PW3, unitsPerPanel: { [t.panels[0].id]: 2 } }));
      return { t, eq: PW3_EQ, dc: true };
    }],
  ];
  it.each(jobs)('%s', (_name, build) => {
    const { t, eq, dc } = build();
    const queue = requiredQueue(interviewOf(t, eq, dc));
    const deadEnds = queue.filter(i => !hasItemEditor(i, t) && !NO_INSTALLER_CONTROL_ANYWHERE(i.id)).map(i => i.id);
    expect(deadEnds, 'a required answer only a graph editor can give').toEqual([]);
  });
});

describe('🚨 one backup system has nothing to combine with — the engine does not wait on an arrangement nobody can choose', () => {
  it('one system holding every DER source: the arrangement check PASSES with nothing written to the graph', () => {
    let t = ok(answerServiceRating(null, 200));
    t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 2 }));
    expect(t.interconnection.derArrangement).toBeNull();
    const c = evaluateServiceTopology(t).checks.find(x => x.id === 'interconnection.arrangement')!;
    expect(c.conclusion).toBe('PASS');
    expect(c.detail).toMatch(/no second system to combine it with/);
    // System Config does not ask it of one system, and nothing else is left waiting on it.
    const ids = interviewOf(t).sections.flatMap(s => s.items).map(i => i.id);
    expect(ids).not.toContain('behavior.systems');
    expect(ids).not.toContain('engineering.needs.interconnection.derArrangement');
  });

  it('control: two systems still owe the arrangement, asked as "Systems connect" on the System Configuration card', () => {
    const t = ok(answerBackup(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')), 'whole',
      { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 2, unitsPerPanel: { 'msp-1': 1, 'msp-2': 1 } }));
    expect(evaluateServiceTopology(t).checks.find(x => x.id === 'interconnection.arrangement')!.conclusion).toBe('NOT_EVALUATED');
    expect(requiredQueue(interviewOf(t)).map(i => i.id)).toContain('behavior.systems');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · A REFUSAL THAT SENDS AN EDIT ELSEWHERE NAMES A PLACE THAT EXISTS
// ═══════════════════════════════════════════════════════════════════════════

describe('refusals name the Advanced service model editor where it actually is', () => {
  it('distribution under equipment, a partial shared panel, a system with dependents', () => {
    const r = answerDistribution(rays(), 'one-main-panel');
    expect(refused(r)).toContain(ADVANCED_EDITOR);
    expect(ADVANCED_EDITOR).toBe('the Advanced service model editor (Engineering Readiness → Review Engineering)');
    const sys = answerBackedUpPanels(rays(), ['msp-1'], { gatewayProductId: GW3, storageProductId: PW3 });
    expect(refused(sys)).toContain(`Remove System 2 in ${ADVANCED_EDITOR}`);
  });

  it('no lib refusal still says a bare "in Advanced."', () => {
    for (const f of ['lib/electrical/systemConfigAnswers.ts', 'lib/electrical/systemConfigSystemEquipment.ts']) {
      expect(readFileSync(resolve(process.cwd(), f), 'utf8'), f).not.toMatch(/in Advanced[.,'`]/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · THE PAGE — no tab, no entry point, the graph still loaded by the page
// ═══════════════════════════════════════════════════════════════════════════

const PAGE = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
/** The page's live code: line comments, JSX comments and block comments removed. */
const LIVE = PAGE
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

describe('🚨 the Engineering page: Service Topology is not in the navigation', () => {
  it('the tab list holds no service entry, and the tab id type cannot name one', () => {
    const tabs = LIVE.slice(LIVE.indexOf('const tabs: { id: TabId'), LIVE.indexOf('];', LIVE.indexOf('const tabs: { id: TabId')));
    expect(tabs).toContain("id: 'config'");
    expect(tabs).not.toMatch(/id:\s*'service'/);
    expect(tabs).not.toContain('Service Topology');
    const tabType = LIVE.match(/type TabId = ([^;]+);/)![1];
    expect(tabType).toContain("'config'");
    expect(tabType).not.toContain("'service'");
  });

  it('no normal-navigation entry point remains: no tab body, no setter, no test id, no URL tab parse', () => {
    expect(LIVE).not.toMatch(/activeTab\s*===\s*'service'/);
    expect(LIVE).not.toMatch(/setActiveTab\(\s*'service'\s*\)/);
    expect(LIVE).not.toContain('engineering-service-tab');
    // The page never reads a `tab` search parameter, so a stale ?tab=service lands on the default —
    // and the default is System Config.
    expect(LIVE).not.toMatch(/searchParams\?*\.get\(\s*'tab'\s*\)/);
    expect(LIVE).toContain("const [activeTab, setActiveTab] = useState<TabId>('config');");
  });

  it('the graph editor is mounted ONCE, as the Advanced editor inside the readiness panel, saving through the one write path', () => {
    const mounts = LIVE.match(/<ServiceTopologyBuilder\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    const at = LIVE.indexOf('<ServiceTopologyBuilder');
    const panel = LIVE.lastIndexOf('<EngineeringReadinessPanel', at);
    expect(panel).toBeGreaterThan(0);
    expect(LIVE.slice(panel, at)).toContain('advancedEditor={');
    const mount = LIVE.slice(at, LIVE.indexOf('/>', at));
    // 🚨 It edits THE PAGE'S graph and read state (no private GET whose copy goes stale beside the
    // cards), and saves through the one write path.
    expect(mount).toContain('topology: svcTopology, read: svcTopologyRead,');
    expect(mount).toContain('save: next => writeInterviewAnswer(next,');
    expect(mount).not.toContain('fetchImpl');
    // It does not hand unsaved edits up to the page's copy of the graph any more.
    expect(mount).not.toContain('onTopologyChange');
  });

  it('the page still loads the graph itself — keyed on the project, not on a tab', () => {
    const fetchIdx = LIVE.indexOf('}/service-topology`');
    const start = LIVE.lastIndexOf('useEffect(', fetchIdx);
    const end = LIVE.indexOf(']);', LIVE.indexOf('}, [', fetchIdx));
    const effect = LIVE.slice(start, end + 3);
    expect(effect).toContain('setSvcTopology(data.topology');
    expect(effect).toContain('}, [currentProjectId, _svcTopologyReloadKey]);');
    expect(effect).not.toContain('activeTab');
  });

  it('the PV connection is recorded by the writer that can record it (the route when an inverter is on file, a change included)', () => {
    const ctx = LIVE.slice(LIVE.indexOf('const interviewEditorContext = {'), LIVE.indexOf('};', LIVE.indexOf('onRecordCoupling:')));
    expect(ctx).toContain('pvCouplingWritePath({');
    expect(ctx).toContain("decisionOnFile: _archServer?.provenanceSource === 'service-topology'");
    expect(ctx).toContain('hasExternalInverter: !!_archDetail?.externalInverter || !!electrical?.hasExternalInverter');
    expect(ctx).toContain('applyInterviewAnswer(answerSolarCoupling(svcTopology');
    expect(ctx).toContain(": resolveElectricalArchitecture(coupling, { change: path.writer === 'architecture-route' && path.change })");
  });
});
