// ═══════════════════════════════════════════════════════════════
// Integrated BOS equipment — permit-side resolver.
//
// Pure wrapper that builds a SystemBosContext from PermitInput + CAD and calls
// the shared resolveIntegratedEquipment() so EVERY planset sheet (PV-6, SCHED,
// PV-0, APP-A, PV-4A, E-1, BOM) reads the SAME integrated combiner/gateway
// device. Same inputs → same output, so the sheets can never disagree about the
// "brains" of the system.
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { getEquipmentContext, getInverterTopology, topologyToLegacy } from '@/lib/system';
import { hasRealBattery } from './helpers';
import { planMicroBranches, microBranchCount } from './branching';
import { resolveIntegratedEquipment, type IntegratedEquipmentPlan, type SystemBosContext } from '@/lib/equipment/integratedBos';

export type { IntegratedEquipmentPlan } from '@/lib/equipment/integratedBos';

/**
 * Resolve the integrated BOS devices (combiner / gateway / "brains") for a
 * permit system. Deterministic — safe to call from every consumer.
 */
export function buildIntegratedEquipment(input: PermitInput, cad?: CADModel | null): IntegratedEquipmentPlan {
  const { project, system } = input;
  const eq = getEquipmentContext(input, cad ?? undefined);
  const isMicro = topologyToLegacy(getInverterTopology(input, cad ?? undefined)) === 'MICRO';
  const inv0 = system?.inverters?.[0];

  const inverterManufacturer = eq.inverterManufacturer !== '—' ? eq.inverterManufacturer : (inv0?.manufacturer || '');
  const inverterModel = eq.inverterModel !== '—' ? eq.inverterModel : (inv0?.model || '');
  const totalDevices = isMicro ? (system?.totalPanels || 0) : 0;

  // AC branch count — same plane-aware planner PV-4A/PV-4B/SCHED use, so the
  // slot-capacity check reconciles with the branch schedules.
  const positions = ((project as any).panelPositions ?? []) as Array<{ id: string }>;
  const branchCount = isMicro
    ? (positions.length ? planMicroBranches(positions, inverterModel).count : microBranchCount(totalDevices, inverterModel))
    : 0;

  // Future design-studio override hook (no UI yet — read defensively).
  const overrideDeviceIds = (project as any).bosDeviceIds as string[] | undefined
    ?? ((project as any).combinerId ? [(project as any).combinerId] : undefined);

  const ctx: SystemBosContext = {
    inverterManufacturer,
    inverterModel,
    isMicro,
    totalDevices,
    branchCount,
    hasBattery: hasRealBattery(project),
    overrideDeviceIds,
  };

  return resolveIntegratedEquipment(ctx);
}
