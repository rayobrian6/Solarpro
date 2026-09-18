/**
 * components/3d/panel/tools.ts
 *
 * Pure data tables for the right-panel tool list. No React, no DOM —
 * the component (RightPanel.tsx) imports these and renders from them,
 * and the tests import them directly to assert the parity shape.
 *
 * Source of truth: Aurora 2017 "reDesigned" frame 147 (Design phase)
 * + HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1 (Site Model phase).
 */

import type { PanelEntry } from './types';

/**
 * The 9 design-phase tools in their on-screen order.
 * Order matters — this is the order the user sees in the panel.
 */
export const DESIGN_TOOLS: ReadonlyArray<PanelEntry> = [
  {
    id: 'auto-design',
    icon: '\u26A1',                 // ⚡
    label: 'Auto Design',
    hotkey: 'a',
    tip: 'Auto-place panels on the roof using roof-segment data',
    phase: 'design',
  },
  {
    id: 'solar-panels',
    icon: '\u2600',                 // ☀
    label: 'Solar Panels',
    hotkey: null,
    tip: 'Manually place panels on a roof surface',
    phase: 'design',
  },
  {
    id: 'inverter',
    icon: '\u2295',                 // ⊕
    label: 'Inverter',
    hotkey: null,
    tip: 'Place an inverter at a chosen location on the property',
    phase: 'design',
  },
  {
    id: 'bos',
    icon: '\u26A1',                 // ⚡
    label: 'BOS Components',
    hotkey: null,
    tip: 'Place balance-of-system components (disconnects, combiners, optimizers)',
    phase: 'design',
  },
  {
    id: 'string-modules',
    icon: '\u2AF6',                 // ⫶
    label: 'String Modules',
    hotkey: 's',
    tip: 'Group placed panels into electrical strings',
    phase: 'design',
  },
  {
    id: 'connect',
    icon: '\u21C4',                 // ⇄
    label: 'Connect',
    hotkey: 'c',
    tip: 'Wire DC strings to the inverter (electrical connectivity)',
    phase: 'design',
  },
  {
    id: 'walkway',
    icon: '\u25AD',                 // ▭
    label: 'Walkway',
    hotkey: 'h',
    tip: 'Mark code-required walkways on flat roofs',
    phase: 'design',
  },
  {
    id: 'roof-face-info',
    icon: '\u2139',                 // ℹ
    label: 'Roof Face Info',
    hotkey: null,
    tip: 'Show pitch / azimuth / area for each roof face',
    phase: 'design',
  },
  {
    id: 'ruler',
    icon: '\uD83D\uDCCF',           // 📏 (surrogate pair)
    label: 'Ruler',
    hotkey: null,
    tip: 'Measure distance on the canvas',
    phase: 'design',
  },
];

/**
 * The 5 site-model tools. Currently SolarEngine3D has its own left flyout
 * that covers these, but the right panel is structured to accept them
 * too for future parity. Aurora's site-model right sidebar (HANDOFF §1):
 *   Draw Roof (K), Draw Tree (T), Add Obstruction, Measurements, Ruler
 */
export const SITE_MODEL_TOOLS: ReadonlyArray<PanelEntry> = [
  {
    id: 'draw-roof',
    icon: '\u{1F3E0}',              // 🏠
    label: 'Draw Roof',
    hotkey: 'k',
    tip: 'Trace a roof outline to define a roof face',
    phase: 'site_model',
  },
  {
    id: 'draw-tree',
    icon: '\u{1F333}',              // 🌳
    label: 'Draw Tree',
    hotkey: 't',
    tip: 'Mark a tree to be excluded from solar placement',
    phase: 'site_model',
  },
  {
    id: 'add-obstruction',
    icon: '\u26A0',                 // ⚠
    label: 'Add Obstruction',
    hotkey: null,
    tip: 'Mark a chimney, vent, or dormer that blocks panels',
    phase: 'site_model',
  },
  {
    id: 'measurements',
    icon: '\u{1F4CF}',              // 📏
    label: 'Measurements',
    hotkey: null,
    tip: 'Show measurements for the selected roof face',
    phase: 'site_model',
  },
  {
    id: 'ruler',
    icon: '\uD83D\uDCCF',           // 📏
    label: 'Ruler',
    hotkey: null,
    tip: 'Measure distance on the canvas',
    phase: 'site_model',
  },
];

/**
 * Return the entry list for a given phase.
 */
export function getToolsForPhase(phase: 'site_model' | 'design'): ReadonlyArray<PanelEntry> {
  return phase === 'design' ? DESIGN_TOOLS : SITE_MODEL_TOOLS;
}

/**
 * Look up an entry by id. Returns undefined if not found.
 */
export function findTool(id: string): PanelEntry | undefined {
  return DESIGN_TOOLS.find(t => t.id === id) ?? SITE_MODEL_TOOLS.find(t => t.id === id);
}
