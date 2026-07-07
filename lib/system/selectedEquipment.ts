// ============================================================================
// Canonical "selected equipment" store — full-duplex Design <-> Engineering sync
// ----------------------------------------------------------------------------
// The design's chosen equipment (panel / inverter / mounting / battery) lives in
// the projects.selected_equipment JSONB column (migration 101). Both sides write
// it and rowToProject() hydrates it with the highest precedence:
//
//   Design Studio persist  (/api/production)        -> source: 'design'
//   Engineering save-config (/api/engineering/...)   -> source: 'engineering'
//
// This module owns the SHAPE of that store plus the pure logic that turns an
// engineering ProjectConfig into a write-back patch (resolving equipment ids to
// full records and diffing against the current design so we never rebuild the
// engineering report needlessly, and never corrupt the design with an
// unresolvable id).
//
// computeDesignVersionId() hashes project.selectedPanel, so writing a resolved
// panel back here forces the engineering report to rebuild against the SAME
// panel on the next sync — a stable fixed point, not a ping-pong.
// ============================================================================

import type { Project, SolarPanel, Battery } from '@/types';
import { getPanelById, getBatteryById, type SolarPanel as DbSolarPanel, type BatterySystem } from '@/lib/equipment-db';
import type { ProjectConfig } from '@/lib/engineering-helpers';

/** Canonical design-equipment record persisted to projects.selected_equipment. */
export interface SelectedEquipment {
  panelId?: string;
  panel?: SolarPanel;
  inverterId?: string;
  inverter?: unknown;      // full StringInverter | Inverter snapshot (cast on hydration)
  mountingId?: string;
  mounting?: unknown;      // full MountingSystemSpec | MountingSystem snapshot
  batteryId?: string;
  batteries?: Battery[];
  batteryCount?: number;
  batteryKwh?: number;
  source?: 'design' | 'engineering';
  updatedAt?: string;
}

/** Minimal project view the reconciler needs (avoids requiring a full Project). */
export type EquipmentProjectView = Pick<
  Project,
  'selectedPanel' | 'selectedInverter' | 'selectedMounting' | 'selectedBatteries' | 'batteryCount'
>;

/**
 * Map an equipment-db SolarPanel (watts / length&width in INCHES / efficiency)
 * to the app-level @/types SolarPanel (wattage / width&height in METERS) that
 * project.selectedPanel and computeDesignVersionId() expect. The two share only
 * id/manufacturer/model, so a resolved engineering panel must be translated
 * before it can become the design's selectedPanel.
 */
export function equipmentPanelToTypesPanel(p: DbSolarPanel): SolarPanel {
  return {
    id: p.id,
    manufacturer: p.manufacturer,
    model: p.model,
    wattage: p.watts,
    width: parseFloat((p.width * 0.0254).toFixed(4)),   // in → m (short dimension)
    height: parseFloat((p.length * 0.0254).toFixed(4)), // in → m (long dimension)
    efficiency: p.efficiency,
    bifacial: !!p.bifacial,
    bifacialFactor: p.bifacial ? 1.2 : 1.0,             // equipment-db has no factor; 1.20 per registry note
    temperatureCoeff: p.tempCoeffPmax,
    pricePerWatt: 0,                                     // not carried on the electrical spec record
    weight: parseFloat((p.weight * 0.453592).toFixed(1)), // lbs → kg
    cellType: p.cellType,
    datasheetUrl: p.datasheetUrl,
    voc: p.voc,
    vmp: p.vmp,
    isc: p.isc,
    imp: p.imp,
  };
}

/** Map an equipment-db BatterySystem to the app-level Battery shape. */
export function batterySystemToBattery(b: BatterySystem): Battery {
  return {
    id: b.id,
    manufacturer: b.manufacturer,
    model: b.model,
    capacityKwh: b.usableCapacityKwh,
    powerKw: b.continuousPowerKw,
    peakPowerKw: b.peakPowerKw,
    roundTripEfficiency: b.roundTripEfficiencyPct,
    // BatterySystem chemistry is LFP|NMC|NCA; app Battery is LFP|NMC|Lead-Acid.
    // NCA collapses to NMC (closest Li-ion class); LFP/NMC pass through.
    chemistry: b.chemistry === 'NCA' ? 'NMC' : b.chemistry,
    voltage: b.voltageNominalV,
    weight: b.weightLbs,
    pricePerUnit: 0, // not carried on the electrical spec record
  };
}

/**
 * Build a canonical patch from the DESIGN side (Design Studio persist path),
 * where panel/inverter are already resolved full records. Keeps the design as a
 * live writer of the canonical store so a later design edit is never shadowed by
 * a stale engineering write-back. Returns null when neither resolved.
 */
export function designEquipmentPatch(
  panel: SolarPanel | null | undefined,
  inverter: unknown | null | undefined,
  now: string,
): SelectedEquipment | null {
  const patch: SelectedEquipment = { source: 'design', updatedAt: now };
  let has = false;
  if (panel && typeof panel === 'object') {
    patch.panel = panel;
    patch.panelId = (panel as { id?: string }).id;
    has = true;
  }
  if (inverter && typeof inverter === 'object') {
    patch.inverter = inverter;
    patch.inverterId = (inverter as { id?: string }).id;
    has = true;
  }
  return has ? patch : null;
}

/** The panel a design uses = the model most strings are assigned to (weighted by count). */
function dominantPanelId(cfg: Partial<ProjectConfig>): string | undefined {
  const counts = new Map<string, number>();
  for (const inv of cfg.inverters ?? []) {
    for (const s of inv.strings ?? []) {
      if (!s?.panelId) continue;
      counts.set(s.panelId, (counts.get(s.panelId) ?? 0) + (s.panelCount || 1));
    }
  }
  let best: string | undefined;
  let bestN = -1;
  for (const [id, n] of counts) {
    if (n > bestN) { bestN = n; best = id; }
  }
  return best;
}

/**
 * Build a canonical write-back patch from an engineering ProjectConfig, diffed
 * against the current design. Returns ONLY the fields that resolved AND changed
 * — or null when nothing changed / nothing resolvable (so the caller skips the
 * write and the downstream engineering rebuild). Fail-safe: an id that doesn't
 * resolve is simply omitted, never written as a partial/unknown record.
 *
 * Scope: PANEL and BATTERY (the two identities that must flow engineering→design
 * and that translate cleanly). Inverter/mounting are written from the DESIGN
 * side only for now — the engineering resolvers (getInverterById → StringInverter,
 * which doesn't even cover microinverters) don't translate cleanly to the app
 * types, so writing them back is deferred rather than risk a wrong-shaped record.
 */
export function reconcileFromEngineeringConfig(
  config: Partial<ProjectConfig> | Record<string, unknown> | null | undefined,
  project: EquipmentProjectView | null | undefined,
  now: string,
): SelectedEquipment | null {
  if (!config || typeof config !== 'object') return null;
  const cfg = config as Partial<ProjectConfig>;
  const patch: SelectedEquipment = { source: 'engineering', updatedAt: now };
  let changed = false;

  // ── Panel ────────────────────────────────────────────────────────────────
  const panelId = dominantPanelId(cfg);
  if (panelId) {
    const panel = getPanelById(panelId);
    if (panel && panel.id !== project?.selectedPanel?.id) {
      patch.panelId = panel.id;
      patch.panel = equipmentPanelToTypesPanel(panel);
      changed = true;
    }
  }

  // ── Battery ────────────────────────────────────────────────────────────────
  const cfgCount = typeof cfg.batteryCount === 'number' ? cfg.batteryCount : 0;
  const curBatId = project?.selectedBatteries?.[0]?.id;
  const curCount = project?.batteryCount ?? 0;
  if (cfg.batteryId) {
    const bat = getBatteryById(cfg.batteryId);
    if (bat && (bat.id !== curBatId || cfgCount !== curCount)) {
      patch.batteryId = bat.id;
      patch.batteries = cfgCount > 0 ? [batterySystemToBattery(bat)] : [];
      patch.batteryCount = cfgCount;
      patch.batteryKwh = typeof cfg.batteryKwh === 'number' && cfg.batteryKwh > 0
        ? cfg.batteryKwh
        : bat.usableCapacityKwh;
      changed = true;
    }
  } else if (cfgCount === 0 && curCount > 0) {
    // Battery removed in engineering — clear it from the design record too.
    patch.batteryId = '';
    patch.batteries = [];
    patch.batteryCount = 0;
    changed = true;
  }

  return changed ? patch : null;
}
