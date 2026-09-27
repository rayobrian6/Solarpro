// ═══════════════════════════════════════════════════════════════════════════
// EVERY EQUIPMENT TYPE'S LIMITS, AS CAPACITY PROFILES — the solver's inputs.
//
// Ray, 2026-09-26: "Build this as a canonical equipment multiplicity /
// capacity solver, not an Enphase special case. Every equipment type should
// expose the limits that determine how many instances are required … Then:
// project electrical demand/topology → selected manufacturer/model
// constraints → required physical device instances → assignment."
//
// This module turns the limits the equipment catalogue ALREADY records into
// `CapacityProfile`s for lib/equipment/equipmentMultiplicity.ts. Nothing here
// is a new number: each limit cites the catalogue field it reads, and a field
// the record does not carry adds no limit (never a guessed one).
//
//   · Enphase gateway topologies (IQ Combiners, the standalone IQ Gateway) —
//     lib/equipment/enphaseGatewayMultiplicity.ts, proven end to end: the
//     drawings, the permit, the BOM and the engine all read its count.
//   · String / hybrid inverters, backup interfaces and monitoring gateways —
//     below, with boundary tests (tests/capacityProfiles.test.ts). Their
//     consumers still take their counts from their existing sizing paths
//     (lib/system/sizingEngine for inverters); moving each onto the solver is
//     the next step, one equipment type at a time.
// ═══════════════════════════════════════════════════════════════════════════

import type { CapacityLimit, CapacityLoad, CapacityProfile } from '@/lib/equipment/equipmentMultiplicity';
import type { BackupInterface, MonitoringGateway, StringInverter } from '@/lib/equipment-db';

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * A string (or hybrid) inverter: DC input power, AC output power, MPPT inputs
 * and string inputs (MPPTs × parallel strings per MPPT). Loads are strings.
 */
export function stringInverterCapacityProfile(inv: StringInverter): CapacityProfile {
  const src = `${inv.manufacturer} ${inv.model} (equipment catalogue)`;
  const limits: CapacityLimit[] = [];
  if (pos(inv.dcInputKwMax)) limits.push({ dimension: 'dcInputW', max: inv.dcInputKwMax * 1000, basis: 'manufacturer', source: `${src}: dcInputKwMax ${inv.dcInputKwMax} kW` });
  if (pos(inv.acOutputKw)) limits.push({ dimension: 'acOutputW', max: inv.acOutputKw * 1000, basis: 'manufacturer', source: `${src}: acOutputKw ${inv.acOutputKw} kW` });
  const mppts = inv.mpptChannels || inv.numberOfMPPT;
  if (pos(mppts)) {
    const per = pos(inv.maxParallelStringsPerMppt) ? inv.maxParallelStringsPerMppt : 1;
    limits.push({ dimension: 'stringInputs', max: mppts * per, basis: 'manufacturer',
      source: `${src}: ${mppts} MPPT × ${per} string${per === 1 ? '' : 's'} per MPPT` });
  }
  return { deviceId: inv.id, deviceLabel: `${inv.manufacturer} ${inv.model}`, instanceNoun: 'INVERTER', limits };
}

/** One PV source string as an inverter load: its STC watts (DC) and, when
 *  known, its AC share, and one string input. */
export function stringLoad(id: string, dcW: number, acW?: number, group?: string): CapacityLoad {
  return {
    id,
    ...(group ? { group } : {}),
    demand: { dcInputW: dcW, stringInputs: 1, ...(pos(acW) ? { acOutputW: acW } : {}) },
  };
}

/**
 * A backup interface / system controller: the backup output it can carry — in
 * kW and in continuous amps. Loads are batteries (or backed-up sources) by
 * their continuous output.
 */
export function backupInterfaceCapacityProfile(bi: BackupInterface): CapacityProfile {
  const src = `${bi.manufacturer} ${bi.model} (equipment catalogue)`;
  const limits: CapacityLimit[] = [];
  if (pos(bi.maxBackupOutputKw)) limits.push({ dimension: 'acOutputW', max: bi.maxBackupOutputKw * 1000, basis: 'manufacturer', source: `${src}: maxBackupOutputKw ${bi.maxBackupOutputKw} kW` });
  if (pos(bi.maxContinuousOutputA)) limits.push({ dimension: 'continuousCurrentA', max: bi.maxContinuousOutputA, basis: 'manufacturer', source: `${src}: maxContinuousOutputA ${bi.maxContinuousOutputA} A` });
  return { deviceId: bi.id, deviceLabel: `${bi.manufacturer} ${bi.model}`, instanceNoun: 'CONTROLLER', limits };
}

/** A monitoring gateway: how many devices one instance can monitor. Loads are
 *  the devices (micros, optimizers, inverters) by count. */
export function monitoringGatewayCapacityProfile(gw: MonitoringGateway): CapacityProfile {
  const limits: CapacityLimit[] = pos(gw.maxDevicesMonitored)
    ? [{ dimension: 'devices', max: gw.maxDevicesMonitored, basis: 'manufacturer',
        source: `${gw.manufacturer} ${gw.model} (equipment catalogue): maxDevicesMonitored ${gw.maxDevicesMonitored}` }]
    : [];
  return { deviceId: gw.id, deviceLabel: `${gw.manufacturer} ${gw.model}`, instanceNoun: 'GATEWAY', limits };
}
