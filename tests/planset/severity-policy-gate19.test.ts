// ═══════════════════════════════════════════════════════════════════════════
// §17 SEVERITY POLICY + GATE 19 — permit-critical missing inputs are BLOCKERS,
// not advisories; every advisory carries a written justification.
//
// Covers:
//  • the pure severity-policy function (classifyBlockerSeverity / severityFromImpact
//    / validateSeverityPolicy) — the documented rule + fail-closed behaviour;
//  • the three §17 promotions (CONDUIT-FILL-PENDING, TAP-CONDUCTOR-LENGTH-PENDING,
//    MODULE-EXACT-DATASHEET-PENDING) are BLOCKING on the Braidon snapshot;
//  • gate 19 compliance on the built snapshot: every advisory entry carries a
//    justification, blocking entries carry none, and permit-ready is impossible
//    while any blocking entry is active;
//  • the one legitimately-advisory blocker (EQUIPMENT-DOCUMENT-UNVERIFIED) is
//    advisory WITH a justification end-to-end, and RS-1 renders that justification.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  classifyBlockerSeverity, severityFromImpact, validateSeverityPolicy,
  SEVERITY_POLICY,
} from '@/lib/permit/snapshot/severityPolicy';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
// §17's permit-critical promotions. CONDUIT-FILL-PENDING was one of them until
// AAC WS-7 (2026-07-27) fixed the projection seam that discarded the computed
// NEC Ch.9 Table 1 fill: the requirement is now RESOLVED on this fixture (the
// calculation exists, runs, and its result reaches the snapshot), so it is no
// longer an ACTIVE promoted blocker. Its severity POLICY is unchanged and is
// still asserted in the policy table above; what changed is the fixture's truth.
// The AAC-4 case below proves the fill is computed rather than absent.
// 2026-08-28 TAP MIGRATION — TAP-CONDUCTOR-LENGTH-PENDING left this list.
// §17 promoted it from advisory to blocking, and that promotion still holds:
// the severity POLICY below is unchanged and still marks it permit-critical.
// What changed is that it no longer FIRES on this fixture — the tap span is now
// constrained by the design, so there is nothing to promote. Asserting its
// presence here would pin a requirement OPEN, which is the opposite of the
// property §17 is about. `PROMOTED_POLICY` keeps the policy assertion (which is
// what §17 actually mandates); `PROMOTED_ON_FIXTURE` keeps the on-snapshot one.
const PROMOTED_POLICY = ['TAP-CONDUCTOR-LENGTH-PENDING', 'MODULE-EXACT-DATASHEET-PENDING'] as const;
const PROMOTED = ['MODULE-EXACT-DATASHEET-PENDING'] as const;

function renderWith(mut?: (fx: any) => void): { html: string; snap: PermitDesignSnapshot } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-22T12:00:00Z';
  if (mut) mut(input);
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

/** RS-1 review-status page fragment (anchored on its unique footer marker). */
function rs1Fragment(html: string): string {
  // RGM §5 — the review-status registry paginates onto RS-1.n continuation
  // sheets; the fragment is the UNION of every RS sheet (all carry the footer
  // marker `permitReadiness.registry`, which the cover's index row never does).
  const parts = html.split('<div class="page">');
  return parts.filter(p => p.includes('permitReadiness.registry')).join('\n');
}

// ─── 1. the pure severity policy (documented rule + fail-closed) ──────────────

describe('§17 severity policy — pure function', () => {
  // PROCUREMENT IS NOT A PERMIT AXIS (2026-08-27). This severity is the PERMIT-readiness verdict.
  // Procurement readiness is a separate release with its own authority — ECD W1-B holds BOM rows
  // non-orderable via `procurement.blockingRequirementCodes` — so counting procurement here too
  // double-counted it and made a package unissuable over a missing distributor part number, which
  // no AHJ asks for. Every PERMIT axis still blocks on its own, which is what this case now pins.
  it('severityFromImpact is BLOCKING as soon as any PERMIT axis is touched, else advisory', () => {
    const none = { safety: false, codeCompliance: false, procurement: false, engineeringApproval: false, permitAcceptance: false };
    expect(severityFromImpact(none)).toBe('warning');
    const permitAxes = ['safety', 'codeCompliance', 'engineeringApproval', 'permitAcceptance'] as const;
    for (const axis of permitAxes) {
      expect(severityFromImpact({ ...none, [axis]: true }), `${axis} must block`).toBe('blocking');
    }
    // procurement ALONE is advisory for permit purposes...
    expect(severityFromImpact({ ...none, procurement: true })).toBe('warning');
    // ...but never masks a permit axis when both are declared.
    expect(severityFromImpact({ ...none, procurement: true, safety: true })).toBe('blocking');
  });

  it('the three §17 codes classify BLOCKING with no advisory justification', () => {
    // POLICY assertion — unchanged by whether the code fires on a given fixture.
    for (const code of PROMOTED_POLICY) {
      const c = classifyBlockerSeverity(code);
      expect(c.severity, `${code} must be blocking`).toBe('blocking');
      expect(c.justification).toBe('');
    }
  });

  it('an UNMAPPED code fails closed to BLOCKING (advisory requires an explicit entry)', () => {
    const c = classifyBlockerSeverity('SOME-UNKNOWN-BLOCKER-CODE');
    expect(c.severity).toBe('blocking');
    expect(c.justification).toBe('');
  });

  it('the one legitimately-advisory code carries a written justification', () => {
    const c = classifyBlockerSeverity('EQUIPMENT-DOCUMENT-UNVERIFIED');
    expect(c.severity).toBe('warning');
    expect(c.justification.trim().length).toBeGreaterThan(40);
  });

  it('every advisory policy entry carries a justification; blocking entries carry none (gate 19)', () => {
    expect(validateSeverityPolicy()).toEqual([]);
    for (const [code, rule] of Object.entries(SEVERITY_POLICY)) {
      const sev = severityFromImpact(rule.impact);
      if (sev === 'warning') expect(rule.justification.trim().length, `${code}`).toBeGreaterThan(0);
      else expect(rule.justification, `${code}`).toBe('');
    }
  });
});

// ─── 2. §17 promotions land on the built Braidon snapshot ─────────────────────

describe('§17 — permit-critical advisories are promoted to blockers on the snapshot', () => {
  const { snap } = renderWith();
  const reg = snap.permitReadiness.registry;

  it('the §17-promoted codes that FIRE do so as BLOCKING', () => {
    for (const code of PROMOTED) {
      const entry = reg.find(r => r.code === code);
      expect(entry, `${code} must be present on the Braidon snapshot`).toBeTruthy();
      expect(entry!.severity, `${code} must be blocking`).toBe('blocking');
      expect(entry!.justification).toBe('');
    }
  });

  // ANTI-VACUITY counterpart for the code that left PROMOTED: it is absent
  // because the design CONSTRAINS the tap span, not because the requirement was
  // softened — the same shape as the CONDUIT-FILL-PENDING case below.
  it('TAP-CONDUCTOR-LENGTH-PENDING is absent because the span is DESIGN-CONSTRAINED', () => {
    expect(reg.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-PENDING')).toBeFalsy();
    expect(reg.find(r => r.code === 'TAP-CONDUCTOR-LENGTH-EXCEEDED')).toBeFalsy();
    const seg = (snap.electrical.routeSegments ?? []).find(s => s.segmentId === 'DISCO_TO_METER_RUN')!;
    expect(seg.lengthSource).toBe('known-design');
    expect(seg.oneWayFt!).toBeLessThanOrEqual(10);
    // and the policy that would have made it block is still on the books
    expect(classifyBlockerSeverity('TAP-CONDUCTOR-LENGTH-PENDING').severity).toBe('blocking');
  });

  it('the promoted codes now appear in the back-compat BLOCKING blockers list', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    for (const code of PROMOTED) expect(codes).toContain(code);
  });

  // AAC WS-7 — the anti-vacuity counterpart: CONDUIT-FILL-PENDING is absent
  // because the fill was COMPUTED, not because the requirement was softened.
  it('CONDUIT-FILL-PENDING is absent because the NEC Ch.9 Table 1 fill is COMPUTED', () => {
    expect(reg.find(r => r.code === 'CONDUIT-FILL-PENDING')).toBeFalsy();
    const cf = (snap.electrical as unknown as { conduitFillAuthority?: { state?: string; fillPct?: number | null; limitPct?: number } }).conduitFillAuthority;
    expect(cf?.state).toBe('computed');
    expect(typeof cf?.fillPct).toBe('number');
    expect(cf!.fillPct!).toBeLessThanOrEqual(cf!.limitPct!);
  });
});

// ─── 3. gate 19 compliance on the built snapshot ──────────────────────────────

describe('gate 19 — severity-policy compliance on the snapshot registry', () => {
  const { snap } = renderWith();
  const reg = snap.permitReadiness.registry;

  it('every registry entry classified advisory carries a non-empty justification', () => {
    for (const r of reg) {
      if (r.severity === 'warning') {
        expect(r.justification.trim().length, `${r.code} advisory must carry a justification`).toBeGreaterThan(0);
      } else {
        expect(r.justification, `${r.code} blocking must not carry a justification`).toBe('');
      }
    }
  });

  it('the registry severity equals the canonical policy classification for every code', () => {
    for (const r of reg) {
      expect(r.severity, `${r.code}`).toBe(classifyBlockerSeverity(r.code).severity);
    }
  });

  it('permit-ready is impossible while any blocking entry is active', () => {
    const activeBlocking = reg.filter(r => r.severity === 'blocking' && !r.resolved);
    expect(activeBlocking.length).toBeGreaterThan(0);
    expect(snap.permitReadiness.ready).toBe(false);
    // the back-compat list is exactly the active blocking set (issue-state gate).
    expect(snap.permitReadiness.blockers.map(b => b.code).sort())
      .toEqual(activeBlocking.map(r => r.code).sort());
  });
});

// ─── 4. advisory end-to-end + RS-1 justification render ───────────────────────

describe('§17 — advisory classification is rendered on RS-1 with its justification', () => {
  // Swap the inverter to an APsystems micro that resolves in equipment-db but has
  // NO verified manufacturer datasheet on file → EQUIPMENT-DOCUMENT-UNVERIFIED
  // fires as the (only) advisory, exercising the justification path.
  const { html, snap } = renderWith(fx => {
    for (const inv of fx.system?.inverters ?? []) { inv.model = 'DS3-S'; inv.manufacturer = 'APsystems'; }
  });
  const rs1 = rs1Fragment(html);
  const advisory = snap.permitReadiness.registry.find(r => r.code === 'EQUIPMENT-DOCUMENT-UNVERIFIED');

  it('the advisory fires as WARNING with a non-empty justification on the snapshot', () => {
    expect(advisory, 'EQUIPMENT-DOCUMENT-UNVERIFIED should fire for an unverified micro').toBeTruthy();
    expect(advisory!.severity).toBe('warning');
    expect(advisory!.justification.trim().length).toBeGreaterThan(40);
  });

  it('RS-1 renders the advisory row AND its written justification', () => {
    expect(rs1.length).toBeGreaterThan(0);
    expect(rs1).toContain('EQUIPMENT-DOCUMENT-UNVERIFIED');
    expect(rs1).toContain('ADVISORY JUSTIFICATION');
    // a distinctive phrase from the justification text is present on the sheet.
    expect(rs1).toMatch(/only the archived manufacturer datasheet PDF is missing/i);
  });

  it('the promoted permit-critical codes still block even with the advisory present', () => {
    const codes = snap.permitReadiness.registry.filter(r => r.severity === 'blocking').map(r => r.code);
    for (const code of PROMOTED) expect(codes).toContain(code);
    expect(snap.permitReadiness.ready).toBe(false);
  });
});
