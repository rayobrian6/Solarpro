// ═══════════════════════════════════════════════════════════════
// THE nameplate function — DATA-AUTHORITY-AUDIT P0-7 / P0-6 (data side).
//
// One project had FOUR contradictory stored system sizes (layouts 36.09 /
// projects 37.251 / engineering_runs 39.07 / permit-input 38.72) because every
// layer computed "kW" its own way — most of them trusting per-panel stamp
// wattage, which is poisoned at the source (Stowell ground stamped 405 vs
// LONGi-580 truth; fence stamped 430 from a hardcoded literal vs PS-440).
//
// THE DOCTRINE (register §doctrine):
//   • Sub MEMBERSHIP comes from the panel placement stamps (§1.1) — classify
//     each panel by its systemType/placementType stamp.
//   • Sub WATTAGE comes from subSystems[key].panelId resolved via equipment-db.
//     Stamp wattage is NEVER trusted when the map covers the sub.
//   • Stamp wattage is the fallback ONLY when the map lacks the sub (or its
//     panelId doesn't resolve) — and that fallback is console.warn-audited.
//
// This module is dependency-light on purpose (types + toSubSystemKey only;
// the equipment-db resolver is INJECTED) so it can be imported by client and
// server alike without dragging the catalog into a client bundle.
//
// Consumers (Wave INTAKE-2): layout save (app/api/projects/[id]/layout),
// upsertLayout (lib/db/projects.ts — the single chokepoint every save path
// funnels through), and the system-size backfill migration mirrors its rule
// in SQL (lib/migrations/111_system_size_nameplate_backfill.sql).
// ═══════════════════════════════════════════════════════════════

import type { SubSystemEquipmentMap, SubSystemKey } from './subSystemEquipment';
import { SUB_SYSTEM_KEYS } from './subSystemEquipment';

/** The minimal stamp surface nameplate reads off a placed panel. */
export interface NameplatePanelStamp {
  systemType?: string;
  placementType?: string;
  wattage?: number;
  [k: string]: unknown;
}

/** The minimal panel record the injected resolver must return. */
export interface NameplatePanelRecord {
  id: string;
  watts: number;
}

export type NameplateGetPanelById = (id: string) => NameplatePanelRecord | undefined;

export interface SubNameplate {
  key: SubSystemKey;
  count: number;
  /** Per-module W in effect (map watts; on stamp fallback, the majority stamp W). */
  watts: number;
  /** count × watts summed per panel, kW, rounded to 3 dp. */
  kw: number;
  /** 'map' = equipment-db via subSystems[key].panelId; 'stamps' = audited fallback. */
  wattsSource: 'map' | 'stamps';
  /** Set when wattsSource==='map': the resolved panelId. */
  panelId?: string;
}

export interface NameplateResult {
  subs: SubNameplate[];
  totalPanels: number;
  /** Σ sub kW, rounded to 2 dp (matches the legacy layout-save formatting). */
  totalKw: number;
}

/**
 * Membership classification — mirrors classifyPanel() in
 * lib/permit/utils/subSystems.ts (placement stamps are the §1.1 authority;
 * roof is the end-to-end default placement type).
 */
function classifyStamp(p: NameplatePanelStamp): SubSystemKey {
  const pt = String(p?.placementType ?? '').toUpperCase();
  const st = String(p?.systemType ?? '').toLowerCase();
  if (pt === 'FENCE' || st === 'fence' || st === 'solar_fence') return 'fence';
  if (pt === 'GROUND' || st === 'ground' || st === 'ground_mount') return 'ground';
  return 'roof';
}

/** Legacy default used when a stamp carries no numeric wattage (layout route parity). */
const STAMP_DEFAULT_WATTS = 400;

/**
 * computeNameplateKw — per-sub {key, count, watts, kw} + total.
 *
 *  • membership: panel stamps (classifyStamp above)
 *  • wattage: ALWAYS subSystems[key].panelId → getPanelById(...).watts
 *  • fallback to stamp wattage ONLY when the map lacks the sub (or the map's
 *    panelId does not resolve) — console.warn audit line either way
 *
 * With NO map at all (subSystems null/empty) the result is arithmetically
 * identical to the legacy stamp sum (Σ wattage, 400 default) — single-system
 * map-less projects stay byte-identical.
 */
export function computeNameplateKw(
  panels: ReadonlyArray<NameplatePanelStamp> | null | undefined,
  subSystems: SubSystemEquipmentMap | null | undefined,
  getPanelById: NameplateGetPanelById,
): NameplateResult {
  const groups: Record<SubSystemKey, NameplatePanelStamp[]> = { roof: [], ground: [], fence: [] };
  for (const p of panels ?? []) groups[classifyStamp(p)].push(p);

  const subs: SubNameplate[] = [];
  let totalWatts = 0;
  let totalPanels = 0;

  for (const key of SUB_SYSTEM_KEYS) {
    const list = groups[key];
    if (list.length === 0) continue;
    totalPanels += list.length;

    const entry = subSystems?.[key];
    const mapPanelId = typeof entry?.panelId === 'string' && entry.panelId ? entry.panelId : undefined;
    const record = mapPanelId ? getPanelById(mapPanelId) : undefined;

    if (record && typeof record.watts === 'number' && record.watts > 0) {
      // Map-authoritative wattage (stamps never trusted here).
      const subWatts = record.watts * list.length;
      totalWatts += subWatts;
      subs.push({
        key,
        count: list.length,
        watts: record.watts,
        kw: Math.round(subWatts / 1000 * 1000) / 1000,
        wattsSource: 'map',
        panelId: mapPanelId,
      });
      // Audit line when the stamps contradict the authority (P0-6 signature).
      const disagreeing = list.filter(
        p => typeof p.wattage === 'number' && p.wattage !== record.watts,
      ).length;
      if (disagreeing > 0) {
        console.warn(
          `[nameplate] sub '${key}': ${disagreeing}/${list.length} stamp wattages contradict ` +
          `subSystems.${key}.panelId=${mapPanelId} (${record.watts}W) — map wins (P0-6).`,
        );
      }
    } else {
      // Audited fallback: the map lacks this sub (or its panelId is unresolvable).
      if (mapPanelId) {
        console.warn(
          `[nameplate] sub '${key}': subSystems.${key}.panelId='${mapPanelId}' does not resolve ` +
          `in equipment-db — falling back to stamp wattage (audit P0-7).`,
        );
      } else if (subSystems && Object.keys(subSystems).length > 0) {
        console.warn(
          `[nameplate] sub '${key}': subSystems map lacks this sub — falling back to stamp wattage (audit P0-7).`,
        );
      }
      let subWatts = 0;
      const dist = new Map<number, number>();
      for (const p of list) {
        const w = typeof p.wattage === 'number' && p.wattage > 0 ? p.wattage : STAMP_DEFAULT_WATTS;
        subWatts += w;
        dist.set(w, (dist.get(w) ?? 0) + 1);
      }
      let majorityWatts = STAMP_DEFAULT_WATTS;
      let majorityCount = -1;
      for (const [w, n] of dist) {
        if (n > majorityCount) { majorityWatts = w; majorityCount = n; }
      }
      totalWatts += subWatts;
      subs.push({
        key,
        count: list.length,
        watts: majorityWatts,
        kw: Math.round(subWatts / 1000 * 1000) / 1000,
        wattsSource: 'stamps',
      });
    }
  }

  return {
    subs,
    totalPanels,
    // parseFloat((w/1000).toFixed(2)) — exact legacy layout-route formatting.
    totalKw: parseFloat((totalWatts / 1000).toFixed(2)),
  };
}
