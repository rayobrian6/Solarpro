// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE 120% RULE — A SUGGESTION UNTIL [Apply], AND THEN THE ENGINEERING OWNER.
//
// Ray (closure brief §5): "Derate main / panel upgrade are recommendations only and not written into
// anything the SLD/BOM reads. Acceptable while they remain suggestions. Do not silently apply them. But
// if the user explicitly clicks an Apply action, that action must write the actual engineering owner
// consumed by sizing, SLD, BOM, permit — and survive reload."
//
// The owner is `PanelBoard.remedy` — PROPOSED WORK beside the installed readings, never in place of
// them. This file proves the pure half of that law, writer and every consumer:
//   · the writer (`answerBusbarRemedy` / `answerRemoveBusbarRemedy`) and its refusals;
//   · the engine re-runs NEC 705.12(B) on the panel AFTER the work, and a derate still raises its load
//     calculation as a REQUIRED (non-optional) NOT EVALUATED — never a quiet PASS;
//   · the interview / readiness / overview, the db parse, the revision, the SLD rows, the topology BOM,
//     the permit schedule and the page's compliance input all read it;
//   · the legacy MAIN_BREAKER_DERATE / PANEL_UPGRADE scalar token is a NOTE — never a second authority.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import {
  answerBusbarRemedy, answerRemoveBusbarRemedy, answerPanel, answerInterconnection, answerServiceRating,
  type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  evaluateServiceTopology, effectivePanelRatings, isOptionalCheck, REMEDY_LOAD_CALCULATION_TOKEN,
  type LoadModel, type ServiceTopology,
} from '@/lib/electrical/serviceTopology';
import { busbarRemedies, panelBusbarCheck, panelRecordedFacts } from '@/lib/electrical/systemConfigServiceCard';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { allInterviewItems, isRequiredUnresolved } from '@/lib/electrical/systemConfigPlacement';
import { buildServiceOverview } from '@/lib/electrical/topologyOverview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { parseServiceTopology, serialiseServiceTopology } from '@/lib/db/serviceTopology';
import { resolveElectricalProject } from '@/lib/electrical/projectModel';
import { electricalRevision, revisionInputs } from '@/lib/electrical/revision';
import { bomFromServiceTopology, pricedQuantitiesFromBom, isProposedWorkLine } from '@/lib/bom/topologyBom';
import { reconcileQuantities } from '@/lib/electrical/topologyEquipment';
import {
  serviceTopologyScheduleRows, serviceTopologyReleaseReadiness,
} from '@/lib/permit/utils/serviceTopologySchedule';
import {
  appliedPanelRemedies, complianceInterconnection, consumerInterconnectionToken, legacyInterconnectionMirror,
  legacyRemedyNote,
} from '@/lib/electrical/systemConfigLegacyInterconnection';
import { renderSLDProfessional } from '@/lib/sld-professional-renderer';
import { runElectricalCalc, type ElectricalCalcInput } from '@/lib/electrical-calc';
import { ecStringInput } from './goldens/wave0-fixtures';
import { roofProject } from '../test-fixtures/roofProject';
import { generatePermitHTML } from '@/lib/permit/generatePermit';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const refusal = (r: AnswerResult): string => { if (r.ok === false) return r.refused; throw new Error(`expected a refusal, got: ${r.did}`); };
/** One Powerwall 3 landing on a 200 A bus with a 200 A main: 48 A of backfeed against 40 A allowed. */
const failing = (loads: LoadModel | null = null) =>
  buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar', loads }).topology;
const busbar = (t: ServiceTopology) => evaluateServiceTopology(t).checks.find(c => c.id === 'domain.busbar-705-12')!;
const check = (t: ServiceTopology, id: string) => evaluateServiceTopology(t).checks.find(c => c.id === id) ?? null;
const derated = (amps = 150, loads: LoadModel | null = null) =>
  ok(answerBusbarRemedy(failing(loads), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: amps }));
const upgraded = (amps = 225) => ok(answerBusbarRemedy(failing(), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: amps }));
const loadsOf = (a: number): LoadModel => ({
  method: 'standard-220-part-iii', basis: 'test', byPanel: [{ panelId: 'msp-1', calculatedDemandA: a }],
});

describe('the writer — [Apply] records proposed work, never a reading', () => {
  it('a derate writes `remedy` and NOTHING else: the installed 200 A main and 200 A bus stay recorded', () => {
    const before = failing();
    const after = derated(150);
    const p = after.panels[0];
    expect(p.remedy).toEqual({ kind: 'replace-main-breaker', mainBreakerA: 150 });
    expect([p.mainBreakerA, p.busbarRatingA]).toEqual([200, 200]);
    // Every other part of the graph is the same object graph, field for field.
    expect({ ...after, panels: after.panels.map(({ remedy: _r, ...x }) => x) }).toEqual(before);
  });

  it('a busbar upgrade records a replacement panelboard with the installed main\'s rating', () => {
    expect(upgraded(225).panels[0].remedy).toEqual({ kind: 'replace-panelboard', busbarRatingA: 225, mainBreakerA: 200 });
    expect(upgraded(225).panels[0].busbarRatingA).toBe(200);
  });

  it('applying another remedy REPLACES the first — one per panel', () => {
    const t = ok(answerBusbarRemedy(derated(150), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: 225 }));
    expect(t.panels[0].remedy?.kind).toBe('replace-panelboard');
  });

  it('[Remove] takes the key off — the panel serialises exactly as one that never had a remedy', () => {
    const t = ok(answerRemoveBusbarRemedy(derated(150), 'msp-1'));
    expect('remedy' in t.panels[0]).toBe(false);
    expect(t).toEqual(failing());
    expect(refusal(answerRemoveBusbarRemedy(failing(), 'msp-1'))).toMatch(/no proposed work/);
  });

  it('🚨 refuses rather than guesses', () => {
    const t = failing();
    expect(refusal(answerBusbarRemedy(t, 'nope', { kind: 'replace-main-breaker', mainBreakerA: 150 }))).toMatch(/No panel/);
    const unread = ok(answerPanel(t, 'msp-1', { mainBreakerA: null }));
    expect(refusal(answerBusbarRemedy(unread, 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 150 })))
      .toMatch(/installed main breaker and busbar first/);
    expect(refusal(answerBusbarRemedy(t, 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 160 })))
      .toMatch(/not a standard main breaker rating/);
    expect(refusal(answerBusbarRemedy(t, 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 200 })))
      .toMatch(/SMALLER/);
    expect(refusal(answerBusbarRemedy(t, 'msp-1', { kind: 'replace-panelboard', busbarRatingA: 200 })))
      .toMatch(/LARGER/);
  });

  it('the card offers a derate only in sizes somebody can buy (NEC 240.6(A)) — every one of which the writer accepts', () => {
    const t = failing();
    const r = busbarRemedies(t.panels[0], panelBusbarCheck(t, evaluateServiceTopology(t).checks, 'msp-1'))!;
    expect(r.derateMain.map(x => x.amps)).toEqual([175, 150, 125, 110, 100]);
    for (const o of r.derateMain) expect(answerBusbarRemedy(t, 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: o.amps }).ok).toBe(true);
    for (const o of r.upgradeBus) expect(answerBusbarRemedy(t, 'msp-1', { kind: 'replace-panelboard', busbarRatingA: o.amps }).ok).toBe(true);
  });

  it('a rebuild of the panels names the applied remedy among what it discards', () => {
    expect(panelRecordedFacts(derated(150))).toEqual(['Main service panel: Main 200 A · Bus 200 A · proposed: Replacement main breaker 150 A']);
  });
});

describe('🚨 the engine re-runs NEC 705.12(B) on the panel AFTER the work', () => {
  it('without a remedy the panel FAILS; a 150 A derate PASSES the busbar arithmetic, and says it is proposed', () => {
    expect(busbar(failing()).conclusion).toBe('FAIL');
    const c = busbar(derated(150));
    expect(c.conclusion).toBe('PASS');
    expect(c.detail).toContain('48.0 A of backfeed against 90.0 A allowed (200 A bus, 150 A main)');
    expect(c.detail).toContain('with the proposed replacement main breaker 150 A (replaces the installed 200 A main)');
  });

  it('a 225 A replacement panelboard PASSES on its own bus (70 A allowed)', () => {
    const c = busbar(upgraded(225));
    expect(c.conclusion).toBe('PASS');
    expect(c.detail).toContain('against 70.0 A allowed (225 A bus, 200 A main)');
    expect(check(upgraded(225), 'panel.remedy-load-calculation')).toBeNull();
  });

  it('an insufficient remedy still FAILS — the engine does not take [Apply] as a pass', () => {
    // 200 A main on a 200 A bus, a 175 A derate: 65 A allowed — enough for 48 A. A 400 A main on the
    // same bus is not on the ladder, so prove it with the arithmetic the engine actually ran instead.
    expect(effectivePanelRatings(derated(175).panels[0])).toEqual({ busbarRatingA: 200, mainBreakerA: 175 });
    const twoPw = ok(answerBusbarRemedy(
      buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar', powerwalls: 2 }).topology,
      'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 175 }));
    expect(busbar(twoPw).conclusion).toBe('FAIL');
    expect(busbar(twoPw).detail).toContain('with the proposed replacement main breaker 175 A');
  });

  it('🚨 a derate raises the LOAD CALCULATION it still needs — NOT EVALUATED, REQUIRED, never optional', () => {
    const t = derated(150);
    const lc = check(t, 'panel.remedy-load-calculation')!;
    expect(lc.conclusion).toBe('NOT_EVALUATED');
    expect(lc.requires).toEqual([`${REMEDY_LOAD_CALCULATION_TOKEN}msp-1`]);
    expect(isOptionalCheck(lc), 'a derate\'s load calculation must not hide among the optional ones').toBe(false);
    expect(lc.detail).toMatch(/^LOAD CALCULATION REQUIRED/);
    // So the design is NOT a pass overall, even though the busbar arithmetic is.
    expect(evaluateServiceTopology(t).overall).not.toBe('PASS');
  });

  it('…and with the panel\'s calculated load it is a verdict: 120 A fits 150 A, 160 A does not', () => {
    expect(check(derated(150, loadsOf(120)), 'panel.remedy-load-calculation')!.conclusion).toBe('PASS');
    const over = check(derated(150, loadsOf(160)), 'panel.remedy-load-calculation')!;
    expect(over.conclusion).toBe('FAIL');
    expect(over.detail).toContain('160.0 A calculated load on Main service panel exceeds the proposed 150 A');
  });

  it('a remedy that is no longer a remedy (the installed main now reads 150 A) FAILS as a contradiction', () => {
    const t = ok(answerPanel(derated(150), 'msp-1', { mainBreakerA: 150 }));
    const c = check(t, 'panel.remedy')!;
    expect(c.conclusion).toBe('FAIL');
    expect(c.detail).toMatch(/not smaller than the installed 150 A main/);
  });
});

describe('the interview, readiness and overview read it', () => {
  const interviewOf = (t: ServiceTopology) => buildSystemConfigInterview({
    pvArray: resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' }),
    topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
    equipment: { pvInverter: { state: 'NONE', label: null, kind: null }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });

  it('the derate\'s load calculation is a REQUIRED action in the readiness queue, named by its panel', () => {
    const items = allInterviewItems(interviewOf(derated(150)));
    const need = items.find(i => i.id === `engineering.needs.${REMEDY_LOAD_CALCULATION_TOKEN}msp-1`)!;
    expect(need).toBeTruthy();
    expect(need.question).toBe('Load calculation for Main service panel — its load must fit the derated 150 A main breaker');
    expect(isRequiredUnresolved(need)).toBe(true);
    // Not asked before [Apply]; gone after [Remove].
    expect(allInterviewItems(interviewOf(failing())).some(i => i.id.includes(REMEDY_LOAD_CALCULATION_TOKEN))).toBe(false);
  });

  it('the panel question states the reading AND the proposed work — never the new figure as the reading', () => {
    const item = allInterviewItems(interviewOf(derated(150))).find(i => i.id === 'service.panel.msp-1')!;
    expect(item.answer).toBe('Main 200 A · Bus 200 A · proposed: Replacement main breaker 150 A');
  });

  it('the overview owes it to the load analysis (SolarPro calculates it once the load is entered)', () => {
    const ov = buildServiceOverview(derated(150), evaluateServiceTopology(derated(150)));
    const r = ov.requiredInputs.find(x => x.key === `${REMEDY_LOAD_CALCULATION_TOKEN}msp-1`)!;
    expect(r.owner).toBe('solarpro-can-calculate');
    expect(r.focus).toEqual({ kind: 'service', nodeId: 'service', field: 'loads' });
  });
});

describe('🚨 it survives the save, and moves the revision', () => {
  const roundTrip = (t: ServiceTopology) =>
    parseServiceTopology(JSON.parse(JSON.stringify(serialiseServiceTopology(t))), 'as-sent')!.topology;

  it('a derate and a panelboard replacement both reload exactly', () => {
    expect(roundTrip(derated(150)).panels[0].remedy).toEqual({ kind: 'replace-main-breaker', mainBreakerA: 150 });
    expect(roundTrip(upgraded(225)).panels[0].remedy).toEqual({ kind: 'replace-panelboard', busbarRatingA: 225, mainBreakerA: 200 });
  });

  it('a graph that never applied one reloads WITHOUT the key; a partial or unknown record reloads as absent', () => {
    expect('remedy' in roundTrip(failing()).panels[0]).toBe(false);
    const bad = (remedy: unknown) => {
      const raw = JSON.parse(JSON.stringify(serialiseServiceTopology(failing())));
      raw.topology.panels[0].remedy = remedy;
      return parseServiceTopology(raw, 'as-sent')!.topology.panels[0];
    };
    expect('remedy' in bad({ kind: 'replace-main-breaker' })).toBe(false);
    expect('remedy' in bad({ kind: 'replace-panelboard', mainBreakerA: 200 })).toBe(false);
    expect('remedy' in bad({ kind: 'derate', mainBreakerA: 150 })).toBe(false);
    expect('remedy' in bad({ kind: 'replace-main-breaker', mainBreakerA: -5 })).toBe(false);
  });

  it('applying a remedy moves the electrical revision (the sheet is stale); a graph without one is unchanged', () => {
    const model = (t: ServiceTopology) => resolveElectricalProject({ topology: t, selectedEquipment: { inverterId: null, moduleCount: 20 } });
    expect(electricalRevision(model(derated(150)))).not.toBe(electricalRevision(model(failing())));
    expect(electricalRevision(model(derated(150)))).not.toBe(electricalRevision(model(derated(125))));
    expect(revisionInputs(model(failing())).some(x => x.includes('remedy'))).toBe(false);
  });
});

describe('the drawing, the BOM and the permit schedule carry it as NEW WORK', () => {
  const sheet = (t: ServiceTopology) => renderSLDProfessional({
    projectName: 'Remedy', clientName: 'Owner', address: '', designer: 'SolarPro', drawingDate: '', drawingNumber: 'SLD-1',
    revision: 'A', topologyType: 'STRING_INVERTER', totalModules: 20, totalStrings: 2, panelModel: 'PV', panelWatts: 440,
    panelVoc: 40, panelIsc: 14, dcWireGauge: '#10 AWG', dcConduitType: 'EMT', dcOCPD: 20, inverterModel: '', inverterManufacturer: '',
    acOutputKw: 0, acOutputAmps: 0, acWireGauge: '#6 AWG', acConduitType: 'EMT', acOCPD: 0, mainPanelAmps: 200, panelBusRating: 200,
    backfeedAmps: 0, utilityName: 'Utility', interconnection: 'Load Side Tap', rapidShutdownIntegrated: true,
    hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0, scale: 'NTS', acWireLength: 50,
    serviceTopology: t,
  } as Parameters<typeof renderSLDProfessional>[0]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('the SLD draws (N) on the new main and keeps the installed (E) one, marked NEW WORK; nothing of the sort without [Apply]', () => {
    const svg = sheet(derated(150));
    expect(svg).toContain('(N) 150 A MAIN');
    expect(svg).toContain('(E) 200 A MAIN — REPLACED');
    expect(svg).toContain('NEW WORK — MAIN BREAKER DERATE');
    const plain = sheet(failing());
    expect(plain).not.toContain('(N)');
    expect(plain).not.toContain('NEW WORK');
    const up = sheet(upgraded(225));
    expect(up).toContain('(N) 225 A BUS');
    expect(up).toContain('NEW WORK — PANELBOARD REPLACEMENT');
  });

  it('the topology BOM lists the replacement breaker as a requirement — not orderable, not priced, not an instance', () => {
    const bom = bomFromServiceTopology(derated(150));
    const line = bom.items.find(isProposedWorkLine)!;
    expect(line).toBeTruthy();
    expect(line.model).toBe('150 A main breaker — replacement for Main service panel');
    expect(line.quantity).toBe(1);
    expect(line.nonOrderable).toBe(true);
    expect(line.unitCost).toBeUndefined();
    expect(line.description).toContain('NEW WORK (NEC 705.12(B) remedy) — Replacement main breaker 150 A, replaces the installed 200 A main');
    // Not counted against the graph's instances — the reconciliation still agrees.
    expect(reconcileQuantities(derated(150), pricedQuantitiesFromBom(bom))).toEqual([]);
    expect(bomFromServiceTopology(failing()).items.some(isProposedWorkLine)).toBe(false);
    expect(bomFromServiceTopology(upgraded(225)).items.find(isProposedWorkLine)!.model)
      .toBe('225 A bus panelboard, 200 A main — replacement for Main service panel');
  });

  it('the permit schedule states (E) → (N) and the scope; a derate\'s load calculation is an input the sheet requires', () => {
    const row = serviceTopologyScheduleRows(derated(150)).find(r => r.tag === 'MAIN SERVICE PANEL')!;
    expect(row.ocpd).toBe('200 A main (E) → 150 A main (N)');
    expect(row.notes).toContain('PROPOSED WORK (NEC 705.12(B) remedy) — Replacement main breaker 150 A, replaces the installed 200 A main');
    expect(serviceTopologyReleaseReadiness(derated(150)).requirements)
      .toContain('LOAD CALCULATION REQUIRED — DERATED MAIN BREAKER (MAIN SERVICE PANEL)');
    const up = serviceTopologyScheduleRows(upgraded(225)).find(r => r.tag === 'MAIN SERVICE PANEL')!;
    expect(up.rating).toBe('200 A bus (E) → 225 A bus (N)');
    expect(serviceTopologyScheduleRows(failing()).find(r => r.tag === 'MAIN SERVICE PANEL')!.ocpd).toBe('200 A main');
  });
});

describe('🚨 the permit package carries the scope', () => {
  // The permit route projects the stored graph onto `project.serviceTopology` (app/api/engineering/
  // permit/route.ts); this renders the package from that project, the way the route does.
  const pkg = (t: ServiceTopology) => {
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project.serviceTopology = t;
    return generatePermitHTML(p).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  };

  it('the derate is in the package as proposed work, with the load calculation it still needs', () => {
    const html = pkg(derated(150));
    expect(html).toContain('200 A main (E) → 150 A main (N)');
    expect(html).toContain('PROPOSED WORK (NEC 705.12(B) remedy) — Replacement main breaker 150 A, replaces the installed 200 A main');
    expect(html).toContain('LOAD CALCULATION REQUIRED — DERATED MAIN BREAKER (MAIN SERVICE PANEL)');
    expect(html).toContain('NEW WORK — MAIN BREAKER DERATE');
  });

  it('…and nothing of it without [Apply]', () => {
    const html = pkg(failing());
    expect(html).not.toContain('PROPOSED WORK');
    expect(html).not.toContain('NEW WORK —');
    expect(html).not.toMatch(/main \(E\) →|A MAIN — REPLACED|DERATED MAIN BREAKER/);
    expect(html).toContain('200 A main');
  });
});

describe('the page\'s compliance input — the graph\'s remedy, never the scalar\'s token', () => {
  const posted = (method: string) => ({ method, busRating: 200, mainBreaker: 200 });

  it('with a remedy on the primary panel the check re-runs on the post-work ratings and says so', () => {
    expect(complianceInterconnection(posted('LOAD_SIDE'), derated(150))).toEqual({
      method: 'LOAD_SIDE', busRating: 200, mainBreaker: 150,
      proposedWork: { kind: 'replace-main-breaker', panelLabel: 'Main service panel', label: 'Replacement main breaker 150 A',
        replaces: 'replaces the installed 200 A main' },
    });
    expect(complianceInterconnection(posted('LOAD_SIDE'), upgraded(225))).toMatchObject({ busRating: 225, mainBreaker: 200 });
    expect(complianceInterconnection(posted('LOAD_SIDE'), failing())).toEqual(posted('LOAD_SIDE'));
  });

  it('🚨 a MAIN_BREAKER_DERATE / PANEL_UPGRADE token is read as LOAD_SIDE — the scalar records no remedy', () => {
    expect(complianceInterconnection(posted('MAIN_BREAKER_DERATE'), failing()).method).toBe('LOAD_SIDE');
    expect(complianceInterconnection(posted('PANEL_UPGRADE'), null).method).toBe('LOAD_SIDE');
    expect(consumerInterconnectionToken('SUPPLY_SIDE_TAP')).toBe('SUPPLY_SIDE_TAP');
    expect(consumerInterconnectionToken(null)).toBeNull();
  });

  const calc = (ic: ElectricalCalcInput['interconnection']) => runElectricalCalc({ ...ecStringInput(), interconnection: ic });

  it('…because the legacy engine PASSES a derate token whose main is over the limit, and LOAD_SIDE does not', () => {
    // A 100 A bus with a 100 A main: 20 A allowed, far less than this string system's backfeed.
    const asToken = calc({ method: 'MAIN_BREAKER_DERATE', busRating: 100, mainBreaker: 100 });
    expect(asToken.interconnection.passes, 'the legacy token branch "passes" with nothing recorded').toBe(true);
    const asRead = calc(complianceInterconnection({ method: 'MAIN_BREAKER_DERATE', busRating: 100, mainBreaker: 100 }, null) as never);
    expect(asRead.interconnection.passes).toBe(false);
    expect(asRead.errors.some(e => e.code === 'E-BUSBAR-120')).toBe(true);
  });

  it('a derate applied on the graph reaches the engine as proposed work, and raises its load calculation', () => {
    const res = calc(complianceInterconnection({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, derated(150)) as never);
    expect(res.interconnection.mainBreaker).toBe(150);
    expect(res.interconnection.proposedWork?.label).toBe('Replacement main breaker 150 A');
    expect(res.interconnection.message).toContain('Main service panel with the proposed replacement main breaker 150 A');
    expect(res.warnings.some(w => w.code === 'W-DERATE-LOAD-CALC-REQUIRED')).toBe(true);
    const up = calc(complianceInterconnection({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, upgraded(225)) as never);
    expect(up.warnings.some(w => w.code === 'W-DERATE-LOAD-CALC-REQUIRED')).toBe(false);
  });
});

describe('🚨 the page: suggestions are never applied silently, and its legacy paths read the graph', () => {
  const page = readFileSync(resolve(__dirname, '../app/engineering/page.tsx'), 'utf8');

  it('nothing on the page applies a remedy by itself — no Auto / Auto-Fix / hydration path calls the writer', () => {
    // The ONE caller of `answerBusbarRemedy` is the Service card's [Apply] (cards/ServiceControls.tsx).
    expect(page).not.toContain('answerBusbarRemedy');
    expect(page).not.toMatch(/interconnectionMethod:\s*'(MAIN_BREAKER_DERATE|PANEL_UPGRADE)'/);
    expect(page).not.toMatch(/remedy:\s*\{\s*kind:/);
    const controls = readFileSync(resolve(__dirname, '../components/engineering/systemConfig/cards/ServiceControls.tsx'), 'utf8');
    // …and on the card it is reachable only from an [Apply] button's onClick.
    const calls = controls.split('answerBusbarRemedy(').length - 1;
    expect(calls).toBe(2);
    expect(controls).toContain('applyBtn(`${ids}-remedy-apply-derate-${p.id}-${r.amps}`,');
    expect(controls).toContain('applyBtn(`${ids}-remedy-apply-bus-${p.id}-${r.amps}`,');
  });

  it('the compliance request carries the graph\'s remedy (and the scalar token read as LOAD_SIDE)', () => {
    expect(page).toMatch(/interconnection: complianceInterconnection\(\{\s*method: config\.interconnectionMethod \?\? 'UNRESOLVED',/);
    // [Apply] / [Remove] move no config field, so the re-check keys on the applied remedies too.
    expect(page).toMatch(/\}, \[config, engineeringMode, appliedRemedyKey\]\);/);
  });

  it('the BOM request and the schedule never read a remedy token as a remedy', () => {
    expect(page).toContain("interconnectionMethod: consumerInterconnectionToken(config.interconnectionMethod) ?? 'UNRESOLVED',");
    expect(page).not.toMatch(/MAIN_BREAKER_DERATE: 'Main Breaker Derate'/);
    expect(page).not.toMatch(/const isMainDerate = /);
  });
});

describe('🚨 the legacy token is a NOTE — never a second authority', () => {
  const loadSide = () => ok(answerInterconnection(ok(answerServiceRating(null, 200)), 'load-side-busbar'));

  it('without a graph remedy it reads "not applied"; with one, the graph is the record', () => {
    expect(legacyRemedyNote('MAIN_BREAKER_DERATE', failing())).toEqual({ label: 'Main breaker derate', applied: false });
    expect(legacyRemedyNote('PANEL_UPGRADE', derated(150))).toEqual({ label: 'Panel upgrade', applied: true });
    expect(legacyRemedyNote('LOAD_SIDE', derated(150))).toBeNull();
    expect(appliedPanelRemedies(failing())).toEqual([]);
    expect(appliedPanelRemedies(derated(150)).map(r => r.label)).toEqual(['Replacement main breaker 150 A']);
  });

  it('a load-side answer keeps the note while nothing is applied — and replaces it with LOAD_SIDE once a remedy is', () => {
    const t = loadSide();
    expect(legacyInterconnectionMirror(t, 'MAIN_BREAKER_DERATE')).toBeNull();
    const withRemedy = { ...t, panels: t.panels.map(p => ({ ...p, mainBreakerA: 200, busbarRatingA: 200,
      remedy: { kind: 'replace-main-breaker' as const, mainBreakerA: 175 } })) };
    expect(legacyInterconnectionMirror(withRemedy, 'MAIN_BREAKER_DERATE')).toBe('LOAD_SIDE');
    expect(legacyInterconnectionMirror(withRemedy, 'PANEL_UPGRADE')).toBe('LOAD_SIDE');
  });

  it('the token alone never changes the engine: no graph remedy, no post-remedy rating', () => {
    expect(busbar(failing()).conclusion).toBe('FAIL');
    expect(complianceInterconnection({ method: 'MAIN_BREAKER_DERATE', busRating: 200, mainBreaker: 200 }, failing()))
      .toEqual({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 });
  });
});
