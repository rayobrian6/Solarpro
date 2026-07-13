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
import { getEquipmentContext } from '@/lib/system';
import { hasRealBattery } from './helpers';
import { buildConductorAuthority } from './conductorAuthority';
import { resolveIntegratedEquipment, type IntegratedEquipmentPlan, type SystemBosContext } from '@/lib/equipment/integratedBos';

export type { IntegratedEquipmentPlan } from '@/lib/equipment/integratedBos';

/**
 * Resolve the integrated BOS devices (combiner / gateway / "brains") for a
 * permit system. Deterministic — safe to call from every consumer.
 *
 * SYSTEMIC ROOT #1 fix (hybrid): the integrated combiner ("brains") belongs to
 * the MICRO ecosystem and aggregates only its OWN AC branches. Reading topology
 * from inverters[0] × the PROJECT panel total billed a roof-micro + ground-string
 * + fence-optimizer hybrid as one 91-device / ~10-branch microinverter fleet
 * (the "10 AC branches exceed the IQ Combiner" SCHED/PV-6 lie). Devices and the
 * AC branch count now scope to the MICRO sub(s) of the per-sub conductor
 * authority — the roof's ~48 devices / ~5 branches — never the whole project.
 * On a single-system micro job the sole sub mirrors the whole system, so the
 * resolved device + branch count is byte-identical to the pre-fix behavior.
 */
export function buildIntegratedEquipment(input: PermitInput, cad?: CADModel | null): IntegratedEquipmentPlan {
  const { project, system } = input;
  const eq = getEquipmentContext(input, cad ?? undefined);
  const auth = buildConductorAuthority(input, cad ?? undefined);
  const inv0 = system?.inverters?.[0];

  // The combiner's ecosystem = the MICRO sub's OWN inverter (roof on a hybrid),
  // never inverters[0]. microSubs is empty for a string/optimizer-only system.
  const microSubs = auth.subSystems.filter(s => s.isMicro);
  const isMicro = microSubs.length > 0;
  const microEq = microSubs[0]?.equipment;

  const inverterManufacturer =
    (microEq && microEq.inverterManufacturer !== '—' ? microEq.inverterManufacturer : undefined)
    ?? (eq.inverterManufacturer !== '—' ? eq.inverterManufacturer : (inv0?.manufacturer || ''));
  const inverterModel =
    (microEq && microEq.inverterModel !== '—' ? microEq.inverterModel : undefined)
    ?? (eq.inverterModel !== '—' ? eq.inverterModel : (inv0?.model || ''));

  // Devices + AC branches from the MICRO sub(s) ONLY — the same per-sub branch
  // plan PV-4A/PV-4B/SCHED read, so the slot-capacity check can never disagree.
  const totalDevices = microSubs.reduce((n, s) => n + (s.deviceCount || 0), 0);
  const branchCount  = microSubs.reduce((n, s) => n + s.microBranches.length, 0);

  // User override (typed on PermitInput.project) — the design-studio picker
  // writes bosDeviceIds; falls back to a single combinerId.
  const overrideDeviceIds = project.bosDeviceIds
    ?? (project.combinerId ? [project.combinerId] : undefined);

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
