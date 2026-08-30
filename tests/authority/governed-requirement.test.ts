import { describe, it, expect } from 'vitest';
import {
  governedRequirement, isPermitClaimable, blockingRequirements,
} from '@/lib/authority/governedRequirement';

const AUTH = { authorityLevel: 'model_code' as const, scope: 'fire_access' };

describe('the contract enforces its invariants rather than trusting callers', () => {
  it('refuses a VERIFIED provenance with nothing to cite', () => {
    // "Verified" means the stated source really is the source AND can be cited.
    // With no evidence that is a claim, not a verification.
    expect(() => governedRequirement({
      value: 36, status: 'VERIFIED_LOCAL', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'local_ordinance' },
      authority: { authorityLevel: 'municipality', scope: 'fire_access' },
    })).toThrow(/refusing to build a VERIFIED requirement with no evidence/);
  });

  it('allows a self-describing origin to be VERIFIED without a citation', () => {
    // The model code IS the source of a model-code value; SolarPro policy IS
    // the source of SolarPro policy. Demanding an external citation for those
    // would force a lie in the other direction.
    for (const origin of ['model_code', 'solarpro_policy', 'system_default'] as const) {
      expect(() => governedRequirement({
        value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
        origin: { type: origin }, authority: AUTH,
      })).not.toThrow();
    }
  });

  it('a MISATTRIBUTED fact cannot be constructed as permit-ready', () => {
    // The NEC shape: a caller asking for permit-claimable gets refused by the
    // filter, not by a reviewer noticing later.
    const r = governedRequirement({
      value: '2020', status: 'VERIFIED', provenanceIntegrity: 'MISATTRIBUTED',
      origin: { type: 'system_default' },
      authority: { authorityLevel: 'unknown', scope: 'electrical_code' },
      releaseSemantics: { usableForPermitClaim: true, blocksPermitRelease: false },
    });
    expect(r.releaseSemantics.usableForPermitClaim).toBe(false);
    expect(r.releaseSemantics.blocksPermitRelease).toBe(true);
    expect(isPermitClaimable(r)).toBe(false);
  });

  it('defaults amendmentStatus to NOT_CHECKED, never to none', () => {
    // "No amendment" and "nobody looked" are different, and the second is the
    // truth for every jurisdiction SolarPro currently holds.
    const r = governedRequirement({
      value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'model_code' }, authority: AUTH,
    });
    expect(r.amendmentStatus).toBe('NOT_CHECKED');
  });

  it('defaults usableForPermitClaim to FALSE', () => {
    // The safe default. A fact becomes a permit claim by proving itself, not by
    // being constructed.
    const r = governedRequirement({
      value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'model_code' }, authority: AUTH,
    });
    expect(r.releaseSemantics.usableForPermitClaim).toBe(false);
    expect(r.releaseSemantics.usableForDesign).toBe(true);
  });
});

describe('the real campaign facts are representable', () => {
  it('the fire pathway: modeled, honest, usable for design, not a permit claim', () => {
    const r = governedRequirement({
      value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'model_code', sourceId: 'IFC 1204.2.1' },
      authority: AUTH,
      applicability: { systemType: 'rooftop-pv', conditions: ['local adoption not verified'] },
    });
    expect(r.releaseSemantics.usableForDesign).toBe(true);
    expect(r.releaseSemantics.usableForPermitClaim).toBe(false);
    expect(r.releaseSemantics.blocksPermitRelease).toBe(false);
  });

  it('the SolarPro professional-review policy: real authority, never law', () => {
    const r = governedRequirement({
      value: 'professional review required before permit release',
      status: 'VERIFIED', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'solarpro_policy' },
      authority: { authorityLevel: 'solarpro_policy', scope: 'release_policy' },
    });
    expect(r.authority.authorityLevel).toBe('solarpro_policy');
    expect(r.authority.authorityLevel).not.toBe('municipality');
  });

  it('the legal seal requirement: separately UNKNOWN, and release-critical', () => {
    // Kept independent of the policy above. SolarPro requiring review says
    // nothing about whether a seal is legally required.
    const r = governedRequirement({
      value: null, status: 'UNKNOWN', provenanceIntegrity: 'UNKNOWN',
      origin: { type: 'unknown' },
      authority: { authorityLevel: 'unknown', scope: 'professional_seal' },
      releaseCritical: true,
    });
    expect(r.releaseSemantics.blocksPermitRelease).toBe(true);
    expect(r.releaseSemantics.usableForDesign).toBe(true);
  });

  it('a legacy AHJ row: unprovenanced, not a claim, not a blocker on its own', () => {
    const r = governedRequirement({
      value: 18, status: 'UNKNOWN', provenanceIntegrity: 'UNPROVENANCED',
      origin: { type: 'legacy_record', sourceId: 'ahj-national.roofSetbackInches' },
      authority: { authorityLevel: 'unknown', scope: 'fire_setback' },
    });
    expect(r.releaseSemantics.usableForPermitClaim).toBe(false);
    expect(r.releaseSemantics.blocksPermitRelease).toBe(false);
  });

  it('a conditional wiring rule keeps its conditions instead of collapsing', () => {
    // The NM-B lesson: "is Romex allowed" has no answer without conditions.
    const r = governedRequirement({
      value: 'NM-B', status: 'PENDING_VERIFICATION', provenanceIntegrity: 'UNKNOWN',
      origin: { type: 'unknown' },
      authority: { authorityLevel: 'unknown', scope: 'wiring_method' },
      applicability: {
        occupancy: 'residential', installationLocation: 'interior',
        wetOrDry: 'dry', concealedOrExposed: 'concealed',
        conditions: ['not rooftop', 'no local amendment checked'],
      },
    });
    expect(r.applicability.conditions).toContain('not rooftop');
    expect(r.applicability.wetOrDry).toBe('dry');
    expect(typeof r.value).not.toBe('boolean');
  });
});

describe('blockingRequirements collects what must be resolved before release', () => {
  it('returns only the blockers', () => {
    const ok = governedRequirement({
      value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
      origin: { type: 'model_code' }, authority: AUTH,
    });
    const bad = governedRequirement({
      value: '2020', status: 'VERIFIED', provenanceIntegrity: 'MISATTRIBUTED',
      origin: { type: 'system_default' },
      authority: { authorityLevel: 'unknown', scope: 'electrical_code' },
    });
    expect(blockingRequirements([ok, bad])).toEqual([bad]);
  });
});
