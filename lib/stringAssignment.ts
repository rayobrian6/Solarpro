/**
 * stringAssignment.ts — Spatial String + Equipment Assignment  (v1)
 *
 * Links the GEOMETRY model (PlacedPanel[] on the roof) to the ELECTRICAL model
 * (strings + per-module equipment). There is no spatial string→panel link stored
 * anywhere else, so this module derives one deterministically from panel layout:
 *
 *   1. Group panels by roof plane (a string is kept within a single plane so the
 *      install wiring run is contiguous — saves the installer labor).
 *   2. Order each plane's panels in serpentine ("boustrophedon") install order:
 *      eave→ridge by row, snaking left/right each row so the string follows the
 *      physical wiring path.
 *   3. Chunk the ordered panels into strings of `modulesPerString`.
 *      MICRO IS DIFFERENT: a micro system has no DC strings — its groups ARE
 *      the AC branch circuits, planned by the SAME planner the plan set uses
 *      (`planMicroBranches`, lib/permit/utils/branching.ts: per-model max,
 *      balanced sizes, plane-contiguous walk). The studio used to chunk micros
 *      by `modulesPerString` too (14 on an IQ8+, over its 13 max) while E-1
 *      drew 11/11/10 (Ray, 2026-09-25). Each sub-system is planned with its
 *      OWN micro, as E-1 plans a hybrid.
 *   4. Assign each panel a per-module device based on topology:
 *        - 'string'    → no per-module device (none)
 *        - 'optimizer' → one optimizer under every module
 *        - 'micro'     → one microinverter under every module
 *
 * Output is a flat `byPanelId` lookup consumed by the 3D engine for color-by-string
 * + equipment rendering, plus a `strings` summary for the legend.
 *
 * This is AUTO assignment. A future manual "paint a string" tool can override
 * `byPanelId` entries without changing this contract.
 */

import type { PlacedPanel } from '@/types';
import { planMicroBranches, microMaxPerBranch, type BranchPlanPanel } from '@/lib/permit/utils/branching';
import { classifyPanel, type SubSystemPanel } from '@/lib/permit/utils/subSystems';
import { SUB_SYSTEM_KEYS, type SubSystemKey } from '@/lib/system/subSystemEquipment';

export type Topology = 'string' | 'optimizer' | 'micro';
export type PanelDeviceType = 'optimizer' | 'micro' | 'none';

// Distinct, high-contrast string colors (cycled when strings > palette length).
export const STRING_PALETTE: string[] = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#22c55e', // green
  '#ec4899', // pink
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ef4444', // red
  '#84cc16', // lime
  '#f97316', // orange
  '#14b8a6', // teal
  '#eab308', // yellow
  '#8b5cf6', // violet
];

export function stringColor(stringIndex: number): string {
  return STRING_PALETTE[((stringIndex % STRING_PALETTE.length) + STRING_PALETTE.length) % STRING_PALETTE.length];
}

export interface PanelStringMeta {
  panelId: string;
  stringIndex: number;       // 0-based global string index
  stringId: string;
  stringLabel: string;       // e.g. "String 3"
  positionInString: number;  // 1-based position within its string
  color: string;             // hex — string color
  deviceType: PanelDeviceType;
  deviceModelId?: string;
}

export interface StringSummary {
  stringIndex: number;
  stringId: string;
  label: string;
  color: string;
  panelCount: number;
  planeId: string;
}

export interface StringAssignmentResult {
  byPanelId: Record<string, PanelStringMeta>;
  strings: StringSummary[];
  topology: Topology;
  deviceType: PanelDeviceType;
  deviceCount: number;       // total optimizers / micros across the system
  modulesPerDevice: number;
  /** MICRO only — the manufacturer's max micros per AC branch the groups obey
   *  (on a hybrid planned with different micros, the largest of the subs'). */
  maxPerBranch?: number;
  /** MICRO only — the micro each sub-system's branches were planned with, in
   *  roof > ground > fence order (one entry on a single-type design). */
  microPlans?: MicroSubPlan[];
}

/** A micro model as the branch planner is given it. */
export interface MicroPick {
  id?: string;
  model?: string | null;
  manufacturer?: string | null;
}

/** One sub-system's micro branch plan basis. */
export interface MicroSubPlan {
  key: SubSystemKey;
  id?: string;
  model: string | null;
  manufacturer: string | null;
  maxPerBranch: number;
  /** Panels in this sub = micros in it (one per module). */
  panelCount: number;
}

export interface AssignStringsOptions {
  modulesPerString: number;
  topology: Topology;
  /** Modules served by one device (micros: 1 standard, 2 dual-module; optimizers: 1). */
  modulesPerDevice?: number;
  optimizerModelId?: string;
  microModelId?: string;
  /** MICRO — the model + manufacturer the branch planner is given (the same
   *  pair the permit snapshot passes). An id alone is not enough for non-
   *  Enphase micros. Falls back to `microModelId`. */
  microModel?: string | null;
  microManufacturer?: string | null;
  /** MICRO — each sub-system's OWN micro. On a hybrid the plan set plans every
   *  sub with that sub's recorded inverter (conductorAuthority → one
   *  planMicroBranches per sub), so 24 fence panels on an IQ8A are 8/8/8 on E-1
   *  and must not be 12/12 here because the roof runs IQ8+. A key with no
   *  entry falls back to microModel / microManufacturer. */
  microBySubSystem?: Partial<Record<SubSystemKey, MicroPick>>;
  /** Manual string-painting overrides: panelId → stringIndex. Applied on top of
   *  the auto serpentine assignment, so the installer can hand-tune any panel. */
  overrides?: Record<string, number>;
}

// Group key — keep a string contiguous within one roof plane / array.
function groupKey(p: PlacedPanel): string {
  return (p as any).planeId ?? (p as any).arrayId ?? (p.systemType ?? 'default');
}

function rowOf(p: PlacedPanel): number {
  return (p as any).gridRow ?? p.row ?? 0;
}
function colOf(p: PlacedPanel): number {
  return (p as any).gridCol ?? p.col ?? 0;
}

/**
 * Serpentine install order for one plane's panels: rows eave→ridge, snaking the
 * column direction each row so consecutive panels are physically adjacent.
 */
function orderSerpentine(group: PlacedPanel[]): PlacedPanel[] {
  const byRow = new Map<number, PlacedPanel[]>();
  for (const p of group) {
    const r = rowOf(p);
    const bucket = byRow.get(r);
    if (bucket) bucket.push(p);
    else byRow.set(r, [p]);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const out: PlacedPanel[] = [];
  rows.forEach((r, idx) => {
    const rowPanels = byRow.get(r)!.slice().sort((a, b) => colOf(a) - colOf(b));
    if (idx % 2 === 1) rowPanels.reverse(); // snake on odd rows
    out.push(...rowPanels);
  });
  return out;
}

/**
 * Assign every placed panel to a string + per-module device.
 * Deterministic: same panels + options → same assignment.
 */
export function assignStrings(
  panels: PlacedPanel[],
  opts: AssignStringsOptions,
): StringAssignmentResult {
  const modulesPerString = Math.max(1, Math.floor(opts.modulesPerString || 1));
  const deviceType: PanelDeviceType =
    opts.topology === 'optimizer' ? 'optimizer'
    : opts.topology === 'micro' ? 'micro'
    : 'none';
  const modulesPerDevice =
    deviceType === 'none' ? 0
    : Math.max(1, Math.floor(opts.modulesPerDevice ?? 1));
  const deviceModelId =
    deviceType === 'optimizer' ? opts.optimizerModelId
    : deviceType === 'micro' ? opts.microModelId
    : undefined;

  // Micro groups are AC branches, planned exactly as the plan set plans them.
  if (deviceType === 'micro') return assignMicroBranches(panels, opts, modulesPerDevice, deviceModelId);

  // Stable plane order = first appearance in the panel array.
  const planeOrder: string[] = [];
  const groups = new Map<string, PlacedPanel[]>();
  for (const p of panels) {
    const k = groupKey(p);
    const bucket = groups.get(k);
    if (bucket) {
      bucket.push(p);
    } else {
      groups.set(k, [p]);
      planeOrder.push(k);
    }
  }

  const byPanelId: Record<string, PanelStringMeta> = {};
  const planeOfPanel: Record<string, string> = {};
  let stringIndex = 0;
  let totalModulesWithDevice = 0;

  for (const k of planeOrder) {
    const ordered = orderSerpentine(groups.get(k)!);
    // Chunk this plane's panels into strings — a new string never crosses planes.
    for (let i = 0; i < ordered.length; i += modulesPerString) {
      const chunk = ordered.slice(i, i + modulesPerString);
      chunk.forEach((panel, pos) => {
        byPanelId[panel.id] = {
          panelId: panel.id,
          stringIndex,
          stringId: `str-${stringIndex}`,
          stringLabel: `String ${stringIndex + 1}`,
          positionInString: pos + 1,
          color: stringColor(stringIndex),
          deviceType,
          deviceModelId,
        };
        planeOfPanel[panel.id] = k;
      });
      stringIndex++;
    }
    totalModulesWithDevice += ordered.length;
  }

  // Apply manual string-painting overrides (panelId → stringIndex) on top of auto.
  const overrides = opts.overrides;
  if (overrides) {
    for (const panelId in overrides) {
      const meta = byPanelId[panelId];
      if (!meta) continue;
      const idx = Math.max(0, Math.floor(overrides[panelId]));
      meta.stringIndex  = idx;
      meta.stringId     = `str-${idx}`;
      meta.stringLabel  = `String ${idx + 1}`;
      meta.color        = stringColor(idx);
    }
  }

  // Derive the string summary (legend) from the FINAL per-panel assignment so it
  // reflects any overrides — including panels painted into brand-new strings.
  const summaryMap = new Map<number, StringSummary>();
  for (const panelId in byPanelId) {
    const meta = byPanelId[panelId];
    const existing = summaryMap.get(meta.stringIndex);
    if (existing) {
      existing.panelCount++;
    } else {
      summaryMap.set(meta.stringIndex, {
        stringIndex: meta.stringIndex,
        stringId: meta.stringId,
        label: meta.stringLabel,
        color: meta.color,
        panelCount: 1,
        planeId: planeOfPanel[panelId] ?? 'default',
      });
    }
  }
  const strings = [...summaryMap.values()].sort((a, b) => a.stringIndex - b.stringIndex);

  const deviceCount =
    deviceType === 'none' ? 0 : Math.ceil(totalModulesWithDevice / modulesPerDevice);

  return {
    byPanelId,
    strings,
    topology: opts.topology,
    deviceType,
    deviceCount,
    modulesPerDevice: deviceType === 'none' ? 0 : modulesPerDevice,
  };
}

/**
 * The branch-planner view of a placed panel — EXACTLY the fields the permit
 * payload's `panelPositions` carry (app/engineering/page.tsx), so the studio
 * and the plan set hand the planner identical input.
 */
export function branchPlanPanelsOf(panels: PlacedPanel[]): BranchPlanPanel[] {
  return panels.map(p => ({
    id: p.id,
    lat: (p as any).lat,
    lng: (p as any).lng,
    row: (p as any).row,
    col: (p as any).col,
    azimuth: (p as any).azimuth,
    systemType: (p as any).systemType,
    arrayId: (p as any).arrayId,
    planeId: (p as any).planeId,
  }));
}

/**
 * MICRO — every group is an AC branch from `planMicroBranches` (D-1): count =
 * ceil(N / per-model max), balanced sizes, plane-contiguous serpentine walk.
 * Manual paint overrides and `modulesPerString` do not apply — the plan set
 * cannot draw a hand-painted branch, so the studio does not offer one.
 *
 * Each sub-system is planned with ITS OWN micro (`microBySubSystem`), as
 * conductorAuthority plans E-1 / PV-2B: one planMicroBranches per sub, branch
 * numbers running on roof > ground > fence. With one micro for every sub this
 * is exactly planMicroBranches' own sub fence over the whole array, so a
 * single-micro design plans byte-identically to before.
 */
function assignMicroBranches(
  panels: PlacedPanel[],
  opts: AssignStringsOptions,
  modulesPerDevice: number,
  deviceModelId: string | undefined,
): StringAssignmentResult {
  const flat = {
    id: deviceModelId,
    model: opts.microModel ?? opts.microModelId ?? null,
    manufacturer: opts.microManufacturer ?? null,
  };
  const microFor = (key: SubSystemKey) => {
    const m = opts.microBySubSystem?.[key];
    return m
      ? { id: m.id ?? flat.id, model: m.model ?? m.id ?? null, manufacturer: m.manufacturer ?? null }
      : flat;
  };

  // Partition the PERMIT projection, not the raw panels — planMicroBranches
  // and conductorAuthority classify the panelPositions payload, which carries
  // systemType only.
  const planPanels = branchPlanPanelsOf(panels);
  const bySub: Record<SubSystemKey, BranchPlanPanel[]> = { roof: [], ground: [], fence: [] };
  for (const p of planPanels) bySub[classifyPanel(p as unknown as SubSystemPanel)].push(p);
  const present = SUB_SYSTEM_KEYS.filter(k => bySub[k].length > 0);

  const assign = new Map<string, number>();
  const sizes: number[] = [];
  const microPlans: MicroSubPlan[] = [];
  const modelOfPanel = new Map<string, string | undefined>();
  const planSub = (key: SubSystemKey, subPanels: BranchPlanPanel[]) => {
    const m = microFor(key);
    const plan = planMicroBranches(subPanels, m.model, m.manufacturer);
    const offset = sizes.length;
    plan.assign.forEach((bi, id) => { assign.set(id, bi + offset); modelOfPanel.set(id, m.id); });
    sizes.push(...plan.sizes);
    microPlans.push({
      key, id: m.id, model: m.model, manufacturer: m.manufacturer,
      maxPerBranch: microMaxPerBranch(m.model, m.manufacturer),
      panelCount: subPanels.length,
    });
  };
  if (present.length <= 1) {
    // Single-type design: the one call E-1's single-system path makes.
    planSub(present[0] ?? 'roof', planPanels);
  } else {
    for (const key of present) planSub(key, bySub[key]);
  }

  const byPanelId: Record<string, PanelStringMeta> = {};
  const positions = new Map<number, number>();
  const planeOfBranch = new Map<number, string>();
  for (const p of panels) {
    const bi = assign.get(String(p.id));
    if (bi == null) continue;
    const pos = (positions.get(bi) ?? 0) + 1;
    positions.set(bi, pos);
    if (!planeOfBranch.has(bi)) planeOfBranch.set(bi, groupKey(p));
    byPanelId[p.id] = {
      panelId: p.id,
      stringIndex: bi,
      stringId: `str-${bi}`,
      stringLabel: `Branch ${bi + 1}`,
      positionInString: pos,
      color: stringColor(bi),
      deviceType: 'micro',
      deviceModelId: modelOfPanel.get(String(p.id)) ?? deviceModelId,
    };
  }
  const strings: StringSummary[] = sizes.map((size, bi) => ({
    stringIndex: bi,
    stringId: `str-${bi}`,
    label: `Branch ${bi + 1}`,
    color: stringColor(bi),
    panelCount: size,
    planeId: planeOfBranch.get(bi) ?? 'default',
  })).filter(s => s.panelCount > 0);

  return {
    byPanelId,
    strings,
    topology: 'micro',
    deviceType: 'micro',
    deviceCount: panels.length ? Math.ceil(panels.length / modulesPerDevice) : 0,
    modulesPerDevice,
    maxPerBranch: Math.max(...microPlans.map(s => s.maxPerBranch)),
    microPlans,
  };
}
