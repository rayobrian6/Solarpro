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
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
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
  //
  // 🚨 THIS IS THE SESSION OVERRIDE, NOT THE DECISION. `bosDeviceIds` /
  // `combinerId` come from the engineering page's private engineering_config.
  // The project's RECORDED selection is a separate, higher authority and is
  // passed below; resolveIntegratedEquipment enforces the ordering.
  const overrideDeviceIds = project.bosDeviceIds
    ?? (project.combinerId ? [project.combinerId] : undefined);

  // 🚨 THE INSTALLER'S OWN ANSWER — projects.selected_equipment.combinerSelection.
  // The permit POST route reads it from the store (the client's copy is used only
  // when no project row can be read), so a dropped client read cannot swap it.
  //
  // THIS LINE IS THE PROPAGATION. Eight consumers resolve the combiner through
  // this ONE adapter — E-1 (electricalPages), SCHED/PV-6 (structuralPages), the
  // disconnecting-means directory (compliancePages), PV-0 (coverSheet), the
  // canonical snapshot, the permit BOM reconcile and the SLD adapter. Every one
  // of them used to re-derive the device from a catalogue RECOMMENDATION, which
  // is how a package could be corrected on the diagram and still ship a
  // schedule, a BOM and a code statement naming a device nobody chose. The 5C
  // and the 6C differ on `providesAcDisconnect` — NEC 690.13 — so that
  // disagreement was never cosmetic.
  //
  // It is passed UNCONDITIONALLY, not gated on `isMicro`, for the same reason
  // `overrideDeviceIds` is not: a stated decision is not something this function
  // gets to decline to hear. `compatibleCombinerIds` below stays micro-gated
  // because a recommendation for a string system is meaningless.
  const selectedCombinerId = project.selectedCombinerId ?? null;

  // The combiner pairing equipment-db declares on the micro sub's OWN inverter.
  // The permit sheet must resolve the SAME device the Diagram tab does, or E-1
  // and the picker disagree about which combiner is installed — and the 5C/6C
  // differ on whether there is an integral AC disconnecting means, so that
  // disagreement is a code statement, not a label.
  // ResolvedEquipment carries no inverter id (the module has `panelId`; inverters
  // still have no stable identity), so the record is matched on manufacturer AND
  // model EXACTLY — trimmed and case-insensitive, never a substring. Substring
  // matching on equipment models is a known defect class in this codebase and is
  // not being reintroduced here. No exact match ⇒ undefined ⇒ the previous
  // current-gen default, so this can only add correctness, never remove it.
  // The pairing rule itself lives in lib/equipment/combinerCompatibility.ts.
  // It used to be inlined here AND in the SLD route AND nowhere in the BOM,
  // which is how the BOM came to ship a 6C while these sheets printed a 5C.
  const ctx: SystemBosContext = {
    inverterManufacturer,
    inverterModel,
    isMicro,
    totalDevices,
    branchCount,
    hasBattery: hasRealBattery(project),
    overrideDeviceIds,
    compatibleCombinerIds: isMicro ? combinerCompatibilityFor(inverterManufacturer, inverterModel) : undefined,
    selectedCombinerId,
  };

  return resolveIntegratedEquipment(ctx);
}
