// ═══════════════════════════════════════════════════════════════════════════
// EP CLOSEOUT — WS-D (§15–§17) language / labels / code-basis gates.
//
// §15 fire-setback language: the modeled geometry is never described as an
//     adopted "per AHJ" requirement while the AHJ identity / IFC edition is
//     unverified — it prints PROVISIONAL FIRE SETBACK BASIS.
// §16 label topology: PV-5 label applicability is topology-driven — a 705.12
//     load-side placard never renders on a 705.11 supply-side design, and the
//     supply/load label sets differ appropriately across interconnection types.
// §17 code basis: the cover + title block separate the COMPUTATIONAL basis
//     (NEC/ASCE) from the ADOPTED IBC/IRC/IFC authority (PENDING) — never a
//     "designed per / conform to PENDING IBC" compliance claim.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { roofProject } from '../../test-fixtures/roofProject';
import { selectFieldLabels, type FieldLabel } from '@/lib/permit/utils/fieldLabels';
import { resolveFireSetbackBasis } from '@/lib/permit/utils/fireSetback';
import type { CADModel } from '@/lib/cad/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function renderBraidon(): string {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-23T12:00:00Z';
  return generatePermitHTML(input);
}

// ── §15 — provisional fire-setback basis ────────────────────────────────────
describe('§15 (gate 15) — unverified fire basis is never an AHJ requirement', () => {
  const html = renderBraidon();

  it('PV-1B renders the PROVISIONAL FIRE SETBACK BASIS banner (IFC unverified)', () => {
    expect(html).toContain('PROVISIONAL FIRE SETBACK BASIS — PENDING AHJ / IFC VERIFICATION');
  });

  it('the PV-1 callout separates MODELED geometry from the provisional basis', () => {
    expect(html).toMatch(/\(MODELED\) — PROVISIONAL BASIS — PENDING AHJ \/ IFC VERIFICATION/);
  });

  it('no fire-setback note asserts a bare "per AHJ" requirement while unverified', () => {
    expect(html).not.toContain('per AHJ');
  });

  it('the basis helper prints an ADOPTED requirement only when AHJ + IFC are verified', () => {
    const unverified = resolveFireSetbackBasis({ ifcEdition: null, verificationStatus: 'incomplete', ahjName: null });
    expect(unverified.verified).toBe(false);
    expect(unverified.basisLabel).toContain('PROVISIONAL FIRE SETBACK BASIS');

    const verified = resolveFireSetbackBasis({ ifcEdition: '2021', verificationStatus: 'verified', ahjName: 'Granite City' });
    expect(verified.verified).toBe(true);
    expect(verified.basisLabel).toContain('ADOPTED FIRE SETBACK REQUIREMENT');
    expect(verified.citation).toBe('IFC 2021 §1204.2');

    // an unknown edition can NEVER be presented as verified even if flagged so
    const noEdition = resolveFireSetbackBasis({ ifcEdition: null, verificationStatus: 'verified', ahjName: 'Somewhere' });
    expect(noEdition.verified).toBe(false);
  });
});

// ── §16 — topology-driven label applicability ───────────────────────────────
describe('§16 (gate 16) — no load-side-only labels on a supply-side system', () => {
  const cad = (p: any): CADModel => ({ systemType: p.project.systemType, totalPanels: p.system.totalPanels, totalDcKw: p.system.totalDcKw } as any);
  const reqIds = (ls: FieldLabel[]) => ls.filter(l => l.required).map(l => l.refId).sort();
  const anyNec705_12 = (ls: FieldLabel[]) => ls.filter(l => l.required).some(l => /705\.12/.test(l.necRef));

  // The directive's four interconnection fixtures.
  const supplyTap = () => { const p = clone(roofProject); p.project.interconnectionMethod = 'SUPPLY_SIDE_TAP'; return p; };
  const loadBreaker = () => { const p = clone(roofProject); p.project.interconnectionMethod = 'LOAD_SIDE'; return p; };
  const lineAdapter = () => {
    // a listed line-side (supply-side) tap adapter — resolves 705.11 via the
    // electrical engine's busbar reference, the canonical topology signal.
    const p: any = clone(roofProject); p.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    p.compliance = p.compliance ?? { overallStatus: '' }; p.compliance.electrical = p.compliance.electrical ?? {};
    p.compliance.electrical.busbar = { necReference: 'NEC 705.11', method: 'line-side adapter' };
    return p;
  };
  const serviceReplacement = () => {
    // a service replacement — PV lands on a back-fed breaker in the new service.
    const p: any = clone(roofProject); p.project.interconnectionMethod = 'LOAD_SIDE';
    p.compliance = p.compliance ?? { overallStatus: '' }; p.compliance.electrical = p.compliance.electrical ?? {};
    p.compliance.electrical.busbar = { necReference: 'NEC 705.12(B)', method: 'service upgrade back-fed breaker' };
    return p;
  };

  it('supply-side (tap + line-side adapter): line-side warning, NO back-fed placard, NO 705.12', () => {
    for (const mk of [supplyTap, lineAdapter]) {
      const p = mk();
      const labels = selectFieldLabels(p, cad(p));
      const ids = labels.filter(l => l.required).map(l => l.refId);
      expect(ids).toContain('line-side-tap-warning');
      expect(ids).not.toContain('backfeed-breaker-do-not-relocate');   // load-side-only
      // the merged 705.12 load-side clause must not leak onto the supply-side set
      expect(anyNec705_12(labels)).toBe(false);
    }
  });

  it('load-side (breaker + service replacement): back-fed placard present, NO line-side warning, 705.12 allowed', () => {
    for (const mk of [loadBreaker, serviceReplacement]) {
      const p = mk();
      const labels = selectFieldLabels(p, cad(p));
      const ids = labels.filter(l => l.required).map(l => l.refId);
      expect(ids).toContain('backfeed-breaker-do-not-relocate');
      expect(ids).not.toContain('line-side-tap-warning');              // supply-side-only
      // load-side systems legitimately carry the 705.12 clauses
      expect(anyNec705_12(labels)).toBe(true);
    }
  });

  it('the supply-side and load-side label sets differ appropriately', () => {
    const supply = reqIds(selectFieldLabels(supplyTap(), cad(supplyTap())));
    const load = reqIds(selectFieldLabels(loadBreaker(), cad(loadBreaker())));
    expect(supply).not.toEqual(load);
    // the ONE difference of note: line-side (supply) vs back-fed (load)
    expect(supply).toContain('line-side-tap-warning');
    expect(load).toContain('backfeed-breaker-do-not-relocate');
  });

  it('label classification counts: exactly one supply-side-only + one load-side-only, rest general', () => {
    const p = supplyTap();
    const labels = selectFieldLabels(p, cad(p));
    const bySide = (s: string) => labels.filter(l => l.interconnectSide === s).length;
    expect(bySide('supply-side-only')).toBe(1);   // line-side-tap-warning
    expect(bySide('load-side-only')).toBe(1);     // backfeed-breaker-do-not-relocate
    expect(bySide('general')).toBe(labels.length - 2);
  });
});

// ── §17 — computational basis vs adopted authority ──────────────────────────
describe('§17 (gate 17) — pending adopted codes are never a compliance claim', () => {
  const html = renderBraidon();

  it('the cover splits calculation basis (NEC/ASCE) from adopted authority (IBC/IRC/IFC)', () => {
    expect(html).toContain('CALC BASIS:');
    expect(html).toContain('AHJ-ADOPTED IBC / IRC / IFC:');
    expect(html).toContain('PENDING VERIFICATION');
  });

  it('the cover never says "designed per … IBC PENDING"', () => {
    expect(html).not.toMatch(/designed per[^.]*IBC PENDING/i);
    expect(html).not.toMatch(/designed per\s+NEC/i);   // the old conflated clause is gone
  });

  it('the title-block general note states an analysis basis, not conformance to a pending edition', () => {
    expect(html).toContain('Analysis basis: NEC');
    expect(html).not.toMatch(/conform to NEC[^.]*PENDING IBC/i);
  });
});
