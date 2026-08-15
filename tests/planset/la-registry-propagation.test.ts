// ═══════════════════════════════════════════════════════════════════════════
// LA §3 — REGISTRY RESOLUTION PROPAGATION, END TO END.
//
// The MCC phase found that the registry `push` helper hardcoded
// `resolved: false` / `resolutionAuditRef: null` on EVERY record, while the
// lifecycle state carrying the answer sat in scope and was used only for payload
// prose. `deriveRequirementStatus` returns OPEN whenever `!r.resolved`, so no
// resolver clearance anywhere in the system could close anything.
//
// The MCC test proved the helper. THIS proves the whole path — through the real
// snapshot construction, the real release-gate model, and a serialization
// round-trip — because a hand-built object literal is exactly how the original
// defect stayed hidden for so long (aac-ws2 asserted closure against a literal
// it constructed itself, and passed while the artifact shipped OPEN).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import { projectReleaseGates } from '@/lib/permit/snapshot/releaseGates';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** A resolution state as the REAL lifecycle shapes it. */
const stateFor = (code: string, over: Record<string, unknown> = {}) => ({
  requirementCode: code,
  resolutionMode: 'AUTO_DERIVED', residualMode: null,
  resolverId: 'module-datasheet-binding@v1', resolverImplemented: true,
  plannedResolverPhase: null, attemptedResolverIds: ['module-datasheet-binding@v1'],
  requiredInputs: [], resolutionEvidence: [], confidence: 1,
  blockingReason: null, reasons: [], retryability: 'NON_RETRYABLE',
  lastResolutionAttempt: '2026-08-04T12:00:00Z', lastResolutionResult: 'RESOLVED',
  cleared: false, resolutionAuditRef: null, ...over,
});

const AUDIT_REF = 'AAC-RESOLVER:module-datasheet-binding@v1 document:doc-400w sha256:abcdef0123456789 @2026-08-04T12:00:00Z';
const CODE = 'MODULE-EXACT-DATASHEET-PENDING';

/** The REAL construction path: generatePermitHTML → buildPermitDesignSnapshot. */
function build(states?: Record<string, unknown>): { snap: PermitDesignSnapshot; html: string } {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = '2026-08-04T12:00:00Z';
  const html = generatePermitHTML(input as never, undefined,
    states ? ({ resolution: { states } } as never) : undefined);
  return { snap: (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot, html };
}

const rec = (s: PermitDesignSnapshot, code = CODE) =>
  s.permitReadiness.registry.find(r => r.code === code);

describe('LA §3 · a resolver clearance reaches the release gate', () => {
  it('an UNSUCCESSFUL resolver leaves the requirement open at every layer', () => {
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: false, lastResolutionResult: 'FAILED' }) });
    expect(rec(snap)?.resolved).toBe(false);
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain(CODE);
    const model = projectReleaseGates(snap);
    const rg2 = model.gates.find(g => g.gateId === 'RG-2');
    expect(rg2?.status).toBe('OPEN');
  });

  it('a SUCCESSFUL resolver closes it at every layer, including the gate model', () => {
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });

    // 1. the record the gate reads
    expect(rec(snap)?.resolved).toBe(true);
    expect(rec(snap)?.resolutionAuditRef).toBe(AUDIT_REF);
    // 2. the blocking subset
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain(CODE);
    // 3. deriveRequirementStatus, via the REAL gate model over the REAL snapshot:
    //    the code is DECLARED on its gate but no longer counted as unresolved.
    const model = projectReleaseGates(snap);
    const rg2 = model.gates.find(g => g.gateId === 'RG-2');
    expect(rg2?.requirementCodes).toContain(CODE);
    expect(rg2?.unresolvedRequirementCodes).not.toContain(CODE);
    expect(rg2?.clearedRequirementCodes).toContain(CODE);
    // 4. the package headline counts one fewer unresolved requirement
    const open = snap.permitReadiness.registry.filter(r => !r.resolved).length;
    const { snap: baseline } = build({ [CODE]: stateFor(CODE) });
    expect(open).toBe(baseline.permitReadiness.registry.filter(r => !r.resolved).length - 1);
  });

  it('the resolved state SURVIVES snapshot serialization', () => {
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });
    const round = JSON.parse(JSON.stringify(snap)) as PermitDesignSnapshot;
    expect(rec(round)?.resolved).toBe(true);
    expect(rec(round)?.resolutionAuditRef).toBe(AUDIT_REF);
    // and the gate model derived from the ROUND-TRIPPED snapshot agrees
    expect(projectReleaseGates(round).summary.unresolvedRequirementCount)
      .toBe(projectReleaseGates(snap).summary.unresolvedRequirementCount);
  });

  it('the resolved state SURVIVES regeneration of the same design', () => {
    const a = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });
    const b = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });
    expect(rec(b.snap)?.resolved).toBe(true);
    expect(b.snap.meta.digest).toBe(a.snap.meta.digest);
  });

  it('NO VACUOUS CLEARANCE — a cleared flag with no evidence reference is refused', () => {
    for (const ref of [null, '', '   ']) {
      const { snap } = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: ref }) });
      expect(rec(snap)?.resolved).toBe(false);
      expect(snap.permitReadiness.blockers.map(b => b.code)).toContain(CODE);
    }
  });

  it('an audit reference without clearance is refused (both halves required)', () => {
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: false, resolutionAuditRef: AUDIT_REF }) });
    expect(rec(snap)?.resolved).toBe(false);
  });

  it('NO DOWNSTREAM HELPER overwrites a valid resolved state', () => {
    // The snapshot is deep-frozen after validation, so a later writer would
    // throw rather than silently mutate — assert both the freeze and the value.
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });
    expect(Object.isFrozen(snap.permitReadiness.registry)).toBe(true);
    expect(rec(snap)?.resolved).toBe(true);
  });

  it('clearance is per-requirement — it does not leak to its neighbours', () => {
    const { snap } = build({ [CODE]: stateFor(CODE, { cleared: true, resolutionAuditRef: AUDIT_REF }) });
    const others = snap.permitReadiness.registry.filter(r => r.code !== CODE);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every(r => r.resolved === false)).toBe(true);
  });

  it('a clearance can NEVER stand in for the licensed professional review', () => {
    // Guards the release-reachability repair: ENGINEERING-REVIEW-PENDING is
    // decided solely by decideReviewCoverage, never by a resolver.
    const { snap } = build({
      'ENGINEERING-REVIEW-PENDING': stateFor('ENGINEERING-REVIEW-PENDING', {
        cleared: true, resolutionAuditRef: 'AAC-RESOLVER:definitely-not-a-pe @2026-08-04T12:00:00Z',
      }),
    });
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(snap.certification.engineer).toBeNull();
    expect(snap.projectAuthority.issueState).toBe('PENDING ENGINEERING REVIEW');
    expect(snap.projectAuthority.issuedForPermitGate.pass).toBe(false);
  });
});
