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
  'CODE-AUTHORITY-INCOMPLETE',
  'ROUTE-LENGTH-ESTIMATE',
  'PENDING-RACKING-ASSEMBLY-SELECTION',
  'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
  'RACKING-CAPACITY-APPLICABILITY-GAP',
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
    for (const code of ['CONDUIT-FILL-PENDING', 'TAP-CONDUCTOR-LENGTH-PENDING', 'MODULE-EXACT-DATASHEET-PENDING']) {
      expect(blockingCodes.has(code), `${code} promoted`).toBe(true);
    }
    for (const code of LEGIT_BLOCKERS) expect(blockingCodes.has(code), `${code} preserved`).toBe(true);
  });
});
