// ═══════════════════════════════════════════════════════════════════════════
// BAR (Blocker & Authority Reconciliation) — WS-E electrical closeout gates.
// Directive docs/BLOCKER-AUTHORITY-RECONCILIATION-DIRECTIVE.md §4, §5, §7, §8.
//
// Permanent gates covered here:
//   4  — six-CCC ampacity shows EVERY factor (never a lone multiplied derate)
//   5  — missing ampacity inputs ⇒ PENDING, never PASS
//   6  — grounding outcome is ONE of three and document-backed (never inferred)
//   7  — every surface renders THAT outcome; PENDING is fail-closed
//   9  — sealing caps == actual unused connector objects (topology, not branchCount)
//  10  — terminators == required cable-end objects
//  11  — legend entries == displayed segment wiring methods
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { generateBOMV4 } from '@/lib/bom-engine-v4';
import {
  projectE1PhysicalSchedule, projectAmpacityAdjustment, projectOpenAirBranchGrounding,
  projectListedCableAssembly, ampacityChainLines,
} from '@/lib/permit/snapshot/electricalProjection';
import {
  ampacityTable75C, ampacityTable90C, ambientCorrectionFactor, conductorCountAdjustmentFactor,
} from '@/lib/computed-system';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function gen(): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(roofProject);
  input.project = input.project ?? {};
  input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
  const html = generatePermitHTML(input);
  const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
  return { html, snap, input };
}

// ── §4 / gates 4-5 — the canonical AmpacityAdjustmentResult ──────────────────
describe('§4 — AmpacityAdjustmentResult: every factor, never a lone derate (gates 4, 5)', () => {
  it('the ampacity surface is EXPOSED from computed-system (one set of NEC tables, not re-engineered)', () => {
    // The projection must consume computed-system's OWN tables/factors.
    expect(ampacityTable90C('#10 AWG')).toBe(40);
    expect(ampacityTable75C('#10 AWG')).toBe(35);
    expect(conductorCountAdjustmentFactor(6)).toBe(0.80);   // NEC 310.15(C)(1)
    expect(conductorCountAdjustmentFactor(3)).toBe(1.00);
    expect(ambientCorrectionFactor(33)).toBe(0.96);         // NEC 310.15(B)(1) 30–35 °C
    expect(ampacityTable90C('#999 AWG')).toBeNull();
  });

  it('gate 4 — the shared 6-CCC raceway carries BOTH adjustments itemized (0.80 count AND 0.96 ambient)', () => {
    const a = projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2',
      currentCarryingCount: 6, freeAir: false,
      ambientTempC: 33, tempDeratingFactor: 0.96,
      requiredContinuousA: 20, requiredContinuousBasis: '20A branch × 1.25',
      ocpdA: 20,
    });
    expect(a.present).toBe(true);
    // EVERY factor is a separate field — no merged blob.
    expect(a.baseTableAmpacityA).toBe(40);
    expect(a.baseTableTempC).toBe(90);
    expect(a.currentCarryingCount).toBe(6);
    expect(a.countAdjustmentFactor).toBe(0.80);
    expect(a.countAdjustmentBasis).toMatch(/6 CCC.*310\.15\(C\)\(1\)/);
    expect(a.ambientCorrectionFactor).toBe(0.96);
    expect(a.ambientCorrectionBasis).toMatch(/310\.15\(B\)\(1\)/);
    expect(a.terminalTempLimitC).toBe(75);
    expect(a.terminalTableAmpacityA).toBe(35);
    // corrected = 40 × 0.80 × 0.96 = 30.72; final = min(30.72, 35) = 30.72
    expect(a.correctedAmpacityA).toBeCloseTo(30.72, 2);
    expect(a.finalAllowableAmpacityA).toBeCloseTo(30.72, 2);
    expect(a.finalAllowableBasis).toMatch(/110\.14\(C\)/);
    expect(a.requiredContinuousA).toBe(20);
    expect(a.state).toBe('PASS');            // 30.72 ≥ 20
    expect(a.necReferences).toContain('NEC 310.15(C)(1)');
    expect(a.necReferences).toContain('NEC 110.14(C)');
    expect(a.provenance).toBeTruthy();
  });

  it('gate 4 — the 75 °C terminal limitation CAPS the corrected value when it would exceed it', () => {
    // 3 CCC, 30 °C ⇒ no adjustments: 40 × 1.00 × 1.00 = 40, capped to the 75 °C 35 A.
    const a = projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2',
      currentCarryingCount: 3, freeAir: false,
      ambientTempC: 30, tempDeratingFactor: 1.0,
      requiredContinuousA: 20, requiredContinuousBasis: 'x',
    });
    expect(a.correctedAmpacityA).toBe(40);
    expect(a.finalAllowableAmpacityA).toBe(35);   // 110.14(C) governs
  });

  it('gate 4 — a free-air branch reports the count adjustment as N/A (690.31(C)), not a silent 1.0', () => {
    const a = projectAmpacityAdjustment({
      conductorGauge: '#12 AWG', insulation: 'TC-ER (Q-Cable)',
      currentCarryingCount: 2, freeAir: true,
      ambientTempC: 33, tempDeratingFactor: 0.96,
      requiredContinuousA: 20, requiredContinuousBasis: 'x',
    });
    expect(a.countAdjustmentFactor).toBe(1.0);
    expect(a.countAdjustmentBasis).toMatch(/free air.*N\/A.*690\.31\(C\)/i);
  });

  it('gate 5 — ANY missing input ⇒ PENDING, never PASS', () => {
    const noGauge = projectAmpacityAdjustment({
      conductorGauge: null, insulation: 'THWN-2', currentCarryingCount: 6, freeAir: false,
      ambientTempC: 33, requiredContinuousA: 20, requiredContinuousBasis: 'x',
    });
    expect(noGauge.state).toBe('PENDING');
    expect(noGauge.present).toBe(false);

    const noAmbient = projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2', currentCarryingCount: 6, freeAir: false,
      ambientTempC: null, requiredContinuousA: 20, requiredContinuousBasis: 'x',
    });
    expect(noAmbient.ambientCorrectionFactor).toBeNull();
    expect(noAmbient.state).toBe('PENDING');

    const noCcc = projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2', currentCarryingCount: null, freeAir: false,
      ambientTempC: 33, tempDeratingFactor: 0.96, requiredContinuousA: 20, requiredContinuousBasis: 'x',
    });
    expect(noCcc.countAdjustmentFactor).toBeNull();
    expect(noCcc.state).toBe('PENDING');

    const noLoad = projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2', currentCarryingCount: 6, freeAir: false,
      ambientTempC: 33, tempDeratingFactor: 0.96, requiredContinuousA: null, requiredContinuousBasis: 'x',
    });
    expect(noLoad.state).toBe('PENDING');

    // A genuine over-current condition is FAIL (not silently PASS/PENDING).
    const over = projectAmpacityAdjustment({
      conductorGauge: '#12 AWG', insulation: 'THWN-2', currentCarryingCount: 9, freeAir: false,
      ambientTempC: 46, requiredContinuousA: 25, requiredContinuousBasis: 'x',
    });
    expect(over.state).toBe('FAIL');
  });

  it('gate 4 — every E-1 section carries an ampacity object; the shared home-run itemizes both factors', () => {
    const { snap } = gen();
    const secs = projectE1PhysicalSchedule(snap);
    expect(secs.length).toBeGreaterThan(0);
    for (const s of secs) expect(s.ampacity).not.toBeNull();
    const hr = secs.find(s => s.sectionId === 'BRANCH_HOMERUN_RUN')!;
    expect(hr.ampacity!.present).toBe(true);
    const ccc = snap.electrical.physicalRaceways!
      .find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!.currentCarryingCount;
    // the CCC in the ampacity chain EQUALS the physical raceway inventory
    expect(hr.ampacity!.currentCarryingCount).toBe(ccc);
    expect(hr.ampacity!.countAdjustmentFactor).toBe(conductorCountAdjustmentFactor(ccc));
    expect(hr.ampacity!.baseTableAmpacityA).toBe(ampacityTable90C(hr.conductorSize!));
    expect(hr.ampacity!.terminalTableAmpacityA).toBe(ampacityTable75C(hr.conductorSize!));
  });

  it('gate 4 (rendered) — E-1 / PV-4A / PV-4B all show the itemized chain; the bare "derate 0.96" cell is GONE', () => {
    const { html, snap } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    // the old lone-scalar cell form ("· derate 0.96") no longer renders
    expect(noB64).not.toMatch(/·\s*derate\s*0\.\d\d/);
    // the canonical block appears on all THREE sheets (E-1 full + PV-4A/PV-4B compact)
    const blocks = noB64.match(/SHARED-RACEWAY AMPACITY ADJUSTMENT/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    // every factor is named in the rendered output
    for (const token of ['310.16', '310.15(C)(1)', '310.15(B)(1)', '110.14(C)', 'FINAL ALLOWABLE']) {
      expect(noB64).toContain(token);
    }
    // the numbers rendered are the canonical object's numbers
    const hr = projectE1PhysicalSchedule(snap).find(s => s.sectionId === 'BRANCH_HOMERUN_RUN')!.ampacity!;
    expect(noB64).toContain(`×${hr.countAdjustmentFactor!.toFixed(2)}`);
    expect(noB64).toContain(`×${hr.ambientCorrectionFactor!.toFixed(2)}`);
    // the retired unquantified prose is gone
    expect(noB64).not.toContain('TEMPERATURE DERATING NOTE');
  });

  it('the chain helper never emits a lone scalar; PENDING is explicit', () => {
    const lines = ampacityChainLines(projectAmpacityAdjustment({
      conductorGauge: '#10 AWG', insulation: 'THWN-2', currentCarryingCount: 6, freeAir: false,
      ambientTempC: 33, tempDeratingFactor: 0.96, requiredContinuousA: 20, requiredContinuousBasis: 'x',
    }));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.join(' ')).toMatch(/base 40A/);
    expect(ampacityChainLines(null)).toEqual(['ampacity PENDING']);
  });
});

// ── gates 6-7 — grounding authority: OUTCOME-CONSISTENCY across surfaces ─────
// CORRECTED 2026-07-25 (Ray's ruling). These gates no longer assert "result B".
// They assert that the ONE canonical outcome is document-backed (never inferred
// from the conductor count) and that every surface renders THAT outcome. The full
// three-outcome matrix lives in tests/planset/qcable-grounding-authority.test.ts.
describe('grounding — ONE document-based outcome, rendered consistently (gates 6, 7)', () => {
  it('gate 6 — the live outcome is PENDING_MANUFACTURER_AUTHORITY (no applicable document in-repo)', () => {
    const { snap } = gen();
    const g = projectOpenAirBranchGrounding(snap);
    expect(g.present).toBe(true);
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    expect(g.groundingMethod).toBe('pending');
    // "required" is NULL while pending — a pending method is NOT "not required".
    expect(g.required).toBeNull();
    expect(g.renderLabel).toBe('GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY');
    // the authority is resolved against the EXACT selected SKUs (a null SKU is a
    // real gap that can only ever produce PENDING — never a family-label match).
    expect(g.authority!).toHaveProperty('selectedMicroinverterSku');
    expect(g.authority!.selectedCableAssemblySku).toBe('Q-12-10-240');
    expect(g.authority!.applicabilityVerification.verdict).not.toBe('applicable');
    // the conductor count is recorded and explicitly non-determinative
    expect(g.authority!.conductorCountIsNonDeterminative).toBe(true);
    const asm = projectListedCableAssembly(snap);
    if (asm.present) expect(asm.assembly!.conductorCount).toBe(2);
  });

  it('gate 7 — the candidate EGC keeps the trunk geometry + waste, but as a DESIGN quantity', () => {
    const { snap } = gen();
    const g = projectOpenAirBranchGrounding(snap);
    const asm = projectListedCableAssembly(snap);
    expect(g.designedInstalledFt).toBe(asm.totalDesignedInstalledFt);
    expect(g.lengthProvenance).toBe(asm.lengthProvenance);
    expect(g.pathBasis).toMatch(/BranchCablePath/);
    expect(g.bomFootageFt).toBe(Math.ceil(g.designedInstalledFt! * g.wasteFactor));
    expect(g.branchIds.length).toBe(snap.electrical.branches.length);
    // …and it is NOT orderable while the authority is pending
    expect(g.bomRowState).toBe('design-quantity-non-orderable');
    expect(g.nonOrderable).toBe(true);
  });

  it('gate 7 — the BOM carries the candidate footage, flagged NON-ORDERABLE', () => {
    const { snap, input } = gen();
    const cad = generateCADLayout(input) as any;
    const bom = generateBOMForPermit(input, cad);
    const g = projectOpenAirBranchGrounding(snap);
    const row = bom.find(i => i.partNumber?.startsWith('GRN-OPENAIR-'));
    expect(row, 'candidate open-air EGC row must exist as a design quantity').toBeTruthy();
    expect(row!.quantity).toBe(g.bomFootageFt);
    expect(row!.unit).toBe('ft');
    expect(row!.nonOrderable).toBe(true);
    expect(row!.description).toMatch(/designed-installed/);
    for (const id of g.branchIds) expect(row!.description).toContain(id);
    const inRaceway = bom.filter(i => /Green EGC/i.test(i.model) && !/open-air/i.test(i.model));
    expect(inRaceway.length).toBeGreaterThan(0);
    expect(inRaceway.every(i => i.partNumber !== row!.partNumber)).toBe(true);
  });

  it('gate 7 (rendered) — no sheet asserts EITHER grounding method while pending', () => {
    const { html } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    expect(noB64).not.toMatch(/SEPARATE\s+(EQUIPMENT GROUNDING CONDUCTOR|#?\d+.*EGC|EGC)/i);
    expect(noB64).not.toMatch(/no (separate |additional )?EGC (is )?required/i);
    // the pending authority IS stated, with its blocker
    expect(noB64).toContain('GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY');
    expect(noB64).toContain('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
    // PV-1B carries the open-air grounding callout (pending form)
    expect(noB64).toMatch(/Open-Air Branch Grounding/);
    // no sheet asserts an integrated/listed grounding method for the Q-Cable either
    expect(noB64).not.toMatch(/Q.?Cable[^.]{0,80}integrated (equipment )?grounding/i);
  });

  it('gate 7 — the E-1 open-air segment prints the PENDING grounding line, and the home-run its OWN EGC', () => {
    const { html, snap } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    const branchEgc = snap.electrical.groundingObjects.find(g => g.purpose === 'branch-egc')!.conductorSize!;
    const feederEgc = snap.electrical.groundingObjects.find(g => g.purpose === 'feeder-egc')!.conductorSize!;
    expect(branchEgc).not.toBe(feederEgc);
    // the OPEN-AIR section no longer asserts a conductor — it states the pending authority
    expect(noB64).toContain('EGC: PENDING MFR AUTHORITY');
    // the in-raceway home-run EGC (independent, NEC 250.122 wiring method) is KEPT
    const bn = branchEgc.replace('#', '').replace(' AWG', '').trim();
    const fn = feederEgc.replace('#', '').replace(' AWG', '').trim();
    expect(noB64).toContain(`1×#${bn} GRN EGC`);
    expect(noB64).not.toContain(`1×#${fn} GRN EGC`);
    // the candidate conductor size still traces to the branch grounding object
    const g = projectOpenAirBranchGrounding(snap);
    expect(g.conductorSize).toBe(branchEgc);
  });

  it('a non-micro design produces NO open-air branch grounding authority or BOM row', () => {
    const g = projectOpenAirBranchGrounding({ electrical: { topology: 'STRING' } } as any);
    expect(g.present).toBe(false);
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    expect(g.groundingMethod).toBe('pending');
    expect(g.bomFootageFt).toBeNull();
  });
});

// ── §7 / gates 9-10 — caps + terminators from topology ───────────────────────
describe('§7 — caps/terminators from drop + cable-end topology (gates 9, 10)', () => {
  const mk = (): any => ({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 31, deviceCount: 31,
    stringCount: 0, inverterCount: 31, systemKw: 12.5, dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'PVC', conduitSizeInch: '1-1/4', roofType: 'shingle',
    attachmentCount: 62, railSections: 20, rowCount: 3, mainPanelAmps: 200, backfeedAmps: 60,
    acOCPD: 60, dcOCPD: 20, systemType: 'roof', interconnectionMethod: 'SUPPLY_SIDE_TAP',
    panelBusRating: 200, layoutOrientation: 'portrait', branchCount: 3, topologyType: 'MICROINVERTER',
  });
  const find = (bom: any, cat: string) =>
    (bom.items || []).filter((i: any) => i.category === cat && i.stageId !== 'truck_stock');

  it('gate 10 — terminators == actual cable-end objects (one per branch far-end), listed by id', () => {
    const bom: any = generateBOMV4(mk());
    const t = find(bom, 'terminator')[0];
    expect(t).toBeTruthy();
    // 3 branches ⇒ 3 far-ends. Correct number, but DERIVED from cable-end objects.
    expect(t.quantity).toBe(3);
    expect(t.derivedFrom).toMatch(/cable-end objects/i);
    // the source objects are enumerated per terminator (evidence requirement)
    expect(t.formula).toMatch(/B1-END/);
    expect(t.formula).toMatch(/B2-END/);
    expect(t.formula).toMatch(/B3-END/);
    expect(t.description).toMatch(/FAR-END/);
    // it is NOT justified as "1 per AC branch"
    expect(t.derivedFrom).not.toBe('1 per AC branch');
  });

  it('gate 9 — sealing caps == actual unused connector objects; a drop-count order establishes NONE ⇒ PENDING', () => {
    const bom: any = generateBOMV4(mk());
    const c = find(bom, 'sealing_cap')[0];
    expect(c).toBeTruthy();
    // 31 drops ordered = 31 micros = 31 occupied drops ⇒ 0 surplus connectors.
    expect(c.quantity).toBe(0);
    // and CRITICALLY it is no longer branchCount (3)
    expect(c.quantity).not.toBe(3);
    expect(c.derivedFrom).toMatch(/ordered.*occupied|topology/i);
    // the arithmetic is SHOWN (ordered − occupied = established), not asserted
    expect(c.formula).toMatch(/31\s*ordered\s*[-−]\s*31\s*occupied\s*=\s*0/);
    // honest PENDING with provenance, never a guessed number
    expect(c.description).toMatch(/PENDING/);
    expect(c.description).toMatch(/NOT 1-per-branch/i);
    expect(c.description).toMatch(/31 drops ordered/);
    expect(c.derivedFrom).not.toBe('1 per AC branch');
  });

  it('gate 9 — the cap quantity tracks TOPOLOGY, not branchCount (changing branches does not change caps)', () => {
    const b3: any = generateBOMV4({ ...mk(), branchCount: 3 });
    const b5: any = generateBOMV4({ ...mk(), branchCount: 5 });
    const cap3 = find(b3, 'sealing_cap')[0].quantity;
    const cap5 = find(b5, 'sealing_cap')[0].quantity;
    // caps are drop-derived ⇒ identical; terminators ARE cable-end derived ⇒ differ.
    expect(cap3).toBe(cap5);
    expect(find(b3, 'terminator')[0].quantity).toBe(3);
    expect(find(b5, 'terminator')[0].quantity).toBe(5);
  });

  it('the occupied-drop count equals the micro/module count on the real package (31 drops / 31 micros)', () => {
    const { snap } = gen();
    const asm = projectListedCableAssembly(snap);
    const modules = snap.electrical.branches.reduce((s, b) => s + b.moduleCount, 0);
    expect(asm.totalDrops).toBe(modules);   // one occupied drop per micro
  });
});

// ── evidence export — the harness reads the SAME objects the sheets render ───
describe('BAR evidence export — canonical objects are machine-extractable from the package', () => {
  function readStamp(html: string): any {
    const m = html.match(/data-bar-wse="([^"]*)"/);
    expect(m, 'E-1 must carry the BAR WS-E evidence stamp').toBeTruthy();
    const json = m![1]
      .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    return JSON.parse(json);
  }

  it('§4 — the exported ampacity artifact carries every factor for every section', () => {
    const { html, snap } = gen();
    const ev = readStamp(html);
    expect(ev.snapshotId).toBe(snap.meta.snapshotId);
    expect(Array.isArray(ev.ampacityAdjustments)).toBe(true);
    const hr = ev.ampacityAdjustments.find((a: any) => a.sectionId === 'BRANCH_HOMERUN_RUN');
    expect(hr).toBeTruthy();
    for (const f of [
      'baseTableAmpacityA', 'baseTableTempC', 'terminalTempLimitC', 'terminalTableAmpacityA',
      'currentCarryingCount', 'countAdjustmentFactor', 'countAdjustmentBasis',
      'ambientCorrectionFactor', 'ambientCorrectionBasis', 'correctedAmpacityA',
      'finalAllowableAmpacityA', 'requiredContinuousA', 'state', 'necReferences', 'provenance',
    ]) {
      expect(hr, `missing evidence field ${f}`).toHaveProperty(f);
    }
    // the exported object EQUALS the projection (one source, no second derivation)
    const proj = projectE1PhysicalSchedule(snap).find(s => s.sectionId === 'BRANCH_HOMERUN_RUN')!.ampacity!;
    expect(hr.countAdjustmentFactor).toBe(proj.countAdjustmentFactor);
    expect(hr.finalAllowableAmpacityA).toBe(proj.finalAllowableAmpacityA);
    expect(hr.state).toBe(proj.state);
  });

  it('§5/§7/§8 — grounding, connector topology and the wiring-method identity are exported', () => {
    const { html, snap } = gen();
    const ev = readStamp(html);
    const g = projectOpenAirBranchGrounding(snap);
    expect(ev.openAirBranchGrounding.outcome).toBe(g.outcome);
    expect(ev.openAirBranchGrounding.groundingMethod).toBe(g.groundingMethod);
    expect(ev.openAirBranchGrounding.bomRowState).toBe(g.bomRowState);
    expect(ev.openAirBranchGrounding.bomFootageFt).toBe(g.bomFootageFt);
    expect(ev.openAirBranchGrounding.designedInstalledFt).toBe(g.designedInstalledFt);
    // §7 — occupied drops + one cable-end object per branch (the cap/terminator basis)
    expect(ev.connectorTopology.occupiedDrops).toBe(projectListedCableAssembly(snap).totalDrops);
    expect(ev.connectorTopology.perBranch.length).toBe(snap.electrical.branches.length);
    for (const b of ev.connectorTopology.perBranch) expect(b.cableEndObjectId).toMatch(/-END$/);
    // §8 — the legend identity (the listed 2-conductor assembly; the conductor
    // count is construction data only — it decides no grounding method)
    expect(ev.openAirWiringMethod.conductorCount).toBe(2);
    expect(ev.openAirWiringMethod.wiringMethodLabel).toBeTruthy();
  });

  it('the stamp is hidden from the printed sheet (evidence only, no visual footprint)', () => {
    const { html } = gen();
    expect(html).toMatch(/class="bar-electrical-evidence"[^>]*style="display:none"/);
  });
});

// ── §8 / gate 11 — legend from canonical wiring methods ─────────────────────
describe('§8 — E-1 legend derives from the wiring methods on the sheet (gate 11)', () => {
  it('gate 11 — the stale "Open Air — PV Wire/THWN-2" entry is GONE on a micro sheet', () => {
    const { html } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    expect(noB64).not.toContain('Open Air — PV Wire/THWN-2');
    expect(noB64).not.toContain('PV Wire/THWN-2 (NEC 690.31)');
  });

  it('gate 11 — the open-air legend entry names the LISTED Q-Cable assembly actually drawn', () => {
    const { html, snap } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    const asm = projectListedCableAssembly(snap);
    expect(asm.present).toBe(true);
    const label = asm.assembly!.wiringMethodLabel;      // e.g. 'ENPHASE Q CABLE (TC-ER)'
    // the legend entry uses the SAME identity string the SEGMENT-1 label uses
    expect(noB64).toContain(`Open Air — ${label}`);
    expect(noB64).toContain('690.31(C)');
  });

  it('gate 11 — legend entries == displayed segment wiring methods (no method advertised that is absent)', () => {
    const { html, snap } = gen();
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    const svg = noB64.slice(
      noB64.indexOf('SINGLE-LINE ELECTRICAL DIAGRAM'),
      noB64.indexOf('E-1 PHYSICAL CONDUCTOR'),
    );
    // A pure micro job has NO field DC conductor and NO open-air PV wire.
    expect(svg).not.toContain('DC Conductor in Conduit');
    expect(svg).not.toContain('PV Wire');
    // The methods that ARE on the sheet appear: in-conduit THWN-2 (home-run/feeder),
    // the listed open-air trunk, and the EGC.
    expect(svg).toContain('AC Conductor in Conduit (THWN-2)');
    expect(svg).toContain('Equipment Grounding Conductor (EGC)');
    // every in-conduit segment on the snapshot really is THWN-2
    const inConduit = snap.electrical.routeSegments.filter(r => r.raceway && r.raceway !== 'FREE_AIR');
    expect(inConduit.length).toBeGreaterThan(0);
    for (const r of inConduit) expect(r.insulation ?? 'THWN-2').toMatch(/THWN/);
  });
});
