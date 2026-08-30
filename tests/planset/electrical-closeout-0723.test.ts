// ═══════════════════════════════════════════════════════════════════════════
// FINAL CLOSEOUT PASS 2026-07-23 — CO-A (electrical) regression gates.
// Covers §3/§4 (sectioned branch + physical raceway authority), §2 (one route
// accessor / gate 3 — no >1 raceway per segment id), §1 (PV-4A busbar N/A /
// PENDING, no synthesized PASS, legacy rules table retired), §9 (service-
// topology one-vs-two device determination + physical-order graph). Permanent
// gates 1, 2, 3, 4, 7, 9 from the directive.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { computeSystem, racewayNecArticle, type ComputedSystemInput } from '@/lib/computed-system';
import { generatePermitHTML } from '@/lib/permit';
import {
  projectSharedBranchRaceway, projectRacewayDescriptor, projectE1PhysicalSchedule,
} from '@/lib/permit/snapshot/electricalProjection';
import { evaluateCompliance } from '@/lib/permit/snapshot/complianceState';
import { validatePermitDesignSnapshot } from '@/lib/permit/snapshot/validate';
import { roofProject } from '../../test-fixtures/roofProject';
import { csMicroInput } from '../goldens/wave0-fixtures';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function microCs(overrides: Partial<ComputedSystemInput> = {}) {
  return computeSystem({ ...csMicroInput(), ...overrides });
}

describe('§3/§4 — sectioned branch + physical raceway authority (engine)', () => {
  it('the AC branch is TWO physical sections: open-air Q-Cable + shared conduit home-run', () => {
    const cs = microCs();
    const branch = cs.runs.find(r => r.id === 'BRANCH_RUN')!;
    const homerun = cs.runs.find(r => r.id === 'BRANCH_HOMERUN_RUN')!;
    expect(branch).toBeTruthy();
    expect(homerun).toBeTruthy();
    // gate 4 — the open-air Q-Cable trunk is NEVER stamped in-conduit (the merge bug)
    expect(branch.isOpenAir).toBe(true);
    expect(branch.conduitType).toBe('NONE');
    // the shared home-run IS in conduit and carries a raceway authority object
    expect(homerun.isOpenAir).toBe(false);
    expect(homerun.conduitType).not.toBe('NONE');
    expect(homerun.physicalRacewayId).toBe('RW-BRANCH-HOMERUN');
    expect(homerun.physicalRaceway).toBeTruthy();
  });

  it('the shared home-run raceway carries all branches with documented shared-fill math', () => {
    const cs = microCs();
    const rw = cs.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    expect(rw).toBeTruthy();
    expect(rw.sharedCircuitCount).toBe(cs.acBranchCount);
    expect(rw.sharedCircuitCount).toBeGreaterThan(0);
    // conductorCount = branches×BLK + branches×RED + 1 GRN; CCC excludes the EGC
    expect(rw.conductorCount).toBe(cs.acBranchCount * 2 + 1);
    expect(rw.currentCarryingCount).toBe(cs.acBranchCount * 2);
    expect(rw.fillPct).not.toBeNull();
    expect(rw.minimumCodeRacewaySize).toBeTruthy();
  });

  it('SEPARATE vs SHARED topologies differ in counts/fill/derating (more branches ⇒ more CCC, bigger fill)', () => {
    const small = microCs({ totalPanels: 8  });   // fewer branches
    const big   = microCs({ totalPanels: 40 });   // more branches
    const rwS = small.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    const rwB = big.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    expect(rwB.sharedCircuitCount).toBeGreaterThanOrEqual(rwS.sharedCircuitCount);
    expect(rwB.currentCarryingCount).toBeGreaterThanOrEqual(rwS.currentCarryingCount);
    // derating basis is documented per CCC (never a bare number)
    expect(rwS.deratingBasis).toMatch(/current-carrying/i);
    expect(rwB.deratingBasis).toMatch(/current-carrying/i);
  });

  it('a FEEDER raceway change cannot affect a BRANCH raceway (distinct physicalRacewayId)', () => {
    const emt = microCs({ conduitType: 'EMT' });
    const pvc = microCs({ conduitType: 'PVC Sch 80' });
    const branchEmt = emt.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    const branchPvc = pvc.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    const feederEmt = emt.physicalRaceways.find(r => /COMBINER_TO_DISCO/.test(r.physicalRacewayId));
    const feederPvc = pvc.physicalRaceways.find(r => /COMBINER_TO_DISCO/.test(r.physicalRacewayId));
    // feeder + branch are DISTINCT physical raceways (different ids) — no bleed.
    expect(branchEmt.physicalRacewayId).not.toBe(feederEmt?.physicalRacewayId);
    // the branch home-run id is stable regardless of the (project-level) type.
    expect(branchEmt.physicalRacewayId).toBe(branchPvc.physicalRacewayId);
    // feeder + branch may size independently.
    expect(feederEmt?.physicalRacewayId).toBe(feederPvc?.physicalRacewayId);
  });

  it('oversize requires documented rationale; the fill-selected size carries upsizingReason semantics', () => {
    const cs = microCs();
    const rw = cs.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    // no discretionary upsize here → minimum == calculated == selected, reason null
    expect(rw.minimumCodeRacewaySize).toBe(rw.selectedRacewaySize);
    expect(rw.calculatedFillRacewaySize).toBe(rw.selectedRacewaySize);
    expect(rw.upsizingReason).toBeNull();
  });

  it('§7 — the raceway NEC article derives from the raceway TYPE (PVC→352, EMT→358)', () => {
    expect(racewayNecArticle('PVC Sch 80').article).toBe('352');
    expect(racewayNecArticle('PVC Sch 40').article).toBe('352');
    expect(racewayNecArticle('EMT').article).toBe('358');
    expect(racewayNecArticle('RMC').article).toBe('344');
    const pvc = microCs({ conduitType: 'PVC Sch 80' });
    const rw = pvc.physicalRaceways.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    expect(rw.necArticle).toBe('352');           // a PVC run never cites 358 (EMT-only)
  });
});

// ── Rendered-package gates (real Braidon-shaped micro package) ───────────────
describe('§1/§2/§3/§9 — rendered package (roofProject micro, supply-side tap)', () => {
  function gen(method: string): { html: string; snap: PermitDesignSnapshot } {
    const input: any = clone(roofProject);
    input.project = input.project ?? {};
    input.project.interconnectionMethod = method;
    const html = generatePermitHTML(input);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    return { html, snap };
  }

  it('gate 3 — no segment id resolves to more than one raceway type/size; open-air branch stays FREE_AIR', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const bySeg = new Map<string, Set<string>>();
    for (const r of snap.electrical.routeSegments) {
      const key = `${r.raceway ?? '—'}|${r.tradeSizeIn ?? '—'}`;
      (bySeg.get(r.segmentId) ?? bySeg.set(r.segmentId, new Set()).get(r.segmentId)!).add(key);
    }
    for (const [, set] of bySeg) expect(set.size).toBe(1);
    const branch = snap.electrical.routeSegments.find(r => r.segmentId === 'BRANCH_RUN');
    const homerun = snap.electrical.routeSegments.find(r => r.segmentId === 'BRANCH_HOMERUN_RUN');
    expect(branch?.raceway).toBe('FREE_AIR');
    expect(homerun?.raceway).not.toBe('FREE_AIR');
    expect(homerun?.raceway).toBeTruthy();
    // the RACEWAY-SEGMENT-CONFLICT + BRANCH-RACEWAY-AUTHORITY gates are clean
    const codes = (snap.permitReadiness?.blockers ?? []).map(b => b.code);
    expect(codes).not.toContain('RACEWAY-SEGMENT-CONFLICT');
    expect(codes).not.toContain('BRANCH-RACEWAY-AUTHORITY');
  });

  it('§2 — the construction note derives from the raceway objects (no `|| EMT`, PVC cites 352 not 358)', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const desc = projectRacewayDescriptor(snap);
    expect(desc.present).toBe(true);
    // roofProject is EMT by default; assert the descriptor cites the raceway's OWN
    // article (never the mixed "358 (EMT) or 352 (PVC)" literal).
    const hasPvc = desc.entries.some(e => /PVC/i.test(e.racewayType));
    const hasEmt = desc.entries.some(e => /EMT/i.test(e.racewayType));
    if (hasPvc) expect(desc.entries.find(e => /PVC/i.test(e.racewayType))!.necArticle).toBe('352');
    if (hasEmt) expect(desc.entries.find(e => /EMT/i.test(e.racewayType))!.necArticle).toBe('358');
    // the note text never carries the old mixed dual-citation.
    expect(desc.noteText).not.toMatch(/358\.30 \(EMT\) or NEC 352\.30 \(PVC\)/);
  });

  it('§3 — E-1 + PV-4B show the shared home-run raceway AND the open-air Q-Cable (no merged string)', () => {
    const { html, snap } = gen('SUPPLY_SIDE_TAP');
    const hr = projectSharedBranchRaceway(snap);
    expect(hr.present).toBe(true);
    expect(hr.sharedCircuitCount).toBeGreaterThan(0);
    // PV-4B carries a distinct "Branch Home-Run" row + an open-air branch row.
    expect(html).toContain('Branch Home-Run');
    expect(html).toMatch(/Roof J-Box \(open air\)/);
    // no single row merges "95 ft #12 in 1-1/4\" PVC" whole-branch description.
    expect(html).not.toMatch(/\d+\s*ft\s*#1[02]\s*(AWG\s*)?in\s*1-1\/4/i);
  });

  it('§9 — ONE listed dual-purpose fused device (no phantom utility-disconnect duplicate)', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const topo = snap.electrical.serviceTopology;
    const fused = topo.find(o => o.type === 'fused-ocpd')!;
    expect(fused.dualPurposeListing).toBe(true);
    expect(fused.utilityRole).toBe('utility-accessible-disconnect');
    expect(topo.filter(o => o.type === 'utility-disconnect')).toHaveLength(0);
    // physical-order graph: every object (except the endpoints) links up + down.
    const combiner = topo.find(o => o.type === 'combiner')!;
    expect(combiner.upstreamObjectId).toBeNull();
    expect(combiner.downstreamObjectId).toBeTruthy();
    const svcDisco = topo.find(o => o.type === 'service-disconnect')!;
    expect(svcDisco.downstreamObjectId).toBeNull();
    expect(svcDisco.upstreamObjectId).toBeTruthy();
    // gate 9 — validator sees no conflation/duplicate device.
    expect(validatePermitDesignSnapshot(snap).some(v => v.invariant === 'V43')).toBe(false);
  });

  it('§9 — a SEPARATE utility disconnect is emitted only when the project specifies one', () => {
    const input: any = clone(roofProject);
    input.project = input.project ?? {};
    input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    input.project.separateUtilityDisconnect = true;
    generatePermitHTML(input);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    const topo = snap.electrical.serviceTopology;
    expect(topo.filter(o => o.type === 'utility-disconnect')).toHaveLength(1);
    const fused = topo.find(o => o.type === 'fused-ocpd')!;
    expect(fused.dualPurposeListing).toBeNull();     // not dual — a real second device exists
    expect(validatePermitDesignSnapshot(snap).some(v => v.invariant === 'V43')).toBe(false);
  });

  it('§1/gate 2 — supply-side PV-4A shows 120% busbar N/A, never a 705.12 PASS', () => {
    const { html } = gen('SUPPLY_SIDE_TAP');
    expect(html).toMatch(/120% N\/A \(705\.11\)|120% busbar rule \(NEC 705\.12\(B\)\) not applicable/i);
    // gate 2 — a supply-side set can never print a green 705.12 busbar PASS row.
    expect(html).not.toMatch(/120% Busbar Rule — NEC 705\.12\(B\)[\s\S]{0,400}?>PASS</);
    // §1 — the retired legacy "27.5% busbar fill PASS" class never appears.
    expect(html).not.toMatch(/27\.5%[\s\S]{0,80}PASS/);
  });

  it('§1 — PV-4A projects a snapshot-derived compliance status (legacy rules-detail table retired)', () => {
    const { html } = gen('SUPPLY_SIDE_TAP');
    expect(html).toContain('Electrical Compliance Status');
    // the legacy advisory "NEC Rule Detail" table is gone.
    expect(html).not.toContain('NEC Rule Detail (advisory');
  });
});

// ── WS-A §1–§5 rendered gates (E-1 sectioned schedule / tri-state / registry) ─
describe('WS-A §1–§5 — E-1 sectioned schedule, tri-state, PV-4A registry (permanent gates 1–5)', () => {
  function gen(method: string): { html: string; snap: PermitDesignSnapshot } {
    const input: any = clone(roofProject);
    input.project = input.project ?? {};
    input.project.interconnectionMethod = method;
    const html = generatePermitHTML(input);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    return { html, snap };
  }

  it('gate 1 — E-1 renders the CANONICAL section objects (segment ids), never one merged branch row', () => {
    const { html, snap } = gen('SUPPLY_SIDE_TAP');
    const secs = projectE1PhysicalSchedule(snap);
    const ids = secs.map(s => s.sectionId);
    expect(ids).toContain('BRANCH_RUN');
    expect(ids).toContain('BRANCH_HOMERUN_RUN');
    expect(ids).toContain('COMBINER_TO_DISCO_RUN');
    // 2026-08-28 — the disconnect↔tap span is ONE section (see gate 3b): the
    // physical route segment, with the 705.11(C) rule folded onto it. It used to
    // be listed twice, the second time as the `svc-tap-conductors` topology
    // object with a different raceway and a different EGC for the same conduit.
    expect(ids).toContain('DISCO_TO_METER_RUN');
    // per-branch Q-Cable rows: one per canonical branch, never merged.
    expect(ids.filter(id => id === 'BRANCH_RUN').length).toBe(snap.electrical.branches.length);
    // the schedule renders ONCE, on PV-4B.1 (post-AAC E-1 repair — E-1 is the
    // dedicated SLD sheet), with the canonical section ids visible.
    expect(html).toContain('PHYSICAL CONDUCTOR / RACEWAY SCHEDULE — CANONICAL SECTION OBJECTS');
    expect(html).toContain('CONDUCTOR SCHEDULE — PHYSICAL SECTIONS');
    expect(html).toContain('BRANCH_HOMERUN_RUN');
  });

  it('gate 2 — the shared home-run conductor count EQUALS the physicalRaceway current-carrying inventory', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const secs = projectE1PhysicalSchedule(snap);
    const hr = secs.find(s => s.sectionId === 'BRANCH_HOMERUN_RUN')!;
    const rw = snap.electrical.physicalRaceways!.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!;
    expect(hr.conductorCount).toBe(rw.currentCarryingCount);
    expect(hr.conductorCount).toBe(snap.electrical.branches.length * 2);   // 2×#10 per branch
    // the home-run PHASE gauge is the canonical #10 — never the legacy #12-from-OCPD.
    expect(hr.conductorSize).toBe('#10 AWG');
  });

  it('gate 2 (SVG) — the E-1 diagram shared home-run prints N#10, never #12 on the shared run', () => {
    const { html, snap } = gen('SUPPLY_SIDE_TAP');
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    // isolate the E-1 SVG (from the sheet title to the end of the SLD svg —
    // post-AAC repair: the physical schedule no longer follows it on E-1).
    const _svgStart = noB64.indexOf('SINGLE-LINE ELECTRICAL DIAGRAM');
    const svg = noB64.slice(_svgStart, noB64.indexOf('</svg>', _svgStart) + 6);
    // The defect this gate protects against is a fictitious #12 PHASE conductor
    // (the legacy wireGaugeForOcpd(20A) result) on the branch / shared home-run.
    // BAR §5 (2026-07-25): a #12 EGC is now legitimately printed on the branch
    // segments — NEC 250.122 on the 20 A BRANCH OCPD is #12, and that is the SAME
    // gauge the canonical branch-egc grounding object and the BOM open-air EGC row
    // carry (gate 7). So the assertion is narrowed to its real invariant: no #12
    // may appear as a current-carrying THWN conductor.
    expect(svg).not.toMatch(/\d*#12\s*(AWG\s*)?THWN/);
    expect(svg).not.toMatch(/#12\s*AWG\s*THWN-2/);
    const ccc = snap.electrical.physicalRaceways!.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId))!.currentCarryingCount;
    expect(svg).toContain(`${ccc}#10 THWN-2`);
  });

  it('gate 3 — no E-1 section shows PASS while ITS OWN length is an estimate / fill blank / tap pending', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const secs = projectE1PhysicalSchedule(snap);
    expect(secs.length).toBeGreaterThan(0);
    // 2026-08-28 MIGRATION — this used to assert that NO section may PASS, which
    // was only true because EVERY section was estimate-length. That is an
    // accident of the fixture, not the gate. The gate is per-section: a section
    // whose own length is an estimate (or whose fill is blank) may not read PASS.
    // The tap span now carries a DESIGN-FIXED length, so it is allowed to — and
    // the assertion below still fails loudly if an ESTIMATE ever reads PASS.
    const ESTIMATE_SOURCES = new Set(['cad-derived-estimate', 'unknown', 'operator-entry', null]);
    let sawEstimate = false;
    for (const s of secs) {
      if (ESTIMATE_SOURCES.has(s.lengthSource as string | null)) {
        sawEstimate = true;
        // THE GATE, unchanged: an estimate length may never read PASS.
        expect(s.compliance.state, `${s.sectionId} PASSED on an estimate length`).not.toBe('PASS');
        // 2026-08-29 - the allowed list gains FIELD-VERIFY-AT-INSTALL. An
        // estimate route length is closed by the INSTALLER with a tape, not by
        // the engineer, and reporting it as "PENDING - REVIEW REQ'D" told a PE
        // that four ordinary route lengths were his outstanding work. The state
        // is ranked BELOW engineering-pending and ABOVE pass, so this gate is
        // not weakened - the section still cannot read PASS.
        expect(['FAIL', 'PENDING-REVIEW-REQUIRED', 'FIELD-VERIFY-AT-INSTALL'])
          .toContain(s.compliance.state);
      }
    }
    // the gate is only meaningful if the fixture still contains an estimate run
    expect(sawEstimate, 'fixture no longer exercises the estimate path').toBe(true);
  });

  it('gate 3b — the disconnect↔tap span appears EXACTLY ONCE on E-1', () => {
    const { snap } = gen('SUPPLY_SIDE_TAP');
    const secs = projectE1PhysicalSchedule(snap);
    // It used to be printed twice: as the DISCO_TO_METER_RUN route row (PVC,
    // EGC-in-raceway, route length) and again as a free-standing TAP CONDUCTORS
    // row (raceway "PER SERVICE ENTRANCE", service bonding, tap length). One
    // physical conduit, two raceway treatments, two EGC treatments.
    const spanRows = secs.filter(s =>
      s.sectionId === 'DISCO_TO_METER_RUN' || s.sectionId === 'svc-tap-conductors');
    expect(spanRows).toHaveLength(1);
    expect(spanRows[0].sectionId).toBe('DISCO_TO_METER_RUN');
    // and the 705.11(C) rule rides ON that one row
    expect(spanRows[0].sectionLabel).toMatch(/705\.11/);
    expect(spanRows[0].sectionLabel).toMatch(/tap/i);
  });

  it('§2 tri-state — fail-closed: blank required ⇒ PENDING, violation ⇒ FAIL, all-present+passing ⇒ PASS', () => {
    expect(evaluateCompliance({ requiredValues: [{ label: 'x', value: null, numeric: true }] }).state).toBe('PENDING-REVIEW-REQUIRED');
    expect(evaluateCompliance({ requiredValues: [{ label: 'x', value: NaN, numeric: true }] }).state).toBe('PENDING-REVIEW-REQUIRED');
    expect(evaluateCompliance({ requiredValues: [{ label: 'x', value: '' }] }).state).toBe('PENDING-REVIEW-REQUIRED');
    expect(evaluateCompliance({ checks: [{ label: 'fill', pass: false }] }).state).toBe('FAIL');
    // FAIL dominates a co-occurring pending.
    expect(evaluateCompliance({ checks: [{ label: 'fill', pass: false }], pending: ['len'] }).state).toBe('FAIL');
    expect(evaluateCompliance({ checks: [{ label: 'fill', pass: null }] }).state).toBe('PENDING-REVIEW-REQUIRED');
    expect(evaluateCompliance({ requiredValues: [{ label: 'x', value: 25, numeric: true }], checks: [{ label: 'ok', pass: true }] }).state).toBe('PASS');
  });

  it('gate 4 — the rendered raceway text matches the raceway the PROJECT selected', () => {
    // 2026-08-29 REVERSED, because the original assertion was pinning a defect.
    // `computedRuns` packed the trade size into the raceway-TYPE field (`3/4" EMT`),
    // and two exact-equality lookups then missed it and defaulted in OPPOSITE
    // directions: the raceway ternary fell through to PVC Sch 80 — which is what
    // PRINTED — while the conduit-area lookup fell back to EMT, which is what it
    // was SIZED against. So "no EMT text" held only because the material had been
    // silently replaced; the fixture selects EMT, and the fill was 0.1399 in² over
    // 0.533 — the EMT interior — the entire time.
    //
    // The property worth guarding is that the printed material IS the selected
    // material, and that no other raceway material appears beside it.
    const { html } = gen('SUPPLY_SIDE_TAP');
    const noB64 = html.replace(/data:image[^"')]+/g, '');
    expect(noB64).toMatch(/\bEMT\b/);
    for (const other of ['PVC Sch 80', 'PVC Sch 40']) {
      expect(noB64, `${other} printed on an EMT design`).not.toContain(other);
    }
  });

  it('gate 5 — PV-4A electrical blocker multiset EQUALS the RS-1 electrical domain subset', () => {
    const { html, snap } = gen('SUPPLY_SIDE_TAP');
    const elecReg = (snap.permitReadiness.registry ?? []).filter(r => !r.resolved && r.domain === 'electrical');
    expect(elecReg.length).toBeGreaterThan(0);
    // every electrical registry code is projected onto PV-4A (the registry, not a
    // hardcoded allowlist), and the blocking count == the registry's blocking count.
    for (const r of elecReg) expect(html).toContain(r.code);
    // 2026-08-28 MIGRATION — this asserted the literal presence of
    // `TAP-CONDUCTOR-LENGTH-PENDING`, which only held because that code fired
    // unconditionally on every supply-side design. It no longer does (a
    // design-constrained span raises nothing), so the assertion is restated as
    // the property it was standing in for: PV-4A projects the REGISTRY, so a tap
    // code appears on the sheet exactly when the registry carries it, and the old
    // mismatched `TAP-LENGTH-PENDING` never appears at all.
    const tapCodes = elecReg.map(r => r.code).filter(c => /^TAP-CONDUCTOR-LENGTH-/.test(c));
    for (const c of tapCodes) expect(html).toContain(c);
    if (tapCodes.length === 0) {
      expect(html).not.toContain('TAP-CONDUCTOR-LENGTH-PENDING');
      expect(html).not.toContain('TAP-CONDUCTOR-LENGTH-EXCEEDED');
    }
    expect(html).not.toContain('TAP-LENGTH-PENDING<');
  });

  it('§5 — PV-4A branch table is the option-B RATING SUMMARY (no conductor/raceway column, no #12→combiner)', () => {
    const { html } = gen('SUPPLY_SIDE_TAP');
    expect(html).toContain('AC Branch Circuit Rating Summary');
    // The sectioned physical conductor schedule is referenced from PV-4A.
    // TAC WS-18 — the target is RESOLVED against the active sheet index: it has
    // been PV-4B.1 since the post-AAC E-1 repair, and this footer still sent the
    // reader to E-1. It must name whichever sheet this package actually carries.
    expect(html).toMatch(/Physical conductor, cable-assembly and raceway schedule[\s\S]{0,80}on PV-4B(\.1)?/);
    expect(html).not.toMatch(/Physical conductor, cable-assembly and raceway schedule[\s\S]{0,80}on E-1/);
  });
});
