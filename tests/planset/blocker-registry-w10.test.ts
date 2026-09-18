// ═══════════════════════════════════════════════════════════════════════════
// W10 (RP-D) — BLOCKER REGISTRY VISIBILITY.
//
// Gate 14: no active release blocker is absent from the rendered registry (RS-1).
// Gate 15: the equipment-identity conflict is visibly rendered while unresolved.
// Plus: the structural-else-everything ternary is fixed (the requirement model
// carries the UNION — 2026-09-18 Ray's ruling retired the RENDERED banner, so
// that is now asserted on the model + RS-1, and the renderer is pinned empty),
// identity blockers (TEST name / blank designer) are emitted, and the
// canonical registry is structured + single-sources the back-compat list.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
// bannerRequirementsForSheet: the per-sheet requirement MODEL the retired banner
// renderer used to read. 2026-09-18 Ray's ruling took the rendered box off the
// sheets; the model it read is untouched and is where the UNION is now asserted.
import { structuralBanner, bannerRequirementsForSheet } from '@/lib/permit/snapshot/structuralProjection';
import { structuralBannerHtml } from '@/lib/permit/utils/structuralBanner';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function renderWith(mut?: (fx: any) => void): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  if (mut) mut(input);
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

/** Extract the single RS-1 review-status page fragment from the full package.
 *  Anchored on the RS-1-unique footer marker (`permitReadiness.registry`) so the
 *  cover's SHEET INDEX row (which now lists RS-1 / REVIEW STATUS) never matches. */
function rs1Fragment(html: string): string {
  // RGM §5: the review-status registry paginates onto RS-1.n continuation
  // sheets, so the fragment is the UNION of every RS sheet. Each RS sheet
  // carries the footer marker `permitReadiness.registry`; the cover's SHEET
  // INDEX row never does.
  const parts = html.split('<div class="page">');
  return parts.filter(p => p.includes('permitReadiness.registry')).join('\n');
}

describe('W10 — permit-readiness registry is canonical + structured', () => {
  const { snap } = renderWith();

  it('every snapshot carries a structured registry alongside the back-compat list', () => {
    const reg = snap.permitReadiness.registry;
    expect(Array.isArray(reg)).toBe(true);
    expect(reg.length).toBeGreaterThan(0);
    for (const r of reg) {
      expect(typeof r.code).toBe('string');
      expect(['blocking', 'warning']).toContain(r.severity);
      expect(typeof r.domain).toBe('string');
      expect(typeof r.authorityPath).toBe('string');
      expect(Array.isArray(r.affectedSheets)).toBe(true);
      expect(typeof r.explanation).toBe('string');
      expect(typeof r.resolutionAction).toBe('string');
      expect(r.provenance).toBeTruthy();
      expect(r.resolved).toBe(false);
      expect(r.resolutionAuditRef).toBeNull();
    }
  });

  it('createdAtIso uses the snapshot generation time (no Date.now in the pure path)', () => {
    for (const r of snap.permitReadiness.registry) {
      expect(r.createdAtIso).toBe(snap.meta.generatedAtIso);
      expect(r.createdVersion).toBe(snap.meta.engineVersion);
    }
  });

  it('back-compat blockers list is single-sourced from the BLOCKING registry entries', () => {
    const blockingCodes = snap.permitReadiness.registry
      .filter(r => r.severity === 'blocking' && !r.resolved).map(r => r.code).sort();
    const listCodes = snap.permitReadiness.blockers.map(b => b.code).sort();
    expect(listCodes).toEqual(blockingCodes);
  });

  it('the always-present engineering-review + route-estimate blockers are present', () => {
    const codes = snap.permitReadiness.registry.map(r => r.code);
    expect(codes).toContain('ENGINEERING-REVIEW-PENDING');
    // 2026-08-28 ROUTE-BOUND MIGRATION - ROUTE-LENGTH-ESTIMATE no longer fires on
  // this fixture: the DESIGN bounds each un-routed run by stating the maximum
  // one-way length at which the selected conductor still meets its Vd limit, and
  // the drawing carries that requirement. Nothing was relaxed - an unbounded run
  // still blocks, an estimate over its bound raises
  // ROUTE-LENGTH-EXCEEDS-DESIGN-BOUND, and the BOM quantity is still ESTIMATED.
  // See tests/planset/route-length-bound.test.ts.
  expect(codes).not.toContain('ROUTE-LENGTH-ESTIMATE');
  });
});

describe('W10 gate 14 — no active blocker is absent from the rendered registry (RS-1)', () => {
  const { html, snap } = renderWith();
  const rs1 = rs1Fragment(html);

  it('the RS-1 review-status sheet exists', () => {
    expect(rs1.length).toBeGreaterThan(0);
    // RGM §4: the sheet leads with the ROOT-GATE table and states the counts in
    // gate semantics ('7 OPEN RELEASE GATES / 15 UNRESOLVED REQUIREMENTS'),
    // replacing the flat 'ACTIVE RELEASE BLOCKERS' heading.
    expect(rs1).toContain('ROOT RELEASE GATES');
    expect(rs1).toMatch(/OPEN RELEASE GATE/);
  });

  it('every active registry blocker code is rendered on RS-1', () => {
    const active = snap.permitReadiness.registry.filter(r => !r.resolved);
    expect(active.length).toBeGreaterThan(0);
    for (const r of active) {
      expect(rs1, `blocker ${r.code} must be rendered on RS-1`).toContain(r.code);
    }
  });
});

describe('W10 gate 15 — the equipment-identity conflict is visibly rendered while unresolved', () => {
  // Inject the REC-405 vs Qcells-400 stored-authority conflict (the live Braidon
  // condition) — the fleet stays Qcells 400W but subSystems.roof.panelId points
  // at the REC 405W module. It must SURFACE, never be hidden by a renderer.
  const { html, snap } = renderWith(fx => { fx.project.subSystems = { roof: { panelId: 'rec-alpha-pure-405' } }; });
  const rs1 = rs1Fragment(html);

  it('the conflict is an active (unresolved) first-class registry entry', () => {
    const conflict = snap.permitReadiness.registry.find(r => r.code === 'EQUIPMENT-IDENTITY-CONFLICT');
    expect(conflict).toBeTruthy();
    expect(conflict!.resolved).toBe(false);
    expect(conflict!.domain).toBe('equipment');
  });

  it('the conflict is rendered on RS-1 with its explanation', () => {
    expect(rs1).toContain('EQUIPMENT-IDENTITY-CONFLICT');
    expect(rs1).toMatch(/rec-alpha-pure-405/i);
  });
});

describe('W10 — the structural-else-everything ternary is fixed (UNION banner)', () => {
  const { html, snap } = renderWith(fx => { fx.project.subSystems = { roof: { panelId: 'rec-alpha-pure-405' } }; });
  const rs1 = rs1Fragment(html);

  it('structuralBanner.blockers is the UNION (includes the non-structural equipment conflict)', () => {
    const b = structuralBanner(snap);
    const codes = b.blockers.map(x => x.code);
    // structural blockers exist (RT-MINI) AND the equipment conflict is present
    // in the SAME union — the old ternary would have dropped the latter.
    expect(b.structuralBlockers.length).toBeGreaterThan(0);
    expect(codes).toContain('EQUIPMENT-IDENTITY-CONFLICT');
  });

  it('the UNION reaches the per-sheet requirement MODEL + RS-1 (the banner renderer is retired)', () => {
    // 2026-09-18 RAY'S RULING — the red per-sheet status banner came OFF every
    // sheet (PV-1 / PV-1B / PV-3 / PV-4C / PV-4C.1) and structuralBannerHtml()
    // is now a no-op returning ''. This case never really guarded that HTML: it
    // guarded the UNION — that a NON-structural requirement reaches the per-sheet
    // requirement model, which the old structural-else-everything ternary would
    // have dropped. That model (structuralBanner → bannerRequirementsForSheet) is
    // untouched and still feeds RS-1 and the release model, so the property is
    // asserted THERE, on the human-readable RS-1 record, and the removed renderer
    // is pinned as an explicit absence below so the box cannot creep back.
    const b = structuralBanner(snap);

    // ── 1. THE MODEL — the conflict reaches a sheet it is projected onto ──────
    // EQUIPMENT-IDENTITY-CONFLICT declares affectedSheets ['SCHED','APP-A','DS-1'].
    const perSheet = bannerRequirementsForSheet(b, 'SCHED');
    // NON-VACUITY: an empty own[] would make every `find` below yield undefined
    // and the case would assert nothing at all. Pin the list is populated first.
    expect(perSheet.own.length).toBeGreaterThan(0);
    const conflict = perSheet.own.find(r => r.code === 'EQUIPMENT-IDENTITY-CONFLICT');
    expect(conflict, 'the equipment conflict must reach the SCHED per-sheet model').toBeTruthy();
    // The exact line the retired banner used to print is the requirement's
    // DECLARATION sheetLine — it still lives, on the model, verbatim.
    expect(conflict!.sheetLine).toMatch(/MODULE IDENTITY CONFLICT/i);
    // ...and it is genuinely non-structural, so it can only be in `own` via the
    // UNION. Were this code structural, the assertion above would pass even under
    // the old ternary and this case would be testing nothing.
    expect(b.structuralBlockers.map(x => x.code)).not.toContain('EQUIPMENT-IDENTITY-CONFLICT');
    expect(b.structuralBlockers.length).toBeGreaterThan(0);   // both kinds coexist

    // ── 2. RS-1 — the human-readable account of the same requirement ─────────
    const at = rs1.indexOf('data-release-requirement="EQUIPMENT-IDENTITY-CONFLICT"');
    // NON-VACUITY: indexOf returns -1 when the row is missing, and slice(-1, N)
    // would then hand the assertions below the fragment's last character.
    expect(at, 'RS-1 must carry the conflict requirement row').toBeGreaterThan(-1);
    const row = rs1.slice(at, at + 3000);
    expect(row).toContain('OPEN');
    expect(row).toMatch(/rec-alpha-pure-405/i);               // the conflicting identity, spelled out

    // ── 3. THE RETIRED RENDERER — pinned as ABSENCE, not silence ─────────────
    // Ray had to say it twice because a first pass only REWORDED the box. An
    // empty string here (with and without a sheet identity) is what stops a
    // re-wiring from quietly restoring it.
    expect(structuralBannerHtml(b)).toBe('');
    expect(structuralBannerHtml(b, { sheetId: 'SCHED' })).toBe('');
    expect(structuralBannerHtml(snap)).toBe('');
  });
});

describe('W10 — production IDENTITY blockers are emitted (TEST name / blank designer)', () => {
  const { snap } = renderWith(fx => {
    fx.project.projectName = 'BRAIDON M PILLA — Solar TEST';
    fx.project.designer = '';
  });

  it('a TEST project name and a blank designer both surface as blocking registry entries', () => {
    const codes = snap.permitReadiness.registry.filter(r => r.severity === 'blocking').map(r => r.code);
    expect(codes).toContain('PROJECT-NAME-NONPRODUCTION');
    expect(codes).toContain('DESIGNER-OF-RECORD-MISSING');
  });
});
