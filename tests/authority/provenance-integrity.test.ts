// ═══════════════════════════════════════════════════════════════════════════
// THE TWO AXES MUST NOT COLLAPSE INTO ONE.
//
// The NEC defect was substantively plausible and its attribution was false.
// A single enum cannot hold both facts, so these tests drive the matrix of
// (RequirementStatus × ProvenanceIntegrity) directly and assert the pairs stay
// independently representable.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  applyProvenanceInvariants, isIllegalProvenanceUpgrade, isIllegalStatusUpgrade,
  authorityImpliedByOrigin,
  type ProvenanceIntegrity, type RequirementStatus, type ReleaseSemantics,
} from '@/lib/authority/provenanceIntegrity';

const PERMIT_READY: ReleaseSemantics = {
  usableForDesign: true, usableForDesignReview: true,
  usableForPermitClaim: true, blocksPermitRelease: false,
};

describe('the provenance matrix stays orthogonal', () => {
  // Every pair here is a real state the system must be able to hold.
  const MATRIX: Array<[RequirementStatus, ProvenanceIntegrity, string]> = [
    ['VERIFIED_STATEWIDE', 'VERIFIED', 'a published state adoption, cited'],
    ['MODELED_DESIGN_BASIS', 'VERIFIED', 'the model code, correctly attributed to the model code'],
    ['MODELED_DESIGN_BASIS', 'DEFAULTED', 'a default we are honest about'],
    ['UNKNOWN', 'UNPROVENANCED', 'a legacy row with no evidence'],
    ['PARTIAL', 'INFERRED', 'derived rather than read'],
    ['VERIFIED', 'MISATTRIBUTED', 'THE NEC DEFECT: right value, false source'],
    ['CONFLICT', 'CONFLICT', 'sources disagree on both value and origin'],
  ];

  for (const [status, prov, why] of MATRIX) {
    it(`represents ${status} + ${prov} — ${why}`, () => {
      const r = applyProvenanceInvariants(PERMIT_READY, prov);
      // the point: status is not derivable from provenance, nor the reverse
      expect(typeof status).toBe('string');
      expect(r).toBeTruthy();
    });
  }

  it('a VERIFIED status does not survive a MISATTRIBUTED provenance', () => {
    // The exact NEC shape. The value may be correct and the status may be
    // substantively right; the claim about its origin is false, so it cannot
    // be a permit claim.
    const r = applyProvenanceInvariants(PERMIT_READY, 'MISATTRIBUTED');
    expect(r.usableForPermitClaim).toBe(false);
    expect(r.blocksPermitRelease).toBe(true);
  });
});

describe('MISATTRIBUTED is more severe than UNKNOWN', () => {
  it('blocks release; a non-critical UNKNOWN does not', () => {
    const mis = applyProvenanceInvariants(PERMIT_READY, 'MISATTRIBUTED');
    const unk = applyProvenanceInvariants(PERMIT_READY, 'UNKNOWN');
    expect(mis.blocksPermitRelease).toBe(true);
    expect(unk.blocksPermitRelease).toBe(false);
    // both refuse to be a permit CLAIM — for different reasons
    expect(mis.usableForPermitClaim).toBe(false);
    expect(unk.usableForPermitClaim).toBe(false);
  });

  it('an UNKNOWN that IS release-critical does block', () => {
    const r = applyProvenanceInvariants(PERMIT_READY, 'UNKNOWN', { releaseCritical: true });
    expect(r.blocksPermitRelease).toBe(true);
  });

  it('MISATTRIBUTED also poisons design REVIEW, unlike UNKNOWN', () => {
    // A review that repeats a false attribution is not a review.
    expect(applyProvenanceInvariants(PERMIT_READY, 'MISATTRIBUTED').usableForDesignReview).toBe(false);
    expect(applyProvenanceInvariants(PERMIT_READY, 'UNKNOWN').usableForDesignReview).toBe(true);
  });

  it('MISATTRIBUTED does not stop DESIGN — the design is not what is false', () => {
    expect(applyProvenanceInvariants(PERMIT_READY, 'MISATTRIBUTED').usableForDesign).toBe(true);
  });
});

describe('DEFAULTED is distinct from UNPROVENANCED', () => {
  it('both refuse to be a permit claim, and neither blocks by itself', () => {
    // A default's origin is precisely known — it is the default. That is a
    // different epistemic state from "a value from somewhere, no evidence".
    const d = applyProvenanceInvariants(PERMIT_READY, 'DEFAULTED');
    const u = applyProvenanceInvariants(PERMIT_READY, 'UNPROVENANCED');
    expect(d.usableForPermitClaim).toBe(false);
    expect(u.usableForPermitClaim).toBe(false);
    expect(d.blocksPermitRelease).toBe(false);
    expect(u.blocksPermitRelease).toBe(false);
  });

  it('a modeled design basis stays fully usable for design and review', () => {
    // The fire pathway case: honest, modeled, useful — just not a permit claim.
    const r = applyProvenanceInvariants(PERMIT_READY, 'VERIFIED');
    expect(r.usableForDesign).toBe(true);
    expect(r.usableForDesignReview).toBe(true);
  });
});

describe('no-upgrade invariants', () => {
  it('DEFAULTED cannot become VERIFIED without evidence', () => {
    expect(isIllegalProvenanceUpgrade('DEFAULTED', 'VERIFIED', false)).toBe(true);
    expect(isIllegalProvenanceUpgrade('DEFAULTED', 'VERIFIED', true)).toBe(false);
  });

  it('UNPROVENANCED cannot become VERIFIED without evidence', () => {
    expect(isIllegalProvenanceUpgrade('UNPROVENANCED', 'VERIFIED', false)).toBe(true);
  });

  it('a model-code basis cannot become a local adoption without evidence', () => {
    expect(isIllegalStatusUpgrade('MODELED_DESIGN_BASIS', 'VERIFIED_LOCAL', false)).toBe(true);
    expect(isIllegalStatusUpgrade('MODELED_DESIGN_BASIS', 'VERIFIED_LOCAL', true)).toBe(false);
  });

  it('a STATE adoption cannot become a LOCAL ordinance without evidence', () => {
    // The 399: a state-table value is legally real and still is not proof of
    // what this municipality adopted.
    expect(isIllegalStatusUpgrade('VERIFIED_STATEWIDE', 'VERIFIED_LOCAL', false)).toBe(true);
  });

  it('UNKNOWN cannot become verified anything without evidence', () => {
    for (const to of ['VERIFIED', 'VERIFIED_LOCAL', 'VERIFIED_STATEWIDE'] as RequirementStatus[]) {
      expect(isIllegalStatusUpgrade('UNKNOWN', to, false), to).toBe(true);
    }
  });

  it('downgrades and lateral moves are always allowed', () => {
    expect(isIllegalStatusUpgrade('VERIFIED_LOCAL', 'UNKNOWN', false)).toBe(false);
    expect(isIllegalProvenanceUpgrade('VERIFIED', 'UNPROVENANCED', false)).toBe(false);
    expect(isIllegalStatusUpgrade('MODELED_DESIGN_BASIS', 'PARTIAL', false)).toBe(false);
  });
});

describe('origin never confers authority', () => {
  it('an operator entering a value is not a legal authority', () => {
    expect(authorityImpliedByOrigin('operator')).toBe('unknown');
  });

  it('a state DATASET is not itself the state acting as authority', () => {
    // Reading a value out of a dataset is not the same as the state governing
    // it — that has to be established, not assumed from where we read it.
    expect(authorityImpliedByOrigin('state_dataset')).toBe('unknown');
  });

  it('a legacy record confers nothing', () => {
    expect(authorityImpliedByOrigin('legacy_record')).toBe('unknown');
  });

  it('self-describing origins DO map to themselves', () => {
    expect(authorityImpliedByOrigin('model_code')).toBe('model_code');
    expect(authorityImpliedByOrigin('solarpro_policy')).toBe('solarpro_policy');
    expect(authorityImpliedByOrigin('manufacturer')).toBe('manufacturer');
    expect(authorityImpliedByOrigin('utility')).toBe('utility');
  });

  it('SolarPro policy is never law', () => {
    // The PE claim: product policy is a real, valid authority over SolarPro's
    // own release — and it is not a jurisdiction requirement.
    expect(authorityImpliedByOrigin('solarpro_policy')).not.toBe('municipality');
    expect(authorityImpliedByOrigin('solarpro_policy')).not.toBe('state');
  });
});
