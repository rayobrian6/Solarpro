// ═══════════════════════════════════════════════════════════════════════════
// TAC — TECHNICAL AUTHORITY & CONSISTENCY CLOSURE.
//
// Targeted + anti-vacuity tests for the workstreams landed in this campaign.
// Every test asserts a BEHAVIOUR that was wrong before, not merely that a field
// exists — and each anti-vacuity case proves the assertion could fail.
//
//   WS-1  Q-Cable: two named deficits, per-branch arithmetic, non-redistributable
//         surplus, minimum additional purchase. No false shorthand.
//   WS-2  Ampacity: a correction factor may never ride on a null ambient; the
//         rooftop adder is code-edition gated.
//   WS-3  Conductor ROLES decide the current-carrying count; an EGC never counts;
//         a 3-wire imbalance-only neutral never counts.
//   WS-4  ONE fastener predicate: element presence is not evidence, a flashing
//         evaluation report is not installation authority, and the document must
//         be applicable to the SELECTED product.
//   WS-5  The embedment substrate is the structural member — never a roof covering.
//   WS-8  Conduit fill may not render in a voltage-drop column.
//   WS-19 The internal AHJ registry answers before any external credential, and a
//         seeded (unprovenanced) row can never establish an adopted edition.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  resolveFastenerVerification, isFlashingOnlyEvaluationReport, projectFastenerAssembly,
} from '@/lib/permit/snapshot/structuralProjection';
import { projectAmpacityAdjustment } from '@/lib/permit/snapshot/electricalProjection';
import {
  roleIsCurrentCarrying, currentCarryingCountOf, conductorBundle, type ConductorBundle,
} from '@/lib/segment-schedule';
import {
  rowCarriesAdoptionEvidence, rowToCodeAdoption, type AhjRegistryRow,
} from '@/lib/jurisdictions/internalAhjRegistry';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const PKG = (() => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  const html = generatePermitHTML(input);
  return { input, html, snap: input._snapshot as PermitDesignSnapshot };
})();

// ── WS-1 — Q-CABLE DEFICIT AUTHORITY ────────────────────────────────────────
describe('TAC WS-1 — Q-Cable deficits are named, and the arithmetic is true', () => {
  const ps = PKG.snap.electrical.procurementSufficiency!;

  it('the aggregate deficit IS the aggregate subtraction (nothing else may be called that)', () => {
    expect(ps.present).toBe(true);
    const expectedAggregate = Math.max(
      0,
      Math.round(((ps.totalDesignedInstalledFt ?? 0) + ps.requiredServiceLoopAllowanceFt - (ps.procurementLengthFt ?? 0)) * 10) / 10,
    );
    expect(ps.aggregateFootageDeficitFt).toBe(expectedAggregate);
  });

  it('per-branch deficits sum EXACTLY to the topology-constrained deficit', () => {
    const sum = Math.round((ps.perBranch ?? []).reduce((s, p) => s + (p.deficitFt ?? 0), 0) * 10) / 10;
    expect(ps.topologyConstrainedDeficitFt).toBe(sum);
  });

  it('a non-short branch\'s surplus is recorded as NON-REDISTRIBUTABLE and never offsets a shortfall', () => {
    const surplus = Math.round((ps.perBranch ?? []).reduce((s, p) => s + (p.nonRedistributableSurplusFt ?? 0), 0) * 10) / 10;
    expect(ps.nonRedistributableSurplusFt).toBe(surplus);
    // ANTI-VACUITY: this fixture genuinely exercises the case — aggregate is
    // sufficient (0 ft short) while a branch is short, which is only possible
    // because surplus cannot move between branches.
    expect(surplus).toBeGreaterThan(0);
    expect(ps.topologyConstrainedDeficitFt).toBeGreaterThan(ps.aggregateFootageDeficitFt);
  });

  it('AGGREGATE SUFFICIENCY CANNOT HIDE A BRANCH FAILURE', () => {
    expect(ps.aggregateFootageDeficitFt).toBe(0);          // aggregate says "enough"
    expect(ps.insufficient).toBe(true);                    // …and the gate still fires
    expect(ps.deficitBasis).toBe('topology-constrained');
  });

  it('the governing deficit = max(aggregate, topology) and equals the required purchase', () => {
    expect(ps.deficitFt).toBe(Math.max(ps.aggregateFootageDeficitFt, ps.topologyConstrainedDeficitFt));
    expect(ps.requiredAdditionalPurchasableLengthFt).toBe(ps.deficitFt);
  });

  it('the printed arithmetic note states BOTH bases with their own operands', () => {
    const note = ps.deficitArithmeticNote ?? '';
    expect(note).toContain('AGGREGATE FOOTAGE');
    expect(note).toContain('TOPOLOGY-CONSTRAINED (GOVERNING)');
    // the aggregate clause must contain the aggregate operands…
    expect(note).toContain(`procured ${ps.procurementLengthFt} ft = ${ps.aggregateFootageDeficitFt} ft`);
    // …and the per-branch clause its own Σ.
    expect(note).toContain(`= ${ps.topologyConstrainedDeficitFt} ft`);
  });

  it('NO SHEET prints an aggregate subtraction that evaluates to a different number', () => {
    // The retired defect: "procurement A ft is SHORT of the B ft designed path by
    // C ft" where B − A ≠ C. Any sheet stating "SHORT of … by N" must have N
    // equal the aggregate subtraction.
    for (const m of PKG.html.matchAll(/procurement (\d+(?:\.\d+)?) ft is SHORT of the (\d+(?:\.\d+)?) ft[^.]*?by (\d+(?:\.\d+)?) ft/g)) {
      const [, proc, designed, by] = m;
      expect(Math.round((Number(designed) - Number(proc)) * 10) / 10).toBe(Number(by));
    }
  });

  it('PV-4B.1 renders the per-branch derivation table', () => {
    // WS-2 merged the sufficiency derivation and the procurement allocation into
    // ONE per-branch table (two stacked tables overflowed the sheet by 164 px).
    expect(PKG.html).toContain('Q-CABLE PROCUREMENT — PER-BRANCH DERIVATION &amp; ALLOCATION');
    expect(PKG.html).toContain('Required installed length (cable path)');
    expect(PKG.html).toContain('Usable allocated cable');
  });

  it('no Braidon constant is embedded in the deficit logic (fixture-independent)', async () => {
    const raw = await import('node:fs').then(fs =>
      fs.readFileSync('lib/permit/snapshot/procurementSufficiency.ts', 'utf8'));
    // Strip comments first: the explanatory comments legitimately QUOTE the
    // defective Braidon sentence as the thing being fixed. What must not exist
    // is a project-specific literal in executable code.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    for (const lit of ['166.5', '24.2', '140.5', '9.3', '20.8']) {
      expect(code, `Braidon constant ${lit} in executable code`).not.toContain(lit);
    }
  });
});

// ── WS-2 — AMPACITY ENVIRONMENTAL INPUTS ────────────────────────────────────
describe('TAC WS-2 — a correction factor may never ride on a null ambient', () => {
  const base = {
    conductorGauge: '#6 AWG', insulation: 'THWN-2', currentCarryingCount: 3, freeAir: false,
    requiredContinuousA: 56.35, requiredContinuousBasis: 'test',
  };

  it('NULL ambient + a supplied factor ⇒ PENDING, never PASS', () => {
    const r = projectAmpacityAdjustment({ ...base, ambientTempC: null, tempDeratingFactor: 0.96 });
    expect(r.ambientCorrectionFactor).toBeNull();
    expect(r.finalAllowableAmpacityA).toBeNull();
    expect(r.state).toBe('PENDING');
    expect(r.ambientCorrectionBasis).toMatch(/AMBIENT NOT ESTABLISHED/);
  });

  it('ANTI-VACUITY: the SAME inputs WITH an ambient do produce a decided result', () => {
    const r = projectAmpacityAdjustment({ ...base, ambientTempC: 33, tempDeratingFactor: 0.96 });
    expect(r.ambientCorrectionFactor).toBe(0.96);
    expect(r.finalAllowableAmpacityA).not.toBeNull();
    expect(['PASS', 'FAIL']).toContain(r.state);
    expect(r.ambientCorrectionBasis).toContain('33');
  });

  it('a different ambient changes the final ampacity (the factor is not decorative)', () => {
    const cool = projectAmpacityAdjustment({ ...base, ambientTempC: 26, tempDeratingFactor: null });
    const hot = projectAmpacityAdjustment({ ...base, ambientTempC: 51, tempDeratingFactor: null });
    expect(cool.ambientCorrectionFactor).not.toBe(hot.ambientCorrectionFactor);
    expect(cool.finalAllowableAmpacityA!).toBeGreaterThan(hot.finalAllowableAmpacityA!);
  });

  it('the rooftop adder RAISES the effective ambient when supplied', () => {
    const flat = projectAmpacityAdjustment({ ...base, ambientTempC: 33, rooftopAdderC: null, tempDeratingFactor: null });
    const roof = projectAmpacityAdjustment({ ...base, ambientTempC: 33, rooftopAdderC: 22, tempDeratingFactor: null });
    expect(flat.effectiveAmbientTempC).toBe(33);
    expect(roof.effectiveAmbientTempC).toBe(55);
    expect(roof.ambientCorrectionFactor!).toBeLessThan(flat.ambientCorrectionFactor!);
  });

  it('the LIVE fixture chain states its temperature AND its source, and applies no adder under NEC 2020', () => {
    const feeder = PKG.snap.electrical.routeSegments.find(s => s.segmentId === 'COMBINER_TO_DISCO_RUN')!;
    expect(feeder.ambientTempC).not.toBeNull();
    expect(feeder.ambientSource).toBeTruthy();
    // NEC 690.31(A) deleted the rooftop adder for PV in 2017; adopted edition is 2020.
    expect(feeder.rooftopAdderC).toBeNull();
  });
});

// ── WS-3 — CONDUCTOR ROLES ──────────────────────────────────────────────────
describe('TAC WS-3 — the current-carrying count is ROLE-derived', () => {
  it('roles classify correctly per NEC 310.15(E)', () => {
    expect(roleIsCurrentCarrying('LINE')).toBe(true);
    expect(roleIsCurrentCarrying('GROUNDED_CURRENT_CARRYING')).toBe(true);
    expect(roleIsCurrentCarrying('NEUTRAL_IMBALANCE_ONLY')).toBe(false);
    expect(roleIsCurrentCarrying('EQUIPMENT_GROUNDING')).toBe(false);
    expect(roleIsCurrentCarrying('GROUNDING_ELECTRODE')).toBe(false);
    expect(roleIsCurrentCarrying('BONDING')).toBe(false);
  });

  it('ADDING AN EGC DOES NOT INCREASE THE COUNT', () => {
    const b: ConductorBundle[] = [
      conductorBundle({ qty: 2, gauge: '#6 AWG', color: 'BLK', insulation: 'THWN-2', role: 'LINE', currentPerConductor: 45 }),
    ];
    const before = currentCarryingCountOf(b);
    b.push(conductorBundle({ qty: 1, gauge: '#10 AWG', color: 'GRN', insulation: 'THWN-2', role: 'EQUIPMENT_GROUNDING', currentPerConductor: 0 }));
    expect(currentCarryingCountOf(b)).toBe(before);
  });

  it('a 3-wire imbalance-only neutral does NOT count; a qualifying grounded conductor DOES', () => {
    const withImbalanceNeutral = currentCarryingCountOf([
      conductorBundle({ qty: 2, gauge: '#6 AWG', color: 'BLK', insulation: 'THWN-2', role: 'LINE', currentPerConductor: 45 }),
      conductorBundle({ qty: 1, gauge: '#6 AWG', color: 'WHT', insulation: 'THWN-2', role: 'NEUTRAL_IMBALANCE_ONLY', currentPerConductor: 0 }),
    ]);
    expect(withImbalanceNeutral).toBe(2);
    const withCarryingNeutral = currentCarryingCountOf([
      conductorBundle({ qty: 2, gauge: '#6 AWG', color: 'BLK', insulation: 'THWN-2', role: 'LINE', currentPerConductor: 45 }),
      conductorBundle({ qty: 1, gauge: '#6 AWG', color: 'WHT', insulation: 'THWN-2', role: 'GROUNDED_CURRENT_CARRYING', currentPerConductor: 30 }),
    ]);
    expect(withCarryingNeutral).toBe(3);
  });

  it('the LIVE feeder counts 2 CCC (2 hots), not 4 — and its raceway still counts 4 conductors for FILL', () => {
    const rw = PKG.snap.electrical.physicalRaceways!.find(r => /COMBINER_TO_DISCO/.test(r.physicalRacewayId))!;
    expect(rw.currentCarryingCount).toBe(2);      // L1 + L2
    expect(rw.conductorCount).toBe(4);            // L1 + L2 + N + EGC (physical)
    // …so no 310.15(C)(1) adjustment applies at ≤3 CCC.
    const amp = projectAmpacityAdjustment({
      conductorGauge: '#6 AWG', insulation: 'THWN-2',
      currentCarryingCount: rw.currentCarryingCount, freeAir: false,
      ambientTempC: 33, tempDeratingFactor: null,
      requiredContinuousA: 56.35, requiredContinuousBasis: 'test',
    });
    expect(amp.countAdjustmentFactor).toBe(1);
  });
});

// ── WS-4 / WS-5 — FASTENER + SUBSTRATE ──────────────────────────────────────
describe('TAC WS-4 — ONE fastener predicate; presence is not evidence', () => {
  it('a flashing / water-resistance evaluation report is not installation authority', () => {
    expect(isFlashingOnlyEvaluationReport('ICC-ES ESR-3575')).toBe(true);
    expect(isFlashingOnlyEvaluationReport('ESR-1234')).toBe(true);
    // …but a structural/installation document is NOT excluded by the same rule.
    expect(isFlashingOnlyEvaluationReport('ESR-2761 structural withdrawal capacity')).toBe(false);
    expect(isFlashingOnlyEvaluationReport('Roof Tech RT-MINI Installation Manual')).toBe(false);
    expect(isFlashingOnlyEvaluationReport(null)).toBe(false);
  });

  it('every failure mode is named, and only the complete case verifies', () => {
    expect(resolveFastenerVerification({ elementsComplete: false, citedSourceDocument: 'Manual', documentApplicabilityVerified: true }).reason)
      .toMatch(/element is incomplete/);
    expect(resolveFastenerVerification({ elementsComplete: true, citedSourceDocument: null, documentApplicabilityVerified: true }).reason)
      .toMatch(/no fastener installation \/ structural source document/);
    expect(resolveFastenerVerification({ elementsComplete: true, citedSourceDocument: 'ICC-ES ESR-3575', documentApplicabilityVerified: true }).reason)
      .toMatch(/flashing \/ water-resistance/);
    expect(resolveFastenerVerification({ elementsComplete: true, citedSourceDocument: 'Manual', documentApplicabilityVerified: false }).reason)
      .toMatch(/not verified as applicable to the SELECTED product/);
    // ANTI-VACUITY — the predicate CAN return true.
    const ok = resolveFastenerVerification({ elementsComplete: true, citedSourceDocument: 'RT-MINI Installation Manual', documentApplicabilityVerified: true });
    expect(ok.verified).toBe(true);
    expect(ok.reason).toBeNull();
  });

  it('"verified" text requires evidence — the live package says PENDING everywhere, never both', () => {
    const fa = projectFastenerAssembly(PKG.input);
    // 2026-08-29 - THE DOCUMENT IS ON FILE NOW. SolarPro archives the Roof Tech
    // RT-MINI II Installation Manual (Jun 2025, 40 pp, SHA-256 6d868692...) from the
    // manufacturer's own portal, and the document lookup follows the same
    // supersession the PRODUCT lookup always did, so the gen-2 mount resolves to the
    // gen-2 manual. This assertion recorded the honest state on the day the document
    // was missing.
    // THE INVARIANT IS "NEVER BOTH", NOT "ALWAYS PENDING". The package must not
    // assert a verified assembly on one sheet while another says the instructions
    // are unknown - it must say ONE thing. Pinning the text to the PENDING form
    // only tested that while a document was missing; it would have passed a
    // package that could never verify anything.
    const _pending = PKG.html.includes('PENDING VERIFIED FASTENER ASSEMBLY');
    const _verified = /(?<!PENDING )VERIFIED FASTENER ASSEMBLY/.test(PKG.html);
    expect(_pending && _verified, 'the package states BOTH verified and pending').toBe(false);
    // and the text agrees with the projection that decided it
    expect(fa.verification === 'verified' ? _verified : _pending).toBe(true);
  });

  it('WS-5 — no roof COVERING may be stated as a structural embedment substrate', () => {
    expect(PKG.html).not.toMatch(/embed\w*[^<]{0,30}into[^<]{0,40}(asphalt|shingle|wood[_ ]?shake)/i);
    const fa = projectFastenerAssembly(PKG.input);
    if (fa.substrate) {
      expect(fa.substrate).not.toMatch(/asphalt|shingle|shake|tile|membrane/i);
    }
    // the covering compatibility remains separately visible (it is real data).
    expect(PKG.snap.structural.rackingAssembly?.installationCondition ?? '').toMatch(/asphalt|shingle/i);
  });
});

// ── WS-8 — TABLE PROJECTION SEMANTICS ───────────────────────────────────────
describe('TAC WS-8 — conduit fill cannot render in a voltage-drop column', () => {
  it('the shared home-run row prints its VOLTAGE DROP (or a dash), never its fill %', () => {
    const hr = PKG.snap.electrical.physicalRaceways!.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId));
    const fill = hr?.fillPct ?? null;
    expect(fill).not.toBeNull();
    // isolate the Branch Home-Run row and check the fill value is not in the
    // V-Drop cell (7th) — it now appears only alongside the raceway.
    const rowMatch = PKG.html.match(/<td class="fw7">Branch Home-Run<\/td>[\s\S]{0,900}?<\/tr>/);
    expect(rowMatch).toBeTruthy();
    const cells = [...rowMatch![0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]*>/g, '').trim());
    const vdropCell = cells[6] ?? '';
    expect(vdropCell).not.toContain(`${fill!.toFixed(1)}%`);
    // the fill is still shown — with the raceway it describes.
    expect(rowMatch![0]).toContain(`${fill!.toFixed(1)}% fill`);
  });
});

// ── WS-19 — INTERNAL AHJ REGISTRY PRECEDENCE ────────────────────────────────
describe('TAC WS-19 — the internal registry answers first, and seeds never establish codes', () => {
  const row = (over: Partial<AhjRegistryRow>): AhjRegistryRow => ({
    id: 'xx-test-county', stateCode: 'XX', county: 'Test', city: null, ahjName: 'Test County',
    jurisdictionType: 'county', externalAhjId: null,
    editions: { nec: '2020', ibc: '2021', irc: '2021', ifc: '2021' },
    rawEditions: null, localAmendments: [], effectiveDate: '2022-01-01',
    sourceUrl: 'https://example.gov/ordinance', sourceSha256: 'a'.repeat(64),
    provenance: 'operator-verified', verifiedBy: 'operator-verification:test',
    verifiedAtIso: '2026-01-01T00:00:00.000Z', retrievedAtIso: null, rawPayload: null,
    enrichmentAttempts: [], permitOffice: null, engineeringReviewRequirements: [], notes: null,
    ...over,
  });

  it('a SEEDED (unprovenanced) row can never establish an adopted edition', () => {
    expect(rowCarriesAdoptionEvidence(row({
      provenance: 'seeded-unprovenanced', sourceUrl: null, sourceSha256: null, verifiedBy: null,
    }))).toBe(false);
  });

  it('evidence requires a source URL, a hash AND an attribution', () => {
    expect(rowCarriesAdoptionEvidence(row({ sourceUrl: null }))).toBe(false);
    expect(rowCarriesAdoptionEvidence(row({ sourceSha256: null }))).toBe(false);
    expect(rowCarriesAdoptionEvidence(row({ verifiedBy: null, retrievedAtIso: null }))).toBe(false);
    expect(rowCarriesAdoptionEvidence(row({ editions: { nec: null, ibc: null, irc: null, ifc: null } }))).toBe(false);
    // ANTI-VACUITY — a complete row DOES carry evidence.
    expect(rowCarriesAdoptionEvidence(row({}))).toBe(true);
  });

  it('a retained retrieval also qualifies (research once → reuse), and projects the adoption contract', () => {
    const retrieved = row({ provenance: 'retrieved', verifiedBy: 'code-authority@v1', retrievedAtIso: '2026-01-02T00:00:00.000Z' });
    expect(rowCarriesAdoptionEvidence(retrieved)).toBe(true);
    const adoption = rowToCodeAdoption(retrieved);
    expect(adoption.editions).toEqual({ nec: '2020', ibc: '2021', irc: '2021', ifc: '2021' });
    expect(adoption.ahjName).toBe('Test County');
    expect(adoption.jurisdictionType).toBe('county');
  });

  it('utility territory can never substitute for the building AHJ (no utility field is consulted)', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('lib/jurisdictions/internalAhjRegistry.ts', 'utf8'));
    expect(src).not.toMatch(/utilityName|interconnectionAuthority/);
  });
});
