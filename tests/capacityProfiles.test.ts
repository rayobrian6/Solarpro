// ============================================================================
// EVERY EQUIPMENT TYPE EXPOSES ITS LIMITS — and the solver increments exactly
// at each of them (Ray, 2026-09-26: "For each equipment type with a capacity
// limit, test limit − 1, limit, limit + 1, 2 × limit, 2 × limit + 1. The
// device count must increment exactly at the real physical boundary.").
//
// Real catalogue records, their own numbers: a Fronius Primo 7.6 (DC input, AC
// output, string inputs), the Enphase IQ System Controller 3 (backup output kW
// and continuous A) and the Enphase IQ Gateway (devices monitored).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { solveMultiplicity, type CapacityDimension, type CapacityLoad, type CapacityProfile } from '@/lib/equipment/equipmentMultiplicity';
import {
  backupInterfaceCapacityProfile,
  monitoringGatewayCapacityProfile,
  stringInverterCapacityProfile,
  stringLoad,
} from '@/lib/equipment/capacityProfiles';
import { getBackupInterfaceById, getInverterById, MONITORING_GATEWAYS } from '@/lib/equipment-db';

const primo = getInverterById('fronius-primo-7.6')!;
const sc3 = getBackupInterfaceById('enphase-iq-system-controller-3')!;
const iqGateway = MONITORING_GATEWAYS.find(g => g.id === 'enphase-iq-gateway')!;

/** `total` units of one dimension, in loads of max ÷ 20 (the last smaller) — a
 *  size that DIVIDES the limit, else 1. (Loads that do not divide it pack
 *  worse: 64 A in 3 A loads is 63 A per instance, so 128 A is three — the
 *  whole-load rule, tested in tests/equipmentMultiplicity.test.ts.) */
const loadsOf = (dimension: CapacityDimension, total: number, max: number): CapacityLoad[] => {
  const unit = max % 20 === 0 ? max / 20 : 1;
  const out: CapacityLoad[] = [];
  for (let left = total, i = 0; left > 0; left -= unit, i++) {
    out.push({ id: `L${i + 1}`, demand: { [dimension]: Math.min(unit, left) } });
  }
  return out;
};

/** Only the named limit, so each boundary is tested on its own. */
const only = (p: CapacityProfile, d: CapacityDimension): CapacityProfile =>
  ({ ...p, limits: p.limits.filter(l => l.dimension === d) });

const matrix = (p: CapacityProfile, d: CapacityDimension) => {
  const lim = p.limits.find(l => l.dimension === d)!;
  const max = lim.max;
  return ([[max - 1, 1], [max, 1], [max + 1, 2], [2 * max, 2], [2 * max + 1, 3]] as const)
    .map(([total, want]) => ({ total, want, got: solveMultiplicity(only(p, d), loadsOf(d, total, max)).count }));
};

describe('each catalogue limit is a capacity limit, and the count steps exactly at it', () => {
  const cases: Array<[string, CapacityProfile, CapacityDimension]> = [
    ['Fronius Primo 7.6 — DC input W', stringInverterCapacityProfile(primo), 'dcInputW'],
    ['Fronius Primo 7.6 — AC output W', stringInverterCapacityProfile(primo), 'acOutputW'],
    ['Fronius Primo 7.6 — string inputs', stringInverterCapacityProfile(primo), 'stringInputs'],
    ['IQ System Controller 3 — backup output W', backupInterfaceCapacityProfile(sc3), 'acOutputW'],
    ['IQ System Controller 3 — continuous A', backupInterfaceCapacityProfile(sc3), 'continuousCurrentA'],
    ['IQ Gateway — devices monitored', monitoringGatewayCapacityProfile(iqGateway), 'devices'],
  ];
  it.each(cases)('%s', (_name, profile, d) => {
    const rows = matrix(profile, d);
    expect(rows.map(r => r.got), JSON.stringify(rows)).toEqual(rows.map(r => r.want));
    // …and the old one-per-system shortcut would have said 1 for the last three.
    expect(rows.filter(r => r.want > 1).every(r => r.got !== 1)).toBe(true);
  });

  it('the limits are the catalogue\'s own numbers, cited', () => {
    const p = stringInverterCapacityProfile(primo);
    expect(p.limits.find(l => l.dimension === 'dcInputW')?.max).toBe(primo.dcInputKwMax * 1000);
    expect(p.limits.find(l => l.dimension === 'acOutputW')?.max).toBe(primo.acOutputKw * 1000);
    expect(p.limits.find(l => l.dimension === 'stringInputs')?.max)
      .toBe((primo.mpptChannels || primo.numberOfMPPT) * (primo.maxParallelStringsPerMppt ?? 1));
    for (const l of p.limits) expect(l.source).toMatch(/Fronius Primo 7\.6/);
    expect(monitoringGatewayCapacityProfile(iqGateway).limits[0].max).toBe(iqGateway.maxDevicesMonitored);
  });

  it('a real inverter case: strings past one inverter\'s string inputs are a SECOND inverter, assigned whole', () => {
    const p = stringInverterCapacityProfile(primo);
    const inputs = p.limits.find(l => l.dimension === 'stringInputs')!.max;
    // One string more than the inputs, each small enough that DC/AC power never binds.
    const strings = Array.from({ length: inputs + 1 }, (_, i) => stringLoad(`S${i + 1}`, 1000, 800));
    const s = solveMultiplicity(p, strings);
    expect(s.count).toBe(2);
    expect(s.governing).toMatchObject({ kind: 'limit', dimension: 'stringInputs' });
    expect(s.instances.map(i => i.loadIds.length)).toEqual([inputs, 1]);
  });
});
