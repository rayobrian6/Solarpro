// ═══════════════════════════════════════════════════════════════════════════
// 🚨 AN APPLIED 120% REMEDY — EVERY CONSUMER AGREES WITH THE GRAPH, OR THE PACKAGE CONTRADICTS ITSELF.
//
// Review of the busbar-apply slice (closure brief §5: "the 120% evaluation re-runs against the
// post-remedy rating … the permit carries the scope"). Found after [Apply]:
//   · the permit's own verdict, title block, PV-4B arithmetic, readiness blocker and Step 1 still ran on
//     the installed main — "PASS" on E-1, "EXCEEDS 120%" on the cover, and a blocker telling the
//     installer to apply the derate the package already recorded;
//   · the compliance engine raised "NOT EVALUATED — load calculation" whatever the graph concluded;
//   · the fault-current chain certified the replacement equipment on the replaced equipment's SCCR;
//   · the legacy MAIN_BREAKER_DERATE token still reached E-1 as the interconnection;
//   · the compliance tab promised an [Apply] on PV-only jobs that have none;
//   · clearing an installed reading left a remedy "replacing the installed unrecorded main".
// Each is proved here against the one owner (`PanelBoard.remedy`) — and, for the permit, on the whole
// rendered package. (The BOM route is proved on real PostgreSQL in
// busbarRemedyReachesTheSheet.postgres.test.ts.)
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import {
  answerBusbarRemedy, answerRemoveBusbarRemedy, answerPanel, answerInterconnection, answerServiceRating,
  type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import {
  evaluateServiceTopology, REMEDY_SCCR_TOKEN, type LoadModel, type ServiceTopology,
} from '@/lib/electrical/serviceTopology';
import { panelsOfferingBusbarRemedy } from '@/lib/electrical/systemConfigServiceCard';
import { appliedRemedyKey, complianceInterconnection } from '@/lib/electrical/systemConfigLegacyInterconnection';
import { buildServiceOverview } from '@/lib/electrical/topologyOverview';
import { serviceTopologyReleaseReadiness } from '@/lib/permit/utils/serviceTopologySchedule';
import { runElectricalCalc, type ElectricalCalcInput } from '@/lib/electrical-calc';
import { ecStringInput } from './goldens/wave0-fixtures';
import { roofProject } from '../test-fixtures/roofProject';
import { generatePermitHTML } from '@/lib/permit/generatePermit';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const refusal = (r: AnswerResult): string => { if (r.ok === false) return r.refused; throw new Error(`expected a refusal, got: ${r.did}`); };
const failing = (loads: LoadModel | null = null) =>
  buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar', loads }).topology;
const loadsOf = (a: number): LoadModel => ({
  method: 'standard-220-part-iii', basis: 'test', byPanel: [{ panelId: 'msp-1', calculatedDemandA: a }],
});
const derated = (amps = 150, loads: LoadModel | null = null) =>
  ok(answerBusbarRemedy(failing(loads), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: amps }));
const upgraded = (amps = 225) => ok(answerBusbarRemedy(failing(), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: amps }));
const check = (t: ServiceTopology, id: string) => evaluateServiceTopology(t).checks.find(c => c.id === id) ?? null;

// ── The permit package ─────────────────────────────────────────────────────

/** The probe the review used: the primary panel at 100 A main / 100 A bus — the micro array's 25 A
 *  breaker exceeds the 20 A allowed, so the package FAILS until a remedy is applied. */
const small = (loads: LoadModel | null = null) =>
  ok(answerPanel(failing(loads), 'msp-1', { mainBreakerA: 100, busbarRatingA: 100 }));
const pkg = (t: ServiceTopology | null, over: Record<string, unknown> = {}) => {
  const p = JSON.parse(JSON.stringify(roofProject));
  Object.assign(p.project, { mainPanelAmps: 100, panelBusRating: 100, interconnectionMethod: 'LOAD_SIDE', ...over });
  if (t) p.project.serviceTopology = t;
  return generatePermitHTML(p).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
};

describe('🚨 the permit package — one 120% verdict, on the panel as permitted', () => {
  it('control: without [Apply] the package fails the 120% rule everywhere it states it', () => {
    const html = pkg(small());
    expect(html).toContain('EXCEEDS 120%');
    expect(html).toContain('NEC-705-12B-EXCEEDED');
    expect(html).toContain('100A bus × 120% = 120A max; minus 100A main = 20A for PV');
  });

  it('after a 70 A derate: no "EXCEEDS 120%" anywhere, no blocker asking for the derate it records, and the arithmetic is the post-work panel', () => {
    const html = pkg(ok(answerBusbarRemedy(small(), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 70 })));
    expect(html).not.toContain('EXCEEDS 120%');
    expect(html).not.toContain('NEC-705-12B-EXCEEDED');
    expect(html).not.toMatch(/exceeds the busbar allowance/i);
    // The cover and PV-4B agree with the schedule's (E) → (N).
    expect(html).toContain('PASS — 120% BUSBAR RULE');
    expect(html).toContain('100A bus × 120% = 120A max; minus 70A (N) main = 50A for PV (with the proposed replacement main breaker 70 A)');
    expect(html).toContain('PASS WITH PROPOSED WORK');
    expect(html).toContain('100 A main (E) → 70 A main (N)');
    expect(html).toContain('70A (N) main service disconnect / 100A busbar — PROPOSED WORK (NEC 705.12(B) remedy) — Main service panel: Replacement main breaker 70 A, replaces the installed 100 A main.');
    // 🚨 Step 1 no longer says a load calculation is "not required" — a derate requires one.
    expect(html).not.toContain('Not required for the selected interconnection method');
    expect(html).toContain('Load Calculation — Derated Main Breaker');
    expect(html).toContain('LOAD CALCULATION REQUIRED — no load calculation covers this panel.');
    // The installed panel is still printed as installed where the package states what is on the wall.
    expect(html).toContain('(E) 100A MAIN SERVICE PANEL');
    expect(html).toContain('(E) 100 A → (N) 70 A main');
    // …and the permit's own BOM sizes the backfeed breaker on the panel after the work, saying so.
    expect(html).toContain('(bus: 100A, PV max: 50A) — on the panel after the proposed work (Main service panel: Replacement main breaker 70 A, replaces the installed 100 A main)');
  });

  it('Step 1 restates the graph\'s verdict once a load calculation covers the panel — PASS and FAIL', () => {
    const pass = pkg(ok(answerBusbarRemedy(small(loadsOf(60)), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 70 })));
    expect(pass).toContain('60.0 A calculated load on Main service panel fits the proposed 70 A main breaker.');
    const fail = pkg(ok(answerBusbarRemedy(small(loadsOf(90)), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: 70 })));
    expect(fail).toContain('90.0 A calculated load on Main service panel exceeds the proposed 70 A main breaker');
  });

  it('a replacement panelboard: the arithmetic runs on its new bus, marked (N)', () => {
    const html = pkg(ok(answerBusbarRemedy(small(), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: 125 })));
    expect(html).not.toContain('EXCEEDS 120%');
    expect(html).toContain('125A (N) bus × 120% = 150A max; minus 100A (N) main = 50A for PV');
    expect(html).toContain('installed at the load end of the new 125A busbar');
  });

  it('🚨 a MAIN_BREAKER_DERATE / PANEL_UPGRADE token never reaches the sheet as the interconnection', () => {
    for (const token of ['MAIN_BREAKER_DERATE', 'PANEL_UPGRADE']) {
      const html = pkg(null, { interconnectionMethod: token });
      expect(html, token).not.toContain(token);
      // …and nothing honours it as a remedy: the 100/100 panel still FAILS the 120% rule.
      expect(html, token).toContain('EXCEEDS 120%');
    }
  });
});

// ── The page's compliance engine ───────────────────────────────────────────

describe('🚨 the compliance engine restates the graph\'s verdict on the derate\'s load calculation', () => {
  const calc = (t: ServiceTopology) => runElectricalCalc({
    ...ecStringInput(),
    interconnection: complianceInterconnection({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, t) as ElectricalCalcInput['interconnection'],
  });
  const codes = (r: ReturnType<typeof calc>) => [...r.errors, ...r.warnings, ...r.infos].map(i => i.code);

  it('no load calculation → NOT EVALUATED (warning), as the graph says', () => {
    expect(check(derated(150), 'panel.remedy-load-calculation')!.conclusion).toBe('NOT_EVALUATED');
    expect(codes(calc(derated(150)))).toContain('W-DERATE-LOAD-CALC-REQUIRED');
  });

  it('a load that fits → PASS (info) — the standing "not evaluated" clears', () => {
    const r = calc(derated(150, loadsOf(120)));
    expect(codes(r)).toContain('I-DERATE-LOAD-CALC-OK');
    expect(codes(r)).not.toContain('W-DERATE-LOAD-CALC-REQUIRED');
    expect(r.infos.find(i => i.code === 'I-DERATE-LOAD-CALC-OK')!.message)
      .toContain('120.0 A calculated load on Main service panel fits the proposed 150 A main breaker');
  });

  it('a load that does not fit → an ERROR, never a pass with a reminder', () => {
    const r = calc(derated(150, loadsOf(180)));
    expect(r.errors.map(e => e.code)).toContain('E-DERATE-LOAD-EXCEEDS');
    expect(codes(r)).not.toContain('W-DERATE-LOAD-CALC-REQUIRED');
    expect(r.status).toBe('FAIL');
    expect(r.errors.find(e => e.code === 'E-DERATE-LOAD-EXCEEDS')!.message).toContain('the derate does not work for this panel');
  });

  it('a panelboard replacement owes no load calculation', () => {
    expect(complianceInterconnection({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, upgraded(225))
      .proposedWork!.loadCalculation).toBeUndefined();
  });
});

// ── Fault current ──────────────────────────────────────────────────────────

describe('🚨 a replacement does not inherit the replaced equipment\'s interrupting rating', () => {
  const rated = (t: ServiceTopology): ServiceTopology => ({
    ...t,
    service: { ...t.service, availableFaultCurrentA: 10000 },
    devices: t.devices.map(d => ({ ...d, sccrA: 22000 })),
    domains: t.domains.map(d => ({ ...d, gateway: { ...d.gateway, sccrA: 22000 } })),
    panels: t.panels.map(p => ({ ...p, sccrA: 22000 })),
  });
  const sccr = (t: ServiceTopology) => check(t, 'sccr.chain')!;

  it('control: every device rated → the chain PASSES', () => {
    expect(sccr(rated(failing())).conclusion).toBe('PASS');
  });

  it('a replacement panelboard and a derate both leave the chain NOT EVALUATED for that panel', () => {
    for (const t of [rated(upgraded(225)), rated(derated(150))]) {
      const c = sccr(t);
      expect(c.conclusion).toBe('NOT_EVALUATED');
      expect(c.requires).toEqual([`${REMEDY_SCCR_TOKEN}msp-1`]);
      expect(c.detail).toContain('Main service panel after the proposed work');
    }
  });

  it('the requirement is named for the replacement, owed by its manufacturer, and printed on the permit', () => {
    const t = rated(upgraded(225));
    const need = buildServiceOverview(t, evaluateServiceTopology(t)).requiredInputs.find(r => r.key === `${REMEDY_SCCR_TOKEN}msp-1`)!;
    expect(need.label).toBe('Interrupting rating (SCCR) of the replacement panelboard 225 A bus, 200 A main on Main service panel — not the installed panel\'s');
    expect(need.owner).toBe('manufacturer-authority');
    expect(need.focus).toEqual({ kind: 'panel', nodeId: 'msp-1', field: 'remedy' });
    expect(serviceTopologyReleaseReadiness(t).requirements).toContain(
      'NOT EVALUATED — INTERRUPTING RATING OF THE PROPOSED REPLACEMENT REQUIRED (MAIN SERVICE PANEL) — RATE AT OR ABOVE THE 10000 A AVAILABLE');
  });

  it('[Remove] puts the installed rating back in the chain', () => {
    expect(sccr(rated(ok(answerRemoveBusbarRemedy(upgraded(225), 'msp-1')))).conclusion).toBe('PASS');
  });
});

// ── The writer's invariant, the pointer, and the re-run key ────────────────

describe('the remedy keeps the readings it was worked out from', () => {
  it('clearing an installed reading under an applied remedy is refused; changing it is not', () => {
    expect(refusal(answerPanel(derated(150), 'msp-1', { mainBreakerA: null }))).toMatch(/Remove the proposed work before clearing/);
    expect(refusal(answerPanel(upgraded(225), 'msp-1', { busbarRatingA: null }))).toMatch(/Remove the proposed work before clearing/);
    expect(answerPanel(derated(150), 'msp-1', { mainBreakerA: 175 }).ok).toBe(true);
    expect(answerPanel(failing(), 'msp-1', { mainBreakerA: null }).ok).toBe(true);
  });
});

describe('🚨 the compliance tab points at [Apply] only where the Service card offers one', () => {
  it('a backed-up panel that FAILS offers one; a PV-only load-side job has no per-panel check and offers none', () => {
    expect(panelsOfferingBusbarRemedy(failing(), evaluateServiceTopology(failing()).checks)).toEqual(['msp-1']);
    const pvOnly = ok(answerPanel(ok(answerInterconnection(ok(answerServiceRating(null, 200)), 'load-side-busbar')),
      'msp-1', { mainBreakerA: 200, busbarRatingA: 100 }));
    expect(panelsOfferingBusbarRemedy(pvOnly, evaluateServiceTopology(pvOnly).checks)).toEqual([]);
    // …while the legacy single-panel engine still FAILS it and lists the derate / upgrade alternatives.
    const legacy = runElectricalCalc({ ...ecStringInput(),
      interconnection: complianceInterconnection({ method: 'LOAD_SIDE', busRating: 100, mainBreaker: 200 }, pvOnly) as ElectricalCalcInput['interconnection'] });
    expect(legacy.interconnection.alternatives?.map(a => a.method)).toEqual(['SUPPLY_SIDE_TAP', 'MAIN_BREAKER_DERATE', 'PANEL_UPGRADE']);
    // Once applied, the FAIL is gone and so is the offer.
    expect(panelsOfferingBusbarRemedy(derated(150), evaluateServiceTopology(derated(150)).checks)).toEqual([]);
  });
});

describe('the re-run key moves with every [Apply] / [Remove]', () => {
  it('empty without a remedy, distinct per remedy, empty again after [Remove]', () => {
    expect(appliedRemedyKey(failing())).toBe('');
    const keys = [derated(150), derated(125), upgraded(225), upgraded(250)].map(appliedRemedyKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys.every(k => k.startsWith('msp-1:'))).toBe(true);
    expect(appliedRemedyKey(ok(answerRemoveBusbarRemedy(derated(150), 'msp-1')))).toBe('');
  });
});
