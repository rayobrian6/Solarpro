import { describe, it, expect } from 'vitest';
import { mapRegistryToAhjRecord, lookupAhjFromRegistry } from './ahjRegistry';

// A realistic Orange Button AHJ object (scalars wrapped as { Value }, per the
// open-source registry serializer).
const OB_TUCSON = {
  AHJName: { Value: 'City of Tucson Development Services' },
  ElectricCode: { Value: '2020NEC' },
  FireCode: { Value: '2018IFC' },
  Address: {
    StateProvince: { Value: 'AZ' },
    County: { Value: 'Pima' },
    City: { Value: 'Tucson' },
    AddressLine1: { Value: '201 N Stone Ave' },
  },
  Contacts: [
    { WorkPhone: { Value: '(520) 791-5550' }, Email: { Value: 'dsd@tucsonaz.gov' }, URL: { Value: 'https://www.tucsonaz.gov/dsd' } },
  ],
  EngineeringReviewRequirements: [
    { EngineeringReviewType: { Value: 'Structural' } },
    { EngineeringReviewType: { Value: 'Electrical' } },
  ],
};

describe('mapRegistryToAhjRecord', () => {
  it('maps a real Orange Button AHJ object into an AhjRecord', () => {
    const r = mapRegistryToAhjRecord(OB_TUCSON)!;
    expect(r).not.toBeNull();
    expect(r.ahjName).toBe('City of Tucson Development Services');
    expect(r.stateCode).toBe('AZ');
    expect(r.county).toBe('Pima');
    expect(r.city).toBe('Tucson');
    expect(r.necVersion).toBe('2020');            // parsed from ElectricCode "2020NEC"
    expect(r.phone).toBe('(520) 791-5550');
    expect(r.email).toBe('dsd@tucsonaz.gov');
    expect(r.website).toBe('https://www.tucsonaz.gov/dsd');
    expect(r.specialRequirements).toEqual(['Structural', 'Electrical']);
    expect(r.dataProvenance).toBe('registry_live');
    expect(r.id).toMatch(/^az-pima-tucson/);
  });

  it('uses real code logic for setbacks (AZ → 18", not from the registry)', () => {
    const r = mapRegistryToAhjRecord(OB_TUCSON)!;
    expect(r.roofSetbackInches).toBe(18);   // AZ adopted-code value, not a registry field
    expect(r.ridgeSetbackInches).toBe(18);
  });

  it('falls back to a hint state when the registry omits the address state', () => {
    const r = mapRegistryToAhjRecord({ AHJName: { Value: 'Some County' } }, 'TX')!;
    expect(r).not.toBeNull();
    expect(r.stateCode).toBe('TX');
    expect(r.roofSetbackInches).toBe(18);   // TX adopted-code value
  });

  it('returns null for unusable input', () => {
    expect(mapRegistryToAhjRecord(null)).toBeNull();
    expect(mapRegistryToAhjRecord({})).toBeNull();                 // no AHJName
    expect(mapRegistryToAhjRecord({ AHJName: { Value: 'X' } })).toBeNull(); // no state / hint
  });
});

describe('lookupAhjFromRegistry', () => {
  it('returns null (no live call) when no API token is configured', async () => {
    const saved = process.env.AHJ_REGISTRY_TOKEN;
    delete process.env.AHJ_REGISTRY_TOKEN;
    try {
      const r = await lookupAhjFromRegistry({ lat: 32.2, lng: -110.97 });
      expect(r).toBeNull();
    } finally {
      if (saved !== undefined) process.env.AHJ_REGISTRY_TOKEN = saved;
    }
  });
});
