/**
 * components/3d/irradiance/index.ts
 *
 * Barrel export for the irradiance map toggle slice.
 *
 * Mount from `components/3d/SolarEngine3D.tsx`:
 *
 *   import {
 *     IrradianceToggle,
 *     IrradianceToast,
 *     IrradianceOverlay,
 *     useIrradianceHotkey,
 *     isIrradianceHotkeyEvent,
 *     useIrradianceStore,
 *   } from './irradiance';
 *
 *   // 1. Bind the (I) hotkey once on mount.
 *   useIrradianceHotkey();
 *
 *   // 2. Render the three UI children inside the canvas return JSX.
 *   <>
 *     <IrradianceToggle className="absolute top-3 right-3 z-30" />
 *     <IrradianceToast />
 *     <IrradianceOverlay className="absolute top-14 right-3 z-30" />
 *   </>
 *
 * If the parent component already has a `keydown` listener (e.g.
 * `SolarEngine3D`'s `setupKeyboardHandler`), call
 * `isIrradianceHotkeyEvent(e)` inside that handler and dispatch to
 * `useIrradianceStore.getState().toggle()` on a match — no
 * separate `useIrradianceHotkey()` call needed.
 */

export { default as IrradianceToggle } from './IrradianceToggle';
export type { IrradianceToggleProps } from './IrradianceToggle';

export { default as IrradianceToast } from './IrradianceToast';
export type { IrradianceToastProps } from './IrradianceToast';

export { default as IrradianceOverlay } from './IrradianceOverlay';
export type { IrradianceOverlayProps } from './IrradianceOverlay';

export { useIrradianceHotkey, bindIrradianceHotkey } from './useIrradianceHotkey';
export {
  useIrradianceStore,
  isIrradianceHotkeyEvent,
  selectIsInFlight,
  selectIsVisible,
  selectToast,
  type IrradianceStoreState,
} from './irradianceStore';

export {
  IRRADIANCE_STATES,
  IRRADIANCE_TRANSITIONS,
  IRRADIANCE_HOTKEY,
  IRRADIANCE_HOTKEY_LABEL,
  IRRADIANCE_TOGGLE_TOOLTIP,
  IRRADIANCE_QUEUED_TOAST_TITLE,
  IRRADIANCE_COMPUTE_DELAY_MS,
  IRRADIANCE_TOAST_DURATION_MS,
  type IrradianceState,
  type IrradianceResult,
  type IrradianceToast as IrradianceToastShape,
} from './types';
