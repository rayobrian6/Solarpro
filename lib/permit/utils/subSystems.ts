// ═══════════════════════════════════════════════════════════════
// SubSystem partition — Phase 1 of hybrid (multi-system) support.
//
// A design may contain roof + ground + fence sub-arrays in ONE
// project (Stowell test case). The legacy pipeline collapses that to
// a single systemType (one fence panel makes the whole project a
// fence) and deletes the losing CAD sub-models. This module is the
// foundation that replaces the vote with a PARTITION: group the
// placed panels by their per-panel systemType (stamped at placement
// — placementEngine.ts:556/599/664) so each sub-system can carry its
// OWN source of truth (CAD section, structural analysis, BOM
// quantities, sheets) per Ray's directive.
//
// Pure + deterministic (conductorAuthority pattern): same panels →
// same partition. Consumers iterate SubSystem[] instead of reading
// one scalar.
// ═══════════════════════════════════════════════════════════════

import type { CanonicalSysType } from '../types';
import type { SubSystemKey } from '@/lib/system/subSystemEquipment';

// Wave 1 (per-subsystem equipment contract §1.1/§1.2): the canonical
// declarations live in lib/system/subSystemEquipment.ts (dependency-free,
// client+server importable); this module — the partition primitive — is the
// permit-side import path for them.
export type {
  SubSystemKey,
  SubSystemEquipment,
  SubSystemEquipmentMap,
} from '@/lib/system/subSystemEquipment';
export {
  SUB_SYSTEM_KEYS,
  isSubSystemKey,
  toSubSystemKey,
  ensureSubSystemShape,
  synthesizeFromLegacyScalars,
} from '@/lib/system/subSystemEquipment';

export interface SubSystemPanel {
  systemType?: string;
  placementType?: string;
  arrayId?: string;
  planeId?: string;
  [k: string]: unknown;
}

export interface SubSystem<P extends SubSystemPanel = SubSystemPanel> {
  /** Canonical system type of this sub-system. */
  systemType: CanonicalSysType;
  /** Short id for namespacing (runs, sheets, logs): 'roof' | 'ground' | 'fence'. */
  key: SubSystemKey;
  /** The panels belonging to this sub-system (original references, not copies). */
  panels: P[];
  panelCount: number;
  /** Distinct sub-arrays within this sub-system (arrayId, else planeId). */
  arrayCount: number;
}

/** Classify one panel by its per-panel provenance (placement-stamped). */
export function classifyPanel(p: SubSystemPanel): SubSystemKey {
  const pt = String(p.placementType ?? '').toUpperCase();
  const st = String(p.systemType ?? '').toLowerCase();
  if (pt === 'FENCE' || st === 'fence' || st === 'solar_fence') return 'fence';
  if (pt === 'GROUND' || st === 'ground' || st === 'ground_mount') return 'ground';
  return 'roof'; // roof is the default placement type end-to-end
}

const KEY_TO_CANONICAL: Record<'roof' | 'ground' | 'fence', CanonicalSysType> = {
  roof: 'roof',
  ground: 'ground_mount',
  fence: 'solar_fence',
};

/**
 * Partition placed panels into sub-systems. Always returns ≥1 entry (an empty
 * panel list yields a single roof sub-system so legacy callers stay valid).
 * Order is stable: roof, ground, fence — the roof (building) system leads the
 * set; ground/fence follow as additional structures.
 */
export function partitionSubSystems<P extends SubSystemPanel>(panels: P[]): SubSystem<P>[] {
  const groups: Record<'roof' | 'ground' | 'fence', P[]> = { roof: [], ground: [], fence: [] };
  for (const p of panels ?? []) groups[classifyPanel(p)].push(p);

  const out: SubSystem<P>[] = [];
  for (const key of ['roof', 'ground', 'fence'] as const) {
    const list = groups[key];
    if (list.length === 0) continue;
    const arrays = new Set<string>();
    for (const p of list) arrays.add(String(p.arrayId ?? p.planeId ?? '0'));
    out.push({
      systemType: KEY_TO_CANONICAL[key],
      key,
      panels: list,
      panelCount: list.length,
      arrayCount: Math.max(1, arrays.size),
    });
  }
  if (out.length === 0) {
    out.push({ systemType: 'roof', key: 'roof', panels: [], panelCount: 0, arrayCount: 1 });
  }
  return out;
}

/** True when the panels span more than one system type. */
export function isHybrid(panels: SubSystemPanel[]): boolean {
  return partitionSubSystems(panels).length > 1;
}
