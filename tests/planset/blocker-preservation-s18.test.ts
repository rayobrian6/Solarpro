// ═══════════════════════════════════════════════════════════════════════════
// §18 PRESERVATION — the legitimate project blockers Ray enumerated must ALWAYS
// fire on the Braidon state, render on RS-1, and never be auto-resolved. The §17
// severity promotions must not weaken or suppress any of them.
//
// Ray's enumerated legitimate blockers (all BLOCKING):
//   EQUIPMENT-IDENTITY-CONFLICT (REC-405 vs Qcells-400), PROJECT-NAME-NONPRODUCTION
//   (TEST name), DESIGNER-OF-RECORD-MISSING (blank designer), PROJECT-AUTHORITY-
//   UNVERIFIED, CODE-AUTHORITY-INCOMPLETE, ROUTE-LENGTH-ESTIMATE, PENDING-RACKING-
//   ASSEMBLY-SELECTION, RACKING-CAPACITY-SOURCE-NOT-ARCHIVED, RACKING-CAPACITY-
//   APPLICABILITY-GAP, ENGINEERING-REVIEW-PENDING, STRUCTURAL-FRAMING-UNVERIFIED.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

// The LEGITIMATE blockers Ray listed for §18. Each must fire on the live Braidon
// state ("…Solar TEST" name, blank designer, REC-405 subSystems conflict).
const LEGIT_BLOCKERS = [
  'EQUIPMENT-IDENTITY-CONFLICT',
  'PROJECT-NAME-NONPRODUCTION',
  'DESIGNER-OF-RECORD-MISSING',
  'PROJECT-AUTHORITY-UNVERIFIED',
  // NATIONWIDE BASELINE (2026-08-27) — CODE-AUTHORITY-INCOMPLETE is deliberately NOT in this list
  // any more. It used to fire on every package in existence, because clearing it required an
  // archived, operator-confirmed adoption ordinance. The NEC edition now resolves from the state
  // adoption table and prints WITH that basis named, so there is a stated, checkable code basis and
  // nothing to block on. It still fires when there is no basis at all (an unlocalized project), and
  // the new CODE-AUTHORITY-CONFLICT still fires when governed ordinances disagree — both are
  // asserted directly in tests/planset/code-authority-w4.test.ts.
  'ROUTE-LENGTH-ESTIMATE',
  // GOVERNING-CANDIDATE ENVELOPE (2026-08-27) — no longer in the BLOCKING set. The rail bending
  // demand M = w·L²/8 does not depend on which rail is fitted, so once the weakest span-screened
  // candidate carries it, every listed candidate does: the design is complete and specified by
  // performance, and only the distributor part number is outstanding. It is still raised (advisory)
  // on every unpinned assembly, and RACKING-RAIL-CAPACITY-UNBOUNDED still BLOCKS when the envelope
  // cannot be bounded. Asserted in structural-correction-w and release-gate-model-rgm.
  // SHIPPED MANUFACTURER STRUCTURAL CATALOGUE (2026-08-28) — both
  // RACKING-CAPACITY-* codes leave this list, for the same reason
  // CODE-AUTHORITY-INCOMPLETE did: they fired on every Roof Tech package in
  // existence because clearing them required each operator to archive a
  // manufacturer PE letter by hand. SolarPro now ships the stamped RT-Mini II
  // Illinois letter — identity, seal, source URL, SHA-256 and the archived bytes
  // in-repo — so there is a real source of record and nothing to block on.
  //
  // Nothing was relaxed: the clearance predicate is untouched and still refuses a
  // wrong generation, a wrong state, a wrong document class, an unarchived file
  // or a missing hash. Every one of those refusals is asserted directly in
  // tests/planset/manufacturer-structural-catalogue.test.ts.
  'ENGINEERING-REVIEW-PENDING',
  'FRAMING-AUTHORITY-UNVERIFIED',
] as const;

/** Reproduce the live Braidon state that triggers the identity blockers. */
function renderLiveBraidon(): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  input.project.projectName = 'BRAIDON M PILLA — Solar TEST';
  input.project.designer = '';
  input.project.subSystems = { roof: { panelId: 'rec-alpha-pure-405' } };
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

function rs1Fragment(html: string): string {
  // RGM §5 — the union of RS-1 + its RS-1.n continuation sheets.
  const parts = html.split('<div class="page">');
  return parts.filter(p => p.includes('permitReadiness.registry')).join('\n');
}

describe('§18 — legitimate project blockers are preserved (Braidon state)', () => {
  const { html, snap } = renderLiveBraidon();
  const reg = snap.permitReadiness.registry;
  const rs1 = rs1Fragment(html);

  it('every enumerated legitimate blocker fires as a BLOCKING, unresolved registry entry', () => {
    for (const code of LEGIT_BLOCKERS) {
      const entry = reg.find(r => r.code === code);
      expect(entry, `${code} must fire on the Braidon state`).toBeTruthy();
      expect(entry!.severity, `${code} must be blocking`).toBe('blocking');
      expect(entry!.resolved, `${code} must not be auto-resolved`).toBe(false);
      expect(entry!.resolutionAuditRef, `${code} must have no resolution audit ref`).toBeNull();
    }
  });

  it('every enumerated legitimate blocker is rendered on RS-1', () => {
    expect(rs1.length).toBeGreaterThan(0);
    for (const code of LEGIT_BLOCKERS) {
      expect(rs1, `${code} must be rendered on RS-1`).toContain(code);
    }
  });

  it('every enumerated legitimate blocker is in the back-compat BLOCKING blockers list', () => {
    const codes = new Set(snap.permitReadiness.blockers.map(b => b.code));
    for (const code of LEGIT_BLOCKERS) expect(codes.has(code), `${code}`).toBe(true);
  });

  it('the §17 promotions do not suppress any legitimate blocker — none is resolved anywhere', () => {
    // No registry entry (of ANY code) is auto-resolved in the pure build path.
    for (const r of reg) {
      expect(r.resolved, `${r.code} must never be auto-resolved`).toBe(false);
      expect(r.resolutionAuditRef).toBeNull();
    }
    // The package is never permit-ready while these blockers are active.
    expect(snap.permitReadiness.ready).toBe(false);
    expect(snap.permitReadiness.blockers.length).toBeGreaterThanOrEqual(LEGIT_BLOCKERS.length);
  });

  it('the §17 promoted codes coexist with the legitimate blockers (both present, all blocking)', () => {
    const blockingCodes = new Set(reg.filter(r => r.severity === 'blocking').map(r => r.code));
    // AAC WS-7 (2026-07-27): CONDUIT-FILL-PENDING is no longer among them — the
    // NEC Ch.9 Table 1 fill is COMPUTED and reaches the snapshot, so the
    // requirement is resolved rather than promoted. Asserted positively below.
    for (const code of ['MODULE-EXACT-DATASHEET-PENDING']) {
      expect(blockingCodes.has(code), `${code} promoted`).toBe(true);
    }
    expect(blockingCodes.has('CONDUIT-FILL-PENDING'), 'conduit fill is computed, not pending').toBe(false);
    // 2026-08-28 TAP MIGRATION - the same shape as the CONDUIT-FILL case above:
    // TAP-CONDUCTOR-LENGTH-PENDING is absent because the DESIGN now constrains
    // the tap span (the drawing carries the placement requirement and the engine
    // fixes the span at the NEC 705.11(C) maximum), not because the requirement
    // was softened. Asserted positively, with the reason, so a future regression
    // that merely stops emitting it cannot pass here.
    expect(blockingCodes.has('TAP-CONDUCTOR-LENGTH-PENDING'), 'tap span is design-constrained').toBe(false);
    // …and the racking-capacity codes are absent because a document RESOLVED,
    // not because the gate stopped asking.
    expect(blockingCodes.has('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')).toBe(false);
    const ra = snap.structural.rackingAssembly as unknown as {
      structuralAuthorityGaps: unknown[];
      documentRoles: Record<string, { established: boolean; documentHash: string | null }>;
    };
    expect(ra.structuralAuthorityGaps).toEqual([]);
    expect(ra.documentRoles.structuralCapacityAuthority.documentHash).toMatch(/^[0-9a-f]{64}$/);
    const tapSeg = (snap.electrical.routeSegments ?? []).find(s => s.segmentId === 'DISCO_TO_METER_RUN')!;
    expect(tapSeg.lengthSource).toBe('known-design');
    expect(tapSeg.oneWayFt!).toBeLessThanOrEqual(10);
    expect((snap.electrical as unknown as { conduitFillAuthority?: { state?: string } }).conduitFillAuthority?.state).toBe('computed');
    for (const code of LEGIT_BLOCKERS) expect(blockingCodes.has(code), `${code} preserved`).toBe(true);
  });
});
