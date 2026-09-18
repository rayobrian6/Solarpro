/**
 * components/3d/panel/types.ts
 *
 * Shared TypeScript types for the design-phase right panel.
 * Kept separate from the React component so the data tables
 * (tools.ts) and the pure hotkey function (hotkeys.ts) can
 * be tested without jsdom.
 *
 * Phase type alignment: the canvasTheme agent defined
 *   CanvasPhase = 'site_model' | 'design'
 * in components/3d/canvasTheme/canvasTheme.constants.ts.
 * We import that shared type and re-export it as `Phase` for
 * convenience, so callers can use either name interchangeably.
 */

import type { CanvasPhase } from '@/components/3d/canvasTheme';

/**
 * The two phases the 3D design surface can be in. Same as CanvasPhase.
 * Re-exported under the short name for panel-specific code.
 */
export type Phase = CanvasPhase;

/**
 * Stable ids for the 9 design tools + 5 site-model tools.
 * Every entry in tools.ts uses one of these. The id is what
 * onToolChange emits, and what future tool implementations
 * will key off.
 */
export type ToolId =
  // ── Design phase (Aurora frame 147) ─────────────────────────────
  | 'auto-design'
  | 'solar-panels'
  | 'inverter'
  | 'bos'
  | 'string-modules'
  | 'connect'
  | 'walkway'
  | 'roof-face-info'
  | 'ruler'
  // ── Site model phase (Aurora HOFF §1 right sidebar) ────────────
  | 'draw-roof'
  | 'draw-tree'
  | 'add-obstruction'
  | 'measurements'
  // 'ruler' is shared above
  ;

/** Group/phase label used internally to filter the entry list. */
export type ToolGroup = 'design' | 'site_model';

/**
 * Declarative row entry. A button in the panel is rendered from one of these.
 *   id      — stable, kebab-case, used in onToolChange callbacks
 *   icon    — single character/emoji (matches Aurora frame 147: ⚡ ☀ ⊕ ⫶ ⇄ ▭ ℹ 📏)
 *   label   — human-readable
 *   hotkey  — single letter (lowercase). null if no hotkey. The hotkey handler
 *             is a separate testable function (see hotkeys.ts).
 *   tip     — tooltip / description (currently unused in the rendered list,
 *             kept so the entry can be reused by other UIs without re-typing
 *             the description).
 *   phase   — which list the entry belongs to
 */
export interface PanelEntry {
  id: ToolId;
  icon: string;
  label: string;
  hotkey: string | null;
  tip: string;
  phase: ToolGroup;
}

/**
 * Props for the <RightPanel> component.
 */
export interface RightPanelProps {
  /** Which list to render. Defaults to 'design'. */
  phase?: Phase;

  /**
   * Controlled active tool. If provided, the panel highlights this row
   * and emits changes via onToolChange. If undefined, the panel manages
   * its own internal state (uncontrolled mode).
   */
  activeToolId?: ToolId | null;

  /**
   * Called when the user picks a tool. Receives the entry's id.
   * Re-clicking the active row emits null (toggle-off).
   */
  onToolChange?: (id: ToolId | null) => void;

  /**
   * Optional: collapse the panel to just a chevron button. Defaults to false.
   * When true, the list of buttons is hidden and only the toggle is visible.
   */
  collapsed?: boolean;

  /**
   * Optional: install a global keydown handler that maps the entry hotkeys
   * to onToolChange calls. Defaults to true.
   * Set to false to disable hotkeys (e.g. when a textarea is focused).
   */
  enableHotkeys?: boolean;

  /**
   * Optional className passthrough for the outer container.
   */
  className?: string;
}
