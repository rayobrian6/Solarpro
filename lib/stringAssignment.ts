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
}

export interface AssignStringsOptions {
  modulesPerString: number;
  topology: Topology;
  /** Modules served by one device (micros: 1 standard, 2 dual-module; optimizers: 1). */
  modulesPerDevice?: number;
  optimizerModelId?: string;
  microModelId?: string;
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
