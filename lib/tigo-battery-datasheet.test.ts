/**
 * v47.428 — Tigo Battery datasheet audit tests
 *
 * Locks Tigo EI Battery and Tigo GO Battery registry values against
 * manufacturer-published datasheet specs. If a registry value drifts
 * away from the datasheet, this suite fails loudly.
 *
 * Sources:
 *   - Tigo EI Specifications PN 002-00084-00 (TSB-10-US)
 *   - Tigo GO Battery (US) Datasheet PN 002-00234-00 v1.2 (TGB-10-US)
 */
import { describe, it, expect } from 'vitest';
import { BATTERIES } from './equipment-db';

describe('v47.428 — Tigo EI Battery TSB-10-US datasheet audit', () => {
  const b = BATTERIES.find(x => x.id === 'tigo-ei-battery-10');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = Tigo', () => expect(b.manufacturer).toBe('Tigo'));
  it('model includes TSB-10-US', () => expect(b.model).toMatch(/TSB-10-US/));
  it('category = battery', () => expect(b.category).toBe('battery'));
  it('subcategory = dc_coupled (HV DC-coupled to EI Inverter)', () =>
    expect(b.subcategory).toBe('dc_coupled'));

  it('usableCapacityKwh = 9.0 (9.9 nominal, 9.0 usable per datasheet)', () =>
    expect(b.usableCapacityKwh).toBe(9.0));
  it('continuousPowerKw = 5.0 (datasheet: 5 kW continuous)', () =>
    expect(b.continuousPowerKw).toBe(5.0));
  it('peakPowerKw = 6.0 (datasheet: 6 kW surge)', () =>
    expect(b.peakPowerKw).toBe(6.0));

  it('chemistry = LFP (Lithium Iron Phosphate)', () => expect(b.chemistry).toBe('LFP'));
  it('voltageNominalV = 400 (datasheet: 400V nominal, 360-550V range)', () =>
    expect(b.voltageNominalV).toBe(400));
  it('maxContinuousOutputA = 14.3A@360V (datasheet)', () =>
    expect(b.maxContinuousOutputA).toBe(14.3));

  it('roundTripEfficiencyPct = 94.4 (datasheet DC-DC RTE)', () =>
    expect(b.roundTripEfficiencyPct).toBe(94.4));
  it('ipRating = IP56 (datasheet: IP56/NEMA Type 4X)', () =>
    expect(b.ipRating).toBe('IP56'));
  it('outdoorRated = true', () => expect(b.outdoorRated).toBe(true));
  it('backupCapable = true', () => expect(b.backupCapable).toBe(true));

  it('warrantyYears = 11 (datasheet: 11 years)', () => expect(b.warrantyYears).toBe(11));
  it('cycleGuarantee references 6000 cycles', () =>
    expect(b.cycleGuarantee).toMatch(/6000/));

  it('ulListing includes UL 9540 + UL 1973', () => {
    expect(b.ulListing).toMatch(/9540/);
    expect(b.ulListing).toMatch(/1973/);
  });

  it('ecosystemBrand = tigo', () => expect(b.ecosystemBrand).toBe('tigo'));
  it('ecosystemFamily = ei-battery', () => expect(b.ecosystemFamily).toBe('ei-battery'));
  it('compatibleWith includes Tigo EI Inverter SKUs', () => {
    expect(b.compatibleWith).toContain('tigo-ei-7.6k');
    expect(b.compatibleWith).toContain('tigo-ei-11.4k');
  });
  it('datasheetUrl present', () => expect(b.datasheetUrl).toBeTruthy());
  it('weight = 309 lbs (datasheet: 308.6 lbs ≈ 309)', () =>
    expect(b.weightLbs).toBe(309));
});

describe('v47.428 — Tigo GO Battery TGB-10-US datasheet audit', () => {
  const b = BATTERIES.find(x => x.id === 'tigo-go-battery-10');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = Tigo', () => expect(b.manufacturer).toBe('Tigo'));
  it('model includes TGB-10-US', () => expect(b.model).toMatch(/TGB-10-US/));

  it('usableCapacityKwh = 10.0 (datasheet: 10 kWh nominal energy)', () =>
    expect(b.usableCapacityKwh).toBe(10.0));
  it('continuousPowerKw = 5.0 (datasheet: 5 kW @ 2 modules)', () =>
    expect(b.continuousPowerKw).toBe(5.0));
  it('peakPowerKw = 7.0 (datasheet: 7 kW peak 300ms)', () =>
    expect(b.peakPowerKw).toBe(7.0));

  it('chemistry = LFP', () => expect(b.chemistry).toBe('LFP'));
  it('voltageNominalV = 400 (datasheet: 400V nominal, 380-550V range)', () =>
    expect(b.voltageNominalV).toBe(400));

  it('roundTripEfficiencyPct = 89.0 (datasheet battery DC-DC RTE 89%)', () =>
    expect(b.roundTripEfficiencyPct).toBe(89.0));
  it('ipRating = IP66 (datasheet: IP66-level protection)', () =>
    expect(b.ipRating).toBe('IP66'));

  it('warrantyYears = 10 (datasheet: 10 years)', () =>
    expect(b.warrantyYears).toBe(10));
  it('ulListing includes UL 9540 + UL 1973', () => {
    expect(b.ulListing).toMatch(/9540/);
    expect(b.ulListing).toMatch(/1973/);
  });

  it('ecosystemBrand = tigo', () => expect(b.ecosystemBrand).toBe('tigo'));
  it('ecosystemFamily = go-battery', () => expect(b.ecosystemFamily).toBe('go-battery'));
  it('datasheetUrl present and Tigo-hosted', () => {
    expect(b.datasheetUrl).toBeTruthy();
    expect(b.datasheetUrl).toMatch(/\.pdf$/i);
  });
  it('weight = 269 lbs (datasheet: 269 lbs for 10 kWh config)', () =>
    expect(b.weightLbs).toBe(269));
});