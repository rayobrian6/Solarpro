// ═══════════════════════════════════════════════════════════════════════════
// A REGISTRY GAP IS ANSWERED BY DISCOVERY, NEVER BY SUBSTITUTION.
//
// Ray's ruling: queue discovery automatically, hold ONLY authority-dependent
// permit release, never block design, never ship a permit-ready package with
// the government merely substituted as the AHJ, and terminate a failed
// discovery in a typed manual-review state.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  openDiscovery, authorityHoldFor, applyDiscoveryResult, persistGovernedRecord,
  isFullyVerified, DISCOVERY_TERMINAL_STATES,
  type DiscoveredAuthorityEvidence,
} from '@/lib/jurisdictions/permittingAuthorityDiscovery';
import type { LegalGovernmentIdentity } from '@/lib/jurisdictions/legalGovernmentIdentity';

const GOV: LegalGovernmentIdentity = {
  entityType: 'incorporated-place', stateFips: '09', countyFips: '09005',
  placeGeoid: '0931180', mcdGeoid: null, canonicalName: 'Goshen town',
  matchMethod: 'state+county+place-name',
  source: 'US Census Bureau', sourceVintage: '2020', sourceSha256: 'a'.repeat(64),
};
const NOW = '2026-08-30T00:00:00.000Z';

const FULL: DiscoveredAuthorityEvidence = {
  departmentName: 'Goshen Building Department',
  scopes: ['building', 'electrical'],
  sourceUrl: 'https://example.invalid/goshen/building',
  retrievedAtIso: NOW,
  codeAuthority: { sourceUrl: 'https://example.invalid/goshen/codes', retrievedAtIso: NOW },
};

describe('the gap is queued automatically', () => {
  it('opens already queued — no operator action to get there', () => {
    const r = openDiscovery(GOV, 'Goshen town', NOW);
    expect(r.state).toBe('DISCOVERY_QUEUED');
    expect(r.queuedAtIso).toBe(NOW);
  });
});

describe('the hold is scope-specific', () => {
  it('never blocks design or design review, only permit release', () => {
    const hold = authorityHoldFor(openDiscovery(GOV, 'Goshen town', NOW));
    expect(hold.blocksDesign).toBe(false);
    expect(hold.blocksDesignReview).toBe(false);
    expect(hold.blocksPermitRelease).toBe(true);
  });

  it('names the government and says verification is in progress', () => {
    // A design-review package may go out identifying the VERIFIED legal
    // government; what it may not do is name a substitute.
    const hold = authorityHoldFor(openDiscovery(GOV, 'Goshen town', NOW));
    expect(hold.basis).toContain('Goshen town');
    expect(hold.basis).toContain('place 0931180');
    expect(hold.basis).toMatch(/IN PROGRESS/i);
    expect(hold.basis).toMatch(/not been replaced by a substitute/i);
  });

  it('holds nothing when there is no gap', () => {
    const hold = authorityHoldFor(null);
    expect(hold.blocksPermitRelease).toBe(false);
  });
});

describe('discovery outcomes', () => {
  it('full evidence verifies', () => {
    const r = applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: FULL });
    expect(r.state).toBe('AUTHORITY_VERIFIED');
    expect(isFullyVerified(r.evidence)).toBe(true);
  });

  it('PARTIAL evidence does not verify and does not clear the hold', () => {
    // A department name with no code-adoption provenance is not enough: a permit
    // package cites adopted codes.
    const partial = { ...FULL, codeAuthority: null };
    const r = applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: partial });
    expect(r.state).toBe('AUTHORITY_DISCOVERED');
    expect(authorityHoldFor(r).blocksPermitRelease).toBe(true);
  });

  it('a discovered authority with NO scopes does not verify', () => {
    const noScope = { ...FULL, scopes: [] };
    expect(isFullyVerified(noScope)).toBe(false);
  });

  it('failure terminates in a typed manual-review state, not a fallback', () => {
    const r = applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW),
      { evidence: null, failureReason: 'no municipal building page found' });
    expect(r.state).toBe('MANUAL_REVIEW_REQUIRED');
    expect(DISCOVERY_TERMINAL_STATES).toContain(r.state);
    const hold = authorityHoldFor(r);
    expect(hold.blocksPermitRelease).toBe(true);
    expect(hold.blocksDesign).toBe(false);
    // and it still refuses to name a substitute
    expect(hold.basis).toMatch(/none will be/i);
    expect(hold.basis).toContain('Goshen town');
  });
});

describe('a governed record cannot be born incomplete', () => {
  it('refuses to persist anything short of fully verified', () => {
    for (const bad of [
      openDiscovery(GOV, 'Goshen town', NOW),
      applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW),
        { evidence: { ...FULL, codeAuthority: null } }),
      applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW),
        { evidence: null, failureReason: 'x' }),
    ]) {
      expect(() => persistGovernedRecord(bad), bad.state).toThrow(/refusing to persist/);
    }
  });

  it('persists a fully verified record and clears the release hold', () => {
    const verified = applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: FULL });
    const persisted = persistGovernedRecord(verified);
    expect(persisted.state).toBe('GOVERNED_RECORD_PERSISTED');
    const hold = authorityHoldFor(persisted);
    expect(hold.blocksPermitRelease).toBe(false);
    // the project still has to be re-resolved against the new record
    expect(hold.basis).toMatch(/re-resolved/i);
  });
});

describe('no state in the lifecycle permits substitution', () => {
  it('every hold basis names the government, never a fallback authority', () => {
    const states = [
      openDiscovery(GOV, 'Goshen town', NOW),
      applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: { ...FULL, codeAuthority: null } }),
      applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: null }),
      persistGovernedRecord(applyDiscoveryResult(openDiscovery(GOV, 'Goshen town', NOW), { evidence: FULL })),
    ];
    for (const s of states) {
      const b = authorityHoldFor(s).basis;
      expect(b, s.state).toContain('Goshen town');
      // the words a substitution would need
      expect(b.toLowerCase(), s.state).not.toMatch(/\bcounty of\b|falling back|instead use/);
    }
  });
});
