/**
 * v47.428 — BYD & Pylontech battery datasheet audit tests
 *
 * Locks BYD HVM 11.0 and Pylontech Force-H2 14.2 registry values
 * against manufacturer-published datasheet specs.
 *
 * Sources:
 *   - BYD Battery-Box Premium HVM (US) Datasheet V1.4 EN (2024-12-24)
 *   - Pylontech Force-H2 FH9637M Datasheet
 */
import { describe, it, expect } from 'vitest';
import { BATTERIES } from './equipment-db';

describe('v47.428 — BYD Battery-Box Premium HVM 11.0 (US) datasheet audit', () => {
  const b = BATTERIES.find(x => x.id === 'byd-hvm-11');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = BYD', () => expect(b.manufacturer).toBe('BYD'));
  it('model references HVM 11.0', () => expect(b.model).toMatch(/HVM 11\.0/));
  it('category = battery', () => expect(b.category).toBe('battery'));
  it('subcategory = dc_coupled (HV string, inverter-coupled)', () =>
    expect(b.subcategory).toBe('dc_coupled'));

  it('usableCapacityKwh = 11.04 (datasheet: 11.04 kWh usable, 4 modules)', () =>
    expect(b.usableCapacityKwh).toBe(11.04));
  it('chemistry = LFP (datasheet: Lithium Iron Phosphate)', () =>
    expect(b.chemistry).toBe('LFP'));

  it('voltageNominalV = 204.8 (datasheet: 204.8 V nominal, 4 × 51.2V modules)', () =>
    expect(b.voltageNominalV).toBe(204.8));
  it('maxContinuousOutputA = 50 (datasheet: 50A max output)', () =>
    expect(b.maxContinuousOutputA).toBe(50));

  it('roundTripEfficiencyPct = 96.0 (datasheet: ≥96%)', () =>
    expect(b.roundTripEfficiencyPct).toBe(96.0));
  it('ipRating = NEMA 3R (datasheet)', () => expect(b.ipRating).toBe('NEMA 3R'));
  it('outdoorRated = true (datasheet: indoor/outdoor)', () =>
    expect(b.outdoorRated).toBe(true));

  it('warrantyYears = 10 (datasheet)', () => expect(b.warrantyYears).toBe(10));
  it('ulListing includes UL 9540 / UL 1973', () => {
    expect(b.ulListing).toMatch(/9540/);
    expect(b.ulListing).toMatch(/1973/);
  });

  it('ecosystemBrand = byd', () => expect(b.ecosystemBrand).toBe('byd'));
  it('ecosystemFamily = hvm', () => expect(b.ecosystemFamily).toBe('hvm'));
  it('compatibleWith lists Solis S6-EH1P HV inverters', () => {
    expect(b.compatibleWith).toContain('solis-s6-eh1p-7.6k');
    expect(b.compatibleWith).toContain('solis-s6-eh1p-10k');
  });
  it('weight = 368 lbs (datasheet: 368.2 lbs ≈ 368)', () =>
    expect(b.weightLbs).toBe(368));
  it('datasheetUrl present', () => expect(b.datasheetUrl).toBeTruthy());
});

describe('v47.428 — Pylontech Force-H2 (4 modules) datasheet audit', () => {
  const b = BATTERIES.find(x => x.id === 'pylontech-force-h2-14');
  it('exists in registry', () => expect(b).toBeTruthy());
  if (!b) return;

  it('manufacturer = Pylontech', () => expect(b.manufacturer).toBe('Pylontech'));
  it('model includes Force-H2', () => expect(b.model).toMatch(/Force-H2/));

  it('usableCapacityKwh = 13.5 (datasheet: 13.5 kWh usable, 14.21 nominal)', () =>
    expect(b.usableCapacityKwh).toBe(13.5));
  it('chemistry = LFP', () => expect(b.chemistry).toBe('LFP'));
  it('voltageNominalV = 384 (datasheet: 384V DC system voltage, 4 modules)', () =>
    expect(b.voltageNominalV).toBe(384));
  it('continuousPowerKw = 7.1 (derived: 384V × 18.5A ≈ 7.1 kW)', () =>
    expect(b.continuousPowerKw).toBe(7.1));
  it('maxContinuousOutputA = 18.5 (datasheet: 18.5A normal charge/discharge)', () =>
    expect(b.maxContinuousOutputA).toBe(18.5));

  it('roundTripEfficiencyPct = 95.0', () =>
    expect(b.roundTripEfficiencyPct).toBe(95.0));
  it('ipRating = IP55 (datasheet)', () => expect(b.ipRating).toBe('IP55'));

  it('warrantyYears = 10 (conservative; datasheet 15+yr design life, warranty varies)', () =>
    expect(b.warrantyYears).toBe(10));
  it('cycleGuarantee references >8000 cycles', () =>
    expect(b.cycleGuarantee).toMatch(/>8000|8000/));

  it('ecosystemBrand = pylontech', () => expect(b.ecosystemBrand).toBe('pylontech'));
  it('ecosystemFamily = force-h2', () =>
    expect(b.ecosystemFamily).toBe('force-h2'));
  it('compatibleWith lists Solis S6-EH1P HV inverters', () => {
    expect(b.compatibleWith).toContain('solis-s6-eh1p-10k');
  });
  it('datasheetUrl present', () => expect(b.datasheetUrl).toBeTruthy());
});