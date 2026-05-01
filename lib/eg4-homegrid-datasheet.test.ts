/**
 * v47.428 — EG4 & HomeGrid battery datasheet audit tests
 *
 * Locks EG4 PowerPro WallMount 14.3 kWh and HomeGrid Stack'd 9.6 kWh
 * registry values against manufacturer-published datasheet specs.
 *
 * Sources:
 *   - EG4 14.3kWh PowerPro WallMount AW Spec Sheet 1.0.2 (Signature Solar)
 *   - HomeGrid Stack'd Series 2-module 9.6 kWh product page (NAZ Solar /
 *     NAZ HomeGrid_Stackd_Series_specifications.pdf)
 */
import { describe, it, expect } from 'vitest';
import { BATTERIES } from './equipment-db';

describe('v47.428 — EG4 PowerPro WallMount All Weather 14.3 kWh datasheet audit', () => {
  const b = BATTERIES.find(x => x.id === 'eg4-powerpro-14');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = EG4', () => expect(b.manufacturer).toBe('EG4'));
  it('model references PowerPro WallMount + 14.3 kWh', () => {
    expect(b.model).toMatch(/PowerPro/i);
    expect(b.model).toMatch(/14\.3/);
  });
  it('category = battery', () => expect(b.category).toBe('battery'));
  it('subcategory = dc_coupled (48V LV, DC-coupled to hybrid inverter)', () =>
    expect(b.subcategory).toBe('dc_coupled'));

  it('usableCapacityKwh = 14.3 (datasheet: 14.3 kWh @ 25°C, 100% SoC)', () =>
    expect(b.usableCapacityKwh).toBe(14.3));
  it('chemistry = LFP', () => expect(b.chemistry).toBe('LFP'));
  it('voltageNominalV = 51.2 (datasheet: 51.2V nominal / 48V system)', () =>
    expect(b.voltageNominalV).toBe(51.2));
  it('maxContinuousOutputA = 200 (datasheet: 200A max continuous discharge)', () =>
    expect(b.maxContinuousOutputA).toBe(200));

  it('ipRating = IP65 (datasheet)', () => expect(b.ipRating).toBe('IP65'));
  it('outdoorRated = true (All Weather model)', () =>
    expect(b.outdoorRated).toBe(true));

  it('warrantyYears = 10 (datasheet: 10-year warranty)', () =>
    expect(b.warrantyYears).toBe(10));
  it('cycleGuarantee references >8000 cycles @ 80% DoD', () => {
    expect(b.cycleGuarantee).toMatch(/8000/);
    expect(b.cycleGuarantee).toMatch(/80%|DoD/i);
  });

  it('ulListing includes UL 1973 + UL 9540A', () => {
    expect(b.ulListing).toMatch(/1973/);
    expect(b.ulListing).toMatch(/9540A/);
  });

  it('ecosystemBrand = eg4', () => expect(b.ecosystemBrand).toBe('eg4'));
  it('ecosystemFamily = powerpro-wallmount', () =>
    expect(b.ecosystemFamily).toBe('powerpro-wallmount'));
  it('weight = 309 lbs (datasheet: 308.6 lbs)', () =>
    expect(b.weightLbs).toBe(309));
  it('datasheetUrl present', () => expect(b.datasheetUrl).toBeTruthy());
});

describe("v47.428 — HomeGrid Stack'd 9.6 kWh (2 modules) datasheet audit", () => {
  const b = BATTERIES.find(x => x.id === 'homegrid-stackd-9.6');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = HomeGrid', () => expect(b.manufacturer).toBe('HomeGrid'));
  it("model references Stack'd + 9.6 kWh", () => {
    expect(b.model).toMatch(/Stack/i);
    expect(b.model).toMatch(/9\.6/);
  });

  it('usableCapacityKwh = 9.6 (datasheet: 9.6 kWh total energy)', () =>
    expect(b.usableCapacityKwh).toBe(9.6));
  it('continuousPowerKw = 9.6 (datasheet: 9.6 kW continuous output per stack)', () =>
    expect(b.continuousPowerKw).toBe(9.6));
  it('chemistry = LFP', () => expect(b.chemistry).toBe('LFP'));
  it('voltageNominalV = 48 (datasheet: 48V nominal, 46-56V range)', () =>
    expect(b.voltageNominalV).toBe(48));
  it('maxContinuousOutputA = 200 (derived at 48V from 9.6 kW)', () =>
    expect(b.maxContinuousOutputA).toBe(200));

  it('ipRating = IP55 (datasheet)', () => expect(b.ipRating).toBe('IP55'));
  it('outdoorRated = true', () => expect(b.outdoorRated).toBe(true));
  it('wholeHomeBackup = true (datasheet claims whole-home backup)', () =>
    expect(b.wholeHomeBackup).toBe(true));

  it('warrantyYears = 10 (datasheet: 10-year full-refund warranty)', () =>
    expect(b.warrantyYears).toBe(10));
  it('ulListing includes UL 9540 + UL 1973', () => {
    expect(b.ulListing).toMatch(/9540/);
    expect(b.ulListing).toMatch(/1973/);
  });

  it('ecosystemBrand = homegrid', () => expect(b.ecosystemBrand).toBe('homegrid'));
  it('ecosystemFamily = stackd', () => expect(b.ecosystemFamily).toBe('stackd'));
  it('weight = 304 lbs (datasheet)', () => expect(b.weightLbs).toBe(304));
  it('datasheetUrl present', () => expect(b.datasheetUrl).toBeTruthy());
});