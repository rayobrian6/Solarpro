// ============================================================
// deriveFleetFromMap — the PROJECTOR (hybrid equipment redesign #9)
//
// config.subSystems{} is the single source of per-sub equipment IDENTITY
// (inverterId, panelId). config.inverters[] is a PURE PROJECTION of
//   (map ⊗ per-sub layout stamp counts ⊗ carried geometry).
//
// This is the ONLY function that should construct a hybrid fleet from the map.
// It sizes each present sub's strings to ITS layout stamp count (never a stored
// fleet total, never inverter capacity — killing the "fence 45 ≠ layout 17"
// drift), derives the brand from the sub's own inverterId (never a stale
// ecosystemBrand tag — killing the EcoFlow flood), enforces the NEC 690.7
// cold-Voc string ceiling via the sizing engine, and CARRIES prior per-string
// geometry (tilt/azimuth/wireGauge/mounting/roofType) through the projection so
// a re-derive never loses wiring/orientation.
//
// Pure — depends only on the sizing engine + equipment DB + the canonical
// InverterConfig factory. Safe for client and server.
// ============================================================

import { SUB_SYSTEM_KEYS, type SubSystemKey } from '@/lib/system/subSystemEquipment';
import { sizeSystemFromBrand } from '@/lib/system/sizingEngine';
import { getBrandProfileByInverterId } from '@/lib/system/brandProfiles';
import { getPanelById, getMicroinverterById, getInverterById } from '@/lib/equipment-db';
import {
  buildStringConfig,
  buildInverterConfig,
  type InverterConfig,
  type StringConfig,
  type InverterType,
} from '@/lib/system/buildInverterConfig';

/** Per-sub identity carried by the map (contract §1.1). */
export interface SubEquipmentEntry {
  inverterId?: string;
  panelId?: string;
  topology?: string;
  ecosystemBrand?: string;
}

export interface DeriveFleetOptions {
  /** Identity authority: per-sub equipment map. */
  subSystems: Partial<Record<SubSystemKey, SubEquipmentEntry>>;
  /** Layout authority: per-sub module counts (from the CAD panel stamps). */
  stampCounts: Partial<Record<SubSystemKey, number>>;
  /** Prior fleet — per-string geometry (tilt/azimuth/wire/mounting) is carried through. */
  prev?: InverterConfig[] | null;
  /** Cold design temperature for the NEC 690.7 ceiling (default −10 °C). */
  designTempMin?: number;
}

/** Geometry fields that must survive a projection (not re-invented). */
interface CarriedGeometry {
  tilt?: number; azimuth?: number; roofType?: string;
  mountingSystem?: string; wireGauge?: string; wireLength?: number;
}

function geometryFromPrev(prev: InverterConfig[] | null | undefined, key: SubSystemKey): CarriedGeometry {
  const s0 = (prev ?? [])
    .filter(inv => (inv.subSystemKey ?? undefined) === key)
    .flatMap(inv => inv.strings ?? [])[0];
  if (!s0) return {};
  return {
    tilt: s0.tilt, azimuth: s0.azimuth, roofType: s0.roofType,
    mountingSystem: s0.mountingSystem, wireGauge: s0.wireGauge, wireLength: s0.wireLength,
  };
}

function uiTypeFor(topology: string, brandId: string): InverterType {
  if (topology === 'micro') return 'micro';
  if (topology === 'optimizer') return 'optimizer';
  if (topology === 'hybrid') return brandId === 'ecoflow' ? 'ecoflow' : 'hybrid';
  return 'string';
}

/**
 * Project config.inverters[] from the per-sub equipment map + layout stamps.
 * Present sub = stampCounts[key] > 0 AND map[key] carries an inverterId.
 * Returns inverters in the fixed roof > ground > fence order (contract §1.4).
 */
export function deriveFleetFromMap(opts: DeriveFleetOptions): InverterConfig[] {
  const designTempMin = opts.designTempMin ?? -10;
  const out: InverterConfig[] = [];

  for (const key of SUB_SYSTEM_KEYS) {
    const count = Math.max(0, Math.floor(opts.stampCounts[key] ?? 0));
    const entry = opts.subSystems[key];
    if (count <= 0 || !entry?.inverterId) continue;

    const panel = entry.panelId ? getPanelById(entry.panelId) : undefined;
    const geo = geometryFromPrev(opts.prev, key);

    let rec;
    try {
      rec = sizeSystemFromBrand({
        systemType: key,
        panelCount: count,                               // LAYOUT stamp = the authority
        panelWattage: (panel as any)?.watts ?? 400,
        ...(panel?.voc ? { panelVoc: panel.voc } : {}),
        ...((panel as any)?.vmp ? { panelVmp: (panel as any).vmp } : {}),
        ...(panel?.isc ? { panelIsc: panel.isc } : {}),
        ...(typeof panel?.tempCoeffVoc === 'number' ? { panelTempCoeffVoc: panel.tempCoeffVoc } : {}),
        designTempMin,
        selectedInverterId: entry.inverterId,            // brand DERIVED from the inverter
        batteryEnabled: false,
      } as any);
    } catch {
      continue;
    }

    const invModelId = rec.inverterModels[0]?.equipmentDbId ?? entry.inverterId;
    const brandId = getBrandProfileByInverterId(invModelId)?.id ?? rec.brand?.id ?? entry.ecosystemBrand ?? '';
    const uiType = uiTypeFor(rec.topology, brandId);
    const panelId = entry.panelId ?? (panel as any)?.id ?? '';

    const mkStr = (index: number, panelCount: number): StringConfig =>
      buildStringConfig({
        index, systemType: key, panelCount, panelId,
        tilt: geo.tilt, azimuth: geo.azimuth, roofType: geo.roofType,
        mountingSystem: geo.mountingSystem, wireGauge: geo.wireGauge, wireLength: geo.wireLength,
        subSystemKey: key,
      });

    if (uiType === 'micro') {
      // One micro "fleet" inverter carrying the whole sub as a single string;
      // device count = module count (1:1). NEC clamp is N/A for micros.
      out.push(buildInverterConfig({
        inverterId: invModelId, type: 'micro',
        strings: [mkStr(0, count)], subSystemKey: key,
      }));
      continue;
    }

    // String/optimizer/hybrid: group the engine's sized strings by inverter.
    const byInv = new Map<number, number[]>();
    for (const s of rec.strings) {
      const idx = (s as any).inverterIndex ?? 0;
      if (!byInv.has(idx)) byInv.set(idx, []);
      byInv.get(idx)!.push(s.panelCount);
    }
    if (byInv.size === 0) byInv.set(0, [count]);           // fallback: one string of the full count
    const invCount = Math.max(1, rec.inverterCount || byInv.size);
    for (let idx = 0; idx < invCount; idx++) {
      const counts = byInv.get(idx) ?? (idx === 0 ? [count] : [0]);
      const strings = counts.map((pc, i) => mkStr(i, pc));
      if (strings.length === 0) strings.push(mkStr(0, 0));
      out.push(buildInverterConfig({
        inverterId: invModelId, type: uiType, strings, subSystemKey: key,
      }));
    }
  }

  return out;
}
