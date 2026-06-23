import { describe, it, expect } from 'vitest';
import { getAhjById, type AhjRecord } from './ahj-national';
import { enrichWithSolarTrace, solarTraceKeyForRecord } from './solartraceOverlay';
import { SOLARTRACE } from './solartrace';

describe('SolarTRACE overlay', () => {
  it('builds place/county keys in the generator format', () => {
    const phx = getAhjById('az-maricopa-phoenix')!;
    expect(solarTraceKeyForRecord(phx)).toBe('AZ|phoenix|P');
    const pima = getAhjById('az-pima-county');
    if (pima) expect(solarTraceKeyForRecord(pima)).toBe('AZ|pima|C');
  });

  it('overlays REAL permit-process data onto a matched metro (Phoenix)', () => {
    const phx = getAhjById('az-maricopa-phoenix')!;
    expect(SOLARTRACE['AZ|phoenix|P']).toBeDefined(); // sanity: source has it
    const e = enrichWithSolarTrace(phx);
    expect(e.onlinePermitting).toBe(true);
    expect(e.typicalPermitFee).toMatch(/^\$\d/);                 // real median cost
    expect(e.typicalPermitDays).toBeGreaterThan(0);
    expect(e.feeStructure).toMatch(/SolarTRACE/);
    expect(e.notes).toMatch(/SolarTRACE/);
  });

  it('does not invent data for an unmatched jurisdiction (returns unchanged)', () => {
    const fake: AhjRecord = {
      ...getAhjById('az-maricopa-phoenix')!,
      id: 'zz-nowhere-xyzzy',
      stateCode: 'ZZ',
      county: 'Nowhere',
      city: 'Xyzzy Test Place',
      typicalPermitFee: '$SENTINEL',
    };
    expect(SOLARTRACE[solarTraceKeyForRecord(fake)]).toBeUndefined();
    const e = enrichWithSolarTrace(fake);
    expect(e.typicalPermitFee).toBe('$SENTINEL');   // untouched
    expect(e).toEqual(fake);
  });

  it('curated identity/code fields are preserved (only permit-process overlaid)', () => {
    const phx = getAhjById('az-maricopa-phoenix')!;
    const e = enrichWithSolarTrace(phx);
    expect(e.necVersion).toBe(phx.necVersion);
    expect(e.roofSetbackInches).toBe(phx.roofSetbackInches);   // still code-logic (AZ 18")
    expect(e.utilityName).toBe(phx.utilityName);
  });
});
