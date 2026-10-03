// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A SERVICE THAT IS NOT A HOUSE: 800 A, 277/480 V THREE-PHASE WYE.
//
// Every other fixture in this folder is 120/240 V split phase, so nothing proved the graph could
// even HOLD a commercial service, let alone that the engineering would say what it cannot do. This
// one is structural only. It does not mean SolarPro engineers three-phase services: it is the case
// that shows the model keeps 480 V and 800 A through a save, and that every phase-dependent check
// reports CALCULATION METHOD NOT YET SUPPORTED instead of quietly running the residential rules.
//
// Built with the same authoring functions the wizard calls (`buildServiceFromPreset`,
// `addProtectiveDevice`, `addGenerationUnit`), so anything the wizard cannot author, this cannot
// either. The voltage is deliberately NOT passed: it has to follow the phase.
// ═══════════════════════════════════════════════════════════════════════════

import { buildServiceFromPreset } from '@/lib/electrical/topologyPresets';
import {
  addProtectiveDevice, addGenerationUnit, setSolarCoupling, updatePanel,
} from '@/lib/electrical/topologyAuthoring';
import type { ServiceTopology, ServicePhase } from '@/lib/electrical/serviceTopology';

export interface CommercialServiceOptions {
  phase: ServicePhase;
  ratedAmps?: number;
  /** Only for a system with no voltage of its own ('custom'); every other phase implies one. */
  voltage?: number;
  /** One three-phase PV inverter on the switchboard. Default true. */
  withPvInverter?: boolean;
}

export interface CommercialServiceBuild {
  topology: ServiceTopology;
  switchboardId: string;
  serviceDisconnectId: string;
  pvInverterId: string | null;
}

export function buildCommercialService(opts: CommercialServiceOptions): CommercialServiceBuild {
  const ratedAmps = opts.ratedAmps ?? 800;
  let t = buildServiceFromPreset({
    ratedAmps, phase: opts.phase, distribution: 'one-main-panel',
    ...(opts.voltage !== undefined ? { voltage: opts.voltage } : {}),
  }).topology;

  const board = t.panels[0];
  // A switchboard is not backed up by anything; the preset's residential default says it is.
  t = updatePanel(t, board.id, { label: 'Main switchboard', backedUp: false });

  const disconnect = addProtectiveDevice(t, {
    label: `${ratedAmps} A main service disconnect`, roles: ['service-disconnect'],
    ratedAmps, lockableOpen: true, visibleOpen: true,
  });
  t = disconnect.topology;

  let pvInverterId: string | null = null;
  if (opts.withPvInverter ?? true) {
    // Stated per phase, the way a three-phase inverter datasheet states it: a 100 kW-class unit at
    // 480 V is about 120 A per line. Nothing here derives a current from a power.
    const inv = addGenerationUnit(t, {
      kind: 'pv-inverter', label: 'PV inverter (three-phase)',
      continuousOutputA: 120, ocpdA: 150,
    });
    t = inv.topology;
    pvInverterId = inv.unit.id;
    t = setSolarCoupling(t, 'ac-coupled-inverter');
  }

  return {
    topology: t, switchboardId: board.id, serviceDisconnectId: disconnect.device.id, pvInverterId,
  };
}

/** The case this file is named for: 800 A, 277/480 V three-phase wye, one PV inverter. */
export function buildCommercial480Wye(): CommercialServiceBuild {
  return buildCommercialService({ phase: 'wye-480', ratedAmps: 800 });
}
