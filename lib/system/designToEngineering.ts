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
import { SUB_SYSTEM_KEYS, isSubSystemKey, type SubSystemKey } from '@/lib/system/subSystemEquipment';
import { classifyPanel, type SubSystemPanel } from '@/lib/permit/utils/subSystems';

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

// ── Wave 4A — per-subsystem design electrical (contract §1.3) ────────────────
// design_electrical is DESIGN TRUTH: when panel stamps span >1 system type the
// block carries `subSystems` (split via classifyPanel) and the flat legacy
// fields become the PRIMARY sub's mirror (§1.4 roof > ground > fence). Single-
// type designs keep the flat block ONLY (no map ⇒ §1.6 degenerate rule ⇒
// designVersionId unchanged).

/** One per-sub electrical block (the DesignElectrical.subSystems entry shape). */
export type DesignSubSystemBlock = NonNullable<DesignElectrical['subSystems']>[number];

/** Minimal placed-panel view the splitter reads (id + membership stamps). */
export interface DesignPanelStamp extends SubSystemPanel {
  id: string;
}

/** Distinct SubSystemKeys stamped on the placed panels, in fixed
 *  roof > ground > fence order (§1.4). */
export function presentDesignSubSystemKeys(
  panels: ReadonlyArray<SubSystemPanel> | null | undefined,
): SubSystemKey[] {
  const present = new Set<SubSystemKey>();
  for (const p of panels ?? []) present.add(classifyPanel(p));
  return SUB_SYSTEM_KEYS.filter(k => present.has(k));
}

/**
 * Validated per-sub blocks of a stored DesignElectrical. Returns the blocks in
 * fixed roof > ground > fence order when the design is GENUINELY hybrid (>= 2
 * entries that carry panels); returns null for absent / empty / degenerate
 * single-entry maps — the flat legacy block rules those (byte-identical
 * legacy path). blocks[0].key is the PRIMARY sub (§1.4).
 */
export function designSubSystemBlocks(
  de: Pick<DesignElectrical, 'subSystems'> | null | undefined,
): DesignSubSystemBlock[] | null {
  const raw = de?.subSystems;
  if (!Array.isArray(raw)) return null;
  const blocks: DesignSubSystemBlock[] = [];
  for (const key of SUB_SYSTEM_KEYS) {
    const b = raw.find(x => x && isSubSystemKey(x.key) && x.key === key);
    if (!b) continue;
    if (!Array.isArray(b.strings) || b.strings.length === 0) continue;
    if (b.strings.reduce((s, x) => s + (x?.panelCount || 0), 0) <= 0) continue;
    blocks.push(b);
  }
  return blocks.length > 1 ? blocks : null;
}

export interface BuildDesignElectricalInput {
  /** Placed panels WITH their membership stamps (§1.1 membership authority). */
  panels: ReadonlyArray<DesignPanelStamp>;
  /** Final per-panel string assignment: panelId → stringIndex. */
  assignmentByPanelId: Record<string, number>;
  topology: DesignElectrical['topology'];
  inverterBrand?: string;
  modulesPerString: number;
  rackingId?: string;
  panelId?: string;
  optimizerModelId?: string;
  microModelId?: string;
  /** Manual paint overrides only (UI restore field — kept design-wide). */
  overrides?: Record<string, number>;
  /** assignStrings deviceCount for the WHOLE design (flat mirror rescales it). */
  deviceCount: number;
  generatedAt: string;
}

/** byPanelId + ordered strings[] for one panel subset. */
function stringsFromAssignment(
  assignment: Record<string, number>,
  include?: (panelId: string) => boolean,
): { byPanelId: Record<string, number>; strings: DesignElectrical['strings'] } {
  const byPanelId: Record<string, number> = {};
  const stringMap = new Map<number, string[]>();
  for (const pid in assignment) {
    if (include && !include(pid)) continue;
    const idx = assignment[pid];
    byPanelId[pid] = idx;
    const arr = stringMap.get(idx);
    if (arr) arr.push(pid); else stringMap.set(idx, [pid]);
  }
  const strings = [...stringMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stringIndex, panelIds]) => ({ stringIndex, panelCount: panelIds.length, panelIds }));
  return { byPanelId, strings };
}

/**
 * Build the DesignElectrical block the Design Studio persists — THE §1.3
 * design-truth writer. Pure so the split is testable outside the component.
 *
 *  • Single-type design (stamps collapse to one key): flat block only, field
 *    order and values identical to the pre-Wave-4 writer (byte-identical
 *    layout JSON; no map ⇒ designVersionId untouched, §1.6/I-9).
 *  • Hybrid design (stamps span >1 key): `subSystems[]` carries one block per
 *    present key (own strings/byPanelId, split via classifyPanel), and the
 *    FLAT fields mirror the PRIMARY sub (first present in roof > ground >
 *    fence): its byPanelId/strings/deviceCount — never the whole-design mix
 *    (a flat consumer must never see fence panels pinned to the roof system).
 *    Equipment ids (panel/racking/models) are the studio's single selection
 *    set today; each block records them so a per-sub picker (Lane-A fast
 *    follow) can diverge them without a shape change.
 */
export function buildDesignElectricalBlock(input: BuildDesignElectricalInput): DesignElectrical {
  const {
    panels, assignmentByPanelId, topology, inverterBrand, modulesPerString,
    rackingId, panelId, optimizerModelId, microModelId, overrides, deviceCount, generatedAt,
  } = input;

  const keyByPanel: Record<string, SubSystemKey> = {};
  for (const p of panels ?? []) {
    if (p && typeof p.id === 'string') keyByPanel[p.id] = classifyPanel(p);
  }
  const presentKeys = SUB_SYSTEM_KEYS.filter(k => Object.values(keyByPanel).includes(k));

  // Per-sub split — only when the stamps genuinely span >1 system type.
  let subSystems: DesignSubSystemBlock[] | undefined;
  if (presentKeys.length > 1) {
    const blocks: DesignSubSystemBlock[] = [];
    for (const key of presentKeys) {
      const sub = stringsFromAssignment(assignmentByPanelId, pid => keyByPanel[pid] === key);
      if (sub.strings.length === 0) continue;
      blocks.push({
        key,
        topology,
        panelId,
        rackingId,
        ...(optimizerModelId !== undefined ? { optimizerModelId } : {}),
        ...(microModelId !== undefined ? { microModelId } : {}),
        strings: sub.strings,
        byPanelId: sub.byPanelId,
      });
    }
    if (blocks.length > 1) subSystems = blocks;
  }

  // Flat block: whole design when single-type (legacy byte-identical); the
  // PRIMARY sub's mirror when hybrid (§1.4 — blocks[0] is roof > ground > fence).
  const flat = subSystems
    ? { byPanelId: subSystems[0].byPanelId, strings: subSystems[0].strings }
    : stringsFromAssignment(assignmentByPanelId);
  const flatPanelCount = flat.strings.reduce((s, x) => s + x.panelCount, 0);
  const flatDeviceCount = subSystems
    ? (topology === 'string' ? 0 : flatPanelCount) // modulesPerDevice=1 ⇒ devices = panels
    : deviceCount;

  return {
    topology,
    inverterBrand,
    modulesPerString,
    rackingId,
    panelId,
    optimizerModelId,
    microModelId,
    byPanelId: flat.byPanelId,
    overrides,
    strings: flat.strings,
    deviceCount: flatDeviceCount,
    generatedAt,
    ...(subSystems ? { subSystems } : {}),
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
    /** Per-subsystem tag (inherits the parent inverter's key — contract §1.1). */
    subSystemKey?: SubSystemKey;
  }>;
  stringsPerInverter: number;
  modulesPerString: number;
  optimizerPeripheralId?: string;
  /** Per-subsystem tag (derived cache — contract §1.1). MUST survive this
   *  normalizer's whitelist (I-2, tag-survival rule §1.3). */
  subSystemKey?: SubSystemKey;
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
      // Tag survival (contract §1.3, I-2): subSystemKey is whitelisted here;
      // untagged strings inherit the parent inverter's key.
      const invSubSystemKey: SubSystemKey | undefined =
        isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : undefined;
      const strings = rawStrings
        .map((s: any, j: number) => {
          const strKey = isSubSystemKey(s?.subSystemKey) ? s.subSystemKey : invSubSystemKey;
          return {
            id: String(s?.id ?? `str-${i}-${j}`),
            label: String(s?.label ?? `String ${j + 1}`),
            panelCount: Number(s?.panelCount) || 0,
            panelId: String(s?.panelId ?? 'qcells-peak-duo-400'),
            wireGauge: String(s?.wireGauge ?? '#10 AWG THWN-2'),
            tilt: Number(s?.tilt) || 20,
            azimuth: Number(s?.azimuth) || 180,
            roofType: String(s?.roofType ?? 'shingle'),
            mountingSystem: String(s?.mountingSystem ?? 'ironridge-xr100'),
            ...(strKey ? { subSystemKey: strKey } : {}),
          };
        })
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
        ...(invSubSystemKey ? { subSystemKey: invSubSystemKey } : {}),
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** One permit inverter from one handoff (shared by the flat + per-sub paths).
 *  `subSystemKey` tags the inverter AND its strings (contract §1.1/I-2);
 *  omitted entirely on the legacy flat path (byte-identical output). */
function permitInverterFromHandoff(
  h: DesignEngineeringHandoff,
  id: string,
  subSystemKey?: SubSystemKey,
): PermitInverter | null {
  const strings = h.strings.map((s, j) => ({
    id: String(s.id ?? `str-design-${j}`),
    label: String(s.label ?? `String ${j + 1}`),
    panelCount: Number(s.panelCount) || 0,
    panelId: String(s.panelId ?? 'qcells-peak-duo-400'),
    wireGauge: String(s.wireGauge ?? '#10 AWG THWN-2'),
    tilt: Number(s.tilt) || 20,
    azimuth: Number(s.azimuth) || 180,
    roofType: String((s as any).roofType ?? 'shingle'),
    mountingSystem: String(s.mountingSystem ?? 'ironridge-xr100'),
    ...(subSystemKey ? { subSystemKey } : {}),
  })).filter(s => s.panelCount > 0);
  if (strings.length === 0) return null;
  return {
    id,
    inverterId: h.inverterId,
    model: h.inverterId,
    type: h.inverterType,
    strings,
    stringsPerInverter: h.strings.length,
    modulesPerString: h.strings[0]?.panelCount ?? 0,
    ...(h.optimizerPeripheralId ? { optimizerPeripheralId: h.optimizerPeripheralId } : {}),
    ...(subSystemKey ? { subSystemKey } : {}),
  };
}

/**
 * Build permit-shaped inverters straight from a DesignElectrical block.
 *
 * Wave 4A (contract §1.3/I-3): when the design carries a genuine per-sub
 * split (`subSystems` with >1 panel-bearing blocks), one PermitInverter is
 * emitted PER SUB, tagged with its subSystemKey (inverter + strings), each
 * derived from that sub's OWN topology/panel/racking/model ids — never a
 * project-wide winner. The project-pinned inverter id applies to the PRIMARY
 * sub only (blocks[0], roof > ground > fence) so a pinned roof inverter can
 * never pin the fence fleet. Flat-only designs take the exact legacy
 * single-inverter path (byte-identical, no subSystemKey property).
 */
export function designToPermitInverters(
  de: DesignElectrical,
  opts: DesignToEngineeringOpts = {},
): PermitInverter[] | null {
  try {
    if (!de || !Array.isArray(de.strings) || de.strings.length === 0) return null;

    const blocks = designSubSystemBlocks(de);
    if (blocks) {
      const out: PermitInverter[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const subDe: DesignElectrical = {
          ...de,
          topology: b.topology,
          panelId: b.panelId ?? de.panelId,
          rackingId: b.rackingId ?? de.rackingId,
          microModelId: b.microModelId,
          optimizerModelId: b.optimizerModelId,
          strings: b.strings,
          byPanelId: b.byPanelId,
          // Brand is topology-inferred unless the sub matches the flat block's
          // topology (a SolarEdge label must not leak onto an Enphase sub).
          inverterBrand: b.topology === de.topology ? de.inverterBrand : undefined,
        };
        const subOpts: DesignToEngineeringOpts =
          i === 0 ? opts : { ...opts, selectedInverterId: undefined };
        const h = designElectricalToEngineering(subDe, subOpts);
        const inv = permitInverterFromHandoff(h, `inv-design-${i}`, b.key);
        if (inv) out.push(inv);
      }
      return out.length > 0 ? out : null;
    }

    // Legacy flat path — byte-identical to the pre-Wave-4 output.
    const h = designElectricalToEngineering(de, opts);
    if (h.strings.length === 0) return null;
    const inv = permitInverterFromHandoff(h, 'inv-design-0');
    return inv ? [inv] : null;
  } catch {
    return null;
  }
}
