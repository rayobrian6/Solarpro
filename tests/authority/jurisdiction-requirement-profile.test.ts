import { describe, it, expect } from 'vitest';
import { governedRequirement } from '@/lib/authority/governedRequirement';
import {
  allRequirements, scopesMissingGovernedRecord,
  type JurisdictionRequirementProfile,
} from '@/lib/authority/jurisdictionRequirementProfile';

const policy = governedRequirement({
  value: 'professional review required before permit release',
  status: 'VERIFIED', provenanceIntegrity: 'VERIFIED',
  origin: { type: 'solarpro_policy' },
  authority: { authorityLevel: 'solarpro_policy', scope: 'release_policy' },
});
const seal = governedRequirement({
  value: null, status: 'UNKNOWN', provenanceIntegrity: 'UNKNOWN',
  origin: { type: 'unknown' },
  authority: { authorityLevel: 'unknown', scope: 'professional_seal' },
  releaseCritical: true,
});
const pathway = governedRequirement({
  value: 36, status: 'MODELED_DESIGN_BASIS', provenanceIntegrity: 'VERIFIED',
  origin: { type: 'model_code', sourceId: 'IFC 1204.2.1' },
  authority: { authorityLevel: 'model_code', scope: 'fire_access' },
});

const profile = (): JurisdictionRequirementProfile => ({
  legalGovernmentIdentityId: 'county:17119',
  authorities: {
    building:   { authorityLevel: 'county', recordStatus: 'IDENTITY_ONLY' },
    electrical: { authorityLevel: 'state', recordStatus: 'MISSING' },
    fire:       { authorityLevel: 'fire_district', recordStatus: 'UNKNOWN' },
  },
  professional: { solarProReviewPolicy: policy, legalSignatureSealRequirement: seal },
  codes: {}, amendments: {}, electrical: {},
  fire: { designBasis: { accessPathwayWidthIn: pathway }, adoption: {} },
  building: {}, zoning: {}, administrative: {},
});

describe('scopes may bind to different governments', () => {
  it('building, electrical and fire can each have a different authority', () => {
    const p = profile();
    expect(p.authorities.building?.authorityLevel).toBe('county');
    expect(p.authorities.electrical?.authorityLevel).toBe('state');
    expect(p.authorities.fire?.authorityLevel).toBe('fire_district');
  });

  it('reports which scopes lack a GOVERNED record', () => {
    // Knowing which government it is, is not holding a permitting record for it.
    expect(scopesMissingGovernedRecord(profile()).sort())
      .toEqual(['building', 'electrical', 'fire']);
  });
});

describe('the three professional facts stay separate', () => {
  it('SolarPro policy is verified and is not law', () => {
    const p = profile();
    expect(p.professional.solarProReviewPolicy.authority.authorityLevel).toBe('solarpro_policy');
    expect(p.professional.solarProReviewPolicy.status).toBe('VERIFIED');
  });

  it('the legal seal requirement stays UNKNOWN independently of that policy', () => {
    // SolarPro requiring review says nothing about whether a seal is legally
    // required. Conflating them is what put a false claim on every planset.
    const p = profile();
    expect(p.professional.legalSignatureSealRequirement?.status).toBe('UNKNOWN');
    expect(p.professional.legalSignatureSealRequirement?.releaseSemantics.blocksPermitRelease).toBe(true);
    expect(p.professional.solarProReviewPolicy.releaseSemantics.blocksPermitRelease).toBe(false);
  });
});

describe('fire design basis is separate from fire adoption', () => {
  it('a modeled pathway is usable for design and is not an adoption', () => {
    const p = profile();
    const pw = p.fire.designBasis.accessPathwayWidthIn!;
    expect(pw.releaseSemantics.usableForDesign).toBe(true);
    expect(pw.releaseSemantics.usableForPermitClaim).toBe(false);
    expect(p.fire.adoption.fireCodeEdition).toBeUndefined();
  });

  it('design basis and adoption are different fields, not one', () => {
    const p = profile();
    expect(Object.keys(p.fire).sort()).toEqual(['adoption', 'designBasis']);
  });
});

describe('allRequirements flattens the profile for gating', () => {
  it('collects every requirement wherever it sits', () => {
    const all = allRequirements(profile());
    expect(all).toHaveLength(3);
    expect(all.filter(r => r.releaseSemantics.blocksPermitRelease)).toHaveLength(1);
  });
});
