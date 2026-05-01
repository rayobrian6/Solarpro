/**
 * ============================================================
 * sizingToBom.ts — Phase 9 adapter
 *
 * Converts SystemSizingResult.requiredComponents into the
 * StructuralBOMItem shape that the existing BOM route's
 * injectStructuralIntoV4() already accepts.
 *
 * Responsibility split (MASTER TASK hard rule):
 *   sizing engine  → WHAT equipment family is needed + topology
 *   BOM engine (V4)→ HOW to count/render electrical items from
 *                    user-chosen inverterId / panelId
 *   adapter (this) → map sizing engine's non-V4 families
 *                    (battery base, combiner, smart meter, gateway,
 *                    DC disconnect, RSD, etc.) into BOM injectables.
 *
 * Rules:
 *   - Skip categories V4 already owns (solar_panel, microinverter,
 *     string_inverter, hybrid_inverter, battery, wire, conduit,
 *     breaker, racking, etc.) → V4 counts from inverterId/panelId.
 *   - Skip zero/negative quantities.
 *   - Enrich equipmentDbId → manufacturer / model / partNumber
 *     via equipment-db lookups where possible.
 *   - Emit items with stageId = 'inverter' for electrical-side BOS,
 *     'monitoring' for gateways/meters.
 * ============================================================
 */

import type { SystemSizingResult, SizedRequiredComponent } from './sizingEngine';
import type { BOMStageId } from '../bom-engine-v4';
import type { StructuralBOMItem } from '../bom-system-profiles';
import type { BosHint, LayoutCandidate } from './inverterCapabilities';
import {
  getInverterById,
  getMicroinverterById,
  getBatteryById,
  getOptimizerById,
} from '../equipment-db';

/**
 * Categories that V4 already derives from inverterId / panelId / batteryId.
 * The adapter must NOT re-emit these (would cause duplicates).
 * These must stay in lock-step with V4_OWNED_CATEGORIES in bom/route.ts —
 * duplicated here for import-decoupling.
 */
const V4_OWNED_FOR_ADAPTER = new Set<string>([
  // Modules & devices
  'solar_panel',
  'microinverter',
  'optimizer',
  'string_inverter',
  'hybrid_inverter',
  'inverter',
  'battery',
  // Generator & ATS
  'generator',
  'ats',
  'backup_interface',
  // Electrical
  'wire',
  'conduit',
  'breaker',
  'racking',
  // V4 already emits trunk_cable/terminator for micro.
  'trunk_cable',
  'terminator',
]);

/**
 * Categories the adapter should inject (non-V4-owned BOS that the
 * sizing engine knows about per brand profile).
 */
const ADAPTER_STAGE_MAP: Record<string, BOMStageId> = {
  battery_base: 'inverter',
  battery_combiner: 'inverter',
  battery_module: 'inverter',           // only if V4 didn't emit it
  smart_meter: 'monitoring',
  monitoring: 'monitoring',
  monitoring_gateway: 'monitoring',
  gateway: 'monitoring',
  dc_disconnect: 'inverter',
  ac_disconnect: 'inverter',
  dc_combiner: 'inverter',
  combiner: 'inverter',
  rapid_shutdown: 'inverter',
  inverter_base: 'inverter',
  rsd_initiator: 'inverter',
};

/**
 * Lookup equipment-db for manufacturer/model/partNumber enrichment.
 * Falls back to generic descriptor when equipment-db has no match
 * (legitimate for abstract BOS entries like a 'battery_base').
 */
function enrichFromEquipmentDb(equipmentDbId: string | undefined): {
  manufacturer?: string;
  model?: string;
  partNumber?: string;
} {
  if (!equipmentDbId) return {};

  const inv = getInverterById(equipmentDbId);
  if (inv) {
    return {
      manufacturer: inv.manufacturer,
      model: inv.model,
      partNumber: inv.id,
    };
  }

  const micro = getMicroinverterById(equipmentDbId);
  if (micro) {
    return {
      manufacturer: micro.manufacturer,
      model: micro.model,
      partNumber: micro.id,
    };
  }

  const opt = getOptimizerById(equipmentDbId);
  if (opt) {
    return {
      manufacturer: opt.manufacturer,
      model: opt.model,
      partNumber: opt.id,
    };
  }

  const bat = getBatteryById(equipmentDbId);
  if (bat) {
    return {
      manufacturer: bat.manufacturer,
      model: bat.model,
      partNumber: bat.id,
    };
  }

  return {};
}

/**
 * Convert a single SizedRequiredComponent → StructuralBOMItem.
 * Returns null when the component should be skipped (V4-owned,
 * zero qty, unknown stage mapping).
 */
function toStructuralItem(
  component: SizedRequiredComponent,
  brandManufacturer: string,
): StructuralBOMItem | null {
  if (!component || component.qty <= 0) return null;
  if (V4_OWNED_FOR_ADAPTER.has(component.category)) return null;

  const stageId = ADAPTER_STAGE_MAP[component.category];
  if (!stageId) {
    // Unmapped category → emit into 'inverter' stage as a best-effort default.
    // Adapter must never silently drop a sizing-engine-required BOS item.
  }

  const enriched = enrichFromEquipmentDb(component.equipmentDbId);

  return {
    stageId: (stageId ?? 'inverter') as StructuralBOMItem['stageId'],
    category: component.category,
    manufacturer: enriched.manufacturer ?? brandManufacturer,
    model: enriched.model ?? component.equipmentDbId ?? component.category,
    partNumber: enriched.partNumber ?? component.equipmentDbId ?? component.category,
    description: component.note ?? `${component.category} (derived by sizing engine)`,
    quantity: component.qty,
    unit: 'ea',
    derivedFrom: `sizing-engine:${component.qtyPolicy}`,
    required: component.required,
  };
}

/**
 * Result of sizingToBom conversion.
 */
export interface SizingToBomResult {
  /** StructuralBOMItem-shaped entries ready for injectStructuralIntoV4(). */
  items: StructuralBOMItem[];
  /** Categories that were skipped because V4 already owns them. */
  skippedV4Owned: string[];
  /** Categories skipped due to zero qty or other reasons. */
  skippedOther: string[];
  /** Derivation log for debugging. */
  log: string[];
}

/**
 * Main adapter entry point.
 *
 * @param sizing SystemSizingResult from sizeSystemFromBrand(...)
 * @returns StructuralBOMItem[] suitable for injectStructuralIntoV4()
 */
export function sizingResultToBomItems(
  sizing: SystemSizingResult,
): SizingToBomResult {
  const items: StructuralBOMItem[] = [];
  const skippedV4Owned: string[] = [];
  const skippedOther: string[] = [];
  const log: string[] = [];

  log.push(
    `[sizingToBom] brand=${sizing.brand.id} (${sizing.brand.manufacturer}) ` +
    `topology=${sizing.topology} components=${sizing.requiredComponents.length}`,
  );

  for (const comp of sizing.requiredComponents) {
    if (V4_OWNED_FOR_ADAPTER.has(comp.category)) {
      skippedV4Owned.push(`${comp.category} (V4 owns)`);
      continue;
    }
    if (comp.qty <= 0) {
      skippedOther.push(`${comp.category} (qty=0)`);
      continue;
    }
    const item = toStructuralItem(comp, sizing.brand.manufacturer);
    if (item) {
      items.push(item);
    } else {
      skippedOther.push(`${comp.category} (skipped by toStructuralItem)`);
    }
  }

  // Battery module emission: only if battery block is present AND V4
  // did NOT receive a batteryId. Otherwise V4 owns the battery line.
  // NOTE: we cannot know V4's input from here, so the BOM route must
  // decide whether to call this. The adapter just surfaces the data.
  if (sizing.battery && sizing.battery.moduleCount > 0 && sizing.battery.equipmentDbId) {
    const enriched = enrichFromEquipmentDb(sizing.battery.equipmentDbId);
    log.push(
      `[sizingToBom] battery candidate: ${sizing.battery.moduleCount} × ` +
      `${sizing.battery.equipmentDbId} = ${sizing.battery.installedKwh} kWh`,
    );
    // Emit a candidate battery item. BOM route will deduplicate against V4.
    items.push({
      stageId: 'inverter',
      category: 'battery',
      manufacturer: enriched.manufacturer ?? sizing.battery.brandId,
      model: enriched.model ?? sizing.battery.equipmentDbId,
      partNumber: enriched.partNumber ?? sizing.battery.equipmentDbId,
      description:
        enriched.model
          ? `${enriched.manufacturer ?? ''} ${enriched.model}`.trim()
          : `${sizing.battery.brandId} battery module`,
      quantity: sizing.battery.moduleCount,
      unit: 'ea',
      derivedFrom: `sizing-engine:battery:${sizing.battery.strategy}:${sizing.battery.installedKwh}kWh`,
      required: true,
    });
  }

  log.push(
    `[sizingToBom] emitted ${items.length} items (skipped V4-owned=${skippedV4Owned.length}, other=${skippedOther.length})`,
  );

  return { items, skippedV4Owned, skippedOther, log };
}

/**
 * Topology-gated filter: when topology is NOT micro, strip any
 * micro-only items that may have leaked into a BOM (defense-in-depth
 * against stale components when switching brands).
 *
 * Replaces the old isEcoFlowInverter() check — now fully driven by
 * the sizing engine's resolved topology.
 */
export const MICRO_ONLY_CATEGORIES_FOR_FILTER = new Set<string>([
  'microinverter',
  'trunk_cable',
  'terminator',
]);

export function shouldStripMicroItems(sizing: SystemSizingResult): boolean {
  return sizing.topology !== 'micro';
}

// ─── Phase 11 — BosHint cascade ───────────────────────────────────────────────

/**
 * Stage map for BOS hint categories → BOM stageId.
 * Mirrors ADAPTER_STAGE_MAP but driven by the layout brain's BosHint categories.
 */
const BOS_HINT_STAGE_MAP: Record<string, BOMStageId> = {
  optimizer:          'inverter',
  dc_disconnect:      'inverter',
  ac_disconnect:      'inverter',
  dc_combiner:        'inverter',
  rapid_shutdown:     'inverter',
  microinverter:      'inverter',
  trunk_cable:        'inverter',
  terminator:         'inverter',
  combiner:           'inverter',
  monitoring_gateway: 'monitoring',
  smart_meter:        'monitoring',
};

/**
 * Convert a BosHint + layout context into a StructuralBOMItem.
 *
 * @param hint        - BosHint from LayoutCandidate.bos
 * @param candidate   - The selected LayoutCandidate (for qty derivation)
 * @param manufacturer - Brand manufacturer string (fallback for unresolved items)
 * @returns StructuralBOMItem or null if the hint cannot be mapped
 */
function bosHintToStructuralItem(
  hint: BosHint,
  candidate: LayoutCandidate,
  manufacturer: string,
): StructuralBOMItem | null {
  const stageId = BOS_HINT_STAGE_MAP[hint.category];
  if (!stageId) return null;  // Unknown category — skip rather than corrupt BOM

  // Derive quantity from policy + candidate fields
  let qty = 0;
  switch (hint.qtyPolicy) {
    case 'per_module':   qty = candidate.panelCount;   break;
    case 'per_inverter': qty = candidate.inverterQty;  break;
    case 'per_branch':   qty = candidate.branchLayout?.branchCount ?? 0; break;
    case 'fixed_count':  qty = hint.fixedQty ?? 1;     break;
    case 'derived':      qty = 0;                       break;  // BOM engine derives
  }

  if (qty <= 0 && hint.qtyPolicy !== 'derived') return null;

  const enriched = enrichFromEquipmentDb(hint.equipmentDbId);

  return {
    stageId: stageId as StructuralBOMItem['stageId'],
    category: hint.category,
    manufacturer: enriched.manufacturer ?? manufacturer,
    model: enriched.model ?? hint.equipmentDbId ?? hint.category,
    partNumber: enriched.partNumber ?? hint.equipmentDbId ?? hint.category,
    description: hint.note ?? `${hint.category} (layout brain hint)`,
    quantity: qty,
    unit: 'ea',
    derivedFrom: `layout-brain:${hint.qtyPolicy}:${candidate.profile.modelName}`,
    required: hint.required,
  };
}

/**
 * Convert LayoutCandidate.bos hints into StructuralBOMItems.
 *
 * Called AFTER sizingResultToBomItems() — the caller should merge the two
 * result sets, preferring requiredComponents items for categories that both
 * emit (requiredComponents has brand-profile-level precision; bos hints add
 * layout-specific items like dc_combiner that only exist when parallel strings
 * are present).
 *
 * @param candidate   - The selected LayoutCandidate from the brain
 * @param alreadyEmittedCategories - Categories already emitted by sizingResultToBomItems
 * @param manufacturer - Brand manufacturer string for fallback enrichment
 */
export function bosHintsToBomItems(
  candidate: LayoutCandidate,
  alreadyEmittedCategories: Set<string>,
  manufacturer: string,
): StructuralBOMItem[] {
  const items: StructuralBOMItem[] = [];

  for (const hint of candidate.bos) {
    // Skip if the parent BOM pipeline already owns this category — avoid duplicates.
    // Exception: dc_combiner is layout-specific and should always be considered.
    if (hint.category !== 'dc_combiner' && alreadyEmittedCategories.has(hint.category)) {
      continue;
    }

    const item = bosHintToStructuralItem(hint, candidate, manufacturer);
    if (item) {
      items.push(item);
    }
  }

  return items;
}