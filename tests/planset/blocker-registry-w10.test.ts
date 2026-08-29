// ═══════════════════════════════════════════════════════════════════════════
// W10 (RP-D) — BLOCKER REGISTRY VISIBILITY.
//
// Gate 14: no active release blocker is absent from the rendered registry (RS-1).
// Gate 15: the equipment-identity conflict is visibly rendered while unresolved.
// Plus: the structural-else-everything ternary is fixed (banner enumerates the
// UNION), identity blockers (TEST name / blank designer) are emitted, and the
// canonical registry is structured + single-sources the back-compat list.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { structuralBanner } from '@/lib/permit/snapshot/structuralProjection';
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
  const { snap } = renderWith(fx => { fx.project.subSystems = { roof: { panelId: 'rec-alpha-pure-405' } }; });

  it('structuralBanner.blockers is the UNION (includes the non-structural equipment conflict)', () => {
    const b = structuralBanner(snap);
    const codes = b.blockers.map(x => x.code);
    // structural blockers exist (RT-MINI) AND the equipment conflict is present
    // in the SAME union — the old ternary would have dropped the latter.
    expect(b.structuralBlockers.length).toBeGreaterThan(0);
    expect(codes).toContain('EQUIPMENT-IDENTITY-CONFLICT');
  });

  it('the rendered structural banner enumerates a non-structural blocker (not structural-only)', () => {
    const b = structuralBanner(snap);
    const htmlBanner = structuralBannerHtml(b);
    // The equipment-identity conflict message mentions the REC panel — it must
    // appear even though structural blockers are also present.
    expect(htmlBanner).toMatch(/MODULE IDENTITY CONFLICT/i);
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
