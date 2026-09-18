/**
 * components/3d/wizard/index.ts
 *
 * Public surface for the 3-step Roof Wizard (Aurora parity).
 *
 * Import from SolarEngine3D.tsx with:
 *   import { RoofWizard } from './wizard';
 *
 * See ./wizardMachine.ts for the pure reducer and ./RoofWizard.tsx for
 * the React component. Design doc: ./DESIGN.md.
 */

export { RoofWizard } from './RoofWizard';
export type { RoofWizardProps } from './RoofWizard';

export {
  wizardReducer,
  initialState,
  canAdvance,
  canGoBack,
  isRoofDrawMode,
  MIN_VERTICES_FOR_STEP_2,
  STEP_LABELS,
} from './wizardMachine';

export type {
  WizardStep,
  WizardState,
  WizardEvent,
  RoofDrawMode,
  WizardSegment,
  WizardVertex,
  WizardSnapshot,
  CanAdvanceInfo,
} from './wizardMachine';
