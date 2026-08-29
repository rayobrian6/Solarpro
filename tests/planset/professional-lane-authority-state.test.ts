// ═══════════════════════════════════════════════════════════════════════════
// SOMEBODY ELSE'S OUTSTANDING ACT WAS BOOKED AS OUR ENGINEERING DEBT
//
// `authorityStateOf` classified any requirement with no resolver and no attempt
// as RESOLVER_NOT_IMPLEMENTED — "no owning resolver exists yet". For
// ENGINEERING-REVIEW-PENDING that is a category error: its resolution mode is
// PROFESSIONAL_APPROVAL, and no resolver can ever close it. A licensed engineer
// signs, or nobody does. The same is true of FIELD_VERIFICATION (somebody must
// go and measure) and OPERATOR_CONFIRMATION (somebody must decide).
//
// The lifecycle already knew this. Its pending-resolver sweep skips them in so
// many words — "non-automatic modes legitimately have no resolver" — and reads
// the SAME `resolutionMode` field off the SAME state object. The projection
// carried the opposite rule over the same fact, so the one requirement that can
// only ever be closed by a signature was reported as SolarPro owing unwritten
// code.
//
// This matters beyond wording: it is the number that decides whether the
// remaining work is ours. Under Ray's lane ruling an unstamped engineering set
// that owes nothing else IS the finished product, and a scorecard that books the
// engineer's signature as our missing resolver says the opposite.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { projectResolvedAuthority } from '@/lib/permit/snapshot/resolution/authorityProjection';
import { isAutomaticMode, type ResolutionMode } from '@/lib/permit/snapshot/resolution/types';

/** A state with no resolver and nothing attempted — the shape that used to read
 *  RESOLVER_NOT_IMPLEMENTED whatever kind of requirement it was. */
const unresolved = (mode: ResolutionMode): any => ({
  requirementCode: 'X',
  resolutionMode: mode,
  resolverId: null,
  resolverImplemented: false,
  attemptedResolverIds: [],
  cleared: false,
  resolutionAuditRef: null,
  lastResolutionResult: 'NOT_ATTEMPTED',
  evidence: [],
});

describe('a missing resolver is only a defect where a resolver was owed', () => {
  it('an AUTOMATIC requirement with no resolver is still our debt', () => {
    for (const mode of ['AUTO_DERIVED', 'AUTO_RETRIEVED'] as const) {
      const p: any = projectResolvedAuthority(unresolved(mode));
      expect(isAutomaticMode(mode)).toBe(true);
      expect(p.authorityState, mode).toBe('RESOLVER_NOT_IMPLEMENTED');
      expect(p.unresolvedReasonCode, mode).toBe('RESOLVER_NOT_IMPLEMENTED');
    }
  });

  it('a requirement closed by someone ELSE is awaiting them, not us', () => {
    for (const mode of ['PROFESSIONAL_APPROVAL', 'FIELD_VERIFICATION', 'OPERATOR_CONFIRMATION'] as const) {
      const p: any = projectResolvedAuthority(unresolved(mode));
      expect(isAutomaticMode(mode)).toBe(false);
      expect(p.authorityState, mode).toBe('AWAITING_EXTERNAL_AUTHORITY');
      expect(p.unresolvedReasonCode, mode).toBe('AWAITING_EXTERNAL_AUTHORITY');
    }
  });

  it('the reason code is not folded into AUTHORITY_NOT_ESTABLISHED', () => {
    // A `default` branch would have swallowed the new state and reported "we
    // looked and found nothing" — the opposite of "this waits on an act".
    const p: any = projectResolvedAuthority(unresolved('PROFESSIONAL_APPROVAL'));
    expect(p.unresolvedReasonCode).not.toBe('AUTHORITY_NOT_ESTABLISHED');
  });

  it('an ATTEMPTED requirement is judged on the attempt, whatever its mode', () => {
    // The new branch must not capture states that really were tried and failed.
    const tried = { ...unresolved('PROFESSIONAL_APPROVAL'), attemptedResolverIds: ['r1'],
      lastResolutionResult: 'FAILED' };
    const p: any = projectResolvedAuthority(tried);
    expect(p.authorityState).toBe('NOT_ESTABLISHED');
  });

  it('and an established authority still reads ESTABLISHED', () => {
    const done = { ...unresolved('PROFESSIONAL_APPROVAL'), cleared: true,
      resolutionAuditRef: 'audit:pe-seal-1' };
    const p: any = projectResolvedAuthority(done);
    expect(p.authorityState).toBe('ESTABLISHED');
    expect(p.unresolvedReasonCode).toBeNull();
  });
});
