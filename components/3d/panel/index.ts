/**
 * components/3d/panel/index.ts
 *
 * Barrel export for the design-phase right panel.
 *
 * Typical import:
 *   import { RightPanel, DESIGN_TOOLS, SITE_MODEL_TOOLS } from '@/components/3d/panel';
 *
 * The default export is the component itself:
 *   import RightPanel from '@/components/3d/panel/RightPanel';
 *   import RightPanel from '@/components/3d/panel';   // also works (re-exported default)
 */

export { default } from './RightPanel';
export { default as RightPanel } from './RightPanel';
export * from './types';
export {
  DESIGN_TOOLS,
  SITE_MODEL_TOOLS,
  getToolsForPhase,
  findTool,
} from './tools';
export {
  designHotkeyToToolId,
  hasModifierKey,
} from './hotkeys';
