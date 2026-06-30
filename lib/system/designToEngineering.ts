/**
 * designToEngineering.ts — Design Studio → Engineering electrical handoff (v1)
 *
 * Converts the DesignElectrical block (logged by Design Studio when a client
 * project is active) into the inverter/string inputs the Engineering page needs
 * to seed its SystemState — so string count, string sizes, topology, brand,
 * panel, racking and the per-panel string assignment carry over with no re-entry.
 *
 * Pure + dependency-light: only reads equipment-db default lists to pick a
 * sensible inverter id when the project hasn't pinned one.
 */

import type { DesignElectrical } from '@/types';
import type { StringConfig } from '@/lib/system-state';
import { STRING_INVERTERS, MICROINVERTERS } from '@/lib/equipment-db';

export interface DesignEngineeringHandoff {
  inverterType: 'string' | 'micro' | 'optimizer';
  inverterId: string;
  inverterBrand: string;
  mountingId?: string;
  /** SolarEdge optimizer model when topology === 'optimizer'. */
  optimizerPeripheralId?: string;
  strings: StringConfig[];
}

export interface DesignToEngineeringOpts {
  /** Project-selected inverter id (takes precedence over the topology default). */
  selectedInverterId?: string;
  tilt?: number;
  azimuth?: number;
  roofType?: string;
  wireGauge?: string;
  wireLength?: number;
}

function defaultInverterId(topology: DesignElectrical['topology']): string {
  if (topology === 'micro') return MICROINVERTERS[0]?.id ?? 'enphase-iq8plus';
  // optimizer + string both run on a string inverter (optimizer is a peripheral)
  return STRING_INVERTERS[0]?.id ?? 'se-7600h';
}

/**
 * The inverter model the design ACTUALLY recorded (e.g. IQ8A for a micro design),
 * if any. This must win over the industry-standard topology default — defaulting a
 * micro to IQ8+ (290W) when the design specified IQ8A (349W) makes AC output ~17%
 * low. Only the optimizer peripheral id stays separate (it's not the inverter).
 */
function designRecordedInverterId(de: DesignElectrical): string | undefined {
  if (de.topology === 'micro') return de.microModelId;
  return undefined;
}

function inferBrand(de: DesignElectrical): string {
  if (de.inverterBrand) return de.inverterBrand;
  if (de.topology === 'micro') return 'Enphase';
  return 'SolarEdge';
}

/**
 * Build engineering inverter inputs from a design's electrical block.
 * One StringConfig per design string, with the exact per-string panel counts.
 */
export function designElectricalToEngineering(
  de: DesignElectrical,
  opts: DesignToEngineeringOpts = {},
): DesignEngineeringHandoff {
  const tilt      = opts.tilt ?? 20;
  const azimuth   = opts.azimuth ?? 180;
  const roofType  = opts.roofType ?? 'shingle';
  const wireGauge = opts.wireGauge ?? '#10 AWG THWN-2';
  const wireLength = opts.wireLength ?? 50;
  const mounting  = de.rackingId || 'ironridge-xr100';
  const panelId   = de.panelId || 'qcells-peak-duo-400';

  // Sort by stringIndex and emit a StringConfig per design string.
  const sorted = [...(de.strings ?? [])].sort((a, b) => a.stringIndex - b.stringIndex);
  const strings: StringConfig[] = sorted
    .filter(s => s.panelCount > 0)
    .map((s, i) => ({
      id: `str-design-${i}`,
      label: `String ${i + 1}`,
      panelCount: s.panelCount,
      panelId,
      tilt,
      azimuth,
      roofType,
      mountingSystem: mounting,
      wireGauge,
      wireLength,
    }));

  return {
    inverterType: de.topology,
    // Precedence: project-pinned inverter > the model the DESIGN recorded > topology default.
    inverterId: opts.selectedInverterId || designRecordedInverterId(de) || defaultInverterId(de.topology),
    inverterBrand: inferBrand(de),
    mountingId: de.rackingId,
    optimizerPeripheralId: de.topology === 'optimizer' ? de.optimizerModelId : undefined,
    strings,
  };
}

// ── Permit-shaped inverters (for the server-side planset backfill) ───────────
// The planset reads inv.type, inv.inverterId/model, inv.strings[].{panelCount,
// wireGauge,panelId,...}. These builders produce a GUARANTEED-complete shape so
// a partial/stale DB record can never feed malformed data into the renderer.

export interface PermitInverter {
  id: string;
  inverterId: string;
  model: string;
  type: 'string' | 'micro' | 'optimizer';
  strings: Array<{
    id: string; label: string; panelCount: number; panelId: string;
    wireGauge: string; tilt: number; azimuth: number; roofType: string; mountingSystem: string;
  }>;
  stringsPerInverter: number;
  modulesPerString: number;
  optimizerPeripheralId?: string;
}

/**
 * Normalize ANY raw inverter array (e.g. a saved engineering_config from the DB,
 * shape not guaranteed) into a complete, valid PermitInverter[]. Fills every
 * field the planset reads with sane defaults. Returns null if it can't produce
 * a usable result — the caller then keeps the original payload (never breaks).
 */
export function normalizeToPermitInverters(raw: unknown): PermitInverter[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  try {
    const out: PermitInverter[] = [];
    for (let i = 0; i < raw.length; i++) {
      const inv = raw[i] as any;
      const rawStrings = Array.isArray(inv?.strings) ? inv.strings : [];
      const strings = rawStrings
        .map((s: any, j: number) => ({
          id: String(s?.id ?? `str-${i}-${j}`),
          label: String(s?.label ?? `String ${j + 1}`),
          panelCount: Number(s?.panelCount) || 0,
          panelId: String(s?.panelId ?? 'qcells-peak-duo-400'),
          wireGauge: String(s?.wireGauge ?? '#10 AWG THWN-2'),
          tilt: Number(s?.tilt) || 20,
          azimuth: Number(s?.azimuth) || 180,
          roofType: String(s?.roofType ?? 'shingle'),
          mountingSystem: String(s?.mountingSystem ?? 'ironridge-xr100'),
        }))
        .filter((s: { panelCount: number }) => s.panelCount > 0);
      if (strings.length === 0) return null;
      const type: PermitInverter['type'] =
        inv?.type === 'micro' || inv?.type === 'optimizer' ? inv.type : 'string';
      out.push({
        id: String(inv?.id ?? `inv-${i}`),
        inverterId: String(inv?.inverterId ?? inv?.model ?? defaultInverterId(type)),
        model: String(inv?.model ?? inv?.inverterId ?? ''),
        type,
        strings,
        stringsPerInverter: strings.length,
        modulesPerString: strings[0].panelCount,
        ...(inv?.optimizerPeripheralId ? { optimizerPeripheralId: String(inv.optimizerPeripheralId) } : {}),
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Build permit-shaped inverters straight from a DesignElectrical block. */
export function designToPermitInverters(
  de: DesignElectrical,
  opts: DesignToEngineeringOpts = {},
): PermitInverter[] | null {
  try {
    if (!de || !Array.isArray(de.strings) || de.strings.length === 0) return null;
    const h = designElectricalToEngineering(de, opts);
    if (h.strings.length === 0) return null;
    const inv: PermitInverter = {
      id: 'inv-design-0',
      inverterId: h.inverterId,
      model: h.inverterId,
      type: h.inverterType,
      strings: h.strings.map((s, j) => ({
        id: String(s.id ?? `str-design-${j}`),
        label: String(s.label ?? `String ${j + 1}`),
        panelCount: Number(s.panelCount) || 0,
        panelId: String(s.panelId ?? 'qcells-peak-duo-400'),
        wireGauge: String(s.wireGauge ?? '#10 AWG THWN-2'),
        tilt: Number(s.tilt) || 20,
        azimuth: Number(s.azimuth) || 180,
        roofType: String((s as any).roofType ?? 'shingle'),
        mountingSystem: String(s.mountingSystem ?? 'ironridge-xr100'),
      })).filter(s => s.panelCount > 0),
      stringsPerInverter: h.strings.length,
      modulesPerString: h.strings[0]?.panelCount ?? 0,
      ...(h.optimizerPeripheralId ? { optimizerPeripheralId: h.optimizerPeripheralId } : {}),
    };
    return inv.strings.length > 0 ? [inv] : null;
  } catch {
    return null;
  }
}
